"""The batch path: what goes into a job's records, and what comes back out of one.

The batch half of scoring has no second chance. A job runs for hours, so anything wrong with a
record or with the way its output is read shows up long after the person who started it has gone.
"""

from __future__ import annotations

import json
from typing import Any

import boto3
import pytest
from boto3.dynamodb.conditions import Key

from shared.model import Answer
from shared.prompt import static_prefix
from shared.work import rubric_version_item
from workers import score_batch, score_ondemand
from helpers import SCHOLARSHIP, YEAR, put_application, put_version, read, stamp

BUCKET = "a-test-bucket"
JOB = "score-batch-sjsu-general-2026-v1-abc123456789"
JOB_ARN = "arn:aws:bedrock:us-west-2:178680429585:model-invocation-job/deadbeef00"
JOB_ID = "deadbeef00"
RUN_PREFIX = f"batch/{SCHOLARSHIP}/{YEAR}/v1/{JOB}/"
INPUT_URI = f"s3://{BUCKET}/{RUN_PREFIX}in/records.jsonl"
OUTPUT_URI = f"s3://{BUCKET}/{RUN_PREFIX}out/"

CRITERIA = [
    {"id": "grit", "name": "Grit", "max": 2, "weight": 40, "guidance": "", "levels": []},
    {"id": "clarity", "name": "Clarity", "max": 5, "weight": 60, "guidance": "", "levels": []},
]

REPLY = {
    "criterion_scores": [
        {"criterion_id": "grit", "score": 1, "reasoning": "half of it", "evidence": "their words"},
        {"criterion_id": "clarity", "score": 5, "reasoning": "clear", "evidence": "their words"},
    ],
    "reasoning_summary": "Strong on clarity.",
}


class Context:
    """Enough of a Lambda context for a worker that asks the time and its own request id."""

    aws_request_id = "11111111-2222-3333-4444-555555555555"

    @staticmethod
    def get_remaining_time_in_millis() -> int:
        return 300_000


class Bedrock:
    """Stands in for the Bedrock client. Only the job description is read on collection."""

    @staticmethod
    def get_model_invocation_job(jobIdentifier: str) -> dict[str, Any]:
        return {
            "inputDataConfig": {"s3InputDataConfig": {"s3Uri": INPUT_URI}},
            "outputDataConfig": {"s3OutputDataConfig": {"s3Uri": OUTPUT_URI}},
        }


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> Any:
    """The job's folder in S3, emptied between tests."""
    monkeypatch.setattr(score_batch, "BUCKET", BUCKET)
    s3 = boto3.client("s3")
    try:
        s3.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "us-west-2"}
        )
    except s3.exceptions.BucketAlreadyOwnedByYou:
        pass
    yield s3
    listing = s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])
    for entry in listing:
        s3.delete_object(Bucket=BUCKET, Key=entry["Key"])


