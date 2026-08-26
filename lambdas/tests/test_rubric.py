"""The rubric parser, on the real file, and every refusal it makes.

A guessed maximum or a dropped preamble moves every score under it without failing anything,
which is why the parse is checked against `rubric.md` itself rather than a copy.
"""

from __future__ import annotations

import pytest

from shared.rubric import RubricError, parse_rubric, validate_weights


def test_the_real_rubric_parses_whole(rubric_text: str) -> None:
    parsed = parse_rubric(rubric_text)

    assert [(criterion.id, criterion.max) for criterion in parsed.criteria] == [
        ("extracurricular_activities", 1),
        ("career_goals_essay", 4),
        ("challenge_essay", 4),
        ("initiative_self_motivation", 3),
        ("creativity", 3),
    ]
    assert [[level.value for level in criterion.levels] for criterion in parsed.criteria] == [
        [1.0, 0.5, 0.0],
        [4.0, 3.0, 2.0, 1.0, 0.0],
        [4.0, 3.0, 2.0, 1.0, 0.0],
        [3.0, 2.0, 1.0, 0.0],
        [3.0, 2.0, 1.0, 0.0],
    ]


def test_the_prompt_and_evidence_lines_are_that_criterion_s_guidance(rubric_text: str) -> None:
    by_id = {criterion.id: criterion for criterion in parse_rubric(rubric_text).criteria}

    assert by_id["career_goals_essay"].guidance.startswith('Prompt: "What do you hope to achieve')
    assert by_id["creativity"].guidance.startswith("Evidence can come from any section")


def test_both_banner_blocks_stay_in_the_preamble(rubric_text: str) -> None:
    """The banners carry the scoring guidance, and the parsed preamble is what proves they survived."""
    preamble = parse_rubric(rubric_text).preamble

    banners = [line for line in preamble.splitlines() if set(line.strip()) == {"="}]
    assert len(banners) == 4  # two blocks, opened and closed
    assert "half" in preamble.lower()


def block(header: str = "Category: Grit (0-2)", levels: str = "- 2 = good\n- 0 = none") -> str:
    return f"{header}\n{levels}\n"


@pytest.mark.parametrize(
    ("text", "complaint", "line"),
    [
        (block(header="Category: Grit"), "no (low-high) score range", 1),
        (block(levels="- 3 = too good\n- 0 = none"), "above the maximum of 2", 2),
        (block(levels="- 2 = good\n- 0.7 = odd\n- 0 = none"), "finer than a half point", 3),
        (block(levels="- 2 = good\n- 2 = again\n- 0 = none"), "given twice", 3),
        (block(levels="- 2 = good\n- 1 = some"), "no level at 0", 1),
        (block() + block(header="Category: GRIT! (0-2)"), "both give the id grit", 4),
    ],
)
def test_the_parser_refuses_and_names_the_line(text: str, complaint: str, line: int) -> None:
    with pytest.raises(RubricError) as raised:
        parse_rubric(text)

    assert complaint in raised.value.message
    assert raised.value.line_number == line


def test_nothing_is_corrected_on_the_way_in() -> None:
    """A level above its maximum is refused, not clamped to the maximum."""
    with pytest.raises(RubricError):
        parse_rubric(block(levels="- 5 = way past\n- 0 = none"))


def test_the_published_weights_validate(rubric_text: str) -> None:
    criteria = parse_rubric(rubric_text).criteria
    weights = {
        "extracurricular_activities": 10,
        "career_goals_essay": 40,
        "challenge_essay": 30,
        "initiative_self_motivation": 10,
        "creativity": 10,
    }

    assert validate_weights(criteria, weights) == {key: float(value) for key, value in weights.items()}


@pytest.mark.parametrize(
    ("change", "complaint"),
    [
        ({"creativity": 9}, "sum to 99"),
        ({"creativity": 11}, "sum to 101"),
        ({"creativity": 0}, "must be above zero"),
    ],
)
def test_weights_that_do_not_add_up_are_refused(
    rubric_text: str, change: dict[str, float], complaint: str
) -> None:
    criteria = parse_rubric(rubric_text).criteria
    weights = {
        "extracurricular_activities": 10,
        "career_goals_essay": 40,
        "challenge_essay": 30,
        "initiative_self_motivation": 10,
        "creativity": 10,
        **change,
    }

    with pytest.raises(RubricError, match=complaint):
        validate_weights(criteria, weights)


def test_a_missing_weight_is_refused_rather_than_read_off_a_maximum(rubric_text: str) -> None:
    criteria = parse_rubric(rubric_text).criteria
    weights = {
        "extracurricular_activities": 10,
        "career_goals_essay": 40,
        "challenge_essay": 30,
        "initiative_self_motivation": 10,
    }

    with pytest.raises(RubricError, match="no weight given for creativity"):
        validate_weights(criteria, weights)
