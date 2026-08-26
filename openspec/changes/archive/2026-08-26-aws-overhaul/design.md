## Context

See `proposal.md` — Why. The constraints that shape the design, and nothing else:

- **Nothing survives in the account.** The `sjsu-*` tables and the export bucket were
  destroyed, so CDK creates every store. There is no import step, no migration, and no
  window where old and new both exist.
- **`apps/api` is a FastAPI app on `uvicorn`.** It is not deployed and will not be. Phase 2
  replaces it with Lambda handlers on boto3; phase 1 builds the front door in front of
  nothing.
- **The web app is Vite + React 18 + Tailwind 4 + shadcn/ui**, not Next.js — `CLAUDE.md`
  says Next.js and is wrong about this. There is no router: `App.tsx` switches on a
  `useState` view key against `NAV_ITEMS` in `sidebar.tsx`. That matters for the deep-link
  requirement, which is a CloudFront viewer-request rewrite, not a routing change.
- **Two UI generations are in the tree.** `features/scholarships/` hand-rolls its inputs,
  buttons, and table with hard-coded colours. `features/applications/` and `sjsu/` use the
  component library and semantic tokens. Phase 4 takes behaviour from the first and markup
  from the second.
- **Two Lambdas exist as samples** in `lambdas/`, on branches rather than `main`. They show
  a working shape. The defect list in `proposal.md` is what must not be copied.
- **The rubric weights and the rubric text have one home**: the `criteria` list on the rubric
  item, which a published version writes. Two weight copies are still in the tree
  (`apps/api/main.py:REVIEW_WEIGHTS` and the evaluation harness) and both go when their code
  goes. `rubric.md` is one file someone can upload, and it has no weights in it — only maxima
  and level descriptions, which is why weights are typed at publish time.

## Goals / Non-Goals

**Goals:**

- One CDK app that defines everything, deployable from nothing to a working environment.
- One hostname per environment, so the API needs no CORS. The single exception is the
  browser's PUT of an export straight to S3, which the bucket answers with one rule.
- Scoring that cannot run without someone asking, cannot double-score an application, and
  cannot turn a truncated model reply into a real score.
- Screens that read the pipeline honestly: part-scored looks part-scored, unreviewed says
  unreviewed, and a missing input says it is missing.

**Non-Goals — design-level, beyond the proposal's scope list:**

- **No abstraction over AWS.** Handlers call boto3 directly. No repository layer, no
  service registry, no dependency-injection container.
- **No shared runtime package between web and infra.** The CDK app and the web app agree
  on names through build-time config, not a generated client.
- **No local emulator.** Running a handler locally means calling it with a test event.
  No LocalStack, no DynamoDB Local, no SAM local.
- **One index, no index tuning.** `pk` and `sk` are pinned, and the ranking index is the
  only secondary index. Anything else waits until a cohort proves it needs more.

## Decisions

### One CDK app, stacks split by lifecycle

What talks to what is in the spec's Architecture section, and is not redrawn here. What this
section decides is which stack a thing goes in, and that is a table:

| Stack | What is in it | On `cdk destroy` |
| --- | --- | --- |
| `DataStack` | the `<env>-scholarship` table and its `rank-by-total` index, the `<env>` bucket | `RETAIN` — the data survives |
| `EdgeStack` | the user pool, hosted UI domain and app client; the site bucket; CloudFront and its `spa-rewrite` function; the HTTP API and JWT authorizer; `api-placeholder` | pool `RETAIN`, the rest goes |
| `ComputeStack` | one Lambda per job: `rubric-versions`, `rubric-publish`, the remaining route handlers, `ingest-worker`, `score-ondemand`, `score-batch` | all of it goes |

Three stacks, split by how long the thing inside lives, not by phase. The data stores outlive
every redeploy; the front door and the compute are replaceable. Phase 1 adds nothing to
`ComputeStack` — it synthesises empty — while phases 2 and 3 both fill it. A phase is a unit of
work, not a unit of deployment.

Every Lambda in `ComputeStack` is its own function with its own IAM policy: a handler gets the
table, a worker gets the table plus the prefixes it uses and the model it calls. The two rubric
handlers are named because they are settled and land first — nothing can be scored before a
version is published. The rest of phase 2's route contract is open, so it is one row and not
five guesses.

`api-placeholder` is the one Lambda deployed today, and it is in `EdgeStack` rather than
`ComputeStack` on purpose: it exists to prove the token check and the `/api/*` behaviour work,
so it belongs to the front door and goes when the real routes arrive.

**The user pool is in `EdgeStack`, because sign-in and the front door are the same
deployment.** The app client's callback URL is the CloudFront domain, and the JWT authorizer
needs the client — so the two point at each other. In one stack CloudFormation orders that
itself. Split across two, one of them has to go up before the other's name exists, which
makes signing in a two-pass deploy: the pool up with a placeholder callback, the
distribution, then the pool again with the real domain. That is a step someone forgets once
and then cannot sign in.

