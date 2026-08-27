"""How far apart the model and the reviewers are, and the cohort figures added up from it.

The two halves of the gap arrive separately: the reviewer-score ingest brings the chairs' marks,
and a scoring run or a recompute brings the model's total. Whichever lands second is the one that
has to work the gap out, so the arithmetic lives here instead of in either of them — one
implementation, called from both sides. A second copy is how the halves came to disagree.

A cohort's summary is rebuilt and never incremented, and only from what the cohort holds: the
office corrects files and re-uploads them, and a counter that was added to twice cannot be told
from one that was added to once.
"""

from __future__ import annotations

from typing import Any

from . import reads
from .claims import now
from .reply import CriterionScore, weighted_total
from .reviewers import (
    BANDS,
    DISAGREEMENT,
    PAIR_BAND_NAMES,
    band_of,
    flagged,
    gap,
    pair_band_of,
)
from .table import (
    COHORTS_PK,
    GAP_PK,
    SUMMARIES_PK,
    cohort_index_sk,
    cohort_of,
    summary_sk,
    table,
    to_dynamo,
)
from .work import MissingRubric, rubric_version_item

_criteria_cache: dict[tuple[str, str], list[dict[str, Any]] | None] = {}


def criteria_of(scholarship: str, version: Any) -> list[dict[str, Any]] | None:
    """The criteria of the rubric version that produced the model's total, or nothing.

    Nothing means there is no total to compare against — an unscored application, or a version
    whose criteria are not stored. Either way a gap would be a comparison between two different
    rubrics, which is not a comparison.
    """
    if not version:
        return None
    wanted = (scholarship, str(version))
    if wanted not in _criteria_cache:
        try:
            criteria = rubric_version_item(*wanted).get("criteria")
        except MissingRubric:
            criteria = None
        _criteria_cache[wanted] = criteria or None
    return _criteria_cache[wanted]


def reviewer_total(
    scores: dict[str, float],
    criteria: list[dict[str, Any]] | None,
    application: dict[str, Any],
) -> float | None:
    """One reviewer's total on the same weights the model's total is on, or nothing.

    Nothing where the application has no model total, where the version's criteria are not stored,
    where the reviewer left a criterion unscored, or where a score is outside its own maximum. A
    part of a total is not a total, and comparing one against a whole one overstates the gap.
    """
    if criteria is None or application.get("total_score") is None:
        return None
    if any(criterion["id"] not in scores for criterion in criteria):
        return None

    checked: list[CriterionScore] = []
    for criterion in criteria:
        maximum = int(criterion["max"])
        score = float(scores[criterion["id"]])
        if score < 0 or score > maximum:
            return None
        checked.append(
            CriterionScore(
                criterion_id=str(criterion["id"]),
                score=score,
                max=maximum,
                reasoning="",
                evidence="",
            )
        )
    return weighted_total(checked, criteria)


def settle_gap(
    application: dict[str, Any], *, total_score: float, rubric_version: str
) -> bool:
    """Work one application's gap out again against a model total that has just changed.

    Returns whether there was anything to settle. Most of a cohort has no reviewer marks, and that
    case costs no read at all — `reviewers_stored` is on the application itself.

    The reviewers' marks are read back from their own items rather than from the per-criterion
    figures beside the total: those hold a mean across reviewers, and a mean cannot say which
    reviewer left a criterion unscored. Only `reviewer_total` decides that, and it decides it once.
    """
    if not application.get("reviewers_stored"):
        return False

    scholarship, year, student = cohort_of(application)
    # The item in hand still carries the total it was read at, and the gap is against the new one.
    scored = {**application, "total_score": total_score, "rubric_version": rubric_version}
    criteria = criteria_of(scholarship, rubric_version)

    reviewers = reads.reviewer_scores(scholarship, year, student)
    totals: list[float] = []
    for reviewer in reviewers:
        total = reviewer_total(reviewer.get("category_scores") or {}, criteria, scored)
        if total is not None:
            totals.append(total)
        store_reviewer_total(reviewer, total=total, rubric_version=rubric_version)

    store_gap(scored, stored=len(reviewers), totals=totals)
    return True


