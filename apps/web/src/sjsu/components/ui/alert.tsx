import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/sjsu/lib/utils"

// named `iconAlign` (not `align`) to dodge radix's `align` prop on
// popover/dropdown/select/menubar/hovercard.
const alertVariants = cva(
  "group/alert relative grid w-full border text-left has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] *:[svg]:shrink-0 *:[svg]:text-current",
  {
    variants: {
      variant: {
        default:
          "border-border bg-muted text-foreground",
        destructive:
          "border-destructive-border bg-destructive text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]",
      },
      size: {
        sm: "gap-0.5 rounded-xl px-2.5 py-1.5 text-xs has-[>svg]:gap-x-2 *:[svg]:size-3.5",
        default: "gap-0.5 rounded-2xl px-3 py-2.5 text-sm has-[>svg]:gap-x-2.5 *:[svg]:size-5",
        lg: "gap-1 rounded-2xl px-4 py-3.5 text-base has-[>svg]:gap-x-3 *:[svg]:size-6",
      },
      iconAlign: {
        // translate-y nudge optical-aligns icon with first line of title.
        top: "items-start *:[svg]:row-span-2 *:[svg]:translate-y-0.5",
        // use when there's no title.
        center: "items-center",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      iconAlign: "top",
    },
  }
)

function Alert({
  className,
  variant,
  size,
  iconAlign,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? "default"}
      role="alert"
      className={cn(alertVariants({ variant, size, iconAlign }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance opacity-80 md:text-pretty group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
