import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/api";
import { ArrowLeft } from "lucide-react";

interface CriterionScore {
  criterion: string;
  score: number;
  reasoning?: string;
  evidence?: Array<{ question_id: string; quote: string }>;
}

interface QAPair {
  question: string;
  answer: string;
  question_id: string;
}

interface ApplicationDetailData {
  application_key: string;
  gpa: string | null;
  major: string | null;
  academic_level: string | null;
  academic_program: string | null;
  year: string | null;
  availability_id: string | null;
  qa_pairs: QAPair[];
  human_criterion_scores: CriterionScore[];
  human_weighted_total: number;
  criterion_scores: CriterionScore[];
  llm_weighted_score: number;
  variance_pct: number;
  needs_human_review: boolean;
  review_criterion_scores: CriterionScore[] | null;
  review_weighted_score: number | null;
}

const CRITERIA = [
  { criterion: "Extracurricular Activities", max: 1 },
  { criterion: "Career Goals Essay", max: 4 },
  { criterion: "Challenge Essay", max: 4 },
  { criterion: "Initiative & Self-Motivation", max: 3 },
  { criterion: "Creativity", max: 3 },
];

export function ReviewDetail({
  applicationKey,
  onBack,
}: {
  applicationKey: string;
  onBack: () => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["application-detail", applicationKey],
    queryFn: () => api<ApplicationDetailData>(`/applications/${applicationKey}`),
  });

  const submitMutation = useMutation({
    mutationFn: (criterionScores: Array<{ criterion: string; score: number }>) =>
      api(`/reviews/${applicationKey}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criterion_scores: criterionScores }),
      }),
    onSuccess: () => setSubmitted(true),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading application...</p>;
  }

  if (!data) {
    return <p className="text-sm text-red-600">Application not found.</p>;
  }

  const humanScores: Record<string, number> = {};
  for (const cs of data.human_criterion_scores) {
    humanScores[cs.criterion] = cs.score;
  }

  const llmScores: Record<string, number> = {};
  const llmReasonings: Record<string, string> = {};
  for (const cs of data.criterion_scores) {
    llmScores[cs.criterion] = cs.score;
    llmReasonings[cs.criterion] = cs.reasoning ?? "";
  }

  const allScored = CRITERIA.every((c) => scores[c.criterion] !== undefined);

  const handleSubmit = () => {
    const criterionScores = CRITERIA.map((c) => ({
      criterion: c.criterion,
      score: scores[c.criterion] ?? 0,
    }));
    submitMutation.mutate(criterionScores);
  };

  if (submitted) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="text-4xl mb-4">&#10003;</div>
          <h2 className="text-xl font-semibold">Review Complete</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Scores have been submitted and the review flag has been cleared.
          </p>
          <button
            onClick={onBack}
            className="mt-6 px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Back to Review Queue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tiebreaker Review</h1>
          <p className="text-sm text-muted-foreground font-mono">
            {data.application_key}
          </p>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 rounded-lg border border-border">
          <p className="text-xs text-muted-foreground">GPA</p>
          <p className="text-lg font-semibold">{data.gpa ?? "—"}</p>
        </div>
        <div className="p-3 rounded-lg border border-border">
          <p className="text-xs text-muted-foreground">Major</p>
          <p className="text-lg font-semibold truncate">{data.major ?? "—"}</p>
        </div>
        <div className="p-3 rounded-lg border border-border">
          <p className="text-xs text-muted-foreground">Human Score</p>
          <p className="text-lg font-semibold">{data.human_weighted_total}</p>
        </div>
        <div className="p-3 rounded-lg border border-border">
          <p className="text-xs text-muted-foreground">AI Score</p>
          <p className="text-lg font-semibold">{data.llm_weighted_score}</p>
        </div>
      </div>

      {/* Variance banner */}
      <div className="p-4 rounded-lg border border-red-200 bg-red-50">
        <p className="text-sm font-medium text-red-800">
          Variance: {data.variance_pct}% — This application requires human tiebreaker scoring.
        </p>
      </div>

      {/* Essays */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Application Essays</h2>
        <div className="space-y-4">
          {data.qa_pairs.map((qa, i) => (
            <div key={i} className="p-4 rounded-lg border border-border">
              <p className="text-sm font-medium text-muted-foreground mb-2">
                {qa.question}
              </p>
              <p className="text-sm whitespace-pre-wrap">{qa.answer}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Scoring Interface */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Score This Application</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Review the human and AI scores below, then enter your tiebreaker score for each criterion.
        </p>

        <div className="space-y-4">
          {CRITERIA.map((c) => (
            <div key={c.criterion} className="p-4 rounded-lg border border-border space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{c.criterion}</h3>
                <span className="text-xs text-muted-foreground">Max: {c.max}</span>
              </div>

              {/* Existing scores */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Human: </span>
                  <span className="font-medium">{humanScores[c.criterion] ?? "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">AI: </span>
                  <span className="font-medium">{llmScores[c.criterion] ?? "—"}</span>
                </div>
              </div>

              {/* AI Reasoning */}
              {llmReasonings[c.criterion] && (
                <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                  <span className="font-medium">AI Reasoning: </span>
                  {llmReasonings[c.criterion]}
                </div>
              )}

              {/* Reviewer input */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium whitespace-nowrap">Your Score:</label>
                <input
                  type="number"
                  min={0}
                  max={c.max}
                  step={1}
                  value={scores[c.criterion] ?? ""}
                  onChange={(e) =>
                    setScores((prev) => ({
                      ...prev,
                      [c.criterion]: parseFloat(e.target.value),
                    }))
                  }
                  className="w-20 px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="0"
                />
                <span className="text-xs text-muted-foreground">/ {c.max}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Submit */}
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={handleSubmit}
            disabled={!allScored || submitMutation.isPending}
            className="px-6 py-2.5 rounded-md bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Review"}
          </button>
          {!allScored && (
            <p className="text-xs text-muted-foreground">
              Score all {CRITERIA.length} criteria to submit.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
