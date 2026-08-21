## 1. Share the row reader

- [x] 1.1 Move `read_rows`, `workbook_rows`, `csv_rows`, `decode`, `cell`, and `number_or_none` from `lambdas/workers/ingest.py` into `lambdas/shared/rows.py`, with `read_rows` taking the column names to check the header against. No behavior change.
- [x] 1.2 Import them back into `lambdas/workers/ingest.py` and delete the moved copies. The existing ingest tests must pass untouched.

## 2. Keys and constants

- [x] 2.1 Add to `lambdas/shared/table.py`: `reviewer_sk(reviewer_slug)` for `REVIEW#<slug>`, `GAP_PK`, `report_pk`/`report_sk`, and `summary_sk(scholarship, year)`.
- [x] 2.2 Add `DISAGREEMENT = 10.0` to `lambdas/shared/` in one place, with a comment saying it is a chosen line, not a measured one, and what would change it.
- [x] 2.3 Add `reviewer_name_slug()` — collapse whitespace, then `shared.rubric.slug` — so one reviewer spelled with different spacing is one reviewer.
- [x] 2.4 Add the reviewer-score prefix to `BUCKET_PREFIXES` in `infra/lib/data-stack.ts`, and the `gap-by-size` index — partitioned on `gap_pk`, sorted on `score_gap` — to the table.

## 3. The upload route takes a kind

- [x] 3.1 `lambdas/handlers/upload.py`: accept `kind` (absent means `export`), map it to a prefix, and refuse an unknown kind with a 400. Keep the existing `NAME` check, presigner, and expiry.
- [x] 3.2 For `reviewer-scores`, require `scholarship` and `year` in the body and build the key as `reviewer-scores/<scholarship>/<year>/<filename>`. Refuse a missing cohort with a 400 naming what is missing.
- [x] 3.3 Return the key so the caller can poll for that file's report.

## 4. The reviewer-score ingest worker

- [x] 4.1 Create `lambdas/workers/reviewer_ingest.py`: leave alone any object under the prefix whose suffix is not `.xlsx` or `.csv`, and split the scholarship and year out of the key.
- [x] 4.2 Declare the column-to-criterion map in one place and refuse the file whole if the first row names none of its columns.
- [x] 4.3 Parse a criterion cell into the reviewers it names and the score each gave. Report the row when a cell cannot be taken apart; never read an unreadable cell as zero.
- [x] 4.4 Read the cohort with `reads.cohort()`, build the `student_uuid[-12:].upper()` map, and resolve each row's `Candidate` through it exactly. Report a missing, damaged, or unmatched id with its row number and the id as it appeared, and report two rows resolving to one application as duplicates.
- [x] 4.5 Load the criteria of the rubric version that produced the application's model score, and work out each reviewer's total with `shared.reply.weighted_total`. Refuse a row naming a criterion the rubric does not have. Store no total where a reviewer did not score every criterion, where there is no model score, or where the version has no stored criteria.
- [x] 4.6 Write one `REVIEW#<slug>` item per reviewer per application with `update_item`, so re-ingesting replaces one reviewer's scores without touching another's and without leaving two records.
- [x] 4.7 Write `reviewers_stored`, `reviewer_total`, `reviewer_count`, and `score_gap` on the application, and write `gap_pk` only while the gap reaches `DISAGREEMENT`, removing it otherwise. Touch nothing scoring owns. `reviewers_stored` is written either way, so a screen can tell an application no reviewer scored from one the model has not scored.
- [x] 4.8 Rebuild one summary item per cohort touched from what the cohort holds — gap bands, how many applications have both totals, how many are flagged, the mean gap. Rebuild, never increment.
- [x] 4.9 Write the ingest report under the uploaded key: the file, the cohort, rows read, reviewer scores stored, and every rejected row with its number and reason. Write a report saying nothing was stored when the file is refused whole.
- [x] 4.10 Remove `score_gap`, `gap_pk`, `reviewer_total`, and `reviewer_count` wherever a total is taken away, so no gap survives a score that no longer exists — in `shared/claims.mark_failed` and in `workers/ingest.store`'s changed-content branch. `reviewers_stored` and the reviewer items stay: a reviewer did score it.

## 5. The two reads

- [x] 5.1 Add `reviewers_stored`, `reviewer_total`, `reviewer_count`, and `score_gap` to `COHORT_FIELDS` in `lambdas/shared/reads.py`, and add a paged read of the gap partition ordered widest first, reusing `encode_cursor`/`decode_cursor`.
- [x] 5.2 Create `lambdas/handlers/flagged.py` for `GET /api/flagged` — a page of the queue with the applicant, scholarship, model total, reviewers' total, and gap, plus the line it was measured against.
- [x] 5.3 Create `lambdas/handlers/agreement.py` for `GET /api/agreement` — read the per-cohort summaries and return the totals, the gap bands, and the per-scholarship breakdown, each carrying how many applications it covers.
- [x] 5.4 Add a read that returns one reviewer's stored scores for an application, and hand it back from `handlers/application.py`, so the detail and hand-scoring screens can show the model's and each reviewer's per-criterion scores side by side.
- [x] 5.5 Create `lambdas/handlers/upload_report.py` for `GET /api/upload-report?key=` — the stored report for one uploaded file, and a 404 that says the file has not been read yet. The panel has nothing to poll without it.