Nothing is risked by putting it there. The pool carries `RETAIN`, so a `cdk destroy` of
`EdgeStack` leaves the hand-created accounts alone — the same protection a separate stack
would have given it.

*Alternative — one stack.* Simpler, and wrong here for one reason: a bad `cdk destroy`
would take the applicant data with it. The split is a blast-radius decision.

*Alternative — a stack per phase.* Would leave the table in "phase 1" forever and make
every later phase read a cross-stack export to find it. Lifecycle is the more stable line.

### The API is same-origin under `/api/`, not its own domain

CloudFront has two behaviours: the default serves the web build from a private S3 bucket
through origin access control, and `/api/*` forwards to the API Gateway. `Authorization`
is forwarded; nothing under `/api/` is cached.

This takes CORS off the API rather than configuring it. No preflight on any call, no
allow-list to keep in sync with a new environment, and the web app calls relative paths so
it needs no API base URL at build time.

*Alternative — a separate API domain with CORS.* One more certificate, one more DNS name,
and a preflight on every non-GET. Nothing gained for an internal app.

### The one cross-origin request is the upload, and the bucket answers it

An export goes from the browser to the bucket with a presigned PUT, so a few thousand rows
never pass through a Lambda. That URL is on the bucket's own hostname, and a PUT is never a
simple request, so the browser preflights it — and S3 answers a preflight only if the bucket
carries a CORS rule. So it carries exactly one: `PUT` alone, origins the environment's
CloudFront domain and the Vite dev server, nothing else. The API keeps none.

The rule needs the distribution's domain, which is only known once the distribution exists,
so the environment bucket reads it from the edge stack. That is the one place the long-lived
stack depends on a replaceable one, and it is a name, not a resource.

*Alternative — POST the file to a Lambda that writes it to the bucket.* Same origin, no rule
to add. Refused because API Gateway caps a request at 6 MB and a binary body is base64 on the
way in, so the real ceiling is about 4.5 MB — the size class of the intake we already have,
and a limit nobody can raise.

*Alternative — a `/uploads/` behaviour on the distribution.* Keeps the PUT same-origin, but a
presigned S3 URL signs the S3 hostname, so it cannot be used through CloudFront. It would take
CloudFront signed URLs, a key group, a public key in the stack, and an OAC that permits writes.

### Two file formats, one row reader

The office exports the intake either way, so ingest takes an `.xlsx` and a `.csv`. The split is
at decoding only: `openpyxl` for a workbook, the standard library's `csv` module for a CSV, and
both hand back the same thing — a header line and rows after it. Everything past that point is
shared, which is what keeps the two formats from drifting into two column maps. Nothing about
the cohort changes: the scholarship comes from the `AvailabilityId_t` column and the year from
the file name, neither of which a sheet tab was ever involved in.

**A CSV out of Scholarship Manager is not UTF-8, so the encoding is tried in order.** The export
we have — 1,903 rows of the SJSU General 25-26 intake — carries `0x92` bytes, the Windows-1252
curly apostrophe, inside the essays. Read as strict UTF-8 that is not a bad character, it is a
`UnicodeDecodeError`, and the whole file fails on one apostrophe. So a CSV is decoded as
`utf-8-sig` first and as `cp1252` if that raises. The order is what makes it safe: UTF-8 is
self-validating, so a file that decodes clean as UTF-8 almost certainly is UTF-8, while `cp1252`
maps every possible byte and therefore can never fail — reaching for it first would turn a real
UTF-8 export into mojibake with nothing raised to say so.

`utf-8-sig` rather than `utf-8` for the same reason the fallback exists. A spreadsheet program
saving UTF-8 puts a byte-order mark in front of the first column name; left on, the header check
sees a first column that matches nothing and refuses the file for having no header row — a true
statement about the bytes and a useless one to the person who exported it. The file we have has
no BOM, but the one someone re-saves out of Excel will.

**Fields run across lines, so the `csv` module reads them, never a line split.** 1,377 of those
1,903 rows have an essay with a newline inside its quotes, and the longest single field is 5,261
characters. Anything that treats a line as a record turns most of the intake into fragments that
resolve to no student.

Three filters have to name both suffixes, and each one silently drops the file if it does not:
the EventBridge rule on the bucket, the upload handler's filename check, and the file picker on
the dashboard. The rule takes two wildcard matchers rather than a suffix list, because a list of
matchers is an OR and `uploads/` with a bare suffix would also fire on a file anywhere else in
the bucket. The `~$` lock-file skip stays workbook-only — that is a thing Office does, and a CSV
never has one.

*Alternative — convert a CSV to a workbook on the way in.* One reader downstream, but it means a
conversion step that can fail on its own, and it would rewrite the file kept as provenance.

