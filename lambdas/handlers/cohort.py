"""GET one cohort's applications, without their essays, plus what the cohort is doing.

This is the read behind search, the state badges, and every progress count. Search itself is
the screen's, over what this returns — nothing here matches text, and nothing here reads
`qa_pairs`, so a word from an essay is not findable by design.
"""

from __future__ import annotations

import logging
from typing import Any

from shared.http import BadRequest, query_param, reply, year_of
from shared.reads import cohort, counts, set_counts, set_totals, with_set

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event: dict[str, Any], _context: object) -> dict[str, Any]:
    params = event.get("queryStringParameters") or {}
    try:
        scholarship = query_param(event, "scholarship")
        year = year_of(query_param(event, "year"))
    except BadRequest as error:
        return reply(400, {"message": str(error)})

    applications = cohort(scholarship, year)
    counted = counts(applications, set_counts(scholarship, year))

    # A screen that names a set gets that set's numbers on every row. Without it the rows carry
    # the item's copy of its newest total, whichever set made it, and a mixed cohort reads mixed.
    version = params.get("rubric_version")
    model = params.get("model_id")
    if version and model:
        applications = with_set(applications, set_totals(scholarship, year, version, model))

    log.info("read %d applications for %s %s", len(applications), scholarship, year)
    return reply(
        200,
        {
            "scholarship": scholarship,
            "year": year,
            "rubric_version": version,
            "model_id": model,
            "applications": applications,
            **counted,
            "searchable": "the applicant id and the stored fields — not essay text",
            "reviewed": False,
        },
    )
