import { useState } from "react";
import { type CohortChoice } from "@/features/cohorts/cohort-picker";
import { TriggerSection } from "./trigger-section";
import { ReliabilitySection } from "./reliability-section";

/**
 * The dashboard: everything that starts work on top, everything that measures agreement below.
 * They are separate reads on purpose — one failing must not take the other with it.
 */
export function DashboardPage() {
  const [chosen, setChosen] = useState<CohortChoice>({ scholarship: "", year: "" });

  return (
    <div className="space-y-6 p-6">
      <TriggerSection chosen={chosen} onChosen={setChosen} />
      <ReliabilitySection scholarship={chosen.scholarship} year={chosen.year} />
    </div>
  );
}
