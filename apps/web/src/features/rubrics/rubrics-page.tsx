import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Document, Page, pdfjs } from "react-pdf";
// vite resolves the worker asset via ?url — the bare new URL() trick doesn't work here
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  UploadCloud,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "@/api";
import { Button } from "@/sjsu/components/ui/button";
import { Badge } from "@/sjsu/components/ui/badge";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Textarea } from "@/sjsu/components/ui/textarea";
import { Spinner } from "@/sjsu/components/ui/spinner";
import { NativeSelect, NativeSelectOption } from "@/sjsu/components/ui/native-select";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/sjsu/components/ui/resizable";

// pdf.js worker — must be set in the same module that renders the pdf
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// neon success->error ramp: high score green, low score red. band + highlight share it
const PALETTE = ["#00e676", "#66ff66", "#c6ff00", "#ffea00", "#ff9100", "#ff1744"];
const colorFor = (i: number) => PALETTE[i % PALETTE.length]!;

type CriterionType = "options" | "scale" | "variants" | "boolean";
type Rect = [number, number, number, number]; // x0, top, x1, bottom (pdf points)
type Source = { page: number; rects: Rect[] };
type Option = { score: number; score_max?: number; label: string; source?: Source };
type Variant = { level: string; options: Option[] };
type Criterion = {
  name: string;
  question?: string;
  question_source?: Source;
  type: CriterionType;
  weight?: string;
  options?: Option[]; // options / boolean
  variants?: Variant[]; // variants
  min?: number; // scale
  max?: number; // scale
};
type PageDim = { width: number; height: number };
type Draft = {
  rubric_name: string;
  scale_note?: string;
  criteria: Criterion[];
  pages?: PageDim[];
  verbatim_matched?: number;
  verbatim_total?: number;
};

// the agent scores every shape now — the label just says what kind of call it makes
const ROUTE = {
  options: { label: "Agent picks anchor", icon: Cpu },
  boolean: { label: "Agent gate", icon: Cpu },
  scale: { label: "Agent rates", icon: Cpu },
  variants: { label: "Agent picks category", icon: Cpu },
} as const;

