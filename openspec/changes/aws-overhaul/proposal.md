## Why

The app runs only on developer laptops: the web UI on the Vite dev server, the API on
`uvicorn`, both reaching DynamoDB with personal SSO credentials. Nobody outside the team
can open it, and nothing stops whoever finds a URL from reading applicant data.

Those tables and the analytics bucket have since been destroyed in the account, so there
is nothing left to point at. That removes the one thing that made this awkward: there is
no live store to migrate, protect, or work around. CDK creates every data store from
nothing.

This change is the whole move onto AWS — every part of the system defined in CDK,
deployed, and locked behind a login.

It runs in phases because the phases have to land in order: there is no point wiring
a backend to an API Gateway that does not exist, and no point deploying a scoring job
before it has tables to read. Phases 1, 3, and 4 are written out below; phase 2 gets its
detail when we reach it.

## Phases

| Phase | Scope | State |
| --- | --- | --- |
| 1. Front door | CDK app, CloudFront + S3 hosting, Cognito user pool, API Gateway with a JWT authorizer, the `dev` data stores | Written |
| 2. API compute | Lambda handlers on boto3 behind the phase-1 API Gateway — no web framework; settle the route contract. Its first two routes are settled here: list a scholarship's rubric versions, and publish one | Next |
| 3. Scoring workers | Two Lambdas that score unprocessed applications — one on-demand, one through Bedrock batch | Written |
| 4. The screens | The output: a dashboard that starts the work, and a scholarships screen that searches a cohort, ranks it by score, and reads the per-criterion scores | Written |

Four phases, and that is the whole of this change. A second environment, CI/CD, and the
guardrails that go with a real deployment (WAF, alarms, budgets) are left out for now, not
scoped — a later change picks them up once one environment is running. There is no
migration phase: nothing survives in the account to migrate.

The human in the loop is not a phase here at all. Sign-off, the review queue, and the
AI-detection gate are their own capability, part-written in
`specs/human-in-the-loop/spec.md`.

Phase boundaries can move. The table above is what we expect now, not a commitment — a
phase's section is written when the phase comes up.

## What Changes

**Phase 1 — the front door:**

- Add a CDK app under `infra/` that defines the deployed system in TypeScript, with
  one environment (`dev`) to start.
- Serve the built web app from a private S3 bucket through CloudFront over HTTPS,
  with origin access control so the bucket is never public.
- Stand up a Cognito user pool. Users are created by an admin; there is no public
  sign-up. Hosted UI handles the login screen.
- Put an API Gateway HTTP API in front of the (not yet deployed) backend, with a
  Cognito JWT authorizer that rejects unauthenticated calls. Routes get their
  integrations in phase 2 — this phase proves the edge and the auth check.
- Serve the API through the same CloudFront distribution as the app, under `/api/`, so
  there is one hostname per environment and no cross-origin calls at all. The
  distribution forwards `Authorization` and caches nothing under `/api/`.
- Create the `dev` DynamoDB table and the `dev` S3 bucket. They start empty, and they
  are the only copies — CDK defines them from nothing, with no import step.
- **One table per environment, not one table per entity.** Applications, scores, and
  rubrics live in `dev-scholarship` together, told apart by a prefix in the partition key.
  Applications sit in their cohort's partition so a cohort is one Query; scores sit in a
  partition per application so a cohort read never pulls reasoning text along. The environment
  is the only thing that gets its own table — it is an access-control and lifecycle boundary,
  where a wrong table name is an error and a wrong key prefix would be a silent read of
  production. The full field list is in the spec's data model section. `pk` and `sk` cannot be
  changed after the table exists; one secondary index is created — the ranking index, keyed on
  scholarship, year, and rubric version with the total as its sort key — and nothing else.
