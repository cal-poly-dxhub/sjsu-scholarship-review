/**
 * A set is one rubric version and one model. Totals from two sets are not comparable, so every
 * screen shows one set and names the others — this is where a set is named and counted.
 */

import { modelLabel } from "@/lib/models";

/** One set a cohort holds, and how many totals are in it. */
export interface CohortSet {
  rubric_version: string;
  model_id: string;
  count: number;
}

/** What a total scored before the model was recorded belongs to. Not the default having run. */
export const UNKNOWN_MODEL = "unknown";

export function setKey(rubricVersion: string, modelId: string): string {
  return `${rubricVersion}#${modelId}`;
}

/**
 * The sets in the cohort read's counts, biggest first, so the set most of the cohort was scored
 * in reads as the main one.
 */
export function setsPresent(counts: Record<string, number>): CohortSet[] {
  return Object.entries(counts)
    .map(([key, count]) => {
      // Split at the first separator: a rubric version has none, a model id can hold anything.
      const at = key.indexOf("#");
      return {
        rubric_version: key.slice(0, at),
        model_id: key.slice(at + 1),
        count,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** A model as a person reads it, including the one that was never recorded. */
export function modelWords(modelId: string | null): string {
  if (!modelId) return "no model recorded";
  if (modelId === UNKNOWN_MODEL) return "no model recorded";
  return modelLabel(modelId) ?? modelId;
}

/** A set in one phrase, for a badge or a sentence. */
export function setWords(rubricVersion: string | null, modelId: string | null): string {
  return `${rubricVersion ?? "no version"} · ${modelWords(modelId)}`;
}
