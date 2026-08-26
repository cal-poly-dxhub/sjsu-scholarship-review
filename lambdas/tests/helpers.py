"""Building the items the tests work on, in the shapes the real writes produce."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from shared.table import (
    UNKNOWN_MODEL,
    cohort_pk,
    rank_pk,
    rubric_pk,
    rubric_sk,
    to_dynamo,
    total_sk,
)

SCHOLARSHIP = "sjsu-general"
YEAR = "2025-2026"


def stamp(minutes: int = 0) -> str:
    """A claim timestamp, in the format the workers write. Negative minutes is the past."""
    moment = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def put_application(table: Any, student: str, **fields: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "pk": cohort_pk(SCHOLARSHIP, YEAR),
        "sk": f"APP#{student}",
        "student_uuid": student,
        "scholarship": SCHOLARSHIP,
        "year": YEAR,
        "status": "parsed",
        "qa_pairs": [{"question": "Why SJSU?", "answer": "To finish what I started."}],
        **fields,
    }
    table.put_item(Item=to_dynamo(item))
    return item


def put_scored(
    table: Any,
    student: str,
    *,
    total: float,
    version: str,
    category_scores: dict[str, dict[str, float]] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """An application as a finished run leaves it: the item's copy, plus the set's own total row.

    `model` left out is a total scored before the model was recorded — the older items in a real
    table, and not the same thing as one scored on the default. Those belong to the unknown set.
    """
    scores = category_scores or {"grit": {"score": 1, "max": 2}}
    scored_at = "2026-08-01T00:00:00.000000Z"
    item = put_application(
        table,
        student,
        status="scored",
        total_score=total,
        rubric_version=version,
        **({"model_id": model} if model else {}),
        latest_scored_at=scored_at,
        category_scores=scores,
    )
    put_total(
        table,
        student,
        total=total,
        version=version,
        model=model or UNKNOWN_MODEL,
        category_scores=scores,
        scored_at=scored_at,
    )
    return item


def put_total(
    table: Any,
    student: str,
    *,
    total: float,
    version: str,
    model: str,
    category_scores: dict[str, dict[str, float]] | None = None,
    scored_at: str = "2026-08-01T00:00:00.000000Z",
) -> None:
    """One set's total for one application, ranking key included."""
    table.put_item(
        Item=to_dynamo(
            {
                "pk": cohort_pk(SCHOLARSHIP, YEAR),
                "sk": total_sk(version, model, student),
                "student_uuid": student,
                "rubric_version": version,
                "model_id": model,
                "total_score": total,
                "category_scores": category_scores or {"grit": {"score": 1, "max": 2}},
                "rank_pk": rank_pk(SCHOLARSHIP, YEAR, version, model),
                "scored_at": scored_at,
            }
        )
    )


def put_version(table: Any, version: str, criteria: list[dict[str, Any]], preamble: str = "") -> None:
    table.put_item(
        Item=to_dynamo(
            {
                "pk": rubric_pk(SCHOLARSHIP),
                "sk": rubric_sk(version),
                "criteria": criteria,
                "preamble": preamble,
                "source_file": "rubric.md",
                "published_at": "2026-08-01T00:00:00Z",
                "published_by": "a test",
            }
        )
    )


def read(table: Any, student: str) -> dict[str, Any]:
    return table.get_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": f"APP#{student}"}
    )["Item"]