- Rewrite the web app's edges against the standard AWS pieces: hosted-UI sign-in with
  the authorization-code flow and PKCE, the access token on every request, refresh
  before expiry, relative `/api/` paths, and scoring states on screen instead of an
  assumed-ready score. Build-time config carries the user pool and sign-in domain — no
  API base URL, because the API is same-origin.

**Phase 3 — the scoring workers:**

- A worker that claims applications not marked `processing` and scores them one at a time
  through Bedrock's Converse API.
- A second worker that claims the same kind of work and sends it as a single Bedrock
  batch job, reading results back from S3.
- Claim-before-score so two workers never grade the same application, bounded retries,
  and failures left visible instead of stuck.
- **Started by hand, never on a schedule or an upload.** A person presses a button on the
  dashboard for the scholarship and year they picked. The count decides the path: under 500
  applications the on-demand worker, at 500 or more a batch job. A person can override it.
  Below 500, on-demand finishes while they are still at the screen; above it, waiting hours
  for cheaper tokens is the better trade.
- Only the batch path uses S3 — Bedrock batch takes its records as a file and writes results
  back as one, under its own prefixes in the environment's bucket. The on-demand path writes
  no objects at all.
- One shared prompt builder and one shared reply check, so both workers agree.
- Per-criterion scores as the source of truth, with the total stored beside them and
  stamped with the rubric version whose weights made it. A weight change is a recompute
  over scores already stored — arithmetic, not a model call.

A worker is done when the score is stored. No reviewer sign-off, no review queue, and
no AI-detection gate in this phase — those belong to `human-in-the-loop`.

Batch inference does not support tool calling or structured output, so the batch worker asks
for JSON in the prompt rather than forcing a tool call. It can take `Converse`-format input,
so both workers share one prompt builder and one reply check.

**Phase 4 — the screens:**

The web app already has three screens. Phase 4 gives each one its job under the new model:

| Screen | Its job in phase 4 | Where it came from |
| --- | --- | --- |
| Dashboard | A trigger section, and for now that is all: upload a workbook, publish and pick a rubric, every Lambda trigger, progress. The reliability analysis is kept in the code below it, not rebuilt | Built as a read-only reliability argument off last year's human scores. That argument is kept — it is waiting on data, not wrong — and the trigger section is added above it |
| Scholarships | Search a cohort, rank it by score highest or lowest, read the per-criterion scores, export | Already the ranked-list screen with a filter panel on top. Same job; the filter panel is extended into the advanced search |
| Reviews | Nothing yet. It says sign-off is not built | Built as the human-review queue with tiebreaker submission — exactly the capability we deferred |

- **The dashboard carries the upload.** A person picks a workbook there and it lands in the
  uploads prefix, where ingest reads it. That is the only way an export gets in, and the only
  thing the upload sets off — the file landing does not start scoring.
- **The dashboard carries the rubric.** A person uploads a rubric's text there, types a weight
  beside each criterion the parse found, checks what came out, and publishes it as a version.
  The trigger section picks which published version a run is for, defaulting to the newest.
  Nothing is seeded and no file in the repo is special — `rubric.md` is the file you would
  upload first. A published version is never edited; a correction is the next version, because
  every stored total names the version whose weights made it. The two routes behind this are
  phase 2's first, since nothing can be scored until a version exists.
- **The dashboard carries the triggers.** Score the unscored, recompute totals after a weight
  change, rescore what changed, retry what failed — each scoped to a scholarship and year, and
  nowhere else in the app starts any of them. Progress is read off the applications themselves:
  a cohort Query already returns each one's state, so done, running, and left are counts over
  data already fetched. No run record is stored, because nothing about a run is not already on
  the items.
- **Nothing on the dashboard is deleted, and nothing but the trigger section is rebuilt.** The
  reliability sections belong to a different feature that is only waiting on last year's reader
  scores, so they stay as they are and say they are waiting on data. What they cannot do is hold
  up the new work: the upload, the triggers, and the progress counts depend on no human score,
  fetch on their own, and are scoped to one cohort while the reliability sections span every
  scholarship.
