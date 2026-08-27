"""Moving a cohort's totals to a rubric version that changed weights and nothing else.

No model call: each total is the stored per-criterion scores over their own maxima, times the
new weights. The per-criterion scores are not rewritten and no score item is written — a score
item is the record of a model attempt, and no attempt happened here.

A criteria change is not this worker's job. `recomputable` only hands back applications whose
stored version matches the target on everything the model saw, so anything else stays where it
is and needs a rescore.

New weights move the reviewers' totals too, so each application's gap is settled as its total
moves and the cohort's figures are rebuilt at the end.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError

from shared.gaps import mark_scores_changed, rebuild_summary, settle_gap
from shared.table import cohort_of, rank_pk, table, to_dynamo
from shared.work import recomputable, rubric_version_item

logger = logging.getLogger()
logger.setLevel(logging.INFO)

WORKER = "recompute"

# Stop with this much of the Lambda's time left. A partly recomputed cohort is readable —
# every application says which version its total came from — so stopping early is safe.
RESERVE_MS = 10_000


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Recompute one cohort's totals against one rubric version. Returns what happened."""
    scholarship = event["scholarship"]
    year = event["year"]
    version = event["rubric_version"]

    weights = {
        str(criterion["id"]): float(criterion["weight"])
        for criterion in rubric_version_item(scholarship, version)["criteria"]
    }
    items = recomputable(scholarship=scholarship, year=year, rubric_version=version)
    mark_scores_changed(scholarship, year)

    counts = {"moved": 0, "moved_on": 0, "unusable": 0}
    problems: list[dict[str, str]] = []
    reached = 0

    for item, stored in items:
        if context.get_remaining_time_in_millis() < RESERVE_MS:
            logger.info("Out of time with %s totals left at their old version.", len(items) - reached)
            break
        reached += 1

        try:
            total = recomputed_total(item["category_scores"], weights)
        except Unusable as error:
            counts["unusable"] += 1
            problems.append({"application": item["sk"], "reason": str(error)})
            continue

        if move(item=item, stored=stored, version=version, total=total):
            counts["moved"] += 1
        else:
            counts["moved_on"] += 1

    report = {
        "worker": WORKER,
        "scholarship": scholarship,
        "year": year,
        "rubric_version": version,
        "found": len(items),
        **counts,
        "not_reached": len(items) - reached,
        "problems": problems,
        "model_calls": 0,
        "figures_rebuilt": bool(counts["moved"]),
    }
    if counts["moved"]:
        rebuild_summary(scholarship, year)
    logger.info("Recompute finished: %s", json.dumps(report))
    return report


class Unusable(Exception):
    """The stored scores cannot produce a total under these weights. The item is left alone."""


def recomputed_total(category_scores: dict[str, Any], weights: dict[str, float]) -> float:
    """The same arithmetic the scoring worker does, over scores already stored."""
    if set(category_scores) != set(weights):
        raise Unusable(
            "its stored scores name"
            f" {', '.join(sorted(category_scores)) or 'nothing'}, and the version weights"
            f" {', '.join(sorted(weights))}"
        )

    total = 0.0
    for criterion_id, weight in weights.items():
        stored = category_scores[criterion_id]
        maximum = float(stored["max"])
        if maximum <= 0:
            raise Unusable(f"{criterion_id} is stored with a maximum of {maximum}")
        total += (float(stored["score"]) / maximum) * weight
    return round(total, 2)


def move(*, item: dict[str, Any], stored: str, version: str, total: float) -> bool:
    """Write the new total and version, move the ranking key with them, and settle the gap.

    Conditional on the version the item was read at, so a scoring run that reached this
    application first keeps its score — a recompute never overwrites a newer number. That
    condition is the whole of the concurrency control here; there is no claim, because the
    write is one update and takes no time to lose.

    The reviewers' total is on the same weights as the model's, so new weights move both. Left
    alone it would read as a measured comparison against a total that no longer exists.
    """
    scholarship, year, _ = cohort_of(item)
    try:
        table().update_item(
            Key={"pk": item["pk"], "sk": item["sk"]},
            UpdateExpression=(
                "SET total_score = :total, rubric_version = :version, rank_pk = :rank,"
                " recomputed_at = :at"
            ),
            ConditionExpression="rubric_version = :stored",
            ExpressionAttributeValues=to_dynamo(
                {
                    ":total": total,
                    ":version": version,
                    ":rank": rank_pk(scholarship, year, version),
                    ":at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                    ":stored": stored,
                }
            ),
        )
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return False

    settle_gap(item, total_score=total, rubric_version=version)
    return True
