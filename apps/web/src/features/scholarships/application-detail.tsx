import { useQuery } from "@tanstack/react-query";
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

export function ApplicationDetail({
  applicationKey,
  onBack,
}: {
  applicationKey: string;
  onBack: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["application-detail", applicationKey],
    queryFn: () => api<ApplicationDetailData>(`/applications/${applicationKey}`),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading application...</p>;
  }

  if (!data) {
    return <p className="text-sm text-red-600">Application not found.</p>;
  }

  // Build a lookup for human scores by criterion
  const humanScores: Record<string, number> = {};
  for (const cs of data.human_criterion_scores) {
    humanScores[cs.criterion] = cs.score;
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
          <h1 className="text-xl font-semibold tracking-tight font-mono">
            {data.application_key}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.availability_id} &middot; {data.year}
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
          <p className="text-xs text-muted-foreground">Academic Level</p>
          <p className="text-lg font-semibold">{data.academic_level ?? "—"}</p>
        </div>
        <div className="p-3 rounded-lg border border-border">
          <p className="text-xs text-muted-foreground">Variance</p>
          <p className={`text-lg font-semibold ${data.variance_pct > 20 ? "text-red-600" : ""}`}>
            {data.variance_pct}%
          </p>
        </div>
      </div>

      {/* Score Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-border text-center">
          <p className="text-xs text-muted-foreground mb-1">Human Score</p>
          <p className="text-2xl font-bold">{data.human_weighted_total}</p>
        </div>
        <div className="p-4 rounded-lg border border-border text-center">
          <p className="text-xs text-muted-foreground mb-1">AI Score</p>
          <p className="text-2xl font-bold">{data.llm_weighted_score}</p>
        </div>
        {data.review_weighted_score != null && (
          <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 text-center">
            <p className="text-xs text-blue-600 mb-1">Review Score (Final)</p>
            <p className="text-2xl font-bold text-blue-700">{data.review_weighted_score}</p>
          </div>
        )}
      </div>

      {/* Criterion Scores Comparison */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Criteria Breakdown</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-2.5 font-medium">Criterion</th>
                <th className="text-right px-4 py-2.5 font-medium">Human</th>
                <th className="text-right px-4 py-2.5 font-medium">AI</th>
                <th className="text-left px-4 py-2.5 font-medium">AI Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {data.criterion_scores.map((cs) => (
                <tr key={cs.criterion} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium">{cs.criterion}</td>
                  <td className="px-4 py-2.5 text-right">
                    {humanScores[cs.criterion] ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">{cs.score}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs max-w-md">
                    {cs.reasoning ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
