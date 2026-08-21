import type { ReactNode } from "react";

/**
 * The scrolling area a page renders into. It fills the window.
 *
 * A page gets the whole width. Holding a line of text or a bar chart to a width
 * someone can read is the job of the thing being read, not of this frame — see
 * the `reading` utility in `index.css` and the share of the card a bar group takes.
 *
 * @param bleed - the page paints to the edges and does its own padding, for a
 *   split view whose panes have to reach the sides.
 */
export function PageOutlet({ children, bleed }: { children: ReactNode; bleed?: boolean }) {
  if (bleed) return <div className="h-full w-full overflow-hidden">{children}</div>;
  // The gutter is a share of the window, so it opens up on a wide monitor and closes
  // to about 15px on a phone. A fixed gutter leaves a 1920 screen looking boxed in
  // and a 375 one with nothing left for the content.
  return (
    <div className="h-full overflow-auto overscroll-none px-[4vw] py-6 sm:py-10">
      {children}
    </div>
  );
}
