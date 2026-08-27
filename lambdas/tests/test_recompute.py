"""Recompute versus rescore, and what a recompute does to the ranking.

The stamp on a total is what makes these two different jobs. Without the split, a weight change
would either burn a cohort's worth of model calls or leave a ranking mixing two sets of weights.
"""

from __future__ import annotations

import copy
from typing import Any

from shared import reads
from shared.reviewers import reviewer_name_slug
from shared.table import GAP_PK, application_pk, rank_pk, reviewer_sk, to_dynamo
from shared.work import claimable, recomputable
from shared.versions import weights_only_change
from workers import recompute
from helpers import RUBRIC_FILE, SCHOLARSHIP, YEAR, put_scored, put_version, read

V1 = [
    {"id": "grit", "name": "Grit", "max": 2, "weight": 40, "guidance": "", "levels": []},
    {"id": "clarity", "name": "Clarity", "max": 5, "weight": 60, "guidance": "", "levels": []},
]

STORED_SCORES = {"grit": {"score": 1, "max": 2}, "clarity": {"score": 5, "max": 5}}


def with_weights(grit: float, clarity: float) -> list[dict[str, Any]]:
    changed = copy.deepcopy(V1)
    changed[0]["weight"] = grit
    changed[1]["weight"] = clarity
    return changed


class Context:
    """Enough of a Lambda context for a worker that only asks the time."""

    @staticmethod
    def get_remaining_time_in_millis() -> int:
        return 300_000


def test_a_weight_only_change_is_recomputable_and_a_criteria_change_is_not() -> None:
    """The rubric file is sent whole, so a single character of it is a criteria change."""
    target = {"source_text": RUBRIC_FILE, "criteria": with_weights(60, 40)}
    same_shape = {"source_text": RUBRIC_FILE, "criteria": V1}
    renamed = {"source_text": RUBRIC_FILE, "criteria": [{**V1[0], "name": "Grittiness"}, V1[1]]}
    reworded = {"source_text": RUBRIC_FILE.replace("plain", "Plain"), "criteria": V1}

    assert weights_only_change(same_shape, target) is True
    assert weights_only_change(renamed, target) is False
    assert weights_only_change(reworded, target) is False


def test_a_weight_only_change_recomputes_from_stored_scores_with_no_model_call(table: Any) -> None:
    put_version(table, "v1", V1)
    put_version(table, "v2", with_weights(60, 40))
    put_scored(table, "one", total=80, version="v1", category_scores=STORED_SCORES)

    report = recompute.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v2"}, Context()
    )

    assert report["moved"] == 1
    assert report["model_calls"] == 0

    application = read(table, "one")
    # 1/2×60 + 5/5×40, against 1/2×40 + 5/5×60 before.
    assert float(application["total_score"]) == 70
    assert application["rubric_version"] == "v2"
    assert application["rank_pk"] == rank_pk(SCHOLARSHIP, YEAR, "v2")
    # The per-criterion scores are not rewritten to get there, and no attempt is recorded.
    assert application["category_scores"] == STORED_SCORES
    assert application["latest_scored_at"] == "2026-08-01T00:00:00.000000Z"


def test_new_weights_move_the_gap_and_the_reviewers_total_with_the_model_s(table: Any) -> None:
    """Both totals are on the weights, so leaving the reviewers' one alone would misstate the gap."""
    put_version(table, "v1", V1)
    put_version(table, "v2", with_weights(60, 40))
    put_scored(
        table, "one", total=80, version="v1", category_scores=STORED_SCORES,
        reviewers_stored=1, reviewer_total=60, reviewer_count=1, score_gap=20, gap_pk=GAP_PK,
    )
    reviewer = {
        "pk": application_pk(SCHOLARSHIP, YEAR, "one"),
        "sk": reviewer_sk(reviewer_name_slug("Ann Chair")),
    }
    table.put_item(
        Item=to_dynamo(
            {
                **reviewer,
                "reviewer_name": "Ann Chair",
                "category_scores": {"grit": 0, "clarity": 5},
                "total_score": 60,
                "rubric_version": "v1",
            }
        )
    )

    report = recompute.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v2"}, Context()
    )

    application = read(table, "one")
    # The model's total moves 80 → 70, and the reviewer's 0/2 and 5/5 moves 60 → 40, so the gap is
    # 30 rather than the 10 a stale reviewer total would have said.
    assert float(application["total_score"]) == 70
    assert float(application["reviewer_total"]) == 40
    assert float(application["score_gap"]) == 30
    assert application["gap_pk"] == GAP_PK
    assert float(table.get_item(Key=reviewer)["Item"]["total_score"]) == 40

    # And the cohort's figures are rebuilt at the end of the run, not left at the old gap.
    assert report["figures_rebuilt"] is True
    assert float(reads.summaries()[0]["mean_gap"]) == 30


def test_a_criteria_change_is_left_for_a_rescore(table: Any) -> None:
    put_version(table, "v1", V1)
    put_version(table, "v2", [{**V1[0], "max": 3, "weight": 40}, V1[1]])
    put_scored(table, "one", total=80, version="v1", category_scores=STORED_SCORES)

    assert recomputable(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2") == []

    report = recompute.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v2"}, Context()
    )
    assert report["moved"] == 0
    assert float(read(table, "one")["total_score"]) == 80

    # It is work for a scoring run instead, which is what costs the model calls.
    scoped = claimable(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2")
    assert [item["sk"] for item in scoped] == ["APP#one"]


def test_a_total_already_at_the_version_is_left_alone(table: Any) -> None:
    put_version(table, "v1", V1)
    put_version(table, "v2", with_weights(60, 40))
    put_scored(table, "done", total=70, version="v2", category_scores=STORED_SCORES)

    assert recomputable(scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2") == []


def test_a_cohort_stopped_part_way_says_which_totals_moved(table: Any) -> None:
    """Every application names the version its total came from, so a half-done cohort is readable."""
    put_version(table, "v1", V1)
    put_version(table, "v2", with_weights(60, 40))
    put_scored(table, "moved", total=80, version="v1", category_scores=STORED_SCORES)
    put_scored(table, "not-yet", total=80, version="v1", category_scores=STORED_SCORES)

    class OutOfTime:
        """Time for one item and no more."""

        def __init__(self) -> None:
            self.calls = 0

        def get_remaining_time_in_millis(self) -> int:
            self.calls += 1
            return 300_000 if self.calls == 1 else 0

    report = recompute.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v2"}, OutOfTime()
    )

    assert report["moved"] == 1
    assert report["not_reached"] == 1
    versions = {read(table, student)["rubric_version"] for student in ("moved", "not-yet")}
    assert versions == {"v1", "v2"}


def test_scores_that_do_not_match_the_version_s_criteria_are_not_forced(table: Any) -> None:
    """Same criteria set on paper, but this application was stored without one of them."""
    put_version(table, "v1", V1)
    put_version(table, "v2", with_weights(60, 40))
    put_scored(table, "partial", total=80, version="v1", category_scores={"grit": {"score": 1, "max": 2}})

    report = recompute.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v2"}, Context()
    )

    assert report["unusable"] == 1
    assert float(read(table, "partial")["total_score"]) == 80
