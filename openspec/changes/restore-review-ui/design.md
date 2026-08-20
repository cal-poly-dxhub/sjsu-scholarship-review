## Context

See proposal.md — Why. The constraints that shape every decision below:

- **The API serves nine reads.** `GET /api/cohort`, `GET /api/cohorts`, `GET /api/ranked`,
  `GET /api/application`, `GET /api/rubric-versions`, `POST /api/rubric-parse`,
  `POST /api/rubric-versions`, `POST /api/upload`, `POST /api/run`, `POST /api/scores`. Everything
  the removed screens called — `/dashboard/stats`, `/analytics`, `/reviews`,
  `/reviews/{key}/submit`, `/scholarships`, `/applications/{key}`, `/rubrics/generate`, `/rubrics`
  — is absent. This change adds none of them.
- **The old FastAPI in `apps/api` still serves most of those.** `/reviews`, `/analytics`,
  `/dashboard/stats`, `/scholarships`, `/applications/{key}`, `/rubrics*`, and the human-score reads
  under `/scores/{key}/*` are all implemented there, against the pre-overhaul DynamoDB tables
  (`sjsu-applications`, `sjsu-scores`, `sjsu-rubrics`). It is not reachable from the app: the old
  client called `http://localhost:3005` with no auth, the current one calls same-origin `/api` with a
  Cognito token, and nothing routes one to the other. So it is prior art for the follow-up backend
  change, not a read this change can use. `POST /reviews/{key}/submit` is absent there too — the
  tiebreaker's submit never had a backend on either generation.
- **No human score is stored.** An application item carries one total, one set of per-criterion
  scores, and the rubric version that made them. There is no second opinion, so a variance cannot
  be computed and a review flag cannot be raised.
- **The removed screens addressed data that no longer exists** by `availability_id` and
  `application_key`. The store is keyed by scholarship, academic year, and applicant identifier.
- **Two component vocabularies.** The removed screens used raw `<table>`, `<input>`, and `<button>`
  with inline Tailwind. The current screens use `sjsu/components/ui/*`. Putting the first back
  as-is would give the app two visual languages.
- **`ComparisonCard` and `DistBar` already exist** and are already exported from
  `reliability-section.tsx`, along with the `DashboardStats` and `AnalyticsData` shapes. The
  overhaul kept them for this.

## Goals / Non-Goals

**Goals:**

- Every restored screen reachable, rendering, and using the design system's components.
- One place that says "this read is not built", so the wording cannot drift between screens.
- The restored parts cost the working parts nothing: same default view on the list, same run
  controls on the dashboard, no read added to a path that works today.
- A reviewer who scores an application by hand keeps their work, even though nothing can store it.

**Non-Goals:**

- Any endpoint, any stored item, any change to what ingest or the scorers write.
- Persisting a reviewer's identity, score, or sign-off anywhere.
- Restoring the three dead files under `features/applications/` (see proposal.md — Impact).
- Rebuilding the removed screens' markup as it was. They come back as behavior, not as bytes.

## Decisions

### The hand-scoring screen is reached from the applications list, not from the Reviews queue

The tiebreaker form was reached by clicking a row in the review queue. That queue cannot hold a row,
so keeping that as the only way in would restore a screen nobody can open — the thing the nav
requirement exists to prevent. A row action on the applications list and a button on the application
detail screen both open it, for any application in a cohort.

*Alternative considered:* leave it behind the Reviews queue and accept that it is unreachable until
flags exist. Rejected — an unreachable screen is indistinguishable from a deleted one, and the whole
point of this change is that the screens are back.

### The screen text is written for a reviewer, and never names the machinery

The person reading these screens reviews scholarship applications. They do not know, and should not
have to learn, what a read, an endpoint, a worker, a batch job, or a table is. So every line on
screen says what the reviewer can and cannot do, in their words: "no reviewer scores are saved yet,
so there is nothing to compare", not "`/analytics` is not built". Where a limit comes from how the
work is arranged, the screen says what it costs the reviewer — roughly how long a run takes, whether
to wait — and nothing about the arrangement.

