"""Reading a reviewer-score file: what it places, what it refuses, and the gap it leaves behind.

Four things here destroy work rather than fail. A cell read as a zero instead of as unreadable
moves a total by as much as the part nobody saw. A row placed on a near-match puts a chair's score
on the wrong applicant. A re-ingest that adds to a counter cannot be told from one that did not
run. And a gap left behind after the total it was measured against is gone keeps an application in
the review queue with nothing on the other side of the comparison.

The rubric here is a fixture with unequal maxima, so a total worked out per criterion cannot pass
by accident against a rubric where every criterion is out of the same number.
"""

from __future__ import annotations

from typing import Any

import pytest

from shared import reads
from shared.claims import mark_failed
from shared.reviewers import DISAGREEMENT
from shared.table import GAP_PK, cohort_pk
from tests.helpers import SCHOLARSHIP, YEAR, put_scored, put_version, read
from workers import ingest, reviewer_ingest

BUCKET = "an-ingest-bucket"
KEY = f"reviewer-scores/{SCHOLARSHIP}/{YEAR}/chair scores 26-27.xlsx"
VERSION = "2026.08.01-1"

# Five criteria out of different maxima, weighted to 100. Full marks everywhere is 100, so a
# reviewer's total is readable off the fractions.
CRITERIA = [
    {"id": "career_goals_essay", "name": "Career goals", "max": 4, "weight": 40},
    {"id": "challenge_essay", "name": "A challenge", "max": 5, "weight": 30},
    {"id": "extracurricular_activities", "name": "Activities", "max": 2, "weight": 10},
    {"id": "initiative_self_motivation", "name": "Initiative", "max": 3, "weight": 10},
    {"id": "creativity", "name": "Creativity", "max": 1, "weight": 10},
]

# 2/4 of 40, then full marks: 20 + 30 + 10 + 10 + 10.
EIGHTY = {
    "career_goals_essay": 2,
    "challenge_essay": 5,
    "extracurricular_activities": 2,
    "initiative_self_motivation": 3,
    "creativity": 1,
}
# Full marks everywhere.
HUNDRED = {**EIGHTY, "career_goals_essay": 4}

COLUMN_OF = {criterion: column for column, criterion in reviewer_ingest.CRITERION_COLUMNS.items()}

ANN = "Ann Chair"
BO = "Bo Chair"


@pytest.fixture(autouse=True)
def _forget_criteria() -> Any:
    """The worker caches a version's criteria per container, and each test writes its own."""
    reviewer_ingest._criteria_cache.clear()
    yield
    reviewer_ingest._criteria_cache.clear()


def student(identifier: str) -> str:
    """An applicant uuid whose last twelve characters are the identifier the file names."""
    return f"aaaaaaaa-bbbb-cccc-dddd-{identifier.lower()}"


def row(identifier: str, *reviewers: tuple[str, dict[str, int]], **extra: Any) -> dict[str, Any]:
    """One row of the export: an identifier and one text cell per criterion anybody scored."""
    built: dict[str, Any] = {reviewer_ingest.CANDIDATE: identifier, **extra}
    for name, scores in reviewers:
        for criterion, score in scores.items():
            line = f"{name}: {score}"
            column = COLUMN_OF[criterion]
            built[column] = f"{built[column]}\n{line}" if column in built else (
                f"Average Score: {score}\n{line}"
            )
    return built


def ingest_rows(monkeypatch: Any, rows: list[dict[str, Any]], key: str = KEY) -> dict[str, Any]:
    """Run the worker over rows handed to it directly, so no test needs S3 or a workbook."""
    monkeypatch.setattr(reviewer_ingest, "read_rows", lambda *_args, **_kwargs: iter(rows))
    return reviewer_ingest.ingest_file(BUCKET, key)


def reviewer_items(student_uuid: str) -> list[dict[str, Any]]:
    return reads.reviewer_scores(SCHOLARSHIP, YEAR, student_uuid)


