"""POST a filename, get a URL to PUT the export to.

The file goes straight from the browser to the uploads prefix, so an export never travels
through a Lambda's 6 MB request body. Landing there is what starts ingest, and ingest is all
it starts — nothing is scored because an export arrived.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import boto3
from botocore.config import Config

from shared.http import BadRequest, body_of, reply
from shared.table import YearFormat, year_in_filename

log = logging.getLogger()
log.setLevel(logging.INFO)

BUCKET = os.environ["BUCKET_NAME"]
UPLOADS = "uploads/"

# SigV4 signs the host and nothing else, so the browser is free to send whatever Content-Type it
# reads off the file. The older scheme signs Content-Type as well, and boto3 still picks it here —
# every upload then comes back 403 SignatureDoesNotMatch and no header the browser sets can fix it.
SIGNER = Config(signature_version="s3v4")

# Only what the EventBridge rule watches for, so an upload cannot land somewhere nothing reads.
# Parentheses are allowed because the report tool puts them in every name it writes, as in
# 'SJSU General Scholarship 25-26 ad hoc report(ScholarshipManagerData (22)).csv'.
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ()._-]{0,120}\.(xlsx|csv)$")

# Long enough to send a few thousand rows over a slow connection, short enough that a leaked
# URL is not a standing write.
URL_SECONDS = 900


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    try:
        filename = filename_of(body_of(event))
        # The year in the name is the cohort ingest will write to, so a name ingest would
        # refuse is refused here instead of failing quietly after the upload.
        year = year_in_filename(filename)
    except BadRequest as error:
        return reply(400, {"message": str(error)})
    except YearFormat as error:
        return reply(400, {"message": str(error)})

    key = f"{UPLOADS}{filename}"
    url = boto3.client("s3", config=SIGNER).generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=URL_SECONDS,
    )
    log.info("handed out an upload URL for %s, which ingest reads into %s", key, year)
    return reply(
        200,
        {
            "url": url,
            "key": key,
            "year": year,
            "expires_in": URL_SECONDS,
            "starts": "ingest reads the export. Nothing is scored until someone starts a run.",
        },
    )


def filename_of(body: dict[str, Any]) -> str:
    name = body.get("filename")
    if not isinstance(name, str) or not NAME.match(name):
        raise BadRequest(
            f"'{name}' is not an export name — it is a .xlsx or .csv file name without a path"
        )
    return name
