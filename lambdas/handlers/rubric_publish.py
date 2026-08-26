"""POST a rubric file and its weights, and write the next version for a scholarship.

Parse, validate, then write. Nothing is written to any application, and a published
version is never updated in place — a correction is the next version.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError

from shared.http import BadRequest, body_of, caller_email, reply
from shared.rubric import Criterion, RubricError, parse_rubric, validate_weights
from shared.table import rubric_pk, rubric_sk, table, to_dynamo
from shared.versions import newest_first, next_version

log = logging.getLogger()
log.setLevel(logging.INFO)

# Two people publishing at once each get their own number. More tries than that means
# something other than a race, and the caller is told rather than looped over.
VERSION_TRIES = 5


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        body = body_of(event)
        published_by = caller_email(event)
        scholarship = _required(body, "scholarship")
        source_file = _required(body, "source_file")
        source_text = _required(body, "source_text")
        weights = body.get("weights")
        if not isinstance(weights, dict):
            raise BadRequest("'weights' is missing, or is not an object of criterion id to weight")
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    taken = _version_with_file_name(scholarship, source_file)
    if taken:
        log.info("refused a rubric for %s: '%s' is already %s", scholarship, source_file, taken)
        return reply(
            422,
            {
                "message": (
                    f"'{source_file}' is the file {taken} was published from. "
                    "Give this file a name of its own so the two versions can be told apart."
                )
            },
        )

    try:
        parsed = parse_rubric(source_text)
        checked = validate_weights(parsed.criteria, weights)
    except RubricError as error:
        log.info("refused a rubric for %s: %s", scholarship, error)
        return reply(422, {"message": str(error), "line": error.line_number})

    criteria = [_criterion_item(c, checked[c.id]) for c in parsed.criteria]
    for _ in range(VERSION_TRIES):
        version = next_version(scholarship)
        published_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            _write(
                scholarship=scholarship,
                version=version,
                criteria=criteria,
                preamble=parsed.preamble,
                source_file=source_file,
                source_text=source_text,
                published_at=published_at,
                published_by=published_by,
            )
        except ClientError as error:
            if error.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            log.info("version %s of %s was taken while publishing — trying the next", version, scholarship)
            continue

        log.info("published %s of %s with %d criteria", version, scholarship, len(criteria))
        return reply(
            201,
            {
                "scholarship": scholarship,
                "version": version,
                "criteria": criteria,
                "published_at": published_at,
                "published_by": published_by,
                "note": "no application changed — a cohort reaches this version when someone starts a run",
            },
        )

    return reply(
        409,
        {"message": f"could not take a version number for {scholarship} after {VERSION_TRIES} tries"},
    )


def _required(body: dict[str, Any], name: str) -> str:
    value = body.get(name)
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"'{name}' is missing or empty")
    return value


def _version_with_file_name(scholarship: str, source_file: str) -> str | None:
    """The version already published from this file name, if there is one.

    A unique name is what lets a person tell two versions apart on screen, now that nothing else
    about them is visible. It is never what decides a recompute — that compares the contents.
    """
    for item in newest_first(scholarship, projection="sk, source_file"):
        if item.get("source_file") == source_file:
            return item["sk"].removeprefix("V#")
    return None


def _criterion_item(criterion: Criterion, weight: float) -> dict[str, Any]:
    return {
        "id": criterion.id,
        "name": criterion.name,
        "max": criterion.max,
        "weight": weight,
        "guidance": criterion.guidance,
        "levels": [
            {"value": level.value, "description": level.description} for level in criterion.levels
        ],
    }


def _write(
    *,
    scholarship: str,
    version: str,
    criteria: list[dict[str, Any]],
    preamble: str,
    source_file: str,
    source_text: str,
    published_at: str,
    published_by: str,
) -> None:
    table().put_item(
        Item=to_dynamo(
            {
                "pk": rubric_pk(scholarship),
                "sk": rubric_sk(version),
                "criteria": criteria,
                "preamble": preamble,
                "source_file": source_file,
                "source_text": source_text,
                "published_at": published_at,
                "published_by": published_by,
            }
        ),
        ConditionExpression="attribute_not_exists(sk)",
    )
