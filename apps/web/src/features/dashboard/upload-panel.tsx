import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/api";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";
import { cohortKey, useCohorts, type Cohort } from "@/features/cohorts/cohort-picker";

interface UploadTicket {
  url: string;
  key: string;
  /** The cohort year ingest read out of the file's name. */
  year: string;
  expires_in: number;
  starts: string;
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
      setRefused(`${picked.name} is neither an .xlsx nor a .csv, so ingest would not read it.`);
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
          <p className="text-sm text-muted-foreground">
            Start here. The file lands under <code>uploads/</code>, and ingest files it by what the
            file itself says: the year out of its name, the scholarship out of every row. Nothing
            is scored because an export arrived — that is a run, and a run is a button below.
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
          <p className="text-sm">
            {send.data.key} is up, named for {send.data.year}, so its rows go to that year.{" "}
            {send.data.starts}
          </p>
        )}

        {landed.length > 0 && (
          <p className="text-sm">
            Ingest finished: {landed.map((cohort) => `${cohort.display_name} ${cohort.year}`).join(", ")}.
            Pick it below.
          </p>
        )}

        {watching && landed.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Reading the export. A few thousand rows takes a couple of minutes, and nothing shows
            here until ingest has written the last of them.
          </p>
        )}

        {!watching && polls >= MAX_POLLS && landed.length === 0 && (
          <p className="text-sm text-warning">
            No cohort has reported an ingest in ten minutes, which is as long as the worker can
            run. Check the <code>dev-ingest</code> logs.
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
