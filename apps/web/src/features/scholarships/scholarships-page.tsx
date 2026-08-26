import { useState } from "react";
import { Button } from "@/sjsu/components/ui/button";
import { isAcademicYear } from "@/lib/academic-year";
import { CohortPicker, type CohortChoice } from "@/features/cohorts/cohort-picker";
import { ApplicationsList } from "./applications-list";
import { ApplicationDetail } from "./application-detail";

/**
 * A cohort is addressed by scholarship and year, so that pair is what this screen asks for. The
 * pair is picked from what has been ingested rather than typed, because the scholarship half is a
 * slug built from the export's wording and a wrong guess reads as an empty cohort.
 */
export function ScholarshipsPage() {
  const [chosen, setChosen] = useState<CohortChoice>({ scholarship: "", year: "" });
  const [cohort, setCohort] = useState<{ scholarship: string; year: string } | null>(null);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);

  if (cohort && selectedApp) {
    return (
      <ApplicationDetail
        scholarship={cohort.scholarship}
        year={cohort.year}
        studentUuid={selectedApp}
        onBack={() => setSelectedApp(null)}
      />
    );
  }

  if (cohort) {
    return (
      <ApplicationsList
        scholarship={cohort.scholarship}
        year={cohort.year}
        onBack={() => setCohort(null)}
        onSelectApp={setSelectedApp}
      />
    );
  }

  const ready = chosen.scholarship !== "" && isAcademicYear(chosen.year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scholarships</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a cohort to read its applications.
        </p>
      </div>

      <div className="space-y-3">
        <CohortPicker value={chosen} onChange={setChosen} />
        <Button disabled={!ready} onClick={() => ready && setCohort({ ...chosen })}>
          Open cohort
        </Button>
      </div>
    </div>
  );
}
