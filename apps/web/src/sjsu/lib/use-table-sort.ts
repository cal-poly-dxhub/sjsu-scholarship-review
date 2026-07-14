import { useState } from "react";

export type SortDirection = "asc" | "desc";

/*
 * Tristate sort state for a table column. Clicking a column cycles it
 * through desc → asc → off; clicking a different column jumps to desc on
 * the new one. `sortBy` is nullable for the "off" state.
 *
 * Generic over the column key union - pass it in to get a `setSort` that
 * only accepts valid columns:
 *   const { sortBy, sortDir, setSort } = useTableSort<SortField>();
 *   setSort("title");
 */
export function useTableSort<F extends string>() {
  const [sortBy, setSortBy] = useState<F | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const setSort = (column: F) => {
    if (sortBy !== column) {
      setSortBy(column);
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortBy(null);
    }
  };

  return { sortBy, sortDir, setSort };
}
