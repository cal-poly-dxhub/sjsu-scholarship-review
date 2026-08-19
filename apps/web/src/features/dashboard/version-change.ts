/**
 * Telling a weight-only rubric change from a criteria change, so the dashboard knows whether a
 * cohort can be moved by arithmetic or has to be scored again.
 *
 * The same comparison runs in `lambdas/shared/versions.py`, which is what actually decides. This
 * copy is only here so the counts beside the buttons say the truth before anything is pressed.
 */

export interface Level {
  value: number;
  description: string;
}

export interface Criterion {
  id: string;
  name: string;
  max: number;
  weight: number;
  guidance: string;
  levels: Level[];
}

export interface RubricVersion {
  version: string;
  criteria: Criterion[];
  preamble: string;
  source_file: string;
  published_at: string;
  published_by: string;
}

/** Everything in a version the model saw. Weights are left out — they are arithmetic. */
function promptShape(version: RubricVersion): string {
  return JSON.stringify([
    version.preamble ?? "",
    version.criteria.map((criterion) => [
      criterion.id,
      criterion.name,
      criterion.max,
      criterion.guidance ?? "",
      (criterion.levels ?? []).map((level) => [level.value, level.description]),
    ]),
  ]);
}

/**
 * True when the two versions differ in weights alone. Guidance and preamble count as a criteria
 * change: the stored scores answer the text the model was given.
 */
export function weightsOnlyChange(stored: RubricVersion, target: RubricVersion): boolean {
  return promptShape(stored) === promptShape(target);
}
