"""Recompute versus rescore, and what a recompute does to the ranking.

The stamp on a total is what makes these two different jobs. Without the split, a weight change
would either burn a cohort's worth of model calls or leave a ranking mixing two sets of weights.
"""

from __future__ import annotations

import copy
from typing import Any

from shared.table import cohort_pk, rank_pk, total_sk
from shared.work import claimable, recomputable
from shared.versions import weights_only_change
from workers import recompute
from helpers import SCHOLARSHIP, YEAR, put_scored, put_version, read

SONNET = "us.anthropic.claude-sonnet-4-6"
OPUS = "us.anthropic.claude-opus-4-6-v1"


def total_row(table: Any, student: str, version: str, model: str) -> dict[str, Any] | None:
    return table.get_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": total_sk(version, model, student)}
    ).get("Item")

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
    target = {"preamble": "", "criteria": with_weights(60, 40)}
    same_shape = {"preamble": "", "criteria": V1}
    renamed = {"preamble": "", "criteria": [{**V1[0], "name": "Grittiness"}, V1[1]]}
    reworded = {"preamble": "Score generously.", "criteria": V1}

    assert weights_only_change(same_shape, target) is True
    assert weights_only_change(renamed, target) is False
    assert weights_only_change(reworded, target) is False


def test_a_weight_only_change_recomputes_from_stored_scores_with_no_model_call(table: Any) -> None:
    put_version(table, "v1", V1)
    put_version(table, "v2", with_weights(60, 40))
    put_scored(table, "one", total=80, version="v1", model=SONNET, category_scores=STORED_SCORES)

    report = recompute.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v2"}, Context()
    )

    assert report["moved"] == 1
    assert report["model_calls"] == 0

    # The total moves to the new version under the model that made it, ranking key and all.
    moved = total_row(table, "one", "v2", SONNET)
    assert moved is not None
    # 1/2×60 + 5/5×40, against 1/2×40 + 5/5×60 before.
    assert float(moved["total_score"]) == 70
    assert moved["model_id"] == SONNET
    assert moved["rank_pk"] == rank_pk(SCHOLARSHIP, YEAR, "v2", SONNET)
    assert total_row(table, "one", "v1", SONNET) is None

    application = read(table, "one")
    assert float(application["total_score"]) == 70
    assert application["rubric_version"] == "v2"
    # The per-criterion scores are not rewritten to get there, and no attempt is recorded.
    assert application["category_scores"] == STORED_SCORES
    assert application["latest_scored_at"] == "2026-08-01T00:00:00.000000Z"


def test_a_recompute_moves_each_models_total_and_keeps_them_apart(table: Any) -> None:
    """Arithmetic never changes whose number it is: two sets in, two sets out."""
    put_version(table, "v1", V1)
    put_version(table, "v2", with_weights(60, 40))
    put_scored(table, "both", total=80, version="v1", model=SONNET, category_scores=STORED_SCORES)
    # A second model's total for the same application, at the same version.
    put_scored(table, "both", total=80, version="v1", model=OPUS, category_scores=STORED_SCORES)

    report = recompute.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v2"}, Context()
    )

    assert report["moved"] == 2
    for model in (SONNET, OPUS):
        moved = total_row(table, "both", "v2", model)
        assert moved is not None and moved["model_id"] == model
        assert float(moved["total_score"]) == 70
        assert total_row(table, "both", "v1", model) is None


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
    scoped = claimable(
        scholarship=SCHOLARSHIP, year=YEAR, rubric_version="v2", model_id=SONNET
    )
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
