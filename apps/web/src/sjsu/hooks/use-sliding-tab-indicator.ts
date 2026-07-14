import { useLayoutEffect, useRef, useState, type DependencyList } from "react";

// Sliding-bar indicator for Radix Tabs. Attach the returned `ref` to a
// wrapper around <Tabs>, render an absolutely-positioned <span> inside
// TabsList using `bar.left` and `bar.width`, and pass anything that
// should retrigger measurement (the active value, list length, count
// badges, etc.) in `deps`.
//
// Why querySelector instead of a refs map? Tabs are often rendered from
// .map() (folder tabs, status tabs), so a single dom query against
// data-state is simpler than threading per-trigger refs.
export function useSlidingTabIndicator<T extends HTMLElement = HTMLDivElement>(
  deps: DependencyList,
) {
  const ref = useRef<T>(null);
  const [bar, setBar] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const list = ref.current?.querySelector<HTMLElement>(
      '[data-slot="tabs-list"]',
    );
    const active = list?.querySelector<HTMLElement>('[data-state="active"]');
    if (!active) return;
    setBar({ left: active.offsetLeft, width: active.offsetWidth });
    // deps is the caller's contract - they know what should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, bar };
}
