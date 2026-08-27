/**
 * Which rows the applications list shows, and in what order. Kept out of the component because
 * this is where a search can quietly lose an applicant.
 */

import { hasCurrentScore } from "./score-state";

/** The fields the list reads. Both reads carry them; the ranked one projects a subset. */
export interface ListApplication {
  sk: string;
  student_uuid: string;
  status: string;
  academic_program: string | null;
  academic_level: string | null;
  major: string | null;
  gpa: string | number | null;
  total_score: number | null;
  rubric_version: string | null;
  claimed_until: string | null;
  reviewer_total?: number | null;
  score_gap?: number | null;
}

export interface ListFilters {
  program: string;
  level: string;
  major: string;
  gpaMin: string;
  gpaMax: string;
  totalMin: string;
  totalMax: string;
  reviewerMin: string;
  reviewerMax: string;
  gapMin: string;
  gapMax: string;
}

export const EMPTY_FILTERS: ListFilters = {
  program: "",
  level: "",
  major: "",
  gpaMin: "",
  gpaMax: "",
  totalMin: "",
  totalMax: "",
  reviewerMin: "",
  reviewerMax: "",
  gapMin: "",
  gapMax: "",
};

export function isFiltering(search: string, filters: ListFilters): boolean {
  return search.trim() !== "" || Object.values(filters).some(Boolean);
}

/**
 * The rows to show, and whether they came off the ranking index.
 *
 * A search stands the ranked read down. The index holds only the comparable totals, so a search
 * over one ranked page cannot find an unscored or failed applicant at all — and those are the
 * ones somebody goes looking for.
 */
export function listRows<T extends ListApplication>({
  ranking,
  search,
  filters,
  cohort,
  ranked,
}: {
  ranking: boolean;
  search: string;
  filters: ListFilters;
  cohort: T[];
  ranked: T[];
}): { rows: T[]; rankedRead: boolean } {
  const rankedRead = ranking && !isFiltering(search, filters);
  if (!rankedRead) return { rows: matching(cohort, search, filters), rankedRead };

  // The index holds the order. The cohort read holds the fields the index does not project, so a
  // ranked row is looked up here — and nothing is reordered on the way.
  const byKey = new Map(cohort.map((app) => [app.sk, app]));
  return { rows: ranked.map((app) => byKey.get(app.sk) ?? app), rankedRead };
}

/** Search and the filter panel, over the fields the cohort read carries. No essay text here. */
export function matching<T extends ListApplication>(
  applications: T[],
  search: string,
  filters: ListFilters,
): T[] {
  const query = search.trim().toLowerCase();
  return applications.filter((app) => {
    if (query) {
      const haystack = [
        app.student_uuid,
        app.academic_program,
        app.academic_level,
        app.major,
        app.gpa,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (!contains(app.academic_program, filters.program)) return false;
    if (!contains(app.academic_level, filters.level)) return false;
    if (!contains(app.major, filters.major)) return false;
    if (!within(app.gpa === null ? null : Number(app.gpa), filters.gpaMin, filters.gpaMax)) {
      return false;
    }
    // A superseded total is not a total the range can match — the list does not show it either.
    const total = hasCurrentScore(app) ? app.total_score : null;
    if (!within(total, filters.totalMin, filters.totalMax)) return false;
    // Both are stored per application, and both are absent until a reviewer's scores are uploaded,
    // so a bound on either drops the applications that have no such number.
    if (!within(app.reviewer_total ?? null, filters.reviewerMin, filters.reviewerMax)) return false;
    if (!within(app.score_gap ?? null, filters.gapMin, filters.gapMax)) return false;
    return true;
  });
}

/** Whether a text field matches a filter box. An empty box matches everything. */
export function contains(value: string | null, term: string): boolean {
  if (!term) return true;
  return (value ?? "").toLowerCase().includes(term.toLowerCase());
}

// A missing number fails a bound rather than passing it, so a range never quietly includes
// applications that have no such number.
export function within(value: number | null, min: string, max: string): boolean {
  if (min && (value === null || Number.isNaN(value) || value < Number(min))) return false;
  if (max && (value === null || Number.isNaN(value) || value > Number(max))) return false;
  return true;
}
