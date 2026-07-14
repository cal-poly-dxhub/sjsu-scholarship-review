// Shared style tokens for menu-like dropdowns (DropdownMenu, Select, ContextMenu).
// Edit here to update all menus at once.

// floating panel (the popover that opens)
export const menuContentStyles =
  "z-50 min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl border border-border bg-background p-1 text-foreground duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"

// default item row
export const menuItemStyles =
  "relative flex cursor-default items-center gap-1.5 rounded-xl px-1.5 py-1 text-sm [[data-size=sm]_&]:text-xs outline-hidden select-none focus:bg-muted focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [[data-size=sm]_&_svg:not([class*='size-'])]:size-3"

// item with a checkmark indicator (checkbox/radio/select) - extra right padding for the icon
export const menuCheckableItemStyles =
  "relative flex cursor-default items-center gap-1.5 rounded-xl py-1 pr-8 pl-1.5 text-sm [[data-size=sm]_&]:text-xs outline-hidden select-none focus:bg-muted focus:text-foreground focus:**:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [[data-size=sm]_&_svg:not([class*='size-'])]:size-3"

// section label
export const menuLabelStyles =
  "px-1.5 py-1 text-xs [[data-size=sm]_&]:text-[10px] font-medium text-muted-foreground"

// horizontal divider
export const menuSeparatorStyles = "-mx-1 my-1 h-px bg-accent"