### The API is called with the ID token, not the access token

Publishing a rubric version records who published it, and that has to be readable by a person.
A Cognito access token carries `sub`, `username`, `scope`, and `client_id` — no email. The ID
token carries the email, and the API Gateway JWT authorizer validates either one against the
same pool and app client, so the app sends the ID token.

*Alternative — keep the access token and add the email to it.* A pre-token-generation trigger
can do it, but access-token customization needs the user pool on the Essentials tier, which is
a monthly bill for one claim.

*Alternative — record the subject instead.* Nothing to change anywhere, and `published_by`
becomes a UUID, which is provenance nobody can use.

### A trigger takes only the work it names

Scope starts from the rubric version: an application whose stored version already matches is
not work. Within that, each of the four dashboard triggers narrows further to the state it
names — never scored, failed, or scored under a different version — because a button labelled
"retry failed" that also scores the unscored is a button that lies. The narrowing is a filter
the run is given; it cannot widen the version comparison, only cut it down.

### Deep links are rewritten at the viewer, not mapped from an S3 error

There is no router: a request for `/reviews/<key>` is not an object in the bucket. So the
app shell has to be served for it. A CloudFront Function on the default behaviour's viewer
request rewrites a URI whose last segment has no `.` in it to `/index.html`. Hashed assets
have their own `/assets/*` behaviour and never reach the function.

*Alternative — map 403 and 404 to `/index.html` with a 200.* The obvious way, and it breaks
the spec's "missing asset still errors" scenario. Custom error responses are
distribution-wide, and with origin access control S3 answers 403 for **any** key it cannot
serve — so a deep link and a stale `/assets/main-a1b2c3.js` reference look identical at that
layer. Mapping them both would turn a missing script into an HTML 200: a blank page with
nothing in the console to say why. Rejected.

The cost of the rewrite is one edge case: an in-app route whose last segment contains a dot
gets the real 403 instead of the shell. Application keys are UUIDs, so nothing today hits it.

### Cognito hosted UI with the authorization-code flow and PKCE — and no auth library

Cognito does authentication end to end: the login page, password policy, reset, lockout,
MFA, and token issuing. API Gateway's JWT authorizer does verification, at the edge,
before any handler runs. What is left for the browser is four steps — redirect to
`/oauth2/authorize` with a PKCE challenge, swap the code at `/oauth2/token`, hold the
tokens, refresh before expiry. That is one file of plain `fetch`.

*Alternative — `aws-amplify`.* A large dependency for four steps we would still have to
understand. Rejected.

*Alternative — Authorization@Edge (Lambda@Edge).* Would move the redirect out of the app,
at the cost of: us-east-1 only, no environment variables, replication on every deploy, and
the code is still ours to write. Rejected.

*Implicit flow* is not considered — it puts tokens in the URL.

### Access is all or nothing, and an admin in the user pool is what grants it

There is one level of access: you have an account or you do not. An admin creates it in the
user pool, and that account can reach every route and every screen. No groups, no scopes
beyond `openid`, `email`, and `profile`, and no role claim anyone reads — the JWT authorizer
checks that a token came from this pool and this app client, and nothing behind it asks who
the caller is.

That is enough because everyone with an account is a scholarship reviewer on the same
committee, and because there is nothing yet for a role to gate: sign-off is
`human-in-the-loop` and not built, and the triggers on the dashboard are for whoever is
running the cohort. A role model with one role in it is a thing to maintain, not a control.

Adding one later is a Cognito group and a claim check, not a rearrangement — which is the
reason to wait rather than guess at the roles now.

### One table, prefixes instead of table names

The layout is in the spec's data model section. The reasoning for it:

- **A cohort is one Query.** Applications live in their cohort's partition, so the ranked
  list, the progress counts, and the export all come from a single call.
- **Reasoning text never rides along.** Scores live in a partition per application, so
  reading 4,887 applications does not pull 4,887 blocks of essay reasoning with them.
- **Every attempt is kept.** A score's sort key is the time it was written, so a rescore
  appends instead of overwriting.
- **The environment is the only thing that gets its own table**, because that is the
  boundary where a mistake matters: a wrong table name fails loudly, a wrong key prefix
  would be a silent read of production.

Two traps worth naming here, because both are silent:

- **`qa_pairs` is most of an application's bytes.** Any cohort-wide read — the ranked list,
  the progress counts, the export — uses a `ProjectionExpression` that leaves it out.
  Whole maps project fine; individual map elements cannot, so `category_scores` comes back
  entire or not at all.
- **`status` and `year` are reserved words.** Every expression touching them needs
  `ExpressionAttributeNames`. This is the kind of thing that works in testing and fails on
  the one query nobody ran.

*Alternative — three tables, as the old code had.* Three names, three policies, and a read
across tables to rank a cohort. No benefit at this size.