- **The scholarships screen carries the search window.** Scoped to a scholarship and a year:
  find an application, rank the cohort, open one and read its per-criterion scores and evidence.
  The advanced search is the filter panel already in
  `apps/web/src/features/scholarships/applications-list.tsx` carried forward and extended, not a
  second search built beside it. What changes underneath is the data — the cohort id and the
  score fields both move with the new model — and the markup.
- **DynamoDB does the ranking.** One secondary index, keyed on scholarship, year, and rubric
  version with `total_score` as its sort key, returns a ranked page already in order — highest
  and lowest are the read direction, and nothing sorts a cohort in a handler or in the browser.
  No score record is opened until someone opens an application.
- Unscored applications, failed ones, and any whose total came from an older rubric version
  are absent from that index, because the attribute that puts an application into it is written
  with a comparable total and removed with one. They are reported as counts off the cohort
  read, so a part-scored cohort cannot look like a finished leaderboard and two sets of weights
  are never ordered against each other.
- Export what the screen is showing as JSON. Plain JSON, not a dump of the raw items: no
  claim holder or expiry, no attempt count, no content hash, no raw keys, no storage-engine
  type wrappers. Unscored and failed applications are in the file with their state, so the
  export never quietly drops someone, and it repeats the screen's warnings — unreviewed
  scores, coverage counts, and what it leaves out. Built from data the screen already
  fetched, so nothing is written to S3.
- **Reasoning and evidence are a checkbox, defaulting to off.** Per-criterion scores sit on the
  application, so an unchecked export is a client-side build off one Query — about a megabyte
  for 5,000. Reasoning sits on the score items, so a checked one reads the newest score item per
  application: a `BatchGetItem` on keys the cohort read already gave us, a hundred at a time,
  around fifty requests and roughly eight megabytes for a full cohort. Checking the box says
  what it is about to do first, and a missing score item leaves that applicant in the file with
  its reasoning marked not read rather than failing the whole export. Exporting one open
  application always carries the full text — the detail screen already read it.
- **Search matches the stored fields, not the essays.** The identifier, program, level, major,
  and GPA. Reaching into essay text would mean either pulling every essay on every cohort load
  — the read cost the projection exists to avoid — or standing up a search service, which
  nothing here is scoped for. A word typed from an essay returns nothing, and the screen says
  what search covers rather than looking broken.
- Every score is marked unreviewed. With no sign-off built, this screen is the last thing
  a person sees, and the top of a sorted list must not read as a decision.
- **The review screen stays shut.** Sign-off, the review queue, and the AI-detection gate are
  `human-in-the-loop`, which is not built. The screen says so rather than showing an empty
  version of itself, and nothing on the other two screens offers a reviewer identity, an
  approval, or a comparison against a human score.
- **Built from the app's own components.** The web app already has a design system —
  shadcn/ui in the `new-york` style on a zinc base with lucide icons, under
  `apps/web/src/sjsu/components/ui`, plus the page shell, header, sidebar, empty-state, and
  table-empty-overlay pieces beside it. The sortable ranked list is the existing `table`
  plus `sortable-head` and `use-table-sort`. Two styling generations exist in the tree —
  `features/scholarships/` hand-rolls its inputs, buttons, and table with hard-coded colours;
  `features/applications/` and `sjsu/` use the components and semantic tokens. Carry the
  behaviour forward from the first, the markup from the second. The screens add no UI
  dependency and no second styling approach; if it looks like they need one, that is a
  decision to raise, not something to install while building.

With `human-in-the-loop` deferred, this is the end of the line: the pipeline goes workbook
in, score stored, score found and read.

**No name column.** The export is anonymized — the `Student` column is a UUID, and that UUID
is the applicant's identifier throughout. Nothing stores a name, and search matches the UUID
and the stored fields beside it.

