"""Reviewer-score ingest: an uploaded reviewer-score file becomes one item per reviewer, and a gap.

The file is the office's export of what the chairs scored. It names applicants by `Candidate` —
the last 12 hex characters of the intake export's `Student` uuid, uppercased — and it names no
cohort at all, so the cohort comes out of the object key the upload handler built.

Every row is matched to an application by that identifier exactly. A row whose identifier is
damaged, missing, or not in the cohort is reported with its row number and never placed by
guesswork: Excel turns some of these identifiers into scientific notation before the file reaches
us, and a near-match would put a reviewer's score on the wrong applicant.

A reviewer's total is worked out here from their per-criterion scores and the weights of the rubric
version that produced the model's total. The file's own `Weighted Points` column is read past — it
does not reproduce from the per-criterion scores, so it is not the number the model's total is on.

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
from shared.reply import CriterionScore, weighted_total
from shared.reviewers import (
    BANDS,
    DISAGREEMENT,
    PAIR_BAND_NAMES,
    band_of,
    flagged,
    gap,
    pair_band_of,
    reviewer_name_slug,
)
from shared.rows import RowsError, cell, read_rows
from shared.scores import cohort_of
from shared.table import (
    GAP_PK,
    REPORTS_PK,
    SUMMARIES_PK,
    application_pk,
    report_sk,
    reviewer_sk,
    summary_sk,
    table,
    to_dynamo,
)
from shared.work import MissingRubric, rubric_version_item

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
    for application, per_reviewer in placed:
        stored += write_reviewers(scholarship, application, per_reviewer, source=key)

    summary = rebuild_summary(scholarship, year)

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
) -> int:
    """Store each reviewer's scores for one application, then its gap. Returns reviewers stored."""
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
    return len(per_reviewer)


def criterion_shape(per_reviewer: dict[str, dict[str, float]]) -> dict[str, dict[str, Any]]:
    """Per criterion: what the reviewers averaged, and how far any two of them were apart.

    Worked out per application and kept on it, so the cohort's figures are added up from the read
    the summary rebuild already does. `apart` and its bands are only there where two reviewers
    scored the same criterion — one reviewer is not a comparison, and a zero there would read as
    perfect agreement.
    """
    by_criterion: dict[str, list[float]] = {}
    for scores in per_reviewer.values():
        for criterion_id, score in scores.items():
            by_criterion.setdefault(criterion_id, []).append(score)

    shaped: dict[str, dict[str, Any]] = {}
    for criterion_id, scores in by_criterion.items():
        entry: dict[str, Any] = {
            "mean": round(sum(scores) / len(scores), 2),
            "reviewers": len(scores),
        }
        apart = [
            abs(one - other)
            for index, one in enumerate(scores)
            for other in scores[index + 1 :]
        ]
        if apart:
            entry["pairs"] = len(apart)
            entry["apart_sum"] = round(sum(apart), 2)
            entry["bands"] = {
                name: sum(1 for difference in apart if pair_band_of(difference) == name)
                for name in PAIR_BAND_NAMES
            }
        shaped[criterion_id] = entry
    return shaped


_criteria_cache: dict[tuple[str, str], list[dict[str, Any]] | None] = {}


def criteria_of(scholarship: str, version: Any) -> list[dict[str, Any]] | None:
    """The criteria of the rubric version that produced the model's total, or nothing.

    Nothing means there is no total to compare against — an unscored application, or a version
    whose criteria are not stored. Either way a gap would be a comparison between two different
    rubrics, which is not a comparison.
    """
    if not version:
        return None
    wanted = (scholarship, str(version))
    if wanted not in _criteria_cache:
        try:
            criteria = rubric_version_item(*wanted).get("criteria")
        except MissingRubric:
            criteria = None
        _criteria_cache[wanted] = criteria or None
    return _criteria_cache[wanted]


def reviewer_total(
    scores: dict[str, float],
    criteria: list[dict[str, Any]] | None,
    application: dict[str, Any],
) -> float | None:
    """One reviewer's total on the same weights the model's total is on, or nothing.

    Nothing where the application has no model total, where the version's criteria are not stored,
    where the reviewer left a criterion unscored, or where a score is outside its own maximum. A
    part of a total is not a total, and comparing one against a whole one overstates the gap.
    """
    if criteria is None or application.get("total_score") is None:
        return None
    if any(criterion["id"] not in scores for criterion in criteria):
        return None

    checked: list[CriterionScore] = []
    for criterion in criteria:
        maximum = int(criterion["max"])
        score = scores[criterion["id"]]
        if score < 0 or score > maximum:
            return None
        checked.append(
            CriterionScore(
                criterion_id=str(criterion["id"]),
                score=score,
                max=maximum,
                reasoning="",
                evidence="",
            )
        )
    return weighted_total(checked, criteria)


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