### Per-criterion scores are the source of truth; the total is derived and stamped

The worker stores each criterion's score, then computes the total from the weights on the
rubric item and stores it with the `rubric_version` that produced it.

That stamp is what makes two later operations different things:

| A rubric version changes | What runs | Why |
| --- | --- | --- |
| weights only | recompute | arithmetic over scores already stored — no model call |
| any criterion's id, name, max, or level text | rescore | arithmetic cannot produce scores for criteria that did not exist |

Without the stamp, a ranked list can silently mix totals made from two sets of weights,
which reads as a leaderboard and is not one.

The sample Lambda got this wrong twice over: it asked the *model* for a total, validated
it, threw it away, then computed a second total from a copy of the weights kept in the
Lambda. Both are stripped. The model is not asked for a total at all.

### Claim before score, with an expiry

A worker conditionally writes `claimed_by` and `claimed_until` on an application whose
`status` is not `processing`, and only scores what the write succeeded on. The claim
expires, so a worker that dies mid-run releases its work instead of parking it forever.

`claimed_by` holds a run id on the on-demand path and the Bedrock batch job's name on the
batch path. That is why a run needs no record of its own: the state of a submitted job is a
read of any claimed item in the cohort.

**The expiry only guards the on-demand path.** A batch job is submitted with a 36-hour
timeout, and Bedrock refuses anything under 24, so there is no expiry that both rescues a
dead Lambda in minutes and leaves a live job alone for a day and a half. The batch claim's
expiry is therefore set past 36 hours and does nothing useful; what actually releases a
batch item is the job reaching a terminal state. Without that split, a second run would steal
items out from under a running job — scoring them twice, and then having the collector
overwrite the newer scores with the older job's output.

*Alternative — SQS with a visibility timeout.* The right tool if work arrived
continuously. It does not: work arrives when a person presses a button, and the queue would
be a second place to look for the state the items already carry.

### 500 applications is the line between the two workers

Below 500, the on-demand worker: seconds to finish, full token price. At 500 or more, a
Bedrock batch job: hours to finish, cheaper tokens, no rate-limit pressure. A person can
override the choice.

The number is a judgement about who is waiting, not a measured throughput limit. Below it
the person who pressed the button is still at the screen; above it they were never going to
wait anyway, so the cheaper tokens win.

**There is a floor under the batch path, and 500 clears it.** A batch job has a minimum
number of records, set per model as a service quota; AWS's examples put it at 100. So the
automatic choice can never hit the floor — anything routed to batch is at least 500. Only a
manual override can, which is why the override is allowed to be refused rather than
silently downgraded: someone who asked for batch on 40 applications should be told why they
cannot have it.

**Batch inference does not support tool calling or structured output**, so the batch worker
asks for JSON in the prompt instead of forcing a tool call. It *can* take `Converse`-format
input (`modelInvocationType`), which is what lets both workers share one prompt builder and
one reply check rather than maintaining two shapes that drift apart.

### The batch job's own event starts the collector

`score-batch` is one function with two entry points: an invocation that submits and returns,
and an invocation that reads the output. Nothing polls. A Lambda caps at 15 minutes and the
job is given 36 hours, so waiting inside the invocation is not an option, and a schedule
would mean either a slow pickup or a lot of empty runs.

The trigger is an EventBridge rule on `source: aws.bedrock`, `detail-type: "Batch Inference
Job State Change"`, narrowed to the terminal statuses — `Completed`, `PartiallyCompleted`,
`Failed`, `Stopped`, `Expired`. Only the first two can carry results; the other three release
the claims with the reason recorded.

**Finding the cohort is the awkward part.** The event carries `detail.batchJobArn` and
`detail.batchJobName` and nothing about applications. There is no index on `claimed_by`, so a
job identifier alone gives a Query no partition to read. The job name would be the obvious
carrier and is not usable: 63 characters, no spaces, `[a-zA-Z0-9]` with limited punctuation,
while a scholarship name is raw text out of an export column. So the collector calls
`GetModelInvocationJob` and takes the cohort out of `inputDataConfig.s3InputDataConfig.s3Uri`
— the worker chose that key when it submitted, so the key is where the cohort is written down.
The job name stays human-readable-ish for the console, and `clientRequestToken` keeps a
retried submission from creating a second job.

**Reading the output.** Bedrock writes into a folder named for the job id under the configured
output URI: one `.jsonl.out` per input file, whose lines are `{recordId, modelInput,
modelOutput}` with `error` in place of `modelOutput` for a record that failed, plus a
`manifest.json.out` carrying `totalRecordCount`, `processedRecordCount`, `successRecordCount`,
and `errorRecordCount`. The manifest is a free reconciliation check: if the items written do
not match its counts, the run is reported failed rather than looking complete. Collecting the
same job twice is harmless because the writes are keyed by application and conditional on the
claim still naming that job.

