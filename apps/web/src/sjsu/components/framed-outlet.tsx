import type { ReactNode } from "react";
import { AsciiDots } from "@/sjsu/components/ascii-dots";
import { FrameCross } from "@/sjsu/components/icons/frame-cross";

// marketing "framed page" look, moved inside the outlet. a centered column
// with border-x frame lines, corner crosses, and animated ascii-dot gutters
// filling the gap between the outlet edge and the content. gutters collapse to
// 0 when the outlet is narrower than the content column.
const gutter =
  "pointer-events-none absolute inset-y-0 z-0 w-[max(0px,calc(50%-32rem))] overflow-hidden";

export function FramedOutlet({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full">
      <div className={`${gutter} left-0`}>
        <AsciiDots textColor="23, 121, 186" className="block size-full" />
      </div>
      <div className={`${gutter} right-0`}>
        <AsciiDots textColor="23, 121, 186" className="block size-full" />
      </div>

      {/* frame + crosses stay pinned; only the inner div scrolls */}
      <div className="relative z-[1] mx-auto flex h-full w-full max-w-5xl flex-col border-x bg-background">
        <FrameCross className="-left-[11px] -top-[11px]" />
        <FrameCross className="-right-[11px] -top-[11px]" />
        <FrameCross className="-left-[11px] -bottom-[11px]" />
        <FrameCross className="-right-[11px] -bottom-[11px]" />
        <div className="flex-1 overflow-auto overscroll-none px-8 py-10">{children}</div>
      </div>
    </div>
  );
}
