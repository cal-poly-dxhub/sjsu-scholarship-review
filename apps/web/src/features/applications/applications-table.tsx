import { useMemo, useState } from "react";
import { Input } from "@/sjsu/components/ui/input";
import { Badge } from "@/sjsu/components/ui/badge";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/sjsu/components/ui/table";
import { SortableHead } from "@/sjsu/components/ui/sortable-head";
import { useTableSort } from "@/sjsu/lib/use-table-sort";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { cn } from "@/sjsu/lib/utils";
import { ApplicationReviewDialog } from "./application-review-dialog";
import { DIVERGENCE_THRESHOLD, STUB_ROWS, type TableRow as AppRow } from "./review-data";

type SortField = "student" | "scholarship" | "gpa" | "score" | "delta";

export function ApplicationsTable() {
  const [search, setSearch] = useState("");
  const [showAgreed, setShowAgreed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null); // index into `visible`
  const { sortBy, sortDir, setSort } = useTableSort<SortField>();
  const sortProps = { sortBy, sortDir, onSort: setSort } as const;

  const { needsHuman, agreed } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? STUB_ROWS.filter((r) =>
          `${r.student} ${r.scholarship} ${r.major}`.toLowerCase().includes(query),
        )
      : STUB_ROWS;

    // no sort picked = biggest split first, the pile is a worklist not a listing
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      if (!sortBy) return Math.abs(b.delta) - Math.abs(a.delta);
      if (sortBy === "gpa") return ((a.gpa ?? -1) - (b.gpa ?? -1)) * dir;
      if (sortBy === "score") return (a.aiPercent - b.aiPercent) * dir;
      if (sortBy === "delta") return (Math.abs(a.delta) - Math.abs(b.delta)) * dir;
      return String(a[sortBy]).localeCompare(String(b[sortBy])) * dir;
    });

    return {
      needsHuman: sorted.filter((r) => r.needsHuman),
      agreed: sorted.filter((r) => !r.needsHuman),
    };
  }, [search, sortBy, sortDir]);

  // dialog navigates whatever is on screen, needs-human pile first
  const visible = showAgreed ? [...needsHuman, ...agreed] : needsHuman;
  const total = needsHuman.length + agreed.length;
  // agreement is purely about the scores; the pile also pulls in low-confidence rows
  const withinThreshold = [...needsHuman, ...agreed].filter((r) => Math.abs(r.delta) < DIVERGENCE_THRESHOLD).length;
  const agreeRate = total === 0 ? 0 : Math.round((withinThreshold / total) * 100);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="font-mondwest text-3xl">Applications</h1>
        <Badge variant="secondary">shadow run 25-26</Badge>
        <Badge variant="warning">stub data</Badge>
      </div>

      {/* the health of the whole run, before any table reading */}
      <div className="mb-6 grid max-w-2xl grid-cols-3 gap-3">
        <StatCard value={total} label="applications scored" />
        <StatCard value={`${agreeRate}%`} label="AI + human agree" />
        <StatCard value={needsHuman.length} label="need a human" />
      </div>

      <Input
        placeholder="Search student, major, or scholarship"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="mb-4 max-w-sm"
      />

      <Table>
        <colgroup>
          <col className="w-28" />
          <col className="w-36" />
          <col className="w-48" />
          <col className="w-16" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-16" />
          <col className="w-16" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHead field="student" {...sortProps}>Student</SortableHead>
            <SortableHead field="scholarship" {...sortProps}>Scholarship</SortableHead>
            <TableHead>Major</TableHead>
            <SortableHead field="gpa" {...sortProps}>GPA</SortableHead>
            <SortableHead field="score" {...sortProps}>AI score</SortableHead>
            <TableHead>Conf</TableHead>
            <TableHead>Human</TableHead>
            <SortableHead field="delta" {...sortProps}>Δ</SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <PileHeader>
            <TriangleAlert className="size-3.5 text-warning" />
            needs a human ({needsHuman.length}) · Δ ≥ {DIVERGENCE_THRESHOLD} or low confidence
          </PileHeader>
          {needsHuman.map((row, i) => (
            <ApplicationRow key={row.id} row={row} onClick={() => setSelected(i)} />
          ))}

          <TableRow
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => setShowAgreed((v) => !v)}
          >
            <TableCell colSpan={8} className="py-2 text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {showAgreed ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                agreed ({agreed.length}) — AI and human within {DIVERGENCE_THRESHOLD} points
              </span>
            </TableCell>
          </TableRow>
          {showAgreed &&
            agreed.map((row, i) => (
              <ApplicationRow key={row.id} row={row} onClick={() => setSelected(needsHuman.length + i)} />
            ))}
        </TableBody>
      </Table>

      <ApplicationReviewDialog
        app={selected != null ? visible[selected] ?? null : null}
        index={selected ?? 0}
        total={visible.length}
        onOpenChange={(open) => !open && setSelected(null)}
        onPrev={() => setSelected((i) => (i == null ? i : (i - 1 + visible.length) % visible.length))}
        onNext={() => setSelected((i) => (i == null ? i : (i + 1) % visible.length))}
      />
    </>
  );
}

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <Card size="sm" className="gap-1">
      <CardContent>
        <div className="font-mondwest text-3xl leading-none">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function PileHeader({ children }: { children: React.ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={8} className="py-2 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">{children}</span>
      </TableCell>
    </TableRow>
  );
}

function ApplicationRow({ row, onClick }: { row: AppRow; onClick: () => void }) {
  const split = Math.abs(row.delta) >= DIVERGENCE_THRESHOLD;
  return (
    <TableRow className="cursor-pointer" onClick={onClick}>
      <TableCell className="font-medium">{row.student}</TableCell>
      <TableCell>{row.scholarship}</TableCell>
      <TableCell className="truncate text-muted-foreground">{row.major}</TableCell>
      <TableCell>
        {row.gpa == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Badge variant="secondary">{row.gpa.toFixed(1)}</Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2" title={`${row.aiComposite} / ${row.aiCompositeMax}`}>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${row.aiPercent}%` }} />
          </div>
          <span className="tabular-nums text-xs text-muted-foreground">{row.aiPercent}%</span>
        </div>
      </TableCell>
      <TableCell>
        {row.lowCount > 0 ? (
          <Badge variant="warning">
            <TriangleAlert /> {row.lowCount} low
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">solid</span>
        )}
      </TableCell>
      <TableCell className="tabular-nums text-xs text-muted-foreground">{row.humanPercent}%</TableCell>
      <TableCell>
        {/* signed on purpose: +21 = AI warmer than the human, -24 = AI colder */}
        <span className={cn("tabular-nums text-xs", split ? "font-medium text-warning" : "text-muted-foreground")}>
          {row.delta > 0 ? "+" : ""}{row.delta}
        </span>
      </TableCell>
    </TableRow>
  );
}
