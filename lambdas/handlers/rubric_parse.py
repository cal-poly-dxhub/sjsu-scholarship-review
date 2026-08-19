"""POST a rubric file's text, get back what the parser made of it. Nothing is written.

The dashboard shows the criteria, maxima, and levels this returns beside the file as uploaded,
so a person sees what will be published before it is. Weights are not part of it: they are
typed on screen and checked at publish.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, body_of, reply
from shared.rubric import RubricError, parse_rubric

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        body = body_of(event)
        source_text = body.get("source_text")
        if not isinstance(source_text, str) or not source_text.strip():
            raise BadRequest("'source_text' is missing or empty")
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    try:
        parsed = parse_rubric(source_text)
    except RubricError as error:
        log.info("a rubric did not parse: %s", error)
        return reply(422, {"message": str(error), "line": error.line_number})

    return reply(
        200,
        {
            "preamble": parsed.preamble,
            "criteria": [
                {
                    "id": criterion.id,
                    "name": criterion.name,
                    "max": criterion.max,
                    "guidance": criterion.guidance,
                    "levels": [
                        {"value": level.value, "description": level.description}
                        for level in criterion.levels
                    ],
                }
                for criterion in parsed.criteria
            ],
            "checked": "the rubric's shape, not its judgement",
        },
    )
