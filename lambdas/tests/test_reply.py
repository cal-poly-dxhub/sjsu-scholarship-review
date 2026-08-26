"""The reply check and the total. This is where a wrong answer would become a real score."""

from __future__ import annotations

import json
from typing import Any

import pytest

from shared.reply import ReplyError, check_reply, weighted_total

# A small rubric of its own, so the check is not being tested against the file it will meet in
# production and nothing here can pass by falling back to the SJSU five.
FIXTURE_CRITERIA: list[dict[str, Any]] = [
    {"id": "grit", "name": "Grit", "max": 2, "weight": 25},
    {"id": "clarity", "name": "Clarity", "max": 5, "weight": 75},
]


def reply(scores: list[tuple[str, float]], summary: str = "A reasonable application.") -> str:
    return json.dumps(
        {
            "criterion_scores": [
                {
                    "criterion_id": criterion_id,
                    "score": score,
                    "reasoning": "because",
                    "evidence": "their words",
                }
                for criterion_id, score in scores
            ],
            "reasoning_summary": summary,
        }
    )


def test_a_complete_reply_passes() -> None:
    checked = check_reply(reply([("grit", 1), ("clarity", 4)]), FIXTURE_CRITERIA)

    # In the rubric's order, whatever order the model answered in.
    assert [score.criterion_id for score in checked.scores] == ["grit", "clarity"]
    assert [score.max for score in checked.scores] == [2, 5]
    assert checked.reasoning_summary == "A reasonable application."


def test_the_criteria_come_from_the_rubric() -> None:
    """The fixture's ids and maxima drive the check — 4 is fine for clarity, not for grit."""
    check_reply(reply([("grit", 2), ("clarity", 4)]), FIXTURE_CRITERIA)

    with pytest.raises(ReplyError, match="the score for grit is 4, outside 0-2"):
        check_reply(reply([("grit", 4), ("clarity", 4)]), FIXTURE_CRITERIA)


def test_a_cut_off_reply_is_told_apart_by_what_the_model_said() -> None:
    """The message has to send whoever reads it at the token limit, not at the JSON.

    The model saying `max_tokens` is the whole signal. The same text without it is a bad reply,
    and a complete reply with it is still cut off — a truncation that lands on a closing brace
    parses fine and would otherwise be scored.
    """
    cut_off = reply([("grit", 1), ("clarity", 4)])[:-20]

    with pytest.raises(ReplyError, match="cut off at the output token limit"):
        check_reply(cut_off, FIXTURE_CRITERIA, stop_reason="max_tokens")

    with pytest.raises(ReplyError, match="not JSON"):
        check_reply(cut_off, FIXTURE_CRITERIA, stop_reason="end_turn")

    with pytest.raises(ReplyError, match="cut off at the output token limit"):
        check_reply(reply([("grit", 1), ("clarity", 4)]), FIXTURE_CRITERIA, stop_reason="max_tokens")


def test_a_fenced_reply_is_read_and_a_wrong_one_inside_a_fence_still_fails() -> None:
    """The model answers in a ```json fence however plainly the prompt asks it not to.

    Every application in the 2026-2027 cohort failed on this. What the fence must not do is
    become a way in for a reply that is wrong: the object inside is checked exactly as a bare
    one is, and the error says what came back so a whole cohort cannot fail invisibly again.
    """
    good = reply([("grit", 1), ("clarity", 4)])
    assert check_reply(f"```json\n{good}\n```", FIXTURE_CRITERIA).scores[0].score == 1
    # A bare fence with no language tag, and whitespace around the whole thing.
    assert check_reply(f"  ```\n{good}\n```  ", FIXTURE_CRITERIA).scores[1].score == 4

    with pytest.raises(ReplyError, match="outside 0-2"):
        check_reply(f"```json\n{reply([('grit', 4), ('clarity', 4)])}\n```", FIXTURE_CRITERIA)

    with pytest.raises(ReplyError, match="It starts: 'I cannot score"):
        check_reply("I cannot score this application.", FIXTURE_CRITERIA)


@pytest.mark.parametrize(
    ("scores", "complaint"),
    [
        ([("grit", 1)], "missing clarity"),
        ([("grit", 1), ("clarity", 4), ("polish", 3)], "'polish' is not a criterion"),
        ([("grit", 1), ("clarity", 6)], "outside 0-5"),
        ([("grit", -0.5), ("clarity", 4)], "outside 0-2"),
        ([("grit", 1), ("clarity", 4), ("clarity", 5)], "scored twice"),
    ],
)
def test_a_reply_that_is_not_complete_and_in_range_fails(
    scores: list[tuple[str, float]], complaint: str
) -> None:
    with pytest.raises(ReplyError, match=complaint):
        check_reply(reply(scores), FIXTURE_CRITERIA)


def test_a_missing_summary_fails() -> None:
    with pytest.raises(ReplyError, match="reasoning_summary"):
        check_reply(reply([("grit", 1), ("clarity", 4)], summary="  "), FIXTURE_CRITERIA)


@pytest.mark.parametrize("score", [0.5, 3.5, 3.7, 4.0, 5])
def test_a_score_is_stored_as_the_model_gave_it(score: float) -> None:
    """Any number in the range is a score. Reading 3.7 as 3.5 or 4 would move a total by 5."""
    checked = check_reply(reply([("grit", 1), ("clarity", score)]), FIXTURE_CRITERIA)
    assert checked.scores[1].score == score


def test_a_whole_number_and_the_same_value_with_a_point_are_one_score() -> None:
    """3 and 3.0 come off the wire differently and have to end up as the same score."""
    plain = check_reply(reply([("grit", 1), ("clarity", 3)]), FIXTURE_CRITERIA).scores
    pointed = check_reply(reply([("grit", 1), ("clarity", 3.0)]), FIXTURE_CRITERIA).scores

    assert plain[1].score == pointed[1].score
    assert weighted_total(plain, FIXTURE_CRITERIA) == weighted_total(pointed, FIXTURE_CRITERIA)


def test_the_total_is_each_score_over_its_own_maximum_times_its_weight(
    criteria: list[dict[str, Any]],
) -> None:
    """The real five at 10/40/30/10/10: full marks is 100, and a mixed set is the share sum."""
    full = check_reply(
        reply(
            [
                ("extracurricular_activities", 1),
                ("career_goals_essay", 4),
                ("challenge_essay", 4),
                ("initiative_self_motivation", 3),
                ("creativity", 3),
            ]
        ),
        criteria,
    )
    assert weighted_total(full.scores, criteria) == 100

    mixed = check_reply(
        reply(
            [
                ("extracurricular_activities", 0.5),
                ("career_goals_essay", 3),
                ("challenge_essay", 2),
                ("initiative_self_motivation", 3),
                ("creativity", 0),
            ]
        ),
        criteria,
    )
    # 0.5/1×10 + 3/4×40 + 2/4×30 + 3/3×10 + 0/3×10
    assert weighted_total(mixed.scores, criteria) == 60
