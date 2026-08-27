"""The presigned upload URL.

One thing here is worth a test and it is not the name check. A presigned URL signed the older way
signs Content-Type too, and the browser sets Content-Type off the file it is sending — so every
upload comes back 403 with a signature the caller cannot influence, and nothing in the API's own
logs says anything went wrong. SigV4 signs the host and nothing else.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from moto import mock_aws

from handlers import upload


def call(filename: Any) -> dict[str, Any]:
    with mock_aws():
        return upload.handler({"body": json.dumps({"filename": filename})}, None)


def test_the_url_is_signed_so_the_browsers_content_type_cannot_break_it() -> None:
    answer = call("SJSU General Scholarship 25-26 ad hoc report(ScholarshipManagerData (22)).csv")
    assert answer["statusCode"] == 200

    body = json.loads(answer["body"])
    signed = parse_qs(urlparse(body["url"]).query)

    # The v4 marker. The older scheme writes AWSAccessKeyId, Expires, and Signature instead, and
    # folds Content-Type into what it signs.
    assert "X-Amz-Signature" in signed
    assert signed["X-Amz-SignedHeaders"] == ["host"]
    assert body["year"] == "2025-2026"


@pytest.mark.parametrize(
    "filename",
    [
        "notes.pdf",  # ingest would never read it
        "uploads/SJSU General Scholarship 25-26.csv",  # a path, not a name
        "SJSU General Scholarship.csv",  # no year, so no cohort to write to
    ],
)
def test_a_name_no_cohort_could_be_read_from_is_refused_before_the_upload(filename: str) -> None:
    """A refusal after the upload is a file sitting in the bucket that nothing will ever read."""
    assert call(filename)["statusCode"] == 400
