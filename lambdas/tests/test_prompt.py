"""What reaches the model: the published rubric file, the output contract, and the applicant.

The file is what a reviewer signed off on. Anything that reorders it, trims it, or rewrites a
header changes the rubric the model scored against while the stored version still says it did not.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from shared.model import Answer
from shared.prompt import MissingRubricFile, output_contract, system_blocks
from shared.work import rubric_version_item
from workers import score_ondemand
from helpers import RUBRIC_FILE, SCHOLARSHIP, YEAR, put_application, put_version, read

CRITERIA = [
    {"id": "grit", "name": "Grit", "max": 2, "weight": 40, "guidance": "", "levels": []},
    {"id": "clarity", "name": "Clarity", "max": 5, "weight": 60, "guidance": "", "levels": []},
]

REPLY = json.dumps(
    {
        "criterion_scores": [
            {"criterion_id": "grit", "score": 1, "reasoning": "some", "evidence": "their words"},
            {"criterion_id": "clarity", "score": 5, "reasoning": "clear", "evidence": "their words"},
        ],
        "reasoning_summary": "Strong on clarity.",
    }
)


class Context:
    aws_request_id = "11111111-2222-3333-4444-555555555555"

    @staticmethod
    def get_remaining_time_in_millis() -> int:
        return 300_000


def test_the_first_system_part_is_the_published_file_byte_for_byte(table: Any) -> None:
    """The old assembled prompt hoisted the closing banner and cut each category line short."""
    put_version(table, "v1", CRITERIA)

    system = system_blocks(rubric_version_item(SCHOLARSHIP, "v1"))

    assert len(system) == 2
    assert system[0] == {"text": RUBRIC_FILE}
    assert "Category: Grit (0-2) — half points allowed (e.g., 0.5)" in system[0]["text"]
    assert system[0]["text"].endswith("- 0 = muddled\n")


def test_the_contract_names_every_id_and_range_and_asks_for_no_step_or_total() -> None:
    """The ids are ours and appear nowhere in the file, so the contract is the only place they can
    come from. A step named here would argue with the file the model was just given."""
    contract = output_contract(CRITERIA)

    assert "- grit: Grit, score 0 to 2" in contract
    assert "- clarity: Clarity, score 0 to 5" in contract
    assert "a whole number or a\n  fraction" in contract
    assert "half point" not in contract
    assert "Do not give a total." in contract


def test_a_version_with_no_stored_file_fails_the_run_with_nothing_claimed(table: Any) -> None:
    """A claim held for a call that cannot be made ties the item up until the claim expires."""
    put_version(table, "v1", CRITERIA, source_text="")
    put_application(table, "one")

    with pytest.raises(MissingRubricFile, match="rubric version v1 of sjsu-general"):
        score_ondemand.handler(
            {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v1"}, Context()
        )

    application = read(table, "one")
    assert application["status"] == "parsed"
    assert "claimed_by" not in application


def test_a_retry_changes_only_the_user_part(table: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """The complaint has to ride on the user part: two different system parts would mean the
    second call scored against a different rubric than the first."""
    put_version(table, "v1", CRITERIA)
    put_application(table, "one")

    calls: list[dict[str, Any]] = []

    def fake_converse(
        *, model_id: str, system: list[dict[str, str]], user_text: str, max_tokens: int = 2000
    ) -> Answer:
        calls.append({"system": system, "user_text": user_text})
        text = "not JSON at all" if len(calls) == 1 else REPLY
        return Answer(text=text, input_tokens=1, output_tokens=1)

    monkeypatch.setattr(score_ondemand, "converse", fake_converse)
    report = score_ondemand.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v1"}, Context()
    )

    assert report["scored"] == 1
    assert len(calls) == 2
    assert calls[0]["system"] == calls[1]["system"]
    assert calls[1]["user_text"].startswith(calls[0]["user_text"])
    assert "previous reply was rejected" in calls[1]["user_text"]
