"""GET every cohort that has been ingested.

The one read that names no cohort. Every other read needs a scholarship slug and a year, and the
slug is built from the export's own wording — 'SJSU General Scholarships' becomes
'sjsu_general_scholarships' — so it cannot be typed from memory. A wrong guess answers with an
empty cohort and no way to tell that from a real one, which is what this exists to prevent.

Ingest writes these, one per cohort per run. A cohort with no applications is not here.
"""

from __future__ import annotations

import logging
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.http import reply
from shared.table import COHORTS_PK, from_dynamo, table

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(_event: dict[str, Any], _context: object) -> dict[str, Any]:
    cohorts = [_shape(item) for item in _all()]
    # Newest intake first: it is the one somebody just uploaded and the one they mean.
    cohorts.sort(key=lambda cohort: cohort.get("last_ingest_at") or "", reverse=True)
    log.info("read %d cohorts", len(cohorts))
    return reply(200, {"cohorts": cohorts})


def _all() -> list[dict[str, Any]]:
    """Every item in the cohort partition, following pages until there are none."""
    items: list[dict[str, Any]] = []
    start = None
    while True:
        page = table().query(
            KeyConditionExpression=Key("pk").eq(COHORTS_PK),
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page.get("Items", []))
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


def _shape(item: dict[str, Any]) -> dict[str, Any]:
    shaped = from_dynamo(item)
    shaped.pop("pk", None)
    shaped.pop("sk", None)
    return shaped
