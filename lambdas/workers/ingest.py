"""Ingest worker: an uploaded export becomes application items in a cohort partition.

The export is a workbook or a CSV, read as rows by `shared.rows` — the same reader the
reviewer-score ingest uses, so neither format nor either kind of file can drift apart.

Every write is an `update_item`, never a `put_item`. A re-ingest of the same export has
to leave `category_scores`, `total_score`, and `rubric_version` where they are — a put
would drop them and the cohort would look unscored.

Scoring state is only reset when the application's own content changed, which is what
`content_hash` is for. The previous score item stays readable either way; what the reset
takes away is the application's place in the ranking, because a total made from different
essays is not comparable to the rest of the cohort.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Iterator

from shared.claims import PARSED
from shared.rows import RowsError, cell, number_or_none, read_rows
from shared.rubric import slug
from shared.table import (
    COHORTS_PK,
    YearFormat,
    application_sk,
    cohort_index_sk,
    cohort_pk,
    table,
    to_dynamo,
    year_in_filename,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

UPLOAD_PREFIX = os.environ.get("UPLOAD_PREFIX", "uploads/")

# The two ways the office exports the intake. Anything else under the prefix is somebody
# else's file, so it is left alone rather than failed.
SUFFIXES = (".xlsx", ".csv")

# The export's own column names. This is the shape of the file, not the shape of a rubric —
# no criterion, maximum, or weight is named here.
COLUMNS = {
    "Student": "student_uuid",
    "AvailabilityId_t": "availability",
    "PS_Academic Program": "academic_program",
    "PS_Major(s)": "major",
    "PS_Academic Level": "academic_level",
    "PS_Cumulative GPA": "gpa",
}

ESSAYS = [
    {
        "column": "FASO_General_Career Goals",
        "question_id": "career_goals",
        "question": "What are your career goals?",
    },
    {
        "column": "FASO_General_Challenge or Mistake",
        "question_id": "challenge_or_mistake",
        "question": "Describe a challenge or mistake and what you learned from it.",
    },
    {
        "column": "FASO_General_Extracurricular Activities",
        "question_id": "extracurricular_activities",
        "question": "Describe your extracurricular activities.",
    },
]

# Fields the ingest owns. Everything else on an application belongs to scoring or review.
OWNED = ("academic_program", "major", "academic_level", "gpa", "qa_pairs")


# The worker's own name for a file it cannot read. Same error the shared reader raises, so a
# caller catching either one catches both.
IngestError = RowsError


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Entry point for one EventBridge `Object Created` event from the environment bucket."""
    detail = event["detail"]
    bucket = detail["bucket"]["name"]
    key = detail["object"]["key"]

    if not key.startswith(UPLOAD_PREFIX) or not key.endswith(SUFFIXES):
        logger.info("Not an export under %s, left alone: %s", UPLOAD_PREFIX, key)
        return {"skipped": key}
    if key.endswith(".xlsx") and key.split("/")[-1].startswith("~$"):
        logger.info("Office lock file, left alone: %s", key)
        return {"skipped": key}

    return ingest_file(bucket, key)


def ingest_file(bucket: str, key: str) -> dict[str, Any]:
    """Read one export and write its applications. Returns what happened, row by row."""
    filename = key.split("/")[-1]
    year = year_from(filename)

    rows = read_rows(bucket, key, columns=COLUMNS, what="export")
    applications, skipped, duplicates, names = collect(rows, year=year, source_file=key)

    written = 0
    unchanged = 0
    rescore = 0
    for application in applications:
        outcome = store(application)
        if outcome == "unchanged":
            unchanged += 1
        else:
            written += 1
            if outcome == "changed":
                rescore += 1

    for scholarship, display_name in names.items():
        remember_cohort(scholarship, year, display_name)

    report = {
        "file": key,
        "year": year,
        "cohorts": sorted(names),
        "rows_read": len(applications) + len(skipped) + len(duplicates),
        "applications_written": written,
        "unchanged": unchanged,
        "marked_for_scoring_again": rescore,
        "skipped_rows": skipped,
        "duplicate_rows": duplicates,
    }
    logger.info("Ingested %s: %s", filename, json.dumps(report))
    return report


def year_from(filename: str) -> str:
    """The cohort's academic year, in the one form every read addresses it by."""
    try:
        return year_in_filename(filename)
    except YearFormat as error:
        raise IngestError(str(error)) from error