**`batch/` gets a lifecycle rule.** `modelInput` is echoed into every output record, so the
bucket ends up holding two copies of each applicant's essays — in a versioned bucket set to
`RETAIN`, forever. The objects are only needed while a run can still be looked into, so they
expire, non-current versions included.

### No prompt caching, on either path

The static part of the prompt — the assembled rubric plus the schema block — is 3,936
characters, about 1,000 tokens, measured on `rubric.md`, the text the SJSU General version is
published from. The minimum cacheable prefix is **4,096 tokens on every current Claude model**;
the 1,024 figure in Bedrock's table belongs to older ones like Claude 3.7 Sonnet. A quarter of
the minimum is not a near miss, so caching is dropped rather than deferred. A much longer rubric
could be published later and cross the line, which the spec covers as a scenario rather than
something to build for now.

The measurement is an estimate from character count — `ANTHROPIC_API_KEY` is not set here,
so the token-counting endpoint was not called. It does not need to be: at 3.6 characters per
token the prompt is ~1,093 tokens and at 4.0 it is ~984, and even an implausible 2.0 would
land at ~1,968. Every reading is well under 4,096.

What is kept is the discipline, not the feature: the static part stays byte-identical
between calls, with nothing per-item inside it. That costs nothing and is what a cache would
need if the prefix ever grows — the questionnaire approach in `docs/architecture.md` would
get past 4,096, a 4 KB rubric will not.

*Why this matters more than a dropped optimisation.* An undersized cache checkpoint does not
fail. The call succeeds and the prefix simply is not cached, so a cache built on this prompt
would look like it worked and save nothing. The spec therefore requires that no cache is
claimed and that run logs report no saving, which turns a plausible-looking number into a
spec violation.

### The reply check fails closed

The sample's `extract_json` had a last-resort branch that regexed out whatever criteria it
could find and returned them tagged `"JSON repaired - partial parse"`; `validate` accepted
that, and a truncated reply became a low score. The check here requires every criterion the
rubric names, matching ids, and each score inside its criterion's maximum. Anything else is
a failure, not a partial result.

A failed rescore must not leave the previous score visible. The sample dropped `None`
fields on write, so an application could read `score_failed` and still show a score. Here a
failure clears the derived fields it invalidates.

Retries feed the error back into the next attempt. Three identical calls at
`temperature: 0` cost three times as much and return the same reply.

A reply that ran into the output token limit is told apart from a malformed one by the model's
own `stopReason`, not by inspecting the text. The reply carries the answer already: guessing at
it from unbalanced brackets both mislabels ordinary bad JSON and misses a reply that stopped at
the limit on a boundary that happens to parse.

### Phase 4: the dashboard is a trigger section, and the rest is left alone

For this phase the dashboard is one thing: the trigger section — the export upload, the rubric
panel and its version picker, the four triggers, and progress. That is what gets built. The
reliability sections already on the screen — the
human-versus-human against AI-versus-human comparison, the reviewer distribution, and the
per-criterion and per-scholarship breakdowns — are kept where they are, below it. They are a
different feature, waiting on reader scores being stored and a read that returns the comparison.
Both belong to the reviewer-score change, not this one, so what that half reads is settled there.

| Half | Depends on | Scope | This phase |
| --- | --- | --- | --- |
| Trigger section | the cohort Query only | one scholarship and year | built |
| Reliability analysis | reviewer scores and an agreement read | every scholarship, except the coverage figure | kept, says waiting on data |

The split is about the fetch, not the choice. Each half fetches on its own, because the
reliability query failing must not blank the triggers — the current screen returns early on
`statsLoading || analyticsLoading` for the whole page, and that early return is what has to go.
The cohort a person picked goes the other way: the page holds it and hands it to both, because
the coverage figure below counts scoring for the cohort the triggers above run for. Two pickers
let those two numbers describe different cohorts with nothing on screen admitting it. The
breakdowns that span every scholarship take no cohort and are unaffected.

Where a reliability section has nothing, it says so rather than rendering a zero, a percentage
of nothing, or an empty chart — any of which reads as a result.

*Alternative — rebuild the reliability sections on the component library at the same time.*
Rejected for now: it is markup work on a feature with no data behind it, and it would put the
half that cannot be finished on the critical path of the half that can.

*Alternative — comment the reliability sections out until the data arrives.* Rejected: the
user asked for the code kept, and a commented-out screen rots faster than a rendered one
saying "waiting on data".

### Phase 4: the search is the existing filter panel, extended

`features/scholarships/applications-list.tsx` already fetches a cohort, holds a ten-field
filter state, filters in a `useMemo`, and renders numbered ranked rows. That is the search.
It is carried forward, not replaced.

Two things change underneath it:

