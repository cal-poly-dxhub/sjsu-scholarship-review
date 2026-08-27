"""On-demand scoring: one application per model call.

The run is scoped to a scholarship, a year, and a rubric version. Each item is claimed before
it is scored, so two runs over the same cohort cannot both score the same application, and the
worker stops claiming while it still has time to finish what it holds.

A reply that fails the check is retried once with what was wrong included, because a second
identical call at temperature 0 gives the same bad reply. A throttle is not a failure: the
item is handed back and stays claimable.

The run notes on the cohort that its totals are moving and rebuilds the cohort's agreement
figures when it finishes, so a reviewer file read before any of this shows its gaps afterwards.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from shared.claims import ONDEMAND_CLAIM, claim, mark_failed, release
from shared.gaps import mark_scores_changed, rebuild_summary
from shared.model import Transient, converse
from shared.prompt import applicant_text, system_blocks
from shared.reply import ReplyError, check_reply
from shared.scores import StaleClaim, write_score
from shared.work import claimable, rubric_version_item

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MODEL_ID = os.environ["MODEL_ID"]

WORKER = "score-ondemand"

# Two calls per claim: the first, and one that is told what was wrong with it.
MODEL_TRIES = 2

# Stop claiming with this much of the Lambda's time left, so nothing is claimed and abandoned.
RESERVE_MS = 60_000


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Score a cohort against one rubric version. Returns what happened, per item."""
    scholarship = event["scholarship"]
    year = event["year"]
    version = event["rubric_version"]
    run_id = f"{WORKER}#{context.aws_request_id}"

    rubric = rubric_version_item(scholarship, version)
    criteria = rubric["criteria"]
    # Built before anything is claimed: a version with no rubric file stops the run here
    # rather than leaving items claimed for a call that cannot be made.
    system = system_blocks(rubric)

    items = claimable(
        scholarship=scholarship,
        year=year,
        rubric_version=version,
        scope=event.get("scope"),
        limit=event.get("limit"),
    )
    mark_scores_changed(scholarship, year)

    counts = {"scored": 0, "failed": 0, "released": 0, "stale": 0, "claimed_elsewhere": 0}
    reasons: list[dict[str, str]] = []
    reached = 0

    for item in items:
        if context.get_remaining_time_in_millis() < RESERVE_MS:
            logger.info("Out of time with %s items left. They stay claimable.", len(items) - reached)
            break
        reached += 1

        if not claim(
            pk=item["pk"], sk=item["sk"], claimed_by=run_id, rubric_version=version,
            holds=ONDEMAND_CLAIM,
        ):
            counts["claimed_elsewhere"] += 1
            continue

        outcome, reason = score_one(
            item=item,
            criteria=criteria,
            system=system,
            version=version,
            run_id=run_id,
        )
        counts[outcome] += 1
        if reason:
            reasons.append({"application": item["sk"], "outcome": outcome, "reason": reason})

    # Before the report and before any raise: a run that scored something and did not rebuild
    # leaves the agreement figures behind the scores.
    if counts["scored"]:
        rebuild_summary(scholarship, year)

    report = {
        "worker": WORKER,
        "run": run_id,
        "scholarship": scholarship,
        "year": year,
        "rubric_version": version,
        "found": len(items),
        **counts,
        "not_reached": len(items) - reached,
        "problems": reasons,
        "figures_rebuilt": bool(counts["scored"]),
    }
    logger.info("Run finished: %s", json.dumps(report))

    # A permanent failure inside a run is not a success, and saying so is what keeps a partly
    # failed cohort from reading as done. A released item is not one of these — it is still work.
    if counts["failed"]:
        raise ScoringIncomplete(json.dumps(report))
    return report


class ScoringIncomplete(Exception):
    """Some items in the run failed. The report is the message."""


def score_one(
    *,
    item: dict[str, Any],
    criteria: list[dict[str, Any]],
    system: list[dict[str, str]],
    version: str,
    run_id: str,
) -> tuple[str, str]:
    """One claimed application. Returns the outcome and, when it is not `scored`, why."""
    application = applicant_text(item)
    complaint = ""

    for attempt in range(1, MODEL_TRIES + 1):
        try:
            answer = converse(
                model_id=MODEL_ID, system=system, user_text=application + complaint
            )
        except Transient as error:
            release(pk=item["pk"], sk=item["sk"], claimed_by=run_id, reason=str(error))
            return "released", str(error)

        try:
            checked = check_reply(answer.text, criteria, stop_reason=answer.stop_reason)
        except ReplyError as error:
            if attempt < MODEL_TRIES:
                # Telling the model what was wrong is the only thing that makes a second call
                # worth making — temperature 0 would repeat the first reply exactly. It goes on
                # the user part so the two system parts stay byte-identical between the calls.
                complaint = (
                    f"\n\nYour previous reply was rejected: {error}."
                    " Return one JSON object in the shape you were given and nothing else."
                )
                continue
            mark_failed(pk=item["pk"], sk=item["sk"], claimed_by=run_id, reason=str(error))
            return "failed", str(error)

        try:
            write_score(
                application=item,
                reply=checked,
                criteria=criteria,
                rubric_version=version,
                model_id=MODEL_ID,
                worker=WORKER,
                input_tokens=answer.input_tokens,
                output_tokens=answer.output_tokens,
                claimed_by=run_id,
            )
        except StaleClaim as error:
            return "stale", str(error)
        return "scored", ""

    raise AssertionError("unreachable: the loop either scores, releases, or fails")
