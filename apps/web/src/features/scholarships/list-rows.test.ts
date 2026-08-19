import { describe, expect, it } from "vitest";

import { EMPTY_FILTERS, listRows, type ListApplication } from "./list-rows";

/**
 * Which rows a search reaches. The ranking index holds only the comparable totals, so a search
 * confined to it says an unscored or failed applicant does not exist.
 */

function app(student: string, extra: Partial<ListApplication> = {}): ListApplication {
  return {
    sk: `APP#${student}`,
    student_uuid: student,
    status: "scored",
    academic_program: "Computer Science BS",
    academic_level: "Senior",
    major: "Computer Science",
    gpa: 3.75,
    total_score: 80,
    ...extra,
  };
}

const SCORED_HIGH = app("aaa-high", { total_score: 90 });
const SCORED_LOW = app("aaa-low", { total_score: 60 });
const UNSCORED = app("aaa-unscored", { status: "parsed", total_score: null });
const FAILED = app("aaa-failed", { status: "score_failed", total_score: null });

const COHORT = [SCORED_LOW, UNSCORED, FAILED, SCORED_HIGH];
// What the index returns: only the two with a comparable total, highest first.
const RANKED = [SCORED_HIGH, SCORED_LOW];

const rows = (ranking: boolean, search = "", filters = EMPTY_FILTERS) =>
  listRows({ ranking, search, filters, cohort: COHORT, ranked: RANKED });

describe("listRows", () => {
  it("keeps the index's order when nothing is being searched for", () => {
    const { rows: shown, rankedRead } = rows(true);

    expect(rankedRead).toBe(true);
    expect(shown.map((row) => row.student_uuid)).toEqual(["aaa-high", "aaa-low"]);
  });

  it("finds an unscored or failed applicant while the list is ranked", () => {
    // The failure this covers: someone types an id, gets nothing, and concludes the applicant
    // was never ingested — when they are simply not in the index.
    const { rows: shown, rankedRead } = rows(true, "aaa-failed");

    expect(rankedRead).toBe(false);
    expect(shown.map((row) => row.student_uuid)).toEqual(["aaa-failed"]);
    expect(rows(true, "aaa-unscored").rows).toHaveLength(1);
    // And the whole cohort is reachable, not just the ranked page.
    expect(rows(true, "aaa").rows).toHaveLength(4);
  });

  it("stands the ranking down for a filter too, not only for a typed search", () => {
    const { rows: shown, rankedRead } = rows(true, "", {
      ...EMPTY_FILTERS,
      level: "senior",
    });

    expect(rankedRead).toBe(false);
    expect(shown).toHaveLength(4);
  });

  it("leaves an application out when a range it has no number for is set", () => {
    // A missing total passing a bound would rank an unscored applicant among the scored ones.
    const { rows: shown } = rows(false, "", { ...EMPTY_FILTERS, totalMin: "70" });

    expect(shown.map((row) => row.student_uuid)).toEqual(["aaa-high"]);
  });
});
