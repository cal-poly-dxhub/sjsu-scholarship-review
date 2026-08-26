import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Separator } from "@/sjsu/components/ui/separator";
import { modelLabel } from "@/lib/models";
import { applicationExport, download } from "./export";
import { scoreState, type ScoreState } from "./score-state";
import { UNKNOWN_MODEL, setWords } from "./sets";

interface QAPair {
  question_id: string;
  question: string;
  answer: string;
}

interface Application {
  student_uuid: string;
  status: string;
  academic_program: string | null;
  academic_level: string | null;
  major: string | null;
  gpa: string | number | null;
  total_score: number | null;
  rubric_version: string | null;
  model_id: string | null;
  latest_scored_at: string | null;
  category_scores: Record<string, { score: number; max: number }> | null;
  claimed_until: string | null;
  attempt: number | null;
  failure: string | null;
  last_error: string | null;
  qa_pairs: QAPair[] | null;
}

/** A score item's per-criterion entry. The reasoning and the quote live only here. */
interface ScoredCriterion {
  score: number;
  max: number;
  reasoning: string;
  evidence: string;
}

interface ScoreItem {
  category_scores: Record<string, ScoredCriterion>;
  total_score: number;
  reasoning_summary: string;
  rubric_version: string;
  // Null on a score written before the model was recorded. That is not the default having run.
  model_id: string | null;
  worker: string;
}

interface Criterion {
  id: string;
  name: string;
  max: number;
  weight: number;
}

/** One set this application has been scored in: its newest attempt there. Newest set first. */
interface ScoredSet {
  rubric_version: string;
  model_id: string;
  total_score: number;
  scored_at: string;
}

interface DetailResponse {
  application: Application;
  score: ScoreItem | null;
  sets: ScoredSet[];
}

interface VersionsResponse {
  versions: { version: string; criteria: Criterion[] }[];
}

