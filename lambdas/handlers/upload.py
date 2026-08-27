"""POST a filename, get a URL to PUT the file to.

The file goes straight from the browser to its prefix, so it never travels through a Lambda's
6 MB request body. Landing there is what starts an ingest, and an ingest is all it starts —
nothing is scored because a file arrived.

Two kinds of file come this way and the only difference is where they land: an application
export, whose cohort is the year in its name, and a reviewer-score file, whose cohort the person
picked because the office's file names neither the scholarship nor the year.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import boto3
from botocore.config import Config

from shared.http import BadRequest, body_of, reply
from shared.rubric import slug
from shared.table import YearFormat, checked_year, year_in_filename

log = logging.getLogger()
log.setLevel(logging.INFO)

BUCKET = os.environ["BUCKET_NAME"]

EXPORT = "export"
REVIEWER_SCORES = "reviewer-scores"

# The prefix per kind. A kind is checked against this map rather than put into a path, so an
# unknown kind is a 400 and never a directory somebody named in a request body.
PREFIXES = {EXPORT: "uploads/", REVIEWER_SCORES: "reviewer-scores/"}

WHAT_STARTS = {
    EXPORT: "ingest reads the export. Nothing is scored until someone starts a run.",
    REVIEWER_SCORES: (
        "the reviewer scores are read into the cohort you picked. Nothing is scored and nothing"
        " is signed off."
    ),
}

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
        body = body_of(event)
        kind = kind_of(body)
        filename = filename_of(body)
        scholarship, year = cohort_of(body, kind, filename)
    except BadRequest as error:
        return reply(400, {"message": str(error)})
    except YearFormat as error:
        return reply(400, {"message": str(error)})

    key = key_for(kind, filename, scholarship, year)
    url = boto3.client("s3", config=SIGNER).generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=URL_SECONDS,
    )
    log.info("handed out an upload URL for %s, which is read into %s %s", key, scholarship, year)
    return reply(
        200,
        {
            "url": url,
            # The report of what the ingest made of the file is stored under this key, so the
            # screen that uploaded has something to ask for.
            "key": key,
            "kind": kind,
            "scholarship": scholarship,
            "year": year,
            "expires_in": URL_SECONDS,
            "starts": WHAT_STARTS[kind],
        },
    )


def kind_of(body: dict[str, Any]) -> str:
    """Which kind of file this is. Absent means an export, so older callers are unchanged."""
    kind = body.get("kind", EXPORT)
    if kind not in PREFIXES:
        raise BadRequest(
            f"'{kind}' is not a kind of file this takes. It takes {' or '.join(PREFIXES)}."
        )
    return str(kind)


def filename_of(body: dict[str, Any]) -> str:
    name = body.get("filename")
    if not isinstance(name, str) or not NAME.match(name):
        raise BadRequest(
            f"'{name}' is not a file name this takes — a .xlsx or .csv file name without a path"
        )
    return name


def cohort_of(body: dict[str, Any], kind: str, filename: str) -> tuple[str | None, str]:
    """The cohort the file is read into: from the picker for reviewer scores, from the name for an
    export.

    An export's cohort is the year in its own name, so a name ingest would refuse is refused here
    instead of failing quietly after the upload. A reviewer-score file names no cohort at all, so
    the person has to have picked one — asking for it now beats storing a file nothing can place.
    """
    if kind == EXPORT:
        return None, year_in_filename(filename)

    scholarship = body.get("scholarship")
    if not isinstance(scholarship, str) or slug(scholarship) != scholarship.strip():
        raise BadRequest(
            "no scholarship given for these reviewer scores. Pick a cohort first — the file does"
            " not say which one it belongs to."
        )
    year = body.get("year")
    if not isinstance(year, str):
        raise BadRequest(
            "no academic year given for these reviewer scores. Pick a cohort first — the file does"
            " not say which one it belongs to."
        )
    return scholarship.strip(), checked_year(year)


def key_for(kind: str, filename: str, scholarship: str | None, year: str) -> str:
    """Where the file lands. The cohort is in the key, because the worker reads the key."""
    if kind == EXPORT:
        return f"{PREFIXES[EXPORT]}{filename}"
    return f"{PREFIXES[REVIEWER_SCORES]}{scholarship}/{year}/{filename}"
