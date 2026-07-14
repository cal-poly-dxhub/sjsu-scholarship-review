import type { ReactNode } from "react";
import { cn } from "@/sjsu/lib/utils";

/*
 * Page width + padding presets for app pages.
 *
 *   <PageContainer>...</PageContainer>             // default 896px
 *   <PageContainer width="wide">...</PageContainer> // 1152px
 *   <PageContainer padding="tight">...</PageContainer>
 *
 * One source of truth - change a preset here and every page updates.
 */
const WIDTH_PRESETS = {
  narrow: "max-w-3xl",          // 768px
  default: "max-w-4xl",         // 896px
  wide: "max-w-6xl",            // 1152px
  full: "max-w-screen-2xl",     // 1536px
} as const;

const PADDING_PRESETS = {
  tight: "px-4 py-4",
  default: "px-6 py-8",
  roomy: "px-8 py-12",
} as const;

export function PageContainer({
  width = "default",
  padding = "default",
  className,
  children,
}: {
  width?: keyof typeof WIDTH_PRESETS;
  padding?: keyof typeof PADDING_PRESETS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full", WIDTH_PRESETS[width], PADDING_PRESETS[padding], className)}>
      {children}
    </div>
  );
}
