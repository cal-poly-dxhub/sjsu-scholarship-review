"""Writing a score: the immutable score item, then the application's copy of the numbers.

The score item is the record of one attempt and is never overwritten. The application's copy
is what a cohort read and a ranking use, which is why `rank_pk` is written with the total and
removed when a failure takes the total away.

A new total also changes how far the model is from the reviewers, so the gap is settled here
rather than left for the next reviewer upload — the reviewers' marks may already be stored.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError

from .claims import SCORED
from .gaps import settle_gap
from .reply import CheckedReply, weighted_total
from .table import application_pk, cohort_of, rank_pk, score_sk, table, to_dynamo


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

    try:
        table().update_item(
            Key={"pk": application["pk"], "sk": application["sk"]},
            UpdateExpression=(
                "SET #status = :scored, category_scores = :scores, total_score = :total,"
                " rubric_version = :version, rank_pk = :rank, latest_scored_at = :at"
                " REMOVE claimed_by, claimed_until, failure, last_error"
            ),
            # Only the run holding the claim writes the result, so a job collected late cannot
            # overwrite a newer run's score.
            ConditionExpression="claimed_by = :who",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=to_dynamo(
                {
                    ":scored": SCORED,
                    ":scores": {
                        score.criterion_id: {"score": score.score, "max": score.max}
                        for score in reply.scores
                    },
                    ":total": total,
                    ":version": rubric_version,
                    ":rank": rank_pk(scholarship, year, rubric_version),
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

    # Only after the total is applied: the gap is measured against this total, and a score that
    # lost its claim did not become the application's total.
    settle_gap(application, total_score=total, rubric_version=rubric_version)
    return total


class StaleClaim(Exception):
    """The claim moved on before the result was written. The attempt is kept, not applied."""
