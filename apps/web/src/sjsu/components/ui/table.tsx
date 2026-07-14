"use client"

import * as React from "react"
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"

import { cn } from "@/sjsu/lib/utils"

function Table({
  className,
  containerClassName,
  zebra = false,
  dividers = false,
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string
  // zebra: stripe odd body rows. dividers: vertical line between columns.
  // both off by default so existing tables render unchanged.
  zebra?: boolean
  dividers?: boolean
}) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto overscroll-x-none rounded-xl border border-border",
        containerClassName,
      )}
    >
      <table
        data-slot="table"
        className={cn(
          "w-full table-fixed caption-bottom text-sm",
          zebra && "[&_tbody_tr:nth-child(odd)]:bg-muted/40",
          dividers && "[&_td:not(:first-child)]:border-l [&_th:not(:first-child)]:border-l [&_td]:border-border [&_th]:border-border",
          className,
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("border-b border-border bg-muted", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

// forwardRef so this works as a PopoverTrigger asChild target on React 18.
// See `button.tsx` for the same fix + rationale.
const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.ComponentProps<"tr">
>(function TableRow({ className, ...props }, ref) {
  return (
    <tr
      ref={ref}
      data-slot="table-row"
      className={cn(
        "border-b border-border/50 last:border-0 hover:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
})

function TableHead({
  className,
  children,
  onSort,
  sorted,
  sortDir,
  ...props
}: React.ComponentProps<"th"> & {
  onSort?: () => void
  sorted?: boolean
  sortDir?: "asc" | "desc"
}) {
  // When the th is marked text-right, the sort button needs to sit at the
  // right edge of the cell - not just inline-flex (parent's text-align right-
  // floats it), and the hover-extension margin flips from left to right.
  const isRightAligned = className?.includes("text-right")
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-4 text-left align-middle text-sm font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    >
      {onSort ? (
        <button
          onClick={onSort}
          className={cn(
            "group inline-flex items-center gap-1 rounded-xl px-2 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-border",
            isRightAligned ? "-mr-2" : "-ml-2"
          )}
        >
          {children}
          {sorted ? (
            sortDir === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
