"""GET one page of a cohort's ranking, in the order the index holds it.

The order is the index's. `direction` picks which end it is read from, and nothing here or on
the screen sorts anything afterwards. Only totals made under the asked-for rubric version are
in that partition, so a mixed cohort cannot come back mixed.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, query_param, reply
from shared.reads import PAGE, CursorError, ranked

log = logging.getLogger()
log.setLevel(logging.INFO)

DIRECTIONS = {"highest": True, "lowest": False}


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    params = event.get("queryStringParameters") or {}
    try:
        scholarship = query_param(event, "scholarship")
        year = query_param(event, "year")
        version = query_param(event, "rubric_version")
        highest_first = direction_of(params.get("direction", "highest"))
        limit = limit_of(params.get("limit"))
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    try:
        applications, cursor = ranked(
            scholarship=scholarship,
            year=year,
            rubric_version=version,
            highest_first=highest_first,
            limit=limit,
            cursor=params.get("cursor"),
        )
    except CursorError as error:
        return reply(400, {"message": str(error)})

    log.info(
        "ranked %d applications for %s %s at %s", len(applications), scholarship, year, version
    )
    return reply(
        200,
        {
            "scholarship": scholarship,
            "year": year,
            "rubric_version": version,
            "direction": "highest" if highest_first else "lowest",
            "applications": applications,
            "cursor": cursor,
            # Unscored, failed, and older-version applications have no place in this index.
            # Their counts come off the cohort read, which is the screen's other call.
            "covers": "applications scored under this rubric version only",
            "reviewed": False,
        },
    )


def direction_of(value: str) -> bool:
    if value not in DIRECTIONS:
        raise BadRequest(f"'direction' is '{value}' — it is 'highest' or 'lowest'")
    return DIRECTIONS[value]


def limit_of(value: str | None) -> int:
    if value is None:
        return PAGE
    try:
        return int(value)
    except ValueError:
        raise BadRequest(f"'limit' is '{value}' — it is a whole number") from None
