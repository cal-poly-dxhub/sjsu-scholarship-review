"""The one table, its keys, and the number conversions DynamoDB needs.

Every key in the system is built here, so a handler and a worker cannot disagree about
what a partition looks like.
"""

from __future__ import annotations

import os
import re
from decimal import Decimal
from typing import Any

import boto3

TABLE_NAME = os.environ["TABLE_NAME"]

# The ranking index. Named in the CDK as well; both have to say the same thing.
RANK_INDEX_NAME = "rank-by-total"

# The one form of an academic year, because the year is part of a key: a cohort typed '2026'
# and a cohort written '25-26' are two partitions, and one of them is always empty.
YEAR_FORM = "2025-2026"
CANON_YEAR = re.compile(r"^(\d{4})-(\d{4})$")

# The short form the office puts in a file name, as in 'SJSU General Scholarship 25-26.xlsx'.
SHORT_YEAR = re.compile(r"(?<!\d)(\d{2})-(\d{2})(?!\d)")

_resource = None


def table():
    """The environment's table. Built once per container."""
    global _resource
    if _resource is None:
        _resource = boto3.resource("dynamodb")
    return _resource.Table(TABLE_NAME)


class YearFormat(ValueError):
    """The academic year is not the one form. Told to the caller rather than keyed on."""


def cohort_pk(scholarship: str, year: str) -> str:
    return f"COHORT#{scholarship}#{year}"


# One partition listing every cohort that exists. A cohort's own key is built from a slug nobody
# can guess — 'SJSU General Scholarships' is stored as 'sjsu_general_scholarships' — and a wrong
# guess reads as an empty cohort rather than a mistake. This is how a screen offers the real ones.
COHORTS_PK = "COHORTS"


def cohort_index_sk(scholarship: str, year: str) -> str:
    return f"{scholarship}#{year}"


def checked_year(value: str) -> str:
    """The year as written, if it is the one form. Two consecutive four-digit years."""
    found = CANON_YEAR.fullmatch(value.strip())
    if found:
        start, end = int(found.group(1)), int(found.group(2))
        if end == start + 1:
            return f"{start}-{end}"
    raise YearFormat(
        f"'{value}' is not an academic year. One form is read: two years running, as in"
        f" {YEAR_FORM}."
    )


def expand_year(short: str) -> str:
    """`25-26` as `2025-2026`. Both halves are this century — the intake has no other."""
    found = SHORT_YEAR.fullmatch(short.strip())
    if not found:
        raise YearFormat(f"'{short}' is not a short academic year, as in 25-26.")
    return checked_year(f"20{found.group(1)}-20{found.group(2)}")


def year_in_filename(filename: str) -> str:
    """The academic year out of a file name. A guessed year would build a wrong cohort."""
    full = re.search(r"(?<!\d)(\d{4}-\d{4})(?!\d)", filename)
    if full:
        return checked_year(full.group(1))
    short = SHORT_YEAR.search(filename)
    if short:
        return expand_year(short.group(0))
    raise YearFormat(
        f"'{filename}' has no academic year in its name, so there is no cohort to write to."
        " Name the file with the year, as in 'SJSU General Scholarship 25-26.xlsx'."
    )


def application_sk(student_uuid: str) -> str:
    return f"APP#{student_uuid}"


def application_pk(scholarship: str, year: str, student_uuid: str) -> str:
    return f"APP#{scholarship}#{year}#{student_uuid}"


def score_sk(timestamp: str) -> str:
    return f"SCORE#{timestamp}"


def rubric_pk(scholarship: str) -> str:
    return f"RUBRIC#{scholarship}"


def rubric_sk(version: str) -> str:
    return f"V#{version}"


def rank_pk(scholarship: str, year: str, rubric_version: str) -> str:
    return f"RANK#{scholarship}#{year}#{rubric_version}"


def to_dynamo(value: Any) -> Any:
    """Floats become Decimal, because DynamoDB refuses floats."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: to_dynamo(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_dynamo(item) for item in value]
    return value


def from_dynamo(value: Any) -> Any:
    """Decimal becomes int or float, so a handler can hand the item to json.dumps."""
    if isinstance(value, Decimal):
        as_int = int(value)
        return as_int if value == as_int else float(value)
    if isinstance(value, dict):
        return {key: from_dynamo(item) for key, item in value.items()}
    if isinstance(value, list):
        return [from_dynamo(item) for item in value]
    return value
