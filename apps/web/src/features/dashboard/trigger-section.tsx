import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Label } from "@/sjsu/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/sjsu/components/ui/native-select";
import { Separator } from "@/sjsu/components/ui/separator";
import { Spinner } from "@/sjsu/components/ui/spinner";
import { isAcademicYear } from "@/lib/academic-year";
import {
  CohortPicker,
  useScholarshipName,
  type CohortChoice,
} from "@/features/cohorts/cohort-picker";
import { runStatus, settling, type Started } from "./run-state";
import { ReviewerScoresPanel, UploadPanel } from "./upload-panel";
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

/** Only the parts a person is shown. The run reply carries more; the screen has no use for it. */
interface RunResponse {
  work: number;
  started: boolean;
  wait?: string;
  message?: string;
}

type Path = "auto" | "ondemand" | "batch";

/** What one press asks for. A scoring run carries the scope of the button that started it. */
type Run =
  | { action: "recompute" }
  | { action: "score"; scope: "unscored" | "failed" | "changed_version" };

/** One press: what to ask the API for, and the button's own words for it. */
interface Press {
  asked: Run;
  label: string;
}

/** Which trigger a run came from, so the button that started it is the one that says so. */
function runKey(asked: Run): string {
  return asked.action === "score" ? `score:${asked.scope}` : "recompute";
}

// The same limit the scoring side stops at. An application here is not picked up by a run again.
const ATTEMPT_LIMIT = 3;

// Where a run switches to one large job when nobody overrides it.
const BATCH_LINE = 500;

// A run is watched by re-reading the cohort, because no run record is stored.
const POLL_MS = 5000;

// While waiting on a run's first claim, re-read faster: showing it took hold is the whole point.
const SETTLE_POLL_MS = 2000;

/**
 * The half of the dashboard that starts things: an export to upload, a cohort to work on, its
 * rubric, and the runs. Scoped to one scholarship and year, and this is the only place that pair
 * is picked — the coverage panel below reads the same cohort, so the choice is held by the page.
 */
