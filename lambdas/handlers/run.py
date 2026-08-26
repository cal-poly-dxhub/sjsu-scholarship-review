"""POST to start a run for one cohort, one rubric version, and one model.

The version and the model together decide the outer scope: an application that already has a
total for that pair is not work, and one scored at the same version by another model is. Four of
the dashboard's five triggers — score the unscored, rescore what changed, retry what failed, and
score what another model scored — are `action: score` with a `scope` that narrows it further, so
each takes the work its label names and nothing else.

The fifth is `action: recompute`, and it is a different job: a version that changed weights and
nothing else moves a total by arithmetic over scores already stored, with no model call.

The worker is invoked and not waited on. Progress is counted off the cohort read, because
there is no run record to read.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import boto3

from shared.http import BadRequest, body_of, reply, year_of
from shared.model import MODEL_IDS, UnknownModel, checked_model
from shared.quota import minimum_batch_records
from shared.work import SCOPES, MissingRubric, claimable, recomputable, rubric_version_item

log = logging.getLogger()
log.setLevel(logging.INFO)

ONDEMAND_FUNCTION = os.environ["ONDEMAND_FUNCTION"]
BATCH_FUNCTION = os.environ["BATCH_FUNCTION"]
RECOMPUTE_FUNCTION = os.environ["RECOMPUTE_FUNCTION"]

# Below this the on-demand worker finishes in seconds; at it or above, a batch job halves the
# token price and the wait is hours. It also clears the batch floor either way.
BATCH_LINE = 500

PATHS = ("ondemand", "batch")

ACTIONS = ("score", "recompute")


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        body = body_of(event)
        scholarship = text(body, "scholarship")
        year = year_of(text(body, "year"))
        version = text(body, "rubric_version")
        action = one_of(body, "action", ACTIONS, ACTIONS[0])
        scope = scope_of(body)
        asked = path_of(body)
        model = checked_model(body.get("model_id"))
    except BadRequest as error:
        return reply(400, {"message": str(error)})
    except UnknownModel as error:
        # Refused here, before a single application is claimed. A model the list does not carry
        # would otherwise come back from Bedrock as an access denial inside a worker.
        return reply(400, {"message": str(error), "models": list(MODEL_IDS)})

    try:
        rubric_version_item(scholarship, version)
    except MissingRubric as error:
        return reply(400, {"message": str(error)})

    if action == "recompute":
        return recompute(scholarship, year, version)

    work = len(
        claimable(
            scholarship=scholarship,
            year=year,
            rubric_version=version,
            model_id=model,
            scope=scope,
        )
    )
    if work == 0:
        return reply(
            200,
            {
                "work": 0,
                "action": "score",
                "scope": scope,
                "model_id": model,
                "started": False,
                "message": nothing_to_do(scholarship, year, version, model, scope),
            },
        )

    chosen = asked or ("batch" if work >= BATCH_LINE else "ondemand")
    if chosen == "batch" and work < BATCH_LINE:
        floor = minimum_batch_records()
        if floor is None:
            return reply(
                400,
                {
                    "message": (
                        f"{work} applications is under the {BATCH_LINE} line for the batch path,"
                        " and the minimum a job needs was not checkable. Score this set on"
                        " demand."
                    ),
                },
            )
        if work < floor:
            return reply(
                400,
                {
                    "message": (
                        f"A batch job needs {floor} records and this run has {work}. Nothing was"
                        " started and nothing was claimed. Score this set on demand instead."
                    ),
                    "work": work,
                    "minimum_records": floor,
                },
            )

    function = BATCH_FUNCTION if chosen == "batch" else ONDEMAND_FUNCTION
    start(function, scholarship, year, version, scope, model)

    log.info(
        "started %s for %s %s at %s on %s over %d applications (scope: %s)",
        chosen, scholarship, year, version, model, work, scope or "everything out of date",
    )
    return reply(
        202,
        {
            "work": work,
            "action": "score",
            "scope": scope,
            "path": chosen,
            "model_id": model,
            "started": True,
            "wait": "hours" if chosen == "batch" else "seconds to minutes",
            # Two people pressing the button do not double-score: the claim is conditional, so
            # the second run finds the first one's items already held.
            "note": (
                "Applications already claimed by a run in progress are not taken again."
                if chosen == "ondemand"
                else "A batch job takes hours. The cohort is not nearly finished while it runs."
            ),
            # Said on every start, because the picker is where someone chooses a second model and
            # would reasonably wonder what happens to the first one's numbers.
            "leaves_alone": "Totals from other models stay exactly as they are.",
        },
    )


def recompute(scholarship: str, year: str, version: str) -> dict[str, Any]:
    """Move the totals a weight-only change can move. Nothing here reaches a model."""
    work = len(recomputable(scholarship=scholarship, year=year, rubric_version=version))
    if work == 0:
        return reply(
            200,
            {
                "work": 0,
                "action": "recompute",
                "started": False,
                "message": (
                    f"Nothing to recompute: no total in {scholarship} {year} was made under a"
                    f" version that differs from {version} in weights alone. Applications stored"
                    " at a version whose criteria changed need a rescore."
                ),
            },
        )

    start(RECOMPUTE_FUNCTION, scholarship, year, version, None)
    log.info("started a recompute of %d totals in %s %s at %s", work, scholarship, year, version)
    return reply(
        202,
        {
            "work": work,
            "action": "recompute",
            "started": True,
            "wait": "seconds",
            "model_calls": 0,
            "note": (
                "Arithmetic over the scores already stored. No per-criterion score is"
                " rewritten and no model is called."
            ),
        },
    )


def start(
    function: str,
    scholarship: str,
    year: str,
    version: str,
    scope: str | None,
    model: str | None = None,
) -> None:
    """Hand the cohort to a worker and stop waiting on it."""
    payload: dict[str, Any] = {
        "scholarship": scholarship,
        "year": year,
        "rubric_version": version,
    }
    if scope:
        payload["scope"] = scope
    # A recompute is arithmetic over stored scores, so it is started without one.
    if model:
        payload["model_id"] = model
    boto3.client("lambda").invoke(
        FunctionName=function,
        # Nothing waits: the worker claims as it goes and the screen counts progress off the
        # applications themselves.
        InvocationType="Event",
        Payload=json.dumps(payload).encode("utf-8"),
    )


def nothing_to_do(
    scholarship: str, year: str, version: str, model: str, scope: str | None
) -> str:
    """Why a run found no work, said in terms of what the button asked for.

    Both halves of the set are named. A run finds nothing for a version *and* a model, and the
    same cohort can have plenty of work left on another model.
    """
    where = f"{scholarship} {year}"
    on = f"{version} on {model}"
    if scope == "unscored":
        return (
            f"Nothing to do: every application in {where} already has a total at {on}. Totals"
            " from other models are untouched."
        )
    if scope == "failed":
        return (
            f"Nothing to do: no application in {where} is failed, or the failed ones have run"
            " out of attempts."
        )
    if scope == "changed_version":
        return (
            f"Nothing to do: no application in {where} carries a rubric version other than"
            f" {version}."
        )
    if scope == "other_model":
        return (
            f"Nothing to do: no application in {where} has a total at {version} from a model"
            f" other than {model}."
        )
    return (
        f"Nothing to do: every application in {where} already has a total at {on}, or has run"
        " out of attempts."
    )


def scope_of(body: dict[str, Any]) -> str | None:
    """Which of the scoring triggers this is, or None to take everything out of date."""
    asked = body.get("scope")
    if asked is None:
        return None
    if asked not in SCOPES:
        raise BadRequest(f"'scope' is '{asked}' — it is {' or '.join(SCOPES)}")
    return asked


def text(body: dict[str, Any], name: str) -> str:
    value = body.get(name)
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"'{name}' is missing from the body")
    return value.strip()


def one_of(body: dict[str, Any], name: str, allowed: tuple[str, ...], default: str) -> str:
    value = body.get(name)
    if value is None:
        return default
    if value not in allowed:
        raise BadRequest(f"'{name}' is '{value}' — it is {' or '.join(allowed)}")
    return value


def path_of(body: dict[str, Any]) -> str | None:
    """The path a person overrode to, or None to let the count decide."""
    asked = body.get("path")
    if asked is None:
        return None
    if asked not in PATHS:
        raise BadRequest(f"'path' is '{asked}' — it is {' or '.join(PATHS)}")
    return asked
