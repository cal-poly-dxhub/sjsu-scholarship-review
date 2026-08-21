## Why

The review queue, the score-gap columns, and the model-against-reviewer graphs are all drawn and
all empty, because nothing in the system can hold a reviewer's score. `human-in-the-loop` names
this as the thing blocking the loop: "Variance between the AI and human scores is the signal the
current review queue uses, and it cannot fire at all until IT delivers last year's human scores."

IT has now delivered them, as
`SJSU General Scholarships 26-27 scores(ScholarshipManagerData - 2026-0).csv`. So this change takes
that one input and spends it on one question: **which applications should a person look at again,
because the model and a reviewer landed far apart?** It is not the review software. Nobody scores in
the app, nobody signs anything off, and the screens keep saying so.

## What the file actually is

Read before designing, because it settles most of the open choices.

- 4,880 rows, 8 columns: `Candidate`, `Soft Match`, five criterion columns, `Weighted Points`.
- Each criterion cell holds a block of text: `Average score: 3.00` then one `Reviewer Name: 3` line
  per reviewer. Every one of the 4,879 scored rows parses, and the stated average matches the listed
  scores exactly in all of them.
- 2,675 rows carry two reviewers, 2,204 carry one, one row carries none. 169 reviewers, named by
  display name — not email — and some with doubled spaces inside the name.
- The five columns **are** our five rubric criteria, under different names and in a different order.
  The score ranges prove it column by column: 0–4, 0–4, 0–1, 0–3, 0–3, against the rubric's Career
  Goals Essay (0–4), Challenge Essay (0–4), Extracurricular Activities (0–1), Initiative &
  Self-Motivation (0–3), Creativity (0–3). So a column-to-criterion map is needed, the same job
  `COLUMNS` does for the intake export.
- `Candidate` is the applicant identifier: the last 12 hex characters of the intake export's
  `Student` uuid, uppercased. 355 of the 26-27 candidates match the tail of a 25-26 `Student` uuid
  and **none** matches the head, which at 12 hex characters is not chance. Tails are unique across
  all 1,903 applicants in the 25-26 cohort, so the tail identifies one application.
- `Weighted Points` cannot be trusted as the reviewer's total. Fitted against the five criterion
  averages it comes out at roughly 40/29/10/11/10 out of 100 — recognisably our formula — but those
  weights reproduce only 1,389 of 1,898 rows exactly, and one row is out by 38 points. The reviewer's
  total has to be worked out from the per-criterion scores instead.
- Excel has destroyed 17 `Candidate` ids into scientific notation (`2.56655E+11`, `7.87E+102`) and
  stripped a leading zero from one more. Those rows can never be placed. This is why the ingest has
  to report rejects by row number rather than write what it managed and stay quiet.
- The file names neither the scholarship nor the year in any column.

## What Changes

**Reviewer scores get in by upload.**

- `POST /api/upload` takes a `kind` — the intake export as today, or a reviewer-score file — and
  hands back a presigned ticket. One route, one handler, one presigning path; the prefix is the only
  thing that moves.
- A reviewer-score file goes to a key that carries the cohort the reviewer picked on screen, because
  the file itself names neither the scholarship nor the year. No guessing at a filename.
- A new ingest worker for that prefix, started by an EventBridge rule shaped like the export's. It
  reuses the export reader — workbook or CSV, the header check, the encoding fallback, the row-level
  report — rather than growing a second copy of it.
- Each reviewer's scores for one application are stored as their own item, so nothing in the file is
  averaged away on the way in. A reviewer's total is **worked out on write** from their per-criterion
  scores and the weights of the rubric version that scored the application — never read from
  `Weighted Points`. That is what `human-in-the-loop` already requires, and it is the only way a
  reviewer's total and the model's are comparable, which is the whole input to a score gap.
- Rows whose `Candidate` is damaged, names nobody in the cohort, or carries no scores at all are
  **reported with their row numbers**. The upload panel shows that report.
- Re-uploading the same file changes nothing and double-counts nothing.

**The disagreement half of the reviewer section fills in.**

- An application with both a model total and at least one reviewer total gets a stored gap: the
  distance between the model's total and the mean of its reviewers' totals. It joins a ranking
  partition ordered by that gap, the same trick `rank_pk` plays for totals, so the queue pages with
  the cursor helpers that already exist.
