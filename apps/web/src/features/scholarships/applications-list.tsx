import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, TriangleAlert, X } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/sjsu/components/ui/native-select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/sjsu/components/ui/table";
import { SortableHead } from "@/sjsu/components/ui/sortable-head";
import { Checkbox } from "@/sjsu/components/ui/checkbox";
import { EmptyState } from "@/sjsu/components/empty-state";
import { hasEmptyMessage, TableEmptyOverlay } from "@/sjsu/components/table-empty-overlay";
import { FilterInput, FilterRange } from "@/sjsu/components/filter-controls";
import { NO_REVIEWER_SCORES, NotStored } from "@/sjsu/components/not-built";
import { Paging } from "@/sjsu/components/paging";
import { useTableSort } from "@/sjsu/lib/use-table-sort";
import { useScholarshipName } from "@/features/cohorts/cohort-picker";
import { cohortExport, download, fetchReasoning, reasoningBatches } from "./export";
import { EMPTY_FILTERS, isFiltering, listRows } from "./list-rows";
import { STATE_LABELS, hasCurrentScore, scoreState } from "./score-state";

/** One score on the application's own copy of the numbers. The reasoning lives on the score item. */
interface CriterionScore {
  score: number;
  max: number;
}

interface Application {
  pk: string;
  sk: string;
  student_uuid: string;
  status: string;
  academic_program: string | null;
  academic_level: string | null;
  major: string | null;
  gpa: string | number | null;
  category_scores: Record<string, CriterionScore> | null;
  total_score: number | null;
  rubric_version: string | null;
  latest_scored_at: string | null;
  claimed_until: string | null;
  failure: string | null;
  /** The average of the reviewers whose scores add up to a total comparable with the model's. */
  reviewer_total: number | null;
  reviewer_count: number | null;
  /** How many reviewers' scores are stored, comparable or not. */
  reviewers_stored: number | null;
  score_gap: number | null;
}

interface CohortResponse {
  applications: Application[];
  total: number;
  states: { scored: number; unscored: number; running: number; failed: number };
  scored_by_rubric_version: Record<string, number>;
  searchable: string;
}

interface RankedResponse {
  applications: Application[];
  cursor: string | null;
}

interface Criterion {
  id: string;
  name: string;
  max: number;
  weight: number;
}

interface VersionsResponse {
  versions: { version: string; criteria: Criterion[] }[];
}

type SortField = "total";

// One screen's worth of rows. The ranked read pages on the server; the cohort read comes back
// whole, so its paging is here.
const PAGE_SIZE = 200;

const SEARCH_COVERS =
  "Search covers applicant ID, program, level, major, and GPA — not the essays.";

// The comparison group, in order. One list drives the headers and the cells so the two cannot
// drift apart. "Final" is a signed-off score, and sign-off is not built.
const COMPARISON_COLUMNS = ["Reviewer", "Model", "Final", "Score gap", "Flagged"];

