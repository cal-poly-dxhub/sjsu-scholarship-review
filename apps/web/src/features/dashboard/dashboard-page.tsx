import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";

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

export function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>("/dashboard/stats"),
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => api<AnalyticsData>("/analytics"),
  });

  if (statsLoading || analyticsLoading) {
    return <p className="text-sm text-muted-foreground">Loading dashboard...</p>;
  }

  const aiAvgDiff = parseFloat(analytics?.ai_human.avg_difference ?? "0");
  const humanAvgDiff = parseFloat(analytics?.human_vs_human.avg_difference ?? "0");
  const improvementPct = humanAvgDiff > 0 ? Math.round((1 - aiAvgDiff / humanAvgDiff) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--sjsu-blue)' }}>
          Scholarship Review Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          San Jos&eacute; State University &mdash; AI-assisted scoring reliability analysis
        </p>
      </div>

      {/* Row 1: Key Insight Banner */}
      <div className="p-5 rounded-lg border-2" style={{ borderColor: 'var(--sjsu-gold)', backgroundColor: 'rgba(229, 168, 35, 0.05)' }}>
        <p className="text-base font-medium" style={{ color: 'var(--sjsu-blue)' }}>
          Human reviewers disagree with each other by an average of <strong>{humanAvgDiff}</strong> points per criterion.
          The AI disagrees with humans by <strong>{aiAvgDiff}</strong> points &mdash;{" "}
          <span style={{ color: 'var(--sjsu-gold)' }}>{improvementPct}% more consistent</span> than human-to-human scoring.
        </p>
      </div>

      {/* Row 2: Side-by-Side Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ComparisonCard
          title="Human vs Human"
          subtitle="Inter-rater reliability"
          avgDiff={humanAvgDiff}
          exactMatch={analytics?.human_vs_human.exact_match_rate ?? "0"}
          withinOne={analytics?.human_vs_human.within_one_point_rate ?? "0"}
          color="var(--sjsu-blue)"
        />
        <ComparisonCard
          title="AI vs Human"
          subtitle="Model agreement"
          avgDiff={aiAvgDiff}
          exactMatch={analytics?.ai_human.exact_match_rate ?? "0"}
          withinOne={analytics?.ai_human.within_one_point_rate ?? "0"}
          color="var(--sjsu-gold)"
        />
        <div className="p-5 rounded-lg border border-border flex flex-col justify-center items-center text-center">
          <p className="text-xs text-muted-foreground mb-2">Applications Scored</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--sjsu-blue)' }}>
            {stats?.both_scored.toLocaleString() ?? "0"}
          </p>
          <p className="text-xs text-muted-foreground mt-3">Flagged for Review</p>
          <p className="text-2xl font-bold text-red-600">
            {stats?.flagged_for_review.toLocaleString() ?? "0"}
          </p>
        </div>
      </div>

      {/* Row 3: Human Reviewer Agreement Distribution */}
      {analytics?.reviewer_distribution && analytics.reviewer_distribution.length > 0 && (
        <div className="p-6 rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-1">Human Reviewer Agreement</h2>
          <p className="text-sm text-muted-foreground mb-5">
            How often do two human reviewers give the same score for a criterion?
          </p>
          <div className="space-y-3">
            {analytics.reviewer_distribution.map((row) => (
              <DistBar
                key={row.level}
                label={row.level}
                pct={parseFloat(row.percentage)}
                color={
                  row.level === "Exact Match" ? "bg-[#0055A2]" :
                  row.level === "Very Close" ? "bg-[#1a7fd4]" :
                  row.level === "Moderate Difference" ? "bg-[#E5A823]" :
                  "bg-red-500"
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Row 4: By Scholarship Type */}
      {analytics?.scholarship_stats && analytics.scholarship_stats.length > 0 && (
        <div className="p-6 rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-1">Agreement by Scholarship Type</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Human inter-rater reliability varies significantly by scholarship. This tells us where AI oversight adds the most value.
          </p>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium">Scholarship</th>
                  <th className="text-right px-4 py-2.5 font-medium">Avg Diff</th>
                  <th className="text-right px-4 py-2.5 font-medium">Exact Match</th>
                  <th className="text-right px-4 py-2.5 font-medium">Within 1pt</th>
                  <th className="text-right px-4 py-2.5 font-medium">Significant Diff</th>
                </tr>
              </thead>
              <tbody>
                {analytics.scholarship_stats.map((row) => (
                  <tr key={row.scholarship} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{row.scholarship}</td>
                    <td className="px-4 py-2.5 text-right">{parseFloat(row.avg_difference).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right">{parseFloat(row.exact_match_rate).toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right">{parseFloat(row.within_one_point_rate).toFixed(1)}%</td>
                    <td className={`px-4 py-2.5 text-right ${parseFloat(row.significant_difference_rate) > 10 ? "text-red-600 font-medium" : ""}`}>
                      {parseFloat(row.significant_difference_rate).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 5: By Criterion */}
      {analytics?.criterion_stats && analytics.criterion_stats.length > 0 && (
        <div className="p-6 rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-1">Human Disagreement by Criterion</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Which scoring criteria cause the most disagreement between human reviewers?
          </p>
          <div className="space-y-3">
            {analytics.criterion_stats
              .sort((a, b) => parseFloat(b.avg_difference) - parseFloat(a.avg_difference))
              .map((row) => (
                <div key={row.criterion} className="flex items-center gap-4">
                  <span className="text-sm w-44 text-right font-medium truncate">{row.criterion}</span>
                  <div className="flex-1 h-7 bg-muted rounded overflow-hidden relative">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${Math.min(100, parseFloat(row.avg_difference) / 3 * 100)}%`,
                        backgroundColor: parseFloat(row.avg_difference) > 1.5 ? '#E5A823' : '#0055A2',
                      }}
                    />
                    <span className="absolute inset-y-0 right-2 flex items-center text-xs font-medium">
                      {parseFloat(row.avg_difference).toFixed(2)} avg diff
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground w-24">
                    {parseFloat(row.within_one_point_rate).toFixed(0)}% within 1pt
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Row 6: Variance Distribution (existing) */}
      {stats && (
        <div className="p-6 rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-1">AI vs Human Variance Distribution</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Score difference (absolute points) between AI and human weighted totals.
          </p>
          <div className="space-y-3">
            <DistBar label="0-5 pts" pct={stats.both_scored > 0 ? (stats.variance_distribution["0_5"] / stats.both_scored) * 100 : 0} color="bg-[#0055A2]" count={stats.variance_distribution["0_5"]} />
            <DistBar label="5-10 pts" pct={stats.both_scored > 0 ? (stats.variance_distribution["5_10"] / stats.both_scored) * 100 : 0} color="bg-[#1a7fd4]" count={stats.variance_distribution["5_10"]} />
            <DistBar label="10-20 pts" pct={stats.both_scored > 0 ? (stats.variance_distribution["10_20"] / stats.both_scored) * 100 : 0} color="bg-[#E5A823]" count={stats.variance_distribution["10_20"]} />
            <DistBar label="20+ pts" pct={stats.both_scored > 0 ? (stats.variance_distribution["20_plus"] / stats.both_scored) * 100 : 0} color="bg-red-500" count={stats.variance_distribution["20_plus"]} />
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonCard({
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

function DistBar({
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
