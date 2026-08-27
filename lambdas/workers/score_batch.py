"""Batch scoring: one job for many applications, submitted and then collected.

Two invocations of one function. The first claims items, writes a record for each under
`batch/`, submits the job, and stops — nothing polls and nothing sleeps. The second is started
by the job's own state-change event and reads what the job produced.

The job name is what ties the halves together: it is written into every claim, so the collector
can tell its own items from a later run's. What it cannot carry is the cohort — a job name is
63 characters with no spaces — so the cohort is read back off the job's input key.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from shared.claims import BATCH_CLAIM, claim, mark_failed, release
from shared.gaps import mark_scores_changed, rebuild_summary
from shared.model import Answer, text_of
from shared.prompt import applicant_text, system_blocks
from shared.quota import minimum_batch_records
from shared.reply import ReplyError, check_reply
from shared.scores import StaleClaim, write_score
from shared.table import cohort_pk, table
from shared.work import claimable, rubric_version_item

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MODEL_ID = os.environ["MODEL_ID"]
BUCKET = os.environ["BUCKET_NAME"]
BATCH_ROLE_ARN = os.environ["BATCH_ROLE_ARN"]

WORKER = "score-batch"
BATCH_PREFIX = "batch/"
INPUT_FILE = "records.jsonl"

# Bedrock will not take less than 24 and the claim expiry is set past this, so only the job
# ending frees an item.
JOB_HOURS = 36

MAX_TOKENS = 2000

# A job that produced nothing at all. Its items go back with the reason.
EMPTY_STATUSES = {"Failed", "Stopped", "Expired"}

# A job name is 63 characters, letters, digits, and hyphens.
JOB_NAME_LIMIT = 63

INPUT_KEY = re.compile(
    rf"^{BATCH_PREFIX}(?P<scholarship>[^/]+)/(?P<year>[^/]+)/(?P<version>[^/]+)/[^/]+/in/"
    rf"{INPUT_FILE}$"
)


class BatchError(Exception):
    """The run cannot go on. Anything already claimed has been released first."""


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Submit a job, or collect one that has ended. The event says which."""
    if event.get("detail-type") == "Batch Inference Job State Change":
        return collect(event["detail"])
    return submit(event, context)


# --- submit -----------------------------------------------------------------------------


