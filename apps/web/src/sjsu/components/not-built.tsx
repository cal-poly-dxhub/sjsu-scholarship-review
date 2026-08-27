import { Info } from "lucide-react";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { cn } from "@/sjsu/lib/utils";

/**
 * Says the app cannot show something yet, in one line, and points at what does the job today.
 *
 * Every such statement goes through here so two screens with the same gap word it the same way,
 * and so none of them drifts into "came back empty" — a reviewer reads those two very
 * differently. There is deliberately no slot for an endpoint or a service name: the person
 * reading this reviews applications, and the missing piece is recorded in the spec, not on screen.
 */
export function NotBuilt({
  children,
  instead,
  className,
}: {
  /** What the app cannot show, in a reviewer's words. One short line. */
  children: React.ReactNode;
  /** What to do instead, where there is anything. */
  instead?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={cn("border-dashed bg-muted/30", className)}>
      <CardContent className="flex items-start gap-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="reading space-y-1 text-sm">
          <p>{children}</p>
          {instead && <p className="text-muted-foreground">{instead}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The one line the whole app uses for the gap behind every agreement figure. Repeated on the
 * dashboard, the reviews queue, and the applications list, so it lives in one place.
 */
export const NO_REVIEWER_SCORES =
  "No reviewer scores are saved yet, so there is nothing to compare.";

/**
 * Stands in for a figure that does not exist, in a table cell or beside a label. A dash reads as
 * a measured blank and a zero reads as a measurement, so neither is used.
 */
export function NotStored({ className }: { className?: string }) {
  return (
    <span
      className={cn("text-xs text-muted-foreground", className)}
      title="This figure is not saved anywhere yet."
    >
      Not saved
    </span>
  );
}
