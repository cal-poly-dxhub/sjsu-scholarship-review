import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/sjsu/components/ui/table";
import { NO_REVIEWER_SCORES, NotStored } from "@/sjsu/components/not-built";
import { useScholarshipName } from "@/features/cohorts/cohort-picker";
import { isAcademicYear } from "@/lib/academic-year";

/**
 * Scoring reliability: how far the model's total lands from the reviewers', and the same split by
 * scholarship and by gap band.
 *
 * Every figure is read off the per-cohort summaries the reviewer-score ingest keeps, so the whole
 * section costs one request and no scan. Two of them are counted per criterion rather than per
 * application: one reviewer against another, and the model against what the reviewers averaged.
 * Where a cohort has nothing to compare, the panel keeps its labels and says the figure is not
 * saved — a zero there would read as a result.
 *
 * The scoring coverage panel counts scoring already done, off the cohort read.
 */

// How close two reviewers landed on the same criterion, in that criterion's own points. The key is
// the one the server counts into, so a band the server renames shows as empty rather than as
// somebody else's count.
const AGREEMENT_BANDS = [
  { key: "same", label: "Same score", color: "bg-[var(--sjsu-blue)]" },
  { key: "within_one", label: "Within one point", color: "bg-[var(--sjsu-blue-light)]" },
  { key: "some_difference", label: "Some difference", color: "bg-[var(--sjsu-gold)]" },
  { key: "far_apart", label: "Far apart", color: "bg-red-500" },
];

// The same for the gap between the model's total and a reviewer's. The key is the one the server
// counts into, so a band the server renames shows as empty rather than as somebody else's count.
const VARIANCE_BANDS = [
  { key: "0_5", label: "0 to 5 points", color: "bg-[var(--sjsu-blue)]" },
  { key: "5_10", label: "5 to 10 points", color: "bg-[var(--sjsu-blue-light)]" },
  { key: "10_20", label: "10 to 20 points", color: "bg-[var(--sjsu-gold)]" },
  { key: "20_plus", label: "20 points or more", color: "bg-red-500" },
];

/** What the agreement read hands back. Every figure carries how many applications it covers. */
interface Agreement {
  totals: {
    cohorts: number;
    applications: number;
    with_reviewer_scores: number;
    /** Applications with both a model total and a reviewer total. What the mean gap is a mean of. */
    covers: number;
    flagged: number;
    mean_gap: number | null;
  };
  gap_bands: Record<string, number>;
  scholarships: Array<{
    scholarship: string;
    year: string;
    applications: number;
    with_reviewer_scores: number;
    covers: number;
    flagged: number;
    mean_gap: number | null;
  }>;
  /** Per criterion, in that criterion's own points. Widest apart first. */
  criteria: Array<{ criterion: string; covers: number; mean_apart: number }>;
  /** One pair of reviewers on one criterion is one pair, so an application can hold several. */
  reviewer_pairs: {
    pairs: number;
    mean_apart: number | null;
    bands: Record<string, number>;
  };
  disagreement_line: number;
  not_built: string[];
}

