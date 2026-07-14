import * as React from "react"

import { cn } from "@/sjsu/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  // TODO(will): bg flipped muted -> background until we decide if the theme wants filled-by-default.
  // focus-visible:bg-background kept as a no-op so the revert is clean.
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-xl border border-border bg-background px-2.5 py-1 text-base text-foreground transition-colors outline-none focus-visible:bg-background file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