- An application is flagged for a second look when that gap reaches **10 points out of 100**. One
  named constant, one place.
- The review queue holds the flagged applications, widest gap first, across every cohort that has
  reviewer scores. Its filters and its paging work.
- The Reviewer, Score gap, and Flagged columns on the applications list carry real numbers. Final
  stays empty — that is sign-off, and sign-off is not in this change.
- The reliability section's disagreement panels get data: the score-gap bands, the
  model-against-reviewer card, and the per-scholarship breakdown.
- Each ingest rebuilds one summary item per cohort it touched, so those reads are a handful of keyed
  gets rather than a scan. Rebuilt, not incremented, so a re-upload is safe.

**What is deliberately not built, and stays a labelled gap on screen.**

- **No in-app scoring.** "Submit scores" on the hand-scoring screen stays off. A reviewer's score
  arrives by upload only. The screen's wording changes from "cannot be saved" to name the upload as
  the way in, so it stops reading as a dead end.
- **No sign-off.** "Not reviewed" and "nothing here is signed off" stay exactly as they are.
- **No reviewer-against-reviewer agreement.** The data supports it — two named reviewers on 2,675
  rows — and every reviewer's own scores are stored, so it is not blocked later. But the
  human-against-human card and the reviewer distribution stay unbuilt and keep saying so.

## Capabilities

### New Capabilities

None. Every requirement here lands on a capability that already exists.

### Modified Capabilities

- `human-in-the-loop`: reviewer scores arrive by upload rather than by in-app submission, and the
  gap between the model and the reviewers is what routes an application to a person. This answers
  the routing half of its open question 2 and writes the first part of its "the review queue itself:
  what fills it, how it is ordered". Sign-off, holds, and the detection gate are untouched.
- `aws-platform`: the upload requirement covers a second kind of file and a second prefix; the export
  reader is shared with a second worker; a reviewer's score is a second kind of item under an
  application; and the queue and reliability reads are addressed without scanning.
- `web-app`: the reviews queue, the comparison columns, two of the restored filters, and the
  disagreement half of the reliability section stop being labelled gaps and get reads behind them.
  The gaps that remain keep saying so in the same words.

Note on paths: `openspec/specs/` is empty — nothing has been archived yet — so all three of these
capabilities exist today only inside `aws-overhaul` and `restore-review-ui`. The deltas here are
written against those in-flight requirements and assume both changes archive first.

## Impact

**New code**

- `lambdas/workers/reviewer_ingest.py` — the new worker.
- `lambdas/handlers/flagged.py`, `lambdas/handlers/agreement.py` — the queue read and the
  reliability read.
- Reviewer-score key shapes and the gap ranking partition in `lambdas/shared/table.py`.
- A shared row reader lifted out of `workers/ingest.py` so both workers read a file the same way.

**Changed code**

- `lambdas/handlers/upload.py` — takes `kind`, picks the prefix, carries the cohort in the key.
- `lambdas/shared/reads.py` — `COHORT_FIELDS` carries the reviewer total and the gap; a paged read
  over the gap index.
- `infra/lib/data-stack.ts` — the new bucket prefix.
- `infra/lib/compute-stack.ts` — the new worker, its EventBridge rule, two new routes. The new worker
  needs read *and* write on the table, because it has to read the cohort to turn a `Candidate` tail
  back into a `student_uuid`.
- `apps/web/src/features/reviews/reviews-page.tsx`, `features/dashboard/reliability-section.tsx`,
  `features/scholarships/applications-list.tsx`, `features/dashboard/upload-panel.tsx`, and the
  hand-scoring screen's wording.

**Not affected**

Scoring. No worker, prompt, claim, or rubric path changes, and no model is called by anything here.

**Dependencies**

None added. The new worker needs the openpyxl layer the export ingest already uses.

**What this change cannot check**

The threshold. Setting it needs model totals and reviewer totals side by side on the same
applications, and no cohort has both yet — the year with reviewer scores has no model scores, and
the spread between two reviewers is a different comparison. So 10 points is a starting line chosen
to match the band the dashboard already draws, held in one constant, to be re-fitted once a cohort
carries both numbers.
