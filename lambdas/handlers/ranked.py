"""GET one page of one set's ranking, in the order the index holds it.

A set is one rubric version and one model, and both have to be asked for: totals from two models
are not comparable, so a ranking with no model named would be the mixed ranking this exists to
prevent. Only that set's totals are in the partition, so a mixed cohort cannot come back mixed.

The order is the index's. `direction` picks which end it is read from, and nothing here or on
the screen sorts anything afterwards.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, query_param, reply, year_of
from shared.reads import PAGE, CursorError, ranked

log = logging.getLogger()
log.setLevel(logging.INFO)

DIRECTIONS = {"highest": True, "lowest": False}


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    params = event.get("queryStringParameters") or {}
    try:
        scholarship = query_param(event, "scholarship")
        year = year_of(query_param(event, "year"))
        version = query_param(event, "rubric_version")
        # No default. A ranking read with the model left off would silently pick one, and which
        # one it picked would decide the order.
        model = query_param(event, "model_id")
        highest_first = direction_of(params.get("direction", "highest"))
        limit = limit_of(params.get("limit"))
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    try:
        applications, cursor = ranked(
            scholarship=scholarship,
            year=year,
            rubric_version=version,
            model_id=model,
            highest_first=highest_first,
            limit=limit,
            cursor=params.get("cursor"),
        )
    except CursorError as error:
        return reply(400, {"message": str(error)})

    log.info(
        "ranked %d totals for %s %s at %s on %s",
        len(applications), scholarship, year, version, model,
    )
    return reply(
        200,
        {
            "scholarship": scholarship,
            "year": year,
            "rubric_version": version,
            "model_id": model,
            "direction": "highest" if highest_first else "lowest",
            "applications": applications,
            "cursor": cursor,
            # A total from another set has no place in this partition. The count of what is in
            # the other sets comes off the cohort read, which is the screen's other call.
            "covers": "totals from this rubric version on this model only",
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
