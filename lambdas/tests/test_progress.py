"""Progress, counted off the applications. No run record exists to read instead."""

from __future__ import annotations

from typing import Any

from shared.reads import cohort, counts, set_counts, set_totals, with_set
from helpers import SCHOLARSHIP, YEAR, put_application, put_scored, put_total, stamp


def progress_of(table: Any) -> dict[str, Any]:
    """What the cohort handler reports: the states off the items, the sets off the totals."""
    return counts(cohort(SCHOLARSHIP, YEAR), set_counts(SCHOLARSHIP, YEAR))


def test_a_mixed_cohort_reports_what_is_done_and_what_is_left(table: Any) -> None:
    put_scored(table, "done-v2", total=90, version="v2")
    put_scored(table, "done-older", total=70, version="v1")
    put_application(table, "untouched")
    put_application(table, "held", status="processing", claimed_by="run-one", claimed_until=stamp(10))
    put_application(table, "abandoned", status="processing", claimed_by="dead", claimed_until=stamp(-10))
    put_application(table, "broken", status="score_failed", failure="a bad reply", attempt=3)

    progress = progress_of(table)

    assert progress["total"] == 6
    # The abandoned claim counts as work again, whatever its status still says.
    assert progress["states"] == {"scored": 2, "unscored": 2, "running": 1, "failed": 1}
    assert progress["scored_by_rubric_version"] == {"v2": 1, "v1": 1}


def test_every_set_a_cohort_holds_is_counted(table: Any) -> None:
    """A set nobody names reads as missing totals. The count is what lets a screen name them all.

    An application scored on two models is one item and two totals, so the sets add up to more
    than the cohort — which is the number a warning about a mixed cohort is made of.
    """
    sonnet = "us.anthropic.claude-sonnet-4-6"
    opus = "us.anthropic.claude-opus-4-6-v1"
    put_scored(table, "on-sonnet", total=80, version="v1", model=sonnet)
    put_scored(table, "also-sonnet", total=70, version="v1", model=sonnet)
    put_total(table, "on-sonnet", total=90, version="v1", model=opus)
    # Scored before the model was recorded. It is unknown, not the default.
    put_scored(table, "from-before", total=60, version="v1")
    put_application(table, "untouched")

    progress = progress_of(table)

    assert progress["scored_by_set"] == {
        f"v1#{sonnet}": 2,
        f"v1#{opus}": 1,
        "v1#unknown": 1,
    }
    assert progress["total"] == 4


def test_a_read_of_one_set_shows_that_sets_numbers_and_no_others(table: Any) -> None:
    """The application item keeps a copy of its *newest* total, so a screen showing one set has to
    overlay that set's rows — otherwise a row reads as scored by a model that never ran it."""
    sonnet = "us.anthropic.claude-sonnet-4-6"
    opus = "us.anthropic.claude-opus-4-6-v1"
    put_scored(table, "both", total=80, version="v1", model=sonnet)
    put_total(table, "both", total=95, version="v1", model=opus)
    put_scored(table, "only-sonnet", total=70, version="v1", model=sonnet)
    put_application(table, "untouched")

    rows = {
        row["sk"]: row
        for row in with_set(
            cohort(SCHOLARSHIP, YEAR), set_totals(SCHOLARSHIP, YEAR, "v1", opus)
        )
    }

    assert rows["APP#both"]["total_score"] == 95
    assert rows["APP#both"]["model_id"] == opus
    # Scored, but not in this set. A number here would be Sonnet's read as Opus's.
    assert rows["APP#only-sonnet"]["total_score"] is None
    assert rows["APP#only-sonnet"]["rubric_version"] is None
    assert rows["APP#untouched"]["total_score"] is None


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

    progress = progress_of(table)

    assert progress["states"]["running"] == 4
    assert progress["states"]["scored"] == 1
    assert progress["states"]["unscored"] == 0


def test_the_cohort_read_leaves_the_essays_behind(table: Any) -> None:
    """Every list and every count comes off this read, and none of them shows an essay."""
    put_application(table, "one")

    read = cohort(SCHOLARSHIP, YEAR)[0]

    assert "qa_pairs" not in read
    assert read["student_uuid"] == "one"
