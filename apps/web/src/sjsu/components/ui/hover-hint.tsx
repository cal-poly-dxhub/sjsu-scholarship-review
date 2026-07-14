import { type ReactElement, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/sjsu/components/ui/tooltip";

/*
 * Truncate-reveal tooltip wrapper. Wraps a single child trigger element
 * with a top-side Tooltip showing `label`. `disabled` skips the wrapper
 * entirely (used when the cell is empty, in edit mode, or when the
 * display value already matches the full value with nothing to reveal).
 *
 * `children` must be a single DOM-accepting element - asChild forwards
 * refs/props through to it.
 *
 * Callers need a <TooltipProvider> somewhere up the tree. folders-table
 * + result.tsx both wrap their roots in their own providers so
 * they can set per-surface delayDuration.
 */
export function HoverHint({
  label,
  contentClassName,
  disabled,
  children,
}: {
  label: ReactNode;
  contentClassName?: string;
  disabled?: boolean;
  children: ReactElement;
}) {
  if (disabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className={contentClassName}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
