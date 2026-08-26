"""Give every total already stored a row of its own, in the `unknown` set.

Before this change a total lived on the application item and the model that made it was not
recorded. Now a total is its own row, keyed by rubric version and model, and a ranking reads
those rows. So the totals already in the table need rows, and they cannot claim a model: every
one of them came from Haiku 4.5, but nothing in the table says so, and writing Haiku onto them
would be a guess dressed as a record. They become the `unknown` set.

The pass also takes `rank_pk` off the application item. Left there, its old value keeps serving
a ranking no screen names a model for.

Nothing here changes a total. It is idempotent: run it twice and the second run writes the same
rows and reports the same numbers.

    uv run python scripts/migrate_totals.py --table dev-sjsu-scholarship
    uv run python scripts/migrate_totals.py --table dev-sjsu-scholarship --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", required=True, help="the table to migrate")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="say what would be written and write nothing",
    )
    args = parser.parse_args()

    # `shared.table` reads TABLE_NAME at import, so the name has to be set before it is imported.
    os.environ["TABLE_NAME"] = args.table
    from boto3.dynamodb.conditions import Key

    from shared.table import (
        COHORTS_PK,
        UNKNOWN_MODEL,
        cohort_pk,
        rank_pk,
        table,
        to_dynamo,
        total_sk,
    )

    cohorts = [
        str(item["sk"]).split("#", 1)
        for item in table()
        .query(KeyConditionExpression=Key("pk").eq(COHORTS_PK))
        .get("Items", [])
    ]
    if not cohorts:
        print(f"{args.table} lists no cohorts. Nothing to migrate.")
        return 0

    written = 0
    unscored = 0
    keys_removed = 0

    for scholarship, year in cohorts:
        start_key: dict[str, Any] | None = None
        while True:
            request: dict[str, Any] = {
                "KeyConditionExpression": Key("pk").eq(cohort_pk(scholarship, year))
                & Key("sk").begins_with("APP#"),
                "ProjectionExpression": (
                    "sk, total_score, category_scores, rubric_version, latest_scored_at, rank_pk"
                ),
            }
            if start_key:
                request["ExclusiveStartKey"] = start_key
            page = table().query(**request)

            for item in page.get("Items", []):
                student = str(item["sk"]).removeprefix("APP#")
                version = item.get("rubric_version")
                if item.get("total_score") is None or not version:
                    unscored += 1
                    continue

                if not args.dry_run:
                    table().put_item(
                        Item=to_dynamo(
                            {
                                "pk": cohort_pk(scholarship, year),
                                "sk": total_sk(str(version), UNKNOWN_MODEL, student),
                                "student_uuid": student,
                                "rubric_version": str(version),
                                "model_id": UNKNOWN_MODEL,
                                "total_score": item["total_score"],
                                "category_scores": item.get("category_scores", {}),
                                "rank_pk": rank_pk(
                                    scholarship, year, str(version), UNKNOWN_MODEL
                                ),
                                "scored_at": item.get("latest_scored_at"),
                                "migrated": True,
                            }
                        )
                    )
                written += 1

                if "rank_pk" in item:
                    if not args.dry_run:
                        table().update_item(
                            Key={"pk": cohort_pk(scholarship, year), "sk": item["sk"]},
                            UpdateExpression="REMOVE rank_pk",
                        )
                    keys_removed += 1

            start_key = page.get("LastEvaluatedKey")
            if not start_key:
                break

    what = "would write" if args.dry_run else "wrote"
    print(f"{len(cohorts)} cohorts. {what} {written} totals in the unknown set.")
    print(f"{keys_removed} application items still carried rank_pk. {unscored} were not scored.")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lambdas"))
    raise SystemExit(main())