@pytest.fixture
def collecting(bucket: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(score_batch, "bedrock", lambda: Bedrock)
    return bucket


def output_line(student: str, **extra: Any) -> dict[str, Any]:
    """One line of a job's `.jsonl.out`, in the shape a Converse job writes."""
    return {
        "recordId": student,
        "modelOutput": {
            "output": {"message": {"content": [{"text": json.dumps(REPLY)}]}},
            "usage": {"inputTokens": 10, "outputTokens": 20},
        },
        **extra,
    }


def put_output(s3: Any, lines: list[dict[str, Any]], **manifest: Any) -> None:
    folder = f"{RUN_PREFIX}out/{JOB_ID}/"
    s3.put_object(
        Bucket=BUCKET,
        Key=f"{folder}records.jsonl.out",
        Body="\n".join(json.dumps(line) for line in lines).encode("utf-8"),
    )
    s3.put_object(
        Bucket=BUCKET, Key=f"{folder}manifest.json.out", Body=json.dumps(manifest).encode("utf-8")
    )


def held(table: Any, student: str) -> dict[str, Any]:
    """An application a job is holding, as `submit` leaves it."""
    return put_application(
        table,
        student,
        status="processing",
        claimed_by=JOB,
        claimed_until=stamp(48 * 60),
        attempt=1,
    )


def event(status: str = "Completed") -> dict[str, Any]:
    return {
        "detail-type": "Batch Inference Job State Change",
        "detail": {"batchJobName": JOB, "status": status, "batchJobArn": JOB_ARN},
    }


def score_items(table: Any, student: str) -> int:
    return table.query(
        KeyConditionExpression=Key("pk").eq(f"APP#{SCHOLARSHIP}#{YEAR}#{student}")
        & Key("sk").begins_with("SCORE#")
    )["Count"]


def report_of(error: score_batch.BatchError) -> dict[str, Any]:
    return json.loads(str(error))


def test_a_record_carries_the_same_prompt_as_an_on_demand_call_and_nothing_more(
    table: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Batch takes no tool definition and no structured-output setting, and fails hours later on one."""
    put_version(table, "v1", CRITERIA, preamble="Score the whole application.")
    item = put_application(table, "one")

    sent: dict[str, str] = {}

    def fake_converse(*, model_id: str, prompt: str, max_tokens: int = 2000) -> Answer:
        sent["prompt"] = prompt
        return Answer(text=json.dumps(REPLY), input_tokens=1, output_tokens=1)

    monkeypatch.setattr(score_ondemand, "converse", fake_converse)
    score_ondemand.handler(
        {"scholarship": SCHOLARSHIP, "year": YEAR, "rubric_version": "v1"}, Context()
    )

    prefix = static_prefix(rubric_version_item(SCHOLARSHIP, "v1"))
    line = score_batch.record(item, prefix)
    text = line["modelInput"]["messages"][0]["content"][0]["text"]

    assert text == sent["prompt"]
    assert text.startswith(prefix)
    assert line["recordId"] == "one"
    assert set(line) == {"recordId", "modelInput"}
    assert set(line["modelInput"]) == {"messages", "inferenceConfig"}


def test_each_record_lands_on_the_application_whose_id_it_is(table: Any, collecting: Any) -> None:
    """A record read onto the wrong row puts one applicant's score on another's, and looks fine."""
    put_version(table, "v1", CRITERIA)
    for student in ("one", "two", "three"):
        held(table, student)
    put_output(
        collecting,
        [output_line("two"), {"recordId": "three", "error": "the model refused"}],
        totalRecordCount=3,
        processedRecordCount=3,
        successRecordCount=1,
        errorRecordCount=1,
    )

    with pytest.raises(score_batch.BatchError) as raised:
        score_batch.collect(event()["detail"])

    report = report_of(raised.value)
    assert (report["scored"], report["failed"], report["missing"]) == (1, 1, 1)
    assert report["manifest_mismatch"] is False

    assert float(read(table, "two")["total_score"]) == 80  # 1/2×40 + 5/5×60
    # The record carrying an error fails its own item, and the one with no record at all is
    # failed too rather than left claimed until someone notices.
    for student, reason in (("three", "the model refused"), ("one", "returned no record")):
        application = read(table, student)
        assert application["status"] == "score_failed"
        assert reason in application["failure"]
        assert "total_score" not in application


def test_a_manifest_that_disagrees_with_what_was_written_is_a_failed_run(
    table: Any, collecting: Any
) -> None:
    """A job that quietly dropped records would otherwise read as a finished cohort."""
    put_version(table, "v1", CRITERIA)
    held(table, "one")
    put_output(
        collecting,
        [output_line("one")],
        totalRecordCount=2,
        processedRecordCount=2,
        successRecordCount=2,
        errorRecordCount=0,
    )

    with pytest.raises(score_batch.BatchError) as raised:
        score_batch.collect(event()["detail"])

    report = report_of(raised.value)
    assert report["manifest_mismatch"] is True
    assert report["manifest"]["total"] == 2


def test_collecting_the_same_job_twice_changes_nothing(table: Any, collecting: Any) -> None:
    """The job-state event can arrive more than once, so this is ordinary traffic."""
    put_version(table, "v1", CRITERIA)
    held(table, "one")
    put_output(
        collecting,
        [output_line("one")],
        totalRecordCount=1,
        processedRecordCount=1,
        successRecordCount=1,
        errorRecordCount=0,
    )

    first = score_batch.collect(event()["detail"])
    scored_at = read(table, "one")["latest_scored_at"]

    second = score_batch.collect(event()["detail"])

    assert first["scored"] == 1
    assert second["held"] == 0
    assert "already collected" in second["note"]
    assert read(table, "one")["latest_scored_at"] == scored_at
    assert score_items(table, "one") == 1


def test_a_job_that_produced_nothing_hands_every_item_back(table: Any, collecting: Any) -> None:
    put_version(table, "v1", CRITERIA)
    held(table, "one")
    held(table, "two")

    report = score_batch.collect(
        {"batchJobName": JOB, "status": "Expired", "batchJobArn": JOB_ARN, "failureMessage": "ran out of time"}
    )

    assert (report["released"], report["scored"]) == (2, 0)
    for student in ("one", "two"):
        application = read(table, student)
        assert application["status"] == "parsed"
        assert "ran out of time" in application["last_error"]
        assert "claimed_by" not in application


def test_a_reply_the_model_marked_cut_off_fails_with_that_reason(
    table: Any, collecting: Any
) -> None:
    """Same text, two stop reasons: the model's own word is the only thing that tells them apart."""
    put_version(table, "v1", CRITERIA)
    cut_off, fine = output_line("one"), output_line("two")
    cut_off["modelOutput"]["stopReason"] = "max_tokens"
    fine["modelOutput"]["stopReason"] = "end_turn"
    for student in ("one", "two"):
        held(table, student)
    put_output(
        collecting,
        [cut_off, fine],
        totalRecordCount=2,
        processedRecordCount=2,
        successRecordCount=2,
        errorRecordCount=0,
    )

    with pytest.raises(score_batch.BatchError) as raised:
        score_batch.collect(event()["detail"])

    report = report_of(raised.value)
    assert (report["scored"], report["failed"]) == (1, 1)
    failed = read(table, "one")
    assert failed["status"] == "score_failed"
    assert "cut off at the output token limit" in failed["failure"]
    assert "not JSON" not in failed["failure"]
    assert read(table, "two")["status"] == "scored"
