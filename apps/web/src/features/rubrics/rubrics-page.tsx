import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/sjsu/components/ui/badge";
import { Button } from "@/sjsu/components/ui/button";
import { Label } from "@/sjsu/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/sjsu/components/ui/native-select";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/sjsu/components/ui/resizable";
import { useIsMobile } from "@/sjsu/hooks/use-mobile";
import { cn } from "@/sjsu/lib/utils";
import { useCohorts } from "@/features/cohorts/cohort-picker";
import { readableTime } from "@/lib/stamps";
import { PublishPane } from "./publish-pane";

/**
 * A scholarship's rubric: what has been published on one side, and the file a new version is
 * published from on the other.
 *
 * A published version is read-only here — every stored score names the version whose weights made
 * it, so a correction is a new publish, never an edit.
 */

interface Level {
  value: number;
  description: string;
}

interface Criterion {
  id: string;
  name: string;
  max: number;
  weight: number;
  guidance: string;
  levels: Level[];
}

interface Version {
  version: string;
  criteria: Criterion[];
  preamble: string;
  source_file: string;
  published_at: string;
  published_by: string;
}

interface VersionsResponse {
  versions: Version[];
}

// High score green, low score red. The band a level sits in is easier to see as a colour than as
// a number in a list.
const PALETTE = ["#00e676", "#66ff66", "#c6ff00", "#ffea00", "#ff9100", "#ff1744"];
const colorFor = (index: number) => PALETTE[index % PALETTE.length]!;

export function RubricsPage() {
  const [scholarship, setScholarship] = useState("");
  const [pickedVersion, setPickedVersion] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);

  // Two panes side by side stop being readable well before a phone: at 768px each one is about
  // 350px, and the criteria rows and the weight entries do not fit that. Below it they stack and
  // the page scrolls instead of each pane scrolling on its own.
  const stacked = useIsMobile();

  const cohorts = useCohorts();
  // The rubric belongs to the scholarship, not to one year of it, so this asks for half of what a
  // cohort is — off the same list every other screen picks from.
  const named = new Map(
    (cohorts.data?.cohorts ?? []).map((cohort) => [cohort.scholarship, cohort.display_name]),
  );
  const display = named.get(scholarship) ?? scholarship;

  const versionsQuery = useQuery({
    queryKey: ["rubric-versions", scholarship],
    enabled: scholarship !== "",
    queryFn: () =>
      api<VersionsResponse>(`/rubric-versions?scholarship=${encodeURIComponent(scholarship)}`),
  });

  const versions = versionsQuery.data?.versions ?? [];
  const version = versions.find((v) => v.version === pickedVersion) ?? versions[0];
  const criteria = version?.criteria ?? [];
  const criterion = criteria[current] ?? criteria[0];

  const reading = (
    <div className={cn("flex flex-col", stacked ? "min-h-0" : "h-full")}>
      <div className="space-y-3 border-b border-border p-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Rubrics</h1>
          <p className="reading text-sm text-muted-foreground">
            What a scholarship scores against, and where the next version is published.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Scholarship</Label>
            <NativeSelect
              className="mt-1 w-64 max-w-full"
              value={scholarship}
              onChange={(event) => {
                setScholarship(event.target.value);
                setPickedVersion(null);
                setCurrent(0);
              }}
            >
              <NativeSelectOption value="">
                {cohorts.isLoading ? "Loading the scholarships…" : "Pick a scholarship"}
              </NativeSelectOption>
              {[...named].map(([slug, name]) => (
                <NativeSelectOption key={slug} value={slug}>
                  {name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {versions.length > 0 && (
            <div>
              <Label className="text-xs text-muted-foreground">Version</Label>
              <NativeSelect
                className="mt-1 w-40 max-w-full"
                value={version?.version ?? ""}
                onChange={(event) => {
                  setPickedVersion(event.target.value);
                  setCurrent(0);
                }}
              >
                {versions.map((v) => (
                  <NativeSelectOption key={v.version} value={v.version}>
                    {v.version}
                    {v.version === versions[0]?.version ? " (newest)" : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
      </div>

      <div className={cn("space-y-4 p-4", !stacked && "flex-1 overflow-y-auto")}>
        {scholarship === "" ? (
          <p className="reading text-sm text-muted-foreground">
            Pick a scholarship to read its rubric.
          </p>
        ) : versionsQuery.isLoading ? (
          <p className="reading text-sm text-muted-foreground">Loading the rubric…</p>
        ) : versionsQuery.isError ? (
          <p className="reading text-sm text-warning">We could not load this rubric. Try again.</p>
        ) : version === undefined ? (
          <p className="reading text-sm text-muted-foreground">
            {display} has no published rubric yet. Open a rubric file{" "}
            {stacked ? "below" : "on the right"} to publish its first version.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <p className="reading text-xs text-muted-foreground">
                From {version.source_file}, published {readableTime(version.published_at)} by{" "}
                {version.published_by}.
              </p>
              {version.preamble && (
                <details className="reading text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    What the rubric tells a grader before the criteria
                  </summary>
                  {/* The file's own line breaks are kept, so the lines land where they were
                      written rather than rewrapping into a paragraph that reads as broken. Its
                      height is a share of the window's, not a fixed box. */}
                  <pre className="mt-2 max-h-[40vh] overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                    {version.preamble}
                  </pre>
                </details>
              )}
            </div>

            {criterion && (
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={current === 0}
                    onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                    aria-label="Previous criterion"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Criterion {current + 1} of {criteria.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={current >= criteria.length - 1}
                    onClick={() => setCurrent((c) => Math.min(criteria.length - 1, c + 1))}
                    aria-label="Next criterion"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{criterion.name}</span>
                    <Badge variant="outline">Out of {criterion.max}</Badge>
                    <Badge variant="secondary">Weight {criterion.weight}</Badge>
                  </div>
                  {criterion.guidance && (
                    <p className="reading text-sm text-muted-foreground">{criterion.guidance}</p>
                  )}
                  <div className="reading space-y-1.5">
                    {criterion.levels.map((level, index) => (
                      <LevelRow key={level.value} level={level} color={colorFor(index)} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );

  const publishing = (
    <PublishPane
      scholarship={scholarship}
      named={display}
      stacked={stacked}
      onPublished={(published) => {
        setPickedVersion(published);
        setCurrent(0);
      }}
    />
  );

  if (stacked) {
    return (
      <div className="h-full overflow-y-auto overscroll-none">
        {reading}
        <div className="border-t border-border bg-muted/30">{publishing}</div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup className="h-full">
      {/* Without min-w-0 a pane will not shrink below the longest unbreakable word in it, and the
          split stops honouring where the handle was put. */}
      <ResizablePanel defaultSize="50" minSize="30" className="min-w-0">
        {reading}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="50" minSize="30" className="min-w-0 bg-muted/30">
        {publishing}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** One score band and what earns it. Read-only: this is what was published. */
function LevelRow({ level, color }: { level: Level; color: string }) {
  return (
    <div className="flex items-start gap-2">
      {/* The colour is a value, so the variant tokens cannot supply it. */}
      <Badge
        variant="outline"
        className="mt-0.5 min-w-8 shrink-0 justify-center font-semibold"
        style={{
          borderColor: `color-mix(in oklab, ${color} 75%, black)`,
          backgroundColor: color,
          color: "#0f1115",
        }}
      >
        {level.value}
      </Badge>
      <p className="flex-1 text-sm">{level.description}</p>
    </div>
  );
}
