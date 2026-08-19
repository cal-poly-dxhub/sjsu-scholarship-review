"""GET one application, with the answers it gave and its newest score item.

This is the only read that opens a score item, because reasoning and evidence are the only
things stored there that a screen shows, and only this screen shows them.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, query_param, reply
from shared.reads import application

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        scholarship = query_param(event, "scholarship")
        year = query_param(event, "year")
        student = query_param(event, "student")
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    found, score = application(scholarship, year, student)
    if found is None:
        return reply(404, {"message": f"{student} is not in {scholarship} {year}"})

    log.info("read %s in %s %s, score item: %s", student, scholarship, year, score is not None)
    return reply(
        200,
        {
            "application": found,
            # None when nothing has been scored yet, or when the attempt that would have
            # written it failed. The application's own state says which.
            "score": score,
            "reviewed": False,
        },
    )