## 6. Infrastructure

- [x] 6.1 Add the four Lambdas to `infra/lib/compute-stack.ts`. `reviewer_ingest` gets `grantReadWriteData`; `flagged`, `agreement`, and `upload_report` get `grantReadData`.
- [x] 6.2 Add the EventBridge rule for the reviewer-score prefix with one wildcard per suffix, matching the export rule's shape.
- [x] 6.3 Register `GET /api/flagged`, `GET /api/agreement`, and `GET /api/upload-report` with the `route()` helper so they sit behind the same authorizer.
- [x] 6.4 Give `reviewer_ingest` the openpyxl layer the export ingest uses — one layer construct, shared, so there is only one to keep in step.
- [x] 6.5 Let the upload handler PUT to the reviewer-score prefix as well as the uploads one.

## 7. Screens

- [x] 7.1 `upload-panel.tsx`: add the reviewer-score control beside the export one, each saying in a line what file it takes and what it adds. Require a picked cohort before it takes a file, and reuse the export's wording for a refused suffix.
- [x] 7.2 Poll for the uploaded file's report and show it: rows read, scores stored, and each rejected row by number with the reason in a reviewer's words. Say it is waiting while waiting, say it stopped waiting on the give-up, and never report a clean ingest when rows were rejected.
- [x] 7.3 `reviews-page.tsx`: list the flagged applications widest gap first from `/api/flagged`, with working filters and paging, and one line saying what puts an application here and how many points apart counts.
- [x] 7.4 Give the reviews queue its two empty states in different words — no reviewer scores uploaded yet, versus nothing crosses the line — and say how many applications the second covers.
- [x] 7.5 `applications-list.tsx`: fill the Reviewer, Score gap, and Flagged columns from the cohort read, keep Final reading as not stored, and say which figure is missing where an application lacks a model or a reviewer total instead of showing a zero or a dash.
- [x] 7.6 Make the reviewer score range, score gap range, and flagged filters work and count toward the filters in use. Leave any filter that needs sign-off present, unavailable, and uncounted.
- [x] 7.7 `reliability-section.tsx`: draw the model-against-human card, the score-gap bands, and the per-scholarship breakdown from `/api/agreement`, each stating its coverage. Leave the human-against-human card and the reviewer distribution saying they are not built.
- [x] 7.8 `application-detail.tsx`: show any uploaded reviewer scores for the application beside the model's per-criterion numbers, and say a reviewer's score gets in by the dashboard upload only. Nothing on the screen submits a score. There is no separate hand-scoring screen left in the app to reword — the detail screen is where a score is read.
- [x] 7.9 Keep the 10-point boundary in one place the screens read from (`features/reviews/disagreement.ts`, whose bands are the ones `/api/agreement` counts by), and take the line itself off the reads that report it, so the web app and the worker cannot disagree about what is flagged. There was no `VARIANCE_BANDS` constant: the boundary only existed in the band names of a `variance_distribution` shape nothing served.

## 8. Record the decisions this change settles

- [x] 8.1 Update `openspec/changes/aws-overhaul/specs/human-in-the-loop/spec.md`: answer the routing half of open question 2, and strike "what fills it, how it is ordered" from its "To be written" list.

## 9. Tests

- [x] 9.1 Cell parsing: a two-reviewer cell, a one-reviewer cell, a blank cell, and a cell the reader cannot take apart. Assert the unreadable one is reported and never read as zero.
- [x] 9.2 `Candidate` resolution: an exact match, an id damaged into scientific notation, an id matching nobody in the cohort, and two rows resolving to one application. Assert each rejection carries its row number, and that nothing is written for it.
- [x] 9.3 The reviewer's total: recomputed from per-criterion scores against a fixture rubric with unequal maxima, ignoring the file's own total. Assert no total where a reviewer skipped a criterion, where there is no model score, and where the rubric version has no stored criteria.
- [x] 9.4 The gap and the flag: over the line, under it, exactly on it, two reviewers averaged, and one reviewer alone. Assert `gap_pk` is written only while flagged and removed when a corrected score drops the gap under the line.
- [x] 9.5 Re-ingest: the same small file twice leaves the same reviewer items, gaps, flags, and summary. A corrected file moves only what it names and leaves applications it does not mention alone.
- [x] 9.6 A score taken away takes its gap and flag with it, through both `mark_failed` and a changed-content re-ingest.
- [x] 9.7 The queue read pages in gap order and its cursor round-trips, using the existing cursor helpers' tests as the model.
- [ ] 9.8 One end-to-end check, kept out of the fast suite: upload the delivered reviewer-score file against a real cohort in the dev stack, and assert the report names the rows that could not be placed and that the queue holds what crossed the line. Report the model-against-reviewer gap distribution it produces, so the next value of `DISAGREEMENT` is measured rather than chosen.