**Not in phase 1:** the API's compute, the route contract, campus SSO federation, a
custom domain, WAF, CI/CD, and any change to scoring or review logic. The current UI screens are not a fixed contract — the web app is rewritten
against the deployed AWS pieces, and later phases may reshape both the API and the calls
the UI makes.

## Starting point: the Lambdas that already exist

Two Lambdas are already written, on branches in the `cuzethan` remote rather than in
`main`. They are now copied into `lambdas/` on this branch:

- `lambdas/parse-applications` from `upstream/feat/phase1-sjsu-general`
- `lambdas/score-applications` from `upstream/feat/connect-frontend-backend` (its
  committed `deployment.zip` was left behind)

They are a **sample, not the final product**. They are in the tree to show a working
shape — the handler layout, the workbook parsing with `openpyxl`, the strict-JSON scoring
call, and the SJSU General rubric. The workers in phase 3 are written against the spec,
using these for reference. The defects below are recorded so nothing copies them across;
they are not a fix list for the sample.

One change was made to the sample on the way in: **every total was stripped**. The model
is told not to produce one, `validate` no longer requires one, and `_write_score` no
longer stores one. `WEIGHTS` and `calculate_final_score` are gone from `prompt.py`, the
`## Weighted total` section is gone from the rubric text, and the dead
`_update_application` went with them.

What the spec asks for is not the same thing as what was stripped. The sample's problem was
a total the *model* produced, validated and then thrown away, and a second total computed
from a copy of the weights kept in the Lambda. The spec stores a total, but it is worked out
from the per-criterion scores using the weights on the rubric record, and it carries the
rubric version that produced it. The per-criterion scores stay the source of truth, so a
weight change is a recompute over data already stored rather than a rescore.

**The other parser was not taken.** `upstream/feat/lambda-parse-trigger` has a rewritten
`parse-applications` that cannot be used:

- It keys the table on `availability_id`, which its own config documents as the raw
  scholarship label from the sheet. Every applicant to one scholarship writes to the same
  item, so 4,887 rows become one.
- It maps the `Student` column — a UUID — to `student_name`.
- It writes no `application_key`, no `qa_pairs`, and no `status`, which are the three
  fields the scoring Lambda reads. Paired with the scorer it would skip every record.
- It adds `pandas` to read a workbook `openpyxl` already reads, which means a layer or a
  container image for no gain.

The version we took writes `application_key`, `qa_pairs`, and `status: "parsed"`, so the
two Lambdas fit together as taken.

What must not carry over. Each of these is covered by a requirement in the spec:

- **A re-upload wipes scores.** The parser writes with `put_item`, which replaces the
  whole item, so re-ingesting a workbook drops `llm_weighted_score`, `criterion_scores`,
  and `needs_human_review`, and resets `status` to `parsed`.
- **The application key is the student UUID alone.** The same student in two years is one
  item, and the second ingest overwrites the first. `batch_writer(overwrite_by_pkeys=...)`
  also drops duplicate rows inside one file without saying so.
- **A truncated model reply becomes a real score.** `extract_json`'s last-resort branch
  regexes out whatever criteria it can find and returns them with
  `reasoning_summary: "JSON repaired - partial parse"`. `validate` accepts that, and the
  weighted total is then computed from a partial set — a cut-off reply scores low instead
  of failing.
- **`validate` does not check the criteria.** It never checks that all five are present,
  that the names match the weight table, or that a score is within its category's max. An
  unknown name contributes nothing (`WEIGHTS.get` returns `None` and is skipped) and an
  out-of-range score inflates past 100.
- **The JSON repair that claims to fix newlines is a no-op.** `re.sub(r'(?<!\\)\n',
  '\\n', ...)` — `re.sub` reads `\n` in the replacement as a newline, so it substitutes
  newlines for newlines.
