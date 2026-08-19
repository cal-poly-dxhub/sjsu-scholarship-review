import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/sjsu/components/ui/native-select";
import { Separator } from "@/sjsu/components/ui/separator";
import { RubricPanel } from "./rubric-panel";
import { UploadPanel } from "./upload-panel";
import { weightsOnlyChange, type RubricVersion } from "./version-change";

interface Application {
  sk: string;
  status: string;
  total_score: number | null;
  rubric_version: string | null;
  claimed_until: string | null;
  attempt: number | null;
}

interface CohortResponse {
  applications: Application[];
  total: number;
}

interface VersionsResponse {
  versions: RubricVersion[];
}

interface RunResponse {
  work: number;
  action: string;
  scope?: string | null;
  started: boolean;
  path?: string;
  wait?: string;
  note?: string;
  message?: string;
}

type Path = "auto" | "ondemand" | "batch";

/** What one press asks for. A scoring run carries the scope of the button that started it. */
type Run =
  | { action: "recompute" }
  | { action: "score"; scope: "unscored" | "failed" | "changed_version" };

// The same limit the workers stop at. An application here is not picked up by any run again.
const ATTEMPT_LIMIT = 3;

// Where the run handler switches workers when nobody overrides it.
const BATCH_LINE = 500;

// A run is watched by re-reading the cohort, because no run record is stored.
const POLL_MS = 5000;

/**
 * The half of the dashboard that starts things: a cohort to work on, its workbook, its rubric,
 * and the runs. Scoped to one scholarship and year — the reliability sections below span all of
 * them, which is why the two do not share a picker.
 */
