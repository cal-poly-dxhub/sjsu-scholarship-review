import { api } from "@/api";
import { scoreState } from "./score-state";

/**
 * Building the export file, in the browser, out of what the screen already fetched. Nothing is
 * written to S3, and nothing but the reasoning read costs an extra call.
 *
 * What is left out on purpose: claim fields, attempt counts, content hashes, the raw keys, and
 * DynamoDB's type wrappers. None of them means anything outside the pipeline.
 */

export interface ExportCriterion {
  id: string;
  name: string;
  max: number;
  weight: number;
}

export interface ExportApplication {
  student_uuid: string;
  status: string;
  claimed_until: string | null;
  academic_program: string | null;
  academic_level: string | null;
  major: string | null;
  gpa: string | number | null;
  total_score: number | null;
  rubric_version: string | null;
  latest_scored_at: string | null;
  category_scores: Record<string, { score: number; max: number }> | null;
  failure: string | null;
}

interface ScoredCriterion {
  score: number;
  max: number;
  reasoning: string;
  evidence: string;
}

export interface ScoreItem {
  category_scores: Record<string, ScoredCriterion>;
  total_score: number;
  reasoning_summary: string;
  rubric_version: string;
  model_id: string;
}

// One request per hundred keys, which is what a BatchGetItem takes and what makes progress
// visible instead of one long wait.
const BATCH_KEYS = 100;

export const EXPORT_WARNINGS = [
  "No score here is signed off — reviewer sign-off is not built.",
  "Only totals made under the same rubric version are comparable with each other.",
  "Unscored and failed applications are in this file with their state, not as a zero.",
  "A row whose state is not 'scored' carries the previous score, not a current one: the answers"
    + " changed after it was made, or a run is working on it now.",
];

// Named rather than only left out, so nobody reading this file mistakes a trimmed row for the
// whole record and concludes a field was never stored.
export const OMITTED_FIELDS = [
  "claimed_by and claimed_until — which run held the application",
  "attempt — how many times it has been tried",
  "content_hash — what the ingest read",
  "source — the workbook and row it came from",
  "pk and sk — the store's own keys",
  "qa_pairs — the applicant's essay answers",
];

/** How much of the cohort a file covers, the same counts the screen shows beside the list. */
export interface ExportCoverage {
  /** Applications in the cohort, whatever this file holds. */
  cohort_total: number;
  ranked: number;
  unscored: number;
  running: number;
  failed: number;
  scored_under_an_older_version: number;
}

/** Applications that have a score item to read, in batches of a hundred. */
export function reasoningBatches(
  applications: ExportApplication[],
): { student_uuid: string; latest_scored_at: string }[][] {
  const keys = applications
    .filter((app) => app.latest_scored_at)
    .map((app) => ({ student_uuid: app.student_uuid, latest_scored_at: app.latest_scored_at! }));

  const batches = [];
  for (let start = 0; start < keys.length; start += BATCH_KEYS) {
    batches.push(keys.slice(start, start + BATCH_KEYS));
  }
  return batches;
}

/**
 * The newest score item per application, read a hundred at a time. `onProgress` is called after
 * each request with how many applications have been asked about so far.
 */
export async function fetchReasoning(
  scholarship: string,
  year: string,
  applications: ExportApplication[],
  onProgress: (done: number, total: number) => void,
): Promise<Record<string, ScoreItem | null>> {
  const batches = reasoningBatches(applications);
  const total = batches.reduce((sum, batch) => sum + batch.length, 0);
  const scores: Record<string, ScoreItem | null> = {};
  let done = 0;

  for (const batch of batches) {
    const answer = await api<{ scores: Record<string, ScoreItem | null> }>("/scores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scholarship, year, applications: batch }),
    });
    Object.assign(scores, answer.scores);
    done += batch.length;
    onProgress(done, total);
  }
  return scores;
}

export function cohortExport({
  scholarship,
  year,
  rubricVersion,
  criteria,
  applications,
  coverage,
  scores,
}: {
  scholarship: string;
  year: string;
  rubricVersion: string | null;
  criteria: ExportCriterion[];
  /** The rows the screen is showing, in the order it shows them. */
  applications: ExportApplication[];
  coverage: ExportCoverage;
  // Absent when the reasoning box was off. A missing entry for one application means its score
  // item could not be read, which the file says per application.
  scores?: Record<string, ScoreItem | null>;
}) {
  const whole = applications.length === coverage.cohort_total;
  return {
    scholarship,
    year,
    rubric_version: rubricVersion,
    exported_at: new Date().toISOString(),
    // The file is what the screen was showing. Saying so is the difference between a filtered
    // list read as a filtered list and one read as the whole cohort.
    applications_in_file: applications.length,
    whole_cohort: whole,
    coverage,
    reviewed: false,
    reasoning_included: scores !== undefined,
    warnings: whole
      ? EXPORT_WARNINGS
      : [
          `This file holds the ${applications.length} applications the screen was showing, in that`
            + ` order, out of ${coverage.cohort_total} in the cohort.`,
          ...EXPORT_WARNINGS,
        ],
    omitted_fields: OMITTED_FIELDS,
    criteria,
    applications: applications.map((app) => row(app, criteria, scores)),
  };
}

/** One open application, always with its reasoning — the detail screen already read it. */
export function applicationExport({
  scholarship,
  year,
  criteria,
  application,
  score,
}: {
  scholarship: string;
  year: string;
  criteria: ExportCriterion[];
  application: ExportApplication;
  score: ScoreItem | null;
}) {
  return {
    scholarship,
    year,
    exported_at: new Date().toISOString(),
    reviewed: false,
    reasoning_included: true,
    warnings: EXPORT_WARNINGS,
    omitted_fields: OMITTED_FIELDS,
    criteria,
    application: row(application, criteria, { [application.student_uuid]: score }),
  };
}

function row(
  app: ExportApplication,
  criteria: ExportCriterion[],
  scores?: Record<string, ScoreItem | null>,
) {
  const wanted = scores !== undefined && app.latest_scored_at !== null;
  const score = scores?.[app.student_uuid] ?? null;
  return {
    student_uuid: app.student_uuid,
    state: scoreState(app),
    academic_program: app.academic_program,
    academic_level: app.academic_level,
    major: app.major,
    gpa: app.gpa,
    total_score: app.total_score,
    rubric_version: app.rubric_version,
    scored_at: app.latest_scored_at,
    failure: app.failure,
    // Asked for but not returned: the file keeps the scores and says the reasoning is unread,
    // so one unreadable score item does not fail the export.
    reasoning_read: wanted ? score !== null : undefined,
    reasoning_summary: score?.reasoning_summary,
    criteria: criteria.map((criterion) => {
      const stored = app.category_scores?.[criterion.id];
      const detailed = score?.category_scores?.[criterion.id];
      return {
        id: criterion.id,
        name: criterion.name,
        max: stored?.max ?? criterion.max,
        weight: criterion.weight,
        score: stored?.score ?? null,
        reasoning: detailed?.reasoning,
        evidence: detailed?.evidence,
      };
    }),
  };
}

/** Hand the file over as a download. The JSON is indented, because a person reads it. */
export function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