def test_a_cell_names_reviewers_and_an_unreadable_one_stops_the_row() -> None:
    column = COLUMN_OF["creativity"]

    assert reviewer_ingest.cell_scores("Average Score: 2.5\nAnn Chair: 2\nBo Chair: 3", column) == [
        (ANN, 2.0),
        (BO, 3.0),
    ]
    assert reviewer_ingest.cell_scores("Average Score: 2\nAnn Chair: 2", column) == [(ANN, 2.0)]
    # Nobody scoring is not everybody scoring zero.
    assert reviewer_ingest.cell_scores(None, column) == []
    assert reviewer_ingest.cell_scores("   ", column) == []

    with pytest.raises(reviewer_ingest.Unreadable) as raised:
        reviewer_ingest.cell_scores("Average Score: 2\nAnn Chair: strong essay", column)
    assert "Ann Chair: strong essay" in str(raised.value)
    assert column in str(raised.value)

    # The row it was in is reported and placed nowhere, so the missing part is never a zero.
    application = {"student_uuid": student("0123456789AB"), "pk": "x", "sk": "y"}
    unreadable = {reviewer_ingest.CANDIDATE: "0123456789AB", column: "Ann Chair: strong essay"}
    placed, rejected = reviewer_ingest.collect(iter([unreadable]), [application])
    assert placed == []
    assert rejected[0]["row"] == 2
    assert "does not read as a reviewer and a score" in rejected[0]["reason"]


def test_a_row_is_placed_on_its_applicant_or_reported_with_its_row_number(
    table: Any, monkeypatch: Any
) -> None:
    good, other = "0123456789AB", "0123456789CD"
    put_scored(table, student(good), total=65, version=VERSION)
    put_scored(table, student(other), total=65, version=VERSION)
    put_version(table, VERSION, CRITERIA)

    report = ingest_rows(
        monkeypatch,
        [
            row(good, (ANN, EIGHTY)),
            row("2.56655E+11", (ANN, EIGHTY)),
            row("FFFFFFFFFFFF", (ANN, EIGHTY)),
            row(good, (BO, HUNDRED)),
            row("", (ANN, EIGHTY)),
        ],
    )

    assert report["rows_read"] == 5
    assert report["applications_placed"] == 1
    by_row = {rejected["row"]: rejected for rejected in report["rejected_rows"]}
    assert set(by_row) == {3, 4, 5, 6}
    assert "damaged" in by_row[3]["reason"]
    assert "no application in this cohort" in by_row[4]["reason"]
    assert by_row[5]["kept_row"] == 2
    assert "names no applicant" in by_row[6]["reason"]

    # Nothing was written for any of them — including the duplicate, whose second reviewer is not
    # stored against the applicant the first row placed.
    assert [item["reviewer_name"] for item in reviewer_items(student(good))] == [ANN]
    assert reviewer_items(student(other)) == []
    assert "reviewers_stored" not in read(table, student(other))


def test_a_reviewers_total_is_worked_out_from_their_own_scores() -> None:
    scored = {"total_score": 65, "rubric_version": VERSION}

    assert reviewer_ingest.reviewer_total(EIGHTY, CRITERIA, scored) == 80
    assert reviewer_ingest.reviewer_total(HUNDRED, CRITERIA, scored) == 100

    # A part of a total is not a total: a skipped criterion, no model total to compare against, a
    # version whose criteria are not stored, and a score outside its own maximum.
    assert reviewer_ingest.reviewer_total({"creativity": 1}, CRITERIA, scored) is None
    assert reviewer_ingest.reviewer_total(EIGHTY, CRITERIA, {"total_score": None}) is None
    assert reviewer_ingest.reviewer_total(EIGHTY, None, scored) is None
    assert reviewer_ingest.reviewer_total({**EIGHTY, "creativity": 2}, CRITERIA, scored) is None


def test_the_file_own_total_is_read_past(table: Any, monkeypatch: Any) -> None:
    """The export carries a `Weighted Points` column that does not reproduce from its own cells."""
    identifier = "0123456789AB"
    put_scored(table, student(identifier), total=65, version=VERSION)
    put_version(table, VERSION, CRITERIA)

    ingest_rows(monkeypatch, [row(identifier, (ANN, EIGHTY), **{"Weighted Points": 12})])

    assert reviewer_items(student(identifier))[0]["total_score"] == 80
    assert read(table, student(identifier))["reviewer_total"] == 80


def test_the_gap_carries_the_flag_only_while_it_reaches_the_line(table: Any) -> None:
    put_version(table, VERSION, CRITERIA)

    # A reviewer total of 80 against each of these model totals: over the line, exactly on it, and
    # under it. Exactly on it is in the queue — the line is where a second look starts.
    for identifier, total, apart, queued in (
        ("0123456789A1", 65, 15, True),
        ("0123456789A2", 70, DISAGREEMENT, True),
        ("0123456789A3", 72, 8, False),
    ):
        application = put_scored(table, student(identifier), total=total, version=VERSION)
        reviewer_ingest.store_gap(application, stored=1, totals=[80.0])
        item = read(table, student(identifier))
        assert float(item["score_gap"]) == apart
        assert item.get("gap_pk") == (GAP_PK if queued else None)
        assert item["reviewer_count"] == 1

    two = put_scored(table, student("0123456789B1"), total=65, version=VERSION)
    reviewer_ingest.store_gap(two, stored=2, totals=[80.0, 100.0])
    averaged = read(table, student("0123456789B1"))
    assert float(averaged["reviewer_total"]) == 90
    assert averaged["reviewer_count"] == 2
    assert float(averaged["score_gap"]) == 25

    # A corrected score that brings the two totals together takes the application out of the queue.
    reviewer_ingest.store_gap(two, stored=2, totals=[70.0])
    corrected = read(table, student("0123456789B1"))
    assert float(corrected["score_gap"]) == 5
    assert "gap_pk" not in corrected


