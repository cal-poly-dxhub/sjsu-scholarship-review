import type { ReactNode } from "react";
import { Button } from "@/sjsu/components/ui/button";

/**
 * Previous and next over a table, with the page it is on. The applications list and the review
 * queue both use it, so a person moving between the two screens gets the same control.
 *
 * The caller decides whether the bar is worth showing at all — a one-page table usually hides it,
 * but a table that cannot hold a row keeps it and passes a `note` saying so.
 */
export function Paging({
  page,
  showing,
  hasNext,
  onPrevious,
  onNext,
  note,
}: {
  page: number;
  showing: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Replaces the page and count, for a table with nothing to count. */
  note?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {note ?? `Page ${page + 1} · ${showing} applications`}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={onPrevious}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
