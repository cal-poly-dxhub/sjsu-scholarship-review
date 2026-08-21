"""A reviewer's identity, and the line where their total and the model's count as disagreeing.

One place, because the worker decides what to flag and two handlers describe what was flagged.
"""

from __future__ import annotations

import re

from .rubric import slug

WHITESPACE = re.compile(r"\s+")

# How many points out of 100 the model and the reviewers have to be apart for an application to
# need a second look. This is a chosen line, not a measured one: fitting it needs a cohort that
# has both a model total and reviewer totals, and no cohort does yet. It matches the boundary the
# dashboard's gap bands already draw at 10. Measure the real spread once a cohort carries both
# numbers, and change this.
DISAGREEMENT = 10.0


def reviewer_name_slug(name: str) -> str:
    """A reviewer's key from their display name.

    The office's export spells some names with doubled spaces, so the whitespace is collapsed
    first — otherwise 'Julian  Vogel' and 'Julian Vogel' are two reviewers.
    """
    return slug(WHITESPACE.sub(" ", name))


def gap(model_total: float, reviewer_total: float) -> float:
    """How far apart the two totals are. Direction is not part of it — either way is a gap."""
    return abs(model_total - reviewer_total)


def flagged(score_gap: float) -> bool:
    """Whether that gap is far enough apart to need a second look."""
    return score_gap >= DISAGREEMENT


# The bands the dashboard's gap chart draws, in order, with their lower bound in points. The 10
# boundary is `DISAGREEMENT`, so the chart and the queue cannot disagree about what is far apart.
BANDS = (("0_5", 0.0), ("5_10", 5.0), ("10_20", DISAGREEMENT), ("20_plus", 20.0))


def band_of(score_gap: float) -> str:
    """Which band a gap falls in. The widest band it reaches, so nothing lands in two."""
    reached = BANDS[0][0]
    for name, lower in BANDS:
        if score_gap >= lower:
            reached = name
    return reached


# How close two reviewers landed on one criterion, in that criterion's own points. Points and not a
# share of the maximum: chairs score in whole marks, and one mark apart is the difference they talk
# about. In the order the chart draws them.
PAIR_BAND_NAMES = ("same", "within_one", "some_difference", "far_apart")


def pair_band_of(apart: float) -> str:
    """Which of those bands a difference between two reviewers falls in."""
    if apart == 0:
        return "same"
    if apart <= 1:
        return "within_one"
    if apart <= 2:
        return "some_difference"
    return "far_apart"