def store_gap(
    application: dict[str, Any],
    *,
    stored: int,
    totals: list[float],
    per_criterion: dict[str, dict[str, Any]] | None = None,
) -> None:
    """The reviewers' total and how far it is from the model's, on the application itself.

    `reviewers_stored` is how many reviewers scored the application and is written either way, so a
    screen can tell an application no reviewer scored from one the model has not scored.
    `reviewer_total` and the gap are only written when there is something to compare, and `gap_pk`
    only while that gap reaches the line — so the queue's index holds the queue and nothing else.
    `reviewer_criteria` is what the per-criterion figures are added up from. Nothing scoring owns is
    touched.
    """
    sets = ["reviewers_stored = :stored"]
    values: dict[str, Any] = {":stored": stored}
    gone = ["reviewer_criteria"]

    if per_criterion:
        sets.append("reviewer_criteria = :criteria")
        values[":criteria"] = per_criterion
        gone = []

    if not totals:
        gone += ["reviewer_total", "reviewer_count", "score_gap", "gap_pk"]
    else:
        total = round(sum(totals) / len(totals), 2)
        apart = round(gap(float(application["total_score"]), total), 2)
        sets += ["reviewer_total = :total", "reviewer_count = :count", "score_gap = :gap"]
        values.update({":total": total, ":count": len(totals), ":gap": apart})
        if flagged(apart):
            sets.append("gap_pk = :queue")
            values[":queue"] = GAP_PK
        else:
            gone.append("gap_pk")

    expression = "SET " + ", ".join(sets)
    if gone:
        expression += " REMOVE " + ", ".join(gone)

    table().update_item(
        Key={"pk": application["pk"], "sk": application["sk"]},
        UpdateExpression=expression,
        ExpressionAttributeValues=to_dynamo(values),
    )


def rebuild_summary(scholarship: str, year: str) -> dict[str, Any]:
    """One cohort's reviewer-score figures, rebuilt from what the cohort holds.

    Rebuilt and never incremented: the office corrects files and re-uploads them, and a counter
    that was added to twice cannot be told from one that was added to once.
    """
    applications = reads.cohort(scholarship, year)
    bands = {name: 0 for name, _ in BANDS}
    gaps = [
        float(application["score_gap"])
        for application in applications
        if application.get("score_gap") is not None
    ]
    for apart in gaps:
        bands[band_of(apart)] += 1

    summary = {
        "pk": SUMMARIES_PK,
        "sk": summary_sk(scholarship, year),
        "scholarship": scholarship,
        "year": year,
        "applications": len(applications),
        "with_reviewer_scores": sum(
            1 for application in applications if application.get("reviewers_stored")
        ),
        "with_both_totals": len(gaps),
        "flagged": sum(1 for apart in gaps if flagged(apart)),
        "mean_gap": round(sum(gaps) / len(gaps), 2) if gaps else None,
        "gap_bands": bands,
        "criterion_gaps": criterion_gaps(applications),
        "reviewer_pairs": reviewer_pairs(applications),
        "disagreement_line": DISAGREEMENT,
        "rebuilt_at": stamp(),
    }
    table().put_item(Item=to_dynamo(summary))
    return summary


def criterion_gaps(applications: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per criterion, how far the model's score is from what the reviewers averaged.

    In that criterion's own points, and only over applications where both scored it — the model's
    per-criterion score is on the application, and the reviewers' mean is beside it. A criterion the
    model has not scored is left out rather than counted as agreement.
    """
    apart: dict[str, list[float]] = {}
    for application in applications:
        model = application.get("category_scores") or {}
        for criterion_id, reviewers in (application.get("reviewer_criteria") or {}).items():
            scored = model.get(criterion_id)
            if not scored or scored.get("score") is None:
                continue
            apart.setdefault(criterion_id, []).append(
                abs(float(scored["score"]) - float(reviewers["mean"]))
            )

    return {
        criterion_id: {
            "covers": len(differences),
            "mean_apart": round(sum(differences) / len(differences), 2),
        }
        for criterion_id, differences in apart.items()
    }


def reviewer_pairs(applications: list[dict[str, Any]]) -> dict[str, Any]:
    """How close two reviewers land on the same criterion, over the whole cohort.

    Counted per pair of reviewers per criterion, so an application three chairs scored weighs more
    than one two scored — the comparison is between two readings, and it holds three of them.
    """
    pairs = 0
    apart = 0.0
    bands = {name: 0 for name in PAIR_BAND_NAMES}
    for application in applications:
        for figures in (application.get("reviewer_criteria") or {}).values():
            if not figures.get("pairs"):
                continue
            pairs += int(figures["pairs"])
            apart += float(figures["apart_sum"])
            for name, count in (figures.get("bands") or {}).items():
                if name in bands:
                    bands[name] += int(count)

    return {
        "pairs": pairs,
        "mean_apart": round(apart / pairs, 2) if pairs else None,
        "bands": bands,
    }


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
