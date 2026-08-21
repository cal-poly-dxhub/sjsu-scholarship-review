import { TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Separator } from "@/sjsu/components/ui/separator";
import type { ScoreState } from "./score-state";

/**
 * The parts of an application that both the reading screen and the hand-scoring screen show.
 *
 * They are shared so the same fact is worded the same way on either screen — the reason a score is
 * out of date most of all, since that one line is what stops an old number being read as a current
 * one.
 */

export interface QAPair {
  question_id: string;
  question: string;
  answer: string;
}

interface Facts {
  academic_program: string | null;
  academic_level: string | null;
  major: string | null;
  gpa: string | number | null;
}

/** Who the applicant is, in the four facts every screen leads with. */
export function ApplicantFacts({ application }: { application: Facts }) {
  return (
    <Card size="sm">
      <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Program" value={application.academic_program} />
        <Field label="Level" value={application.academic_level} />
        <Field label="Major" value={application.major} />
        <Field label="GPA" value={application.gpa} />
      </CardContent>
    </Card>
  );
}

/** The applicant's answers, in full. */
export function Answers({ pairs }: { pairs: QAPair[] | null }) {
  return (
    <div className="space-y-3">
      <Separator />
      <h2 className="text-lg font-semibold">Answers</h2>
      {pairs && pairs.length > 0 ? (
        pairs.map((pair) => (
          <Card key={pair.question_id} size="sm">
            <CardContent>
              <p className="text-xs text-muted-foreground">{pair.question}</p>
              {/* An answer is an essay. Left to fill a wide monitor a line runs past 200
                  characters and the eye loses its place coming back. */}
              <p className="mt-2 reading text-sm whitespace-pre-wrap">{pair.answer}</p>
            </CardContent>
          </Card>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          There are no answers saved for this application, so there is nothing to read.
        </p>
      )}
    </div>
  );
}

/** Why the scores shown are not this application's current score. Nothing when they are. */
export function PreviousScoreNotice({ state }: { state: ScoreState }) {
  if (state === "scored") return null;

  const reason =
    state === "needs_rescore"
      ? "The answers changed after these scores were made, so they were scored from text this"
        + " application no longer holds. They stay here to be read; a run from the dashboard"
        + " replaces them."
      : state === "running"
        ? "This application is being scored right now. These are the scores it had before, and"
          + " they are replaced when the run finishes with it."
        : state === "failed"
          ? "The last try failed. These are the scores from before it."
          : "These are not this application's current scores.";

  return (
    <Card size="sm" className="border-warning">
      <CardContent className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="reading text-sm">{reason}</p>
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
