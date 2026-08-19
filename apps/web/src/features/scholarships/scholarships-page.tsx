import { useState } from "react";
import { Button } from "@/sjsu/components/ui/button";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { ApplicationsList } from "./applications-list";
import { ApplicationDetail } from "./application-detail";

/**
 * A cohort is addressed by scholarship and year, so that pair is what this screen asks for.
 * There is no read that lists cohorts — every read names one — so the pair is typed in.
 */
export function ScholarshipsPage() {
  const [scholarship, setScholarship] = useState("");
  const [year, setYear] = useState("");
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

  const ready = scholarship.trim() !== "" && year.trim() !== "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scholarships</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Name a scholarship and a year to read its applications.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setCohort({ scholarship: scholarship.trim(), year: year.trim() });
        }}
      >
        <div>
          <Label className="text-xs text-muted-foreground">Scholarship</Label>
          <Input
            className="mt-1 w-72"
            value={scholarship}
            onChange={(event) => setScholarship(event.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Year</Label>
          <Input
            className="mt-1 w-28"
            value={year}
            placeholder="2025-2026"
            onChange={(event) => setYear(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={!ready}>
          Open cohort
        </Button>
      </form>
    </div>
  );
}
