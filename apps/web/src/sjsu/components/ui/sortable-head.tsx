import { type ReactNode } from "react";
import { TableHead } from "@/sjsu/components/ui/table";

export type SortDir = "asc" | "desc";

/*
 * Sortable column header. Wraps <TableHead> with the onSort/sorted/sortDir
 * trio so each header in a table is one line instead of five.
 *
 * Generic over `F` - both multiple tables share this
 * component; the generic forces `field` to be a member of the table's own
 * SortField union.
 *
 * Callers typically bundle the state once:
 *   const sortHead = { sortBy, sortDir, onSort } as const;
 *   <SortableHead field="title" {...sortHead}>Product</SortableHead>
 */
export function SortableHead<F extends string>({
  field,
  sortBy,
  sortDir,
  onSort,
  className,
  children,
}: {
  field: F;
  // Nullable so tables with an "unsorted" state (folders-table) fit too.
  // A caller passes a non-null union; that's a subtype, no change there.
  sortBy: F | null;
  sortDir: SortDir;
  onSort: (field: F) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableHead
      className={className}
      onSort={() => onSort(field)}
      sorted={sortBy === field}
      sortDir={sortDir}
    >
      {children}
    </TableHead>
  );
}