- **A failed re-score leaves the old score in place.** `_write_score` drops `None`
  fields, so `status` becomes `score_failed` while the previous `criterion_scores` and
  `llm_weighted_score` stay — a record that reads failed and still shows a score.
- **Retries re-send identical input.** Three attempts at `temperature: 0` with the same
  prompt and no error fed back: same reply, three times the cost.
- **`_update_application` is never called.** Dead code, so the applications table never
  learns an item was scored. The sample is driven by a stream off that table, so calling it
  would have fed the trigger its own writes. The spec starts a run from a button instead, so
  the loop cannot happen — but a worker still has to write back to the application, which is
  what the sample never does.
- **Partial failures are reported as success.** The handler returns `200` for the whole
  batch, so a transient Bedrock error is written as a permanent `score_failed`.
- **Copies of the weights.** Three of them: `prompt.py:WEIGHTS`,
  `apps/api/main.py:REVIEW_WEIGHTS`, and the evaluation harness. Stripping the total
  removed the first. The remaining two still disagree with nothing yet, but there is no
  single home for the weight table — see below.
- **Two different numbers were both called the total.** `SCHEMA_INSTRUCTIONS` asked the
  model for `weighted_total` as "sum of criterion scores (max 15)", while
  `calculate_final_score` returned a weighted percentage out of 100, and that was what got
  stored as `llm_weighted_score`. The model's number was validated and then thrown away.
  Both are gone from the sample.

`infra/template.yaml` on `upstream/feat/lambda-parse-trigger` is SAM, and its tables key
on `availability_id` while every handler keys on `application_key`. The CDK app replaces
it rather than porting it.

**Two rubric texts, and `rubric.md` is the one to publish.**
`rubric.md` at the repo root and `lambdas/score-applications/sjsu_general_rubric.md` cover the
same five criteria with the same maxima. One difference changes scores: `rubric.md` presses for
half points ("expected and encouraged"), adds a 0.5 level to Extracurricular Activities, and
says so six times, while the Lambda's rubric never mentions them. `validate` accepts floats
either way, so both run and nobody notices which one is loaded.

Neither file is read at run time, and neither is seeded. A rubric version is published from the
dashboard, and `rubric.md` is the file to upload for the SJSU General five — an input, not a part
of the system. The prompt is assembled from the published version's criteria and preamble. The
uploaded file is kept beside them as provenance and never sent to a model: a file the model read
while the ranges came from the criteria would put the maxima in two places — the same drift we
removed from the weights, in a place where the model and the reply check would disagree quietly.

**Half points are allowed, on every criterion.** `rubric.md`'s level text is what the first
published version carries, so half points are in the prompt the worker assembles; the Lambda's
copy goes with the sample. A score is a whole or half point up to its
criterion's maximum, and the reply check enforces that step — a reply of 3.7 fails rather
than being rounded, because rounding is the check inventing a score the model did not give.
On the 0–1 criterion at 10% weight, that step is worth 5 out of 100, which is the reason it
is a rule and not a tolerance.

**The weight table now has a home, and so do the criteria.** With `WEIGHTS` gone from the
Lambda, the rubric item's `criteria` carries one entry per criterion — id, name, maximum,
weight, and level descriptions. Nothing else holds a copy: the prompt text, the reply check,
the weighted total, and a screen's per-criterion columns all read it. Hardcoding the five in the
frontend would put back the duplication we just removed, in the place it drifts most quietly.
A scholarship whose criteria are not the SJSU General five is then a rubric item, not a code
change. No `kind` field on a criterion — it would be for the AI-detection gate, which is
deferred, and `criteria` is a list of maps so adding it later is a field, not a migration.
Who may publish a version and how is settled: anyone with an account, by uploading the rubric on
the dashboard, with the weights typed on screen and refused unless they sum to 100. Publishing on
its own changes nothing that is already scored — the version a total was made under is stored on
the application, so a new version only reaches a cohort when someone starts a run for it.

