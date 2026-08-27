import { describe, expect, it } from "vitest";

import { readEntry, readEntries, reviewerScoreFile, type HandCriterion } from "./hand-score";

/**
 * What a reviewer types on the hand-scoring screen, and what leaves it in a file.
 *
 * Two failures matter here: a score that is not on the rubric's scale being taken as one, and a
 * criterion nobody scored coming out the other end as a zero. Both would read as a judgement the
 * reviewer never made.
 */

const CRITERIA: HandCriterion[] = [
  { id: "need", name: "Financial need", max: 4, weight: 60 },
  { id: "essay", name: "Essay", max: 5, weight: 40 },
];

describe("readEntry", () => {
  it("takes a score at the maximum and refuses one above it, naming the maximum", () => {
    expect(readEntry("4", 4)).toEqual({ kind: "score", score: 4 });

    const over = readEntry("5", 4);
    expect(over.kind).toBe("refused");
    expect(over.kind === "refused" && over.reason).toContain("4");
  });

  it("refuses a negative score and anything that is not a number", () => {
    expect(readEntry("-1", 4).kind).toBe("refused");
    expect(readEntry("good", 4).kind).toBe("refused");
  });

  it("leaves an empty entry unscored rather than zero", () => {
    expect(readEntry("", 4)).toEqual({ kind: "blank" });
    expect(readEntry("   ", 4)).toEqual({ kind: "blank" });
    // A typed zero is a judgement, and has to survive as one.
    expect(readEntry("0", 4)).toEqual({ kind: "score", score: 0 });
  });
});

describe("readEntries", () => {
  it("holds back a total until every criterion is scored", () => {
    expect(readEntries(CRITERIA, { need: "4" }).total).toBeNull();
    // Weighted the way a stored score is: (4/4)*60 + (5/5)*40.
    expect(readEntries(CRITERIA, { need: "4", essay: "5" }).total).toBe(100);
    expect(readEntries(CRITERIA, { need: "2", essay: "3" }).total).toBe(54);
  });

  it("does not count a refused entry as scored", () => {
    expect(readEntries(CRITERIA, { need: "9", essay: "5" }).scored).toBe(1);
  });
});

describe("reviewerScoreFile", () => {
  const file = reviewerScoreFile({
    scholarship: "sjsu_general_scholarships",
    year: "2025-2026",
    studentUuid: "abc-123",
    rubricVersion: "v3",
    criteria: CRITERIA,
    typed: { need: "3" },
  });

  it("carries every criterion of the named version, and marks a blank one unscored", () => {
    expect(file.rubric_version).toBe("v3");
    expect(file.criteria.map((c) => c.id)).toEqual(["need", "essay"]);

    expect(file.criteria[0]).toMatchObject({ reviewer_score: 3, state: "scored" });
    expect(file.criteria[1]).toMatchObject({ reviewer_score: null, state: "not scored" });
    // Part of a reading is not a total.
    expect(file.reviewer_total).toBeNull();
  });

  it("says nothing was submitted", () => {
    expect(file.submitted).toBe(false);
    expect(file.note).toContain("Nothing was submitted");
  });
});
