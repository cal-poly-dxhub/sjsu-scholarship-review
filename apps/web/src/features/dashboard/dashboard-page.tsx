import { TriggerSection } from "./trigger-section";
import { ReliabilitySection } from "./reliability-section";

/**
 * The dashboard: everything that starts work on top, everything that measures agreement below.
 * They are separate reads on purpose — the reliability half is waiting on last year's reader
 * scores, and its failing must not take the buttons with it.
 */
export function DashboardPage() {
  return (
    <div className="space-y-6 p-6">
      <TriggerSection />
      <ReliabilitySection />
    </div>
  );
}
