"""Writing a score: the immutable score item, the total's own row, then the application's copy.

Three writes, in that order. The score item is the record of one attempt and is never
overwritten. The total row is the comparable number, keyed by rubric version and model, so a run
on a second model adds a row beside the first instead of replacing it — and `rank_pk` lives there,
because a ranking is one version and one model. The application's copy is the newest total, which
is what the state badges and the state counts read.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError

from .claims import SCORED
from .reply import CheckedReply, weighted_total
from .table import (
    application_pk,
    cohort_pk,
    rank_pk,
    score_sk,
    table,
    to_dynamo,
    total_sk,
)


def cohort_of(application: dict[str, Any]) -> tuple[str, str, str]:
    """Scholarship, year, and student uuid, read back out of the item's own keys."""
    _, scholarship, year = application["pk"].split("#", 2)
    student = application["sk"].removeprefix("APP#")
    return scholarship, year, student


def write_score(
    *,
    application: dict[str, Any],
    reply: CheckedReply,
    criteria: list[dict[str, Any]],
    rubric_version: str,
    model_id: str,
    worker: str,
    input_tokens: int,
    output_tokens: int,
    claimed_by: str,
) -> float:
    """Store one successful attempt and move the application to `scored`. Returns the total."""
    scholarship, year, student = cohort_of(application)
    total = weighted_total(reply.scores, criteria)
    scored_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    table().put_item(
        Item=to_dynamo(
            {
                "pk": application_pk(scholarship, year, student),
                "sk": score_sk(scored_at),
                "category_scores": {
                    score.criterion_id: {
                        "score": score.score,
                        "max": score.max,
                        "reasoning": score.reasoning,
                        "evidence": score.evidence,
                    }
                    for score in reply.scores
                },
                "total_score": total,
                "reasoning_summary": reply.reasoning_summary,
                "rubric_version": rubric_version,
                "model_id": model_id,
                "worker": worker,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "status": "ok",
            }
        )
    )

    scores = {
        score.criterion_id: {"score": score.score, "max": score.max} for score in reply.scores
    }

    try:
        table().update_item(
            Key={"pk": application["pk"], "sk": application["sk"]},
            UpdateExpression=(
                "SET #status = :scored, category_scores = :scores, total_score = :total,"
                " rubric_version = :version, model_id = :model, latest_scored_at = :at"
                " REMOVE claimed_by, claimed_until, failure, last_error"
            ),
            # Only the run holding the claim writes the result, so a job collected late cannot
            # overwrite a newer run's score.
            ConditionExpression="claimed_by = :who",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=to_dynamo(
                {
                    ":scored": SCORED,
                    ":scores": scores,
                    ":total": total,
                    ":version": rubric_version,
                    ":model": model_id,
                    ":at": scored_at,
                    ":who": claimed_by,
                }
            ),
        )
    except ClientError as error:
        if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # The score item stays: it is the record that this attempt happened, and the newer
        # run's own write is the one the screens read.
        raise StaleClaim(
            f"{application['sk']} is no longer claimed by {claimed_by} — its score was not applied"
        ) from error

    # After the claim check, not before: only the run that still holds the item writes a number
    # anyone ranks. A stale run leaves its score item and nothing comparable.
    write_total(
        scholarship=scholarship,
        year=year,
        student=student,
        rubric_version=rubric_version,
        model_id=model_id,
        total=total,
        category_scores=scores,
        scored_at=scored_at,
    )
    return total


def write_total(
    *,
    scholarship: str,
    year: str,
    student: str,
    rubric_version: str,
    model_id: str,
    total: float,
    category_scores: dict[str, dict[str, float]],
    scored_at: str,
) -> None:
    """The comparable number for one application in one set. Replaces only that set's own row."""
    table().put_item(
        Item=to_dynamo(
            {
                "pk": cohort_pk(scholarship, year),
                "sk": total_sk(rubric_version, model_id, student),
                "student_uuid": student,
                "rubric_version": rubric_version,
                "model_id": model_id,
                "total_score": total,
                "category_scores": category_scores,
                "rank_pk": rank_pk(scholarship, year, rubric_version, model_id),
                "scored_at": scored_at,
            }
        )
    )


class StaleClaim(Exception):
    """The claim moved on before the result was written. The attempt is kept, not applied."""
