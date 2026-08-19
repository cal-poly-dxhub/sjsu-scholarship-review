"""Ingest worker: an uploaded workbook becomes application items in a cohort partition.

Every write is an `update_item`, never a `put_item`. A re-ingest of the same workbook has
to leave `category_scores`, `total_score`, and `rubric_version` where they are — a put
would drop them and the cohort would look unscored.

Scoring state is only reset when the application's own content changed, which is what
`content_hash` is for. The previous score item stays readable either way; what the reset
takes away is the application's place in the ranking, because a total made from different
essays is not comparable to the rest of the cohort.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Iterator

import boto3
import openpyxl

from shared.claims import PARSED
from shared.rubric import slug
from shared.table import application_sk, cohort_pk, table, to_dynamo

logger = logging.getLogger()
logger.setLevel(logging.INFO)

UPLOAD_PREFIX = os.environ.get("UPLOAD_PREFIX", "uploads/")

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

YEAR_LENGTH = 5  # "25-26"


class IngestError(Exception):
    """The file cannot be ingested at all. Nothing was written."""


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Entry point for one EventBridge `Object Created` event from the environment bucket."""
    detail = event["detail"]
    bucket = detail["bucket"]["name"]
    key = detail["object"]["key"]

    if not key.startswith(UPLOAD_PREFIX) or not key.endswith(".xlsx"):
        logger.info("Not a workbook under %s, left alone: %s", UPLOAD_PREFIX, key)
        return {"skipped": key}
    if key.split("/")[-1].startswith("~$"):
        logger.info("Office lock file, left alone: %s", key)
        return {"skipped": key}

    return ingest_file(bucket, key)


def ingest_file(bucket: str, key: str) -> dict[str, Any]:
    """Read one workbook and write its applications. Returns what happened, row by row."""
    filename = key.split("/")[-1]
    year = year_from(filename)

    rows = read_rows(bucket, key)
    applications, skipped, duplicates = collect(rows, year=year, source_file=key)

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

    report = {
        "file": key,
        "year": year,
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
    """The academic year out of the file name. A guessed year would build a wrong cohort."""
    for index in range(len(filename) - YEAR_LENGTH + 1):
        chunk = filename[index : index + YEAR_LENGTH]
        if chunk[:2].isdigit() and chunk[2] == "-" and chunk[3:].isdigit():
            return chunk
    raise IngestError(
        f"'{filename}' has no academic year in its name, so there is no cohort to write to."
        " Name the file with the year, as in 'SJSU General Scholarship 25-26.xlsx'."
    )


def read_rows(bucket: str, key: str) -> Iterator[dict[str, Any]]:
    """Rows as dicts keyed by the header line. Read-only so a large workbook stays cheap."""
    body = boto3.client("s3").get_object(Bucket=bucket, Key=key)["Body"].read()
    sheet = openpyxl.load_workbook(io.BytesIO(body), read_only=True, data_only=True).worksheets[0]

    raw = sheet.iter_rows(values_only=True)
    try:
        header = next(raw)
    except StopIteration:
        raise IngestError(f"'{key}' is empty — no header row.") from None

    names = [str(cell).strip() if cell is not None else "" for cell in header]
    if not any(column in names for column in COLUMNS):
        # Without this, a file whose first row is data reads as a file full of unusable rows and
        # the run reports a clean nothing.
        raise IngestError(
            f"'{key}' names none of the export's columns in its first row, so it has no header"
            " row to read the rest by."
        )

    for row in raw:
        yield {names[i]: row[i] for i in range(min(len(names), len(row)))}


def collect(
    rows: Iterator[dict[str, Any]], *, year: str, source_file: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Turn rows into applications. The first of a duplicate pair is kept and both are named."""
    applications: dict[tuple[str, str], dict[str, Any]] = {}
    skipped: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []

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

    return list(applications.values()), skipped, duplicates


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
        # version, so a total made from older text is not compared against the cohort.
        UpdateExpression=(
            "SET " + ", ".join(sets) + " REMOVE rank_pk, rubric_version, claimed_by,"
            " claimed_until, failure, last_error"
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


def cell(value: Any) -> str | None:
    """Cell text with the spreadsheet's artifacts taken off. Blank reads as nothing."""
    if value is None:
        return None
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    text = str(value).strip()
    return text or None


def number_or_none(text: str | None) -> float | None:
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None
