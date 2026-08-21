## Context

See `proposal.md` for why, and for what the delivered file actually contains — the column shapes,
the `Candidate` identifier, and the counts are all measured there and not repeated here.

What shapes this design:

- **The file names no applicant uuid and no cohort.** It names applicants by `Candidate`, the last 12
  hex characters of the intake export's `Student` uuid, uppercased. So a reviewer-score row cannot be
  turned into a key on its own — something has to resolve the tail — and the cohort has to come from
  outside the file.
- **The reads are all keyed today.** `shared/reads.py` addresses one cohort by scholarship and year,
  and one ranked page by scholarship, year, and rubric version. Nothing scans. The queue is
  cross-cohort and ordered by a number that does not exist yet, so it needs somewhere to be ordered.
- **Ingest is asynchronous.** S3 `Object Created` starts the worker after the browser's PUT returns,
  so the request that uploaded is long gone. The only existing way a screen learns an ingest finished
  is `upload-panel.tsx` polling `/cohorts` and comparing `last_ingest_at`, which reports completion
  but carries nothing row-level.
- **One route is one Lambda** in `compute-stack.ts`. Ten routes, ten handlers.
- **The rubric's weights are per published version**, typed at publish time, not hardcoded.

## Goals / Non-Goals

**Goals**

- One upload path for both kinds of file, so there is one presigner and one filename check.
- One row reader for both kinds of file, so a CSV quirk fixed for one is fixed for both.
- A reviewer's total produced by the same function that produces the model's.
- The queue and the reliability figures readable without a scan, and correct after a re-upload.
- Every row the ingest could not place is visible to the person who uploaded.

**Non-Goals**

- Reverse-engineering `Weighted Points`. It is measured as not reproducible and is not stored.
- Making the disagreement line correct. It cannot be fitted yet; see Decisions.
- Any use of `Soft Match`. Read past, not stored — nothing here depends on it and inventing a rule
  from a column nobody explained would be a guess.
- Reviewer-against-reviewer figures, per the proposal. The data for them is stored; the reads are not.

## Decisions

### The cohort travels in the object key, not the filename

The reviewer-score object goes to `reviewer-scores/<scholarship>/<year>/<filename>`. The handler
builds that key from the cohort the person picked, and the worker splits the cohort back out of the
key it was handed.

*Why.* The file names neither the scholarship nor the academic year. `year_in_filename` does read
`2025-2026` out of the delivered filename, but the scholarship would have to be scraped out of the
same string, and the office renames these files freely — the delivered one is
`SJSU General Scholarships 26-27 scores(ScholarshipManagerData - 2026-0).csv`. The dashboard already
knows the cohort, because a picker is right there.

*Alternative rejected.* Parse both out of the filename, the way the export ingest gets its year. It
works until somebody renames a file, and then it silently writes reviewer scores into the wrong
cohort — where every row would fail to match, which is at least loud. Still not worth it: the cohort
is free to carry and guessing it is not.

*Alternative rejected.* S3 object metadata on the presigned PUT. It works, but the browser has to
send the exact `x-amz-meta-*` headers that were signed, and a mismatch fails the PUT with a signature
error that says nothing about cohorts. The key is visible in the event either way.

### `kind` on the existing upload route, not a second route

`POST /api/upload` takes `kind: "export" | "reviewer-scores"` and picks the prefix from it. `kind`
being absent means `export`, so nothing that calls it today changes.

*Why.* Everything else about the two is identical: the same suffix rule, the same `NAME` check, the
same SigV4 presigner, the same 900 seconds. A second route would be that file copied with one
constant changed. `kind` is checked against a small map, so an unknown kind is a 400 rather than a
path built from user input.

### The row reader moves to `shared/`, and `ingest.py` imports it

`read_rows`, `workbook_rows`, `csv_rows`, `decode`, `cell`, and `number_or_none` move out of
`workers/ingest.py` into `shared/rows.py`. `read_rows` takes the column names to check the header
against, since that is the only part that differed. `workers/ingest.py` keeps its `COLUMNS`, `ESSAYS`,
`collect`, `store`, `content_hash`, and `remember_cohort` — the export-specific half.

*Why.* The cp1252 fallback, the BOM handling, and `newline=""` are each a bug someone already paid
for. A copy in a second worker is a copy that will drift.

### `Candidate` is resolved through the cohort, and never guessed

The worker reads the picked cohort with `reads.cohort()` and builds a map from
`student_uuid[-12:].upper()` to the application, then resolves each row's `Candidate` through it. A
row whose id is not in the map is rejected with its row number and the id as it appeared.

