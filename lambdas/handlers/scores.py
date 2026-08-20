"""POST the keys of up to a hundred applications, GET their newest score items back.

This is the read behind an export that carries reasoning. The keys come from the cohort read
the screen already made, and the screen sends one request per hundred so it can show progress.
An application whose score item is missing comes back as `null` — the export says so rather
than failing whole.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, body_of, reply, year_of
from shared.reads import BATCH_KEYS, BatchTooBig, newest_scores

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        body = body_of(event)
        scholarship = text(body, "scholarship")
        year = year_of(text(body, "year"))
        wanted = keys_of(body)
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    try:
        scores = newest_scores(scholarship, year, wanted)
    except BatchTooBig as error:
        return reply(400, {"message": str(error)})

    read = sum(1 for item in scores.values() if item is not None)
    log.info("read %d of %d score items for %s %s", read, len(wanted), scholarship, year)
    return reply(200, {"scores": scores, "asked": len(wanted), "read": read})


def text(body: dict[str, Any], name: str) -> str:
    value = body.get(name)
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"'{name}' is missing from the body")
    return value.strip()


def keys_of(body: dict[str, Any]) -> list[tuple[str, str]]:
    """The applicant and the score timestamp for each application asked about."""
    entries = body.get("applications")
    if not isinstance(entries, list):
        raise BadRequest("'applications' is missing from the body")
    if len(entries) > BATCH_KEYS:
        raise BadRequest(f"{len(entries)} applications asked for — a request takes {BATCH_KEYS}")

    wanted: list[tuple[str, str]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise BadRequest("an entry in 'applications' is not an object")
        student = entry.get("student_uuid")
        scored_at = entry.get("latest_scored_at")
        if not isinstance(student, str) or not isinstance(scored_at, str):
            raise BadRequest("every entry needs a 'student_uuid' and a 'latest_scored_at'")
        wanted.append((student, scored_at))
    return wanted
