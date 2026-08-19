import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Separator } from "@/sjsu/components/ui/separator";
import { applicationExport, download } from "./export";

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
  model_id: string;
  worker: string;
}

interface Criterion {
  id: string;
  name: string;
  max: number;
  weight: number;
}

interface DetailResponse {
  application: Application;
  score: ScoreItem | null;
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

          {score === null ? (
            <NoScore application={application} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Scores by criterion</h2>
                <Badge variant="secondary">total {score.total_score}</Badge>
                <Badge variant="outline">rubric {score.rubric_version}</Badge>
                <Badge variant="outline">unreviewed</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Scored by {score.model_id} on the {score.worker} path. Nobody has signed this
                off — reviewer sign-off is not built.
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
