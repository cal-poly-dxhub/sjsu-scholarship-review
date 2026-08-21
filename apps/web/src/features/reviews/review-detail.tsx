import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { Separator } from "@/sjsu/components/ui/separator";
import { NotBuilt } from "@/sjsu/components/not-built";
import {
  Answers,
  ApplicantFacts,
  PreviousScoreNotice,
  type QAPair,
} from "@/features/scholarships/application-parts";
import { useScholarshipName } from "@/features/cohorts/cohort-picker";
import { download } from "@/features/scholarships/export";
import { scoreState } from "@/features/scholarships/score-state";
import { readEntries, reviewerScoreFile, type Entry, type HandCriterion } from "./hand-score";

/**
 * Scoring one application by hand: the answers, what the model made of them, and a box per
 * criterion for the reviewer's own score.
 *
 * Nothing typed here can be saved — there is nowhere to write a reviewer's score — so the screen
 * says that before the first box, never offers to submit, and lets the reviewer download what they
 * entered instead. The criteria, their names, and their maxima come from the published rubric and
 * nowhere else, so a score can never be entered against a bound the rubric does not set.
 */

interface Application {
  student_uuid: string;
  status: string;
  academic_program: string | null;
  academic_level: string | null;
  major: string | null;
  gpa: string | number | null;
  total_score: number | null;
  rubric_version: string | null;
  claimed_until: string | null;
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
}

interface DetailResponse {
  application: Application;
  score: ScoreItem | null;
}

interface VersionsResponse {
  versions: { version: string; criteria: HandCriterion[] }[];
}

export function ReviewDetail({
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
  const [typed, setTyped] = useState<Record<string, string>>({});
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
  const state = application ? scoreState(application) : "unscored";
  const versions = versionsQuery.data?.versions ?? [];
  // A scored application is read against the version that scored it, so the maxima match the
  // numbers beside them. An unscored one is read against the newest published version, which is
  // what a run would use. The list comes back newest first.
  const version = score ? versions.find((v) => v.version === score.rubric_version) : versions[0];
  const criteria = version?.criteria ?? [];
  const reading = readEntries(criteria, typed);

  const noCriteria = score
    ? `The rubric version these scores were made under (${score.rubric_version}) is no longer`
      + " published, so its criteria cannot be listed."
    : "No rubric has been published for this scholarship, so there are no criteria to score"
      + " against.";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to the cohort">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Score by hand</h1>
          <p className="text-sm text-muted-foreground">
            {/* An applicant ID is one long unbroken word — it breaks rather than pushing the line
                past a narrow window. */}
            {named} · {year} · <span className="font-mono break-all">{studentUuid}</span>
          </p>
        </div>
      </div>

      <NotBuilt instead="Download them when you are done, so your reading is not lost.">
        Scores you type here cannot be saved yet, and no earlier reviewer score is saved for this
        application either, so there is nothing to compare yours with.
      </NotBuilt>

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
          <Answers pairs={application.qa_pairs} />

          <Separator />

          {score && <PreviousScoreNotice state={state} />}

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Scores by criterion</h2>
              {version && <Badge variant="outline">Rubric {version.version}</Badge>}
              {/* The reviewer is putting their own total against this one, so it belongs here and
                  not only on the application screen. */}
              {score && (
                <Badge variant="secondary">
                  {state === "scored" ? "Model's total" : "Model's previous total"}{" "}
                  {score.total_score} out of 100
                </Badge>
              )}
            </div>
            <p className="reading text-sm text-muted-foreground">
              {score
                ? "Each criterion carries the model's score and the reason it gave."
                : "Nothing has scored this application, so these criteria come from the newest"
                  + " published rubric."}{" "}
              Your own score cannot go above a criterion's maximum.
            </p>
          </div>

          {versionsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading the rubric…</p>
          ) : criteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">{noCriteria}</p>
          ) : (
            <div className="space-y-4">
              {reading.entries.map(({ criterion, entry }) => (
                <CriterionScoring
                  key={criterion.id}
                  criterion={criterion}
                  scored={score?.category_scores[criterion.id]}
                  unscored={score === null}
                  previous={score !== null && state !== "scored"}
                  entry={entry}
                  typed={typed[criterion.id] ?? ""}
                  onTyped={(value) =>
                    setTyped((current) => ({ ...current, [criterion.id]: value }))
                  }
                />
              ))}
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={reading.scored === 0}
              onClick={() =>
                download(
                  `${scholarship}-${year}-${studentUuid}-my-scores.json`,
                  reviewerScoreFile({
                    scholarship,
                    year,
                    studentUuid,
                    rubricVersion: version?.version ?? null,
                    criteria,
                    typed,
                  }),
                )
              }
            >
              Download my scores
            </Button>
            {/* Submitting has nowhere to go, and never will on this screen. The button is here
                disabled rather than absent so nobody hunts for it, and the reason is beside it
                rather than only in a tooltip nobody hovers. */}
            <Button size="sm" disabled>
              Submit scores
            </Button>
            <span className="text-xs text-muted-foreground">
              Submitting is off until scores can be saved.
            </span>
            <span className="text-xs text-muted-foreground">
              {reading.scored} of {criteria.length} criteria scored
              {reading.total !== null && ` · your total is ${reading.total} out of 100`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function CriterionScoring({
  criterion,
  scored,
  unscored,
  previous,
  entry,
  typed,
  onTyped,
}: {
  criterion: HandCriterion;
  /** The model's score for this criterion, where it made one. */
  scored: ScoredCriterion | undefined;
  /** Nothing has scored the application at all. */
  unscored: boolean;
  /** The model's score is no longer this application's current one. */
  previous: boolean;
  entry: Entry;
  typed: string;
  onTyped: (value: string) => void;
}) {
  const box = `score-${criterion.id}`;

  return (
    <Card size="sm">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{criterion.name}</span>
          <Badge variant="outline">Out of {criterion.max}</Badge>
          <Badge variant="outline">Weight {criterion.weight}</Badge>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {previous ? "The model's previous score" : "The model's score"}
          </p>
          {scored ? (
            <>
              <p className="text-sm font-medium">
                {scored.score} out of {scored.max}
              </p>
              <p className="reading text-sm">{scored.reasoning}</p>
              {scored.evidence && (
                <blockquote className="reading border-l-2 border-border pl-3 text-sm text-muted-foreground">
                  {scored.evidence}
                </blockquote>
              )}
            </>
          ) : (
            <p className="reading text-sm text-muted-foreground">
              {unscored
                ? "This application has not been scored, so there is nothing to read here."
                : "The model's score does not cover this criterion."}
            </p>
          )}
        </div>

        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor={box} className="text-xs text-muted-foreground">
              Your score
            </Label>
            <Input
              id={box}
              className="mt-1 w-24"
              type="number"
              min={0}
              max={criterion.max}
              value={typed}
              aria-invalid={entry.kind === "refused"}
              onChange={(event) => onTyped(event.target.value)}
            />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">out of {criterion.max}</p>
        </div>
        {entry.kind === "refused" && <p className="text-xs text-warning">{entry.reason}</p>}
      </CardContent>
    </Card>
  );
}