**On caching — dropped, because the prompt is too small.** The system prompt is the assembled
rubric plus the schema block: 3,936 characters as measured on `rubric.md`, about 1,000 tokens.
The minimum cacheable prefix is
4,096 tokens on every current Claude model, so a cache would never engage. The count is
estimated from characters, not measured — there is no API key here — but a 4× margin makes
that good enough to decide on.

Worth stating plainly because the failure is quiet: an undersized cache checkpoint does not
error, the call just succeeds without caching. So "no cache" is written into the spec as a
requirement, and run logs are required to report no saving. A genuinely larger static prefix
would change the answer — the questionnaire approach in `docs/architecture.md` would get past
4,096; a 4 KB rubric will not.

## Capabilities

### New Capabilities

- `aws-platform`: the deployed platform — how the web app is served, who can sign in,
  how the API is reached, where data lives, the scoring workers, and the screen that shows
  the results. One spec for the whole overhaul, with a section per phase. Phases 1, 3, and
  4 are written; phase 2 is a stub in the same file.
- `human-in-the-loop`: where a person decides — sign-off, the review queue, and the
  AI-detection gate. Part-written: the rules that hold whatever we decide are in place,
  and the shape of the loop is still open. Nothing here is built yet.

### Modified Capabilities

None — this is the first spec in the repo.

## Impact

- **New**: `infra/` becomes a CDK TypeScript app (currently a README saying deploy is
  deferred). Adds `aws-cdk-lib` and `constructs` as dev dependencies in that package,
  plus the pnpm workspace entry.
- **`apps/web`**: rewritten at its edges rather than patched. Sign-in through the hosted
  UI, tokens on every call, relative `/api/` paths, and scoring states surfaced in the
  screens. The screens themselves are no longer treated as a fixed contract. There is no
  login page today — no `login` or `password` anywhere in `apps/web/src` — so Cognito's
  managed login page becomes the login page, branded to match.
- **Auth library**: no new dependency. Cognito covers authentication end to end — the
  managed login page, password policy, reset, lockout, MFA, and token issuing — and API
  Gateway's JWT authorizer covers verification. What Cognito cannot do is live in the
  browser, so the web app owns four small steps: redirect to `/oauth2/authorize` with a
  PKCE challenge, swap the code at `/oauth2/token`, hold the tokens, and refresh before
  expiry. That is one file of plain `fetch`, not a reason to add `aws-amplify`.
  Authorization@Edge would move even that out of the app, but Lambda@Edge is us-east-1
  only, has no environment variables, replicates on every deploy, and the code is still
  ours — not worth it for one internal app.
- **`apps/api`**: unchanged in phase 1 — it stays the local `uvicorn` app, and only its
  future front door is built here. In phase 2 it is replaced rather than deployed: the
  routes become Lambda handlers that read the API Gateway event and talk to AWS with
  boto3. FastAPI, `uvicorn`, and any WSGI/ASGI adapter go, along with their
  dependencies. The scoring workers in phase 3 are boto3 from the start. Running a
  handler locally means calling it with a test event, not starting a server.
- **Runtime dependencies**: the API and scoring handlers need boto3 only, which the
  Lambda runtime already provides. The parser needs `openpyxl` to read a workbook, so
  that one Lambda ships a bundle or a layer. The rubric parser is standard library only — it
  reads plain text, so no markdown library is added. Nothing else is added to the Python side —
  in particular not `pandas`.
- **AWS**: new resources in the `dxhub-automation` account — S3, CloudFront, Cognito,
  API Gateway, DynamoDB. Requires a one-time `cdk bootstrap`. Nothing is imported: the
  old `sjsu-*` tables and the `sjsu-scholarship-data-analysis-export` bucket were
  destroyed in the account, so CDK is creating these stores rather than adopting them.
- **Cost**: phase-1 resources are pay-per-request or free-tier at this scale;
  CloudFront and API Gateway have no idle charge.
