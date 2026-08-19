"""Reading a workbook, on a few rows of one.

Two things here destroy work rather than fail: a re-ingest that drops the scores already on an
application, and a year read wrong, which files a whole intake under the wrong cohort.
"""

from __future__ import annotations

import io
from typing import Any

import boto3
import openpyxl
import pytest

from shared.table import cohort_pk
from workers import ingest

BUCKET = "an-ingest-bucket"
FILENAME = "SJSU General Scholarship 25-26.xlsx"
KEY = f"uploads/{FILENAME}"
AVAILABILITY = "SJSU General Scholarship"
SCHOLARSHIP = "sjsu_general_scholarship"
YEAR = "25-26"

HEADER = [
    "Student",
    "AvailabilityId_t",
    "PS_Academic Program",
    "PS_Major(s)",
    "PS_Academic Level",
    "PS_Cumulative GPA",
    "FASO_General_Career Goals",
    "FASO_General_Challenge or Mistake",
    "FASO_General_Extracurricular Activities",
]

ROW = [
    "u-one",
    AVAILABILITY,
    "Computer Science BS",
    "Computer Science",
    "Senior",
    3.75,
    "I want to build things people rely on.",
    "I failed a class and learned to ask for help.",
    None,
]


@pytest.fixture
def bucket() -> Any:
    s3 = boto3.client("s3")
    try:
        s3.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "us-west-2"}
        )
    except s3.exceptions.BucketAlreadyOwnedByYou:
        pass
    yield s3
    for entry in s3.list_objects_v2(Bucket=BUCKET).get("Contents", []):
        s3.delete_object(Bucket=BUCKET, Key=entry["Key"])


def workbook(rows: list[list[Any]]) -> bytes:
    book = openpyxl.Workbook()
    for row in rows:
        book.worksheets[0].append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def upload(s3: Any, rows: list[list[Any]], key: str = KEY) -> str:
    s3.put_object(Bucket=BUCKET, Key=key, Body=workbook(rows))
    return key


def run(s3: Any, rows: list[list[Any]], key: str = KEY) -> dict[str, Any]:
    return ingest.handler(
        {"detail": {"bucket": {"name": BUCKET}, "object": {"key": upload(s3, rows, key)}}}, None
    )


def application(table: Any, student: str) -> dict[str, Any]:
    return table.get_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": f"APP#{student}"}
    )["Item"]


def test_a_row_becomes_the_fields_the_rest_of_the_system_reads(table: Any, bucket: Any) -> None:
    report = run(bucket, [HEADER, ROW])

    assert (report["year"], report["applications_written"]) == (YEAR, 1)

    stored = application(table, "u-one")
    assert stored["scholarship"] == SCHOLARSHIP
    assert stored["academic_level"] == "Senior"
    assert float(stored["gpa"]) == 3.75
    assert stored["status"] == "parsed"
    assert stored["attempt"] == 0
    # A blank essay is left out rather than stored empty, so the model is not asked to score air.
    assert [pair["question_id"] for pair in stored["qa_pairs"]] == [
        "career_goals",
        "challenge_or_mistake",
    ]
    assert stored["qa_pairs"][0]["answer"] == "I want to build things people rely on."


def test_a_re_ingest_leaves_the_scores_where_they_are(table: Any, bucket: Any) -> None:
    """A put would wipe these and the whole cohort would read as unscored."""
    run(bucket, [HEADER, ROW])
    table.update_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": "APP#u-one"},
        UpdateExpression=(
            "SET total_score = :total, rubric_version = :version, category_scores = :scores,"
            " #status = :scored"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":total": 80,
            ":version": "v1",
            ":scores": {"grit": {"score": 1, "max": 2}},
            ":scored": "scored",
        },
    )

    report = run(bucket, [HEADER, ROW])

    assert (report["unchanged"], report["marked_for_scoring_again"]) == (1, 0)
    stored = application(table, "u-one")
    assert float(stored["total_score"]) == 80
    assert stored["rubric_version"] == "v1"
    assert stored["category_scores"] == {"grit": {"score": 1, "max": 2}}
    assert stored["status"] == "scored"


def test_two_rows_for_the_same_student_are_reported_not_quietly_merged(
    table: Any, bucket: Any
) -> None:
    second = ["u-one", AVAILABILITY, "Art BA", "Art", "Junior", 3.0, "Different goals.", None, None]

    report = run(bucket, [HEADER, ROW, second])

    assert report["applications_written"] == 1
    assert report["duplicate_rows"] == [
        {
            "row": 3,
            "kept_row": 2,
            "student_uuid": "u-one",
            "scholarship": SCHOLARSHIP,
            "reason": "another row in this file is the same student and scholarship",
        }
    ]
    # The first row is the one kept, and the second did not overwrite it.
    assert application(table, "u-one")["academic_level"] == "Senior"


def test_a_filename_with_no_year_is_refused_with_the_file_named(table: Any, bucket: Any) -> None:
    with pytest.raises(ingest.IngestError) as raised:
        run(bucket, [HEADER, ROW], key="uploads/General Scholarship.xlsx")

    assert "General Scholarship.xlsx" in str(raised.value)


def test_an_empty_file_or_one_with_no_header_row_is_refused(table: Any, bucket: Any) -> None:
    """Read as nothing, either one looks like a clean run over an empty intake."""
    with pytest.raises(ingest.IngestError) as empty:
        run(bucket, [])
    assert "empty" in str(empty.value)

    with pytest.raises(ingest.IngestError) as headerless:
        run(bucket, [ROW, ROW])
    assert "no header row" in str(headerless.value)
