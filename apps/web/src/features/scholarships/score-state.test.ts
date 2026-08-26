import { describe, expect, it } from "vitest";

import { scoreState, type StatedApplication } from "./score-state";

/**
 * What the screens read a stored total as. The failure this covers is the one the review found:
 * a total left behind by ingest showing up as a current, comparable score.
 */

const NOW = "2026-08-19T12:00:00Z";
const LATER = "2026-08-19T12:20:00Z";
const EARLIER = "2026-08-19T11:40:00Z";

function app(fields: Partial<StatedApplication> = {}): StatedApplication {
  return {
    status: "scored",
    total_score: 80,
    rubric_version: "v1",
    claimed_until: null,
    ...fields,
  };
}

describe("scoreState", () => {
  it("calls a total with no rubric version what it is: work, not a score", () => {
    // Ingest removes the version when an applicant's own content changes, and leaves the total
    // readable. Reading that as "scored" is what showed a number made from deleted answers.
    const changed = app({ status: "parsed", rubric_version: null });

    expect(scoreState(changed, NOW)).toBe("needs_rescore");
  });

  it("puts a live claim before the total it is about to replace", () => {
    const rescoring = app({ status: "processing", claimed_until: LATER });

    expect(scoreState(rescoring, NOW)).toBe("running");
  });

  it("treats an abandoned claim as the score it still has, not as a run", () => {
    const abandoned = app({ status: "processing", claimed_until: EARLIER });

    expect(scoreState(abandoned, NOW)).toBe("scored");
  });

  it("puts a failure before everything else, whatever is stored", () => {
    expect(scoreState(app({ status: "score_failed" }), NOW)).toBe("failed");
  });

  it("reads no total as unscored, and a total under a version as scored", () => {
    expect(scoreState(app({ status: "parsed", total_score: null }), NOW)).toBe("unscored");
    expect(scoreState(app(), NOW)).toBe("scored");
  });

  it("separates 'this set has no total for it' from 'nothing has scored it'", () => {
    // The cohort read carries the picked set's total. A scored application with none of it was
    // scored by another model, and calling that unscored is a claim about a model that never ran.
    const elsewhere = app({ status: "scored", total_score: null, rubric_version: null });

    expect(scoreState(elsewhere, NOW)).toBe("not_in_set");
  });
});
