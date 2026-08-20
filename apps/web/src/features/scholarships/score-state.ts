/**
 * What an application's numbers mean right now. The list, the detail, and the exports all read
 * it from here, because a stored total is not the same thing as a current score: ingest leaves
 * the previous total in place when the answers change, and a claim leaves it in place while a
 * rescore runs. Reading `total_score !== null` as "scored" is what showed a superseded number
 * as a current one.
 */

export type ScoreState = "scored" | "needs_rescore" | "running" | "failed" | "unscored";

export interface StatedApplication {
  status: string;
  total_score: number | null;
  rubric_version: string | null;
  claimed_until: string | null;
}

export function scoreState(app: StatedApplication, now = new Date().toISOString()): ScoreState {
  if (app.status === "score_failed") return "failed";
  // A claim past its expiry is work again, whatever the status still says.
  if (app.status === "processing" && (app.claimed_until ?? "") > now) return "running";
  if (app.total_score === null) return "unscored";
  // Ingest takes the version off when an applicant's own content changes, so a total without one
  // was made from answers the store no longer holds.
  if (app.rubric_version === null) return "needs_rescore";
  return "scored";
}

/** Whether the stored total and per-criterion scores are this application's current score. */
export function hasCurrentScore(app: StatedApplication, now?: string): boolean {
  return scoreState(app, now) === "scored";
}

export const STATE_LABELS: Record<ScoreState, string> = {
  scored: "scored",
  needs_rescore: "needs rescoring",
  running: "running",
  failed: "failed",
  unscored: "unscored",
};