def store_reviewer_total(
    reviewer: dict[str, Any], *, total: float | None, rubric_version: str
) -> None:
    """One reviewer's total on the weights the model's total is now on.

    The detail page puts this beside the model's, so a total left at the old weights would read as
    a measured comparison. The reviewer's own marks are not touched — nothing here rescores.
    """
    stored = reviewer.get("total_score")
    if stored == total and str(reviewer.get("rubric_version") or "") == rubric_version:
        return

    if total is None:
        # A total from a run under other weights would read as this one's, so it goes.
        expression = "REMOVE total_score, rubric_version"
        values: dict[str, Any] = {}
    else:
        expression = "SET total_score = :total, rubric_version = :version"
        values = {":total": total, ":version": rubric_version}

    request: dict[str, Any] = {
        "Key": {"pk": reviewer["pk"], "sk": reviewer["sk"]},
        "UpdateExpression": expression,
    }
    if values:
        request["ExpressionAttributeValues"] = to_dynamo(values)
    table().update_item(**request)


def store_gap(
    application: dict[str, Any],
    *,
    stored: int,
    totals: list[float],
    per_criterion: dict[str, dict[str, Any]] | None = None,
) -> None:
    """The reviewers' total and how far it is from the model's, on the application itself.

    `reviewers_stored` is how many reviewers scored the application and is written either way, so a
    screen can tell an application no reviewer scored from one the model has not scored.
    `reviewer_total` and the gap are only written when there is something to compare, and `gap_pk`
    only while that gap reaches the line — so the queue's index holds the queue and nothing else.

    `per_criterion` left out means the reviewers' own per-criterion figures are not this write's
    business; a scoring run changes nothing about them. The ingest passes what it worked out, and
    passes an empty one to clear figures an earlier file left.
    """
    sets = ["reviewers_stored = :stored"]
    values: dict[str, Any] = {":stored": stored}
    gone: list[str] = []

    if per_criterion:
        sets.append("reviewer_criteria = :criteria")
        values[":criteria"] = per_criterion
    elif per_criterion is not None:
        gone.append("reviewer_criteria")

    if not totals:
        gone += ["reviewer_total", "reviewer_count", "score_gap", "gap_pk"]
    else:
        total = round(sum(totals) / len(totals), 2)
        apart = round(gap(float(application["total_score"]), total), 2)
        sets += ["reviewer_total = :total", "reviewer_count = :count", "score_gap = :gap"]
        values.update({":total": total, ":count": len(totals), ":gap": apart})
        if flagged(apart):
            sets.append("gap_pk = :queue")
            values[":queue"] = GAP_PK
        else:
            gone.append("gap_pk")

    expression = "SET " + ", ".join(sets)
    if gone:
        expression += " REMOVE " + ", ".join(gone)

    table().update_item(
        Key={"pk": application["pk"], "sk": application["sk"]},
        UpdateExpression=expression,
        ExpressionAttributeValues=to_dynamo(values),
    )


def criterion_shape(per_reviewer: dict[str, dict[str, float]]) -> dict[str, dict[str, Any]]:
    """Per criterion: what the reviewers averaged, and how far any two of them were apart.

    Worked out per application and kept on it, so the cohort's figures are added up from the read
    the summary rebuild already does. `apart` and its bands are only there where two reviewers
    scored the same criterion — one reviewer is not a comparison, and a zero there would read as
    perfect agreement.
    """
    by_criterion: dict[str, list[float]] = {}
    for scores in per_reviewer.values():
        for criterion_id, score in scores.items():
            by_criterion.setdefault(criterion_id, []).append(score)

    shaped: dict[str, dict[str, Any]] = {}
    for criterion_id, scores in by_criterion.items():
        entry: dict[str, Any] = {
            "mean": round(sum(scores) / len(scores), 2),
            "reviewers": len(scores),
        }
        apart = [
            abs(one - other)
            for index, one in enumerate(scores)
            for other in scores[index + 1 :]
        ]
        if apart:
            entry["pairs"] = len(apart)
            entry["apart_sum"] = round(sum(apart), 2)
            entry["bands"] = {
                name: sum(1 for difference in apart if pair_band_of(difference) == name)
                for name in PAIR_BAND_NAMES
            }
        shaped[criterion_id] = entry
    return shaped


