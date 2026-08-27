"""Storing a score, failing one, and what either does to the ranking index."""

from __future__ import annotations

from typing import Any

import pytest
from boto3.dynamodb.conditions import Key

from shared import gaps
from shared.claims import claim, mark_failed, release
from shared.reads import ranked
from shared.reply import CriterionScore
from shared.reviewers import reviewer_name_slug
from shared.scores import StaleClaim, write_score
from shared.table import GAP_PK, application_pk, rank_pk, reviewer_sk, score_sk, to_dynamo
from helpers import SCHOLARSHIP, YEAR, put_application, put_scored, put_version, read, stamp

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


def store(table: Any, student: str, *, claimed_by: str = "run-one", version: str = "v1") -> float:
    return write_score(
        application=read(table, student),
        reply=Reply(),
        criteria=CRITERIA,
        rubric_version=version,
        model_id="a-model",
        worker="a-test",
        input_tokens=10,
        output_tokens=20,
        claimed_by=claimed_by,
    )


def test_the_score_item_and_the_application_are_both_written(table: Any) -> None:
    put_application(table, "one", status="processing", claimed_by="run-one", claimed_until=stamp(10))

    total = store(table, "one")
    assert total == 80  # 1/2×40 + 5/5×60

    application = read(table, "one")
    assert application["status"] == "scored"
    assert float(application["total_score"]) == 80
    assert application["rubric_version"] == "v1"
    assert application["rank_pk"] == rank_pk(SCHOLARSHIP, YEAR, "v1")
    # The application's copy carries the numbers a list shows and none of the reasoning.
    assert application["category_scores"]["grit"] == {"score": 1, "max": 2}
    assert "reasoning" not in application["category_scores"]["grit"]

    scores = table.query(
        KeyConditionExpression=Key("pk").eq(f"APP#{SCHOLARSHIP}#{YEAR}#one")
        & Key("sk").begins_with("SCORE#")
    )["Items"]
    assert len(scores) == 1
    assert scores[0]["sk"] == score_sk(application["latest_scored_at"])
    assert scores[0]["category_scores"]["grit"]["reasoning"] == "half of it"
    assert scores[0]["model_id"] == "a-model"


def put_reviewer(table: Any, student: str, name: str, scores: dict[str, float]) -> dict[str, str]:
    """One reviewer's marks as their own item, the shape the reviewer-score ingest leaves."""
    key = {
        "pk": application_pk(SCHOLARSHIP, YEAR, student),
        "sk": reviewer_sk(reviewer_name_slug(name)),
    }
    table.put_item(Item=to_dynamo({**key, "reviewer_name": name, "category_scores": scores}))
    return key


def test_a_score_settles_the_gap_the_reviewers_were_already_waiting_on(table: Any) -> None:
    """The reviewer file can be read before anything is scored, so the score finishes the sum."""
    put_version(table, "v1", CRITERIA)
    put_application(
        table, "reviewed", status="processing", claimed_by="run-one", claimed_until=stamp(10),
        reviewers_stored=1,
    )
    key = put_reviewer(table, "reviewed", "Ann Chair", {"grit": 0, "clarity": 3})

    store(table, "reviewed")

    application = read(table, "reviewed")
    # 0/2×40 + 3/5×60 is 36, against the model's 80, so the gap reaches the line.
    assert float(application["reviewer_total"]) == 36
    assert float(application["score_gap"]) == 44
    assert application["gap_pk"] == GAP_PK
    assert application["reviewer_count"] == 1

    # The reviewer's own total is on the weights the model's total is on, so the detail page can
    # put the two side by side.
    reviewer = table.get_item(Key=key)["Item"]
    assert float(reviewer["total_score"]) == 36
    assert reviewer["rubric_version"] == "v1"


def test_an_application_no_reviewer_scored_is_not_read_for_reviewers(
    table: Any, monkeypatch: Any
) -> None:
    """A cohort is mostly unreviewed, so the settle has to cost nothing there."""
    put_version(table, "v1", CRITERIA)
    put_application(
        table, "plain", status="processing", claimed_by="run-one", claimed_until=stamp(10)
    )

    def refuse(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        raise AssertionError("no reviewer item should be read for an unreviewed application")

    monkeypatch.setattr(gaps.reads, "reviewer_scores", refuse)

    assert store(table, "plain") == 80
    application = read(table, "plain")
    for field in ("reviewer_total", "reviewer_count", "score_gap", "gap_pk", "reviewers_stored"):
        assert field not in application


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


def test_a_failure_clears_everything_a_score_would_have_said(table: Any) -> None:
    put_scored(table, "gone", total=80, version="v1")
    claim(
        pk=read(table, "gone")["pk"],
        sk=read(table, "gone")["sk"],
        claimed_by="run-one",
        rubric_version="v2",
    )

    assert mark_failed(
        pk=read(table, "gone")["pk"], sk=read(table, "gone")["sk"], claimed_by="run-one",
        reason="the reply was missing a criterion",
    )

    application = read(table, "gone")
    assert application["status"] == "score_failed"
    assert application["failure"] == "the reply was missing a criterion"
    for field in ("category_scores", "total_score", "rubric_version", "rank_pk", "latest_scored_at"):
        assert field not in application


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


def test_only_comparable_totals_are_in_the_ranking(table: Any) -> None:
    """A cohort mixing versions, failures, and unscored items ranks one version of it."""
    put_scored(table, "high", total=90, version="v2")
    put_scored(table, "low", total=40, version="v2")
    put_scored(table, "older", total=99, version="v1")
    put_application(table, "untouched")
    put_application(table, "failed", status="score_failed", failure="a bad reply")

    page, cursor = ranked(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2")

    assert [item["sk"] for item in page] == ["APP#high", "APP#low"]
    assert cursor is None

    lowest_first, _ = ranked(
        scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", highest_first=False
    )
    assert [item["sk"] for item in lowest_first] == ["APP#low", "APP#high"]
