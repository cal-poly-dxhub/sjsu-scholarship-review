"""GET what an ingest made of one uploaded file.

The person who uploaded is not in the request that reads the file — the upload goes straight to S3
and an event starts the worker afterwards — so the report is stored under the key they uploaded to
and they ask for it by that key. 404 means the file has not been read yet, which is a different
answer from a report with rejected rows in it.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, query_param, reply
from shared.table import REPORTS_PK, from_dynamo, report_sk, table

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        key = query_param(event, "key")
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    found = table().get_item(Key={"pk": REPORTS_PK, "sk": report_sk(key)}).get("Item")
    if found is None:
        return reply(
            404,
            {
                "message": f"'{key}' has not been read yet.",
                "key": key,
                "read": False,
            },
        )

    log.info("read the report for %s", key)
    return reply(200, {"key": key, "read": True, "report": from_dynamo(found)})