export function TriggerSection({
  chosen,
  onChosen,
}: {
  chosen: CohortChoice;
  onChosen: (choice: CohortChoice) => void;
}) {
  const { scholarship, year } = chosen;
  const named = useScholarshipName(scholarship);
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  const [path, setPath] = useState<Path>("auto");
  const [started, setStarted] = useState<Started | null>(null);
  const queryClient = useQueryClient();

  // A cohort is only addressable once the year is the one form, so nothing is read until then.
  const scoped = scholarship !== "" && isAcademicYear(year);

  // Read on every render, like the claim expiry below, so the window closes on the next poll.
  const waiting = settling(started, Date.now());

  const cohortQuery = useQuery({
    queryKey: ["cohort", scholarship, year],
    queryFn: () =>
      api<CohortResponse>(
        `/cohort?scholarship=${encodeURIComponent(scholarship)}&year=${encodeURIComponent(year)}`,
      ),
    enabled: scoped,
    // A run is watched by re-reading the cohort while anything in it is claimed, and from the
    // press until the first claim shows up — without that second half the screen stops polling
    // before the worker has claimed anything and the run never appears at all.
    refetchInterval: (query) => {
      if (waiting) return SETTLE_POLL_MS;
      const applications = query.state.data?.applications ?? [];
      return applications.some((app) => app.status === "processing") ? POLL_MS : false;
    },
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

  const { inFlight, activeKey } = runStatus(started, work.running);

  /** How a run of this size would be done, in the same words the section below uses. */
  const speedFor = (count: number): string =>
    (path === "auto" ? count >= BATCH_LINE : path === "batch")
      ? "Sent as one large job, so it takes hours."
      : "Scored one at a time, so it takes minutes.";

  const run = useMutation({
    mutationFn: ({ asked }: Press) =>
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
    onSuccess: (data, { asked, label }) => {
      // Only a run that actually started locks the screen. A 200 saying there was nothing to do
      // leaves every button where it was.
      if (data.started) {
        setStarted({ at: Date.now(), key: runKey(asked), label, work: data.work });
      }
      queryClient.invalidateQueries({ queryKey: ["cohort", scholarship, year] });
    },
  });

  /** A button's press. The label travels with it so the run in flight can be named. */
  const press = (asked: Run, label: string) => () => {
    setStarted(null);
    run.mutate({ asked, label });
  };

  // Every trigger locks, not just the one pressed. They all feed the same cohort, and the reason
  // to stop a second press is that the first run is still working through the items.
  const locked = run.isPending || inFlight;

  const hasCohort = (cohortQuery.data?.total ?? 0) > 0;

  return (
    <div className="space-y-4">
      <UploadPanel />

      <ReviewerScoresPanel />

      <Card>
        <CardContent className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Pick a cohort</h2>
            <p className="reading text-sm text-muted-foreground">
              The scholarship and year everything below works on. The list holds every cohort
              uploaded so far.
            </p>
          </div>
          <CohortPicker
            value={chosen}
            onChange={(choice) => {
              onChosen(choice);
              setPickedVersion(null);
            }}
          />
          {scoped && (
            <Badge variant="outline">
              {cohortQuery.isLoading
                ? "Loading the cohort…"
                : `${cohortQuery.data?.total ?? 0} applications`}
            </Badge>
          )}
          {cohortQuery.isError && (
            <p className="text-sm text-warning">
              {cohortQuery.error instanceof Error
                ? cohortQuery.error.message
                : "We could not load this cohort."}
            </p>
          )}
        </CardContent>
      </Card>

      {scoped && !hasCohort && !cohortQuery.isLoading && (
        <Card>
          <CardContent>
            <p className="reading text-sm text-muted-foreground">
              {named} {year} has no applications yet, so there is nothing to score. Upload its
              export first.
            </p>
          </CardContent>
        </Card>
      )}

      {scoped && hasCohort && (
        <Card>
          <CardContent className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Scoring</h2>
              <p className="reading text-sm text-muted-foreground">
                Every count below is against the rubric version picked here, and so is every run.
              </p>
            </div>

            {versions.length === 0 ? (
              <p className="reading text-sm">
                {named} has no published rubric yet, so there is nothing to score against. Publish
                one on the Rubrics screen.
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
                  <p className="reading text-sm text-muted-foreground">
                    Publishing a rubric does not rescore anything. Each application keeps the
                    version that scored it until you run it again.
                  </p>
                </div>

                <Separator />

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">
                    {work.done} scored at {version}
                  </Badge>
                  <Badge variant="outline">{work.running} being scored</Badge>
                  <Badge variant="outline">{scoreWork + work.recompute} left to do</Badge>
                  <Badge variant={work.failed > 0 ? "warning" : "outline"}>
                    {work.failed} failed
                  </Badge>
                  {work.exhausted > 0 && (
                    <Badge variant="warning">
                      {work.exhausted} gave up after {ATTEMPT_LIMIT} tries
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      queryClient.invalidateQueries({ queryKey: ["cohort", scholarship, year] })
                    }
                  >
                    Refresh
                  </Button>
                </div>

                {inFlight && (
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
                    <Spinner className="mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">
                        {started ? `${started.label} — running` : "A run is in progress"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {work.running > 0
                          ? `${work.running}${started ? ` of ${started.work}` : ""} being scored right now. The buttons stay off until it finishes.`
                          : "Started. Nothing has been picked up yet, so the counts below have not moved."}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <Trigger
                    label="Score the unscored"
                    count={work.unscored}
                    detail={`Applications with no score yet. ${speedFor(work.unscored)}`}
                    onRun={press({ action: "score", scope: "unscored" }, "Score the unscored")}
                    locked={locked}
                    running={activeKey === "score:unscored"}
                  />
                  <Trigger
                    label="Recompute after a weight change"
                    count={work.recompute}
                    detail="Scored under a version where only the weights changed. The totals are added up again and nothing is read again."
                    onRun={press({ action: "recompute" }, "Recompute after a weight change")}
                    locked={locked}
                    running={activeKey === "recompute"}
                  />
                  <Trigger
                    label="Rescore what changed"
                    count={work.rescore}
                    detail={`Scored under a version whose criteria differ from ${version}. These are read and scored from scratch. ${speedFor(work.rescore)}`}
                    onRun={press(
                      { action: "score", scope: "changed_version" },
                      "Rescore what changed",
                    )}
                    locked={locked}
                    running={activeKey === "score:changed_version"}
                  />
                  <Trigger
                    label="Retry what failed"
                    count={work.failed}
                    detail={`Applications that failed and still have tries left, out of ${ATTEMPT_LIMIT}. ${speedFor(work.failed)}`}
                    onRun={press({ action: "score", scope: "failed" }, "Retry what failed")}
                    locked={locked}
                    running={activeKey === "score:failed"}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Each button takes only the applications it counts. The first, third, and fourth
                  score against {version}. The recompute only adds up scores already saved.
                </p>

                <Separator />

                <div className="space-y-2">
                  <h3 className="text-sm font-medium">How a run is done</h3>
                  <p className="reading text-sm text-muted-foreground">
                    Under {BATCH_LINE} applications, each one is scored on its own and the run
                    finishes in seconds to minutes. At {BATCH_LINE} or more it is sent as one large
                    job, which costs about half as much and takes hours. Each button above says
                    which way it would go.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">How to run</Label>
                      <NativeSelect
                        className="mt-1 w-48"
                        value={path}
                        onChange={(event) => setPath(event.target.value as Path)}
                      >
                        <NativeSelectOption value="auto">Let the count decide</NativeSelectOption>
                        <NativeSelectOption value="ondemand">One at a time</NativeSelectOption>
                        <NativeSelectOption value="batch">One large job</NativeSelectOption>
                      </NativeSelect>
                    </div>
                    {path === "batch" && scoreWork < BATCH_LINE && (
                      <p className="reading text-sm text-muted-foreground">
                        One large job has a smallest size as well. Every count here is under{" "}
                        {BATCH_LINE}, so a run this small would be turned down and nothing would
                        start.
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
                      ? `Started on ${run.data.work} applications. Expect it to take ${run.data.wait}.`
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

/**
 * One trigger. A count of zero is shown and unavailable, not hidden.
 *
 * `locked` is any run being in flight; `running` is this button being the one that started it.
 */
function Trigger({
  label,
  count,
  detail,
  onRun,
  locked,
  running,
}: {
  label: string;
  count: number;
  detail: string;
  onRun: () => void;
  locked: boolean;
  running: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={count > 0 ? "secondary" : "outline"}>{count}</Badge>
        <Button size="sm" disabled={count === 0 || locked} onClick={onRun}>
          {running && <Spinner />}
          {running ? "Running" : "Run"}
        </Button>
      </div>
    </div>
  );
}
