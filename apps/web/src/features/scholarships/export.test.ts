import { describe, expect, it } from "vitest";

import {
  cohortExport,
  EXPORT_WARNINGS,
  type ExportApplication,
  type ScoreItem,
} from "./export";
import type { CohortSet } from "./sets";

/**
 * The shape of the file someone downloads. It is the one artifact that leaves the system, so
 * what it carries and what it leaves out both matter.
 */

const CRITERIA = [
  { id: "grit", name: "Grit", max: 2, weight: 40 },
  { id: "clarity", name: "Clarity", max: 5, weight: 60 },
];

// The fields a cohort read carries. The pipeline's own bookkeeping rides along with them and has
// no business in an export.
const RAW = {
  pk: "COHORT#sjsu-general#2026",
  sk: "APP#one",
  claimed_by: "score-ondemand#abc",
  claimed_until: "2026-08-18T00:00:00Z",
  attempt: 2,
  content_hash: "a-sha256",
  source: { file: "uploads/a.xlsx", row_number: 2 },
};

function scored(student: string, extra: Partial<ExportApplication> = {}): ExportApplication {
  return {
    ...RAW,
    student_uuid: student,
    status: "scored",
    academic_program: "Computer Science BS",
    academic_level: "Senior",
    major: "Computer Science",
    gpa: 3.75,
    total_score: 80,
    rubric_version: "v2",
    model_id: "us.anthropic.claude-sonnet-4-6",
    latest_scored_at: "2026-08-01T00:00:00.000000Z",
    category_scores: { grit: { score: 1, max: 2 }, clarity: { score: 5, max: 5 } },
    failure: null,
    ...extra,
  } as ExportApplication;
}

const UNSCORED = scored("two", {
  status: "parsed",
  total_score: null,
  rubric_version: null,
  latest_scored_at: null,
  category_scores: null,
});

const FAILED = scored("three", {
  status: "score_failed",
  total_score: null,
  rubric_version: null,
  latest_scored_at: null,
  category_scores: null,
  failure: "the reply was missing a criterion",
});

// Ingest kept the total and took the version off, because the answers changed under it.
const CHANGED = scored("four", { status: "parsed", rubric_version: null });

const RUNNING = scored("five", { status: "processing", claimed_until: "2099-01-01T00:00:00Z" });

const REASONING: Record<string, ScoreItem | null> = {
  one: {
    category_scores: {
      grit: { score: 1, max: 2, reasoning: "half of it", evidence: "their words" },
      clarity: { score: 5, max: 5, reasoning: "clear", evidence: "their words" },
    },
    total_score: 80,
    reasoning_summary: "Strong on clarity.",
    rubric_version: "v2",
    model_id: "a-model",
  },
};

const COVERAGE = {
  cohort_total: 3,
  ranked: 1,
  unscored: 1,
  running: 0,
  failed: 1,
  in_other_sets: 0,
};

function build(
  scores?: Record<string, ScoreItem | null>,
  applications: ExportApplication[] = [scored("one"), UNSCORED, FAILED],
  otherSets: CohortSet[] = [],
) {
  return cohortExport({
    scholarship: "sjsu-general",
    year: "2026",
    rubricVersion: "v2",
    modelId: "us.anthropic.claude-sonnet-4-6",
    otherSets,
    criteria: CRITERIA,
    applications,
    coverage: COVERAGE,
    scores,
  });
}

/** One row, with the index checked: the file is only readable if every row is there. */
function rowAt(rows: ReturnType<typeof build>["applications"], index: number) {
  const row = rows[index];
  if (!row) throw new Error(`the export has no row ${index}`);
  return row;
}