export function TriggerSection() {
  const [scholarship, setScholarship] = useState("");
  const [year, setYear] = useState("");
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  const [path, setPath] = useState<Path>("auto");
  const queryClient = useQueryClient();

  const cohortQuery = useQuery({
    queryKey: ["cohort", scholarship, year],
    queryFn: () =>
      api<CohortResponse>(
        `/cohort?scholarship=${encodeURIComponent(scholarship)}&year=${encodeURIComponent(year)}`,
      ),
    enabled: scholarship !== "" && year !== "",
    // A run is watched by re-reading the cohort while anything in it is claimed.
    refetchInterval: (query) =>
      (query.state.data?.applications ?? []).some((app) => app.status === "processing")
        ? POLL_MS
        : false,
  });

  const versionsQuery = useQuery({
    queryKey: ["rubric-versions", scholarship],
    queryFn: () =>
      api<VersionsResponse>(`/rubric-versions?scholarship=${encodeURIComponent(scholarship)}`),
    enabled: scholarship !== "",
  });

  const versions = versionsQuery.data?.versions ?? [];
  // Newest published, because that is the version a person just made and the one they mean.
  const version = pickedVersion ?? versions[0]?.version ?? null;
  const target = versions.find((published) => published.version === version);

  const work = useMemo(() => {
    const applications = cohortQuery.data?.applications ?? [];
    const byVersion = new Map(versions.map((published) => [published.version, published]));
    const moment = Date.now();
    const counts = {
      unscored: 0,
      running: 0,
      failed: 0,
      exhausted: 0,
      done: 0,
      recompute: 0,
      rescore: 0,
    };

    for (const application of applications) {
      const held = application.claimed_until ? Date.parse(application.claimed_until) : 0;
      if (application.status === "processing" && held > moment) {
        counts.running += 1;
      } else if (application.status === "score_failed") {
        if ((application.attempt ?? 0) < ATTEMPT_LIMIT) counts.failed += 1;
        else counts.exhausted += 1;
      } else if (application.total_score !== null && application.rubric_version) {
        const stored = byVersion.get(application.rubric_version);
        if (application.rubric_version === version) counts.done += 1;
        else if (target && stored && weightsOnlyChange(stored, target)) counts.recompute += 1;
        else counts.rescore += 1;
      } else {
        // An expired claim is work again, whatever the status still says.
        counts.unscored += 1;
      }
    }
    return counts;
  }, [cohortQuery.data, versions, version, target]);

  // Everything a scoring run of any scope could still take. Only for the counts beside the list.
  const scoreWork = work.unscored + work.rescore + work.failed;

  /** Which worker a run of this size goes to, unless someone overrode the path. */
  const workerFor = (count: number): string =>
    path === "auto" ? (count >= BATCH_LINE ? "batch" : "ondemand") : path;

  const run = useMutation({
    mutationFn: (asked: Run) =>
      api<RunResponse>("/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scholarship,
          year,
          rubric_version: version,
          ...asked,
          ...(asked.action === "score" && path !== "auto" ? { path } : {}),
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cohort", scholarship, year] }),
  });

  const scoped = scholarship !== "" && year !== "";
  const hasCohort = (cohortQuery.data?.total ?? 0) > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Run a cohort</h2>
            <p className="text-sm text-muted-foreground">
              Type the scholarship and year to work on. There is no read that lists cohorts —
              every read names one.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Scholarship</Label>
              <Input
                className="mt-1 w-56"
                value={scholarship}
                placeholder="sjsu-general"
                onChange={(event) => {
                  setScholarship(event.target.value.trim());
                  setPickedVersion(null);
                }}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Year</Label>
              <Input
                className="mt-1 w-28"
                value={year}
                placeholder="2026"
                onChange={(event) => setYear(event.target.value.trim())}
              />
            </div>
            {scoped && (
              <Badge variant="outline">
                {cohortQuery.isLoading ? "reading the cohort…" : `${cohortQuery.data?.total ?? 0} applications`}
              </Badge>
            )}
          </div>
          {cohortQuery.isError && (
            <p className="text-sm text-warning">
              {cohortQuery.error instanceof Error
                ? cohortQuery.error.message
                : "The cohort could not be read"}
            </p>
          )}
        </CardContent>
      </Card>

      {scoped && <UploadPanel scholarship={scholarship} year={year} />}

      {scoped && hasCohort && <RubricPanel scholarship={scholarship} />}
      {scoped && !hasCohort && !cohortQuery.isLoading && (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {scholarship} {year} has no applications yet, so there is nothing to publish a
              rubric for. Upload the workbook first.
            </p>
          </CardContent>
        </Card>
      )}

      {scoped && hasCohort && (
        <Card>
          <CardContent className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Scoring</h2>
              <p className="text-sm text-muted-foreground">
                Every count below is worked out against the version picked here, and every run is
                for it.
              </p>
            </div>

            {versions.length === 0 ? (
              <p className="text-sm">
                {scholarship} has no published rubric version, so there is nothing to score
                against and no run is offered. Publish one above.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Rubric version</Label>
                    <NativeSelect
                      className="mt-1 w-40"
                      value={version ?? ""}
                      onChange={(event) => setPickedVersion(event.target.value)}
                    >
                      {versions.map((published) => (
                        <NativeSelectOption key={published.version} value={published.version}>
                          {published.version}
                          {published.version === versions[0]?.version ? " (newest)" : ""}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    A publish does not move a cohort. An application says which version scored it,
                    and until a run moves it, that stays true.
                  </p>
                </div>

                <Separator />

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">done at {version}: {work.done}</Badge>
                  <Badge variant="outline">running: {work.running}</Badge>
                  <Badge variant="outline">left: {scoreWork + work.recompute}</Badge>
                  <Badge variant={work.failed > 0 ? "warning" : "outline"}>
                    failed: {work.failed}
                  </Badge>
                  {work.exhausted > 0 && (
                    <Badge variant="warning">out of attempts: {work.exhausted}</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      queryClient.invalidateQueries({ queryKey: ["cohort", scholarship, year] })
                    }
                  >
                    Re-read
                  </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Trigger
                    label="Score the unscored"
                    count={work.unscored}
                    detail={`Applications with no total yet. Goes to the ${workerFor(work.unscored)} worker.`}
                    onRun={() => run.mutate({ action: "score", scope: "unscored" })}
                    busy={run.isPending}
                  />
                  <Trigger
                    label="Recompute after a weight change"
                    count={work.recompute}
                    detail="Totals made under a version that changed weights only. No model call."
                    onRun={() => run.mutate({ action: "recompute" })}
                    busy={run.isPending}
                  />
                  <Trigger
                    label="Rescore what changed"
                    count={work.rescore}
                    detail={`Totals made under a version whose criteria differ from ${version}. ${work.rescore} model calls, on the ${workerFor(work.rescore)} worker.`}
                    onRun={() => run.mutate({ action: "score", scope: "changed_version" })}
                    busy={run.isPending}
                  />
                  <Trigger
                    label="Retry what failed"
                    count={work.failed}
                    detail={`Failures under the ${ATTEMPT_LIMIT}-attempt limit. Goes to the ${workerFor(work.failed)} worker.`}
                    onRun={() => run.mutate({ action: "score", scope: "failed" })}
                    busy={run.isPending}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Each button takes only the applications it counts. All three score against{" "}
                  {version}; the recompute is the separate job, arithmetic over scores already
                  stored.
                </p>

                <Separator />

                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Which worker</h3>
                  <p className="text-sm text-muted-foreground">
                    Decided per run, off the count on the button pressed. Under {BATCH_LINE} the
                    on-demand worker calls the model once per application and finishes in seconds
                    to minutes. At {BATCH_LINE} or more a batch job halves the token price and
                    takes hours. Each scoring button above says which worker it would use.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Path</Label>
                      <NativeSelect
                        className="mt-1 w-48"
                        value={path}
                        onChange={(event) => setPath(event.target.value as Path)}
                      >
                        <NativeSelectOption value="auto">
                          the count decides
                        </NativeSelectOption>
                        <NativeSelectOption value="ondemand">on demand</NativeSelectOption>
                        <NativeSelectOption value="batch">batch</NativeSelectOption>
                      </NativeSelect>
                    </div>
                    {path === "batch" && scoreWork < BATCH_LINE && (
                      <p className="text-sm text-muted-foreground">
                        A batch job also has a floor on how many records it takes. Every scoring
                        count here is under {BATCH_LINE}, so a run below the floor is refused and
                        nothing is claimed.
                      </p>
                    )}
                  </div>
                </div>

                {run.isError && (
                  <p className="text-sm text-warning">
                    {run.error instanceof Error ? run.error.message : "The run was refused"}
                  </p>
                )}
                {run.data && (
                  <p className="text-sm">
                    {run.data.started
                      ? `Started ${run.data.action}${run.data.path ? ` on the ${run.data.path} path` : ""} over ${run.data.work} applications. Expect ${run.data.wait}. ${run.data.note ?? ""}`
                      : run.data.message}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** One trigger. A count of zero is shown and unavailable, not hidden. */
function Trigger({
  label,
  count,
  detail,
  onRun,
  busy,
}: {
  label: string;
  count: number;
  detail: string;
  onRun: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={count > 0 ? "secondary" : "outline"}>{count}</Badge>
        <Button size="sm" disabled={count === 0 || busy} onClick={onRun}>
          Run
        </Button>
      </div>
    </div>
  );
}
