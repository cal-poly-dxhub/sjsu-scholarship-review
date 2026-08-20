## 1. Groundwork

- [ ] 1.1 Bring the uncommitted cohort work onto this branch — `cohort-picker.tsx`, `score-state.ts`, `academic-year.ts`, their tests, and the `/api/cohorts` handler and route. The restored screens need all of it; see design.md — Migration Plan.
- [ ] 1.2 Add a `NotBuilt` card to `apps/web/src/sjsu/components/`: takes one short line on what the app cannot show, and an optional pointer to the control that does the job today. Reviewer-facing text only — no slot for an endpoint name. One wording for every screen.
- [ ] 1.3 Move `FilterInput` and `FilterRange` out of `applications-list.tsx` into a shared `apps/web/src/sjsu/components/filter-controls.tsx`, built on the design system's `Input` and `Label`. Point the existing list at them and confirm the filter panel is unchanged.
- [ ] 1.4 Add a disabled variant to both filter controls that shows a reason and holds no state.
- [ ] 1.5 Add a shared "not stored" cell marker for table cells whose figure does not exist, so no cell renders a bare dash that reads as a measured blank.

## 2. The reliability section's layout

- [ ] 2.1 Add a pending mode to `ComparisonCard` and `DistBar` in `reliability-section.tsx`: titles and labels render, each figure is replaced by the not-stored marker. No zero reaches a formatter.
- [ ] 2.2 Restore the section's layout below the run controls — summary banner, the reviewer-against-reviewer and model-against-reviewer cards, and the four breakdowns (reviewer agreement, agreement by scholarship, disagreement by criterion, variance distribution) — each in pending mode with one `NotBuilt` line saying no reviewer scores are saved yet, so there is nothing to compare.
- [ ] 2.3 Note in the section's docstring that `DashboardStats` and `AnalyticsData` are a sketch of what a working read would return, not an agreed contract.
- [ ] 2.4 Add the scoring coverage panel to the same section, drawing real counts from `GET /api/cohort` — scored, unscored, running, failed, and the count per rubric version. Word it as work done, not agreement.
- [ ] 2.5 Confirm the upload, cohort, rubric, and run controls above the section still render and work when the section has nothing to show.

## 3. The reviews queue

- [ ] 3.1 Restore the queue table in `reviews-page.tsx` with its columns, its filters (using the shared controls), and its paging, over the current application shape rather than the old review shape.
- [ ] 3.2 Render the queue empty behind a `NotBuilt` card: an application is flagged when a reviewer's score disagrees with the model's, and no reviewer scores are saved yet. Do not say the queue is clear or that flags are resolved.

## 4. The hand-scoring screen

- [ ] 4.1 Add `review-detail.tsx` back under `features/reviews/`, taking a scholarship, year, and applicant identifier, reading `GET /api/application`, and expressed in the design system's components.
- [ ] 4.2 Show the answers in full, and one card per criterion of the rubric version that scored the application, carrying the model's score and its reasoning. Take the criteria, their names, and their maxima from `GET /api/rubric-versions` only.
- [ ] 4.3 Add a score entry per criterion, bounded by that criterion's maximum, refusing an entry above it and naming the maximum.
- [ ] 4.4 For an unscored application, list the criteria from the newest published version and say the application is unscored where the model's score would be.
- [ ] 4.5 Put a `NotBuilt` card above the criteria, before anything can be entered: scores typed here cannot be saved yet, and can be downloaded instead. Leave submitting unavailable at all times.
- [ ] 4.6 Add a download of the entered scores with the applicant identifier and the rubric version, so the reviewer's reading is not lost.
- [ ] 4.7 Show a superseded model score marked as the previous one, with the reason, using `scoreState`.
- [ ] 4.8 Open the screen from a row action on the applications list and from a button on the application detail screen.

## 5. The applications list's comparison columns

- [ ] 5.1 Add the opt-in toggle beside the existing export controls, off by default and local to the screen.
- [ ] 5.2 Append the reviewer, model, final, and variance columns and the review flag after the per-criterion columns and before State, leaving the existing columns and their order untouched.
- [ ] 5.3 Render every cell in the group with the not-stored marker. Do not restate the stored total in the model column and do not compute a variance against it.
- [ ] 5.4 Add the reviewer score, model score, and variance range filters to the filter panel as disabled controls with one reason, kept out of the filter shape and out of the row-matching code.
- [ ] 5.5 Confirm the count of filters in use covers only the filters that work, and that turning the group off gives back the exact current table.

## 6. The rubrics screen