*Why this is safe.* The tail is unique across all 1,903 applicants in the delivered 25-26 cohort —
zero collisions — so a tail names at most one application. The worker refuses to write a row it
cannot resolve exactly, which is what turns the 17 Excel-damaged ids into a report line rather than a
silently misplaced score. Building the map costs one paged cohort query, which is a read the screens
already do.

*Alternative rejected.* Store the tail on the application at export-ingest time and query it. It
saves the cohort read but adds a field and a write to the export path for one consumer's benefit, and
the cohort read is cheap.

*Alternative rejected.* Match by row order against the intake export. The delivered 25-26 pair does
have equal row counts (1,903 and 1,903), which is what makes it tempting. It is still a positional
join between two separately generated files with no key, wrong silently if either is ever sorted or
filtered, and undetectable when it is wrong.

### Keys

Alongside `APP#` and `SCORE#`, under the application's own partition
(`application_pk(scholarship, year, student)`, which `SCORE#` already uses):

- `REVIEW#<reviewer_slug>` — one reviewer's per-criterion scores for that application, their display
  name as written, their total, and the rubric version whose weights made it.

The reviewer slug is `shared.rubric.slug()` over the whitespace-collapsed name, which folds
`Julian  Vogel` and `Julian Vogel` into one reviewer. That is a real case in the delivered file.

On the application item itself: `reviewer_total`, `reviewer_count`, `score_gap`, and `gap_pk`.
`gap_pk` is a constant partition (`GAP`) written only when the application is flagged, with the gap
as the sort key, and removed when it is not.

*Why a separate item per reviewer.* The file gives per-reviewer scores and 2,675 rows have two of
them. Storing only the mean throws away the only data that could ever answer reviewer-against-reviewer,
for no gain — and re-ingesting a corrected file has to be able to replace one reviewer's scores without
touching the other's.

*Why the flag gets its own index.* The queue is one keyed query — `gap_pk = GAP`, read backwards for
widest first — and `encode_cursor`/`decode_cursor` page it unchanged. It cannot share the existing
`rank-by-total` index: that index sorts on `total_score`, an index has exactly one sort key, and
ordering by the gap is not ordering by the total. So `gap-by-size` is a second GSI, partitioned on
`gap_pk` and sorted on `score_gap`. Both are written only when there is something to write, so both
are sparse; `gap-by-size` holds the flagged applications and nothing else.

### The reviewer's total is recomputed, and a version mismatch means no gap

`weighted_total()` produces the reviewer's total from their per-criterion scores and the criteria of
the rubric version that produced the application's model score. `Weighted Points` is read past.

*Why.* Fitted against the criterion averages, `Weighted Points` comes out at roughly 40/29/10/11/10
out of 100 and reproduces only 1,389 of 1,898 rows exactly, one of them out by 38 points. Whatever it
is, it is not the number the model's total is on. `human-in-the-loop`'s "The weights live in one place
and every total comes from the per-criterion scores" already demands the recompute; the measurement
just removes the temptation.

If the application has no model score, or its `rubric_version` has no stored criteria, the reviewer's
scores are stored and no total and no gap are written. A reviewer who did not score every criterion
gets no total either. Comparing totals from two rubric versions is not a comparison.

### The disagreement line is 10 points out of 100, in one constant

`DISAGREEMENT = 10.0`, defined once in `shared/` and mirrored once in the web app's existing
`VARIANCE_BANDS`, whose `10–20` band boundary it already matches.

*Why not fitted.* Fitting it needs model totals and reviewer totals on the same applications. The
cohort with reviewer scores has no model scores, and the cohort with an intake export we can match is
a different year. The spread between two reviewers on one application is a different comparison and
is not a basis for a model-against-human line. So this is a stated choice, held in one place, to be
re-fitted once a cohort carries both numbers — which is what the spec's "The disagreement line is a
stated choice, not a measured result" requirement is there to keep honest.

### Cohort summaries are rebuilt, never incremented

Each ingest, after writing, rebuilds one `SUMMARY#<scholarship>#<year>` item per cohort it touched:
the counts per gap band, the number of applications with both totals, the number flagged, and the mean
gap. `GET /api/agreement` reads those items and sums them.

*Why rebuilt.* A re-upload is expected — the office corrects files. An incremented counter double-counts
on the second upload and there is no way to detect that it did. A rebuild from the cohort is
idempotent by construction, and it is the same paged cohort read the worker already did to resolve
`Candidate`.

*Cost.* The rebuild is O(cohort), so a re-upload of a 4,880-row cohort re-reads 4,880 items. That is
one paged query on a path that runs when a person uploads a file, not on a screen read.

