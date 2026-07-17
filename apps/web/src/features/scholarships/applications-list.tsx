import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";

interface Application {
  application_key: string;
  gpa: string | null;
  major: string | null;
  human_weighted_total: number;
  llm_weighted_score: number;
  final_weighted_score: number;
  variance_pct: number;
  needs_human_review: boolean;
}

interface ApplicationsResponse {
  applications: Application[];
}

const PAGE_SIZE = 100;

export function ApplicationsList({
  availabilityId,
  onBack,
  onSelectApp,
}: {
  availabilityId: string;
  onBack: () => void;
  onSelectApp: (key: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({
    appKey: "",
    major: "",
    gpaMin: "",
    gpaMax: "",
    humanMin: "",
    humanMax: "",
    aiMin: "",
    aiMax: "",
    varianceMin: "",
    varianceMax: "",
  });
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["scholarship-applications", availabilityId],
    queryFn: () =>
      api<ApplicationsResponse>(
        `/scholarships/${encodeURIComponent(availabilityId)}/applications`
      ),
  });

  const filtered = useMemo(() => {
    if (!data?.applications) return [];
    return data.applications.filter((app) => {
      if (filters.appKey && !app.application_key.toLowerCase().includes(filters.appKey.toLowerCase())) return false;
      if (filters.major && !(app.major ?? "").toLowerCase().includes(filters.major.toLowerCase())) return false;

      const gpa = app.gpa ? parseFloat(app.gpa) : null;
      if (filters.gpaMin && (gpa === null || gpa < parseFloat(filters.gpaMin))) return false;
      if (filters.gpaMax && (gpa === null || gpa > parseFloat(filters.gpaMax))) return false;

      if (filters.humanMin && app.human_weighted_total < parseFloat(filters.humanMin)) return false;
      if (filters.humanMax && app.human_weighted_total > parseFloat(filters.humanMax)) return false;

      if (filters.aiMin && app.llm_weighted_score < parseFloat(filters.aiMin)) return false;
      if (filters.aiMax && app.llm_weighted_score > parseFloat(filters.aiMax)) return false;

      if (filters.varianceMin && app.variance_pct < parseFloat(filters.varianceMin)) return false;
      if (filters.varianceMax && app.variance_pct > parseFloat(filters.varianceMax)) return false;

      return true;
    });
  }, [data, filters]);

  const totalApps = filtered.length;
  const totalPages = Math.ceil(totalApps / PAGE_SIZE);
  const pageApps = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const startIdx = page * PAGE_SIZE;

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const clearFilters = () => {
    setFilters({ appKey: "", major: "", gpaMin: "", gpaMax: "", humanMin: "", humanMax: "", aiMin: "", aiMax: "", varianceMin: "", varianceMax: "" });
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-accent transition-colors"
          aria-label="Back to scholarships"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{availabilityId}</h1>
          <p className="text-sm text-muted-foreground">
            {totalApps} applications{activeFilterCount > 0 ? ` (filtered from ${data?.applications.length ?? 0})` : ""}, ranked by score
          </p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${showFilters || activeFilterCount > 0 ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent"}`}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="p-4 rounded-lg border border-border bg-muted/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filter Applications</span>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <X className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FilterInput label="App Key" value={filters.appKey} onChange={(v) => { setFilters((f) => ({ ...f, appKey: v })); setPage(0); }} placeholder="Search..." />
            <FilterInput label="Major" value={filters.major} onChange={(v) => { setFilters((f) => ({ ...f, major: v })); setPage(0); }} placeholder="Search..." />
            <FilterRange label="GPA" min={filters.gpaMin} max={filters.gpaMax} onMinChange={(v) => { setFilters((f) => ({ ...f, gpaMin: v })); setPage(0); }} onMaxChange={(v) => { setFilters((f) => ({ ...f, gpaMax: v })); setPage(0); }} />
            <FilterRange label="Human Score" min={filters.humanMin} max={filters.humanMax} onMinChange={(v) => { setFilters((f) => ({ ...f, humanMin: v })); setPage(0); }} onMaxChange={(v) => { setFilters((f) => ({ ...f, humanMax: v })); setPage(0); }} />
            <FilterRange label="AI Score" min={filters.aiMin} max={filters.aiMax} onMinChange={(v) => { setFilters((f) => ({ ...f, aiMin: v })); setPage(0); }} onMaxChange={(v) => { setFilters((f) => ({ ...f, aiMax: v })); setPage(0); }} />
            <FilterRange label="Variance %" min={filters.varianceMin} max={filters.varianceMax} onMinChange={(v) => { setFilters((f) => ({ ...f, varianceMin: v })); setPage(0); }} onMaxChange={(v) => { setFilters((f) => ({ ...f, varianceMax: v })); setPage(0); }} />
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading applications...</p>
      ) : (
        <>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium">#</th>
                  <th className="text-left px-4 py-2.5 font-medium">Application</th>
                  <th className="text-left px-4 py-2.5 font-medium">Major</th>
                  <th className="text-right px-4 py-2.5 font-medium">GPA</th>
                  <th className="text-right px-4 py-2.5 font-medium">Human</th>
                  <th className="text-right px-4 py-2.5 font-medium">AI</th>
                  <th className="text-right px-4 py-2.5 font-medium">Final</th>
                  <th className="text-right px-4 py-2.5 font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {pageApps.map((app, i) => (
                  <tr
                    key={app.application_key}
                    className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors cursor-pointer"
                    onClick={() => onSelectApp(app.application_key)}
                  >
                    <td className="px-4 py-2.5 text-muted-foreground">{startIdx + i + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {app.application_key.slice(0, 8)}...
                      {app.needs_human_review && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-800 rounded">
                          REVIEW
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 truncate max-w-[200px]">{app.major ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">{app.gpa ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">{app.human_weighted_total}</td>
                    <td className="px-4 py-2.5 text-right">{app.llm_weighted_score}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{app.final_weighted_score}</td>
                    <td className={`px-4 py-2.5 text-right ${app.variance_pct > 20 ? "text-red-600 font-medium" : ""}`}>
                      {app.variance_pct}%
                    </td>
                  </tr>
                ))}
                {pageApps.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No applications match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1">
              <p className="text-sm text-muted-foreground">
                Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, totalApps)} of {totalApps}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function FilterRange({ label, min, max, onMinChange, onMaxChange }: { label: string; min: string; max: string; onMinChange: (v: string) => void; onMaxChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="mt-1 flex gap-1.5">
        <input
          type="number"
          value={min}
          onChange={(e) => onMinChange(e.target.value)}
          placeholder="Min"
          className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="number"
          value={max}
          onChange={(e) => onMaxChange(e.target.value)}
          placeholder="Max"
          className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </div>
  );
}
