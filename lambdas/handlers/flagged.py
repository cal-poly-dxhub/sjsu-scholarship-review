"""GET one page of the review queue: where the model and the reviewers disagree.

The order is the gap index's, widest first, and nothing here or on the screen sorts afterwards.
Only an application whose gap reaches the line is in that partition, so the page needs no filter
and being in it is the whole of being flagged.

The queue crosses cohorts, because that is what the screen shows. Every row says which
scholarship it is from, so a mixed page is readable as a mixed page.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, reply
from shared.reads import PAGE, CursorError, flagged
from shared.reviewers import DISAGREEMENT

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    params = event.get("queryStringParameters") or {}
    try:
        limit = limit_of(params.get("limit"))
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    try:
        applications, cursor = flagged(limit=limit, cursor=params.get("cursor"))
    except CursorError as error:
        return reply(400, {"message": str(error)})

    log.info("%d flagged applications on this page", len(applications))
    return reply(
        200,
        {
            "applications": applications,
            "cursor": cursor,
            "disagreement_line": DISAGREEMENT,
            "why": (
                f"the model's total and the reviewers' total are at least {DISAGREEMENT:g} points"
                " out of 100 apart"
            ),
            # Nothing here is signed off and nothing here clears a flag. A gap goes away when a
            # corrected score makes it smaller, not when somebody looks at it.
            "reviewed": False,
        },
    )


def limit_of(value: str | None) -> int:
    if value is None:
        return PAGE
    try:
        return int(value)
    except ValueError:
        raise BadRequest(f"'limit' is '{value}' — it is a whole number") from None
