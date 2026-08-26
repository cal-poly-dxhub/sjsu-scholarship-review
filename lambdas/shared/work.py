"""Finding the work in a cohort, and the set a run is for.

A run's set is its rubric version and its model together, and that decides scope: an application
that already has a total in that set is not work, whatever else is true of it. One scored at the
same version by a different model *is* work — running a second model is the point. There is no
separate record of which version a cohort belongs to. A scope only cuts that set down further, so
a trigger takes the work its label names and can never reach an application the set comparison
left out.
"""

from __future__ import annotations

from typing import Any

from boto3.dynamodb.conditions import Attr, ConditionBase, Key

from .claims import ATTEMPT_LIMIT, FAILED, PROCESSING, now
from .table import cohort_pk, rubric_pk, rubric_sk, set_of, table, total_prefix
from .versions import newest_first, weights_only_change


class MissingRubric(Exception):
    """Nothing can be scored without a published version to score against."""


class UnknownScope(Exception):
    """A scope nobody defined would silently widen a run back to everything."""


# What the dashboard's four scoring triggers each mean. Together they cover every application the
# set comparison left in, and no application is in two of them.
SCOPES = ("unscored", "failed", "changed_version", "other_model")


def scope_condition(scope: str, rubric_version: str) -> ConditionBase:
    """The narrowing one scope adds. Raises rather than falling back to everything."""
    if scope == "unscored":
        # A failure clears rubric_version, so "no version stored" alone would take failures too.
        return Attr("rubric_version").not_exists() & Attr("status").ne(FAILED)
    if scope == "failed":
        return Attr("status").eq(FAILED)
    if scope == "changed_version":
        # The version comparison is here now. The run's set no longer rules out an application
        # stored at the target version, because one scored there by another model is work.
        return Attr("rubric_version").exists() & Attr("rubric_version").ne(rubric_version)
    if scope == "other_model":
        # Stored at the target version, and the set comparison already dropped the ones this model
        # made — so what is left is a total another model made at this version.
        return Attr("rubric_version").eq(rubric_version)
    raise UnknownScope(f"'{scope}' is not a scope — it is {' or '.join(SCOPES)}")


def rubric_version_item(scholarship: str, version: str) -> dict[str, Any]:
    """The published version a run scores against. Its criteria drive prompt, check, and total."""
    item = table().get_item(
        Key={"pk": rubric_pk(scholarship), "sk": rubric_sk(version)}
    ).get("Item")
    if not item:
        raise MissingRubric(
            f"{scholarship} has no rubric version {version} — publish one before scoring."
        )
    return item


def scored_in_set(scholarship: str, year: str, rubric_version: str, model_id: str) -> set[str]:
    """The students who already have a total in this set. One prefix Query, keys only."""
    done: set[str] = set()
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
            & Key("sk").begins_with(total_prefix(rubric_version, model_id)),
            "ProjectionExpression": "sk",
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table().query(**request)
        for item in page.get("Items", []):
            done.add(set_of(str(item["sk"]))[2])
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return done


def claimable(
    *,
    scholarship: str,
    year: str,
    rubric_version: str,
    model_id: str,
    scope: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Applications in one cohort that this run could take, narrowed by `scope` if one is given.

    A filter here is a guess about a moment that has already passed — the conditional claim is
    what actually decides. This only keeps the obvious non-work out of the claim loop.
    """
    moment = now()
    # A total in this set is the one thing that is never work. It is a separate read rather than a
    # filter because the set's totals are their own rows, not attributes of the application.
    done = scored_in_set(scholarship, year, rubric_version, model_id)
    condition = (Attr("status").ne(PROCESSING) | Attr("claimed_until").lt(moment)) & (
        Attr("attempt").not_exists() | Attr("attempt").lt(ATTEMPT_LIMIT)
    )
    if scope:
        condition = condition & scope_condition(scope, rubric_version)

    found: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
            & Key("sk").begins_with("APP#"),
            "FilterExpression": condition,
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key

        page = table().query(**request)
        found.extend(
            item
            for item in page.get("Items", [])
            if str(item["sk"]).removeprefix("APP#") not in done
        )
        if limit is not None and len(found) >= limit:
            return found[:limit]

        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found


def recomputable(
    *, scholarship: str, year: str, rubric_version: str
) -> list[tuple[dict[str, Any], str]]:
    """Stored totals that can be moved to `rubric_version` by arithmetic alone.

    Totals, not applications: a recompute moves a total within its own model, so a cohort scored
    on two models has two rows to move and each keeps the model that made it. Each one comes back
    with the version it is stored at, so a cohort stopped part-way says which totals have moved
    and which have not.
    """
    target = rubric_version_item(scholarship, rubric_version)
    by_version = {
        item["sk"].removeprefix("V#"): item for item in newest_first(scholarship)
    }
    # A stored version is only worth comparing once — a cohort is thousands of items over a
    # handful of versions.
    weights_only = {
        name: weights_only_change(item, target)
        for name, item in by_version.items()
        if name != rubric_version
    }

    found: list[tuple[dict[str, Any], str]] = []
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
            & Key("sk").begins_with(total_prefix()),
            "FilterExpression": Attr("total_score").exists() & Attr("category_scores").exists(),
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key

        page = table().query(**request)
        for item in page.get("Items", []):
            stored, _, _ = set_of(str(item["sk"]))
            if weights_only.get(stored):
                found.append((item, stored))

        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found
