import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Logo } from "@/sjsu/components/logo";
import { Button } from "@/sjsu/components/ui/button";
import { useTheme } from "@/sjsu/lib/theme";

/*
 * Header strip - ported from the source app: sticky top, h-12, bg-background,
 * logo on far left, children pass through, optional `actions` slot in the right
 * cluster, theme toggle on far right. Router Link stripped (the app has no routes).
 *
 * Use as: <PageHeader actions={<SomeMenu />}>{...header content...}</PageHeader>
 */
export function PageHeader({
  children,
  actions,
}: {
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-6">
      <span className="flex shrink-0 items-center text-foreground">
        <Logo />
      </span>
      <div aria-hidden className="h-5 w-px shrink-0 bg-border" />
      <div className="flex w-full items-center gap-2">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="shrink-0 text-muted-foreground"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  );
}
