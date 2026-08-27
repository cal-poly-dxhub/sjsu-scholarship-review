"""Adding two cohorts' agreement figures together, and catching figures that fell behind.

The trap is a mean of means: a cohort with four applications would weigh the same as one with four
thousand, and the dashboard's headline figure would be whatever the smallest cohort did.

The other trap is a run that died before it could rebuild. A refresh is the last thing that can
catch that, so a figure older than the scores it was built from is rebuilt here rather than shown.
"""

from __future__ import annotations

from typing import Any

from handlers import agreement
from shared import gaps, reads
from shared.table import (
    COHORTS_PK,
    SUMMARIES_PK,
    cohort_index_sk,
    summary_sk,
    to_dynamo,
)
from helpers import SCHOLARSHIP, YEAR, put_application


def cohort(mean_apart: float, covers: int, pairs: int, pair_apart: float) -> dict[str, object]:
    """One cohort's stored summary, holding only the fields these figures are added up from."""
    return {
        "criterion_gaps": {"creativity": {"covers": covers, "mean_apart": mean_apart}},
        "reviewer_pairs": {
            "pairs": pairs,
            "mean_apart": pair_apart,
            "bands": {"same": pairs - 1, "within_one": 1, "some_difference": 0, "far_apart": 0},
        },
    }


def test_two_cohorts_are_weighted_by_what_each_covers() -> None:
    per_cohort = [cohort(1.0, 90, 100, 0.5), cohort(3.0, 10, 10, 2.5)]

    # (1 × 90 + 3 × 10) / 100. A mean of means would say 2.
    assert agreement.criteria(per_cohort) == [
        {"criterion": "creativity", "covers": 100, "mean_apart": 1.2}
    ]

    # (0.5 × 100 + 2.5 × 10) / 110, and the bands added up as counts.
    pairs = agreement.pairs(per_cohort)
    assert pairs["pairs"] == 110
    assert pairs["mean_apart"] == 0.68
    assert pairs["bands"] == {
        "same": 108,
        "within_one": 2,
        "some_difference": 0,
        "far_apart": 0,
    }


def seed(table: Any, *, scored_at: str, built_at: str, ingested_at: str = "") -> None:
    """One cohort holding a 20-point gap, its index entry, and a summary saying 5."""
    put_application(table, "one", reviewers_stored=1, reviewer_total=60, score_gap=20)
    table.put_item(
        Item=to_dynamo(
            {
                "pk": COHORTS_PK,
                "sk": cohort_index_sk(SCHOLARSHIP, YEAR),
                "scholarship": SCHOLARSHIP,
                "year": YEAR,
                "scores_changed_at": scored_at,
                "last_ingest_at": ingested_at,
            }
        )
    )
    table.put_item(
        Item=to_dynamo(
            {
                "pk": SUMMARIES_PK,
                "sk": summary_sk(SCHOLARSHIP, YEAR),
                "scholarship": SCHOLARSHIP,
                "year": YEAR,
                "with_both_totals": 1,
                "mean_gap": 5,
                "rebuilt_at": built_at,
            }
        )
    )


def test_figures_older_than_the_scores_they_measure_are_rebuilt_on_the_read(table: Any) -> None:
    seed(table, scored_at="2026-08-02T00:00:00Z", built_at="2026-08-01T00:00:00Z")

    answered = agreement.brought_up_to_date(reads.summaries(), reads.cohorts())

    assert [float(summary["mean_gap"]) for summary in answered] == [20]
    # And the rebuild is stored, so the next read has nothing to catch.
    assert float(reads.summaries()[0]["mean_gap"]) == 20


def test_a_cohort_that_grew_since_its_figures_were_built_is_rebuilt_too(table: Any) -> None:
    """Every figure is counted over the cohort, so new applicants date a summary as much as a run."""
    seed(
        table,
        scored_at="2026-08-01T00:00:00Z",
        built_at="2026-08-02T00:00:00Z",
        ingested_at="2026-08-03T00:00:00Z",
    )

    answered = agreement.brought_up_to_date(reads.summaries(), reads.cohorts())

    assert [float(summary["mean_gap"]) for summary in answered] == [20]
    assert int(reads.summaries()[0]["applications"]) == 1


def test_figures_in_step_with_the_scores_are_answered_as_they_stand(table: Any) -> None:
    seed(table, scored_at="2026-08-01T00:00:00Z", built_at="2026-08-02T00:00:00Z")

    answered = agreement.brought_up_to_date(reads.summaries(), reads.cohorts())

    assert [float(summary["mean_gap"]) for summary in answered] == [5]
    # A cohort nothing has scored is not behind either — there is nothing to compare against yet.
    assert gaps.stale_cohorts([], [{"scholarship": SCHOLARSHIP, "year": YEAR}]) == []


def test_a_cohort_nobody_has_scored_twice_is_left_out_rather_than_counted_as_agreement() -> None:
    empty = {"criterion_gaps": {}, "reviewer_pairs": {"pairs": 0, "mean_apart": None, "bands": {}}}

    assert agreement.criteria([empty]) == []
    assert agreement.pairs([empty])["mean_apart"] is None
    # And a cohort with figures is not diluted by one without.
    assert agreement.criteria([empty, cohort(2.0, 5, 5, 1.0)])[0]["mean_apart"] == 2.0
