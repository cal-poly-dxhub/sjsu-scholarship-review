"""The one table, its keys, and the number conversions DynamoDB needs.

Every key in the system is built here, so a handler and a worker cannot disagree about
what a partition looks like.
"""

from __future__ import annotations

import os
from decimal import Decimal
from typing import Any

import boto3

TABLE_NAME = os.environ["TABLE_NAME"]

# The ranking index. Named in the CDK as well; both have to say the same thing.
RANK_INDEX_NAME = "rank-by-total"

_resource = None


def table():
    """The environment's table. Built once per container."""
    global _resource
    if _resource is None:
        _resource = boto3.resource("dynamodb")
    return _resource.Table(TABLE_NAME)


def cohort_pk(scholarship: str, year: str) -> str:
    return f"COHORT#{scholarship}#{year}"


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
