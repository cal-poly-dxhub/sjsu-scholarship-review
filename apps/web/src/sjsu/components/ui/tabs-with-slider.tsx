import { type DependencyList, type ReactNode } from "react";
import { Tabs, TabsList } from "@/sjsu/components/ui/tabs";
import { useSlidingTabIndicator } from "@/sjsu/hooks/use-sliding-tab-indicator";
import { cn } from "@/sjsu/lib/utils";

type Variant = "underline" | "pill";

// Per-variant chrome. Underline = thin foreground bar below the list (status
// tabs, folder tabs). Pill = rounded background tile behind the active
// trigger (segmented control for FBA/FBM). Adding a new shape means editing
// these two maps + nothing else.
const listCls: Record<Variant, string> = {
  underline: "relative [&_[data-slot=tabs-trigger]]:after:!hidden",
  pill: "relative h-7 p-0.5",
};
const barCls: Record<Variant, string> = {
  underline:
    "pointer-events-none absolute bottom-[-5px] h-0.5 bg-foreground transition-[left,width] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
  pill: "pointer-events-none absolute top-0.5 bottom-0.5 rounded-[10px] bg-background shadow-sm transition-[left,width] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
};

/*
 * Tabs + TabsList + sliding indicator bar in one. Bundles the wrapper ref,
 * useSlidingTabIndicator measurement, the shadcn-underline-suppress class,
 * and the absolutely-positioned bar so callers only render triggers.
 *
 * `deps` is forwarded to the hook - pass anything that should re-trigger
 * measurement (active value, list length, count badges). Same contract as
 * useEffect deps.
 */
export function TabsWithSlider({
  variant = "underline",
  value,
  onValueChange,
  deps,
  className,
  listClassName,
  children,
}: {
  variant?: Variant;
  value: string;
  onValueChange: (next: string) => void;
  deps: DependencyList;
  className?: string;
  listClassName?: string;
  children: ReactNode;
}) {
  const { ref, bar } = useSlidingTabIndicator(deps);
  return (
    <div ref={ref} className={className}>
      <Tabs value={value} onValueChange={onValueChange}>
        <TabsList
          variant={variant === "underline" ? "line" : undefined}
          className={cn(listCls[variant], listClassName)}
        >
          {children}
          <span
            aria-hidden
            className={barCls[variant]}
            style={{ left: bar.left, width: bar.width }}
          />
        </TabsList>
      </Tabs>
    </div>
  );
}
