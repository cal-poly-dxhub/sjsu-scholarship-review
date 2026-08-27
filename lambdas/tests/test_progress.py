"""Progress, counted off the applications. No run record exists to read instead."""

from __future__ import annotations

from typing import Any

from shared.reads import cohort, counts
from helpers import SCHOLARSHIP, YEAR, put_application, put_scored, stamp


def mixed(table: Any) -> list[dict[str, Any]]:
    put_scored(table, "done-v2", total=90, version="v2")
    put_scored(table, "done-older", total=70, version="v1")
    put_application(table, "untouched")
    put_application(table, "held", status="processing", claimed_by="run-one", claimed_until=stamp(10))
    put_application(table, "abandoned", status="processing", claimed_by="dead", claimed_until=stamp(-10))
    put_application(table, "broken", status="score_failed", failure="a bad reply", attempt=3)
    return cohort(SCHOLARSHIP, YEAR)


def test_a_mixed_cohort_reports_what_is_done_and_what_is_left(table: Any) -> None:
    progress = counts(mixed(table))

    assert progress["total"] == 6
    # The abandoned claim counts as work again, whatever its status still says.
    assert progress["states"] == {"scored": 2, "unscored": 2, "running": 1, "failed": 1}
    assert progress["scored_by_rubric_version"] == {"v2": 1, "v1": 1}


def test_a_cohort_a_batch_job_is_working_on_does_not_read_as_nearly_finished(table: Any) -> None:
    """A batch claim runs for hours, so the items it holds are running, not done."""
    for number in range(4):
        put_application(
            table,
            f"in-job-{number}",
            status="processing",
            claimed_by="a-bedrock-job-name",
            claimed_until=stamp(48 * 60),
        )
    put_scored(table, "already", total=80, version="v1")

    progress = counts(cohort(SCHOLARSHIP, YEAR))

    assert progress["states"]["running"] == 4
    assert progress["states"]["scored"] == 1
    assert progress["states"]["unscored"] == 0


def test_the_cohort_read_leaves_the_essays_behind(table: Any) -> None:
    """Every list and every count comes off this read, and none of them shows an essay."""
    put_application(table, "one")

    read = cohort(SCHOLARSHIP, YEAR)[0]

    assert "qa_pairs" not in read
    assert read["student_uuid"] == "one"