def rebuild_summary(scholarship: str, year: str) -> dict[str, Any]:
    """One cohort's reviewer-score figures, rebuilt from what the cohort holds."""
    applications = reads.cohort(scholarship, year)
    bands = {name: 0 for name, _ in BANDS}
    gaps = [
        float(application["score_gap"])
        for application in applications
        if application.get("score_gap") is not None
    ]
    for apart in gaps:
        bands[band_of(apart)] += 1

    summary = {
        "pk": SUMMARIES_PK,
        "sk": summary_sk(scholarship, year),
        "scholarship": scholarship,
        "year": year,
        "applications": len(applications),
        "with_reviewer_scores": sum(
            1 for application in applications if application.get("reviewers_stored")
        ),
        "with_both_totals": len(gaps),
        "flagged": sum(1 for apart in gaps if flagged(apart)),
        "mean_gap": round(sum(gaps) / len(gaps), 2) if gaps else None,
        "gap_bands": bands,
        "criterion_gaps": criterion_gaps(applications),
        "reviewer_pairs": reviewer_pairs(applications),
        "disagreement_line": DISAGREEMENT,
        "rebuilt_at": now(),
    }
    table().put_item(Item=to_dynamo(summary))
    return summary


def criterion_gaps(applications: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per criterion, how far the model's score is from what the reviewers averaged.

    In that criterion's own points, and only over applications where both scored it — the model's
    per-criterion score is on the application, and the reviewers' mean is beside it. A criterion the
    model has not scored is left out rather than counted as agreement.
    """
    apart: dict[str, list[float]] = {}
    for application in applications:
        model = application.get("category_scores") or {}
        for criterion_id, reviewers in (application.get("reviewer_criteria") or {}).items():
            scored = model.get(criterion_id)
            if not scored or scored.get("score") is None:
                continue
            apart.setdefault(criterion_id, []).append(
                abs(float(scored["score"]) - float(reviewers["mean"]))
            )

    return {
        criterion_id: {
            "covers": len(differences),
            "mean_apart": round(sum(differences) / len(differences), 2),
        }
        for criterion_id, differences in apart.items()
    }


def reviewer_pairs(applications: list[dict[str, Any]]) -> dict[str, Any]:
    """How close two reviewers land on the same criterion, over the whole cohort.

    Counted per pair of reviewers per criterion, so an application three chairs scored weighs more
    than one two scored — the comparison is between two readings, and it holds three of them.
    """
    pairs = 0
    apart = 0.0
    bands = {name: 0 for name in PAIR_BAND_NAMES}
    for application in applications:
        for figures in (application.get("reviewer_criteria") or {}).values():
            if not figures.get("pairs"):
                continue
            pairs += int(figures["pairs"])
            apart += float(figures["apart_sum"])
            for name, count in (figures.get("bands") or {}).items():
                if name in bands:
                    bands[name] += int(count)

    return {
        "pairs": pairs,
        "mean_apart": round(apart / pairs, 2) if pairs else None,
        "bands": bands,
    }


def mark_scores_changed(scholarship: str, year: str) -> None:
    """Note on the cohort that its totals are moving, so a summary rebuilt before now is behind.

    Written once when a run starts, not once per score: what it has to catch is a run that dies
    before it can rebuild, and one mark at the front covers every total the run went on to change.
    """
    table().update_item(
        Key={"pk": COHORTS_PK, "sk": cohort_index_sk(scholarship, year)},
        UpdateExpression="SET scores_changed_at = :at",
        ExpressionAttributeValues={":at": now()},
    )


def stale_cohorts(
    summaries: list[dict[str, Any]], cohorts: list[dict[str, Any]]
) -> list[tuple[str, str]]:
    """The cohorts whose figures are behind what they are built from, as scholarship and year.

    Two things move them: a run changing totals, and an ingest changing who is in the cohort. Every
    figure here is counted over the applications the cohort holds, so adding applicants dates a
    summary as surely as rescoring them does. A cohort neither has touched is not behind — there is
    nothing to count yet, and rebuilding it would read a cohort to write the same empty figures.
    """
    built = {
        (str(summary.get("scholarship")), str(summary.get("year"))): str(
            summary.get("rebuilt_at") or ""
        )
        for summary in summaries
    }

    behind: list[tuple[str, str]] = []
    for cohort in cohorts:
        changed = max(
            str(cohort.get("scores_changed_at") or ""), str(cohort.get("last_ingest_at") or "")
        )
        if not changed:
            continue
        wanted = (str(cohort.get("scholarship")), str(cohort.get("year")))
        if changed > built.get(wanted, ""):
            behind.append(wanted)
    return behind
