"""Storing a score, failing one, and what either does to a set's totals and the ranking index."""

from __future__ import annotations

from typing import Any

import pytest
from boto3.dynamodb.conditions import Key

from shared.claims import claim, mark_failed, release
from shared.reads import ranked
from shared.reply import CriterionScore
from shared.scores import StaleClaim, write_score
from shared.table import cohort_pk, rank_pk, score_sk, total_sk
from helpers import SCHOLARSHIP, YEAR, put_application, put_scored, read, stamp

SONNET = "us.anthropic.claude-sonnet-4-6"
OPUS = "us.anthropic.claude-opus-4-6-v1"

CRITERIA = [
    {"id": "grit", "name": "Grit", "max": 2, "weight": 40},
    {"id": "clarity", "name": "Clarity", "max": 5, "weight": 60},
]


class Reply:
    """A checked reply, as `check_reply` would have returned it."""

    def __init__(self) -> None:
        self.scores = [
            CriterionScore("grit", 1, 2, "half of it", "their words"),
            CriterionScore("clarity", 5, 5, "clear throughout", "their words"),
        ]
        self.reasoning_summary = "Strong on clarity."


def store(
    table: Any,
    student: str,
    *,
    claimed_by: str = "run-one",
    version: str = "v1",
    model: str = SONNET,
) -> float:
    return write_score(
        application=read(table, student),
        reply=Reply(),
        criteria=CRITERIA,
        rubric_version=version,
        model_id=model,
        worker="a-test",
        input_tokens=10,
        output_tokens=20,
        claimed_by=claimed_by,
    )


def total_row(table: Any, student: str, version: str, model: str) -> dict[str, Any] | None:
    return table.get_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": total_sk(version, model, student)}
    ).get("Item")


def test_the_score_item_the_total_and_the_application_are_all_written(table: Any) -> None:
    put_application(table, "one", status="processing", claimed_by="run-one", claimed_until=stamp(10))

    total = store(table, "one")
    assert total == 80  # 1/2×40 + 5/5×60

    application = read(table, "one")
    assert application["status"] == "scored"
    assert float(application["total_score"]) == 80
    assert application["rubric_version"] == "v1"
    # The ranking key belongs to the total's own row now, not to the application.
    assert "rank_pk" not in application
    # The application's copy carries the numbers a list shows and none of the reasoning.
    assert application["category_scores"]["grit"] == {"score": 1, "max": 2}
    assert "reasoning" not in application["category_scores"]["grit"]

    row = total_row(table, "one", "v1", SONNET)
    assert row is not None
    assert float(row["total_score"]) == 80
    assert row["model_id"] == SONNET
    assert row["student_uuid"] == "one"
    assert row["rank_pk"] == rank_pk(SCHOLARSHIP, YEAR, "v1", SONNET)

    scores = table.query(
        KeyConditionExpression=Key("pk").eq(f"APP#{SCHOLARSHIP}#{YEAR}#one")
        & Key("sk").begins_with("SCORE#")
    )["Items"]
    assert len(scores) == 1
    assert scores[0]["sk"] == score_sk(application["latest_scored_at"])
    assert scores[0]["category_scores"]["grit"]["reasoning"] == "half of it"
    assert scores[0]["model_id"] == SONNET


def test_two_models_at_one_version_leave_two_totals_neither_touching_the_other(table: Any) -> None:
    """The comparison the picker exists for. One overwritten attribute would have lost it."""
    put_scored(table, "both", total=55, version="v1", model=OPUS)
    table.update_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": "APP#both"},
        UpdateExpression="SET claimed_by = :who",
        ExpressionAttributeValues={":who": "run-one"},
    )

    assert store(table, "both", version="v1", model=SONNET) == 80

    opus = total_row(table, "both", "v1", OPUS)
    sonnet = total_row(table, "both", "v1", SONNET)
    assert opus is not None and sonnet is not None
    assert float(opus["total_score"]) == 55
    assert float(sonnet["total_score"]) == 80
    # The application's copy is the newest of the two, and says which model made it.
    assert read(table, "both")["model_id"] == SONNET


