"""What every test needs: fake credentials, the environment the Lambdas read, and the table.

The modules under test read their environment at import time, so the variables are set here
before anything else imports them.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

os.environ.setdefault("AWS_DEFAULT_REGION", "us-west-2")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("TABLE_NAME", "test-scholarship")
os.environ.setdefault("BUCKET_NAME", "test-bucket")
os.environ.setdefault("MODEL_ID", "us.anthropic.claude-sonnet-4-6")
os.environ.setdefault("BATCH_ROLE_ARN", "arn:aws:iam::123456789012:role/test-bedrock-batch")
os.environ.setdefault("ONDEMAND_FUNCTION", "test-score-ondemand")
os.environ.setdefault("BATCH_FUNCTION", "test-score-batch")
os.environ.setdefault("RECOMPUTE_FUNCTION", "test-recompute")

import boto3  # noqa: E402  — after the fake credentials, or boto3 looks for real ones
import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

from shared import table as tbl  # noqa: E402
from shared.rubric import parse_rubric  # noqa: E402

# The rubric the real scholarship uses. Tests that check the parser read this file itself, so a
# change to it fails the test rather than passing against a copy.
RUBRIC_FILE = Path(__file__).resolve().parents[2] / "rubric.md"

RANK_INDEX = "rank-by-total"
GAP_INDEX = "gap-by-size"


@pytest.fixture(scope="session")
def _table_once() -> Any:
    """One moto session and one table for the whole run — building a table per test costs seconds."""
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName=os.environ["TABLE_NAME"],
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "rank_pk", "AttributeType": "S"},
                {"AttributeName": "total_score", "AttributeType": "N"},
                {"AttributeName": "gap_pk", "AttributeType": "S"},
                {"AttributeName": "score_gap", "AttributeType": "N"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": RANK_INDEX,
                    "KeySchema": [
                        {"AttributeName": "rank_pk", "KeyType": "HASH"},
                        {"AttributeName": "total_score", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": GAP_INDEX,
                    "KeySchema": [
                        {"AttributeName": "gap_pk", "KeyType": "HASH"},
                        {"AttributeName": "score_gap", "KeyType": "RANGE"},
                    ],
                    # The same narrow projection the CDK builds, so a field the queue asks for
                    # and the real index does not carry fails here too.
                    "Projection": {
                        "ProjectionType": "INCLUDE",
                        "NonKeyAttributes": [
                            "student_uuid",
                            "scholarship",
                            "year",
                            "total_score",
                            "reviewer_total",
                            "reviewer_count",
                            "reviewers_stored",
                            "rubric_version",
                            "academic_program",
                            "academic_level",
                            "major",
                            "gpa",
                        ],
                    },
                },
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        tbl._resource = None
        yield tbl.table()
        tbl._resource = None


@pytest.fixture
def table(_table_once: Any) -> Any:
    """The table, emptied, so one test cannot see another's items."""
    for item in _table_once.scan(ProjectionExpression="pk, sk").get("Items", []):
        _table_once.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})
    return _table_once


@pytest.fixture
def rubric_text() -> str:
    return RUBRIC_FILE.read_text(encoding="utf-8")


@pytest.fixture
def criteria(rubric_text: str) -> list[dict[str, Any]]:
    """The real rubric's five criteria with the published weights, shaped as the item stores them."""
    weights = {
        "extracurricular_activities": 10,
        "career_goals_essay": 40,
        "challenge_essay": 30,
        "initiative_self_motivation": 10,
        "creativity": 10,
    }
    return [as_stored(criterion, weights) for criterion in parse_rubric(rubric_text).criteria]


def as_stored(criterion: Any, weights: dict[str, float]) -> dict[str, Any]:
    """A parsed criterion in the shape the rubric item holds it."""
    return {
        "id": criterion.id,
        "name": criterion.name,
        "max": criterion.max,
        "weight": weights[criterion.id],
        "guidance": criterion.guidance,
        "levels": [
            {"value": level.value, "description": level.description} for level in criterion.levels
        ],
    }
