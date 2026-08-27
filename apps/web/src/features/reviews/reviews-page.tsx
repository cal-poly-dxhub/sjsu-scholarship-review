import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TriangleAlert, X } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/sjsu/components/ui/table";
import { EmptyState } from "@/sjsu/components/empty-state";
import { hasEmptyMessage, TableEmptyOverlay } from "@/sjsu/components/table-empty-overlay";
import { FilterInput, FilterRange } from "@/sjsu/components/filter-controls";
import { NotBuilt } from "@/sjsu/components/not-built";
import { Paging } from "@/sjsu/components/paging";
import { useScholarshipName } from "@/features/cohorts/cohort-picker";
import {
  EMPTY_QUEUE_FILTERS,
  queueRows,
  type FlaggedApplication,
  type QueueFilters,
} from "./queue-rows";

interface FlaggedResponse {
  applications: FlaggedApplication[];
  cursor: string | null;
  disagreement_line: number;
  why: string;
  reviewed: boolean;
}

// One screen's worth. The server pages the queue, so this is what a page asks for.
const PAGE_SIZE = 50;

// The filters narrow the page in hand, not the queue behind it, because the queue is paged on the
// server in gap order. Said once here and shown under the table.
const NARROWS_THIS_PAGE = "Filters narrow this page of the queue, not the queue behind it.";

/**
 * The review queue: the applications where a reviewer's score and the model's are far enough apart
 * to need a second look.
 *
 * Being in the queue is the whole of being flagged — the read comes off the gap index, which holds
 * only those applications, widest gap first. It crosses cohorts, so every row says which
 * scholarship it came from. Nothing here signs anything off, and looking at a row does not clear
 * it: a gap goes away when a corrected score makes it smaller.
 */