- [ ] 6.1 Add `rubrics-page.tsx` back under `features/rubrics/` with the two-pane layout, expressed in the design system's components.
- [ ] 6.2 Accept a rubric PDF and render it in one pane with `react-pdf`, already a dependency and unused in `src/`. Nothing new is installed.
- [ ] 6.3 Put a `NotBuilt` card on the draft side: the app cannot build a rubric from a PDF yet, and the dashboard takes a rubric pasted as a text or Markdown file and publishes it.
- [ ] 6.4 Fill the draft pane with the published versions for the picked scholarship from `GET /api/rubric-versions` — criterion rows, score bands, and option rows, read-only — so the pane has something real beside the file.
- [ ] 6.5 Leave out the staged progress animation. Where the screen waits, it says it is waiting and names no stage.

## 7. Nav and reconciliation

- [ ] 7.1 Add a Rubrics entry to `NAV_ITEMS` in `sjsu/components/sidebar.tsx` and route it in `App.tsx`. `AppLayout` already bleeds the frame for the `rubrics` key.
- [ ] 7.2 Walk every nav entry and confirm each renders a screen with a heading naming it, and none renders a blank frame or an error.
- [ ] 7.3 Confirm every screen that works on a cohort uses `CohortPicker` over the same list, and that no screen asks for an `availability_id` or an `application_key`.
- [ ] 7.4 Confirm two screens with the same gap word it the same way, and that no screen has its own copy of a filter control or an empty state.

## 8. Tests

- [ ] 8.1 Test the score entry bound on the hand-scoring screen: a score at the maximum is taken, above it is refused, a negative is refused, and an empty entry leaves the criterion unscored rather than zero.
- [ ] 8.2 Test the reviewer score download: it carries every criterion of the named rubric version, marks a criterion the reviewer left blank as unscored, and says nothing was submitted.

## 9. The wording pass

- [ ] 9.1 Send an independent agent over every word the app puts on screen — the restored screens and the ones already working, including headings, labels, buttons, table headers, placeholders, hints, empty states, toasts, and error text. It reads the files and reports; it does not edit. It is looking for four things: language that reads oddly or does not sound like a person; the machinery explained to someone who does not maintain it (endpoints, paths, workers, batch jobs, tables, logs, field names, token or cost detail); text longer than it needs to be; and capitalization that is wrong or inconsistent with the app's sentence case. It reports each one as file, line, the current text, and a suggested replacement.
- [ ] 9.2 Apply the report. Known offenders to expect: the run panel's "Which worker" and "Path" labels and their on-demand-versus-batch explanation, "Check the `dev-ingest` logs", "There is no read that lists cohorts — every read names one", "no reader scores are stored", and the reliability section's Title Case headings ("Human Reviewer Agreement", "Agreement by Scholarship Type", "Human Disagreement by Criterion", "AI vs Human Variance Distribution") against the app's sentence case elsewhere.
- [ ] 9.3 Confirm no screen text names an endpoint, a worker, a queue, a table, a log group, or a code field, and that the same thing is worded and capitalized the same way everywhere it appears.

## 10. Show it locally

- [ ] 10.1 Add a `server.proxy` entry in `apps/web/vite.config.ts` sending `/api` to the dev environment's front door, so the same-origin client works from the dev server. Leave the shipped bundle's `/api` prefix alone.
- [ ] 10.2 Create `apps/web/.env.local` from `.env.example` with the dev EdgeStack's `UserPoolId`, `UserPoolClientId`, and `SignInDomain`. `http://localhost:3000` is already a registered callback, so sign-in works as-is.
- [ ] 10.3 Run `pnpm typecheck` and `pnpm test` and get both clean.
- [ ] 10.4 Start the dev server, sign in with the account in the root `.env`, and walk every screen: the dashboard's controls and its restored reliability layout plus the coverage panel, the scholarships list with the column group off and on, the hand-scoring screen from a row action, the reviews queue, and the rubrics screen with a PDF picked.
- [ ] 10.5 Confirm on the running app that no screen shows a zero, an empty chart, or a percentage where there is no data, that nothing claims a review was saved, and that no screen names the machinery.
- [ ] 10.6 Capture what each screen looks like and show Nate the running app.
- [ ] 10.7 **Stop here.** Get Nate's explicit sign-off on what he has seen. Nothing below starts until he gives it.

## 11. Deploy

- [ ] 11.1 Blocked on 10.7. Deploy the web build to the dev environment with `AWS_PROFILE=dxhub-automation`, and walk the same screens on the deployed site.
