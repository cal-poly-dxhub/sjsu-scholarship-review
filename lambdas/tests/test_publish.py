"""Publishing a version, and the race two people publishing at once would otherwise lose."""

from __future__ import annotations

import json
from typing import Any

from handlers import rubric_publish
from shared.versions import newest_first, next_version
from helpers import SCHOLARSHIP, put_version

WEIGHTS = {
    "extracurricular_activities": 10,
    "career_goals_essay": 40,
    "challenge_essay": 30,
    "initiative_self_motivation": 10,
    "creativity": 10,
}


def request(rubric_text: str) -> dict[str, Any]:
    return {
        "body": json.dumps(
            {
                "scholarship": SCHOLARSHIP,
                "source_file": "rubric.md",
                "source_text": rubric_text,
                "weights": WEIGHTS,
            }
        ),
        "requestContext": {"authorizer": {"jwt": {"claims": {"email": "someone@sjsu.edu"}}}},
    }


def test_publishing_writes_the_next_version_and_moves_no_application(
    table: Any, rubric_text: str
) -> None:
    first = rubric_publish.handler(request(rubric_text), None)
    second = rubric_publish.handler(request(rubric_text), None)

    assert json.loads(first["body"])["version"] == "v1"
    assert json.loads(second["body"])["version"] == "v2"
    assert "no application changed" in json.loads(second["body"])["note"]


def test_a_publish_that_loses_the_race_takes_the_next_number(
    table: Any, rubric_text: str, monkeypatch: Any
) -> None:
    """Overwriting the winner would strand every score stamped with that version."""
    put_version(table, "v1", [])
    taken = {"done": False}
    real_next = rubric_publish.next_version

    def next_version_then_someone_else_publishes(scholarship: str) -> str:
        version = real_next(scholarship)
        if not taken["done"]:
            # The other publish lands between working out the number and writing it.
            put_version(table, version, [])
            taken["done"] = True
        return version

    monkeypatch.setattr(rubric_publish, "next_version", next_version_then_someone_else_publishes)

    response = rubric_publish.handler(request(rubric_text), None)

    assert response["statusCode"] == 201
    assert json.loads(response["body"])["version"] == "v3"
    assert [item["sk"] for item in newest_first(SCHOLARSHIP)] == ["V#v3", "V#v2", "V#v1"]


def test_versions_are_ordered_by_their_number_not_their_text(table: Any) -> None:
    """`V#v10` sorts before `V#v9` as text, so the order is worked out from the number."""
    for number in range(1, 12):
        put_version(table, f"v{number}", [])

    assert [item["sk"] for item in newest_first(SCHOLARSHIP)][:3] == ["V#v11", "V#v10", "V#v9"]
    assert next_version(SCHOLARSHIP) == "v12"
