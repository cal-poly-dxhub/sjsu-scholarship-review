import type { ReactNode } from "react";
import { EmptyStateOverlay } from "@/sjsu/components/empty-state";

// cascade order: loading → null, then error → empty → filterEmpty.
// returns null when nothing applies so callers can drop it straight into <EmptyState overlay={...}>.
export type EmptyOverlayContent = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action?: ReactNode;
};

export function TableEmptyOverlay({
  isLoading,
  isError,
  unfilteredCount,
  showFilterEmpty,
  error,
  empty,
  filterEmpty,
}: {
  isLoading: boolean;
  isError: boolean;
  unfilteredCount: number;
  showFilterEmpty: boolean;
  error: EmptyOverlayContent;
  empty: EmptyOverlayContent;
  filterEmpty: EmptyOverlayContent;
}) {
  if (isLoading) return null;
  if (isError) return <EmptyStateOverlay {...error} />;
  if (unfilteredCount === 0) return <EmptyStateOverlay {...empty} />;
  if (showFilterEmpty) return <EmptyStateOverlay {...filterEmpty} />;
  return null;
}
