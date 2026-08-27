"""Rubric versions: reading a scholarship's versions and working out the next number.

Version sort keys are `V#v1`, `V#v2`, … so they do not order lexicographically past nine.
A scholarship has tens of versions at most, so they are read in one Query and ordered by
their number here.
"""

from __future__ import annotations

import re
from typing import Any

from boto3.dynamodb.conditions import Key

from . import table as tbl

VERSION_SK = re.compile(r"^V#v(?P<number>\d+)$")


def version_number(sort_key: str) -> int:
    found = VERSION_SK.match(sort_key)
    if not found:
        raise ValueError(f"'{sort_key}' is not a rubric version sort key")
    return int(found.group("number"))


def newest_first(scholarship: str, projection: str | None = None) -> list[dict[str, Any]]:
    """A scholarship's versions, newest first. One Query, no index."""
    query: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq(tbl.rubric_pk(scholarship))
        & Key("sk").begins_with("V#")
    }
    if projection:
        query["ProjectionExpression"] = projection

    items: list[dict[str, Any]] = []
    while True:
        page = tbl.table().query(**query)
        items.extend(page.get("Items", []))
        start = page.get("LastEvaluatedKey")
        if not start:
            break
        query["ExclusiveStartKey"] = start

    return sorted(items, key=lambda item: version_number(item["sk"]), reverse=True)


def prompt_shape(version: dict[str, Any]) -> tuple[Any, ...]:
    """Everything in a version that the model saw. Weights are not in it — they are arithmetic.

    The rubric file is sent whole, so it stands for the preamble, the guidance, and the level
    descriptions: a change to any of them is a change to the file. What the file does not carry
    is the ids and maxima, which reach the model through the output contract instead.
    """
    return (
        str(version.get("source_text", "")),
        tuple(
            (str(criterion["id"]), str(criterion["name"]), int(criterion["max"]))
            for criterion in version.get("criteria", [])
        ),
    )


def weights_only_change(stored: dict[str, Any], target: dict[str, Any]) -> bool:
    """True when the two versions differ in weights alone, so a total can be recomputed.

    Anything the prompt carried counts as a criteria change, guidance and preamble included: the
    stored per-criterion scores answer the text the model was given, and arithmetic cannot
    produce scores for text it never saw.
    """
    return prompt_shape(stored) == prompt_shape(target)


def next_version(scholarship: str) -> str:
    """The version name one past the highest already published: `v1` for a new scholarship."""
    versions = newest_first(scholarship, projection="sk")
    highest = version_number(versions[0]["sk"]) if versions else 0
    return f"v{highest + 1}"
