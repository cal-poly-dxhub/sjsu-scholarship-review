/**
 * What an uploaded reviewer-score file was made of, as the ingest reported it.
 *
 * Kept out of the panel because this is where a rejected row can go missing: the report says how
 * many rows it could not place, and the screen has to say the same number even when the list of
 * them is shortened.
 */

/** One row the ingest could not place, with the reason in a reviewer's words. */
export interface RejectedRow {
  row: number;
  reason: string;
  /** For a repeated applicant: the row whose scores were kept instead. */
  kept_row?: number;
}

export interface IngestReport {
  file: string;
  scholarship?: string;
  year?: string;
  rows_read?: number;
  applications_placed?: number;
  reviewer_scores_stored?: number;
  rejected_rows?: RejectedRow[];
  /** Every row that missed, not just the listed ones. The list is cut short on a big file. */
  rejected_total?: number;
  flagged?: number;
  disagreement_line?: number;
  /** Set when the file could not be read at all, so no row was placed. */
  refused?: string;
}

export interface ReportResponse {
  key: string;
  read: boolean;
  report?: IngestReport;
}

/** One line saying what the ingest made of the file. */
export function reportSummary(report: IngestReport): string {
  if (report.refused) return report.refused;
  const rejected = report.rejected_total ?? report.rejected_rows?.length ?? 0;
  const placed = report.applications_placed ?? 0;
  return (
    `${report.rows_read ?? 0} rows read. ${placed} applications got a reviewer's score` +
    ` (${report.reviewer_scores_stored ?? 0} reviewer scores in all).` +
    (rejected === 0 ? "" : ` ${rejected} rows could not be placed.`) +
    (report.flagged === undefined
      ? ""
      : ` ${report.flagged} applications in this cohort are now flagged for a second look.`)
  );
}
