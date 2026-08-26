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
import { DEFAULT_MODEL_ID, SCORING_MODELS, modelLabel } from "@/lib/models";
import { CohortPicker, type CohortChoice } from "@/features/cohorts/cohort-picker";
import { runStatus, settling, type Started } from "./run-state";
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
  model_id?: string;
  wait?: string;
  note?: string;
  /** What a run on a second model does not touch. Only on a scoring run that started. */
  leaves_alone?: string;
  message?: string;
}

type Path = "auto" | "ondemand" | "batch";

/** What one press asks for. A scoring run carries the scope of the button that started it. */
type Run =
  | { action: "recompute" }
  | { action: "score"; scope: "unscored" | "failed" | "changed_version" | "other_model" };

/** One press: what to ask the API for, and the button's own words for it. */
interface Press {
  asked: Run;
  label: string;
}

/** Which trigger a run came from, so the button that started it is the one that says so. */
function runKey(asked: Run): string {
  return asked.action === "score" ? `score:${asked.scope}` : "recompute";
}

// The same limit the workers stop at. An application here is not picked up by any run again.
const ATTEMPT_LIMIT = 3;

// Where the run handler switches workers when nobody overrides it.
const BATCH_LINE = 500;

// A run is watched by re-reading the cohort, because no run record is stored.
const POLL_MS = 5000;

// While waiting on a run's first claim, re-read faster: showing it took hold is the whole point.
const SETTLE_POLL_MS = 2000;

/**
 * The half of the dashboard that starts things: an export to upload, a cohort to work on, its
 * rubric, and the runs. The chosen cohort is held by the page, because the coverage panel below
 * counts scoring for the same cohort and a second picker would let the two disagree.
 */
