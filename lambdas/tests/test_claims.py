"""Claiming, and what a run's set — its rubric version and its model — puts in scope.

Wrong here in one direction two workers score the same applicant twice; wrong in the other a new
rubric rescores last year's cohort on real tokens, or a second model finds nothing to score and
the comparison the picker exists for cannot be made.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared.claims import ATTEMPT_LIMIT, BATCH_CLAIM, ONDEMAND_CLAIM, claim
from shared.table import cohort_pk, to_dynamo
from shared.work import UnknownScope, claimable

from helpers import SCHOLARSHIP, YEAR, put_application, put_scored, read, stamp

SONNET = "us.anthropic.claude-sonnet-4-6"
OPUS = "us.anthropic.claude-opus-4-6-v1"


def key(student: str) -> dict[str, str]:
    return {"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": f"APP#{student}"}


def work(version: str, model: str = SONNET, scope: str | None = None) -> set[str]:
    return {
        item["sk"]
        for item in claimable(
            scholarship=SCHOLARSHIP, year=YEAR, rubric_version=version, model_id=model, scope=scope
        )
    }


def test_a_held_claim_is_not_taken_twice(table: Any) -> None:
    put_application(table, "held")

    assert claim(**key("held"), claimed_by="run-one", rubric_version="v1", model_id=SONNET) is True
    assert claim(**key("held"), claimed_by="run-two", rubric_version="v1", model_id=SONNET) is False
    assert read(table, "held")["claimed_by"] == "run-one"


def test_an_expired_claim_is_taken_again(table: Any) -> None:
    put_application(table, "stale", status="processing", claimed_by="dead-run", claimed_until=stamp(-5))

    assert claim(**key("stale"), claimed_by="live-run", rubric_version="v1", model_id=SONNET) is True
    assert read(table, "stale")["claimed_by"] == "live-run"


def test_the_attempt_count_goes_up_when_the_claim_is_taken(table: Any) -> None:
    put_application(table, "counted")

    claim(**key("counted"), claimed_by="run-one", rubric_version="v1", model_id=SONNET)
    assert read(table, "counted")["attempt"] == 1


def test_an_item_at_the_attempt_limit_is_not_picked_up(table: Any) -> None:
    """Over the limit it burns tokens on a poison item forever; under it, work is abandoned."""
    put_application(table, "spent", status="score_failed", attempt=ATTEMPT_LIMIT)
    put_application(table, "one-left", status="score_failed", attempt=ATTEMPT_LIMIT - 1)

    assert claim(**key("spent"), claimed_by="run", rubric_version="v1", model_id=SONNET) is False
    assert claim(**key("one-left"), claimed_by="run", rubric_version="v1", model_id=SONNET) is True

    assert "APP#spent" not in work("v1")


def test_a_run_claims_an_older_version_and_skips_its_own(table: Any) -> None:
    put_scored(table, "at-v1", total=70, version="v1", model=SONNET)
    put_scored(table, "at-v2", total=70, version="v2", model=SONNET)

    assert claim(**key("at-v1"), claimed_by="run", rubric_version="v2", model_id=SONNET) is True
    assert claim(**key("at-v2"), claimed_by="run", rubric_version="v2", model_id=SONNET) is False


def test_a_second_model_finds_the_cohort_it_has_not_scored(table: Any) -> None:
    """The whole point of the picker. Sonnet's totals are not Opus's work being done."""
    put_scored(table, "on-sonnet", total=70, version="v2", model=SONNET)

    assert work("v2", OPUS) == {"APP#on-sonnet"}
    assert work("v2", SONNET) == set()
    assert claim(**key("on-sonnet"), claimed_by="run", rubric_version="v2", model_id=OPUS) is True


def test_a_total_with_no_model_recorded_is_nobodys_set(table: Any) -> None:
    """The items in the table today. Reading them as the default's would skip a real run."""
    put_scored(table, "before-models", total=70, version="v2")

    assert work("v2", SONNET) == {"APP#before-models"}


def test_a_run_never_reaches_another_cohort(table: Any) -> None:
    put_application(table, "ours")
    table.put_item(
        Item=to_dynamo(
            {
                "pk": cohort_pk(SCHOLARSHIP, "2025"),
                "sk": "APP#last-year",
                "status": "parsed",
            }
        )
    )
    table.put_item(
        Item=to_dynamo(
            {"pk": cohort_pk("other-award", YEAR), "sk": "APP#elsewhere", "status": "parsed"}
        )
    )

    assert work("v1") == {"APP#ours"}


def test_a_scope_takes_only_the_work_its_button_names(table: Any) -> None:
    """Each dashboard trigger runs the same route. The scope is the whole difference between
    "score the unscored" doing that and it rescoring the cohort."""
    put_application(table, "never-scored")
    put_application(table, "failed-once", status="score_failed", attempt=1)
    put_scored(table, "at-v1", total=70, version="v1", model=SONNET)
    put_scored(table, "at-v2", total=70, version="v2", model=SONNET)
    put_scored(table, "at-v2-on-opus", total=70, version="v2", model=OPUS)

    assert work("v2", scope="unscored") == {"APP#never-scored"}
    assert work("v2", scope="failed") == {"APP#failed-once"}
    assert work("v2", scope="changed_version") == {"APP#at-v1"}
    # The one no other scope can reach: a total at this version that this model did not make.
    assert work("v2", scope="other_model") == {"APP#at-v2-on-opus"}
    # No scope is every application without a total in this set, which is what the four scopes
    # divide up between them.
    assert work("v2") == {
        "APP#never-scored", "APP#failed-once", "APP#at-v1", "APP#at-v2-on-opus",
    }


def test_a_scope_can_only_cut_down_what_the_set_left(table: Any) -> None:
    """An application already scored in the run's set is out of scope, scope or no scope."""
    put_scored(table, "at-v2", total=70, version="v2", model=SONNET)

    for scope in (None, "unscored", "failed", "changed_version", "other_model"):
        assert work("v2", scope=scope) == set()


def test_an_unknown_scope_is_refused_rather_than_read_as_everything(table: Any) -> None:
    put_application(table, "unscored")

    with pytest.raises(UnknownScope, match="'everything' is not a scope"):
        work("v2", scope="everything")


def test_a_batch_claim_outlasts_the_job_it_was_taken_for(table: Any) -> None:
    """A job is given 36 hours, so a clock must never free an item a live job still holds."""
    assert BATCH_CLAIM.total_seconds() > 36 * 3600
    assert ONDEMAND_CLAIM < BATCH_CLAIM

    put_application(table, "batched")
    claim(
        **key("batched"), claimed_by="a-job", rubric_version="v1", model_id=SONNET,
        holds=BATCH_CLAIM,
    )

    assert read(table, "batched")["claimed_until"] > stamp(36 * 60)