### Three new Lambdas, because one route is one Lambda here

`workers/reviewer_ingest.py`, `handlers/flagged.py` (`GET /api/flagged`), and
`handlers/agreement.py` (`GET /api/agreement`). `flagged` cannot be `ranked`: `ranked` is one cohort's
partition ordered by total, the queue is a cross-cohort partition ordered by gap, and folding a second
ordering into that handler would make its parameters mean different things per mode.

`reviewer_ingest` needs `grantReadWriteData`, unlike every other read path — it reads the cohort to
resolve `Candidate` and writes the reviewer items. Both new handlers get `grantReadData` only.

The EventBridge rule copies the export rule's shape: one wildcard per suffix carrying the prefix
(`reviewer-scores/*.xlsx`, `reviewer-scores/*.csv`), because a list of matchers is an OR and a prefix
matcher combined with a suffix matcher is not.

### The ingest report is an item the screen polls

The worker writes its report to `REPORT#<uploaded_key>` under a reports partition, and the upload
panel polls for it by the key the upload handler already returned.

*Why.* The person who uploaded is not in the request that ingests, and the report is row-level — 17
rejected ids in the delivered file — so "the cohort's `last_ingest_at` moved" is not enough. Polling
for a keyed item reuses the panel's existing poll-and-compare loop and its `MAX_POLLS` give-up, which
the spec turns into "it says it stopped waiting and that the file may still be being read".

## Risks / Trade-offs

- **`Candidate` is a derived id, proven by inference not by documentation.** 355 of the 26-27 ids match
  a 25-26 uuid tail and none matches a head, which at 12 hex characters is not chance — but nobody at
  SJSU has confirmed it. → The worker only ever writes an exact match and reports everything else, and
  the spec requires the report to say when a file matched nothing at all. A wrong assumption shows up
  as a file that placed zero rows, not as scores on the wrong applicants.
- **17 applicants in the delivered file can never be placed.** Excel destroyed their ids before the
  file reached us. → Reported by row number so the office can re-export. Not recoverable here.
- **The disagreement line is a guess.** It may flag most of a cohort or almost none. → One constant,
  and a task to report the real model-against-reviewer distribution the first time a cohort has both,
  so the next value is measured.
- **The queue and figures cover all cohorts while the rest of the app is per-cohort.** That is what the
  UI draws — `reviews-page.tsx` has a Scholarship column and takes no props — but it means a figure can
  mix scholarships scored under different rubrics. → Every figure states its coverage, and the
  per-scholarship breakdown exists so the mixed number is never the only one shown.
- **Rebuilding a summary is O(cohort) per upload.** → Upload path only, and the read it needs is one
  the worker already performs.
- **The gap partition is a single hot partition on its index.** The queue is small by design, but a
  low line on a large cohort could make it large. → It only holds flagged applications, and the line
  is one constant if it needs raising.
- **A second GSI is a second write cost on every flag.** → It is sparse: an application that is not
  flagged is not in it, and the write happens on the upload path, not on a screen read.
- **`shared/rows.py` touches the working export ingest.** A pure move, but `ingest.py` is the path all
  application data comes through. → Move with no behavior change, and the existing ingest tests are the
  check.

## Migration Plan

Nothing to migrate — no stored data changes shape, and no existing item gains a required field.

The one deploy step that is not instant is the `gap-by-size` index: DynamoDB backfills a new GSI in
the background, and until it finishes the queue reads short. Nothing is written into it yet at that
point, so there is nothing to read short of.

Order, because each step is useless without the one before it: bucket prefix, gap index, and
EventBridge rule →
`shared/rows.py` move → `upload.py` gains `kind` → the ingest worker → the two reads → the screens.

Deploying the prefix and rule before the worker exists means a file uploaded in between is stored and
never read; the report never appears and the panel says it stopped waiting. Acceptable for a dev stack.

Rollback is per piece: the two new reads and the ingest worker can be removed without touching stored
data, and the screens fall back to the "not built" wording they already have. Reviewer items and
`gap_pk` left behind by a rolled-back deploy are inert — nothing else reads them.

## Open Questions

- **Is `Soft Match` worth acting on?** 3,310 rows at 100%, 1,551 at 50%, 19 at 0%. Nobody has said what
  it measures. Ignored for now, which changes nothing if it turns out to matter — it can be stored and
  reported later without moving a key or a read.
- **Do reviewer names need to become accounts?** The file gives display names and 169 of them. Storing
  the name is enough for every figure in this change; tying a reviewer to a Cognito user is a sign-off
  question, not this one.