def test_the_same_file_twice_leaves_the_same_thing_and_a_correction_moves_only_its_own_rows(
    table: Any, monkeypatch: Any
) -> None:
    first, second = "0123456789A1", "0123456789A2"
    put_scored(table, student(first), total=65, version=VERSION)
    put_scored(table, student(second), total=65, version=VERSION)
    put_version(table, VERSION, CRITERIA)
    rows = [row(first, (ANN, EIGHTY), (BO, HUNDRED)), row(second, (ANN, EIGHTY))]

    once = ingest_rows(monkeypatch, rows)
    state = snapshot(table, [first, second])
    figures = summary()
    again = ingest_rows(monkeypatch, rows)

    assert steady(once) == steady(again)
    assert snapshot(table, [first, second]) == state
    # The summary is rebuilt from the cohort and never added to, so a second run cannot double it.
    assert summary() == figures
    assert figures["with_both_totals"] == 2 and figures["flagged"] == 2
    assert once["reviewer_scores_stored"] == 3

    # A file naming one applicant corrects that applicant and leaves the other alone.
    untouched = snapshot(table, [second])
    ingest_rows(monkeypatch, [row(first, (ANN, HUNDRED), (BO, HUNDRED))])
    assert float(read(table, student(first))["reviewer_total"]) == 100
    assert snapshot(table, [second]) == untouched


def snapshot(table: Any, identifiers: list[str]) -> list[dict[str, Any]]:
    """What the applications and their reviewer items hold, without the times a write stamps."""
    found: list[dict[str, Any]] = []
    for identifier in identifiers:
        application = dict(read(table, student(identifier)))
        found.append({key: value for key, value in application.items() if key != "parsed_at"})
        for item in reviewer_items(student(identifier)):
            found.append({key: value for key, value in item.items() if key != "stored_at"})
    return found


def summary() -> dict[str, Any]:
    """The cohort's stored figures, without the time the rebuild stamped."""
    found = reads.summaries()
    assert len(found) == 1
    return {key: value for key, value in found[0].items() if key != "rebuilt_at"}


def steady(report: dict[str, Any]) -> dict[str, Any]:
    """A report without the figures a second run is allowed to move."""
    return {key: value for key, value in report.items() if key != "at"}


def test_a_score_taken_away_takes_its_gap_and_its_flag_with_it(
    table: Any, monkeypatch: Any
) -> None:
    identifier = "0123456789AB"
    uuid = student(identifier)
    put_version(table, VERSION, CRITERIA)
    application = put_scored(table, uuid, total=65, version=VERSION)
    table.update_item(
        Key={"pk": application["pk"], "sk": application["sk"]},
        UpdateExpression="SET claimed_by = :who",
        ExpressionAttributeValues={":who": "a worker"},
    )
    ingest_rows(monkeypatch, [row(identifier, (ANN, EIGHTY))])
    assert read(table, uuid).get("gap_pk") == GAP_PK

    assert mark_failed(
        pk=application["pk"], sk=application["sk"], claimed_by="a worker", reason="the model refused"
    )
    failed = read(table, uuid)
    for gone in ("gap_pk", "score_gap", "reviewer_total", "reviewer_count"):
        assert gone not in failed
    # The reviewers read the essays, so their scores stay and the count still says they are there.
    assert failed["reviewers_stored"] == 1
    assert len(reviewer_items(uuid)) == 1

    # The same holds when the applicant's answers change: the intake ingest clears the gap because
    # the total it was measured against was made from text this application no longer holds.
    put_scored(table, uuid, total=65, version=VERSION)
    ingest.store(intake(uuid, "To finish what I started."))
    reviewer_ingest.store_gap(read_as_item(table, uuid), stored=1, totals=[80.0])
    assert read(table, uuid).get("gap_pk") == GAP_PK

    assert ingest.store(intake(uuid, "A different answer altogether.")) == "changed"
    changed = read(table, uuid)
    for gone in ("gap_pk", "score_gap", "reviewer_total", "reviewer_count"):
        assert gone not in changed
    assert changed["reviewers_stored"] == 1
    assert len(reviewer_items(uuid)) == 1


