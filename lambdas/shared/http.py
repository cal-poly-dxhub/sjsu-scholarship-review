"""Reading an API Gateway HTTP API event and answering it.

Payload format 2.0. No CORS headers: the API and the site are one origin, which is the
point of the front door.
"""

from __future__ import annotations

import json
from typing import Any

from .table import YearFormat, checked_year


class BadRequest(Exception):
    """What the caller sent cannot be worked with. Answered as 400, not raised at the runtime."""


def reply(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def body_of(event: dict[str, Any]) -> dict[str, Any]:
    """The request body as a dict. A body that is not a JSON object is a 400."""
    raw = event.get("body")
    if not raw:
        raise BadRequest("the request has no body")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BadRequest(f"the request body is not JSON: {error.msg}") from error
    if not isinstance(parsed, dict):
        raise BadRequest("the request body is not a JSON object")
    return parsed


def year_of(value: str) -> str:
    """An academic year a cohort key can be built from, or a 400 that says the form."""
    try:
        return checked_year(value)
    except YearFormat as error:
        raise BadRequest(str(error)) from error


def query_param(event: dict[str, Any], name: str) -> str:
    value = (event.get("queryStringParameters") or {}).get(name)
    if not value:
        raise BadRequest(f"'{name}' is missing from the query string")
    return value


def caller_email(event: dict[str, Any]) -> str:
    """The signed-in account's email, for provenance. Nothing decides access from it."""
    claims = (
        event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    )
    email = claims.get("email")
    if not email:
        raise BadRequest("the token carries no email claim")
    return email
