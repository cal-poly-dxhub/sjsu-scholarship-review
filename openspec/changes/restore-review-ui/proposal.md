## Why

The AWS overhaul replaced four parts of the demo UI instead of adding to them. The dashboard's
reliability analytics, the Reviews queue and its tiebreaker form, the applications list's
Human / AI / Final / Variance columns, and the rubrics PDF page were all removed. The work that
went in — upload, cohort picking, rubric publish, scoring runs, export — is worth keeping, but it
was never meant to cost the screens that were already there.

They were removed for a real reason: every one of them read an endpoint that the new API does not
serve, and three of them compared a model score against a human score that nothing stores. So
bringing them back cannot mean bringing back screens that fetch nothing and draw a zero. This
change restores the screens, keeps everything the overhaul added, and has each restored part say
plainly what is missing rather than showing a number it does not have.

## What Changes

- **Reviews tab gets its queue and its tiebreaker form back.** The queue table, its filters, and
  its paging return as chrome around an honest statement: nothing computes a review flag, because
  a flag needs a human score to disagree with. The tiebreaker form returns as a working screen —
  it reads the application and its model score from `GET /api/application`, which exists — where a
  reviewer reads the answers, sees the model's score and reasoning per criterion, and types their
  own. Submit stays unavailable and says why; the typed scores can be exported as JSON so the
  reading is not thrown away.
- **The dashboard's reliability section gets its full layout back**, below the run controls that
  are there now: the insight banner, the reviewer-vs-reviewer and model-vs-reviewer comparison
  cards, and the four agreement and variance charts. Each says, in one line, that no reviewer scores
  are saved yet so there is nothing to compare. `ComparisonCard` and `DistBar` are already exported
  for this and are reused, not rewritten. One new panel in the same section draws real numbers from a
  read that does exist — scoring coverage per state and per rubric version, off `GET /api/cohort`.
- **The applications list gets the human comparison columns back as an opt-in group**, off by
  default: Human, AI, Final, Variance, and the REVIEW flag, plus the human, AI, and variance range
  filters. The current Total and per-criterion columns are untouched and stay the default view.
  Every restored cell reads as not stored, and the restored filters are unavailable with a reason.
- **The rubrics PDF page comes back and becomes reachable from the nav** for the first time — it
  was never routed at the handoff. The PDF pane, the criterion and option editing, and the score
  bands return. The draft step says the app cannot build a rubric from a PDF yet and points at the
  dashboard's rubric panel, which takes a `.txt` or `.md` today and works.
- **The two generations are reconciled rather than stacked.** One nav, one set of filter controls,
  one way to address a cohort, one score-state helper, and the design system's components
  throughout — so a restored screen does not read as a different app sitting next to the new one.
- The restored screens are re-expressed in `sjsu/components/ui/*` and addressed by
  `scholarship` + `year` + `student_uuid`. Their original `availability_id` and `application_key`
  addressing cannot load against the current store, so it is not kept.
- **Not restored: the simulated progress animation** on the rubrics page. It advanced seven
  labelled stages on `setTimeout` timers while a single request was in flight, so it claimed
  checks — "Checking every option is verbatim" — that nothing performed. The page reports the real
  state of the request instead.
- **Every word on screen is rewritten for a scholarship reviewer.** This covers the screens that
  already work, not only the restored ones. An independent agent reads all of the app's text and
  reports on four things: language that does not sound like a person, the machinery explained to
  someone who does not maintain it, sentences longer than they need to be, and capitalization that is
  wrong or inconsistent. Then it gets fixed. Current text like "Which worker", "Path", "Check the
  `dev-ingest` logs", and "There is no read that lists cohorts" is aimed at whoever built the system,
  not whoever uses it.
- **Nothing is deployed until it has been walked locally and signed off.** The last two groups of
  tasks run the app on the dev server against the dev environment, walk every screen, and stop for
  Nate to look at it. This needs a dev-server proxy for `/api`, which the repo does not have yet.

## Capabilities

### New Capabilities
- `web-app`: what each screen of the web app shows, what a reviewer can do on it, and what it says
  when the read behind a section does not exist. Covers the nav, the dashboard's two halves, the
  scholarships list and detail, the reviews queue and tiebreaker, and the two rubric screens.

### Modified Capabilities
<!-- None. `aws-platform` covers delivery, sign-in, and the API edge; none of its requirements
     change. This change adds no endpoint and alters no stored item. -->

## Impact

- **Restored files** — `apps/web/src/features/reviews/review-detail.tsx` and
  `apps/web/src/features/rubrics/rubrics-page.tsx`, both re-expressed against the current API and
  component library.
- **Changed files** — `reviews-page.tsx` (queue returns), `reliability-section.tsx` (layout
  returns), `applications-list.tsx` (opt-in column group and filters), `App.tsx` and
  `sjsu/components/sidebar.tsx` (a fourth nav entry; the layout already handles a `rubrics` key),
  `vite.config.ts` (a dev-server proxy for `/api`), and screen text across the working features
  wherever the wording pass finds it.
- **New shared files** — one `filter-controls.tsx` for the filter inputs that three screens each
  had their own copy of, and one `not-built.tsx` for the "the app cannot show this yet" card, so the
  wording is the same everywhere it appears.
- **No backend change.** No new endpoint, no new item, no change to what is stored. Everything the
  restored screens cannot show stays unshown, said plainly, and blocked on a later change.
- **The old FastAPI in `apps/api` is left alone.** It still implements `/reviews`, `/analytics`,
  `/dashboard/stats`, and the human-score reads against the pre-overhaul tables, but nothing routes
  the app to it — the old client called `localhost:3005` unauthenticated, the current one calls
  same-origin `/api` with a token. It is a head start for the follow-up backend change, not a read
  this one can use.
- **Out of scope** — `features/applications/applications-table.tsx`,
  `application-review-dialog.tsx`, and `review-data.ts`. All three were already dead code at the
  handoff: nothing imported them and the nav never routed to them. Restoring unreachable code
  would add three files nobody can open.
- **Known cost** — the restored comparison columns, the restored filters, and most of the
  reliability charts draw no numbers until human reader scores are stored and the reads are built.
  They come back as visible, labelled gaps. That is the point of restoring them now, but it does
  mean four screens carry more "not built" text than working controls until a follow-up change
  fills them.
