/**
 * Telling a weight-only rubric change from a criteria change, so the dashboard knows whether a
 * cohort can be moved by arithmetic or has to be scored again.
 *
 * The same comparison runs in `lambdas/shared/versions.py`, which is what actually decides. This
 * copy is only here so the counts beside the buttons say the truth before anything is pressed —
 * so it has to compare the same two things: the file the model reads, and the ids, names, and
 * maxima the output contract carries. Never the file name: a weights-only republish is the same
 * text under a new name.
 */

export interface Criterion {
  id: string;
  name: string;
  max: number;
}

export interface RubricVersion {
  version: string;
  criteria: Criterion[];
  source_text: string;
}

/** True when the two versions differ in weights alone, so a total can be recomputed. */
export function weightsOnlyChange(stored: RubricVersion, target: RubricVersion): boolean {
  return shape(stored) === shape(target);
}

function shape(version: RubricVersion): string {
  return JSON.stringify([
    version.source_text ?? "",
    version.criteria.map((criterion) => [criterion.id, criterion.name, criterion.max]),
  ]);
}