export function ReliabilitySection({
  scholarship,
  year,
}: {
  scholarship: string;
  year: string;
}) {
  const agreementQuery = useQuery({
    queryKey: ["agreement"],
    queryFn: () => api<Agreement>("/agreement"),
  });

  const agreement = agreementQuery.data;
  const totals = agreement?.totals;
  const covers = totals?.covers ?? 0;
  const bands = agreement?.gap_bands ?? {};
  const pairs = agreement?.reviewer_pairs;
  // No pair, no comparison. Every figure below it is a share of this number.
  const paired = pairs?.pairs ?? 0;

  return (
    <div className="space-y-6">
      <CoveragePanel scholarship={scholarship} year={year} />

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Scoring reliability</h2>
        <p className="mt-1 reading text-sm text-muted-foreground">
          How far the model's total lands from the reviewers'. These figures cover every
          scholarship, not just the cohort you picked.
        </p>
      </div>

      {agreementQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading the agreement figures…</p>
      )}
      {agreementQuery.isError && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-warning">
            We could not load the agreement figures, so they are missing rather than zero.
          </p>
          <Button size="sm" variant="outline" onClick={() => agreementQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {/* Full width, so its edges line up with every other panel on the page. The gap to the screen
          is the page's gutter, which is a share of the window — see PageOutlet. */}
      <Card
        className="border-2"
        style={{
          borderColor: "var(--sjsu-gold)",
          backgroundColor: "color-mix(in srgb, var(--sjsu-gold) 5%, transparent)",
        }}
      >
        <CardContent>
          <p className="text-base" style={{ color: "var(--sjsu-blue)" }}>
            {covers === 0
              ? "No application has both a model total and a reviewer total yet, so there is nothing to compare. Upload reviewer scores for a cohort that has been scored."
              : `Across ${covers.toLocaleString()} applications with both totals, the model and the reviewers are ${totals?.mean_gap ?? "—"} points apart on average, out of 100. ${totals?.flagged.toLocaleString()} are ${agreement?.disagreement_line} points or more apart and are in the review queue.`}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ComparisonCard
          title="Reviewer against reviewer"
          subtitle="How close two reviewers land on the same criterion"
          color="var(--sjsu-blue)"
          figures={
            pairs && paired > 0 && pairs.mean_apart !== null
              ? {
                  meanApart: pairs.mean_apart,
                  same: ((pairs.bands.same ?? 0) / paired) * 100,
                  withinOne:
                    (((pairs.bands.same ?? 0) + (pairs.bands.within_one ?? 0)) / paired) * 100,
                }
              : undefined
          }
        />
        <Card>
          <CardContent>
            <p className="text-sm font-semibold" style={{ color: "var(--sjsu-gold)" }}>
              Model against reviewer
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              How far the model's total lands from the reviewers'
            </p>
            <div className="space-y-2">
              <Figure label="Average gap">
                {totals?.mean_gap === null || totals?.mean_gap === undefined ? (
                  <NotStored />
                ) : (
                  `${totals.mean_gap} points`
                )}
              </Figure>
              <Figure label="Covers">
                {agreement ? `${covers.toLocaleString()} applications` : <NotStored />}
              </Figure>
              <Figure label="Far enough apart to flag">
                {agreement ? totals?.flagged.toLocaleString() : <NotStored />}
              </Figure>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-1 text-center">
            <p className="text-xs text-muted-foreground">Applications with both scores</p>
            {agreement ? (
              <p className="text-2xl font-semibold">{covers.toLocaleString()}</p>
            ) : (
              <NotStored />
            )}
            <p className="mt-3 text-xs text-muted-foreground">Flagged for review</p>
            {agreement ? (
              <p className="text-2xl font-semibold">{totals?.flagged.toLocaleString()}</p>
            ) : (
              <NotStored />
            )}
          </CardContent>
        </Card>
      </div>

      <Breakdown
        title="Reviewer agreement"
        blurb="How often two reviewers give a criterion the same score. Counted per pair of reviewers per criterion, so one application can hold several."
      >
        {/* A share of the card, not a pixel cap: the bars grow with the window but stop well short
            of a wide monitor, where a label and its figure end up a screen apart. */}
        <div className="w-full space-y-3 lg:w-3/4 2xl:w-1/2">
          {AGREEMENT_BANDS.map((band) => {
            const count = pairs?.bands[band.key];
            return (
              <DistBar
                key={band.key}
                label={band.label}
                color={band.color}
                pct={paired > 0 ? ((count ?? 0) / paired) * 100 : undefined}
                count={paired > 0 ? (count ?? 0) : undefined}
                total={paired > 0 ? paired : undefined}
              />
            );
          })}
        </div>
        {agreement && paired === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            No criterion has been scored by two reviewers yet, so there is no pair to compare. One
            reviewer's score on its own says nothing about agreement.
          </p>
        )}
      </Breakdown>

      <Breakdown
        title="Agreement by scholarship"
        blurb="Where a second reading is worth the most."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scholarship</TableHead>
              <TableHead className="text-right">Average gap</TableHead>
              <TableHead className="text-right">With reviewer scores</TableHead>
              <TableHead className="text-right">Both totals</TableHead>
              <TableHead className="text-right">Flagged</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(agreement?.scholarships ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="whitespace-normal text-muted-foreground">
                  {NO_REVIEWER_SCORES}
                </TableCell>
              </TableRow>
            ) : (
              agreement?.scholarships.map((row) => (
                <TableRow key={`${row.scholarship}#${row.year}`}>
                  <TableCell>
                    <ScholarshipCell scholarship={row.scholarship} />{" "}
                    <span className="text-muted-foreground">{row.year}</span>
                  </TableCell>
                  {/* A cohort with no comparable pair has no mean, and a dash there would read as
                      a measured zero. */}
                  <TableCell className="text-right tabular-nums">
                    {row.mean_gap === null ? <NotStored /> : row.mean_gap}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.with_reviewer_scores.toLocaleString()} of{" "}
                    {row.applications.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.covers.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.flagged.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Breakdown>

      <Breakdown
        title="Disagreement by criterion"
        blurb="Which criteria the model and the reviewers score differently, widest apart first."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Criterion</TableHead>
              <TableHead className="text-right">Average apart</TableHead>
              <TableHead className="text-right">Applications</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(agreement?.criteria ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="whitespace-normal text-muted-foreground">
                  {NO_REVIEWER_SCORES}
                </TableCell>
              </TableRow>
            ) : (
              agreement?.criteria.map((row) => (
                <TableRow key={row.criterion}>
                  <TableCell>{criterionWords(row.criterion)}</TableCell>
                  {/* In the criterion's own marks, not out of 100: a rubric puts one criterion out
                      of 4 and another out of 10, and a share would hide which one that was. */}
                  <TableCell className="text-right tabular-nums">
                    {row.mean_apart} marks
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.covers.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Breakdown>

      <Breakdown
        title="Score gap between the model and a reviewer"
        blurb="How far apart the model's total and a reviewer's total end up, in points."
      >
        {/* A bar is read by its length against the ones above it, so the group takes a share of the
            card rather than the whole width of a wide monitor. */}
        <div className="w-full space-y-3 lg:w-3/4 2xl:w-1/2">
          {VARIANCE_BANDS.map((band) => {
            const count = bands[band.key];
            return (
              <DistBar
                key={band.label}
                label={band.label}
                color={band.color}
                // A share of the applications the bands cover, so four bars read against each
                // other rather than against the whole cohort.
                pct={agreement && covers > 0 ? ((count ?? 0) / covers) * 100 : undefined}
                count={agreement && covers > 0 ? (count ?? 0) : undefined}
                total={agreement && covers > 0 ? covers : undefined}
              />
            );
          })}
        </div>
        {agreement && covers === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">{NO_REVIEWER_SCORES}</p>
        )}
      </Breakdown>
    </div>
  );
}

/**
 * A criterion's id as words. The figures cover every rubric at once, and two rubrics can name the
 * same criterion differently, so the id is what they all agree on.
 */
function criterionWords(criterion: string): string {
  const words = criterion.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The wording the export used, since the summary holds only the slug it was turned into. */
function ScholarshipCell({ scholarship }: { scholarship: string }) {
  return <>{useScholarshipName(scholarship)}</>;
}

/** One titled part of the section. Its body is either its figures or the line standing in for them. */
function Breakdown({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">{blurb}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * One side of the reviewer-against-reviewer comparison, per criterion.
 *
 * `figures` is left out where there is no pair to compare: the title and every label still render,
 * and each number reads as not saved. Nothing is formatted, so no zero can turn into "0.00 points".
 */
export function ComparisonCard({
  title,
  subtitle,
  color,
  figures,
}: {
  title: string;
  subtitle: string;
  color: string;
  figures?: { meanApart: number; same: number; withinOne: number };
}) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm font-semibold" style={{ color }}>
          {title}
        </p>
        <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>
        <div className="space-y-2">
          <Figure label="Average gap">
            {figures ? `${figures.meanApart.toFixed(2)} points` : <NotStored />}
          </Figure>
          <Figure label="Same score">
            {figures ? `${figures.same.toFixed(1)}%` : <NotStored />}
          </Figure>
          <Figure label="Within one point">
            {figures ? `${figures.withinOne.toFixed(1)}%` : <NotStored />}
          </Figure>
        </div>
      </CardContent>
    </Card>
  );
}

/** One labelled number in a comparison card. */
function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

/**
 * One bar of a distribution. Shows its count against the total it is a share of.
 *
 * The total is shown with the count because a bare figure has no unit: these bars count pairs of
 * reviewers, not applications, and 152 on its own reads as a percentage over 100 on a page where
 * everything else is out of 100. "152 of 270" says what the bar's length says.
 *
 * Leaving `pct` out is how a bar waits: the row keeps its place and its label, the track is drawn
 * empty rather than filled to zero, and the figure reads as not saved.
 */
export function DistBar({
  label,
  pct,
  color,
  count,
  total,
}: {
  label: string;
  pct?: number;
  color: string;
  count?: number;
  total?: number;
}) {
  let figure: React.ReactNode = <NotStored />;
  if (pct !== undefined) {
    if (count !== undefined && total !== undefined) {
      figure = `${count.toLocaleString()} of ${total.toLocaleString()}`;
    } else if (count !== undefined) {
      figure = count.toLocaleString();
    } else {
      figure = `${Math.round(pct)}%`;
    }
  }
  return (
    <div className="flex items-center gap-4">
      <span className="w-36 shrink-0 text-right text-sm font-medium">{label}</span>
      {pct === undefined ? (
        <div className="h-6 flex-1 rounded border border-dashed border-border" />
      ) : (
        <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
          <div
            className={`h-full rounded ${color} transition-all`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
      <span className="w-28 shrink-0 text-right text-sm text-muted-foreground">{figure}</span>
    </div>
  );
}

/** The part of the cohort read this panel uses. */
interface Coverage {
  total: number;
  states: { scored: number; unscored: number; running: number; failed: number };
  scored_by_rubric_version: Record<string, number>;
}

const STATE_WORDS: Array<[keyof Coverage["states"], string]> = [
  ["scored", "Scored"],
  ["unscored", "Not scored yet"],
  ["running", "Being scored"],
  ["failed", "Could not be scored"],
];

/**
 * How much of the picked cohort has been scored, and under which rubric version.
 *
 * The only real numbers in this section. It reads the cohort the controls above are pointed at,
 * under the same query key, so picking a cohort fills this in without a second request.
 */
function CoveragePanel({ scholarship, year }: { scholarship: string; year: string }) {
  const scoped = scholarship !== "" && isAcademicYear(year);

  const cohortQuery = useQuery({
    queryKey: ["cohort", scholarship, year],
    queryFn: () =>
      api<Coverage>(
        `/cohort?scholarship=${encodeURIComponent(scholarship)}&year=${encodeURIComponent(year)}`,
      ),
    enabled: scoped,
  });

  const coverage = scoped ? cohortQuery.data : undefined;
  const versions = Object.entries(coverage?.scored_by_rubric_version ?? {});

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Scoring coverage</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How much of the picked cohort has been scored, and under which rubric version.
          </p>
        </div>

        {!scoped && (
          <p className="text-sm text-muted-foreground">Pick a cohort above to fill this in.</p>
        )}
        {scoped && cohortQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Loading the cohort…</p>
        )}
        {scoped && cohortQuery.isError && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-warning">
              We could not load this cohort, so the counts are missing.
            </p>
            <Button size="sm" variant="outline" onClick={() => cohortQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {coverage && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STATE_WORDS.map(([state, word]) => (
                <div key={state} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{word}</p>
                  <p className="text-2xl font-semibold">
                    {coverage.states[state].toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {coverage.total.toLocaleString()} applications in this cohort.
            </p>

            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing here has been scored yet, so there is no rubric version to count.
              </p>
            ) : (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Scored under each rubric version</h3>
                {/* Two short columns. Stretched to the window the version and its count sit at
                    opposite ends of the screen, so this one is as wide as it needs to be. */}
                <Table containerClassName="w-fit" className="w-auto min-w-0">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rubric version</TableHead>
                      <TableHead className="text-right">Applications</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map(([version, count]) => (
                      <TableRow key={version}>
                        <TableCell>{version}</TableCell>
                        <TableCell className="text-right">{count.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
