"""Reviewer-score ingest: an uploaded reviewer-score file becomes one item per reviewer, and a gap.

The file is the office's export of what the chairs scored. It names applicants by `Candidate` —
the last 12 hex characters of the intake export's `Student` uuid, uppercased — and it names no
cohort at all, so the cohort comes out of the object key the upload handler built.

Every row is matched to an application by that identifier exactly. A row whose identifier is
damaged, missing, or not in the cohort is reported with its row number and never placed by
guesswork: Excel turns some of these identifiers into scientific notation before the file reaches
us, and a near-match would put a reviewer's score on the wrong applicant.

A reviewer's total comes from their per-criterion scores and the weights of the rubric version that
produced the model's total, worked out by `shared.gaps` — the same arithmetic a scoring run uses, so
either order of arrival gives the same gap. The file's own `Weighted Points` column is read past: it
does not reproduce from the per-criterion scores, so it is not the number the model's total is on.

A file read before the cohort has been scored still stores every mark. There is nothing to compare
them against yet, so the report says how many are waiting rather than reporting no disagreements.

Nothing here scores, and nothing here signs off. What it adds is a number: how far apart the model
and the reviewers are.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Iterator

from shared import reads
from shared.gaps import (
    criteria_of,
    criterion_shape,
    rebuild_summary,
    reviewer_total,
    store_gap,
)
from shared.reviewers import DISAGREEMENT, reviewer_name_slug
from shared.rows import RowsError, cell, read_rows
from shared.table import (
    REPORTS_PK,
    application_pk,
    cohort_of,
    report_sk,
    reviewer_sk,
    table,
    to_dynamo,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

PREFIX = os.environ.get("REVIEWER_SCORE_PREFIX", "reviewer-scores/")

# The two ways the office exports. Anything else under the prefix is somebody else's file, so it
# is left alone rather than failed.
SUFFIXES = (".xlsx", ".csv")

CANDIDATE = "Candidate"

# How many rejected rows the stored report lists. A file whose rows nearly all miss — the office's
# 26-27 file rejects 4,525 of 4,880 — makes a report far past DynamoDB's 400 KB item limit, and a
# report that cannot be written leaves the screen waiting forever. The count is kept in full, so
# nothing is hidden: the screen says how many there were and that the list is shortened.
REPORTED_REJECTS = 200

# The file's column names against the rubric's criterion ids. The file names its criteria by
# position and in its own words, so this is the only place the two vocabularies meet.
CRITERION_COLUMNS = {
    "Chair: 1) Essay Response: SJSU Journey": "career_goals_essay",
    "Chair: 2) Essay Response: Personal Challenge": "challenge_essay",
    "Chair: 3) Extracurricular Activities": "extracurricular_activities",
    "Chair: 4) Initiative & Self-Motivation": "initiative_self_motivation",
    "Chair: 5) Creativity": "creativity",
}

COLUMNS = (CANDIDATE, *CRITERION_COLUMNS)

# An identifier as the office exports it. Anything else has been damaged on the way here —
# '2.56655E+11' is what Excel makes of an all-digit one.
IDENTIFIER = re.compile(r"^[0-9A-F]{12}$")

# A criterion cell is a text block: the average the file worked out, then one line per reviewer.
# The average is recomputed from the lines, so the line it is on is read past.
AVERAGE_LINE = re.compile(r"^average\s+score\s*:", re.IGNORECASE)
REVIEWER_LINE = re.compile(r"^(?P<name>.+?)\s*:\s*(?P<score>-?\d+(?:\.\d+)?)$")


class ReviewerIngestError(Exception):
    """The file cannot be read at all. Nothing was written."""


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Entry point for one EventBridge `Object Created` event from the environment bucket."""
    detail = event["detail"]
    bucket = detail["bucket"]["name"]
    key = detail["object"]["key"]

    if not key.startswith(PREFIX) or not key.endswith(SUFFIXES):
        logger.info("Not a reviewer-score file under %s, left alone: %s", PREFIX, key)
        return {"skipped": key}
    if key.endswith(".xlsx") and key.split("/")[-1].startswith("~$"):
        logger.info("Office lock file, left alone: %s", key)
        return {"skipped": key}

    return ingest_file(bucket, key)


