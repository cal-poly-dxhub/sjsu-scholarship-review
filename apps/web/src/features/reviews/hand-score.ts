/**
 * A reviewer's typed scores: what one entry means, and what leaves the screen as a file.
 *
 * This sits apart from the screen for two reasons. The bound is the only thing between a mistyped
 * number and a score the rubric does not allow. And a file that overstates what happened — that a
 * review was submitted, that a blank counted as a zero — is worse than no file at all.
 */

export interface HandCriterion {
  id: string;
  name: string;
  max: number;
  weight: number;
}

/** What one typed entry means, read against its criterion's maximum. */
export type Entry =
  | { kind: "blank" }
  | { kind: "score"; score: number }
  | { kind: "refused"; reason: string };

export function readEntry(typed: string, max: number): Entry {
  const text = typed.trim();
  // Nothing typed is not a zero. A zero is a judgement; a blank is the absence of one.
  if (text === "") return { kind: "blank" };

  const score = Number(text);
  if (!Number.isFinite(score)) return { kind: "refused", reason: "Type a number." };
  if (score < 0) return { kind: "refused", reason: "The lowest score is 0." };
  if (score > max) return { kind: "refused", reason: `The highest score here is ${max}.` };
  return { kind: "score", score };
}

/** What a reviewer has typed so far, as typed, keyed by criterion. */
export type Typed = Record<string, string>;

export interface Reading {
  /** Every criterion of the rubric, with what the reviewer typed against it. */
  entries: { criterion: HandCriterion; entry: Entry }[];
  /** Criteria carrying a score the rubric allows. */
  scored: number;
  /** Only once every criterion is scored — part of a total reads as a total. */
  total: number | null;
}

/** Every criterion's entry, how many are scored, and the total once they all are. */
export function readEntries(criteria: HandCriterion[], typed: Typed): Reading {
  const entries = criteria.map((criterion) => ({
    criterion,
    entry: readEntry(typed[criterion.id] ?? "", criterion.max),
  }));

  let scored = 0;
  let weighted = 0;
  for (const { criterion, entry } of entries) {
    if (entry.kind !== "score") continue;
    scored += 1;
    // The same sum the scorer makes: each criterion's share of its own maximum, times its weight,
    // out of 100. Any other formula would put a reviewer's total on a different scale from the
    // model's and invite the two being compared anyway.
    weighted += (entry.score / criterion.max) * criterion.weight;
  }

  const whole = criteria.length > 0 && scored === criteria.length;
  return { entries, scored, total: whole ? Math.round(weighted * 100) / 100 : null };
}

export const NOTHING_SUBMITTED =
  "A reviewer typed these scores on the scoring screen. Nothing was submitted, nothing was saved,"
  + " and nobody has signed this off.";

/** The reviewer's own reading of one application, as a file they can keep. */
export function reviewerScoreFile({
  scholarship,
  year,
  studentUuid,
  rubricVersion,
  criteria,
  typed,
}: {
  scholarship: string;
  year: string;
  studentUuid: string;
  /** The version the criteria came from. A score means nothing without it. */
  rubricVersion: string | null;
  criteria: HandCriterion[];
  typed: Typed;
}) {
  const { entries, total } = readEntries(criteria, typed);
  return {
    scholarship,
    year,
    student_uuid: studentUuid,
    rubric_version: rubricVersion,
    exported_at: new Date().toISOString(),
    submitted: false,
    note: NOTHING_SUBMITTED,
    reviewer_total: total,
    criteria: entries.map(({ criterion, entry }) => ({
      id: criterion.id,
      name: criterion.name,
      max: criterion.max,
      weight: criterion.weight,
      reviewer_score: entry.kind === "score" ? entry.score : null,
      state: entry.kind === "score" ? "scored" : "not scored",
    })),
  };
}
