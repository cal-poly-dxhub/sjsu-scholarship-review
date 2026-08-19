"""Finding the work in a cohort, and the rubric version a run is for.

The run's rubric version decides scope: an application already stored at that version is not
work, whatever else is true of it. There is no separate record of which version a cohort
belongs to. A scope only cuts that set down further, so a trigger takes the work its label
names — it can never reach an application the version comparison left out.
"""

from __future__ import annotations

from typing import Any

from boto3.dynamodb.conditions import Attr, ConditionBase, Key

from .claims import ATTEMPT_LIMIT, FAILED, PROCESSING, SCORED, now
from .table import cohort_pk, rubric_pk, rubric_sk, table
from .versions import newest_first, weights_only_change


class MissingRubric(Exception):
    """Nothing can be scored without a published version to score against."""


class UnknownScope(Exception):
    """A scope nobody defined would silently widen a run back to everything."""


# What the dashboard's three scoring triggers each mean.
SCOPES = ("unscored", "failed", "changed_version")


def scope_condition(scope: str) -> ConditionBase:
    """The narrowing one scope adds. Raises rather than falling back to everything."""
    if scope == "unscored":
        # A failure clears rubric_version, so "no version stored" alone would take failures too.
        return Attr("rubric_version").not_exists() & Attr("status").ne(FAILED)
    if scope == "failed":
        return Attr("status").eq(FAILED)
    if scope == "changed_version":
        return Attr("rubric_version").exists()
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


def claimable(
    *,
    scholarship: str,
    year: str,
    rubric_version: str,
    scope: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Applications in one cohort that this run could take, narrowed by `scope` if one is given.

    A filter here is a guess about a moment that has already passed — the conditional claim is
    what actually decides. This only keeps the obvious non-work out of the claim loop.
    """
    moment = now()
    condition = (
        (Attr("rubric_version").not_exists() | Attr("rubric_version").ne(rubric_version))
        & (Attr("status").ne(PROCESSING) | Attr("claimed_until").lt(moment))
        & (Attr("attempt").not_exists() | Attr("attempt").lt(ATTEMPT_LIMIT))
    )
    if scope:
        condition = condition & scope_condition(scope)

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
        found.extend(page.get("Items", []))
        if limit is not None and len(found) >= limit:
            return found[:limit]

        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found


def recomputable(
    *, scholarship: str, year: str, rubric_version: str
) -> list[tuple[dict[str, Any], str]]:
    """Scored applications whose total can be moved to `rubric_version` by arithmetic alone.

    Each one comes back with the version it is stored at, so the recompute can write the move
    conditionally and a cohort stopped part-way says which totals have moved and which have not.
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
            & Key("sk").begins_with("APP#"),
            "FilterExpression": (
                Attr("status").eq(SCORED)
                & Attr("total_score").exists()
                & Attr("rubric_version").exists()
                & Attr("rubric_version").ne(rubric_version)
            ),
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key

        page = table().query(**request)
        for item in page.get("Items", []):
            stored = str(item["rubric_version"])
            if weights_only.get(stored):
                found.append((item, stored))

        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found