export function RubricsPage() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [current, setCurrent] = useState(0); // which criterion is open
  const fileInput = useRef<HTMLInputElement>(null);

  const generate = useMutation({
    mutationFn: (f: File) => {
      const body = new FormData();
      body.append("file", f);
      return api<Draft>("/rubrics/generate", { method: "POST", body });
    },
    onSuccess: (d) => {
      setDraft(d);
      setCurrent(0);
    },
    onError: (e) => toast.error(`Couldn't read that PDF: ${e.message}`),
  });

  const approve = useMutation({
    mutationFn: (d: Draft) =>
      api<{ rubric_id: string }>("/rubrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      }),
    onSuccess: () => {
      toast.success(`Approved — “${draft?.rubric_name}” is saved`);
      reset();
    },
    onError: (e) => toast.error(`Save failed: ${e.message}`),
  });

  function reset() {
    setDraft(null);
    setFile(null);
    setCurrent(0);
  }
  function patchCriterion(i: number, patch: Partial<Criterion>) {
    setDraft((d) =>
      d ? { ...d, criteria: d.criteria.map((c, k) => (k === i ? { ...c, ...patch } : c)) } : d,
    );
  }
  function patchOption(ci: number, oi: number, patch: Partial<Option>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            criteria: d.criteria.map((c, k) =>
              k === ci
                ? {
                    ...c,
                    options: (c.options ?? []).map((o, j) =>
                      j === oi ? { ...o, ...patch } : o,
                    ),
                  }
                : c,
            ),
          }
        : d,
    );
  }
  function patchVariant(ci: number, vi: number, patch: Partial<Variant>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            criteria: d.criteria.map((c, k) =>
              k === ci
                ? {
                    ...c,
                    variants: (c.variants ?? []).map((v, m) =>
                      m === vi ? { ...v, ...patch } : v,
                    ),
                  }
                : c,
            ),
          }
        : d,
    );
  }
  function patchVariantOption(ci: number, vi: number, oi: number, patch: Partial<Option>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            criteria: d.criteria.map((c, k) =>
              k === ci
                ? {
                    ...c,
                    variants: (c.variants ?? []).map((v, m) =>
                      m === vi
                        ? {
                            ...v,
                            options: v.options.map((o, j) =>
                              j === oi ? { ...o, ...patch } : o,
                            ),
                          }
                        : v,
                    ),
                  }
                : c,
            ),
          }
        : d,
    );
  }

  // upload state — no draft yet
  if (!draft) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center p-8">
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFile(f);
              generate.mutate(f);
            }
            e.target.value = "";
          }}
        />
        <Card
          className="w-full cursor-pointer rounded-3xl border-dashed transition-colors hover:border-foreground/40"
          onClick={() => fileInput.current?.click()}
        >
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            {generate.isPending ? (
              <>
                <Spinner />
                <p className="text-sm text-muted-foreground">Reading the rubric…</p>
              </>
            ) : (
              <>
                <UploadCloud className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium">Upload a rubric PDF</p>
                <p className="text-sm text-muted-foreground">
                  The system generates a draft questionnaire from the document. You
                  review, edit, and approve every criterion before anything is saved.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const verbatimOk =
    draft.verbatim_total != null && draft.verbatim_matched === draft.verbatim_total;
  const criterion = draft.criteria[current] ?? draft.criteria[0]!;
  const RouteIcon = ROUTE[criterion.type].icon;

  // what to highlight on the right depends on the shape:
  // scale -> the question text; variants -> every band across every level table;
  // options/boolean -> the located options. all colored by their slot.
  let pageIndex = 0;
  let highlights: { rects: Rect[]; color: string }[] = [];
  if (criterion.type === "scale") {
    const qs = criterion.question_source;
    pageIndex = qs?.page ?? 0;
    if (qs) highlights = [{ rects: qs.rects, color: colorFor(0) }];
  } else {
    const located =
      criterion.type === "variants"
        ? (criterion.variants ?? []).flatMap((v) =>
            v.options.map((o, oi) => ({ source: o.source, color: colorFor(oi) })),
          )
        : (criterion.options ?? []).map((o, oi) => ({
            source: o.source,
            color: colorFor(oi),
          }));
    pageIndex = located.find((h) => h.source)?.source?.page ?? 0;
    highlights = located
      .filter((h) => h.source && h.source.page === pageIndex)
      .map((h) => ({ rects: h.source!.rects, color: h.color }));
  }

  return (
    <ResizablePanelGroup className="h-full">
      {/* left — one criterion at a time, editable */}
      <ResizablePanel defaultSize="45" minSize="30">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1 space-y-1">
              <Input
                value={draft.rubric_name}
                onChange={(e) => setDraft({ ...draft, rubric_name: e.target.value })}
                className="text-base font-semibold"
              />
              {draft.scale_note && (
                <p className="px-1 text-xs text-muted-foreground">{draft.scale_note}</p>
              )}
            </div>
            {draft.verbatim_total != null && (
              <Badge variant={verbatimOk ? "success" : "warning"} className="mt-1 shrink-0 gap-1">
                {verbatimOk ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {draft.verbatim_matched}/{draft.verbatim_total} verbatim
              </Badge>
            )}
          </div>

          {/* criterion nav */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={current === 0}
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Criterion {current + 1} of {draft.criteria.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={current === draft.criteria.length - 1}
              onClick={() => setCurrent((c) => Math.min(draft.criteria.length - 1, c + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={criterion.name}
                onChange={(e) => patchCriterion(current, { name: e.target.value })}
                className="flex-1 font-medium"
              />
              <NativeSelect
                value={criterion.type}
                onChange={(e) =>
                  patchCriterion(current, { type: e.target.value as CriterionType })
                }
              >
                <NativeSelectOption value="options">options</NativeSelectOption>
                <NativeSelectOption value="scale">scale</NativeSelectOption>
                <NativeSelectOption value="variants">variants</NativeSelectOption>
                <NativeSelectOption value="boolean">boolean</NativeSelectOption>
              </NativeSelect>
              <Badge variant="secondary" className="gap-1">
                <RouteIcon className="h-3 w-3" />
                {ROUTE[criterion.type].label}
              </Badge>
            </div>

            {/* the question the agent actually answers — pulled from the rubric */}
            <div className="space-y-1">
              <label className="px-1 text-xs font-medium text-muted-foreground">
                Question the agent answers
              </label>
              <Textarea
                value={criterion.question ?? ""}
                onChange={(e) => patchCriterion(current, { question: e.target.value })}
                rows={2}
                className="resize-y"
              />
            </div>

            {criterion.type === "scale" ? (
              <div className="space-y-2">
                <p className="px-1 text-xs text-muted-foreground">
                  No anchors in the rubric — the agent returns a number in this range plus an
                  evidence quote. The question is highlighted in the rubric.
                </p>
                <div className="flex items-center gap-3 px-1">
                  <label className="text-xs text-muted-foreground">Score from</label>
                  <Input
                    type="number"
                    value={criterion.min ?? 0}
                    onChange={(e) => patchCriterion(current, { min: Number(e.target.value) })}
                    className="w-16 text-center font-semibold"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="number"
                    value={criterion.max ?? 10}
                    onChange={(e) => patchCriterion(current, { max: Number(e.target.value) })}
                    className="w-16 text-center font-semibold"
                  />
                </div>
              </div>
            ) : criterion.type === "variants" ? (
              <div className="space-y-4">
                <p className="px-1 text-xs text-muted-foreground">
                  The agent picks the applicant's category, then a band. Each band is highlighted
                  in its color.
                </p>
                {(criterion.variants ?? []).map((v, vi) => (
                  <div key={vi} className="space-y-1.5">
                    <Input
                      value={v.level}
                      onChange={(e) => patchVariant(current, vi, { level: e.target.value })}
                      className="text-sm font-medium"
                    />
                    {v.options.map((o, oi) => (
                      <OptionRow
                        key={oi}
                        option={o}
                        color={colorFor(oi)}
                        onLabel={(s) => patchVariantOption(current, vi, oi, { label: s })}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="px-1 text-xs text-muted-foreground">
                  Each option is highlighted in the rubric in its own color.
                </p>
                <div className="space-y-1.5">
                  {(criterion.options ?? []).map((o, oi) => (
                    <OptionRow
                      key={oi}
                      option={o}
                      color={colorFor(oi)}
                      onLabel={(s) => patchOption(current, oi, { label: s })}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border p-3">
            <Button variant="ghost" onClick={reset} disabled={approve.isPending}>
              Discard
            </Button>
            <Button onClick={() => approve.mutate(draft)} disabled={approve.isPending}>
              {approve.isPending ? "Saving…" : "Approve & save"}
            </Button>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* right — the pdf with every option highlighted in its color */}
      <ResizablePanel defaultSize="55" minSize="30" className="bg-muted/30">
        {file && (
          <PdfPane
            file={file}
            pageIndex={pageIndex}
            pageDim={draft.pages?.[pageIndex]}
            highlights={highlights}
          />
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

// one editable score row: the colored number band + the verbatim label, shared by
// flat options and the per-level variant tables. color matches its pdf highlight.
function OptionRow({
  option,
  color,
  onLabel,
}: {
  option: Option;
  color: string;
  onLabel: (s: string) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      {/* score band — system-owned, read-only Badge; color matches its pdf highlight */}
      <Badge
        variant="outline"
        className="mt-1 min-w-8 shrink-0 justify-center font-semibold"
        style={{ borderColor: color, backgroundColor: color, color: "#0f1115" }}
      >
        {option.score_max != null ? `${option.score}–${option.score_max}` : option.score}
      </Badge>
      <Textarea
        value={option.label}
        onChange={(e) => onLabel(e.target.value)}
        rows={1}
        className="min-h-0 flex-1 resize-y py-1.5"
      />
      {!option.source && (
        <span title="Not located in the PDF" className="pt-2">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      )}
    </div>
  );
}

// renders one pdf page at the container width and draws every option's source
// boxes in its own color. rects are pdf points (top-left origin); we scale them
// by rendered-width / page-width-in-points.
function PdfPane({
  file,
  pageIndex,
  pageDim,
  highlights,
}: {
  file: File;
  pageIndex: number;
  pageDim?: PageDim;
  highlights: { rects: Rect[]; color: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = pageDim && width ? width / pageDim.width : 1;

  return (
    <div ref={containerRef} className="h-full overflow-auto p-4">
      <Document file={file} loading={<Spinner />} className="flex justify-center">
        <div className="relative inline-block shadow-sm">
          <Page
            pageNumber={pageIndex + 1}
            width={width || undefined}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
          {highlights.flatMap((h, hi) =>
            h.rects.map((r, i) => (
              <div
                key={`${hi}-${i}`}
                className="pointer-events-none absolute rounded-sm"
                style={{
                  left: r[0] * scale,
                  top: r[1] * scale,
                  width: (r[2] - r[0]) * scale,
                  height: (r[3] - r[1]) * scale,
                  // marker highlighter: full neon, multiply so text shows through, no border
                  backgroundColor: h.color,
                  mixBlendMode: "multiply",
                }}
              />
            )),
          )}
        </div>
      </Document>
    </div>
  );
}
