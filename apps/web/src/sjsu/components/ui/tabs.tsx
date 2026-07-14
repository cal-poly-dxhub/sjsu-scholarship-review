"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/sjsu/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-xl p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  sliding = false,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants> & { sliding?: boolean }) {
  const listRef = React.useRef<HTMLDivElement>(null)
  // null until measured so the pill mounts on the active tab, no animate-in.
  // mirrors the active trigger's box, so it's pixel-identical to the old snap bg.
  const [pillBox, setPillBox] = React.useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  React.useLayoutEffect(() => {
    if (!sliding) return
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]')
      if (!active) return
      setPillBox({
        left: active.offsetLeft,
        top: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
      })
    }
    measure()
    // data-state flips on tab switch; childList/characterData catch triggers or
    // count badges changing width; resize catches the list itself reflowing.
    const mutations = new MutationObserver(measure)
    mutations.observe(list, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      characterData: true,
      subtree: true,
    })
    const resize = new ResizeObserver(measure)
    resize.observe(list)
    return () => {
      mutations.disconnect()
      resize.disconnect()
    }
  }, [sliding])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant={variant}
      data-sliding={sliding ? "true" : undefined}
      className={cn(tabsListVariants({ variant }), sliding && "relative", className)}
      {...props}
    >
      {/* pill sits first so triggers (positioned siblings) paint above it without a
          z-index; rounded-lg mirrors the trigger radius so it reads as the billing pill. */}
      {sliding && pillBox && (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-lg bg-background shadow-sm transition-[left,top,width,height] duration-150 ease-[cubic-bezier(0.2,0,0,1)]"
          style={pillBox}
        />
      )}
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground",
        // when the list slides, the pill is the highlight - drop the per-trigger snap bg/shadow
        "group-data-[sliding=true]/tabs-list:data-active:bg-transparent group-data-[sliding=true]/tabs-list:data-active:shadow-none",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
