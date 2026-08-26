"""The one-off pass that gives the totals already in the table rows of their own.

Every number in the real table was scored before the model was recorded, so this is the only
thing standing between today's cohorts and a ranking that reads empty.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

from shared.table import COHORTS_PK, cohort_index_sk, cohort_pk, rank_pk, to_dynamo, total_sk

from helpers import SCHOLARSHIP, YEAR, put_application, put_scored, read

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "migrate_totals.py"


def migrate(*extra: str) -> None:
    """Run the script the way a person runs it, against the test table."""
    spec = importlib.util.spec_from_file_location("migrate_totals", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    argv = sys.argv
    sys.argv = ["migrate_totals.py", "--table", "test-scholarship", *extra]
    try:
        assert module.main() == 0
    finally:
        sys.argv = argv


def remember(table: Any) -> None:
    table.put_item(
        Item=to_dynamo(
            {
                "pk": COHORTS_PK,
                "sk": cohort_index_sk(SCHOLARSHIP, YEAR),
                "scholarship": SCHOLARSHIP,
                "year": YEAR,
            }
        )
    )


def total(table: Any, student: str, version: str) -> dict[str, Any] | None:
    return table.get_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": total_sk(version, "unknown", student)}
    ).get("Item")


def test_the_migration_writes_the_unknown_set_and_changes_no_total(table: Any) -> None:
    remember(table)
    put_scored(table, "scored", total=82.5, version="v1")
    put_application(table, "never-scored")
    # The old ranking key, which has to go: it serves a ranking no screen names a model for.
    table.update_item(
        Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": "APP#scored"},
        UpdateExpression="SET rank_pk = :old",
        ExpressionAttributeValues={":old": f"RANK#{SCHOLARSHIP}#{YEAR}#v1"},
    )
    # The total row a real run would have written is not there yet.
    table.delete_item(Key={"pk": cohort_pk(SCHOLARSHIP, YEAR), "sk": total_sk("v1", "unknown", "scored")})

    migrate()

    row = total(table, "scored", "v1")
    assert row is not None
    assert float(row["total_score"]) == 82.5
    assert row["model_id"] == "unknown"
    assert row["rank_pk"] == rank_pk(SCHOLARSHIP, YEAR, "v1", "unknown")
    assert "rank_pk" not in read(table, "scored")
    # An application with no total has nothing to migrate, and gets no row claiming otherwise.
    assert total(table, "never-scored", "v1") is None


def test_running_the_migration_twice_does_the_same_thing(table: Any) -> None:
    remember(table)
    put_scored(table, "scored", total=82.5, version="v1")

    migrate()
    migrate()

    row = total(table, "scored", "v1")
    assert row is not None
    assert float(row["total_score"]) == 82.5
