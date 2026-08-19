"""Claiming, and what a run's rubric version puts in scope.

Wrong here in one direction two workers score the same applicant twice; wrong in the other a new
rubric rescores last year's cohort on real tokens.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared.claims import ATTEMPT_LIMIT, BATCH_CLAIM, ONDEMAND_CLAIM, claim
from shared.table import cohort_pk, to_dynamo
from shared.work import UnknownScope, claimable

from helpers import SCHOLARSHIP, YEAR, put_application, put_scored, read, stamp


def key(student: str) -> dict[str, str]:
    return {"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": f"APP#{student}"}


def test_a_held_claim_is_not_taken_twice(table: Any) -> None:
    put_application(table, "held")

    assert claim(**key("held"), claimed_by="run-one", rubric_version="v1") is True
    assert claim(**key("held"), claimed_by="run-two", rubric_version="v1") is False
    assert read(table, "held")["claimed_by"] == "run-one"


def test_an_expired_claim_is_taken_again(table: Any) -> None:
    put_application(table, "stale", status="processing", claimed_by="dead-run", claimed_until=stamp(-5))

    assert claim(**key("stale"), claimed_by="live-run", rubric_version="v1") is True
    assert read(table, "stale")["claimed_by"] == "live-run"


def test_the_attempt_count_goes_up_when_the_claim_is_taken(table: Any) -> None:
    put_application(table, "counted")

    claim(**key("counted"), claimed_by="run-one", rubric_version="v1")
    assert read(table, "counted")["attempt"] == 1


def test_an_item_at_the_attempt_limit_is_not_picked_up(table: Any) -> None:
    """Over the limit it burns tokens on a poison item forever; under it, work is abandoned."""
    put_application(table, "spent", status="score_failed", attempt=ATTEMPT_LIMIT)
    put_application(table, "one-left", status="score_failed", attempt=ATTEMPT_LIMIT - 1)

    assert claim(**key("spent"), claimed_by="run", rubric_version="v1") is False
    assert claim(**key("one-left"), claimed_by="run", rubric_version="v1") is True

    found = {item["sk"] for item in claimable(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v1")}
    assert "APP#spent" not in found


def test_a_run_claims_an_older_version_and_skips_its_own(table: Any) -> None:
    put_scored(table, "at-v1", total=70, version="v1")
    put_scored(table, "at-v2", total=70, version="v2")

    assert claim(**key("at-v1"), claimed_by="run", rubric_version="v2") is True
    assert claim(**key("at-v2"), claimed_by="run", rubric_version="v2") is False


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

    found = [item["sk"] for item in claimable(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v1")]
    assert found == ["APP#ours"]


def test_a_scope_takes_only_the_work_its_button_names(table: Any) -> None:
    """Each dashboard trigger runs the same route. The scope is the whole difference between
    "score the unscored" doing that and it rescoring the cohort."""
    put_application(table, "never-scored")
    put_application(table, "failed-once", status="score_failed", attempt=1)
    put_scored(table, "at-v1", total=70, version="v1")
    put_scored(table, "at-v2", total=70, version="v2")

    def found(scope: str | None) -> set[str]:
        return {
            item["sk"]
            for item in claimable(
                scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", scope=scope
            )
        }

    assert found("unscored") == {"APP#never-scored"}
    assert found("failed") == {"APP#failed-once"}
    assert found("changed_version") == {"APP#at-v1"}
    # No scope is every out-of-date application, which is what the three scopes divide up.
    assert found(None) == {"APP#never-scored", "APP#failed-once", "APP#at-v1"}


def test_a_scope_can_only_cut_down_what_the_version_left(table: Any) -> None:
    """An application already at the run's version is out of scope, scope or no scope."""
    put_scored(table, "at-v2", total=70, version="v2")

    for scope in (None, "unscored", "failed", "changed_version"):
        assert (
            claimable(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", scope=scope) == []
        )


def test_an_unknown_scope_is_refused_rather_than_read_as_everything(table: Any) -> None:
    put_application(table, "unscored")

    with pytest.raises(UnknownScope, match="'everything' is not a scope"):
        claimable(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", scope="everything")


def test_a_batch_claim_outlasts_the_job_it_was_taken_for(table: Any) -> None:
    """A job is given 36 hours, so a clock must never free an item a live job still holds."""
    assert BATCH_CLAIM.total_seconds() > 36 * 3600
    assert ONDEMAND_CLAIM < BATCH_CLAIM

    put_application(table, "batched")
    claim(**key("batched"), claimed_by="a-job", rubric_version="v1", holds=BATCH_CLAIM)

    assert read(table, "batched")["claimed_until"] > stamp(36 * 60)
