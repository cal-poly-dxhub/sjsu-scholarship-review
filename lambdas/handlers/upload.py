"""POST a filename, get a URL to PUT the workbook to.

The file goes straight from the browser to the uploads prefix, so a workbook never travels
through a Lambda's 6 MB request body. Landing there is what starts ingest, and ingest is all
it starts — nothing is scored because a workbook arrived.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import boto3

from shared.http import BadRequest, body_of, reply

log = logging.getLogger()
log.setLevel(logging.INFO)

BUCKET = os.environ["BUCKET_NAME"]
UPLOADS = "uploads/"

# Only what the EventBridge rule watches for, so an upload cannot land somewhere nothing reads.
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}\.xlsx$")

# Long enough to send a few thousand rows over a slow connection, short enough that a leaked
# URL is not a standing write.
URL_SECONDS = 900


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        filename = filename_of(body_of(event))
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    key = f"{UPLOADS}{filename}"
    url = boto3.client("s3").generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=URL_SECONDS,
    )
    log.info("handed out an upload URL for %s", key)
    return reply(
        200,
        {
            "url": url,
            "key": key,
            "expires_in": URL_SECONDS,
            "starts": "ingest reads the workbook. Nothing is scored until someone starts a run.",
        },
    )


def filename_of(body: dict[str, Any]) -> str:
    name = body.get("filename")
    if not isinstance(name, str) or not NAME.match(name):
        raise BadRequest(
            f"'{name}' is not a workbook name — it is a .xlsx file name without a path"
        )
    return name
