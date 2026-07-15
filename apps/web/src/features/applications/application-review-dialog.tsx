import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { cn } from "@/sjsu/lib/utils";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent, CardTitle } from "@/sjsu/components/ui/card";
import { ScrollArea } from "@/sjsu/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/sjsu/components/ui/dialog";
import { buildStubRecord, DIVERGENCE_THRESHOLD, type Category, type Essay } from "./review-data";

type ReviewApp = {
  id: string;
  student: string;
  scholarship: string;
  major: string;
  level: string;
  gpa: number | null;
};

type Props = {
  app: ReviewApp | null;
  index: number; // 0-based position in the current list
  total: number;
  onOpenChange: (open: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
};

export function ApplicationReviewDialog({ app, index, total, onOpenChange, onPrev, onNext }: Props) {
  const open = app != null;

  // ←/→ grind through the stack while the dialog stays open
  useEffect(() => {
    if (!open) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") onPrev();
      if (event.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onPrev, onNext]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {app && (
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-[1200px] flex-col gap-0 p-0 sm:max-w-[1200px]">
          {/* key on app.id resets refs + flash state when we navigate */}
          <ReviewBody key={app.id} app={app} index={index} total={total} onPrev={onPrev} onNext={onNext} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ReviewBody({ app, index, total, onPrev, onNext }: Omit<Props, "app" | "onOpenChange"> & { app: ReviewApp }) {
  const record = buildStubRecord(app);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const marks = useRef(new Map<string, HTMLElement>());

  // click a score row -> scroll its evidence quote into view and flash it
  function jumpTo(category: Category) {
    if (!category.quote) return;
    const el = marks.current.get(category.key);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashKey(category.key);
    window.setTimeout(() => setFlashKey((k) => (k === category.key ? null : k)), 900);
  }

  return (
    <>
      {/* header: which scholarship + rubric, student strip, position in stack */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 pr-12">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5">
            <Button variant="outline" size="icon-sm" onClick={onPrev} aria-label="Previous application">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={onNext} aria-label="Next application">
              <ChevronRight />
            </Button>
          </div>
          {/* one line: title, student meta as text, GPA as a badge like the table rows */}
          <DialogTitle className="text-xl leading-tight">{app.scholarship}</DialogTitle>
          <DialogDescription className="sr-only">Scoring record for {app.scholarship}, student {app.student}</DialogDescription>
          <span className="text-sm text-muted-foreground">Student {app.student} · {app.major} · {app.level}</span>
          {app.gpa != null && <Badge variant="secondary">GPA {app.gpa.toFixed(1)}</Badge>}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">App {index + 1} / {total}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px]">
        {/* left: the essays, with each evidence quote highlighted in place */}
        <ScrollArea className="h-full">
          <div className="space-y-6 p-5">
            {record.essays.map((essay) => (
              <EssayBlock
                key={essay.id}
                essay={essay}
                categories={record.categories}
                flashKey={flashKey}
                registerMark={(key, el) => {
                  if (el) marks.current.set(key, el);
                  else marks.current.delete(key);
                }}
              />
            ))}
          </div>
        </ScrollArea>

        {/* right: sticky scores rail, evidence-first rows */}
        <div className="flex h-full min-h-0 flex-col border-l border-border">
          {/* composite as %, human vs AI side by side, gap flagged past threshold */}
          <div className="space-y-1.5 border-b border-border px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overall Score</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold leading-none">{record.percent}%</span>
              <span className="text-xs text-muted-foreground">AI</span>
              <span className="ml-auto text-sm text-muted-foreground">human {record.humanPercent}%</span>
              <Badge variant={Math.abs(record.delta) >= DIVERGENCE_THRESHOLD ? "warning" : "secondary"}>
                {record.delta >= 0 ? "+" : ""}{record.delta}%
              </Badge>
            </div>
          </div>
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-1 p-1">
              {record.categories.map((category) => (
                <ScoreRow key={category.key} category={category} onJump={() => jumpTo(category)} />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </>
  );
}

function ScoreRow({ category, onJump }: { category: Category; onJump: () => void }) {
  const low = category.confidence === "low";
  const pct = Math.round((category.score / category.max) * 100);
  const clickable = category.quote != null; // rows drawn from the PS record have no quote to jump to
  return (
    <Card
      size="sm"
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onJump : undefined}
      onKeyDown={clickable ? (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onJump(); }
      } : undefined}
      className={cn(clickable && "cursor-pointer transition-colors hover:bg-muted/50")}
    >
      <CardContent>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{category.label}</CardTitle>
          <span className="flex shrink-0 items-center gap-1.5">
            {low && (
              <Badge variant="warning">
                <TriangleAlert /> low
              </Badge>
            )}
            <Badge variant="secondary">
              {category.score}/{category.max} · {pct}%
            </Badge>
          </span>
        </div>

        {/* evidence-first: the quote IS the row body. dashed border = shaky score */}
        {category.quote ? (
          <p className={cn("mt-1.5 border-l-2 pl-2 text-xs italic text-muted-foreground", low ? "border-dashed border-warning" : "border-border")}>
            &ldquo;{category.quote}&rdquo;
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">from the PS record, not an essay</p>
        )}

        <p className="mt-1 text-xs text-muted-foreground/80">
          anchor · {category.anchor}
          {category.weight != null && ` · weight ${category.weight}%`}
        </p>
      </CardContent>
    </Card>
  );
}

function EssayBlock({
  essay, categories, flashKey, registerMark,
}: {
  essay: Essay;
  categories: Category[];
  flashKey: string | null;
  registerMark: (key: string, el: HTMLElement | null) => void;
}) {
  const quotes = categories.filter((c) => c.essayId === essay.id && c.quote);
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{essay.title}</h3>
      <p className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">
        {renderHighlighted(essay.text, quotes, flashKey, registerMark)}
      </p>
    </section>
  );
}

// split the essay text on its evidence quotes, wrap each match in a <mark> the
// score rail can scroll to and flash. quotes are literal substrings (see review-data).
function renderHighlighted(
  text: string,
  quotes: Category[],
  flashKey: string | null,
  registerMark: (key: string, el: HTMLElement | null) => void,
) {
  const matches = quotes
    .map((c) => ({ key: c.key, start: text.indexOf(c.quote!), len: c.quote!.length }))
    .filter((m) => m.start >= 0)
    .sort((a, b) => a.start - b.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue; // skip overlaps
    if (match.start > cursor) nodes.push(text.slice(cursor, match.start));
    nodes.push(
      <mark
        key={match.key}
        ref={(el) => registerMark(match.key, el)}
        className={cn(
          "rounded bg-warning/20 px-0.5 text-foreground transition-colors duration-700",
          flashKey === match.key && "bg-warning/70",
        )}
      >
        {text.slice(match.start, match.start + match.len)}
      </mark>,
    );
    cursor = match.start + match.len;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