describe("cohortExport", () => {
  it("carries nothing from the pipeline's own bookkeeping", () => {
    const first = rowAt(build().applications, 0);

    for (const field of Object.keys(RAW)) {
      expect(first).not.toHaveProperty(field);
    }
    expect(JSON.stringify(build())).not.toContain("score-ondemand");
  });

  it("keeps an unscored and a failed application, with their state instead of a zero", () => {
    const rows = build().applications;

    expect(rows.map((row) => row.state)).toEqual(["scored", "unscored", "failed"]);
    expect(rowAt(rows, 1).total_score).toBeNull();
    expect(rowAt(rows, 1).criteria.map((criterion) => criterion.score)).toEqual([null, null]);
    expect(rowAt(rows, 2).failure).toBe("the reply was missing a criterion");
    // A criterion with no score still names its weight, so a zero is never read into a blank.
    expect(rowAt(rows, 1).criteria.map((criterion) => criterion.weight)).toEqual([40, 60]);
  });

  it("says a total is not current rather than exporting it as a score", () => {
    // A row read as 'scored' is a number someone sorts and decides on. These two are not scores:
    // one was made from answers that have since changed, the other is being replaced right now.
    const rows = build(undefined, [CHANGED, RUNNING]).applications;

    expect(rows.map((row) => row.state)).toEqual(["needs_rescore", "running"]);
    // The number stays in the file, because the warning above names it as the previous score.
    expect(rowAt(rows, 0).total_score).toBe(80);
    expect(build().warnings.join(" ")).toContain("carries the previous one");
  });

  it("carries reasoning only when it was asked for", () => {
    const without = build();
    expect(without.reasoning_included).toBe(false);
    expect(JSON.stringify(without)).not.toContain("half of it");
    expect(rowAt(without.applications, 0).reasoning_read).toBeUndefined();

    const withIt = build(REASONING);
    expect(withIt.reasoning_included).toBe(true);
    expect(rowAt(withIt.applications, 0).reasoning_summary).toBe("Strong on clarity.");
    expect(rowAt(withIt.applications, 0).criteria[0]?.reasoning).toBe("half of it");
  });

  it("is the rows it was handed, in that order, and says so when they are not the cohort", () => {
    // A filtered file read as the whole cohort is a reviewer concluding applicants are missing.
    const filtered = build(undefined, [FAILED, UNSCORED]);

    expect(filtered.applications.map((row) => row.student_uuid)).toEqual(["three", "two"]);
    expect(filtered.applications_in_file).toBe(2);
    expect(filtered.whole_cohort).toBe(false);
    expect(filtered.warnings[0]).toContain("2 applications the screen was showing");
    expect(filtered.warnings[0]).toContain("out of 3 in the cohort");
    // The counts the screen shows beside the list travel with the file either way.
    expect(filtered.coverage).toEqual(COVERAGE);
    expect(build().whole_cohort).toBe(true);
    expect(build().warnings).toEqual(EXPORT_WARNINGS);
  });

  it("is one set, named in the header and on every row", () => {
    // A file that mixes two models' totals without saying so is a ranking nobody can defend.
    const file = build();

    expect(file.rubric_version).toBe("v2");
    expect(file.model_id).toBe("us.anthropic.claude-sonnet-4-6");
    expect(rowAt(file.applications, 0).model_id).toBe("us.anthropic.claude-sonnet-4-6");
    expect(file.warnings.join(" ")).toContain("one rubric version scored by one model");
  });

  it("names the sets it does not hold, with their counts", () => {
    // Silence here is a reviewer concluding these totals are all the cohort has.
    const others: CohortSet[] = [
      { rubric_version: "v2", model_id: "us.anthropic.claude-opus-4-6-v1", count: 12 },
      { rubric_version: "v1", model_id: "unknown", count: 3 },
    ];
    const file = build(undefined, [scored("one"), UNSCORED, FAILED], others);

    expect(file.other_sets).toEqual(others);
    const said = file.warnings.join(" ");
    expect(said).toContain("2 other sets");
    expect(said).toContain("v2 by Opus 4.6 — strongest (12)");
    expect(said).toContain("v1 by no model recorded (3)");
  });

  it("names the fields it left out", () => {
    // Left out silently, a missing field reads as one that was never stored.
    const named = build().omitted_fields.join(" ");

    for (const field of ["claimed_by", "attempt", "content_hash", "source", "qa_pairs"]) {
      expect(named).toContain(field);
    }
  });

  it("marks a score item that could not be read rather than dropping the application", () => {
    // One unreadable score item losing an applicant from the file is the failure worth guarding.
    const rows = build({ ...REASONING, one: null }).applications;

    expect(rows).toHaveLength(3);
    expect(rowAt(rows, 0).reasoning_read).toBe(false);
    expect(rowAt(rows, 0).total_score).toBe(80);
    expect(rowAt(rows, 0).criteria[0]?.score).toBe(1);
    expect(rowAt(rows, 0).reasoning_summary).toBeUndefined();
    // Nothing was asked about for an unscored application, so it is not marked either way.
    expect(rowAt(rows, 1).reasoning_read).toBeUndefined();
  });
});
