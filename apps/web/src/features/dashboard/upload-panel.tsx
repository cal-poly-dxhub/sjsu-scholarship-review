import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Button } from "@/sjsu/components/ui/button";
import { Card, CardContent } from "@/sjsu/components/ui/card";
import { Input } from "@/sjsu/components/ui/input";
import { Label } from "@/sjsu/components/ui/label";

interface UploadTicket {
  url: string;
  key: string;
  expires_in: number;
  starts: string;
}

interface CohortCounts {
  total: number;
}

// How often the cohort is re-read while a workbook is being read in. Ingest writes rows as it
// goes, so the number climbs.
const POLL_MS = 5000;

// Two reads with the same total is where the climbing stops. Nothing tells the browser that
// ingest finished — there is no run record.
const STEADY_POLLS = 2;

/**
 * Pick a workbook, send it straight to the uploads prefix, and watch the rows arrive. The upload
 * starts ingest and nothing else — no scoring follows from a file landing.
 */
export function UploadPanel({ scholarship, year }: { scholarship: string; year: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  const steady = useRef({ total: -1, seen: 0 });

  const cohortQuery = useQuery({
    queryKey: ["cohort", scholarship, year],
    queryFn: () =>
      api<CohortCounts>(
        `/cohort?scholarship=${encodeURIComponent(scholarship)}&year=${encodeURIComponent(year)}`,
      ),
    enabled: scholarship !== "" && year !== "",
    refetchInterval: watching ? POLL_MS : false,
  });

  const total = cohortQuery.data?.total ?? null;

  const send = useMutation({
    mutationFn: async (workbook: File) => {
      const ticket = await api<UploadTicket>("/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: workbook.name }),
      });
      // Straight from the browser to the bucket, so a few thousand rows never go through a
      // Lambda's request body.
      const put = await fetch(ticket.url, { method: "PUT", body: workbook });
      if (!put.ok) throw new Error(`The upload was refused: ${put.status} ${put.statusText}`);
      return ticket;
    },
    onSuccess: () => {
      setBaseline(total ?? 0);
      steady.current = { total: -1, seen: 0 };
      setWatching(true);
    },
  });

  useEffect(() => {
    if (!watching || total === null) return;
    if (total === steady.current.total) {
      steady.current.seen += 1;
      if (steady.current.seen >= STEADY_POLLS) setWatching(false);
      return;
    }
    steady.current = { total, seen: 0 };
  }, [watching, total]);

  const arrived = baseline === null || total === null ? null : total - baseline;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Upload a workbook</h2>
          <p className="text-sm text-muted-foreground">
            The file lands under <code>uploads/</code> and ingest reads it into{" "}
            {scholarship || "a scholarship"} {year}. Nothing is scored because a workbook
            arrived — that is a run, and a run is a button below.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Workbook (.xlsx)</Label>
            <Input
              className="mt-1"
              type="file"
              accept=".xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            disabled={!file || scholarship === "" || year === "" || send.isPending}
            onClick={() => file && send.mutate(file)}
          >
            {send.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>

        {send.isError && (
          <p className="text-sm text-warning">
            {send.error instanceof Error ? send.error.message : "The upload failed"}
          </p>
        )}

        {send.data && (
          <p className="text-sm">
            {send.data.key} is up. {send.data.starts}
          </p>
        )}

        {arrived !== null && (
          <p className="text-sm">
            {watching
              ? `Reading the workbook — ${arrived} rows in ${scholarship} ${year} so far.`
              : `${arrived} rows came in. ${total} applications in ${scholarship} ${year}.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