def ingest_file(bucket: str, key: str) -> dict[str, Any]:
    """Read one reviewer-score file into its cohort. Returns the report it stored."""
    try:
        scholarship, year = cohort_from_key(key)
        rows = read_rows(bucket, key, columns=COLUMNS, what="reviewer-score file")
        applications = reads.cohort(scholarship, year)
        placed, rejected = collect(rows, applications)
    except (ReviewerIngestError, RowsError) as error:
        return store_report(refusal(key, str(error)))

    stored = 0
    awaiting = 0
    for application, per_reviewer in placed:
        reviewers, comparable = write_reviewers(
            scholarship, application, per_reviewer, source=key
        )
        stored += reviewers
        if not comparable:
            awaiting += 1

    summary = rebuild_summary(scholarship, year)

    if awaiting:
        logger.info(
            "%s of %s applications have reviewer marks and no model total to compare them"
            " against. Their gaps settle when the cohort is scored.",
            awaiting,
            len(placed),
        )

    return store_report(
        {
            "file": key,
            "scholarship": scholarship,
            "year": year,
            "rows_read": len(placed) + len(rejected),
            "applications_placed": len(placed),
            "reviewer_scores_stored": stored,
            "rejected_rows": rejected[:REPORTED_REJECTS],
            "rejected_total": len(rejected),
            "flagged": summary["flagged"],
            "awaiting_scores": awaiting,
            "disagreement_line": DISAGREEMENT,
        }
    )


def cohort_from_key(key: str) -> tuple[str, str]:
    """The cohort out of `reviewer-scores/<scholarship>/<year>/<filename>`.

    The file names neither, so the key is the only place the cohort is written down. A key that
    does not carry one is refused rather than guessed at — a guess writes reviewer scores into a
    cohort nobody picked.
    """
    parts = key.split("/")
    if len(parts) != 4 or not parts[1] or not parts[2]:
        raise ReviewerIngestError(
            f"'{key}' does not say which cohort it belongs to. A reviewer-score file is uploaded"
            " to reviewer-scores/<scholarship>/<year>/<filename>."
        )
    return parts[1], parts[2]


def collect(
    rows: Iterator[dict[str, Any]], applications: list[dict[str, Any]]
) -> tuple[list[tuple[dict[str, Any], dict[str, dict[str, float]]]], list[dict[str, Any]]]:
    """Match each row to an application and take its cells apart.

    Returns the rows it placed, each with the reviewers it named and what each of them scored, and
    every row it could not place with the reason.
    """
    by_identifier = {
        str(application["student_uuid"])[-12:].upper(): application
        for application in applications
        if application.get("student_uuid")
    }

    placed: list[tuple[dict[str, Any], dict[str, dict[str, float]]]] = []
    rejected: list[dict[str, Any]] = []
    seen: dict[str, int] = {}

    for offset, row in enumerate(rows):
        number = offset + 2  # the header is row 1
        identifier = (cell(row.get(CANDIDATE)) or "").strip().upper()

        if not identifier:
            rejected.append({"row": number, "reason": "the row names no applicant"})
            continue
        if not IDENTIFIER.match(identifier):
            rejected.append(
                {
                    "row": number,
                    "candidate": identifier,
                    "reason": (
                        f"'{identifier}' is not an applicant identifier — it has been damaged"
                        " before the file got here, most likely by a spreadsheet. Export it again"
                        " with the identifier column as text."
                    ),
                }
            )
            continue
        if identifier not in by_identifier:
            rejected.append(
                {
                    "row": number,
                    "candidate": identifier,
                    "reason": f"no application in this cohort has the identifier {identifier}",
                }
            )
            continue
        if identifier in seen:
            rejected.append(
                {
                    "row": number,
                    "candidate": identifier,
                    "kept_row": seen[identifier],
                    "reason": (
                        f"row {seen[identifier]} is the same applicant, so this row was not read"
                    ),
                }
            )
            continue

        try:
            per_reviewer = row_scores(row)
        except Unreadable as error:
            rejected.append({"row": number, "candidate": identifier, "reason": str(error)})
            continue

        if not per_reviewer:
            rejected.append(
                {"row": number, "candidate": identifier, "reason": "no reviewer scored this row"}
            )
            continue

        seen[identifier] = number
        placed.append((by_identifier[identifier], per_reviewer))

    return placed, rejected


