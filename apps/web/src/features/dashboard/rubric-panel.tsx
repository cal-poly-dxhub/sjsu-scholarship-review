import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { Separator } from "@/sjsu/components/ui/separator";

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
  checked: string;
}

interface PublishedCriterion extends ParsedCriterion {
  weight: number;
}

interface PublishedVersion {
  version: string;
  criteria: PublishedCriterion[];
  preamble: string;
  source_file: string;
  published_at: string;
  published_by: string;
}

interface VersionsResponse {
  versions: PublishedVersion[];
}

interface PublishResponse {
  version: string;
  note: string;
}

// A rubric's weights are a percentage split, so they add up to a hundred or the publish is
// refused. Nothing infers a weight from a criterion's maximum.
const WEIGHT_TOTAL = 100;

/**
 * Pick a rubric file, see what the parser made of it, type the weights, publish the next
 * version. A published version is read-only here — a correction is a new publish.
 */
export function RubricPanel({ scholarship }: { scholarship: string }) {
  const [sourceFile, setSourceFile] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [readError, setReadError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const versionsQuery = useQuery({
    queryKey: ["rubric-versions", scholarship],
    queryFn: () =>
      api<VersionsResponse>(`/rubric-versions?scholarship=${encodeURIComponent(scholarship)}`),
    enabled: scholarship !== "",
  });

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rubric-versions", scholarship] }),
  });

  const parsed = parse.data;
  const total = Object.values(weights).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const balanced = parsed !== undefined && Math.abs(total - WEIGHT_TOTAL) < 0.001;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    publish.reset();
    try {
      const text = await file.text();
      setSourceFile(file.name);
      setSourceText(text);
      parse.mutate(text);
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "The file could not be read");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Rubric</h2>
          <p className="text-sm text-muted-foreground">
            Pick a rubric file for {scholarship || "a scholarship"}. It is parsed on the way in and
            shown before anything is published.
          </p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Rubric file</Label>
          <Input
            className="mt-1"
            type="file"
            accept=".txt,.md"
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
        </div>

        {readError && <p className="text-sm text-warning">{readError}</p>}
        {parse.isPending && <p className="text-sm text-muted-foreground">Parsing {sourceFile}…</p>}
        {parse.isError && (
          <p className="text-sm text-warning">
            {/* The parser reports the line it stopped on, and nothing is published. */}
            {parse.error instanceof Error ? parse.error.message : "The rubric did not parse"}
          </p>
        )}

        {parsed && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{parsed.criteria.length} criteria</span>
              <Badge variant={balanced ? "secondary" : "warning"}>
                weights {total} / {WEIGHT_TOTAL}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Checked: {parsed.checked}. A criterion can be worth 40% of the total on two lines
                of description and nothing will object.
              </span>
            </div>

            {parsed.criteria.map((criterion) => (
              <div key={criterion.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{criterion.name}</span>
                  <Badge variant="outline">max {criterion.max}</Badge>
                  <div className="ml-auto flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Weight %</Label>
                    <Input
                      type="number"
                      className="w-24"
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
                  <p className="text-sm text-muted-foreground">{criterion.guidance}</p>
                )}
                <ul className="space-y-1 text-sm">
                  {criterion.levels.map((level) => (
                    <li key={level.value} className="text-muted-foreground">
                      <span className="font-medium text-foreground">{level.value}</span> —{" "}
                      {level.description}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                The file as uploaded ({sourceFile})
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                {sourceText}
              </pre>
            </details>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!balanced || scholarship === "" || publish.isPending}
                onClick={() => publish.mutate()}
              >
                {publish.isPending ? "Publishing…" : "Publish this version"}
              </Button>
              {!balanced && (
                <span className="text-xs text-muted-foreground">
                  The weights add up to {total}. Publishing needs {WEIGHT_TOTAL}.
                </span>
              )}
              {publish.isError && (
                <span className="text-sm text-warning">
                  {publish.error instanceof Error ? publish.error.message : "The publish failed"}
                </span>
              )}
              {publish.data && (
                <span className="text-sm">
                  Published {publish.data.version}. {publish.data.note}
                </span>
              )}
            </div>
          </>
        )}

        {versionsQuery.data && versionsQuery.data.versions.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Published versions</h3>
              <p className="text-xs text-muted-foreground">
                Read-only. Every stored total names the version whose weights made it, so a
                correction is a new publish, not an edit.
              </p>
              {versionsQuery.data.versions.map((version) => (
                <details key={version.version} className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm">
                    {version.version} · {version.source_file} · published{" "}
                    {version.published_at} by {version.published_by}
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {version.criteria.map((criterion) => (
                      <li key={criterion.id} className="flex items-center gap-2">
                        <span>{criterion.name}</span>
                        <Badge variant="outline">max {criterion.max}</Badge>
                        <Badge variant="secondary">weight {criterion.weight}</Badge>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
