/**
 * The models a run may be scored by, in the same order and with the same ids as the CDK list
 * that builds the Bedrock policy.
 *
 * This is a second copy of that list, and it can drift. What keeps a drift cheap is the run
 * handler: it refuses a model it does not carry and names the ones it does, so a stale id here
 * is a plain refusal before anything is claimed, not a failure part-way through a cohort.
 */
export interface ScoringModel {
  id: string;
  tier: string;
  note: string;
}

export const SCORING_MODELS: ScoringModel[] = [
  {
    id: "us.anthropic.claude-opus-4-6-v1",
    tier: "Opus 4.6 — strongest",
    note: "the most expensive by a wide margin",
  },
  {
    id: "us.anthropic.claude-sonnet-4-6",
    tier: "Sonnet 4.6 — everyday",
    note: "the default, and what a cohort should normally be scored on",
  },
  {
    id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    tier: "Haiku 4.5 — cheap and fast",
    note: "cheapest, best for a trial run over a handful",
  },
];

export const DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

/**
 * What to show for a stored model id: its tier, or the raw id if it is not on the list any
 * more. Null means no model was recorded, which is not the same as the default having been used.
 */
export function modelLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return SCORING_MODELS.find((model) => model.id === id)?.tier ?? id;
}
