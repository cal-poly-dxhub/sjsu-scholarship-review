"""GET a scholarship's rubric versions, newest first.

`source_text` is carried: it is the file the model reads, and the dashboard compares it to tell
a weights-only change from a criteria change before anyone presses a button.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, query_param, reply
from shared.table import from_dynamo
from shared.versions import newest_first

log = logging.getLogger()
log.setLevel(logging.INFO)

LIST_FIELDS = "sk, criteria, preamble, source_file, source_text, published_at, published_by"


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        scholarship = query_param(event, "scholarship")
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    versions = [_shape(item) for item in newest_first(scholarship, projection=LIST_FIELDS)]
    log.info("read %d rubric versions for %s", len(versions), scholarship)
    return reply(200, {"scholarship": scholarship, "versions": versions})


def _shape(item: dict[str, Any]) -> dict[str, Any]:
    shaped = from_dynamo(item)
    shaped["version"] = shaped.pop("sk").removeprefix("V#")
    return shaped
