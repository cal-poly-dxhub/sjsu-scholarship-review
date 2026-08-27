import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/sjsu/components/ui/table";
import {
  CohortPicker,
  cohortKey,
  useCohorts,
  type Cohort,
  type CohortChoice,
} from "@/features/cohorts/cohort-picker";
import { isAcademicYear } from "@/lib/academic-year";
import { reportSummary, type ReportResponse } from "./ingest-report";

/** Only the parts these panels use. The reply carries more; the screens have no use for it. */
interface UploadTicket {
  url: string;
  /** The cohort year read out of the file's name. */
  year: string;
  /** Where the file landed. The ingest's report is stored under it. */
  key: string;
}

// How often the cohort list is re-read while an export is being read in.
const POLL_MS = 5000;

// Ten minutes, the ingest worker's own timeout. Past it there is nothing left to wait for.
const MAX_POLLS = 120;

// What ingest reads. `accept` only steers the file dialog — anyone can pick "All files" — so the
// same two are checked here, or a .pdf would upload cleanly and then be ignored in silence.
const SUFFIXES = [".xlsx", ".csv"];

/**
 * Pick an export and send it straight to the uploads prefix. Nothing has to be chosen first: the
 * file's name carries the year and its rows carry the scholarship, so this is where a cohort comes
 * from rather than something that needs one. The upload starts ingest and nothing else — no
 * scoring follows from a file landing.
 */