export function ReviewsPage({ onSelectApp }: { onSelectApp?: (studentUuid: string) => void }) {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(EMPTY_QUEUE_FILTERS);
  const [page, setPage] = useState(0);
  // Server pages come back as opaque markers. Index 0 is the first page, so it has none.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);

  const queue = useQuery({
    queryKey: ["flagged", page],
    queryFn: () => {
      const marker = cursors[page];
      return api<FlaggedResponse>(
        `/flagged?limit=${PAGE_SIZE}` + (marker ? `&cursor=${encodeURIComponent(marker)}` : ""),
      );
    },
  });

  const applications = queue.data?.applications ?? [];
  const rows = useMemo(() => queueRows(applications, filters), [applications, filters]);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const hasNext = Boolean(queue.data?.cursor);

  const tableState = {
    isLoading: queue.isLoading,
    isError: queue.isError,
    unfilteredCount: applications.length,
    showFilterEmpty: rows.length === 0,
  };

  const changeFilter = (key: keyof QueueFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Applications where a reviewer and the model are far enough apart to need a second look
            {queue.data ? `: ${queue.data.why}` : ""}.
          </p>
        </div>
        <Button
          variant={showFilters || activeFilters > 0 ? "default" : "outline"}
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
        >
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">{rows.length} on this page</Badge>
        {queue.data && (
          <Badge variant="outline">{queue.data.disagreement_line} points apart or more</Badge>
        )}
        <span>Widest gap first. Sign-off is not available, so nothing here is signed off.</span>
      </div>

      {/* Two things a reviewer would expect of a queue and will not find. Saying it here beats
          leaving them to work out that a row never leaves. */}
      <NotBuilt instead="Upload a corrected score and the gap is worked out again.">
        A row leaves this queue when the two totals come closer together, not when somebody reads
        it — there is no sign-off and no way to clear a flag by hand.
      </NotBuilt>

      {showFilters && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filter the queue</span>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_QUEUE_FILTERS)}>
                <X /> Clear all
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
            <FilterInput
              label="Applicant"
              value={filters.applicant}
              onChange={(value) => changeFilter("applicant", value)}
            />
            <FilterInput
              label="Major"
              value={filters.major}
              onChange={(value) => changeFilter("major", value)}
            />
            <FilterRange
              label="GPA"
              min={filters.gpaMin}
              max={filters.gpaMax}
              onMinChange={(value) => changeFilter("gpaMin", value)}
              onMaxChange={(value) => changeFilter("gpaMax", value)}
            />
            <FilterRange
              label="Reviewer score"
              min={filters.reviewerMin}
              max={filters.reviewerMax}
              onMinChange={(value) => changeFilter("reviewerMin", value)}
              onMaxChange={(value) => changeFilter("reviewerMax", value)}
            />
            <FilterRange
              label="Model score"
              min={filters.modelMin}
              max={filters.modelMax}
              onMinChange={(value) => changeFilter("modelMin", value)}
              onMaxChange={(value) => changeFilter("modelMax", value)}
            />
            <FilterRange
              label="Score gap"
              min={filters.gapMin}
              max={filters.gapMax}
              onMinChange={(value) => changeFilter("gapMin", value)}
              onMaxChange={(value) => changeFilter("gapMax", value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{NARROWS_THIS_PAGE}</p>
        </div>
      )}

      <EmptyState
        overlay={
          hasEmptyMessage(tableState) && (
            <TableEmptyOverlay
              {...tableState}
              error={{
                icon: <TriangleAlert className="size-5" />,
                title: "We could not load the queue",
                subtitle: "Try again, and say something if it keeps happening.",
              }}
              empty={{
                icon: <Search className="size-5" />,
                title: "Nothing is flagged",
                subtitle:
                  "No application has a reviewer's total and the model's far enough apart to need a second look. Upload reviewer scores from the dashboard to fill this in.",
              }}
              filterEmpty={{
                icon: <Search className="size-5" />,
                title: "Nothing matched",
                subtitle: NARROWS_THIS_PAGE,
              }}
            />
          )
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {/* No width set here: a column is as wide as the longest thing in it, and the table
                  scrolls sideways if they do not all fit. A width picked here squeezes a name into
                  two lines on a wide window. */}
              <TableHead>Applicant</TableHead>
              <TableHead>Scholarship</TableHead>
              <TableHead>Major</TableHead>
              <TableHead>GPA</TableHead>
              <TableHead>Reviewer</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Score gap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((app) => (
              <TableRow
                key={app.sk}
                className={onSelectApp ? "cursor-pointer" : undefined}
                onClick={() => onSelectApp?.(app.student_uuid)}
              >
                <TableCell className="font-mono text-xs">
                  {app.student_uuid.slice(0, 8)}…
                </TableCell>
                <TableCell>
                  <ScholarshipCell scholarship={app.scholarship} year={app.year} />
                </TableCell>
                <TableCell>{app.major ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{app.gpa ?? "—"}</TableCell>
                {/* The average of the reviewers who scored it, and how many that was — one
                    reviewer and three are read very differently. */}
                <TableCell className="tabular-nums">
                  {app.reviewer_total ?? "—"}
                  {app.reviewer_count && app.reviewer_count > 1 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      avg of {app.reviewer_count}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{app.total_score ?? "—"}</TableCell>
                <TableCell className="tabular-nums font-medium">{app.score_gap}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </EmptyState>

      <Paging
        page={page}
        showing={rows.length}
        hasNext={hasNext}
        onPrevious={() => setPage((current) => Math.max(0, current - 1))}
        onNext={() => {
          const marker = queue.data?.cursor ?? null;
          setCursors((current) => (current.length > page + 1 ? current : [...current, marker]));
          setPage((current) => current + 1);
        }}
      />
    </div>
  );
}

/** The wording the export used for the scholarship, with the year it belongs to. */
function ScholarshipCell({ scholarship, year }: { scholarship: string; year: string }) {
  const named = useScholarshipName(scholarship);
  return (
    <span>
      {named} <span className="text-muted-foreground">{year}</span>
    </span>
  );
}
