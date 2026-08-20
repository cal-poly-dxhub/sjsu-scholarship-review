/**
 * Scoring reliability: human reviewers against each other, the model against them, and the
 * per-criterion and per-scholarship breakdowns.
 *
 * Nothing is drawn, for two reasons that are both still true. No human scores are stored, so
 * there is nothing to compare the model against. And the two reads this was written for —
 * `/dashboard/stats` and `/analytics` — do not exist in the API; they came with the design system
 * and were never built. The shapes and the two cards below are what a working section would use.
 */

/** What `/dashboard/stats` would answer with. No handler serves this yet. */
interface DashboardStats {
  total_applications: number;
  both_scored: number;
  flagged_for_review: number;
  avg_variance_pct: number;
  agreement_rate_pct: number;
  variance_distribution: {
    "0_5": number;
    "5_10": number;
    "10_20": number;
    "20_plus": number;
  };
}

/** What `/analytics` would answer with. No handler serves this yet. */
interface AnalyticsData {
  ai_human: {
    total_applications: string;
    total_comparisons: string;
    avg_difference: string;
    exact_match_rate: string;
    within_one_point_rate: string;
  };
  human_vs_human: {
    total_reviews: string;
    avg_difference: string;
    exact_match_rate: string;
    within_one_point_rate: string;
    moderate_difference_rate: string;
    significant_difference_rate: string;
  };
  reviewer_distribution: Array<{ level: string; count: string; percentage: string }>;
  scholarship_stats: Array<{
    scholarship: string;
    avg_difference: string;
    exact_match_rate: string;
    within_one_point_rate: string;
    significant_difference_rate: string;
  }>;
  criterion_stats: Array<{
    criterion: string;
    avg_difference: string;
    exact_match_rate: string;
    within_one_point_rate: string;
  }>;
}

export type { AnalyticsData, DashboardStats };

export function ReliabilitySection() {
  return (
    <div className="p-5 rounded-lg border border-border">
      <h2 className="text-lg font-semibold">Scoring reliability</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Nothing to show, and not because a number came back empty. No reader scores are stored, so
        there is nothing to compare the model against — no agreement rate, no variance, no chart.
        The two reads this section was drawn for are not built either.
      </p>
    </div>
  );
}

/** One side of the human-against-model comparison. Waiting on the reads above. */
export function ComparisonCard({
  title,
  subtitle,
  avgDiff,
  exactMatch,
  withinOne,
  color,
}: {
  title: string;
  subtitle: string;
  avgDiff: number;
  exactMatch: string;
  withinOne: string;
  color: string;
}) {
  return (
    <div className="p-5 rounded-lg border border-border">
      <p className="text-sm font-semibold" style={{ color }}>{title}</p>
      <p className="text-xs text-muted-foreground mb-3">{subtitle}</p>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-xs text-muted-foreground">Avg Difference</span>
          <span className="text-sm font-bold">{avgDiff.toFixed(2)} pts</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-muted-foreground">Exact Match</span>
          <span className="text-sm font-medium">{parseFloat(exactMatch).toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-muted-foreground">Within 1 Point</span>
          <span className="text-sm font-medium">{parseFloat(withinOne).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

/** One bar of a distribution. Shows a count when it has one, a percentage otherwise. */
export function DistBar({
  label,
  pct,
  color,
  count,
}: {
  label: string;
  pct: number;
  color: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm w-28 text-right font-medium">{label}</span>
      <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
        <div
          className={`h-full ${color} rounded transition-all`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-sm w-20 text-muted-foreground text-right">
        {count !== undefined ? `${count.toLocaleString()}` : `${Math.round(pct)}%`}
      </span>
    </div>
  );
}
