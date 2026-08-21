/**
 * Which rows of the review queue a filter leaves showing.
 *
 * The queue is paged on the server in gap order, so filtering happens over the page in hand and
 * never over the whole queue. That is a real limit and the screen says it: narrowing here narrows
 * this page, not the queue behind it. Kept out of the component because this is where a filter can
 * quietly hide an application somebody was told to look at.
 */

import { contains, within } from "@/features/scholarships/list-rows";

/** One row of the queue, as the gap index projects it. */
export interface FlaggedApplication {
  pk: string;
  sk: string;
  student_uuid: string;
  scholarship: string;
  year: string;
  score_gap: number;
  total_score: number | null;
  reviewer_total: number | null;
  reviewer_count: number | null;
  reviewers_stored: number | null;
  rubric_version: string | null;
  academic_program: string | null;
  academic_level: string | null;
  major: string | null;
  gpa: string | number | null;
}

export interface QueueFilters {
  applicant: string;
  major: string;
  gpaMin: string;
  gpaMax: string;
  reviewerMin: string;
  reviewerMax: string;
  modelMin: string;
  modelMax: string;
  gapMin: string;
  gapMax: string;
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = {
  applicant: "",
  major: "",
  gpaMin: "",
  gpaMax: "",
  reviewerMin: "",
  reviewerMax: "",
  modelMin: "",
  modelMax: "",
  gapMin: "",
  gapMax: "",
};

export function queueRows(
  applications: FlaggedApplication[],
  filters: QueueFilters,
): FlaggedApplication[] {
  return applications.filter((app) => {
    if (!contains(app.student_uuid, filters.applicant)) return false;
    if (!contains(app.major, filters.major)) return false;
    if (!within(app.gpa === null ? null : Number(app.gpa), filters.gpaMin, filters.gpaMax)) {
      return false;
    }
    if (!within(app.reviewer_total, filters.reviewerMin, filters.reviewerMax)) return false;
    if (!within(app.total_score, filters.modelMin, filters.modelMax)) return false;
    if (!within(app.score_gap, filters.gapMin, filters.gapMax)) return false;
    return true;
  });
}