class Unreadable(Exception):
    """A cell that cannot be taken apart. The row is reported, never read as a zero."""


def row_scores(row: dict[str, Any]) -> dict[str, dict[str, float]]:
    """What each reviewer named in this row scored, keyed by their display name."""
    per_reviewer: dict[str, dict[str, float]] = {}
    for column, criterion_id in CRITERION_COLUMNS.items():
        for name, score in cell_scores(cell(row.get(column)), column):
            per_reviewer.setdefault(name, {})[criterion_id] = score
    return per_reviewer


def cell_scores(text: str | None, column: str) -> list[tuple[str, float]]:
    """The reviewers a criterion cell names and the score each gave.

    A blank cell is nobody scoring, which is different from everybody scoring zero. A line that
    does not read as a name and a score stops the row: a cell half-read is a total that is wrong
    by however much was in the half nobody saw.
    """
    if not text:
        return []

    found: list[tuple[str, float]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or AVERAGE_LINE.match(line):
            continue
        match = REVIEWER_LINE.match(line)
        if not match:
            raise Unreadable(f"'{line}' under '{column}' does not read as a reviewer and a score")
        found.append((match.group("name").strip(), float(match.group("score"))))
    return found


def write_reviewers(
    scholarship: str,
    application: dict[str, Any],
    per_reviewer: dict[str, dict[str, float]],
    *,
    source: str,
) -> tuple[int, bool]:
    """Store each reviewer's scores for one application, then its gap.

    Returns how many reviewers were stored and whether the gap could be measured. It cannot be
    where the model has not scored the application yet — the marks are kept and the gap settles
    when the score lands.
    """
    criteria = criteria_of(scholarship, application.get("rubric_version"))
    totals: list[float] = []

    for name, scores in per_reviewer.items():
        total = reviewer_total(scores, criteria, application)
        if total is not None:
            totals.append(total)
        store_reviewer(application, name=name, scores=scores, total=total, source=source)

    store_gap(
        application,
        stored=len(per_reviewer),
        totals=totals,
        per_criterion=criterion_shape(per_reviewer),
    )
    return len(per_reviewer), bool(totals)


def store_reviewer(
    application: dict[str, Any],
    *,
    name: str,
    scores: dict[str, float],
    total: float | None,
    source: str,
) -> None:
    """One reviewer's scores for one application.

    An `update_item` on a key built from the reviewer's name, so a corrected file replaces that
    reviewer's scores without touching another reviewer's and without leaving two records of one.
    """
    scholarship, year, student = cohort_of(application)

    sets = [
        "reviewer_name = :name",
        "category_scores = :scores",
        "#source = :source",
        "stored_at = :at",
    ]
    values: dict[str, Any] = {
        ":name": name,
        ":scores": scores,
        ":source": source,
        ":at": stamp(),
    }
    expression = "SET " + ", ".join(sets)
    if total is None:
        # A total from an earlier file would read as this reviewer's, so it goes.
        expression += " REMOVE total_score, rubric_version"
    else:
        expression += ", total_score = :total, rubric_version = :version"
        values[":total"] = total
        values[":version"] = application["rubric_version"]

    table().update_item(
        Key={
            "pk": application_pk(scholarship, year, student),
            "sk": reviewer_sk(reviewer_name_slug(name)),
        },
        UpdateExpression=expression,
        ExpressionAttributeNames={"#source": "source"},
        ExpressionAttributeValues=to_dynamo(values),
    )


def refusal(key: str, reason: str) -> dict[str, Any]:
    """The report for a file that was refused whole, so the screen does not wait for one."""
    return {
        "file": key,
        "refused": reason,
        "rows_read": 0,
        "applications_placed": 0,
        "reviewer_scores_stored": 0,
        "rejected_rows": [],
    }


def store_report(report: dict[str, Any]) -> dict[str, Any]:
    """Keep the report under the key that was uploaded, because the uploader is not in this
    request. The screen that handed out that key polls for it."""
    table().put_item(
        Item=to_dynamo({"pk": REPORTS_PK, "sk": report_sk(report["file"]), **report, "at": stamp()})
    )
    logger.info("Read %s: %s", report["file"], json.dumps(report, default=str))
    return report


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
