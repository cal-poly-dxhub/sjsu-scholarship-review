import { cn } from "@/sjsu/lib/utils";
import logoUrl from "@/assets/sjsu-logo.svg";

// app wordmark — the SJSU logo. blue in light mode, flipped to white in dark.
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="SJSU Review"
      className={cn("h-6 w-auto dark:brightness-0 dark:invert", className)}
    />
  );
}
