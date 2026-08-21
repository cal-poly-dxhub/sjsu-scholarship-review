import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { Separator } from "@/sjsu/components/ui/separator";
import IconFileExport from "@/sjsu/components/icons/icon-file-export";
import { cn } from "@/sjsu/lib/utils";

/**
 * The publishing side of the rubrics screen: open a rubric file, read what the parser made of it,
 * set the weights, publish the next version.
 *
 * A rubric file is written text — `Category: Name (1-4)` and a line per score band — so what is
 * shown here is the file as written beside the criteria it produced. A published version is never
 * edited: every stored score names the version whose weights made it, so a correction is a new
 * publish.
 */

interface ParsedLevel {
  value: number;
  description: string;
}

interface ParsedCriterion {
  id: string;
  name: string;
  max: number;
  guidance: string;
  levels: ParsedLevel[];
}

interface ParseResponse {
  preamble: string;
  criteria: ParsedCriterion[];
}

interface PublishResponse {
  version: string;
  note: string;
}

// A rubric's weights are a percentage split, so they add up to a hundred or the publish is
// refused. Nothing infers a weight from a criterion's maximum.
const WEIGHT_TOTAL = 100;

// What the parser reads. Markdown has no dependable file type in a browser, so the extension is
// what a picked file is judged on.
const ACCEPTED = [".txt", ".md", ".markdown"];

const accepted = (name: string): boolean =>
  ACCEPTED.some((suffix) => name.toLowerCase().endsWith(suffix));

