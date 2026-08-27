"""The floor under a batch job, read rather than hardcoded.

Bedrock refuses a job with too few records, and the number is a service quota that can differ
per account. Both the worker that submits a job and the route that offers the batch path ask
for it here, so neither can carry a stale copy of it.
"""

from __future__ import annotations

import logging

import boto3
from botocore.exceptions import ClientError

log = logging.getLogger()


def minimum_batch_records() -> int | None:
    """The minimum records a batch job takes. None means the quota could not be read."""
    quotas = boto3.client("service-quotas")
    try:
        pages = quotas.get_paginator("list_service_quotas").paginate(ServiceCode="bedrock")
        for page in pages:
            for quota in page["Quotas"]:
                name = quota["QuotaName"].lower()
                if "minimum" in name and "record" in name and "batch" in name:
                    return int(quota["Value"])
    except ClientError as error:
        log.warning("Could not read the batch quotas: %s", error)
        return None

    log.warning("No 'minimum records per batch job' quota was found, so it was not checked.")
    return None