def test_a_claim_that_moved_on_keeps_the_attempt_but_does_not_apply_it(table: Any) -> None:
    """The score item is history. Applying it would overwrite a newer run's number."""
    put_application(table, "moved", status="processing", claimed_by="run-two", claimed_until=stamp(10))

    with pytest.raises(StaleClaim):
        store(table, "moved", claimed_by="run-one")

    application = read(table, "moved")
    assert application["status"] == "processing"
    assert "total_score" not in application
    assert table.query(
        KeyConditionExpression=Key("pk").eq(f"APP#{SCHOLARSHIP}#{YEAR}#moved")
        & Key("sk").begins_with("SCORE#")
    )["Count"] == 1


def test_a_failure_clears_the_copy_and_leaves_another_models_total_alone(table: Any) -> None:
    """A run that failed says nothing about a number a different model already produced."""
    put_scored(table, "gone", total=80, version="v1", model=OPUS)
    claim(
        pk=read(table, "gone")["pk"],
        sk=read(table, "gone")["sk"],
        claimed_by="run-one",
        rubric_version="v1",
        model_id=SONNET,
    )

    assert mark_failed(
        pk=read(table, "gone")["pk"], sk=read(table, "gone")["sk"], claimed_by="run-one",
        reason="the reply was missing a criterion",
    )

    application = read(table, "gone")
    assert application["status"] == "score_failed"
    assert application["failure"] == "the reply was missing a criterion"
    for field in ("category_scores", "total_score", "rubric_version", "model_id", "latest_scored_at"):
        assert field not in application

    still_there = total_row(table, "gone", "v1", OPUS)
    assert still_there is not None
    assert float(still_there["total_score"]) == 80


def test_releasing_puts_an_item_back_with_its_reason(table: Any) -> None:
    put_application(table, "given-back", status="processing", claimed_by="run-one", claimed_until=stamp(10))

    assert release(
        pk=read(table, "given-back")["pk"], sk=read(table, "given-back")["sk"],
        claimed_by="run-one", reason="Bedrock throttled the call",
    )

    application = read(table, "given-back")
    assert application["status"] == "parsed"
    assert application["last_error"] == "Bedrock throttled the call"
    assert "claimed_by" not in application


def test_neither_ending_lands_when_the_claim_names_someone_else(table: Any) -> None:
    put_application(table, "theirs", status="processing", claimed_by="run-two", claimed_until=stamp(10))
    keys = {"pk": read(table, "theirs")["pk"], "sk": read(table, "theirs")["sk"]}

    assert mark_failed(**keys, claimed_by="run-one", reason="not mine to fail") is False
    assert release(**keys, claimed_by="run-one", reason="not mine to release") is False
    assert read(table, "theirs")["status"] == "processing"


def test_a_ranking_covers_one_set_and_nothing_else(table: Any) -> None:
    """A cohort mixing versions, models, failures, and unscored items ranks one set of it.

    The application scored only on the other model has to be absent, not ranked at the bottom:
    a missing number that reads as a low number is the one failure a ranking must not allow.
    """
    put_scored(table, "high", total=90, version="v2", model=SONNET)
    put_scored(table, "low", total=40, version="v2", model=SONNET)
    put_scored(table, "older", total=99, version="v1", model=SONNET)
    put_scored(table, "other-model", total=99, version="v2", model=OPUS)
    put_application(table, "untouched")
    put_application(table, "failed", status="score_failed", failure="a bad reply")

    page, cursor = ranked(
        scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", model_id=SONNET
    )

    assert [item["student_uuid"] for item in page] == ["high", "low"]
    assert cursor is None
    # The row says which set it came from, off its own key — the index projects neither.
    assert page[0]["model_id"] == SONNET
    assert page[0]["rubric_version"] == "v2"

    lowest_first, _ = ranked(
        scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", model_id=SONNET,
        highest_first=False,
    )
    assert [item["student_uuid"] for item in lowest_first] == ["low", "high"]

    on_opus, _ = ranked(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", model_id=OPUS)
    assert [item["student_uuid"] for item in on_opus] == ["other-model"]
