"""Building the items the tests work on, in the shapes the real writes produce."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from shared.table import cohort_pk, rank_pk, rubric_pk, rubric_sk, to_dynamo

SCHOLARSHIP = "sjsu-general"
YEAR = "2025-2026"

# A stand-in for a published rubric file, small enough to read in a failure message. The closing
# banner and the trailing text on each category line are the parts the old assembled prompt lost,
# so they are here for the tests that check the file arrives whole.
RUBRIC_FILE = """\
================================
Score the whole application.
================================

Category: Grit (0-2) — half points allowed (e.g., 0.5)
- 2 = kept going
- 0 = gave up

Category: Clarity (0-5) — half points allowed (e.g., 0.5)
- 5 = plain
- 0 = muddled
"""


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
) -> dict[str, Any]:
    """An application as a finished run leaves it, ranking key included."""
    return put_application(
        table,
        student,
        status="scored",
        total_score=total,
        rubric_version=version,
        rank_pk=rank_pk(SCHOLARSHIP, YEAR, version),
        latest_scored_at="2026-08-01T00:00:00.000000Z",
        category_scores=category_scores or {"grit": {"score": 1, "max": 2}},
    )


def put_version(
    table: Any,
    version: str,
    criteria: list[dict[str, Any]],
    preamble: str = "",
    source_text: str = RUBRIC_FILE,
) -> None:
    table.put_item(
        Item=to_dynamo(
            {
                "pk": rubric_pk(SCHOLARSHIP),
                "sk": rubric_sk(version),
                "criteria": criteria,
                "preamble": preamble,
                "source_text": source_text,
                # Publishing refuses a name a version already used, so seeded versions get their own.
                "source_file": f"rubric-{version}.md",
                "published_at": "2026-08-01T00:00:00Z",
                "published_by": "a test",
            }
        )
    )


def read(table: Any, student: str) -> dict[str, Any]:
    return table.get_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": f"APP#{student}"}
    )["Item"]