def intake(uuid: str, answer: str) -> dict[str, Any]:
    """One application as the intake ingest builds it, before it is written."""
    return {
        "pk": cohort_pk(SCHOLARSHIP, YEAR),
        "sk": f"APP#{uuid}",
        "student_uuid": uuid,
        "scholarship": SCHOLARSHIP,
        "year": YEAR,
        "source": "uploads/an export.xlsx",
        "academic_program": "Computer Science BS",
        "major": "Computer Science",
        "academic_level": "Senior",
        "gpa": "3.75",
        "qa_pairs": [{"question": "Why SJSU?", "answer": answer}],
    }


def read_as_item(table: Any, uuid: str) -> dict[str, Any]:
    item = read(table, uuid)
    return {"pk": item["pk"], "sk": item["sk"], "total_score": float(item["total_score"])}


def test_two_reviewers_on_one_criterion_are_counted_as_a_pair_and_against_the_model(
    table: Any, monkeypatch: Any
) -> None:
    """The per-criterion figures, from what two chairs scored against what the model scored."""
    identifier = "0123456789AB"
    model = {
        "career_goals_essay": {"score": 4, "max": 4},
        "challenge_essay": {"score": 3, "max": 5},
        "extracurricular_activities": {"score": 2, "max": 2},
        "initiative_self_motivation": {"score": 3, "max": 3},
        "creativity": {"score": 0, "max": 1},
    }
    put_scored(table, student(identifier), total=65, version=VERSION, category_scores=model)
    put_version(table, VERSION, CRITERIA)

    ingest_rows(monkeypatch, [row(identifier, (ANN, EIGHTY), (BO, HUNDRED))])

    # The two chairs differ on the first criterion only: 2 against 4, and full marks on the rest.
    shaped = read(table, student(identifier))["reviewer_criteria"]
    assert float(shaped["career_goals_essay"]["mean"]) == 3
    assert shaped["career_goals_essay"]["bands"]["some_difference"] == 1
    assert shaped["creativity"]["bands"]["same"] == 1

    figures = summary()
    assert figures["reviewer_pairs"]["pairs"] == 5
    assert float(figures["reviewer_pairs"]["mean_apart"]) == 0.4
    assert {name: int(count) for name, count in figures["reviewer_pairs"]["bands"].items()} == {
        "same": 4,
        "within_one": 0,
        "some_difference": 1,
        "far_apart": 0,
    }

    # The model against the reviewers' average, per criterion, in that criterion's own points.
    gaps = figures["criterion_gaps"]
    assert float(gaps["career_goals_essay"]["mean_apart"]) == 1
    assert float(gaps["challenge_essay"]["mean_apart"]) == 2
    assert float(gaps["extracurricular_activities"]["mean_apart"]) == 0
    assert gaps["challenge_essay"]["covers"] == 1

    # One chair is not a comparison, so the pair figures go and the means stay.
    ingest_rows(monkeypatch, [row(identifier, (ANN, EIGHTY))])
    alone = summary()
    assert alone["reviewer_pairs"] == {
        "pairs": 0,
        "mean_apart": None,
        "bands": {name: 0 for name in ("same", "within_one", "some_difference", "far_apart")},
    }
    assert "pairs" not in read(table, student(identifier))["reviewer_criteria"]["creativity"]
    assert float(alone["criterion_gaps"]["career_goals_essay"]["mean_apart"]) == 2


def test_the_queue_pages_in_gap_order(table: Any) -> None:
    put_version(table, VERSION, CRITERIA)
    # Reviewer totals chosen so the gaps against a model total of 65 come out 5, 15, 25, 35, 45.
    for offset, reviewer in enumerate((70.0, 80.0, 90.0, 100.0, 20.0)):
        application = put_scored(table, student(f"0123456789A{offset}"), total=65, version=VERSION)
        reviewer_ingest.store_gap(application, stored=1, totals=[reviewer])

    pages: list[list[float]] = []
    cursor: str | None = None
    while True:
        rows, cursor = reads.flagged(limit=2, cursor=cursor)
        pages.append([float(item["score_gap"]) for item in rows])
        if not cursor:
            break

    # Widest first, two to a page, and the 5-point gap is not in the queue at all: it carries no
    # `gap_pk`, so the index does not hold it.
    assert pages == [[45, 35], [25, 15]]
