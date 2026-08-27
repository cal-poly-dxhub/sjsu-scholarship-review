"""Reading an export, on a few rows of one, as a workbook and as a CSV.

Two things here destroy work rather than fail: a re-ingest that drops the scores already on an
application, and a year read wrong, which files a whole intake under the wrong cohort.

The CSV fixture is cut from the real export rather than invented, so it cannot drift from what
the office sends. Its rows are synthetic — the real file is 1,903 applicants' essays and is not
committed — but the header and the three traits that break a reader are the real ones.
"""

from __future__ import annotations

import csv
import io
from typing import Any

import boto3
import openpyxl
import pytest
from boto3.dynamodb.conditions import Key

from shared.table import (
    COHORTS_PK,
    YearFormat,
    checked_year,
    cohort_pk,
    year_in_filename,
)
from workers import ingest

BUCKET = "an-ingest-bucket"
FILENAME = "SJSU General Scholarship 25-26.xlsx"
KEY = f"uploads/{FILENAME}"
AVAILABILITY = "SJSU General Scholarship"
SCHOLARSHIP = "sjsu_general_scholarship"
YEAR = "2025-2026"  # the file name says 25-26; the cohort key spells it out

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

# The real export's file name and header, kept exactly — including the parentheses the report
# tool writes and a column order that is not the workbook's, because rows are keyed by name.
CSV_KEY = (
    "uploads/SJSU General Scholarship 25-26 ad hoc report(ScholarshipManagerData (22)).csv"
)
CSV_HEADER = [
    "AvailabilityId_t",
    "Student",
    "FASO_General_Challenge or Mistake",
    "FASO_General_Career Goals",
    "PS_Academic Program",
    "FASO_General_Extracurricular Activities",
    "PS_Major(s)",
    "PS_Academic Level",
    "PS_Cumulative GPA",
]

# The three traits off the real file, each of which breaks a reader on its own: a curly
# apostrophe written as cp1252 rather than UTF-8, an essay with line breaks inside its quotes,
# and a comma inside a field.
CURLY = "’"
MULTILINE = f"First I didn{CURLY}t ask for help.\n\nThen I did, and it went better."
MAJOR_WITH_COMMA = "Computer Science, Applied Mathematics"
ACTIVITIES = "Marching band, robotics club, a job."

CSV_ROW = [
    AVAILABILITY,
    "u-one",
    MULTILINE,
    "I want to build things people rely on.",
    "Computer Science BS",
    ACTIVITIES,
    MAJOR_WITH_COMMA,
    "Senior",
    "3.75",
]

