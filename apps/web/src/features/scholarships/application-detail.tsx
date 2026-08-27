import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/sjsu/components/ui/table";
import { NO_REVIEWER_SCORES } from "@/sjsu/components/not-built";
import { useScholarshipName } from "@/features/cohorts/cohort-picker";
import { Answers, ApplicantFacts, PreviousScoreNotice, type QAPair } from "./application-parts";
import { applicationExport, download } from "./export";
import { scoreState } from "./score-state";

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

/**
 * A stored score, as the exporter needs it. `model_id` and `worker` are not on screen — they say
 * nothing to a reviewer — but the export carries them, so they are read here.
 */
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

/** One reviewer's uploaded scores. The scores are raw, out of each criterion's own maximum. */
interface ReviewerScore {
  reviewer_name: string;
  category_scores: Record<string, number>;
  /** Absent when their scores do not add up to a total comparable with the model's. */
  total_score?: number;
  rubric_version?: string;
}

interface DetailResponse {
  application: Application;
  score: ScoreItem | null;
  reviewer_scores: ReviewerScore[];
}

interface VersionsResponse {
  versions: { version: string; criteria: Criterion[] }[];
}

export function ApplicationDetail({
  scholarship,
  year,
  studentUuid,
  onBack,
  onScore,
}: {
  scholarship: string;
  year: string;
  studentUuid: string;
  onBack: () => void;
  /** Open this application on the hand-scoring screen. Left out where there is nowhere to go. */
  onScore?: () => void;
}) {
  const named = useScholarshipName(scholarship);

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
  const reviewers = data?.reviewer_scores ?? [];
  // A score item is still readable after the answers change or while a rescore runs. Which of
  // those it is decides whether this screen presents it as the score or as the previous one.
  const state = application ? scoreState(application) : "unscored";
  // The criteria of the version this score was made under, in the rubric's own order. A
  // criterion the score does not carry is shown as missing rather than as a zero.
  const criteria =
    versionsQuery.data?.versions.find((v) => v.version === score?.rubric_version)?.criteria ?? [];

  return (
    <div className="space-y-5">
      {/* An applicant ID is one long unbroken word, so on a narrow window it has to be allowed to
          break and the buttons have to be allowed to drop to a second line. */}
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to the cohort">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-xl font-semibold break-all">{studentUuid}</h1>
          <p className="text-sm text-muted-foreground">
            {named} · {year}
          </p>
        </div>
        <Badge variant="outline">Not reviewed</Badge>
        {onScore && (
          <Button variant="outline" size="sm" onClick={onScore}>
            Score by hand
          </Button>
        )}
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

      {isLoading && <p className="text-sm text-muted-foreground">Loading the application…</p>}
      {isError && (
        <p className="text-sm text-muted-foreground">
          We could not load this application. Try again, and check the applicant, scholarship, and
          year are the ones you want.
        </p>
      )}

      {application && (
        <>
          <ApplicantFacts application={application} />

          {score === null ? (
            <NoScore application={application} />
          ) : (
            <div className="space-y-4">
              <PreviousScoreNotice state={state} />
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">
                  {state === "scored" ? "Scores by criterion" : "The previous scores by criterion"}
                </h2>
                <Badge variant="secondary">Total {score.total_score}</Badge>
                <Badge variant="outline">Rubric {score.rubric_version}</Badge>
                <Badge variant="outline">Not reviewed</Badge>
              </div>
              <p className="reading text-sm text-muted-foreground">
                Every score in these cards is the model's.{" "}
                {reviewers.length === 0 ? NO_REVIEWER_SCORES : ""} Nobody has signed this
                application off either.
              </p>

              {reviewers.length > 0 && (
                <ReviewerScores
                  reviewers={reviewers}
                  criteria={criteria}
                  modelScores={score.category_scores}
                  modelTotal={score.total_score}
                />
              )}

              <Card size="sm">
                <CardContent>
                  <p className="text-xs text-muted-foreground">Summary</p>
                  <p className="mt-1 reading text-sm">{score.reasoning_summary}</p>
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

          <Answers pairs={application.qa_pairs} />
        </>
      )}
    </div>
  );
}

/**
 * Each reviewer's uploaded scores beside the model's, criterion by criterion.
 *
 * A reviewer's total is worked out from their own scores under the same rubric version the model
 * used, so the two totals are comparable. Where it is missing — a criterion they skipped, a score
 * outside its maximum — the total says so rather than showing a part of one as the whole.
 */
function ReviewerScores({
  reviewers,
  criteria,
  modelScores,
  modelTotal,
}: {
  reviewers: ReviewerScore[];
  criteria: Criterion[];
  modelScores: Record<string, ScoredCriterion>;
  modelTotal: number;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">
            {reviewers.length === 1 ? "A reviewer's scores" : "The reviewers' scores"}
          </h3>
          <Badge variant="outline">Uploaded, not scored here</Badge>
        </div>
        <Table containerClassName="w-fit" className="w-auto min-w-0">
          <TableHeader>
            <TableRow>
              <TableHead>Criterion</TableHead>
              <TableHead className="text-right">Model</TableHead>
              {reviewers.map((reviewer) => (
                <TableHead key={reviewer.reviewer_name} className="text-right">
                  {reviewer.reviewer_name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {criteria.map((criterion) => (
              <TableRow key={criterion.id}>
                <TableCell className="whitespace-normal">{criterion.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* Out of the criterion's own maximum on both sides, so the two are read
                      against the same number. */}
                  {modelScores[criterion.id]?.score ?? "—"} / {criterion.max}
                </TableCell>
                {reviewers.map((reviewer) => (
                  <TableCell
                    key={reviewer.reviewer_name}
                    className="text-right tabular-nums"
                  >
                    {reviewer.category_scores[criterion.id] ?? "—"} / {criterion.max}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Total out of 100</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{modelTotal}</TableCell>
              {reviewers.map((reviewer) => (
                <TableCell
                  key={reviewer.reviewer_name}
                  className="text-right font-medium tabular-nums"
                >
                  {reviewer.total_score ?? "Not comparable"}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Apart from the model</TableCell>
              <TableCell />
              {reviewers.map((reviewer) => (
                <TableCell key={reviewer.reviewer_name} className="text-right tabular-nums">
                  {reviewer.total_score === undefined
                    ? "—"
                    : round(Math.abs(modelTotal - reviewer.total_score))}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Two decimal places at most, and no trailing zeros on a whole number. */
function round(value: number): string {
  return String(Math.round(value * 100) / 100);
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
            {scored ? `${scored.score} out of ${scored.max}` : "Not scored"}
          </Badge>
          <Badge variant="outline">Weight {criterion.weight}</Badge>
        </div>
        {scored ? (
          <>
            <p className="reading text-sm">{scored.reasoning}</p>
            {scored.evidence && (
              <blockquote className="reading border-l-2 border-border pl-3 text-sm text-muted-foreground">
                {scored.evidence}
              </blockquote>
            )}
          </>
        ) : (
          <p className="reading text-sm text-muted-foreground">
            The score does not cover this criterion, so there is nothing to read.
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
            {application.status === "score_failed"
              ? "Could not be scored"
              : running
                ? "Being scored"
                : "Not scored yet"}
          </Badge>
        </div>
        {application.status === "score_failed" ? (
          <p className="text-sm text-muted-foreground">
            {/* The stored reason is an error message from the scoring code, so it stays out. */}
            Scoring this application failed. Start a run from the dashboard to try it again.
          </p>
        ) : running ? (
          <p className="text-sm text-muted-foreground">
            This application is being scored right now. Its scores show up when the run finishes
            with it.
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
