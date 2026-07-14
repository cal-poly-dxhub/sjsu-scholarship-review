import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/sjsu/lib/utils"

const filledVariants = new Set(["default", "amazon", "destructive", "success", "warning", "salesRank", "fba", "fbm", "secondary"])

const badgeVariants = cva(
  "group/badge relative inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:size-3! **:!text-inherit",
  {
    variants: {
      variant: {
        default:
          // dark mode flips the fill to white, so the generic white inset line
          // vanishes - swap it for a faint dark line to keep the edge readable.
          "border-transparent bg-primary !text-primary-foreground dark:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]",
        // amazon = the OG brand orange, frozen via --amazon. used for
        // link/action badges (Amazon/Google/Shopping) that stay orange
        // even though --primary is now slate.
        amazon:
          "border-amazon-border bg-amazon !text-white",
        destructive:
          "border-destructive-border bg-destructive !text-white",
        success:
          "border-success-border bg-success !text-white",
        warning:
          "border-warning-border bg-warning !text-black",
        salesRank:
          "border-sales-rank-border bg-sales-rank !text-white",
        // FBA = solid green w/ white text, tone-matched to salesRank's
        // recipe (saturated bg, ~10% darker border). FBM = solid yellow
        // w/ black text, tone-matched to warning's recipe. Both go into
        // `filledVariants` above so they pick up the inset white highlight
        // that all solid-saturated badges use.
        fba:
          "border-fba-border bg-fba !text-white",
        fbm:
          "border-fbm-border bg-fbm !text-black",
        // light: keep the grey border + white inset gloss. dark: drop the border,
        // the white inset (from filledVariants) carries the edge on the dark fill.
        secondary:
          "border-border dark:border-transparent bg-secondary text-secondary-foreground",
        outline:
          "border-border bg-transparent text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "border-transparent hover:bg-muted hover:text-muted-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// interactive hover, keyed per variant: each darkens within its OWN family so it
// never jumps tone (filled variants → their matching -border token, the same
// recipe their border uses; outline/ghost → muted; link → underline). a Record
// over the variant union means adding a cva variant without a hover fails the
// build, so this can't silently fall back to an off-tone color again.
const INTERACTIVE_HOVER: Record<NonNullable<VariantProps<typeof badgeVariants>["variant"]>, string> = {
  default: "hover:bg-primary/90",
  amazon: "hover:bg-amazon-border",
  destructive: "hover:bg-destructive-border",
  success: "hover:bg-success-border",
  warning: "hover:bg-warning-border",
  salesRank: "hover:bg-sales-rank-border",
  fba: "hover:bg-fba-border",
  fbm: "hover:bg-fbm-border",
  secondary: "hover:bg-muted",
  outline: "hover:bg-muted hover:text-muted-foreground",
  ghost: "hover:bg-muted hover:text-muted-foreground",
  link: "hover:underline",
}

// color block: neutral secondary chrome + a 12px color chip that carries the
// variant's fill instead of the whole badge (a card
// attribute-badge pattern). same recipe as each variant's solid fill so the
// chip reads as a mini version of that badge. outline/ghost/link have no fill
// to shrink, so their chip stays a neutral empty box.
const COLOR_BLOCK_FILL: Record<NonNullable<VariantProps<typeof badgeVariants>["variant"]>, string> = {
  default: "border-transparent bg-primary",
  amazon: "border-amazon-border bg-amazon",
  destructive: "border-destructive-border bg-destructive",
  success: "border-success-border bg-success",
  warning: "border-warning-border bg-warning",
  salesRank: "border-sales-rank-border bg-sales-rank",
  fba: "border-fba-border bg-fba",
  fbm: "border-fbm-border bg-fbm",
  secondary: "border-border bg-secondary",
  outline: "border-border bg-transparent",
  ghost: "border-border bg-transparent",
  link: "border-border bg-transparent",
}

function Badge({
  className,
  variant = "default",
  asChild = false,
  interactive = false,
  hasColorBlock = false,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; interactive?: boolean; hasColorBlock?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  // the color block swaps the chrome to secondary - the variant only colors the
  // chip. hover follows the chrome, so interactive ones darken like secondary.
  const chromeVariant = hasColorBlock ? "secondary" : variant
  const isFilled = filledVariants.has(chromeVariant ?? "default")

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      // interactive: opt-in hover for link/action badges. the per-variant
      // INTERACTIVE_HOVER map darkens within the variant's own family so it
      // never jumps tone (see the map above for the full per-variant recipe).
      className={cn(
        badgeVariants({ variant: chromeVariant }),
        // inset white highlight on the element itself so it shares the border's
        // corner radius - a child overlay span rounds at 8px while the border's
        // inner edge is 7px, leaving a fill-color gap at the corners.
        isFilled && "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]",
        interactive && cn("cursor-pointer", INTERACTIVE_HOVER[chromeVariant ?? "default"]),
        className,
      )}
      {...props}
    >
      {/* asChild passes children straight through: Slot needs exactly ONE child,
          and even a false/null sibling slot counts — so the chip branch must not
          exist at all on that path (hasColorBlock + asChild stays unsupported) */}
      {asChild ? (
        children
      ) : (
        <>
          {hasColorBlock && (
            <span aria-hidden className={cn("size-3 shrink-0 rounded-sm border shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]", COLOR_BLOCK_FILL[variant ?? "default"])} />
          )}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Badge, badgeVariants }