# The same intake as CSV_ROW, in the workbook's column order. The two are compared, so a change
# to one has to be made to the other.
SAME_ROW_AS_A_WORKBOOK = [
    "u-one",
    AVAILABILITY,
    "Computer Science BS",
    MAJOR_WITH_COMMA,
    "Senior",
    3.75,
    "I want to build things people rely on.",
    MULTILINE,
    ACTIVITIES,
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


def csv_bytes(rows: list[list[str]], encoding: str = "cp1252", bom: bytes = b"") -> bytes:
    """The rows as a real CSV — `csv.writer` does the quoting, so the fixture cannot be malformed."""
    buffer = io.StringIO(newline="")
    csv.writer(buffer).writerows(rows)
    return bom + buffer.getvalue().encode(encoding)


def run_csv(s3: Any, body: bytes, key: str = CSV_KEY) -> dict[str, Any]:
    s3.put_object(Bucket=BUCKET, Key=key, Body=body)
    return ingest.handler({"detail": {"bucket": {"name": BUCKET}, "object": {"key": key}}}, None)


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


@pytest.mark.parametrize(
    "filename, expected",
    [
        ("SJSU General Scholarship 25-26.xlsx", "2025-2026"),
        # The report tool's own name, brackets and all.
        ("SJSU General 25-26 ad hoc report(ScholarshipManagerData (22)).csv", "2025-2026"),
        # Already spelled out. Read as it stands rather than scanned for a short year, which is
        # what turned '2025-2026' into the cohort '25-20'.
        ("SJSU General Scholarship 2025-2026.xlsx", "2025-2026"),
    ],
)
def test_the_year_in_a_name_becomes_the_one_cohort_form(filename: str, expected: str) -> None:
    assert year_in_filename(filename) == expected


@pytest.mark.parametrize("year", ["2026", "2025-2027", "25-26", "2025/2026", ""])
def test_a_year_that_is_not_two_years_running_is_refused(year: str) -> None:
    """The year is part of a key, so a second form would be a second, empty cohort."""
    with pytest.raises(YearFormat):
        checked_year(year)


def test_an_empty_file_or_one_with_no_header_row_is_refused(table: Any, bucket: Any) -> None:
    """Read as nothing, either one looks like a clean run over an empty intake."""
    with pytest.raises(ingest.IngestError) as empty:
        run(bucket, [])
    assert "empty" in str(empty.value)

    with pytest.raises(ingest.IngestError) as headerless:
        run(bucket, [ROW, ROW])
    assert "no header row" in str(headerless.value)


def test_a_csv_and_a_workbook_of_the_same_intake_give_the_same_application(
    table: Any, bucket: Any
) -> None:
    """The whole claim of two formats: either one produces the same item, or scores are not
    comparable across intakes read different ways."""
    first = run_csv(bucket, csv_bytes([CSV_HEADER, CSV_ROW]))
    assert (first["year"], first["applications_written"]) == (YEAR, 1)

    again = run(bucket, [HEADER, SAME_ROW_AS_A_WORKBOOK])

    # `unchanged` is the content hash matching, so every field a score is made from — the three
    # essays, the major, the level, the GPA — came through both formats identically.
    assert (again["unchanged"], again["marked_for_scoring_again"]) == (1, 0)


def test_a_csv_keeps_a_cp1252_apostrophe_a_line_break_and_a_comma(table: Any, bucket: Any) -> None:
    """Each of these fails differently: the encoding kills the whole file, a line break splits one
    applicant into fragments, and a comma splits one field into two."""
    body = csv_bytes([CSV_HEADER, CSV_ROW])
    assert b"\x92" in body, "the fixture has to be cp1252, or it proves nothing about decoding"

    report = run_csv(bucket, body)

    assert report["applications_written"] == 1
    stored = application(table, "u-one")
    answers = {pair["question_id"]: pair["answer"] for pair in stored["qa_pairs"]}
    assert answers["challenge_or_mistake"] == MULTILINE
    assert stored["major"] == MAJOR_WITH_COMMA


def test_a_csv_header_behind_a_byte_order_mark_is_still_read(table: Any, bucket: Any) -> None:
    """A spreadsheet program saving UTF-8 writes one, and left on it the first column name matches
    nothing and the file is refused for having no header row."""
    report = run_csv(bucket, csv_bytes([CSV_HEADER, CSV_ROW], encoding="utf-8", bom=b"\xef\xbb\xbf"))

    assert report["applications_written"] == 1


def test_a_file_ingest_does_not_read_is_left_alone(table: Any, bucket: Any) -> None:
    """Every object landing under the prefix reaches the worker, so a stray file has to be skipped
    rather than raise — including the lock file Office leaves beside an open workbook."""
    for key in ("uploads/notes.pdf", "uploads/~$SJSU General Scholarship 25-26.xlsx"):
        bucket.put_object(Bucket=BUCKET, Key=key, Body=b"not an export")

        assert ingest.handler(
            {"detail": {"bucket": {"name": BUCKET}, "object": {"key": key}}}, None
        ) == {"skipped": key}


def test_every_scholarship_in_an_export_is_listed_under_its_own_name(
    table: Any, bucket: Any
) -> None:
    """The registry is the only way a cohort can be found: the slug is built from the export's
    wording, so a guess reads as an empty cohort with nothing to say it was a guess. One export can
    hold more than one scholarship, and the name it spelled survives nowhere else."""
    other = "Presidential Scholars Award"
    second = [*ROW]
    second[0], second[1] = "u-two", other

    run(bucket, [HEADER, ROW, second])

    listed = table.query(
        KeyConditionExpression=Key("pk").eq(COHORTS_PK),
    )["Items"]
    assert {(item["sk"], item["display_name"]) for item in listed} == {
        (f"{SCHOLARSHIP}#{YEAR}", AVAILABILITY),
        (f"presidential_scholars_award#{YEAR}", other),
    }

    first_stamp = next(item["last_ingest_at"] for item in listed if item["display_name"] == other)
    again = run(bucket, [HEADER, ROW, second])

    assert again["cohorts"] == ["presidential_scholars_award", SCHOLARSHIP]
    # A re-ingest is the same two cohorts, not four rows in the partition.
    repeated = table.query(KeyConditionExpression=Key("pk").eq(COHORTS_PK))["Items"]
    assert len(repeated) == 2
    assert all(item["last_ingest_at"] >= first_stamp for item in repeated)