def submit(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Claim a cohort's work, write one record each, and hand the job to Bedrock."""
    scholarship = event["scholarship"]
    year = event["year"]
    version = event["rubric_version"]

    rubric = rubric_version_item(scholarship, version)
    # Built before anything is claimed: a version with no rubric file stops the run here
    # rather than leaving items claimed for a job that cannot be written.
    system = system_blocks(rubric)
    job = job_name(scholarship, year, version, context.aws_request_id)

    items = claimable(
        scholarship=scholarship,
        year=year,
        rubric_version=version,
        scope=event.get("scope"),
        limit=event.get("limit"),
    )
    claimed = [
        item
        for item in items
        if claim(
            pk=item["pk"], sk=item["sk"], claimed_by=job, rubric_version=version,
            holds=BATCH_CLAIM,
        )
    ]

    if not claimed:
        return {"worker": WORKER, "job": job, "found": len(items), "claimed": 0, "submitted": False}

    floor = minimum_batch_records()
    if floor is not None and len(claimed) < floor:
        for item in claimed:
            release(
                pk=item["pk"], sk=item["sk"], claimed_by=job,
                reason=f"a batch job needs {floor} records and this set had {len(claimed)}",
            )
        raise BatchError(
            f"{len(claimed)} applications is below the {floor} records a batch job for"
            f" {MODEL_ID} needs. Nothing was submitted and the items are free again."
            " Score this set on demand instead."
        )

    # The cohort is in the key because the job name cannot hold it, and the collector has to
    # know which cohort's items a finished job was for.
    run_prefix = f"{BATCH_PREFIX}{scholarship}/{year}/{version}/{job}/"
    key = f"{run_prefix}in/{INPUT_FILE}"
    boto3.client("s3").put_object(
        Bucket=BUCKET,
        Key=key,
        Body="\n".join(json.dumps(record(item, system)) for item in claimed).encode("utf-8"),
    )

    try:
        response = bedrock().create_model_invocation_job(
            jobName=job,
            roleArn=BATCH_ROLE_ARN,
            modelId=MODEL_ID,
            # The job name is unique to this invocation, so a Lambda retry finds the job it
            # already created instead of making a second one over the same claimed items.
            clientRequestToken=job,
            modelInvocationType="Converse",
            inputDataConfig={
                "s3InputDataConfig": {"s3InputFormat": "JSONL", "s3Uri": f"s3://{BUCKET}/{key}"}
            },
            outputDataConfig={
                "s3OutputDataConfig": {"s3Uri": f"s3://{BUCKET}/{run_prefix}out/"}
            },
            timeoutDurationInHours=JOB_HOURS,
        )
    except ClientError as error:
        # What Bedrock said, on its own line: the traceback carries it too, but a run is only ever
        # read about in the log, and a refused submit is the one thing worth reading there.
        logger.error(
            "Bedrock would not take job %s over %d applications: %s",
            job,
            len(claimed),
            error.response.get("Error", {}).get("Message") or error,
        )
        for item in claimed:
            release(
                pk=item["pk"], sk=item["sk"], claimed_by=job,
                reason="the batch job was not accepted",
            )
        raise

    mark_scores_changed(scholarship, year)

    report = {
        "worker": WORKER,
        "job": job,
        "job_arn": response["jobArn"],
        "found": len(items),
        "claimed": len(claimed),
        "minimum_records": floor if floor is not None else "not checkable",
        "submitted": True,
        "input": f"s3://{BUCKET}/{key}",
    }
    logger.info("Submitted: %s", json.dumps(report))
    return report


def record(item: dict[str, Any], system: list[dict[str, str]]) -> dict[str, Any]:
    """One line of the job's input. The record id is the student, which is how it is matched back."""
    return {
        "recordId": item["sk"].removeprefix("APP#"),
        "modelInput": {
            "system": system,
            "messages": [{"role": "user", "content": [{"text": applicant_text(item)}]}],
            "inferenceConfig": {"temperature": 0, "maxTokens": MAX_TOKENS},
        },
    }


def job_name(scholarship: str, year: str, version: str, request_id: str) -> str:
    """A name Bedrock accepts that is also unique per invocation, since it is the claim's owner."""
    stem = f"{WORKER}-{scholarship}-{year}-{version}".replace("_", "-")
    stem = re.sub(r"[^A-Za-z0-9-]", "-", stem)
    tail = f"-{request_id.replace('-', '')[:12]}"
    return stem[: JOB_NAME_LIMIT - len(tail)] + tail


# --- collect ----------------------------------------------------------------------------


def collect(detail: dict[str, Any]) -> dict[str, Any]:
    """Read what a job that has ended produced, and settle every item it held."""
    job = detail["batchJobName"]
    status = detail["status"]
    job_arn = detail["batchJobArn"]

    described = bedrock().get_model_invocation_job(jobIdentifier=job_arn)
    input_uri = described["inputDataConfig"]["s3InputDataConfig"]["s3Uri"]
    output_uri = described["outputDataConfig"]["s3OutputDataConfig"]["s3Uri"]
    scholarship, year, version = cohort_from(input_uri)

    held = mine(scholarship, year, job)

    if not held:
        # The job-state event can arrive more than once. The second one finds nothing held: every
        # item this job had is settled and its claim cleared, so there is nothing left to do.
        report = {
            "worker": WORKER, "job": job, "status": status, "held": 0,
            "note": "this job was already collected",
        }
        logger.info("Already collected: %s", json.dumps(report))
        return report

    if status in EMPTY_STATUSES:
        reason = (
            f"the batch job {job} ended as {status} and produced nothing"
            f"{': ' + detail['failureMessage'] if detail.get('failureMessage') else ''}"
        )
        for item in held:
            release(pk=item["pk"], sk=item["sk"], claimed_by=job, reason=reason)
        report = {
            "worker": WORKER, "job": job, "status": status, "released": len(held), "scored": 0,
            "note": reason,
        }
        logger.info("Nothing to collect: %s", json.dumps(report))
        return report

    rubric = rubric_version_item(scholarship, version)
    criteria = rubric["criteria"]
    outputs = read_output(output_uri, job_arn)

    counts = {"scored": 0, "failed": 0, "missing": 0, "stale": 0}
    for item in held:
        student = item["sk"].removeprefix("APP#")
        line = outputs.get(student)
        if line is None:
            counts["missing"] += 1
            mark_failed(
                pk=item["pk"], sk=item["sk"], claimed_by=job,
                reason=f"the batch job {job} returned no record for this application",
            )
            continue

        outcome = apply_line(
            item=item, line=line, criteria=criteria, version=version, job=job
        )
        counts[outcome] += 1

    # Before the report and before any raise: a job that scored something and did not rebuild
    # leaves the agreement figures behind the scores.
    if counts["scored"]:
        rebuild_summary(scholarship, year)

    report = {
        "worker": WORKER,
        "job": job,
        "status": status,
        "scholarship": scholarship,
        "year": year,
        "rubric_version": version,
        "held": len(held),
        **counts,
        "figures_rebuilt": bool(counts["scored"]),
        **checked_against_manifest(output_uri, job_arn, counts),
    }
    logger.info("Collected: %s", json.dumps(report))

    if counts["failed"] or counts["missing"] or report.get("manifest_mismatch"):
        raise BatchError(json.dumps(report))
    return report


def apply_line(
    *, item: dict[str, Any], line: dict[str, Any], criteria: list[dict[str, Any]],
    version: str, job: str,
) -> str:
    """One output line onto one application. The claim still naming the job is the condition."""
    if "modelOutput" not in line:
        mark_failed(
            pk=item["pk"], sk=item["sk"], claimed_by=job,
            reason=f"the model did not answer for this record: {line.get('error')}",
        )
        return "failed"

    answer = answer_of(line["modelOutput"])
    try:
        checked = check_reply(answer.text, criteria, stop_reason=answer.stop_reason)
    except ReplyError as error:
        # There is no second call here: the job is over. A bad reply is a failure the retry
        # trigger picks up, with the attempt count already raised by the claim.
        mark_failed(pk=item["pk"], sk=item["sk"], claimed_by=job, reason=str(error))
        return "failed"

    try:
        write_score(
            application=item,
            reply=checked,
            criteria=criteria,
            rubric_version=version,
            model_id=MODEL_ID,
            worker=WORKER,
            input_tokens=answer.input_tokens,
            output_tokens=answer.output_tokens,
            claimed_by=job,
        )
    except StaleClaim as error:
        logger.info("Left alone: %s", error)
        return "stale"
    return "scored"


def answer_of(model_output: dict[str, Any]) -> Answer:
    """A Converse batch reply has the same shape as a Converse call."""
    usage = model_output.get("usage", {})
    return Answer(
        text=text_of(model_output),
        input_tokens=int(usage.get("inputTokens", 0)),
        output_tokens=int(usage.get("outputTokens", 0)),
        stop_reason=str(model_output.get("stopReason", "")),
    )


def mine(scholarship: str, year: str, job: str) -> list[dict[str, Any]]:
    """The cohort's items this job still holds. A later run's claim replaced the job's name."""
    found: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
            & Key("sk").begins_with("APP#"),
            "FilterExpression": Attr("claimed_by").eq(job),
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table().query(**request)
        found.extend(page.get("Items", []))
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found


def cohort_from(input_uri: str) -> tuple[str, str, str]:
    """Scholarship, year, and version out of the job's input key — the job name cannot hold them."""
    key = input_uri.split(f"s3://{BUCKET}/", 1)[-1]
    match = INPUT_KEY.match(key)
    if not match:
        raise BatchError(f"'{input_uri}' is not a job this worker wrote, so its cohort is unknown.")
    return match.group("scholarship"), match.group("year"), match.group("version")


def read_output(output_uri: str, job_arn: str) -> dict[str, dict[str, Any]]:
    """Every output line, keyed by record id. Bedrock writes them under a job-id folder."""
    s3 = boto3.client("s3")
    prefix = f"{key_of(output_uri)}{job_arn.rsplit('/', 1)[-1]}/"

    lines: dict[str, dict[str, Any]] = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
        for entry in page.get("Contents", []):
            if not entry["Key"].endswith(".jsonl.out"):
                continue
            body = s3.get_object(Bucket=BUCKET, Key=entry["Key"])["Body"].read().decode("utf-8")
            for text in body.splitlines():
                if text.strip():
                    line = json.loads(text)
                    lines[line["recordId"]] = line
    return lines


def checked_against_manifest(
    output_uri: str, job_arn: str, counts: dict[str, int]
) -> dict[str, Any]:
    """The job's own tally against what was written. A free check on a silent loss of records."""
    key = f"{key_of(output_uri)}{job_arn.rsplit('/', 1)[-1]}/manifest.json.out"
    try:
        body = boto3.client("s3").get_object(Bucket=BUCKET, Key=key)["Body"].read()
    except ClientError as error:
        logger.warning("No manifest at %s, so the counts were not checked: %s", key, error)
        return {"manifest": "not checkable"}

    manifest = json.loads(body)
    settled = counts["scored"] + counts["failed"] + counts["stale"]
    return {
        "manifest": {
            "total": manifest.get("totalRecordCount"),
            "processed": manifest.get("processedRecordCount"),
            "succeeded": manifest.get("successRecordCount"),
            "errors": manifest.get("errorRecordCount"),
        },
        "manifest_mismatch": manifest.get("totalRecordCount") != settled + counts["missing"],
    }


def key_of(uri: str) -> str:
    """The key part of an `s3://bucket/key` uri, always ending in a slash."""
    key = uri.split(f"s3://{BUCKET}/", 1)[-1]
    return key if key.endswith("/") else f"{key}/"


_bedrock = None


def bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock")
    return _bedrock
