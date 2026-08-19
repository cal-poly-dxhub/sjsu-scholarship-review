"""The two reads every screen uses, and nothing else reads the table from a screen.

A cohort read is one Query on the cohort partition. A ranked read is one Query on the ranking
index. Both address a cohort by key, so no screen ever scans, and neither carries `qa_pairs` —
the essays are most of an item's bytes and no list shows them.

Ordering belongs to the index. `highest_first` is a read direction, not a sort: nothing here
reorders what DynamoDB handed back.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from .claims import FAILED, PROCESSING, SCORED, now
from .table import (
    RANK_INDEX_NAME,
    TABLE_NAME,
    application_pk,
    application_sk,
    cohort_pk,
    from_dynamo,
    rank_pk,
    score_sk,
    table,
)

# What a list, a search, and the counts need. `qa_pairs` is left out, and so are the fields
# that are the workers' bookkeeping rather than anything a person reads: `content_hash`,
# `source`, `claimed_by`.
COHORT_FIELDS = (
    "pk, sk, student_uuid, scholarship, #year, #status, academic_program, academic_level,"
    " major, gpa, category_scores, total_score, rubric_version, rank_pk, latest_scored_at,"
    " claimed_until, attempt, failure, last_error, parsed_at"
)

# The index projects these, so asking for more would fetch the base item and undo the point
# of a narrow projection.
RANKED_FIELDS = (
    "pk, sk, rank_pk, total_score, #status, rubric_version, category_scores, latest_scored_at,"
    " academic_program, academic_level, major, gpa"
)

NAMES = {"#status": "status", "#year": "year"}

# A page big enough that a cohort of a few thousand is a handful of reads, and small enough
# that one response stays under the API's limit.
PAGE = 200
MAX_PAGE = 1000

# DynamoDB's own ceiling on a BatchGetItem.
BATCH_KEYS = 100


def cohort(scholarship: str, year: str) -> list[dict[str, Any]]:
    """Every application in one cohort, without its essays. One Query, paged to the end."""
    found: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
            & Key("sk").begins_with("APP#"),
            "ProjectionExpression": COHORT_FIELDS,
            "ExpressionAttributeNames": NAMES,
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table().query(**request)
        found.extend(from_dynamo(item) for item in page.get("Items", []))
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found


def counts(applications: list[dict[str, Any]]) -> dict[str, Any]:
    """What the cohort is doing. This is the whole of run progress — no run item is stored."""
    moment = now()
    states = {"scored": 0, "unscored": 0, "running": 0, "failed": 0}
    versions: dict[str, int] = {}

    for application in applications:
        status = application.get("status")
        if status == PROCESSING and str(application.get("claimed_until", "")) > moment:
            states["running"] += 1
        elif status == FAILED:
            states["failed"] += 1
        elif status == SCORED and application.get("total_score") is not None:
            states["scored"] += 1
            version = str(application.get("rubric_version", "unknown"))
            versions[version] = versions.get(version, 0) + 1
        else:
            # A claim that has expired is work again, whatever `status` still says.
            states["unscored"] += 1

    return {"total": len(applications), "states": states, "scored_by_rubric_version": versions}


def ranked(
    *,
    scholarship: str,
    year: str,
    rubric_version: str,
    highest_first: bool = True,
    limit: int = PAGE,
    cursor: str | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """One page of a cohort's comparable totals, in the order the index holds them."""
    request: dict[str, Any] = {
        "IndexName": RANK_INDEX_NAME,
        "KeyConditionExpression": Key("rank_pk").eq(rank_pk(scholarship, year, rubric_version)),
        "ProjectionExpression": RANKED_FIELDS,
        "ExpressionAttributeNames": {"#status": "status"},
        # The index is in ascending total order, so reading backwards is what "highest" means.
        "ScanIndexForward": not highest_first,
        "Limit": min(max(limit, 1), MAX_PAGE),
    }
    if cursor:
        request["ExclusiveStartKey"] = decode_cursor(cursor)

    page = table().query(**request)
    items = [from_dynamo(item) for item in page.get("Items", [])]
    return items, encode_cursor(page.get("LastEvaluatedKey"))


def application(
    scholarship: str, year: str, student_uuid: str
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """One application and its newest score item, the only place a score item is opened.

    The application carries `latest_scored_at`, which is its newest score item's sort key, so
    the second read is a GetItem on a known key rather than a Query.
    """
    found = table().get_item(
        Key={"pk": cohort_pk(scholarship, year), "sk": application_sk(student_uuid)}
    )
    item = found.get("Item")
    if item is None:
        return None, None

    application_item = from_dynamo(item)
    scored_at = application_item.get("latest_scored_at")
    if not scored_at:
        return application_item, None

    score = table().get_item(
        Key={
            "pk": application_pk(scholarship, year, student_uuid),
            "sk": score_sk(str(scored_at)),
        }
    )
    score_item = score.get("Item")
    return application_item, from_dynamo(score_item) if score_item else None


def newest_scores(
    scholarship: str, year: str, wanted: list[tuple[str, str]]
) -> dict[str, dict[str, Any] | None]:
    """The newest score item for each of up to `BATCH_KEYS` applications, keyed by student uuid.

    `wanted` is pairs of student uuid and `latest_scored_at`, both off the cohort read, so every
    key is exact and nothing is scanned. A key DynamoDB does not return stays `None` rather than
    failing the batch — an export says which reasoning it could not read.
    """
    if not wanted:
        return {}
    if len(wanted) > BATCH_KEYS:
        raise BatchTooBig(f"{len(wanted)} keys asked for — a request takes {BATCH_KEYS}")

    by_key = {
        (application_pk(scholarship, year, student), score_sk(scored_at)): student
        for student, scored_at in wanted
    }
    found: dict[str, dict[str, Any] | None] = {student: None for _, student in by_key.items()}

    keys = [{"pk": pk, "sk": sk} for pk, sk in by_key]
    resource = boto3.resource("dynamodb")
    # DynamoDB answers what it can and hands back the rest. Two passes is enough for a read of
    # a hundred keys; anything still unprocessed is reported as not read.
    for _ in range(2):
        if not keys:
            break
        answer = resource.batch_get_item(RequestItems={TABLE_NAME: {"Keys": keys}})
        for item in answer.get("Responses", {}).get(TABLE_NAME, []):
            shaped = from_dynamo(item)
            found[by_key[(shaped["pk"], shaped["sk"])]] = shaped
        keys = answer.get("UnprocessedKeys", {}).get(TABLE_NAME, {}).get("Keys", [])

    return found


def encode_cursor(start_key: dict[str, Any] | None) -> str | None:
    """The next page's key, as one string the screen hands back untouched."""
    if not start_key:
        return None
    raw = json.dumps(from_dynamo(start_key), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def decode_cursor(cursor: str) -> dict[str, Any]:
    try:
        return json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")))
    except (ValueError, UnicodeDecodeError) as error:
        raise CursorError(f"'{cursor}' is not a page marker this read produced") from error


class CursorError(Exception):
    """The page marker cannot be read. The caller is told rather than served page one again."""


class BatchTooBig(Exception):
    """More keys than one BatchGetItem takes. The caller splits them and keeps its progress."""