- **The data.** It keys on `availability_id` — the raw scholarship label from the sheet —
  and reads `human_weighted_total`, `llm_weighted_score`, `final_weighted_score`,
  `variance_pct`, and `needs_human_review`. The cohort id becomes scholarship plus year,
  and of those five score fields only a stored `total_score` survives. Any filter left
  pointing at a field that no longer exists is dropped or repointed — a filter matching
  against nothing is worse than no filter.
- **The markup.** Rebuilt on the component library: `Table` with `SortableHead` and
  `useTableSort` for the ranked list, `TableEmptyOverlay` for the four states, semantic
  tokens instead of `amber-100` and `red-600`.

`useTableSort` already cycles descending, ascending, then off, which is exactly "highest,
lowest, or unsorted". It stays as the control; what changes is what it drives — the direction
of the index read, rather than an in-memory sort.

### DynamoDB does the ranking — one index, no sorting anywhere else

The ranked list is a Query on one secondary index: partition key
`RANK#<scholarship>#<year>#<rubric_version>`, sort key `total_score`. A Query comes back in
sort-key order, so "highest" and "lowest" are the read direction and nothing sorts a cohort —
not the handler, not the browser. No score item is opened to order the list.

Putting the rubric version in the partition key does two jobs with one key. Totals made from
different weights are in different partitions, so a ranked read cannot mix them; and the
worker writing `rank_pk` alongside a total is what puts an application into the index at all.
Unscored and failed applications never get the attribute, so the index is sparse and they are
absent from it by construction rather than by a filter someone has to remember. Their counts
come from the cohort Query, which the progress display already makes.

*Alternative — sort the projected cohort in the handler or the browser.* Works at 4,887 and
needs no index, but it makes every ranked view read the whole cohort, and holding two rubric
versions apart becomes a filter in application code — the kind that is correct until someone
adds a code path that forgets it. The index makes it a key.

Applications that are unscored, failed, or stamped with a rubric version that is not the
cohort's are held out of the ranking and reported as counts. Ranking them as zero would put
them at the bottom of a list that reads as an ordering of merit.

### Reasoning in an export is a checkbox, defaulting to off

Per-criterion scores sit on the application item. Reasoning and evidence sit on the score
item. The checkbox is what decides whether the export crosses that line:

| Export | Carries | Cost |
| --- | --- | --- |
| Cohort, box unchecked | scores and maxima, total, rubric version, state | client-side off the Query it already made. ~1 MB for 5,000 |
| Cohort, box checked | the same, plus every criterion's reasoning and evidence | one score-item read per application. ~8 MB for 5,000 |
| One open application | always the full text | free — the detail screen read that score item to render |

**Default off, because the two differ by more than a field.** Unchecked is a download button.
Checked is 4,887 reads. Making that the default would put the expensive path behind the
obvious click.

**The reads are `BatchGetItem` on exact keys, not a scan or a Query per application.** The
application item carries `latest_scored_at`, which *is* the sort key of its newest score item
(`SCORE#<latest_scored_at>`). So both key parts are known from the cohort read that already
happened — a hundred keys per request, about fifty requests for a full cohort. Slow enough to
show progress against, cheap enough not to need a job, a queue, or an S3 object.

*Alternative — a Query per application.* 4,887 round trips instead of 50, for the same data.
The only reason to prefer it would be wanting every historical attempt rather than the newest,
which no export asks for.

*Alternative — put the reasoning on the application item too, so one Query covers it.* That
is what the data model exists to avoid: it would drag every criterion's reasoning into every
cohort read, ranking and progress counts included, to serve an export nobody runs most days.

**A missing score item does not fail the export.** That application stays in the file with its
scores and its reasoning marked as not read. An export that dies at applicant 3,000 because
one score item is gone is worse than one that says which entries are incomplete.

No export is a dump of the raw items: no claim holder or expiry, no attempt count, no content
hash, no raw keys, no DynamoDB type wrappers — none of it means anything outside the pipeline.
Unscored and failed applications are in the file with their state, so an export cannot quietly
drop an applicant, and every export repeats the screen's warnings.

### Search matches the stored fields, not the essays

Search covers the applicant identifier, program, level, major, and GPA. It does not read
essay text.

Reaching into the essays would mean one of two things. Filtering in the browser needs the
essay text on every cohort load — and `qa_pairs` is the bulk of each item, which is exactly
the read cost the `ProjectionExpression` exists to avoid. A search service does the job
properly but adds a component, a cost line, and an index to keep in sync with the table.

A word typed from an essay returns nothing and the screen says what search covers, rather
than looking broken.

### Nothing holds a copy of the criteria

The prompt, the reply check, the weighted total, and a screen's per-criterion columns all
read the `criteria` list on the rubric item. No criterion id, name, maximum, or weight is
written into a worker, a handler, or the web app.

