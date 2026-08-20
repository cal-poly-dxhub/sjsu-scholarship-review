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
import { TableEmptyOverlay } from "@/sjsu/components/table-empty-overlay";
import { useTableSort } from "@/sjsu/lib/use-table-sort";
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
  "Search covers the applicant id, program, level, major, and GPA. It does not reach the essays.";

export function ApplicationsList({
  scholarship,
  year,
  onBack,
  onSelectApp,
}: {
  scholarship: string;
  year: string;
  onBack: () => void;
  onSelectApp: (studentUuid: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  // Server pages come back as opaque markers. Index 0 is the first page, so it has none.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  const [withReasoning, setWithReasoning] = useState(false);
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

  const isLoading = cohortQuery.isLoading || (rankedRead && rankedQuery.isLoading);
  const isError = cohortQuery.isError || (rankedRead && rankedQuery.isError);

  const states = cohortQuery.data?.states;
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
            {scholarship} · {year}
          </h1>
          <p className="text-sm text-muted-foreground">
            {matched.length} of {cohortQuery.data?.total ?? 0} applications
            {rankedRead ? `, ${direction} scores first` : ", in the order they are stored"}
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
          <Badge variant="outline">{states.unscored} unscored</Badge>
          <Badge variant="outline">{states.running} running</Badge>
          <Badge variant={states.failed > 0 ? "warning" : "outline"}>{states.failed} failed</Badge>
          <Badge variant="outline">{otherVersions} scored under an older version</Badge>
          <span>Nothing here is signed off — reviewer sign-off is not built.</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-64">
          <Input
            placeholder="Search applicant id, program, level, major, GPA"
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
      <p className="text-xs text-muted-foreground">{cohortQuery.data?.searchable ?? SEARCH_COVERS}</p>
      {ranking && filtering && (
        <p className="text-xs text-muted-foreground">
          Searching covers the whole cohort, so these rows are in stored order, not ranked order.
          An unscored or failed applicant is findable here. Clear the search and the filters to go
          back to the ranking.
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
            : `Export ${matched.length} shown as JSON`}
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
            {toRead} applications will have their score item read, one request per hundred. The
            file is larger and the export takes longer.
          </span>
        )}
        {exporting && exporting.total > 0 && (
          <span className="text-xs text-muted-foreground">
            {exporting.done} of {exporting.total} score items read
          </span>
        )}
        {exportError && <span className="text-xs text-warning">{exportError}</span>}
      </div>

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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
            {/* The old human, AI, and variance filters are gone: one stored total per application
                is all the model keeps, and no second opinion exists to differ from. */}
            <FilterRange
              label="Total score"
              min={filters.totalMin}
              max={filters.totalMax}
              onMinChange={(value) => changeFilter("totalMin", value)}
              onMaxChange={(value) => changeFilter("totalMax", value)}
            />
          </div>
        </div>
      )}

      <EmptyState
        overlay={
          <TableEmptyOverlay
            isLoading={isLoading}
            isError={isError}
            unfilteredCount={cohortQuery.data?.total ?? 0}
            showFilterEmpty={matched.length === 0}
            error={{
              icon: <TriangleAlert className="size-5" />,
              title: "The cohort did not load",
              subtitle: "The read failed. Try again, and check the scholarship and year.",
            }}
            empty={{
              icon: <Search className="size-5" />,
              title: "No applications here yet",
              subtitle: `Nothing is stored for ${scholarship} ${year}. Upload its workbook first.`,
            }}
            filterEmpty={{
              icon: <Search className="size-5" />,
              title: "Nothing matched",
              subtitle: SEARCH_COVERS,
            }}
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">#</TableHead>
              <TableHead className="w-40">Applicant</TableHead>
              <TableHead className="w-32">Program</TableHead>
              <TableHead className="w-24">Level</TableHead>
              <TableHead className="w-44">Major</TableHead>
              <TableHead className="w-16">GPA</TableHead>
              <SortableHead field="total" {...sortProps} className="w-28">
                Total
              </SortableHead>
              {criteria.map((criterion) => (
                <TableHead key={criterion.id} className="w-20">
                  {/* Names, maxima, and weights come off the published rubric, never from here. */}
                  <span title={`${criterion.name} · max ${criterion.max} · weight ${criterion.weight}`}>
                    {criterion.name}
                  </span>
                </TableHead>
              ))}
              <TableHead className="w-28">State</TableHead>
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
                  <TableCell className="truncate">{app.academic_program ?? "—"}</TableCell>
                  <TableCell className="truncate">{app.academic_level ?? "—"}</TableCell>
                  <TableCell className="truncate">{app.major ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{app.gpa ?? "—"}</TableCell>
                  <TableCell className="tabular-nums font-medium">
                    {current ? app.total_score : "—"}
                    {current && (
                      <Badge variant="outline" className="ml-2">
                        unreviewed
                      </Badge>
                    )}
                  </TableCell>
                  {criteria.map((criterion) => {
                    const score = current ? app.category_scores?.[criterion.id] : undefined;
                    return (
                      <TableCell key={criterion.id} className="tabular-nums">
                        {score ? `${score.score}/${score.max}` : "—"}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <StateBadge app={app} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </EmptyState>

      <Paging
        page={page}
        showing={shown.length}
        hasNext={
          rankedRead
            ? Boolean(rankedQuery.data?.cursor)
            : (page + 1) * PAGE_SIZE < matched.length
        }
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
    </div>
  );
}

function StateBadge({ app }: { app: Application }) {
  const state = scoreState(app);
  if (state === "scored") return <Badge variant="secondary">{app.rubric_version}</Badge>;
  if (state === "failed" || state === "needs_rescore") {
    return <Badge variant="warning">{STATE_LABELS[state]}</Badge>;
  }
  return (
    <Badge variant={state === "running" ? "secondary" : "outline"}>{STATE_LABELS[state]}</Badge>
  );
}

function Paging({
  page,
  showing,
  hasNext,
  onPrevious,
  onNext,
}: {
  page: number;
  showing: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (page === 0 && !hasNext) return null;
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Page {page + 1} · {showing} applications
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={onPrevious}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="mt-1"
        value={value}
        placeholder="Search…"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function FilterRange({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
}: {
  label: string;
  min: string;
  max: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 flex gap-1.5">
        <Input
          type="number"
          value={min}
          placeholder="Min"
          onChange={(event) => onMinChange(event.target.value)}
        />
        <Input
          type="number"
          value={max}
          placeholder="Max"
          onChange={(event) => onMaxChange(event.target.value)}
        />
      </div>
    </div>
  );
}
