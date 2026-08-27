import { useState } from "react";
import { type CohortChoice } from "@/features/cohorts/cohort-picker";
import { TriggerSection } from "./trigger-section";
import { ReliabilitySection } from "./reliability-section";

/**
 * The dashboard: everything that starts work on top, everything that measures agreement below.
 *
 * The cohort is picked once, at the top, and the coverage panel below reads that same one — which
 * is why the choice is held here rather than inside either half. The agreement figures span every
 * scholarship and do not use it. The two halves read separately on purpose: the agreement half has
 * nothing behind it yet, and that must not take the buttons with it.
 */
export function DashboardPage() {
  const [chosen, setChosen] = useState<CohortChoice>({ scholarship: "", year: "" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring in an export, score a cohort, and see how the scoring holds up.
        </p>
      </div>
      <TriggerSection chosen={chosen} onChosen={setChosen} />
      <ReliabilitySection scholarship={chosen.scholarship} year={chosen.year} />
    </div>
  );
}