**That includes the rubric text itself.** The prompt's rubric section is assembled from the
criteria and the preamble — names, maxima, level descriptions, and the rubric's own grading
instructions — not read from a file at run time. The file a version was published from is kept
on the item as provenance and never sent to a model. Sending it while the ranges came from the
criteria would put the maxima in two places, which is the same drift we removed from the
weights: the file says a criterion is out of 4, the item says 3, and the model and the range
check disagree without either being obviously wrong.

*Alternative — send the uploaded file and keep only ids, maxima, and weights on the item.* One
less assembly step, and the level text stops being data: a scholarship with different criteria
then needs its file kept somewhere the worker can read, and the maxima exist twice. Rejected.

We just removed three copies of the weight table. Hardcoding the five criteria in the
frontend and the prompt would put two of them straight back — the frontend copy being the
worse one, because it drifts silently and only shows up as a mislabelled column.

The payoff: a scholarship whose criteria are not the SJSU General five is a rubric item, not
a code change. A changed maximum or weight is followed by the prompt, the range check, and
the total at once, because none of them has its own version of it.

*No `kind` field on a criterion* (`scored` / `gate` / `computed`). It would be needed for the
AI-detection gate, which is `human-in-the-loop` and deferred, and for a computed criterion,
which nothing asks for. `criteria` is a list of maps, so adding the field later is a field,
not a migration. Every criterion today is scored, weighted, and model-judged.

### Rubrics are published from the dashboard, and nothing is seeded

A rubric arrives one way: someone uploads its text on the dashboard, types a weight beside each
criterion the parse found, checks what came out, and publishes it as a version. There is no
seeded first item and no file the system treats as special. `rubric.md` is the file you would
upload first.

**The parse is strict and refuses rather than guesses.** A criterion opens with
`Category: <name> (0-<max>)`; a level is `- <value> = <text>`; `===` fenced blocks and the text
before the first criterion are the rubric's preamble; other prose inside a block is that
criterion's guidance. That is `rubric.md`'s own shape, so the format describes what the
committee already writes rather than adding something to learn. A file that does not match is
refused with the line that stopped it.

The strictness is the point. A maximum drives the prompt, the range check, and how much that
criterion is worth in the total, so a parser that guessed one would move scores without failing
anything — the sample's JSON repair, which turned a truncated reply into a low score, is the
same mistake one layer down. The preview is the second guard: a person reads the maxima and
levels that came out before a version exists.

*Alternative — upload the criteria as JSON.* Nothing to parse and nothing to guess, and it makes
publishing a rubric a programming task. The people who set a rubric write prose. Rejected.

*Alternative — parse leniently and let the preview catch the mistakes.* The preview is a person
reading five criteria carefully, which is exactly the check that erodes once it has passed a few
times. Rejected.

**Weights are typed, not parsed.** `rubric.md` has none, and inventing a syntax for them gives
a file that can disagree with itself. They are a policy number the committee sets, so they are
entered per criterion and refused unless they sum to 100.

**A published version is immutable.** Every stored total names the version whose weights made
it, so editing one in place would change what that name means for scores already written. A
correction is the next version. The write is conditional on the version number not existing, so
two people publishing at once get two versions rather than one silently overwriting the other.

**Publishing records who did it, and that is not an access check.** `published_by` is the email
claim off the API Gateway event. The access decision above — nothing behind the authorizer
decides anything from who the caller is — still holds: this reads the caller for provenance, and
everyone with an account may publish.

**Nothing can be scored until a version is published**, which is why the two rubric routes are
phase 2's first settled routes rather than phase 4 work beside the screen. The workers in phase 3
read a rubric item; the route that writes one has to come before them.

### The review screen stays shut

Sign-off, the review queue, and the AI-detection gate are `human-in-the-loop`, which is not
built. The screen says that rather than rendering an empty version of itself. Nothing
elsewhere offers a reviewer identity, an approval, or a comparison against a human score.

`human-in-the-loop/spec.md` is written here only as far as the rules that hold whatever we
decide. No task in this change implements any of it, and nothing in this change's four phases
depends on it. It is left alone from here on — the shape of the loop is a later change's to
settle.

## Risks / Trade-offs

- **Two criteria have no essay to read.** The parser maps three essay columns —
  `career_goals`, `challenge_or_mistake`, `extracurricular_activities` — against five rubric
  criteria. Initiative & Self-Motivation and Creativity have no question of their own, so the
  model judges them across the same three answers it used for the other three. That is a
  scoring-validity question, not a plumbing one: a criterion with no dedicated evidence is
  the weakest score in the set, and it carries weight in the total like any other. → Named
  here so it is a known limit rather than a surprise. Fixing it properly means either a
  questionnaire that asks about those two, or a rubric whose criteria match the questions
  asked. Both are outside this change.

