import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Logo } from "@/sjsu/components/logo";
import { Button } from "@/sjsu/components/ui/button";
import { useTheme } from "@/sjsu/lib/theme";
import spartanUrl from "@/assets/sjsu-spartan.png";

/*
 * Header strip: sticky top, h-12, bg-background,
 * logo on far left, children pass through, optional `actions` slot in the right
 * cluster, theme toggle on far right.
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
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-6" style={{ borderBottomColor: 'var(--sjsu-gold)', borderBottomWidth: '2px' }}>
      <span className="flex shrink-0 items-center gap-2 text-foreground">
        <img src={spartanUrl} alt="Spartan" className="h-7 w-7" />
        <Logo />
      </span>
      <div aria-hidden className="h-5 w-px shrink-0" style={{ backgroundColor: 'var(--sjsu-gold)' }} />
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
