"""GET how far apart the model and the reviewers are, per cohort and over all of them.

Every figure here is read off the per-cohort summaries a reviewer upload or a scoring run rebuilds,
so this is one Query and never a scan. Every figure carries how many applications it covers: an
application only counts once it has both a model total and a reviewer total, and most of a cohort
usually does not.

A run that died before it could rebuild would leave those figures behind its scores, so this read
checks each cohort's summary against when its totals last changed and rebuilds the ones that are
behind. That costs a cohort read, and only for a cohort that is actually behind.

One reviewer against another is here too, counted per pair of reviewers per criterion, and so is the
per-criterion difference between the model and the reviewers. Both are added up from figures the
ingest keeps on each application, so this read stays one Query.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.gaps import rebuild_summary, stale_cohorts
from shared.http import reply
from shared.reads import cohorts, summaries
from shared.reviewers import BANDS, DISAGREEMENT, PAIR_BAND_NAMES

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(_event: dict[str, Any], _context: object) -> dict[str, Any]:
    per_cohort = brought_up_to_date(summaries(), cohorts())

    log.info("agreement figures over %d cohorts", len(per_cohort))
    return reply(
        200,
        {
            "totals": totals(per_cohort),
            "gap_bands": bands(per_cohort),
            "scholarships": [
                {
                    "scholarship": summary.get("scholarship"),
                    "year": summary.get("year"),
                    "applications": summary.get("applications", 0),
                    "with_reviewer_scores": summary.get("with_reviewer_scores", 0),
                    "covers": summary.get("with_both_totals", 0),
                    "flagged": summary.get("flagged", 0),
                    "mean_gap": summary.get("mean_gap"),
                }
                for summary in per_cohort
            ],
            "criteria": criteria(per_cohort),
            "reviewer_pairs": pairs(per_cohort),
            "disagreement_line": DISAGREEMENT,
            "not_built": [],
        },
    )


def brought_up_to_date(
    per_cohort: list[dict[str, Any]], known: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """The summaries, with any that are behind their cohort's scores rebuilt first.

    A refresh is the last thing that can catch this, so it catches it rather than showing a figure
    it knows is old. A cohort in step costs nothing here.
    """
    behind = stale_cohorts(per_cohort, known)
    if not behind:
        return per_cohort

    rebuilt = {}
    for scholarship, year in behind:
        log.info("%s %s scored since its figures were built, so they were rebuilt", scholarship, year)
        rebuilt[(scholarship, year)] = rebuild_summary(scholarship, year)

    kept = [
        summary
        for summary in per_cohort
        if (str(summary.get("scholarship")), str(summary.get("year"))) not in rebuilt
    ]
    return kept + list(rebuilt.values())


def criteria(per_cohort: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per criterion, how far the model and the reviewers are apart, widest first.

    In the criterion's own points, added up over every cohort that scored it. Two rubrics can put a
    criterion out of different maxima, so a criterion is only comparable with itself — which is what
    the chart shows.
    """
    apart: dict[str, list[tuple[float, int]]] = {}
    for summary in per_cohort:
        for criterion_id, figures in (summary.get("criterion_gaps") or {}).items():
            covers = int(figures.get("covers", 0))
            if covers:
                apart.setdefault(criterion_id, []).append((float(figures["mean_apart"]), covers))

    rows = [
        {
            "criterion": criterion_id,
            "covers": sum(covers for _, covers in found),
            # Weighted by what each cohort covers, so a small cohort does not weigh like a big one.
            "mean_apart": round(
                sum(mean * covers for mean, covers in found)
                / sum(covers for _, covers in found),
                2,
            ),
        }
        for criterion_id, found in apart.items()
    ]
    return sorted(rows, key=lambda row: row["mean_apart"], reverse=True)


def pairs(per_cohort: list[dict[str, Any]]) -> dict[str, Any]:
    """How close two reviewers land on the same criterion, over every cohort."""
    counted = 0
    apart = 0.0
    bands = {name: 0 for name in PAIR_BAND_NAMES}
    for summary in per_cohort:
        figures = summary.get("reviewer_pairs") or {}
        found = int(figures.get("pairs", 0))
        if not found:
            continue
        counted += found
        apart += float(figures["mean_apart"]) * found
        for name, count in (figures.get("bands") or {}).items():
            if name in bands:
                bands[name] += int(count)

    return {
        "pairs": counted,
        "mean_apart": round(apart / counted, 2) if counted else None,
        "bands": bands,
    }


def totals(per_cohort: list[dict[str, Any]]) -> dict[str, Any]:
    """The figures across every cohort. `covers` is what the mean gap is a mean of."""
    covered = sum(int(summary.get("with_both_totals", 0)) for summary in per_cohort)
    # A mean of means would weight a ten-application cohort like a four-thousand one, so the
    # cohort means are weighted back up by what each covers.
    weighted = sum(
        float(summary["mean_gap"]) * int(summary.get("with_both_totals", 0))
        for summary in per_cohort
        if summary.get("mean_gap") is not None
    )
    return {
        "cohorts": len(per_cohort),
        "applications": sum(int(summary.get("applications", 0)) for summary in per_cohort),
        "with_reviewer_scores": sum(
            int(summary.get("with_reviewer_scores", 0)) for summary in per_cohort
        ),
        "covers": covered,
        "flagged": sum(int(summary.get("flagged", 0)) for summary in per_cohort),
        "mean_gap": round(weighted / covered, 2) if covered else None,
    }


def bands(per_cohort: list[dict[str, Any]]) -> dict[str, int]:
    """How many applications fall in each gap band, added up over the cohorts."""
    counted = {name: 0 for name, _ in BANDS}
    for summary in per_cohort:
        for name, count in (summary.get("gap_bands") or {}).items():
            if name in counted:
                counted[name] += int(count)
    return counted