- **Half points are allowed everywhere, so the reply check has to enforce the step.**
  Accepting floats without a step rule is how 3.7 becomes a stored score. → The check
  requires a whole or half point within each criterion's maximum and fails anything finer.
  It does not round — rounding would be the check inventing a score the model did not give.
  The level descriptions the prompt is assembled from come from `rubric.md`, which says half
  points are expected; the Lambda sample's rubric, which never mentions them, is not used.

- **Prompt caching is dropped — the prompt is too small for it.** Settled, see Decisions.
  Worth keeping as a risk in one respect: nothing stops someone adding a cache checkpoint
  later and believing it works, because an undersized prefix does not error. The call
  succeeds and the prefix quietly is not cached. → The spec makes "no cache is claimed" a
  requirement with a reporting scenario, so a false saving in a log line is a spec violation
  rather than a plausible-looking number.

- **`pk` and `sk` cannot be changed after the table exists.** Everything else about the
  table can be. → They are pinned in the spec's data model and nothing else is. If the key
  layout is wrong, the fix is a new table and a re-ingest — which the empty account makes
  cheap now and expensive later.

- **A new rubric version could look like it invalidated every stored total.** It doesn't:
  publishing writes to no application, so every total keeps the version that made it and every
  ranked list stays where it was. A cohort only moves when someone starts a run for the new
  version. → Who may publish, and how, is settled: anyone with an account, by uploading the
  rubric on the dashboard. A run is how a cohort catches up.

- **A published rubric can be wrong in ways nothing here can check.** Weights that sum to 100
  and levels inside their maxima say the file is well formed, not that the rubric is sound — a
  criterion can be worth 40% of the total on a two-line description and nothing will object. →
  The screen shows what was parsed and what each criterion will be worth before a version
  exists, and says plainly that it checked the shape and not the judgement. Whether a rubric is
  the right rubric is the committee's call, and no screen implies otherwise.

- **CloudFront invalidation is eventually consistent.** A deploy that uploads new assets
  and invalidates can serve a stale `index.html` against new hashed chunks for a few
  seconds. → Hashed filenames plus a no-cache `index.html`, so the worst case is one stale
  page load, not a broken app.

- **The reliability half of the dashboard has no route behind it in this change.** The screen
  calls an agreement read that the reviewer-score change owns, so here it can only fail. → It is
  kept, kept independent so it cannot break the half that does work, and it says the comparison
  is not built rather than reporting a failed fetch as agreement. Nobody should be able to look
  at it and think a small gap was measured.

- **`font-mondwest` is used in `features/applications/applications-table.tsx` and defined
  in no stylesheet.** A dead class that will silently fall back. → Remove it when that file
  is rebuilt in phase 4.

## Migration Plan

There is nothing to migrate. The stores were destroyed, so the first deploy comes up empty
and an export has to be uploaded before any screen has something to show.

Deploy order, once per environment:

1. `cdk bootstrap` — one time, in `dxhub-automation`.
2. `DataStack`, then `EdgeStack`. Data first because everything else references it. This first
   pass warns that there is no web build to publish, which is expected — the build needs the ids
   this pass produces.
3. Create the first user in the pool by hand. There is no public sign-up.
4. Build the web app with the pool id and sign-in domain, then deploy again. The deploy publishes
   the build and invalidates the distribution; a new environment is deploy, build, deploy, and
   after that a deploy publishes whatever the last build wrote.
5. Upload an export from the dashboard, so the scholarship has a cohort.
6. Publish the first rubric version from the dashboard — `rubric.md` uploaded, weights
   10/40/30/10/10 typed in. Nothing can be scored before a version exists, because the prompt,
   the range check, and the total are all built from it.
7. Press the scoring button.

**Rollback.** Redeploy the previous `EdgeStack` and `ComputeStack`; both are replaceable.
`DataStack` is not rolled back — it carries `RETAIN` and holds the only copy of the data. A
schema mistake inside the table is fixed forward, by a re-ingest rather than a stack
rollback.

## Open Questions

None. Everything that was open is decided and written into the spec: half points, the export
split, where the criteria live, and — after checking rather than asking — how an applicant is
identified, the batch job shape, and prompt caching. What the checks found:

| Was open | Answer | Where it landed |
| --- | --- | --- |
| What the `Student` column holds | A UUID. The export is anonymized on purpose and the name field is set to `None` in the parser | No name column: the UUID is the identifier, nothing stores a name, and search matches the UUID plus program, level, major, and GPA |
| Bedrock batch's job shape | Verified against the docs. Minimum records is a per-model service quota, AWS's examples say 100 | The worker reads the quota instead of hardcoding it, and 500 clears the floor either way |
| Whether the prompt is big enough to cache | No — about 1,000 tokens against a 4,096-token minimum | Caching dropped from both paths, and "no cache is claimed" is now a requirement |

One thing surfaced that nobody had asked about: **three essay questions against five rubric
criteria.** It is recorded under Risks rather than left as a question, because it is a limit
to state, not a decision this change can make.