export function ApplicationDetail({
  scholarship,
  year,
  studentUuid,
  onBack,
}: {
  scholarship: string;
  year: string;
  studentUuid: string;
  onBack: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["application", scholarship, year, studentUuid],
    queryFn: () =>
      api<DetailResponse>(
        `/application?scholarship=${encodeURIComponent(scholarship)}` +
          `&year=${encodeURIComponent(year)}&student=${encodeURIComponent(studentUuid)}`,
      ),
  });

  const versionsQuery = useQuery({
    queryKey: ["rubric-versions", scholarship],
    queryFn: () =>
      api<VersionsResponse>(`/rubric-versions?scholarship=${encodeURIComponent(scholarship)}`),
  });

  const application = data?.application;
  const score = data?.score ?? null;
  const sets = data?.sets ?? [];
  // A score item is still readable after the answers change or while a rescore runs. Which of
  // those it is decides whether this screen presents it as the score or as the previous one.
  const state = application ? scoreState(application) : "unscored";
  // The criteria of the version this score was made under, in the rubric's own order. A
  // criterion the score does not carry is shown as missing rather than as a zero.
  const criteria =
    versionsQuery.data?.versions.find((v) => v.version === score?.rubric_version)?.criteria ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to the cohort">
          <ArrowLeft />
        </Button>
        <div className="flex-1">
          <h1 className="font-mono text-xl font-semibold">{studentUuid}</h1>
          <p className="text-sm text-muted-foreground">
            {scholarship} · {year}
          </p>
        </div>
        <Badge variant="outline">unreviewed</Badge>
        {application && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              download(
                `${scholarship}-${year}-${studentUuid}.json`,
                // The reasoning is already on screen, so this export always carries it.
                applicationExport({ scholarship, year, criteria, application, score }),
              )
            }
          >
            Export JSON
          </Button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Reading the application…</p>}
      {isError && (
        <p className="text-sm text-muted-foreground">
          The read failed. Try again, and check the scholarship, year, and applicant id.
        </p>
      )}

      {application && (
        <>
          <Card size="sm">
            <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Program" value={application.academic_program} />
              <Field label="Level" value={application.academic_level} />
              <Field label="Major" value={application.major} />
              <Field label="GPA" value={application.gpa} />
            </CardContent>
          </Card>

          {sets.length > 0 && (
            <SetsCard
              sets={sets}
              shown={score ? { version: score.rubric_version, model: score.model_id } : null}
            />
          )}

          {score === null ? (
            <NoScore application={application} />
          ) : (
            <div className="space-y-4">
              <PreviousScoreNotice state={state} />
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">
                  {state === "scored" ? "Scores by criterion" : "The previous scores by criterion"}
                </h2>
                <Badge variant="secondary">total {score.total_score}</Badge>
                <Badge variant="outline">rubric {score.rubric_version}</Badge>
                {modelLabel(score.model_id) && (
                  <Badge variant="outline">{modelLabel(score.model_id)}</Badge>
                )}
                <Badge variant="outline">unreviewed</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Scored by {score.model_id ?? "a model this score does not name"} on the{" "}
                {score.worker} path. Nobody has signed this off — reviewer sign-off is not built.
              </p>

              <Card size="sm">
                <CardContent>
                  <p className="text-xs text-muted-foreground">Summary</p>
                  <p className="mt-1 text-sm">{score.reasoning_summary}</p>
                </CardContent>
              </Card>

              {criteria.map((criterion) => (
                <CriterionCard
                  key={criterion.id}
                  criterion={criterion}
                  scored={score.category_scores[criterion.id]}
                />
              ))}
            </div>
          )}

          {application.qa_pairs && application.qa_pairs.length > 0 && (
            <div className="space-y-3">
              <Separator />
              <h2 className="text-lg font-semibold">Answers</h2>
              {application.qa_pairs.map((pair) => (
                <Card key={pair.question_id} size="sm">
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{pair.question}</p>
                    <p className="mt-2 text-sm whitespace-pre-wrap">{pair.answer}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Every total this application holds, one line per set. Two models at the same rubric version are
 * two numbers for the same applicant, and the only place both can be read is here.
 *
 * `shown` is the set the scores below came from — the newest attempt of all of them.
 */
function SetsCard({
  sets,
  shown,
}: {
  sets: ScoredSet[];
  shown: { version: string; model: string | null } | null;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Totals for this application</h2>
          {sets.length > 1 && <Badge variant="warning">{sets.length} sets</Badge>}
        </div>
        {sets.length > 1 && (
          <p className="text-sm text-muted-foreground">
            One line per rubric version and model. Two of these numbers are not a better and a
            worse score — they are two readings, and only one of them is below.
          </p>
        )}
        <div className="space-y-1">
          {sets.map((set) => {
            const here =
              shown !== null &&
              set.rubric_version === shown.version &&
              set.model_id === (shown.model ?? UNKNOWN_MODEL);
            return (
              <div
                key={`${set.rubric_version}#${set.model_id}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Badge variant={here ? "secondary" : "outline"}>total {set.total_score}</Badge>
                <span>{setWords(set.rubric_version, set.model_id)}</span>
                <span className="text-muted-foreground">{set.scored_at}</span>
                {here && <Badge variant="outline">shown below</Badge>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function CriterionCard({
  criterion,
  scored,
}: {
  criterion: Criterion;
  scored: ScoredCriterion | undefined;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{criterion.name}</span>
          <Badge variant="secondary">
            {scored ? `${scored.score} / ${scored.max}` : "not scored"}
          </Badge>
          <Badge variant="outline">weight {criterion.weight}</Badge>
        </div>
        {scored ? (
          <>
            <p className="text-sm">{scored.reasoning}</p>
            {scored.evidence && (
              <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
                {scored.evidence}
              </blockquote>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This criterion is not on the score item, so there is nothing to read.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Why the scores below are not this application's current score. Nothing when they are. */
function PreviousScoreNotice({ state }: { state: ScoreState }) {
  if (state === "scored") return null;

  const reason =
    state === "needs_rescore"
      ? "The answers changed after these scores were made, so they were scored from text this"
        + " application no longer holds. They stay here to be read; a run from the dashboard"
        + " replaces them."
      : state === "running"
        ? "A run holds this application right now. These are the scores it had before, and they"
          + " are replaced when the run writes its own."
        : state === "failed"
          ? "The last attempt failed. These are the scores from before it."
          : "These are not this application's current scores.";

  return (
    <Card size="sm" className="border-warning">
      <CardContent className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-sm">{reason}</p>
      </CardContent>
    </Card>
  );
}

/** Why there are no scores to read: unscored, running, or a failed attempt. */
function NoScore({ application }: { application: Application }) {
  const running =
    application.status === "processing" &&
    (application.claimed_until ?? "") > new Date().toISOString();

  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">No scores yet</h2>
          <Badge variant={application.status === "score_failed" ? "warning" : "outline"}>
            {application.status === "score_failed" ? "failed" : running ? "running" : "unscored"}
          </Badge>
        </div>
        {application.status === "score_failed" ? (
          <p className="text-sm text-muted-foreground">
            {application.failure ?? "The attempt failed."}
            {application.last_error ? ` — ${application.last_error}` : ""} Start a run from the
            dashboard to try it again.
          </p>
        ) : running ? (
          <p className="text-sm text-muted-foreground">
            A run holds this application right now. Its scores appear when the run writes them.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing has scored this application. Start a run for its scholarship and year from the
            dashboard.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value ?? "—"}</p>
    </div>
  );
}
