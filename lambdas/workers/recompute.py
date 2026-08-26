"""Moving a cohort's totals to a rubric version that changed weights and nothing else.

No model call: each total is the stored per-criterion scores over their own maxima, times the
new weights. The per-criterion scores are not rewritten and no score item is written — a score
item is the record of a model attempt, and no attempt happened here.

A criteria change is not this worker's job. `recomputable` only hands back totals whose stored
version matches the target on everything the model saw, so anything else stays where it is and
needs a rescore.

Each total moves within its own model. A cohort scored on two models has a row per model, and a
recompute writes each one at the new version under the model that made it — arithmetic never
changes whose number it is.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError

from shared.table import (
    UNKNOWN_MODEL,
    application_sk,
    cohort_pk,
    rank_pk,
    set_of,
    table,
    to_dynamo,
    total_sk,
)
from shared.work import recomputable, rubric_version_item

logger = logging.getLogger()
logger.setLevel(logging.INFO)

WORKER = "recompute"

# Stop with this much of the Lambda's time left. A partly recomputed cohort is readable — each
# total's own key says which version and model it is for — so stopping early is safe.
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
            problems.append({"total": item["sk"], "reason": str(error)})
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
    }
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
    """Move one total from the set it is in to the same model's set at `version`.

    The new row is written only if that set has no total for this application yet, so a scoring
    run that already produced a real number there keeps it — a recompute never overwrites one.
    That condition is the whole of the concurrency control here; there is no claim, because each
    write is one call and takes no time to lose. The old row goes only after the new one lands,
    so a failure in between leaves a duplicate total rather than none.
    """
    _, scholarship, year = str(item["pk"]).split("#", 2)
    _, model, student = set_of(str(item["sk"]))
    at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    try:
        table().put_item(
            Item=to_dynamo(
                {
                    "pk": item["pk"],
                    "sk": total_sk(version, model, student),
                    "student_uuid": student,
                    "rubric_version": version,
                    "model_id": model,
                    "total_score": total,
                    "category_scores": item["category_scores"],
                    "rank_pk": rank_pk(scholarship, year, version, model),
                    "scored_at": item.get("scored_at"),
                    "recomputed_at": at,
                }
            ),
            ConditionExpression="attribute_not_exists(sk)",
        )
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return False

    table().delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
    move_copy(
        scholarship=scholarship, year=year, student=student, stored=stored, model=model,
        version=version, total=total, at=at,
    )
    return True


def move_copy(
    *, scholarship: str, year: str, student: str, stored: str, model: str, version: str,
    total: float, at: str,
) -> None:
    """Move the application's copy of its newest total too, if the copy is the row that moved.

    The badges and the state counts read the copy off the application item. A copy pointing at
    another set is someone else's newest total and is left alone.
    """
    unknown = model == UNKNOWN_MODEL
    condition = "rubric_version = :stored AND " + (
        "attribute_not_exists(model_id)" if unknown else "model_id = :model"
    )
    values: dict[str, Any] = {":total": total, ":version": version, ":at": at, ":stored": stored}
    if not unknown:
        values[":model"] = model

    try:
        table().update_item(
            Key={"pk": cohort_pk(scholarship, year), "sk": application_sk(student)},
            UpdateExpression=(
                "SET total_score = :total, rubric_version = :version, recomputed_at = :at"
            ),
            ConditionExpression=condition,
            ExpressionAttributeValues=to_dynamo(values),
        )
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
