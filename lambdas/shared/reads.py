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
    UNKNOWN_MODEL,
    application_pk,
    application_sk,
    cohort_pk,
    from_dynamo,
    rank_pk,
    score_sk,
    set_of,
    table,
    total_prefix,
)

# What a list, a search, and the counts need. `qa_pairs` is left out, and so are the fields
# that are the workers' bookkeeping rather than anything a person reads: `content_hash`,
# `source`, `claimed_by`.
COHORT_FIELDS = (
    "pk, sk, student_uuid, scholarship, #year, #status, academic_program, academic_level,"
    " major, gpa, category_scores, total_score, rubric_version, model_id,"
    " latest_scored_at, claimed_until, attempt, failure, last_error, parsed_at"
)

# The index projects these, so asking for more would fetch the base item and undo the point
# of a narrow projection. A ranked row is a total, so the applicant's own fields are not on it —
# the screen joins to the cohort read by student uuid, which comes out of the row's own key.
RANKED_FIELDS = "pk, sk, rank_pk, total_score, rubric_version, category_scores"

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


def set_key(rubric_version: str, model_id: str) -> str:
    """How a set is named in a count and asked for by a screen: one version, one model."""
    return f"{rubric_version}#{model_id}"


def set_counts(scholarship: str, year: str) -> dict[str, int]:
    """How many totals the cohort holds in each set. Keys only — the numbers are not read here.

    Every set present is counted, including ones no screen is showing, because a set nobody
    names reads as missing totals rather than as totals somewhere else.
    """
    found: dict[str, int] = {}
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
            & Key("sk").begins_with(total_prefix()),
            "ProjectionExpression": "sk",
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table().query(**request)
        for item in page.get("Items", []):
            version, model, _ = set_of(str(item["sk"]))
            key = set_key(version, model)
            found[key] = found.get(key, 0) + 1
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found


def set_totals(
    scholarship: str, year: str, rubric_version: str, model_id: str
) -> list[dict[str, Any]]:
    """Every total in one set, by prefix. Each carries the student it belongs to."""
    found: list[dict[str, Any]] = []
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
            & Key("sk").begins_with(total_prefix(rubric_version, model_id)),
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table().query(**request)
        found.extend(from_dynamo(item) for item in page.get("Items", []))
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return found


# The application item's copy of its newest total. A screen showing one set replaces all of
# them together, so a row never mixes one set's number with another's per-criterion scores.
SET_FIELDS = ("total_score", "category_scores", "rubric_version", "model_id", "latest_scored_at")


def with_set(
    applications: list[dict[str, Any]], totals: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Each application carrying one set's total, or none if that set has no total for it.

    The item keeps a copy of its newest total whatever set made it, so without this a row would
    read as scored on a model it was never scored on. Everything else about the item — status,
    the claim, the failure — is left as it is.
    """
    by_student = {str(total["student_uuid"]): total for total in totals}
    shaped = []
    for item in applications:
        total = by_student.get(str(item.get("student_uuid")))
        if total is None:
            shaped.append({**item, **dict.fromkeys(SET_FIELDS)})
            continue
        shaped.append(
            {
                **item,
                "total_score": total.get("total_score"),
                "category_scores": total.get("category_scores"),
                "rubric_version": total.get("rubric_version"),
                "model_id": total.get("model_id"),
                "latest_scored_at": total.get("scored_at"),
            }
        )
    return shaped


def counts(applications: list[dict[str, Any]], sets: dict[str, int]) -> dict[str, Any]:
    """What the cohort is doing. This is the whole of run progress — no run item is stored.

    The states come off the application items, which hold the claim and the newest total.
    `scored_by_set` comes off the totals themselves, so a cohort scored on two models reports
    both counts rather than only the newer one.
    """
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

    return {
        "total": len(applications),
        "states": states,
        "scored_by_rubric_version": versions,
        "scored_by_set": sets,
    }


def ranked(
    *,
    scholarship: str,
    year: str,
    rubric_version: str,
    model_id: str,
    highest_first: bool = True,
    limit: int = PAGE,
    cursor: str | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """One page of one set's totals, in the order the index holds them.

    A ranking is one rubric version and one model, because that is what the partition is. The
    index does not project the student uuid or the model, so both are read back out of each
    row's own sort key — the screen joins to the cohort read on the uuid for the applicant's
    fields.
    """
    request: dict[str, Any] = {
        "IndexName": RANK_INDEX_NAME,
        "KeyConditionExpression": Key("rank_pk").eq(
            rank_pk(scholarship, year, rubric_version, model_id)
        ),
        "ProjectionExpression": RANKED_FIELDS,
        # The index is in ascending total order, so reading backwards is what "highest" means.
        "ScanIndexForward": not highest_first,
        "Limit": min(max(limit, 1), MAX_PAGE),
    }
    if cursor:
        request["ExclusiveStartKey"] = decode_cursor(cursor)

    page = table().query(**request)
    items = []
    for row in page.get("Items", []):
        shaped = from_dynamo(row)
        version, model, student = set_of(str(shaped["sk"]))
        items.append(
            {**shaped, "rubric_version": version, "model_id": model, "student_uuid": student}
        )
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


def scores_by_set(scholarship: str, year: str, student_uuid: str) -> list[dict[str, Any]]:
    """One line per set this application has been scored in: its newest attempt in that set.

    Read off the score items, which have carried the model since they were first written, so
    comparing two models on one applicant needs no other read. Newest first.
    """
    newest: dict[str, dict[str, Any]] = {}
    start_key: dict[str, Any] | None = None
    while True:
        request: dict[str, Any] = {
            "KeyConditionExpression": Key("pk").eq(application_pk(scholarship, year, student_uuid))
            & Key("sk").begins_with("SCORE#"),
            "ProjectionExpression": "sk, total_score, rubric_version, model_id, #status",
            "ExpressionAttributeNames": {"#status": "status"},
            # The sort key is the timestamp, so backwards is newest first and the first hit for
            # a set is the one kept.
            "ScanIndexForward": False,
        }
        if start_key:
            request["ExclusiveStartKey"] = start_key
        page = table().query(**request)
        for row in page.get("Items", []):
            item = from_dynamo(row)
            if item.get("status") != "ok" or item.get("total_score") is None:
                continue
            # A score item written before the model was recorded belongs to the unknown set,
            # not to today's default.
            version = str(item.get("rubric_version", "unknown"))
            model = str(item.get("model_id", UNKNOWN_MODEL))
            key = set_key(version, model)
            newest.setdefault(
                key,
                {
                    "rubric_version": version,
                    "model_id": model,
                    "total_score": item["total_score"],
                    "scored_at": str(item["sk"]).removeprefix("SCORE#"),
                },
            )
        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            return sorted(newest.values(), key=lambda one: one["scored_at"], reverse=True)


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
