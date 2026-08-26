"""Which worker a run goes to, and the refusal that keeps a job from being submitted to fail."""

from __future__ import annotations

import json
from typing import Any

import pytest

from handlers import run
from helpers import SCHOLARSHIP, YEAR, put_version

CRITERIA = [{"id": "grit", "name": "Grit", "max": 2, "weight": 100, "guidance": "", "levels": []}]


class Invocations:
    """Stands in for the Lambda client, and records what would have been started."""

    def __init__(self) -> None:
        self.started: list[dict[str, Any]] = []

    def client(self, _service: str) -> "Invocations":
        return self

    def invoke(self, **call: Any) -> dict[str, int]:
        self.started.append(
            {"function": call["FunctionName"], **json.loads(call["Payload"].decode("utf-8"))}
        )
        return {"StatusCode": 202}


@pytest.fixture
def started(monkeypatch: pytest.MonkeyPatch) -> Invocations:
    invocations = Invocations()
    monkeypatch.setattr(run.boto3, "client", invocations.client)
    return invocations


def request(**body: Any) -> dict[str, Any]:
    return {
        "body": json.dumps(
            {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v1", **body}
        )
    }


def work_of(monkeypatch: pytest.MonkeyPatch, count: int) -> None:
    """How many applications the run would take. The count is what picks the path."""
    monkeypatch.setattr(run, "claimable", lambda **_: [{"sk": f"APP#{n}"} for n in range(count)])


def answer(response: dict[str, Any]) -> dict[str, Any]:
    return json.loads(response["body"])


@pytest.mark.parametrize(
    ("count", "path"),
    [(499, "ondemand"), (500, "batch")],
)
def test_the_count_picks_the_worker_at_the_line(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch, count: int, path: str
) -> None:
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, count)

    body = answer(run.handler(request(), None))

    assert body["path"] == path
    assert body["work"] == count
    assert started.started[0]["function"].endswith(
        "score-batch" if path == "batch" else "score-ondemand"
    )


@pytest.mark.parametrize("count", [499, 500])
def test_an_override_wins_on_either_side_of_the_line(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch, count: int
) -> None:
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, count)
    monkeypatch.setattr(run, "minimum_batch_records", lambda: 100)

    assert answer(run.handler(request(path="ondemand"), None))["path"] == "ondemand"
    assert answer(run.handler(request(path="batch"), None))["path"] == "batch"


def test_an_override_to_batch_below_the_minimum_is_refused_with_the_number(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Submitted anyway, the job fails hours later; downgraded quietly, nobody learns why."""
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, 40)
    monkeypatch.setattr(run, "minimum_batch_records", lambda: 100)

    response = run.handler(request(path="batch"), None)
    body = answer(response)

    assert response["statusCode"] == 400
    assert body["minimum_records"] == 100
    assert "100 records" in body["message"]
    assert started.started == []


def test_an_unreadable_quota_refuses_rather_than_guessing(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, 40)
    monkeypatch.setattr(run, "minimum_batch_records", lambda: None)

    response = run.handler(request(path="batch"), None)

    assert response["statusCode"] == 400
    assert "not checkable" in answer(response)["message"]
    assert started.started == []


def test_a_run_with_nothing_to_do_starts_nothing(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, 0)

    body = answer(run.handler(request(), None))

    assert body["started"] is False
    assert body["work"] == 0
    assert started.started == []


def test_a_version_that_was_never_published_is_refused(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_of(monkeypatch, 10)

    response = run.handler(request(rubric_version="v9"), None)

    assert response["statusCode"] == 400
    assert "publish one before scoring" in answer(response)["message"]
    assert started.started == []


def test_a_year_in_another_form_is_refused_rather_than_run_against_an_empty_cohort(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    """'2026' is a partition nothing was ever written to, so a run over it would find no work."""
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, 10)

    response = run.handler(request(year="2026"), None)

    assert response["statusCode"] == 400
    assert "2025-2026" in answer(response)["message"]
    assert started.started == []


def test_the_scope_reaches_the_worker_and_an_unknown_one_is_refused(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A scope dropped on the way is a "retry what failed" that rescores the cohort instead."""
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, 5)

    body = answer(run.handler(request(scope="failed"), None))
    assert body["scope"] == "failed"
    assert started.started[0]["scope"] == "failed"

    response = run.handler(request(scope="everything"), None)
    assert response["statusCode"] == 400
    assert "'scope' is 'everything'" in answer(response)["message"]
    # And a recompute carries no scope at all — it is a different job.
    monkeypatch.setattr(run, "recomputable", lambda **_: [({"sk": "APP#one"}, "v0")])
    run.handler(request(action="recompute"), None)
    assert "scope" not in started.started[-1]


def test_a_model_off_the_list_is_refused_with_the_list_named(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Let through, it comes back as a Bedrock access denial inside a worker holding claims."""
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, 5)

    response = run.handler(request(model_id="us.anthropic.claude-sonnet-9"), None)
    body = answer(response)

    assert response["statusCode"] == 400
    assert "us.anthropic.claude-sonnet-9" in body["message"]
    assert body["models"] == list(run.MODEL_IDS)
    assert started.started == []


def test_a_run_that_names_no_model_gets_the_default_and_says_which(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    put_version(table, "v1", CRITERIA)
    work_of(monkeypatch, 5)

    body = answer(run.handler(request(), None))

    assert body["model_id"] == "us.anthropic.claude-sonnet-4-6"
    assert started.started[0]["model_id"] == "us.anthropic.claude-sonnet-4-6"

    # And a named model travels to the worker instead of the default.
    picked = "us.anthropic.claude-opus-4-6-v1"
    assert answer(run.handler(request(model_id=picked), None))["model_id"] == picked
    assert started.started[-1]["model_id"] == picked


def test_a_recompute_goes_to_its_own_worker(
    table: Any, started: Invocations, monkeypatch: pytest.MonkeyPatch
) -> None:
    put_version(table, "v1", CRITERIA)
    monkeypatch.setattr(run, "recomputable", lambda **_: [({"sk": "APP#one"}, "v0")])

    body = answer(run.handler(request(action="recompute"), None))

    assert body["action"] == "recompute"
    assert body["model_calls"] == 0
    assert started.started[0]["function"].endswith("recompute")
