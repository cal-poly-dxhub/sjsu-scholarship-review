import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Button } from "@/sjsu/components/ui/button";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/sjsu/components/ui/native-select";
import { YEAR_FORM, YEAR_HINT, isAcademicYear } from "@/lib/academic-year";

/** One ingested cohort, as `/api/cohorts` reports it. */
export interface Cohort {
  /** The slug every other read addresses the cohort by. */
  scholarship: string;
  /** The wording the export used, e.g. "SJSU General Scholarships". */
  display_name: string;
  year: string;
  last_ingest_at?: string;
}

interface CohortsResponse {
  cohorts: Cohort[];
}

/** The pair that addresses a cohort. An unset choice has an empty scholarship. */
export interface CohortChoice {
  scholarship: string;
  year: string;
}

/** Both halves of the key in one string, so a `<select>` can carry them in its value. */
export function cohortKey(cohort: CohortChoice): string {
  return `${cohort.scholarship}#${cohort.year}`;
}

export const COHORTS_KEY = ["cohorts"];

/** The one read that names no cohort. Shared cache, so the upload panel and the pickers agree. */
export function useCohorts(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: COHORTS_KEY,
    queryFn: () => api<CohortsResponse>("/cohorts"),
    refetchInterval: options?.refetchInterval ?? false,
  });
}

/**
 * Pick a cohort that exists, rather than typing one. A cohort's slug comes from the export's own
 * wording — "SJSU General Scholarships" is stored as `sjsu_general_scholarships` — so a typed
 * guess reads as an empty cohort with nothing to say it was a guess.
 */
export function CohortPicker({
  value,
  onChange,
}: {
  value: CohortChoice;
  onChange: (choice: CohortChoice) => void;
}) {
  const cohorts = useCohorts();
  const [typing, setTyping] = useState(false);

  const list = cohorts.data?.cohorts ?? [];
  const empty = cohorts.isSuccess && list.length === 0;
  // Nothing to pick from means nothing to pick with, so the boxes stand in until an ingest lands.
  const byHand = typing || empty;
  const selected = list.some((cohort) => cohortKey(cohort) === cohortKey(value))
    ? cohortKey(value)
    : "";

  return (
    <div className="space-y-2">
      {byHand ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Scholarship</Label>
            <Input
              className="mt-1 w-64"
              value={value.scholarship}
              onChange={(event) =>
                onChange({ ...value, scholarship: event.target.value.trim() })
              }
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Year</Label>
            <Input
              className="mt-1 w-32"
              value={value.year}
              placeholder={YEAR_FORM}
              onChange={(event) => onChange({ ...value, year: event.target.value.trim() })}
            />
          </div>
          {!empty && (
            <Button variant="outline" size="sm" onClick={() => setTyping(false)}>
              Pick from the list
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Cohort</Label>
            <NativeSelect
              className="mt-1 w-96"
              value={selected}
              onChange={(event) => {
                const [scholarship, year] = event.target.value.split("#");
                onChange({ scholarship: scholarship ?? "", year: year ?? "" });
              }}
            >
              <NativeSelectOption value="">
                {cohorts.isLoading ? "reading the cohorts…" : "pick a cohort"}
              </NativeSelectOption>
              {list.map((cohort) => (
                <NativeSelectOption key={cohortKey(cohort)} value={cohortKey(cohort)}>
                  {cohort.display_name} — {cohort.year}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTyping(true)}>
            Type one instead
          </Button>
        </div>
      )}

      {empty && (
        <p className="text-sm text-muted-foreground">
          Nothing has been ingested yet, so there is no cohort to pick. Upload an export and this
          becomes a list — the file's name gives the year and its rows give the scholarship.
        </p>
      )}
      {byHand && !empty && (
        <p className="text-sm text-muted-foreground">
          A slug is the export's wording, lowercased, with runs of anything else as one underscore:
          "SJSU General Scholarships" is <code>sjsu_general_scholarships</code>.
        </p>
      )}
      {byHand && value.year !== "" && !isAcademicYear(value.year) && (
        <p className="text-sm text-warning">{YEAR_HINT}</p>
      )}
      {cohorts.isError && (
        <p className="text-sm text-warning">
          {cohorts.error instanceof Error
            ? cohorts.error.message
            : "The cohorts could not be read"}
        </p>
      )}
    </div>
  );
}