export function UploadPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [polls, setPolls] = useState(0);
  // Every cohort's last ingest stamp as it stood before the upload. Comparing against this needs
  // no clock of our own, which a browser's and Lambda's would not agree on anyway.
  const before = useRef(new Map<string, string>());

  const cohorts = useCohorts({ refetchInterval: watching ? POLL_MS : false });
  const list = cohorts.data?.cohorts ?? [];

  const send = useMutation({
    mutationFn: async (picked: File) => {
      const ticket = await api<UploadTicket>("/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: picked.name }),
      });
      // Straight from the browser to the bucket, so a few thousand rows never go through a
      // Lambda's request body.
      const put = await fetch(ticket.url, { method: "PUT", body: picked });
      if (!put.ok) throw new Error(`The upload was refused: ${put.status} ${put.statusText}`);
      return ticket;
    },
    onSuccess: () => {
      before.current = new Map(
        list.map((cohort) => [cohortKey(cohort), cohort.last_ingest_at ?? ""]),
      );
      setPolls(0);
      setWatching(true);
    },
  });

  // Only meaningful once there is a baseline, which is taken when an upload goes through.
  const landed = send.isSuccess
    ? list.filter((cohort) => changedSince(before.current, cohort))
    : [];

  useEffect(() => {
    if (!watching) return;
    const done = (cohorts.data?.cohorts ?? []).some((cohort) =>
      changedSince(before.current, cohort),
    );
    if (done) {
      setWatching(false);
      return;
    }
    setPolls((seen) => seen + 1);
  }, [watching, cohorts.dataUpdatedAt]);

  useEffect(() => {
    if (polls >= MAX_POLLS) setWatching(false);
  }, [polls]);

  function choose(picked: File | null) {
    if (picked && !SUFFIXES.some((suffix) => picked.name.toLowerCase().endsWith(suffix))) {
      setFile(null);
      setRefused(`${picked.name} is not an .xlsx or a .csv, so it cannot be read.`);
      return;
    }
    setFile(picked);
    setRefused(null);
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Upload an export</h2>
          <p className="reading text-sm text-muted-foreground">
            Start here. The file itself says where it belongs: the year comes from its name, the
            scholarship from every row. Uploading does not score anything — scoring is a button
            below.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Export (.xlsx or .csv)</Label>
            <Input
              className="mt-1"
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
          </div>
          <Button disabled={!file || send.isPending} onClick={() => file && send.mutate(file)}>
            {send.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>

        {refused && <p className="text-sm text-warning">{refused}</p>}

        {send.isError && (
          <p className="text-sm text-warning">
            {send.error instanceof Error ? send.error.message : "The upload failed"}
          </p>
        )}

        {send.data && (
          <p className="reading text-sm">
            {file?.name} is uploaded. Its name says {send.data.year}, so its rows go to that year.
            Nothing is scored until someone starts a run.
          </p>
        )}

        {landed.length > 0 && (
          <p className="text-sm">
            Finished reading{" "}
            {landed.map((cohort) => `${cohort.display_name} ${cohort.year}`).join(", ")}. Pick it
            below.
          </p>
        )}

        {watching && landed.length === 0 && (
          <p className="reading text-sm text-muted-foreground">
            Reading the export. A few thousand rows takes a couple of minutes, and nothing shows
            here until every row is in.
          </p>
        )}

        {!watching && polls >= MAX_POLLS && landed.length === 0 && (
          <p className="text-sm text-warning">
            Nothing has arrived in ten minutes, which is as long as reading an export can take.
            Try the upload again, and say something if it keeps happening.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Whether this cohort's ingest stamp moved. A cohort absent from the map is a new one. */
function changedSince(before: Map<string, string>, cohort: Cohort): boolean {
  return before.get(cohortKey(cohort)) !== (cohort.last_ingest_at ?? "");
}

// How often the panel asks whether the file has been read. Reviewer-score files are small next to
// an export, so this is a shorter wait than the export panel's.
const REPORT_POLL_MS = 3000;

// Two minutes of asking. A reviewer-score file that has not been read by then is not going to be.
const REPORT_MAX_POLLS = 40;

/**
 * Upload a file of reviewers' scores into a cohort somebody picks.
 *
 * The cohort is picked because the office's file says neither the scholarship nor the year — it
 * carries applicant identifiers and a column per chair, and nothing else. The rows are matched to
 * applications already in that cohort, so the cohort's export has to be in first.
 *
 * Nothing is scored and nothing is signed off. What the scores are used for is the review queue:
 * an application whose reviewer total is far enough from the model's needs a second look.
 */
export function ReviewerScoresPanel() {
  const [chosen, setChosen] = useState<CohortChoice>({ scholarship: "", year: "" });
  const [file, setFile] = useState<File | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

  const ready = chosen.scholarship !== "" && isAcademicYear(chosen.year);

  const send = useMutation({
    mutationFn: async (picked: File) => {
      const ticket = await api<UploadTicket>("/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "reviewer-scores",
          filename: picked.name,
          scholarship: chosen.scholarship,
          year: chosen.year,
        }),
      });
      const put = await fetch(ticket.url, { method: "PUT", body: picked });
      if (!put.ok) throw new Error(`The upload was refused: ${put.status} ${put.statusText}`);
      return ticket;
    },
    onSuccess: (ticket) => {
      setKey(ticket.key);
      setPolls(0);
    },
  });

  // The uploader is not in the request that reads the file, so the report is asked for by the key
  // the ticket named. A 404 means it has not been read yet, which the wrapper raises as an error —
  // so a failed poll here is a wait, not a fault.
  const report = useQuery({
    queryKey: ["upload-report", key],
    queryFn: () => api<ReportResponse>(`/upload-report?key=${encodeURIComponent(key ?? "")}`),
    enabled: key !== null && polls < REPORT_MAX_POLLS,
    refetchInterval: REPORT_POLL_MS,
    retry: false,
  });

  const found = report.data?.report;

  useEffect(() => {
    if (key === null || found) return;
    setPolls((seen) => seen + 1);
  }, [key, found, report.dataUpdatedAt, report.errorUpdatedAt]);

  function choose(picked: File | null) {
    if (picked && !SUFFIXES.some((suffix) => picked.name.toLowerCase().endsWith(suffix))) {
      setFile(null);
      setRefused(`${picked.name} is not an .xlsx or a .csv, so it cannot be read.`);
      return;
    }
    setFile(picked);
    setRefused(null);
    setKey(null);
  }

  const rejected = found?.rejected_rows ?? [];
  const rejectedTotal = found?.rejected_total ?? rejected.length;
  const waiting = key !== null && !found && polls < REPORT_MAX_POLLS;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Upload reviewers' scores</h2>
          <p className="reading text-sm text-muted-foreground">
            Pick the cohort these scores belong to — the file does not say. Its rows are matched to
            applications already in that cohort, so upload the cohort's export first. Nothing is
            scored and nothing is signed off: the scores are used to show which applications a
            reviewer and the model disagree about.
          </p>
        </div>

        <CohortPicker value={chosen} onChange={setChosen} />

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">
              Reviewer scores (.xlsx or .csv)
            </Label>
            <Input
              className="mt-1"
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            disabled={!file || !ready || send.isPending}
            onClick={() => file && send.mutate(file)}
          >
            {send.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>

        {!ready && (
          <p className="text-sm text-muted-foreground">
            Pick a cohort above before uploading, or the scores have nowhere to go.
          </p>
        )}

        {refused && <p className="text-sm text-warning">{refused}</p>}

        {send.isError && (
          <p className="text-sm text-warning">
            {send.error instanceof Error ? send.error.message : "The upload failed"}
          </p>
        )}

        {waiting && (
          <p className="reading text-sm text-muted-foreground">
            Reading {file?.name}. This takes a few seconds — the rows are matched to the cohort one
            at a time.
          </p>
        )}

        {key !== null && !found && polls >= REPORT_MAX_POLLS && (
          <p className="text-sm text-warning">
            The file has been sitting unread for two minutes. Try the upload again, and say
            something if it keeps happening.
          </p>
        )}

        {found && (
          <div className="space-y-3">
            <p className="reading text-sm">{reportSummary(found)}</p>

            {rejectedTotal > 0 && (
              <>
                <p className="text-sm font-medium">
                  {rejectedTotal} rows could not be placed
                  {rejected.length < rejectedTotal
                    ? `, and the first ${rejected.length} are listed here`
                    : ""}
                  . Their scores were not stored.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejected.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell className="tabular-nums">{row.row}</TableCell>
                        <TableCell className="whitespace-normal">
                          {row.reason}
                          {row.kept_row !== undefined && ` The scores in row ${row.kept_row} were kept.`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