export function ApplicationsList({
  scholarship,
  year,
  onBack,
  onSelectApp,
  onScoreApp,
}: {
  scholarship: string;
  year: string;
  onBack: () => void;
  onSelectApp: (studentUuid: string) => void;
  /** Open one application on the hand-scoring screen. */
  onScoreApp: (studentUuid: string) => void;
}) {
  const named = useScholarshipName(scholarship);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  // Server pages come back as opaque markers. Index 0 is the first page, so it has none.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  const [withReasoning, setWithReasoning] = useState(false);
  // Off by default, and remembered nowhere: the list a reviewer works from is the list they have
  // now, and every cell the group adds is empty.
  const [comparing, setComparing] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Highest → lowest → off. Off is a cohort listing in the order the store returned it, because
  // an unordered list must not read as a ranking.
  const { sortBy, sortDir, setSort } = useTableSort<SortField>();
  const sortProps = { sortBy, sortDir, onSort: setSort } as const;
  const ranking = sortBy === "total";
  const direction = sortDir === "desc" ? "highest" : "lowest";
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const filtering = isFiltering(search, filters);

  // Only for the line the server draws between agreeing and disagreeing, and only while the
  // comparison columns are on. The figures it carries belong to the dashboard.
  const agreementQuery = useQuery({
    queryKey: ["agreement"],
    queryFn: () => api<{ disagreement_line: number }>("/agreement"),
    enabled: comparing,
  });
  const line = agreementQuery.data?.disagreement_line ?? null;

  const cohortQuery = useQuery({
    queryKey: ["cohort", scholarship, year],
    queryFn: () =>
      api<CohortResponse>(
        `/cohort?scholarship=${encodeURIComponent(scholarship)}&year=${encodeURIComponent(year)}`,
      ),
  });

  const versionsQuery = useQuery({
    queryKey: ["rubric-versions", scholarship],
    queryFn: () =>
      api<VersionsResponse>(`/rubric-versions?scholarship=${encodeURIComponent(scholarship)}`),
  });

  const scoredByVersion = cohortQuery.data?.scored_by_rubric_version ?? {};
  const versions = versionsQuery.data?.versions ?? [];
  // The version the shown totals were made under: the newest one this cohort actually has
  // totals for, so the criterion columns match the numbers beside them.
  const version =
    pickedVersion ?? versions.find((v) => scoredByVersion[v.version])?.version ?? null;
  const criteria = versions.find((v) => v.version === version)?.criteria ?? [];

  const rankedQuery = useQuery({
    queryKey: ["ranked", scholarship, year, version, direction, page],
    enabled: ranking && !filtering && version !== null,
    queryFn: () => {
      const marker = cursors[page];
      return api<RankedResponse>(
        `/ranked?scholarship=${encodeURIComponent(scholarship)}` +
          `&year=${encodeURIComponent(year)}` +
          `&rubric_version=${encodeURIComponent(version ?? "")}` +
          `&direction=${direction}&limit=${PAGE_SIZE}` +
          (marker ? `&cursor=${encodeURIComponent(marker)}` : ""),
      );
    },
  });

  const { rows: matched, rankedRead } = useMemo(
    () =>
      listRows({
        ranking,
        search,
        filters,
        cohort: cohortQuery.data?.applications ?? [],
        ranked: rankedQuery.data?.applications ?? [],
      }),
    [ranking, search, filters, cohortQuery.data, rankedQuery.data],
  );

  // Ranked pages come off the server already sized; a cohort listing is cut here.
  const shown = rankedRead ? matched : matched.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const firstOnPage = page * PAGE_SIZE;
  const hasNext = rankedRead
    ? Boolean(rankedQuery.data?.cursor)
    : (page + 1) * PAGE_SIZE < matched.length;

  const isLoading = cohortQuery.isLoading || (rankedRead && rankedQuery.isLoading);
  const isError = cohortQuery.isError || (rankedRead && rankedQuery.isError);

  const tableState = {
    isLoading,
    isError,
    unfilteredCount: cohortQuery.data?.total ?? 0,
    showFilterEmpty: matched.length === 0,
  };

  const states = cohortQuery.data?.states;
  const withReviewerScores = (cohortQuery.data?.applications ?? []).filter(
    (app) => app.reviewers_stored,
  ).length;
  const otherVersions = Object.entries(scoredByVersion)
    .filter(([name]) => name !== version)
    .reduce((sum, [, count]) => sum + count, 0);

  const resetPaging = () => {
    setPage(0);
    setCursors([null]);
  };

  // The rows the screen is showing, in that order — a person exporting a filtered list means
  // the list they filtered. What the file leaves out, it says: the coverage counts travel with it.
  const cohort = cohortQuery.data?.applications ?? [];
  const toRead = reasoningBatches(matched).reduce((sum, batch) => sum + batch.length, 0);
  const coverage = {
    cohort_total: cohortQuery.data?.total ?? cohort.length,
    ranked: scoredByVersion[version ?? ""] ?? 0,
    unscored: states?.unscored ?? 0,
    running: states?.running ?? 0,
    failed: states?.failed ?? 0,
    scored_under_an_older_version: otherVersions,
  };

  const exportCohort = async () => {
    setExportError(null);
    setExporting({ done: 0, total: withReasoning ? toRead : 0 });
    try {
      const scores = withReasoning
        ? await fetchReasoning(scholarship, year, matched, (done, total) =>
            setExporting({ done, total }),
          )
        : undefined;
      download(
        `${scholarship}-${year}${withReasoning ? "-with-reasoning" : ""}.json`,
        cohortExport({
          scholarship,
          year,
          rubricVersion: version,
          criteria,
          applications: matched,
          coverage,
          scores,
        }),
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The export failed");
    } finally {
      setExporting(null);
    }
  };

  const changeFilter = (key: keyof typeof EMPTY_FILTERS, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    resetPaging();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to scholarships">
          <ArrowLeft />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {named} · {year}
          </h1>
          <p className="text-sm text-muted-foreground">
            {matched.length} of {cohortQuery.data?.total ?? 0} applications
            {rankedRead ? `, ${direction} scores first` : ", in no particular order"}
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

      {/* What a ranking leaves out. None of these is in the index, so none is ranked as zero. */}
      {states && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{scoredByVersion[version ?? ""] ?? 0} ranked</Badge>
          <Badge variant="outline">{states.unscored} not scored yet</Badge>
          <Badge variant="outline">{states.running} being scored</Badge>
          <Badge variant={states.failed > 0 ? "warning" : "outline"}>{states.failed} failed</Badge>
          <Badge variant="outline">{otherVersions} scored under an older version</Badge>
          <span>Sign-off is not available yet, so nothing here is signed off.</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 max-w-xl">
          <Input
            placeholder="Search applicant ID, program, level, major, GPA"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPaging();
            }}
          />
        </div>
        {versions.length > 0 && (
          <div>
            <Label className="text-xs text-muted-foreground">Rubric version</Label>
            <NativeSelect
              className="mt-1 w-full"
              value={version ?? ""}
              onChange={(event) => {
                setPickedVersion(event.target.value);
                resetPaging();
              }}
            >
              {versions.map((v) => (
                <NativeSelectOption key={v.version} value={v.version}>
                  {v.version} · {scoredByVersion[v.version] ?? 0} scored
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>
      {/* Our own wording, not the server's: the read sends a line naming its stored fields. */}
      <p className="text-xs text-muted-foreground">{SEARCH_COVERS}</p>
      {ranking && filtering && (
        <p className="reading text-xs text-muted-foreground">
          Search results are not ranked, so applicants with no score and applicants that failed
          show up too. Clear the search and the filters to go back to the ranking.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={matched.length === 0 || exporting !== null}
          onClick={exportCohort}
        >
          {exporting
            ? "Exporting…"
            : `Export these ${matched.length} as JSON`}
        </Button>
        <Label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={withReasoning}
            onCheckedChange={(checked) => setWithReasoning(checked === true)}
          />
          Include reasoning and evidence
        </Label>
        {withReasoning && (
          <span className="text-xs text-muted-foreground">
            Adds the reasoning for {toRead} applications. The file is bigger and takes longer to
            build.
          </span>
        )}
        {exporting && exporting.total > 0 && (
          <span className="text-xs text-muted-foreground">
            {exporting.done} of {exporting.total} applications read
          </span>
        )}
        {exportError && <span className="text-xs text-warning">{exportError}</span>}
        <Label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={comparing}
            onCheckedChange={(checked) => setComparing(checked === true)}
          />
          Compare with a reviewer's score
        </Label>
      </div>
      {comparing && (
        <p className="reading text-xs text-muted-foreground">
          {withReviewerScores === 0
            ? `${NO_REVIEWER_SCORES} Upload them from the dashboard.`
            : `${withReviewerScores} of these applications have a reviewer's score. ` +
              (line === null
                ? ""
                : `A gap of ${line} points or more out of 100 is flagged for a second look.`) +
              " A final score needs sign-off, which is not built."}
        </p>
      )}

      {showFilters && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filter applications</span>
            {activeFilters > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  resetPaging();
                }}
              >
                <X /> Clear all
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
            <FilterInput
              label="Program"
              value={filters.program}
              onChange={(value) => changeFilter("program", value)}
            />
            <FilterInput
              label="Level"
              value={filters.level}
              onChange={(value) => changeFilter("level", value)}
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
              label="Total score"
              min={filters.totalMin}
              max={filters.totalMax}
              onMinChange={(value) => changeFilter("totalMin", value)}
              onMaxChange={(value) => changeFilter("totalMax", value)}
            />
            {/* The model's own range is the total score above, so it is not repeated here. */}
            <FilterRange
              label="Reviewer score"
              min={filters.reviewerMin}
              max={filters.reviewerMax}
              onMinChange={(value) => changeFilter("reviewerMin", value)}
              onMaxChange={(value) => changeFilter("reviewerMax", value)}
            />
            <FilterRange
              label="Score gap"
              min={filters.gapMin}
              max={filters.gapMax}
              onMinChange={(value) => changeFilter("gapMin", value)}
              onMaxChange={(value) => changeFilter("gapMax", value)}
            />
          </div>
        </div>
      )}

      {/* Asked here and not inside: when there is no message the wrapper must leave the table
          alone, rows and all. */}
      <EmptyState
        overlay={
          hasEmptyMessage(tableState) && (
            <TableEmptyOverlay
              {...tableState}
              error={{
                icon: <TriangleAlert className="size-5" />,
                title: "We could not load this cohort",
                subtitle: "Try again, and check the scholarship and year are the ones you want.",
              }}
              empty={{
                icon: <Search className="size-5" />,
                title: "No applications here yet",
                subtitle: `There are no applications for ${named} ${year} yet. Upload its export first.`,
              }}
              filterEmpty={{
                icon: <Search className="size-5" />,
                title: "Nothing matched",
                subtitle: SEARCH_COVERS,
              }}
            />
          )
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>#</TableHead>
              <TableHead>Applicant</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Major</TableHead>
              <TableHead>GPA</TableHead>
              <SortableHead field="total" {...sortProps}>
                Total
              </SortableHead>
              {/* Criterion names are long and the scores under them are short, so a name wraps
                  rather than holding its column open to the length of the name. */}
              {criteria.map((criterion) => (
                <TableHead key={criterion.id} className="whitespace-normal leading-tight">
                  {/* Names, maxima, and weights come off the published rubric, never from here. */}
                  <span
                    title={`${criterion.name} — out of ${criterion.max}, weight ${criterion.weight}`}
                  >
                    {criterion.name}
                  </span>
                </TableHead>
              ))}
              {/* Appended, never interleaved, so turning the group off gives back this table. */}
              {comparing &&
                COMPARISON_COLUMNS.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((app, index) => {
              // Only a current score is shown as a number. A superseded one is behind its state,
              // and the detail screen is where it can still be read.
              const current = hasCurrentScore(app);
              return (
                <TableRow
                  key={app.sk}
                  className="cursor-pointer"
                  onClick={() => onSelectApp(app.student_uuid)}
                >
                  <TableCell className="text-muted-foreground">{firstOnPage + index + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{app.student_uuid.slice(0, 8)}…</TableCell>
                  {/* Read in full, not cut to a width picked here. Fourteen columns do not fit a
                      laptop, and the table scrolling sideways is the answer to that — an ellipsis
                      hides the value even when the window had room for it. */}
                  <TableCell>{app.academic_program ?? "—"}</TableCell>
                  <TableCell>{app.academic_level ?? "—"}</TableCell>
                  <TableCell>{app.major ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{app.gpa ?? "—"}</TableCell>
                  {/* No badge per row: the line above the table already says nothing here is
                      signed off, and thirty copies of it cost the scores their room. */}
                  <TableCell className="tabular-nums font-medium">
                    {current ? app.total_score : "—"}
                  </TableCell>
                  {criteria.map((criterion) => {
                    const score = current ? app.category_scores?.[criterion.id] : undefined;
                    return (
                      <TableCell key={criterion.id} className="tabular-nums">
                        {score ? `${score.score}/${score.max}` : "—"}
                      </TableCell>
                    );
                  })}
                  {comparing && <ComparisonCells app={app} current={current} line={line} />}
                  <TableCell>
                    <StateBadge app={app} />
                  </TableCell>
                  <TableCell>
                    {/* The row opens the application to read. This opens it to score, so the
                        click must not do both. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        onScoreApp(app.student_uuid);
                      }}
                    >
                      Score
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </EmptyState>

      {(page > 0 || hasNext) && (
        <Paging
          page={page}
          showing={shown.length}
          hasNext={hasNext}
          onPrevious={() => setPage((current) => Math.max(0, current - 1))}
          onNext={() => {
            if (rankedRead) {
              const marker = rankedQuery.data?.cursor ?? null;
              setCursors((current) =>
                current.length > page + 1 ? current : [...current, marker],
              );
            }
            setPage((current) => current + 1);
          }}
        />
      )}
    </div>
  );
}

/**
 * The reviewer-against-model cells for one row, in the header's order.
 *
 * Three of the five are stored and two are not: a final score needs sign-off, and whether an
 * application is flagged is a comparison against the line the server draws — without that line the
 * cell says nothing rather than guessing at one.
 */
function ComparisonCells({
  app,
  current,
  line,
}: {
  app: Application;
  current: boolean;
  line: number | null;
}) {
  const gap = app.score_gap;
  return (
    <>
      <TableCell className="tabular-nums">
        {app.reviewer_total ?? (app.reviewers_stored ? <NotComparable /> : <NotStored />)}
        {app.reviewer_count !== null && app.reviewer_count > 1 && (
          <span className="ml-1 text-xs text-muted-foreground">avg of {app.reviewer_count}</span>
        )}
      </TableCell>
      <TableCell className="tabular-nums">{current ? app.total_score : "—"}</TableCell>
      {/* A final score is a signed-off one, and nothing here is signed off. */}
      <TableCell className="tabular-nums">
        <NotStored />
      </TableCell>
      <TableCell className="tabular-nums">{gap ?? <NotStored />}</TableCell>
      <TableCell>
        {gap === null || line === null ? (
          <NotStored />
        ) : gap >= line ? (
          <Badge variant="warning">Flagged</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">No</span>
        )}
      </TableCell>
    </>
  );
}

/** A reviewer scored it, but their scores do not add up to a total the model's can be read against. */
function NotComparable() {
  return (
    <span
      className="text-xs text-muted-foreground"
      title="A reviewer's scores are stored, but they do not add up to a total comparable with the model's — a criterion was skipped, or a score was outside its maximum."
    >
      Not comparable
    </span>
  );
}

function StateBadge({ app }: { app: Application }) {
  const state = scoreState(app);
  if (state === "scored") {
    return (
      <Badge variant="secondary" title={`Scored under rubric version ${app.rubric_version}`}>
        {app.rubric_version}
      </Badge>
    );
  }
  if (state === "failed" || state === "needs_rescore") {
    return <Badge variant="warning">{STATE_LABELS[state]}</Badge>;
  }
  return (
    <Badge variant={state === "running" ? "secondary" : "outline"}>{STATE_LABELS[state]}</Badge>
  );
}