export function TriggerSection({
  chosen,
  onChosen,
}: {
  chosen: CohortChoice;
  onChosen: (choice: CohortChoice) => void;
}) {
  const setChosen = onChosen;
  const { scholarship, year } = chosen;
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  const [path, setPath] = useState<Path>("auto");
  const [model, setModel] = useState<string>(DEFAULT_MODEL_ID);
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

  const running = (cohortQuery.data?.applications ?? []).some(
    (application) => application.status === "processing",
  );

  // The same cohort read again, for the picked set. The application item only carries a copy of
  // its newest total, so it cannot say whether *this* model scored it — the set's own rows can.
  const setQuery = useQuery({
    queryKey: ["cohort", scholarship, year, "set", version, model],
    queryFn: () =>
      api<CohortResponse>(
        `/cohort?scholarship=${encodeURIComponent(scholarship)}&year=${encodeURIComponent(year)}` +
          `&rubric_version=${encodeURIComponent(version ?? "")}` +
          `&model_id=${encodeURIComponent(model)}`,
      ),
    enabled: scoped && version !== null,
    refetchInterval: waiting ? SETTLE_POLL_MS : running ? POLL_MS : false,
  });

  const work = useMemo(() => {
    const applications = cohortQuery.data?.applications ?? [];
    // Who has a total in this set. Anything else is work for it, whatever another model did.
    const inSet = new Set(
      (setQuery.data?.applications ?? [])
        .filter((application) => application.total_score !== null)
        .map((application) => application.sk),
    );
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
      otherModel: 0,
    };

    for (const application of applications) {
      const held = application.claimed_until ? Date.parse(application.claimed_until) : 0;
      if (application.status === "processing" && held > moment) {
        counts.running += 1;
      } else if (application.status === "score_failed") {
        if ((application.attempt ?? 0) < ATTEMPT_LIMIT) counts.failed += 1;
        else counts.exhausted += 1;
      } else if (inSet.has(application.sk)) {
        counts.done += 1;
      } else if (application.total_score !== null && application.rubric_version) {
        const stored = byVersion.get(application.rubric_version);
        // Scored at this version, but not by this model — the set has no total for it.
        if (application.rubric_version === version) counts.otherModel += 1;
        else if (target && stored && weightsOnlyChange(stored, target)) counts.recompute += 1;
        else counts.rescore += 1;
      } else {
        // An expired claim is work again, whatever the status still says.
        counts.unscored += 1;
      }
    }
    return counts;
  }, [cohortQuery.data, setQuery.data, versions, version, target]);

  // Everything a scoring run of any scope could still take. Only for the counts beside the list.
  const scoreWork = work.unscored + work.rescore + work.failed + work.otherModel;

  const { inFlight, activeKey } = runStatus(started, work.running);

  /** Which worker a run of this size goes to, unless someone overrode the path. */
  const workerFor = (count: number): string =>
    path === "auto" ? (count >= BATCH_LINE ? "batch" : "ondemand") : path;

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
          // A recompute is arithmetic over stored scores, so it is sent without a model.
          ...(asked.action === "score" ? { model_id: model } : {}),
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

      <Card>
        <CardContent className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Run a cohort</h2>
            <p className="text-sm text-muted-foreground">
              Pick the cohort to work on. The list is what has been ingested — every other read
              names one cohort, so this is the only place they can be found.
            </p>
          </div>
          <CohortPicker
            value={chosen}
            onChange={(choice) => {
              setChosen(choice);
              setPickedVersion(null);
            }}
          />
          {scoped && (
            <Badge variant="outline">
              {cohortQuery.isLoading
                ? "reading the cohort…"
                : `${cohortQuery.data?.total ?? 0} applications`}
            </Badge>
          )}
          {cohortQuery.isError && (
            <p className="text-sm text-warning">
              {cohortQuery.error instanceof Error
                ? cohortQuery.error.message
                : "The cohort could not be read"}
            </p>
          )}
        </CardContent>
      </Card>

      {scoped && hasCohort && <RubricPanel scholarship={scholarship} />}
      {scoped && !hasCohort && !cohortQuery.isLoading && (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {scholarship} {year} has no applications yet, so there is nothing to publish a
              rubric for. Upload its export first.
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
                  <div>
                    <Label className="text-xs text-muted-foreground">Model</Label>
                    <NativeSelect
                      className="mt-1 w-72"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                    >
                      {SCORING_MODELS.map((choice) => (
                        <NativeSelectOption key={choice.id} value={choice.id}>
                          {choice.tier}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    A publish does not move a cohort. An application says which version scored it,
                    and until a run moves it, that stays true.
                  </p>
                </div>

                <p className="text-sm text-muted-foreground">
                  {SCORING_MODELS.find((choice) => choice.id === model)?.note}. Every scoring run
                  below uses the model picked here, on either worker. A total belongs to the
                  version and the model that made it, so a run on this model leaves the totals from
                  other models exactly as they are — it adds a second reading rather than replacing
                  the first. The counts below are for {version} on this model only.
                </p>

                <Separator />

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">
                    done at {version} on {modelLabel(model) ?? model}: {work.done}
                  </Badge>
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

                {inFlight && (
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
                    <Spinner className="mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">
                        {started ? `${started.label} — running` : "A run is in progress"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {work.running > 0
                          ? `${work.running} claimed and being scored${started ? ` of ${started.work}` : ""}. Every trigger is held until it finishes.`
                          : "Started. Waiting for the worker to claim its first application, so the counts below have not moved yet."}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <Trigger
                    label="Score the unscored"
                    count={work.unscored}
                    detail={`Applications with no total yet. Goes to the ${workerFor(work.unscored)} worker.`}
                    onRun={press({ action: "score", scope: "unscored" }, "Score the unscored")}
                    locked={locked}
                    running={activeKey === "score:unscored"}
                  />
                  <Trigger
                    label="Recompute after a weight change"
                    count={work.recompute}
                    detail="Totals made under a version that changed weights only. No model call."
                    onRun={press({ action: "recompute" }, "Recompute after a weight change")}
                    locked={locked}
                    running={activeKey === "recompute"}
                  />
                  <Trigger
                    label="Rescore what changed"
                    count={work.rescore}
                    detail={`Totals made under a version whose criteria differ from ${version}. ${work.rescore} model calls, on the ${workerFor(work.rescore)} worker.`}
                    onRun={press(
                      { action: "score", scope: "changed_version" },
                      "Rescore what changed",
                    )}
                    locked={locked}
                    running={activeKey === "score:changed_version"}
                  />
                  <Trigger
                    label="Score what another model scored"
                    count={work.otherModel}
                    detail={`Applications with a total at ${version} from another model, and none from this one. ${work.otherModel} model calls, on the ${workerFor(work.otherModel)} worker. The other model's totals stay.`}
                    onRun={press(
                      { action: "score", scope: "other_model" },
                      "Score what another model scored",
                    )}
                    locked={locked}
                    running={activeKey === "score:other_model"}
                  />
                  <Trigger
                    label="Retry what failed"
                    count={work.failed}
                    detail={`Failures under the ${ATTEMPT_LIMIT}-attempt limit. Goes to the ${workerFor(work.failed)} worker.`}
                    onRun={press({ action: "score", scope: "failed" }, "Retry what failed")}
                    locked={locked}
                    running={activeKey === "score:failed"}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Each button takes only the applications it counts, and no application is on two of
                  them. All four score {version} on the model picked above; the recompute is the
                  separate job, arithmetic over scores already stored, and it moves every model's
                  totals.
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
                      ? `Started ${run.data.action}${run.data.path ? ` on the ${run.data.path} path` : ""}${run.data.model_id ? ` with ${modelLabel(run.data.model_id)}` : ""} over ${run.data.work} applications. Expect ${run.data.wait}. ${run.data.note ?? ""} ${run.data.leaves_alone ?? ""}`
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
