"""Adding two cohorts' agreement figures together.

The trap is a mean of means: a cohort with four applications would weigh the same as one with four
thousand, and the dashboard's headline figure would be whatever the smallest cohort did.
"""

from __future__ import annotations

from handlers import agreement


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


def test_a_cohort_nobody_has_scored_twice_is_left_out_rather_than_counted_as_agreement() -> None:
    empty = {"criterion_gaps": {}, "reviewer_pairs": {"pairs": 0, "mean_apart": None, "bands": {}}}

    assert agreement.criteria([empty]) == []
    assert agreement.pairs([empty])["mean_apart"] is None
    # And a cohort with figures is not diluted by one without.
    assert agreement.criteria([empty, cohort(2.0, 5, 5, 1.0)])[0]["mean_apart"] == 2.0