This applies to the text already on the working screens, not only the restored ones. Several current
lines explain the plumbing ("Goes to the on-demand worker", "Check the `dev-ingest` logs", "There is
no read that lists cohorts"), and they are in scope for this change.

*Alternative considered:* name the missing endpoint so a developer reading the screen knows what to
build. Rejected — the spec is where that belongs. Putting it on screen trades the reviewer's
understanding for a developer's convenience, and the developer already has the spec.

### One `NotBuilt` card, saying what is missing and what to do instead

Every "the app cannot show this yet" statement goes through one component: one short line on what is
missing, and — where there is one — the control that does the job today. The spec requires two
screens with the same gap to word it the same way; a shared component gets that by construction. The
component takes reviewer-facing text only; it has no slot for an endpoint name.

*Alternative considered:* per-screen prose. Rejected — eleven hand-written variants of the same
sentence drift, and the difference between "we cannot show this" and "we looked and found nothing"
is exactly the distinction that gets lost first.

### The comparison cards and bars render a pending state, never a zero

`ComparisonCard` and `DistBar` take numbers. Passing zero produces "0.00 pts" and "0%", which read
as measurements — the spec forbids it. Both gain an optional pending flag: labels and titles render,
each figure is replaced by the not-stored marker. The section's layout is then the real layout, with
holes where the figures go.

*Alternative considered:* render the section as a single card and drop the layout until the reads
exist. Rejected — that is what the code does today, and the request is to see the shape of what is
coming.

### `DashboardStats` and `AnalyticsData` stay as they are, and stay a sketch

Both shapes are already in the file. They describe reads nobody has designed, so the design notes
them as a sketch of what a working section would use, not an agreed contract. Restoring the layout
against them does not commit the API to them.

### The comparison columns are a group the reviewer turns on, appended after the criteria

A checkbox beside the existing export controls. The columns go after the per-criterion columns and
before State, so the order of what is there now does not move — the spec requires that. Off by
default, so the list a reviewer uses to do work is the list they have now.

### The restored range filters hold no state at all

Human score, model score, and variance render as disabled inputs that are not part of the filter
shape and are not read by the row-matching code. The spec says an unavailable filter must not count
toward the filters in use and must not change which rows are shown; keeping them out of the shape
makes that true by construction rather than by remembering.

*Alternative considered:* add them to the filter shape and skip them while matching. Rejected — one
edit away from silently dropping rows, and the score-range filter already had to learn not to match
a superseded total.

### The rubrics screen shows the source file beside the published versions

The page's two-pane layout comes back: the picked file on one side, criteria and options on the
other. Drafting from the file needs `POST /rubrics/generate`, which is absent, so the draft side
instead renders the published rubric versions for the picked scholarship — the same criterion, level
band, and option rows the page had, driven by `GET /api/rubric-versions`, read-only. The screen
gains a real job today (read a published rubric next to the file it came from) and keeps the layout
for when drafting is built.

*Alternative considered:* let a reviewer build a draft by hand in the editors. Rejected — it invents
a rubric-authoring path the API cannot accept, and the dashboard's rubric panel is the one that
publishes. *Also considered:* render the editors empty and disabled. Rejected — a screen whose whole
body is disabled controls is not a restored screen.

The PDF is rendered with `react-pdf`, already a dependency in `apps/web/package.json` (with
`pdfjs-dist`) and unused anywhere in `src/` — it was added for this page and left behind when the
page was deleted. Nothing new is installed.

### The simulated progress is not restored

The original advanced seven named stages on `setTimeout` timers while one request was in flight, so
it announced checks — "Checking every option is verbatim" — that nothing ran. The spec forbids
reporting a step that did not happen. The screen says it is waiting, and nothing more.

### One `FilterInput` / `FilterRange` pair for every screen

Three copies existed at the handoff and one still does. They move to a shared module, built on the
design system's `Input` and `Label`, with a disabled-plus-reason variant for the restored filters.

### The dev server proxies `/api` to the dev environment, so the app can be walked locally

Nothing renders locally today. `apps/web/src/api.ts` calls same-origin `/api`, the dev server has no
proxy, and `vite.config.ts` throws unless the three `VITE_` sign-in values are set — and there is no
`apps/web/.env.local` in this worktree. Two small additions fix it: a `server.proxy` entry sending
`/api` to the dev front door, and the sign-in values copied from the dev EdgeStack outputs.
`http://localhost:3000` is already a registered Cognito callback and logout URL
(`infra/lib/edge-stack.ts`) and an allowed origin on the upload bucket (`infra/lib/data-stack.ts`),
so sign-in and upload both work from the dev server against the dev environment.

The proxy is a dev-server setting. It changes nothing about how the deployed app is served, where the
API still sits behind the same front door on the same origin.

*Alternative considered:* point the client at the API's URL through a `VITE_API_URL`, the way the old
client did. Rejected — that puts a second way to reach the API into the shipped bundle and invites
the CORS preflight the same-origin design exists to avoid.

### Restored screens reuse `scoreState` and `hasCurrentScore`

The superseded-score rule now has to hold in more places: the comparison columns, the hand-scoring
screen, the queue's row shape. All of them call the existing helper, so the rule stays in one file.

## Risks / Trade-offs

- **Four screens carry more "not built" text than working controls.** → Every statement is one short
  line and points at the control that works today, and the coverage panel gives the reliability
  section real numbers off a read that exists. The app says what it cannot do instead of implying
  it can.
- **A reviewer scores an application and cannot save it.** → The screen says so before the first
  score is entered, submitting is never available, and the entered scores download as a file. The
  risk of them not reading the notice is real; the mitigation is that there is no button to press.
- **The applications list is already wide and the group adds four columns.** → Off by default, and
  the group is appended rather than interleaved, so turning it off restores the exact current table.
- **Restoring the layout against `AnalyticsData` may anchor whoever builds the read.** → Named a
  sketch in this design and in the section's own docstring.
- **Reading a published rubric on the rubrics screen overlaps the dashboard's rubric panel.** →
  The rubrics screen is read-only and next to the source file; the panel is where a version is
  parsed and published. Each says which it is.

## Migration Plan

1. **The uncommitted cohort work lands first.** The restored screens use `CohortPicker`,
   `useCohorts`, `cohortKey`, `scoreState`, `hasCurrentScore`, `isAcademicYear`, and
   `GET /api/cohorts`. All of those are uncommitted on `aws-overhaul-infra` and are not on this
   branch. Rebase or merge them in before starting, or the restored screens have nothing to pick a
   cohort with.
2. Shared pieces before screens: `NotBuilt`, the filter controls, the pending state on
   `ComparisonCard` and `DistBar`.
3. Screens in any order — they share no state.
4. Nav last, so no entry points at a half-built screen.
5. The wording pass over every screen, restored and existing, once all the text is written.
6. Run it locally and walk it with Nate. Nothing is deployed until he has seen it.

No data change, so rolling back is reverting the commit.

## Open Questions

- Should the comparison column group be remembered between visits? Local for now; a preference
  store is a separate concern.
- Once a review flag exists, does the queue become the main way into the hand-scoring screen, or
  does the row action stay? Answerable when there is a flag; neither answer changes this design.