def collect(
    rows: Iterator[dict[str, Any]], *, year: str, source_file: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, str]]:
    """Turn rows into applications.

    The first of a duplicate pair is kept and both are named. The fourth return value maps each
    scholarship slug that produced an application to the name the export spelled it with, which
    is the only place that name survives — nothing derives it back from the slug.
    """
    applications: dict[tuple[str, str], dict[str, Any]] = {}
    skipped: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    names: dict[str, str] = {}

    for offset, row in enumerate(rows):
        number = offset + 2  # the header is row 1
        fields = {field: cell(row.get(column)) for column, field in COLUMNS.items()}

        student = fields.get("student_uuid")
        scholarship = slug(fields["availability"]) if fields.get("availability") else ""
        if not student or not scholarship:
            missing = "student id" if not student else "scholarship"
            skipped.append({"row": number, "reason": f"no {missing} in the row"})
            continue

        identity = (scholarship, student)
        if identity in applications:
            duplicates.append(
                {
                    "row": number,
                    "kept_row": applications[identity]["source"]["row_number"],
                    "student_uuid": student,
                    "scholarship": scholarship,
                    "reason": "another row in this file is the same student and scholarship",
                }
            )
            continue

        names[scholarship] = str(fields["availability"])
        applications[identity] = {
            "pk": cohort_pk(scholarship, year),
            "sk": application_sk(student),
            "scholarship": scholarship,
            "year": year,
            "student_uuid": student,
            "academic_program": fields.get("academic_program"),
            "major": fields.get("major"),
            "academic_level": fields.get("academic_level"),
            "gpa": number_or_none(fields.get("gpa")),
            "qa_pairs": qa_pairs(row),
            "source": {"file": source_file, "row_number": number},
        }

    return list(applications.values()), skipped, duplicates, names


def remember_cohort(scholarship: str, year: str, display_name: str) -> None:
    """Put this cohort in the partition a screen lists, so nobody has to guess its slug."""
    table().update_item(
        Key={"pk": COHORTS_PK, "sk": cohort_index_sk(scholarship, year)},
        UpdateExpression=(
            "SET scholarship = :scholarship, #year = :year, display_name = :name,"
            " last_ingest_at = :at"
        ),
        ExpressionAttributeNames={"#year": "year"},
        ExpressionAttributeValues={
            ":scholarship": scholarship,
            ":year": year,
            ":name": display_name,
            ":at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    )


def qa_pairs(row: dict[str, Any]) -> list[dict[str, str]]:
    """The essay answers present in this row. A blank essay is left out, not stored empty."""
    pairs = []
    for essay in ESSAYS:
        answer = cell(row.get(essay["column"]))
        if answer:
            pairs.append(
                {
                    "question_id": essay["question_id"],
                    "question": essay["question"],
                    "answer": answer,
                }
            )
    return pairs


def store(application: dict[str, Any]) -> str:
    """Write one application. Returns `new`, `changed`, or `unchanged`."""
    digest = content_hash(application)
    existing = table().get_item(
        Key={"pk": application["pk"], "sk": application["sk"]},
        ProjectionExpression="content_hash",
    ).get("Item")

    parsed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    values: dict[str, Any] = {
        ":at": parsed_at,
        ":source": application["source"],
    }

    if existing and existing.get("content_hash") == digest:
        # Nothing about the application moved, so nothing about its scoring may move either.
        table().update_item(
            Key={"pk": application["pk"], "sk": application["sk"]},
            UpdateExpression="SET parsed_at = :at, #source = :source",
            ExpressionAttributeNames={"#source": "source"},
            ExpressionAttributeValues=to_dynamo(values),
        )
        return "unchanged"

    sets = [
        "parsed_at = :at",
        "#source = :source",
        "content_hash = :hash",
        "scholarship = :scholarship",
        "#year = :year",
        "student_uuid = :student",
        "#status = :parsed",
        # A changed application is new work, so it gets its attempts back. Otherwise an
        # application that failed three times could never be scored again after a fix.
        "attempt = :zero",
    ]
    values.update(
        {
            ":hash": digest,
            ":scholarship": application["scholarship"],
            ":year": application["year"],
            ":student": application["student_uuid"],
            ":parsed": PARSED,
            ":zero": 0,
        }
    )
    for field in OWNED:
        sets.append(f"{field} = :{field}")
        values[f":{field}"] = application[field]

    table().update_item(
        Key={"pk": application["pk"], "sk": application["sk"]},
        # The score item stays readable. What goes is the ranking entry and the stored
        # version, so a total made from older text is not compared against the cohort — and
        # with them the gap, which was measured against that total. The reviewers' own scores
        # stay: a reviewer read the essays, and the essays are what changed.
        UpdateExpression=(
            "SET " + ", ".join(sets) + " REMOVE rank_pk, rubric_version, claimed_by,"
            " claimed_until, failure, last_error, score_gap, gap_pk, reviewer_total,"
            " reviewer_count"
        ),
        ExpressionAttributeNames={"#status": "status", "#year": "year", "#source": "source"},
        ExpressionAttributeValues=to_dynamo(values),
    )
    return "changed" if existing else "new"


def content_hash(application: dict[str, Any]) -> str:
    """A fingerprint of the applicant's own content — the fields a score is made from."""
    material = {field: application[field] for field in OWNED}
    return hashlib.sha256(
        json.dumps(material, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
