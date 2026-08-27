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

/** Which of the four states the table is in, which decides whether there is a message at all. */
export interface TableState {
  isLoading: boolean;
  isError: boolean;
  unfilteredCount: number;
  showFilterEmpty: boolean;
}

/**
 * Whether this state has a message. A caller needs to know before it renders: the fade behind a
 * message would otherwise wash out a table that is perfectly readable.
 */
export function hasEmptyMessage(state: TableState): boolean {
  if (state.isLoading) return false;
  return state.isError || state.unfilteredCount === 0 || state.showFilterEmpty;
}

export function TableEmptyOverlay(
  props: TableState & {
    error: EmptyOverlayContent;
    empty: EmptyOverlayContent;
    filterEmpty: EmptyOverlayContent;
  },
) {
  if (!hasEmptyMessage(props)) return null;
  if (props.isError) return <EmptyStateOverlay {...props.error} />;
  if (props.unfilteredCount === 0) return <EmptyStateOverlay {...props.empty} />;
  return <EmptyStateOverlay {...props.filterEmpty} />;
}