export function PublishPane({
  scholarship,
  named,
  stacked,
  onPublished,
}: {
  scholarship: string;
  /** The scholarship's display name, for the pane's own wording. */
  named: string;
  /** The window is too narrow for the split view, so this sits under the reading side and the
   *  page does the scrolling rather than the pane. */
  stacked?: boolean;
  /** A new version is published — the reading side switches to it. */
  onPublished: (version: string) => void;
}) {
  const [sourceFile, setSourceFile] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [readError, setReadError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const parse = useMutation({
    mutationFn: (text: string) =>
      api<ParseResponse>("/rubric-parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_text: text }),
      }),
    onSuccess: (parsed) => {
      setWeights(Object.fromEntries(parsed.criteria.map((c) => [c.id, ""])));
    },
  });

  const publish = useMutation({
    mutationFn: () =>
      api<PublishResponse>("/rubric-versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scholarship,
          source_file: sourceFile,
          source_text: sourceText,
          weights: Object.fromEntries(
            Object.entries(weights).map(([id, value]) => [id, Number(value)]),
          ),
        }),
      }),
    onSuccess: (published) => {
      queryClient.invalidateQueries({ queryKey: ["rubric-versions", scholarship] });
      onPublished(published.version);
    },
  });

  const parsed = parse.data;
  const total = Object.values(weights).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const balanced = parsed !== undefined && Math.abs(total - WEIGHT_TOTAL) < 0.001;

  const take = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    publish.reset();
    if (!accepted(file.name)) {
      setReadError(`${file.name} is not a text or Markdown file, so it cannot be read.`);
      return;
    }
    try {
      const text = await file.text();
      setSourceFile(file.name);
      setSourceText(text);
      parse.mutate(text);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "The file could not be read.");
    }
  };

  const clear = () => {
    setSourceFile("");
    setSourceText("");
    setWeights({});
    setReadError(null);
    parse.reset();
    publish.reset();
  };

  const frame = cn("flex flex-col", stacked ? "min-h-0" : "h-full");
  const body = cn("space-y-4 p-4", !stacked && "flex-1 overflow-y-auto");

  if (scholarship === "") {
    return (
      <div className={frame}>
        <PaneHeader />
        <div className={body}>
          <p className="reading text-sm text-muted-foreground">
            Pick a scholarship {stacked ? "above" : "on the left"}, and a rubric can be published
            for it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={frame}>
      <PaneHeader file={sourceFile} onClear={sourceFile === "" ? undefined : clear} />

      <div className={body}>
        {sourceFile === "" ? (
          <PickFile named={named} stacked={stacked} onPick={take} error={readError} />
        ) : (
          <>
            {readError && <p className="reading text-sm text-warning">{readError}</p>}
            {parse.isPending && (
              <p className="reading text-sm text-muted-foreground">Reading {sourceFile}…</p>
            )}
            {parse.isError && (
              <p className="reading text-sm text-warning">
                {/* The reply names the line it stopped on, and nothing is published. */}
                {parse.error instanceof Error
                  ? parse.error.message
                  : "We could not read this rubric file."}
              </p>
            )}

            {parsed && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{parsed.criteria.length} criteria</span>
                  <Badge variant={balanced ? "secondary" : "warning"}>
                    Weights {total} of {WEIGHT_TOTAL}
                  </Badge>
                </div>
                <p className="reading text-xs text-muted-foreground">
                  Only the shape of the rubric was checked, not whether it judges well. Nothing
                  objects if a criterion with two lines of description is worth 40% of the total.
                </p>

                {parsed.criteria.map((criterion) => (
                  <div key={criterion.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{criterion.name}</span>
                      <Badge variant="outline">Out of {criterion.max}</Badge>
                      <div className="ml-auto flex items-center gap-2">
                        <Label
                          htmlFor={`weight-${criterion.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Weight %
                        </Label>
                        <Input
                          id={`weight-${criterion.id}`}
                          type="number"
                          className="w-20"
                          value={weights[criterion.id] ?? ""}
                          onChange={(event) =>
                            setWeights((current) => ({
                              ...current,
                              [criterion.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    {criterion.guidance && (
                      <p className="reading text-sm text-muted-foreground">{criterion.guidance}</p>
                    )}
                    <ul className="reading space-y-1 text-sm">
                      {criterion.levels.map((level) => (
                        <li key={level.value} className="text-muted-foreground">
                          <span className="font-medium text-foreground">{level.value}</span> —{" "}
                          {level.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                <details className="reading text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    The file as written
                  </summary>
                  {/* A share of the window's height, so a short screen is not filled by the file
                      and a tall one is not left scrolling a small box. */}
                  <pre className="mt-2 max-h-[50vh] overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                    {sourceText}
                  </pre>
                </details>

                <Separator />

                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={!balanced || publish.isPending} onClick={() => publish.mutate()}>
                    {publish.isPending ? "Publishing…" : "Publish this version"}
                  </Button>
                  {!balanced && (
                    <span className="text-xs text-muted-foreground">
                      The weights add up to {total}. Publishing needs {WEIGHT_TOTAL}.
                    </span>
                  )}
                  {publish.isError && (
                    <span className="text-sm text-warning">
                      {publish.error instanceof Error
                        ? publish.error.message
                        : "The publish failed."}
                    </span>
                  )}
                  {publish.data && (
                    <span className="text-sm">
                      Published {publish.data.version}. It is {stacked ? "above" : "on the left"},
                      and a run scores against it once you pick it on the dashboard.
                    </span>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PaneHeader({ file, onClear }: { file?: string; onClear?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Publish a version</h2>
        <p className="truncate text-xs text-muted-foreground">
          {file ? file : "Open a rubric file, set the weights, publish it."}
        </p>
      </div>
      {onClear && (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onClear}>
          Close the file
        </Button>
      )}
    </div>
  );
}

/** The empty state of the publishing side: one drop card, centred in the pane. */
function PickFile({
  named,
  stacked,
  onPick,
  error,
}: {
  named: string;
  stacked?: boolean;
  onPick: (file: File | undefined) => void;
  error: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3",
        stacked ? "py-10" : "h-full p-8",
      )}
    >
      <input
        ref={input}
        type="file"
        accept=".txt,.md,.markdown"
        className="hidden"
        onChange={(event) => {
          onPick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {/* A share of the pane, so it holds its place in the middle of it at any width the handle is
          set to. Stacked there is no pane to take a share of, so it takes the width it is given. */}
      <Card
        className={cn(
          "cursor-pointer rounded-3xl border-dashed transition-colors hover:border-foreground/40",
          stacked ? "w-full" : "w-3/5",
        )}
        onClick={() => input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onPick(event.dataTransfer.files?.[0]);
        }}
      >
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <IconFileExport className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Open a rubric for {named}</p>
          <p className="text-sm text-muted-foreground">
            A text or Markdown file. Drop it here or click to pick one.
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing is published until you set the weights.
          </p>
        </CardContent>
      </Card>
      {error && <p className="text-center text-sm text-warning">{error}</p>}
    </div>
  );
}
