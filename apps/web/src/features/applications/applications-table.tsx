import { useMemo, useState } from "react";
import { Input } from "@/sjsu/components/ui/input";
import { Badge } from "@/sjsu/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/sjsu/components/ui/table";
import { SortableHead } from "@/sjsu/components/ui/sortable-head";
import { useTableSort } from "@/sjsu/lib/use-table-sort";

type SortField = "student" | "scholarship" | "year" | "gpa";

type Application = {
  id: string;
  student: string; // anonymized uuid, no PII
  scholarship: string;
  year: string;
  major: string;
  level: string;
  gpa: number | null; // 26-27 SJSU General dropped the GPA column, so it's nullable
  status: "pending" | "scored";
};

// mock rows until the db + ingest land. shape mirrors the xlsx reports in materials/.
const ROWS: Application[] = [
  { id: "1", student: "a1f3…9c2", scholarship: "SJSU Spartan", year: "25-26", major: "Computer Science", level: "Junior", gpa: 3.82, status: "pending" },
  { id: "2", student: "b7e0…1d4", scholarship: "Engineering", year: "25-26", major: "Civil Engineering", level: "Transfer", gpa: 3.41, status: "pending" },
  { id: "3", student: "c2a9…4f8", scholarship: "Physics", year: "25-26", major: "Physics", level: "Senior", gpa: 3.95, status: "pending" },
  { id: "4", student: "d5c1…8b3", scholarship: "Lurie Education", year: "25-26", major: "Child Development", level: "Sophomore", gpa: 3.28, status: "pending" },
  { id: "5", student: "e8b4…2a7", scholarship: "SJSU Spartan", year: "26-27", major: "Business Analytics", level: "Junior", gpa: null, status: "pending" },
  { id: "6", student: "f0d2…7e1", scholarship: "Engineering", year: "26-27", major: "Mechanical Engineering", level: "Frosh", gpa: null, status: "pending" },
  { id: "7", student: "a3e7…5c9", scholarship: "Physics", year: "26-27", major: "Astrophysics", level: "MS", gpa: 3.71, status: "pending" },
  { id: "8", student: "b9f5…0a2", scholarship: "Lurie Education", year: "26-27", major: "Liberal Studies", level: "Senior", gpa: null, status: "pending" },
];

export function ApplicationsTable() {
  const [search, setSearch] = useState("");
  const { sortBy, sortDir, setSort } = useTableSort<SortField>();
  const sortProps = { sortBy, sortDir, onSort: setSort } as const;

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? ROWS.filter((r) =>
          `${r.student} ${r.scholarship} ${r.major}`.toLowerCase().includes(query),
        )
      : ROWS;

    if (!sortBy) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortBy === "gpa") return ((a.gpa ?? -1) - (b.gpa ?? -1)) * dir;
      return String(a[sortBy]).localeCompare(String(b[sortBy])) * dir;
    });
  }, [search, sortBy, sortDir]);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="font-mondwest text-3xl">Applications</h1>
        <Badge variant="secondary">{rows.length}</Badge>
      </div>

      <Input
        placeholder="Search student, major, or scholarship"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="mb-4 max-w-sm"
      />

      <Table>
        <colgroup>
          <col className="w-32" />
          <col className="w-40" />
          <col className="w-20" />
          <col className="w-56" />
          <col className="w-28" />
          <col className="w-20" />
          <col className="w-28" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHead field="student" {...sortProps}>Student</SortableHead>
            <SortableHead field="scholarship" {...sortProps}>Scholarship</SortableHead>
            <SortableHead field="year" {...sortProps}>Year</SortableHead>
            <TableHead>Major</TableHead>
            <TableHead>Level</TableHead>
            <SortableHead field="gpa" {...sortProps}>GPA</SortableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer">
              <TableCell className="font-medium">{row.student}</TableCell>
              <TableCell>{row.scholarship}</TableCell>
              <TableCell>{row.year}</TableCell>
              <TableCell className="truncate text-muted-foreground">{row.major}</TableCell>
              <TableCell className="text-muted-foreground">{row.level}</TableCell>
              <TableCell>{row.gpa ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={row.status === "scored" ? "success" : "secondary"}>
                  {row.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
