import type { ReactNode } from "react";
import { cn } from "@/sjsu/lib/utils";

/*
 * Two pieces:
 *   <EmptyState>      - wrapper that fades the children behind a vertical
 *                       gradient and centers an optional overlay on top.
 *   <EmptyStateOverlay> - the icon/title/subtitle/action stack.
 */
// which token the fade melts into. default "background" matches the collapsible
// panels (their body is bg-background); "card" is for plain Card surfaces like
// the product header card (bg-card), where fading to background leaves a seam.
const FADE = {
  background: "via-background/95 to-background",
  card: "via-card/95 to-card",
} as const;

export function EmptyState({
  children,
  overlay,
  minHeight = 200,
  className,
  surface = "background",
}: {
  children: ReactNode;
  overlay?: ReactNode;
  minHeight?: number;
  className?: string;
  surface?: keyof typeof FADE;
}) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-xl", className)}
      style={{ minHeight }}
    >
      {children}
      {/* No overlay means the children speak for themselves, so nothing goes over them: a fade
          over readable rows only washes them out, and the layer would swallow their clicks. Where
          there is an overlay, the layer still takes no pointer events so whatever sits inside it
          can take them back. */}
      {overlay && (
        <>
          <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent", FADE[surface])} />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center *:pointer-events-auto">
            {overlay}
          </div>
        </>
      )}
    </div>
  );
}

export function EmptyStateOverlay({
  icon,
  title,
  subtitle,
  action,
  hideIconChrome,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  action?: ReactNode;
  hideIconChrome?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center">
      {hideIconChrome ? (
        <div className="mb-3">{icon}</div>
      ) : (
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="mt-0.5 text-center text-xs text-muted-foreground">{subtitle}</span>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
