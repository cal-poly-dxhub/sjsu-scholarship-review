"""Claiming an application before scoring it, and letting it go afterwards.

A claim is a conditional write, so two workers reaching for the same item cannot both get
it. The attempt count goes up when the claim is taken, not when it is released: a worker
that dies holding a claim still leaves the count raised.

The expiry only guards the on-demand path. A batch job is given 36 hours, so the batch
claim's expiry sits past that and what actually frees a batch item is its job reaching a
state it cannot leave.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from botocore.exceptions import ClientError

from .table import table

# An on-demand claim outlives the Lambda that took it by a little, so a container that dies
# is reclaimable on the next run rather than in fifteen days.
ONDEMAND_CLAIM = timedelta(minutes=20)

# Past the 36 hours a batch job is given, so a clock never frees an item a live job holds.
BATCH_CLAIM = timedelta(hours=48)

# Attempts stop here. An item at the limit is not picked up again by any run.
ATTEMPT_LIMIT = 3

PROCESSING = "processing"
PARSED = "parsed"
SCORED = "scored"
FAILED = "score_failed"

CLAIMABLE = (
    "(attribute_not_exists(#status) OR #status <> :processing OR claimed_until < :now)"
    " AND (attribute_not_exists(rubric_version) OR rubric_version <> :version)"
    " AND (attribute_not_exists(attempt) OR attempt < :limit)"
)


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def claim(
    *,
    pk: str,
    sk: str,
    claimed_by: str,
    rubric_version: str,
    holds: timedelta = ONDEMAND_CLAIM,
) -> bool:
    """Take an item for this run. False means someone else has it, or it is out of attempts."""
    moment = datetime.now(timezone.utc)
    try:
        table().update_item(
            Key={"pk": pk, "sk": sk},
            UpdateExpression=(
                "SET #status = :processing, claimed_by = :who, claimed_until = :until,"
                " attempt = if_not_exists(attempt, :zero) + :one"
            ),
            ConditionExpression=CLAIMABLE,
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":processing": PROCESSING,
                ":who": claimed_by,
                ":until": (moment + holds).strftime("%Y-%m-%dT%H:%M:%SZ"),
                ":now": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
                ":version": rubric_version,
                ":limit": ATTEMPT_LIMIT,
                ":zero": 0,
                ":one": 1,
            },
        )
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def release(*, pk: str, sk: str, claimed_by: str, reason: str) -> bool:
    """Give an item back unscored. The attempt count already went up when it was claimed."""
    return _let_go(
        pk=pk,
        sk=sk,
        claimed_by=claimed_by,
        update=(
            "SET #status = :parsed, last_error = :reason"
            " REMOVE claimed_by, claimed_until"
        ),
        values={":parsed": PARSED, ":reason": reason},
    )


def mark_failed(*, pk: str, sk: str, claimed_by: str, reason: str) -> bool:
    """Fail an item and clear what a score would have said, so nothing shows a stale score.

    The gap goes with the total. A gap measured against a total that no longer exists would keep
    the application in the review queue with nothing on the other side of the comparison. The
    reviewers' own scores stay where they are — `reviewers_stored` still says they are there.
    """
    return _let_go(
        pk=pk,
        sk=sk,
        claimed_by=claimed_by,
        update=(
            "SET #status = :failed, failure = :reason"
            " REMOVE claimed_by, claimed_until, category_scores, total_score, rubric_version,"
            " rank_pk, latest_scored_at, score_gap, gap_pk, reviewer_total, reviewer_count"
        ),
        values={":failed": FAILED, ":reason": reason},
    )


def _let_go(*, pk: str, sk: str, claimed_by: str, update: str, values: dict[str, Any]) -> bool:
    """Only the holder of a claim writes its ending, so a late worker cannot undo a newer run."""
    try:
        table().update_item(
            Key={"pk": pk, "sk": sk},
            UpdateExpression=update,
            ConditionExpression="claimed_by = :who",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={**values, ":who": claimed_by},
        )
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise
