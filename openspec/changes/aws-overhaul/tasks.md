## 0. What the checks found

The facts this change was waiting on are settled. Nothing here blocks a task any more — the
answers are in the spec and design, and they are recorded here so nobody re-opens them.

- **The `Student` column holds a UUID, and there is no name column.** The export is anonymized
  on purpose: `scholarship_config.py` maps `Student` to `student_uuid`, and `handler.py` sets
  the name to `None` with the note "not present in this anonymized data". The UUID is the
  applicant's identifier throughout. Nothing stores a name and nothing searches one.
- **The prompt is too small to cache.** The assembled rubric plus the schema block is 3,936
  characters as measured on `rubric.md`, about 1,000 tokens, against a 4,096-token minimum on
  every current model. Estimated from character count, not measured — `ANTHROPIC_API_KEY` is not
  set — but a 4× margin makes the answer safe. Caching is dropped from both paths.
- **The batch job shape is verified.** `CreateModelInvocationJob` takes `jobName`, `roleArn`,
  `modelId`, `inputDataConfig.s3InputDataConfig.s3Uri`, and
  `outputDataConfig.s3OutputDataConfig.s3Uri`; poll with
  `get_model_invocation_job(jobIdentifier=jobArn)['status']`. Input may be `Converse` format
  via `modelInvocationType`, so both workers share one prompt shape. Batch supports no tool
  calling and no structured output. The minimum records per job is a per-model service quota,
  not a fixed number — AWS's examples say 100.
- **Three essay questions, five rubric criteria.** The parser maps `career_goals`,
  `challenge_or_mistake`, and `extracurricular_activities` only. Initiative & Self-Motivation
  and Creativity have no question of their own. Recorded as a limit in `design.md`; fixing it
  is outside this change.
- **No rubric is seeded.** A rubric version arrives by being published, and nothing can be
  scored until one exists. That is why the two rubric routes in section 4 come before the
  workers rather than beside the screen that uses them.

## 1. CDK app skeleton

- [x] 1.1 Turn `infra/` into a CDK TypeScript app: `cdk.json`, `tsconfig.json`, entry point,
  and `aws-cdk-lib` + `constructs` as dev dependencies. Add it to the pnpm workspace.
- [x] 1.2 Read the environment name from CDK context so `dev` is a parameter, not a literal.
  Every resource name that has to be unique carries it.
- [x] 1.3 `cdk bootstrap` against `dxhub-automation`, one time.
- [x] 1.4 `cdk synth` produces three empty stacks — `DataStack`, `EdgeStack`, `ComputeStack`
  — and nothing is deployed yet.

## 2. Phase 1 — data stores, auth, and the front door

- [x] 2.1 `DataStack`: the `<env>-scholarship` table, `pk`/`sk`, on-demand billing,
  point-in-time recovery, encryption at rest, `RETAIN` on delete.
- [x] 2.2 `DataStack`: the ranking index — `rank_pk` (`RANK#<scholarship>#<year>#<rubric_version>`)
  as partition key, `total_score` as sort key, projecting the fields the ranked list shows and
  not `qa_pairs`. It is the only secondary index.
- [x] 2.3 `DataStack`: the `<env>` bucket with the `uploads/` and `batch/` prefixes,
  versioning, encryption, TLS-only bucket policy, public access blocked, `RETAIN` on
  delete. No `analytics/` prefix — no export writes to S3.
- [x] 2.4 `EdgeStack`: Cognito user pool with self sign-up off, admin-created accounts, a
  password policy, and a hosted-UI domain. An app client for the web app using the
  authorization-code flow with PKCE and no client secret. An admin creating an account in the
  pool is the whole of authorization — no groups, no scopes beyond `openid`, `email`, and
  `profile`, and no role claim anyone reads. The pool sits here rather than in a stack of its
  own because the client's callback URL is the CloudFront domain and the authorizer needs the
  client; one stack is what keeps signing in a single deploy.
- [x] 2.5 `EdgeStack`: private S3 bucket for the web build, CloudFront distribution in front
  of it with origin access control. The bucket is not reachable by its own URL.
- [x] 2.6 `EdgeStack`: a CloudFront Function on the default behaviour's viewer request
  rewrites an extensionless URI to `/index.html`, so a deep link loads the app instead of an
  S3 error. Not distribution-wide error responses: those are not per-behaviour, and with
  origin access control S3 answers 403 for any key it cannot serve, so mapping 403 and 404 to
  a 200 would turn a missing hashed asset into a blank HTML page. `/assets/*` has its own
  behaviour and never reaches the function.
- [x] 2.7 `EdgeStack`: cache policy — hashed assets cached long, `index.html` not cached.
- [x] 2.8 `EdgeStack`: API Gateway HTTP API with a Cognito JWT authorizer, no route
  integrations yet, and a default response that reads no table and no bucket.
- [x] 2.9 `EdgeStack`: add the `/api/*` behaviour on the same distribution, pointing at the
  API Gateway, forwarding `Authorization`, caching nothing. The API carries no CORS
  configuration — same origin is the point. The one exception in the whole system is the
  environment bucket, which answers the browser's upload `PUT` (task 8.1).
- [x] 2.10 Access logging on the API so a rejected call leaves a line with path, method,
  status, and why the check failed. No token or applicant field in a log line.
- [x] 2.11 Deploy all three stacks. Create the first user by hand. Check that an
  unauthenticated `/api/` call is rejected at the edge and never reaches an integration.

## 3. Phase 1 — the web app's edges

- [x] 3.1 Build-time config carries the user pool id, app client id, and sign-in domain.
  No API base URL — the API is same-origin.
- [x] 3.2 One auth module of plain `fetch`: redirect to `/oauth2/authorize` with a PKCE
  challenge, swap the code at `/oauth2/token`, hold the tokens, refresh before expiry. No
  new dependency.
- [x] 3.3 Replace `API_URL` in `apps/web/src/api.ts` with relative `/api/` paths, and put
  the access token on every request. A 401 sends the user back through sign-in.
- [x] 3.4 Point the deployed rubric weights at the rubric item's `criteria`, and delete
  `REVIEW_WEIGHTS` from `apps/api/main.py` when that code goes in phase 2. The weight table
  has one home.
- [x] 3.5 Build, upload to the site bucket, invalidate. Sign in through the hosted UI and
  reach the app.

## 4. Phase 2 — the first routes: rubrics

The rest of phase 2's route contract is still open. These two are settled and land before the
workers, because a worker builds its prompt from a rubric item and publishing is the only thing
that writes one.

- [x] 4.1 The rubric parser. `Category: <name> (0-<max>)` opens a criterion — the first
  `(<int>-<int>)` on the line, the rest of the line dropped. `- <value> = <text>` inside a block
  is a level. `===` fenced blocks and any prose before the first `Category:` line are the
  rubric's `preamble`; other prose inside a block is that criterion's `guidance`. A criterion's
  id is its name slugged. A file that does not match is refused with the line that stopped it —
  no lenient branch, nothing guessed at, nothing corrected on the way in. A guessed maximum
  would move every score under it without failing anything.
- [x] 4.2 Publish validation, every rule refusing rather than correcting: at least one
  criterion; ids unique after slugging; each maximum above zero and each minimum zero; a level
  at 0 and a level at the maximum; level values whole or half points within the maximum and none
  repeated; one weight per criterion, each above zero, summing to 100.
- [x] 4.3 List a scholarship's rubric versions: one Query on `RUBRIC#<scholarship>`, newest
  first. No index.
- [x] 4.4 Publish a version: parse, validate, then write `criteria`, `preamble`, `source_file`,
  `source_text`, `published_at`, and `published_by` under the next `V#v<n>`. The write is
  conditional on that sort key not existing, so two people publishing at once get two versions
  and the loser retries at the next number. Nothing is written to any application, and a
  published version is never updated in place.
- [x] 4.5 `published_by` is the caller's email claim off the API Gateway event. Reading it is
  provenance, not an authorization check — nothing behind the authorizer decides anything from
  who the caller is, and everyone with an account may publish.
- [x] 4.6 `source_text` is stored and never read at run time. The prompt is assembled from
  `criteria` and `preamble`; no handler, worker, or screen sends the uploaded file to a model.
- [x] 4.7 IAM: the rubric handlers get the table and nothing else. No bucket, no Bedrock.

## 5. Phase 3 — the scoring workers

The rest of phase 2 — the remaining routes and their handlers — has no tasks yet. The workers
below are triggered directly until those routes exist.

- [x] 5.1 Shared prompt builder and shared reply check, used by both workers. Both read the
  rubric item's `criteria` and `preamble` — no criterion id, name, maximum, or weight is written
  into the code. The check requires every criterion the rubric names, ids that match, and each
  score inside its criterion's maximum. A reply that misses any of that is a failure — there is
  no partial parse and no JSON repair branch.
- [x] 5.2 Half-point rule in the reply check: a score is a whole or half point up to the
  criterion's maximum. Anything finer fails and is not rounded. The rule holds whatever the
  published text says about half points.
- [x] 5.3 Weighted total from the per-criterion scores using the weights on the rubric item,
  stamped with the `rubric_version` that produced it. The model is never asked for a total.
- [x] 5.4 Claim before score: conditional write of `claimed_by` and `claimed_until` on an
  application whose `status` is not `processing` and whose stored `rubric_version` is not the
  version the run is for. Only what the write succeeded on is scored. An expired claim is
  reclaimable on the on-demand path. On the batch path the expiry is set past the job's 36
  hours and only the job reaching a terminal state releases the items — a clock-based reclaim
  would steal work out of a running job. The run's version is the only thing that decides what
  is in scope — there is no separate record of which version a cohort belongs to.
- [x] 5.5 Ingest worker: reads an uploaded workbook with `openpyxl`, writes applications into
  the cohort partition keyed by scholarship, year, and student. It never uses `put_item` on
  an existing item, so a re-ingest cannot drop `category_scores`, `total_score`, or
  `rubric_version`. Duplicate rows inside one file are reported, not silently dropped. It
  writes no name field — the `Student` UUID is the identifier, and the sample parser's
  `student_name` mapping goes with the sample.
- [x] 5.6 Write-back on success: `category_scores`, `total_score`, `rubric_version`,
  `rank_pk`, `latest_scored_at`, and `status: scored` on the application, plus an immutable
  score item under `SCORE#<timestamp>` carrying each criterion's reasoning and evidence, the
  model id, which worker produced it, and its token counts. `rank_pk` is what puts the
  application into the ranking index, so it is written with the total and removed when a
  failure invalidates one.
- [x] 5.7 On-demand worker: Bedrock Converse, one application per call. No cache checkpoint
  and no cache figures in the log — the prompt is a quarter of the minimum size. The static
  part stays byte-identical between calls anyway, which costs nothing.
- [x] 5.8 Batch worker, submit half: writes one record per claimed item under `batch/` in
  `Converse` format via `modelInvocationType`, submits a `CreateModelInvocationJob` with
  `timeoutDurationInHours: 36` and a `clientRequestToken` so a retry cannot create a second job,
  then returns. No tool call and no structured output — JSON is asked for in the prompt.
  `claimed_by` holds the job name, and the input key carries the cohort.
- [x] 5.9 Batch worker, collect half: the same function, invoked by an EventBridge rule on
  `source: aws.bedrock`, `detail-type: "Batch Inference Job State Change"`, filtered to
  `Completed`, `PartiallyCompleted`, `Failed`, `Stopped`, `Expired`. Nothing polls and nothing
  sleeps. The cohort comes from `GetModelInvocationJob` →
  `inputDataConfig.s3InputDataConfig.s3Uri`, not from the event — the job name is 63 characters
  with no spaces and cannot carry a scholarship name.
- [x] 5.10 Reading the output: the job-id folder under the output URI, one `.jsonl.out` per
  input file, each line `{recordId, modelInput, modelOutput}` with `error` in place of
  `modelOutput` for a failed record. Match `recordId` to the application key. Check the written
  count against `manifest.json.out` (`totalRecordCount`, `successRecordCount`,
  `errorRecordCount`) and report a mismatch as a failed run. A claimed item with no record in
  the output is marked failed with a reason. Writes are conditional on the claim still naming
  that job, so collecting twice changes nothing.
- [x] 5.11 A job that produced nothing — `Failed`, `Stopped`, or `Expired` — releases every item
  it held with the attempt count raised and the reason recorded. The reviewer is told the job
  did not run, not shown an empty result. `PartiallyCompleted` stores the good records and fails
  the rest.
- [x] 5.12 Lifecycle rule on `batch/` in `DataStack`: current and non-current versions expire.
  Bedrock echoes `modelInput` into its output, so without this the versioned `RETAIN` bucket
  keeps two copies of every applicant's essays for good.
- [x] 5.13 Read the minimum-records quota for the model rather than hardcoding it, and refuse a
  set below it instead of submitting a job that cannot run. Release the claims, say how many
  records a job needs, and do not hand the work to the on-demand worker instead — the automatic
  500 line clears the floor, so only a manual override can reach it, and it is told why rather
  than downgraded quietly.
- [x] 5.14 Failure handling: bounded attempts with the error fed back into the next one — not
  three identical calls at `temperature: 0`. A failure clears the derived score fields it
  invalidates, so nothing reads `score_failed` and still shows a score.
- [x] 5.15 Per-item results, not a per-batch status. A transient Bedrock error is retried, not
  written as a permanent `score_failed`, and the handler does not return 200 for a batch that
  partly failed.
- [x] 5.16 IAM: each worker gets the table, the prefixes it uses, and the Bedrock model it
  calls. Nothing broader. `score-batch` also needs `GetModelInvocationJob` and the pass-role for
  the job's service role, and that role reaches only `batch/` in this environment's bucket.
- [x] 5.17 Recompute worker: moves a cohort's totals to a version that changed weights and
  nothing else, by arithmetic over the per-criterion scores already stored. No Bedrock policy
  on it, no score item written, and no per-criterion score rewritten. The move is conditional on
  the version the application was read at, so a scoring run that got there first keeps its
  number. An application whose stored version differs in anything the model saw — a criterion's
  id, name, maximum, level text, guidance, or the preamble — is left alone for a rescore.

## 6. Phase 4 — the screens

- [x] 6.1 Two reads, and nothing else touches the table from a screen: a cohort read — one
  Query on the cohort partition with a `ProjectionExpression` that leaves out `qa_pairs`, and
  `ExpressionAttributeNames` for `status` and `year`, serving search, states, and counts — and a
  ranked read, one Query on the ranking index. Every feature below uses one of the two.
- [x] 6.2 Scholarships screen: carry forward the filter panel from
  `features/scholarships/applications-list.tsx`. Repoint the cohort id to scholarship plus
  year, drop or repoint any filter whose field the new model does not have, and rebuild the
  markup on `Table`, `SortableHead`, `useTableSort`, and `TableEmptyOverlay`. No hand-rolled
  input, button, or table, and no hard-coded colour. Remove the dead `font-mondwest` class.
  Search matches the identifier and the stored fields only — no essay text. A word typed from
  an essay returns nothing and the screen says what search covers.
- [x] 6.3 Per-criterion columns are built from the rubric item's `criteria`, in its order, for
  the version the shown totals were made under. No criterion name, maximum, or weight is written
  into the web app.
- [x] 6.4 Ranking is a Query on the ranking index, read in the direction the person asked for.
  Nothing sorts a cohort in a handler or in the browser. `useTableSort` already cycles highest,
  lowest, off — keep it as the control and have it drive the read direction, and do not add a
  second sort control.
- [x] 6.5 Unscored, failed, and older-rubric-version applications are absent from the index by
  construction, so no filter holds them out. Count them off the cohort read and say so beside
  the list. None of them is ranked as zero.
- [x] 6.6 Application detail: open one application and read its per-criterion scores,
  reasoning, and evidence from its score item. Nothing else opens a score item.
- [x] 6.7 Mark every score unreviewed, on the list and on the detail, and say how much of the
  cohort a ranking covers.
- [x] 6.8 Dashboard: split the page into two independent fetches and delete the
  `statsLoading || analyticsLoading` early return. The reliability half failing must not
  blank the trigger section, and the two do not share a cohort picker — the trigger section is
  scoped to one scholarship and year, the reliability sections span every scholarship.
- [x] 6.9 Dashboard: keep every reliability section as it is — human-versus-human against
  AI-versus-human, reviewer distribution, per-criterion and per-scholarship breakdowns. They
  are not rebuilt in this phase and not deleted; the trigger section sits above them. Where
  there is no human score, the section says it is waiting on data and renders no number, no
  percentage, and no empty chart.
- [x] 6.10 Dashboard: upload. Pick a workbook, it lands under `uploads/`, ingest reads it, and
  the screen says how many rows came in. The upload starts nothing else.
- [x] 6.11 Dashboard: the rubric panel. Pick a rubric file, it is parsed on the way in, and the
  screen shows what came out — every criterion with its maximum and its levels, beside the file
  as uploaded — before anything is published. A file that does not parse shows the line that
  stopped it and publishes nothing.
- [x] 6.12 Dashboard: weights are typed on screen, one per parsed criterion, with the running
  total beside them. Publish stays unavailable until they sum to 100. Nothing infers a weight
  from a maximum or reads one out of the file.
- [x] 6.13 Dashboard: publishing says which version number it wrote and that no cohort moved.
  The screen says it checked the rubric's shape and not its judgement — a criterion can be worth
  40% of the total on two lines of description and nothing will object.
- [x] 6.14 Dashboard: a published version is offered read-only, not as something to edit. A
  correction is a new publish.
- [x] 6.15 Dashboard: the trigger section gets a rubric version picker for the chosen
  scholarship, defaulting to the newest published. That pick is the version every trigger in the
  section runs for, and every count beside a trigger is worked out against it.
- [x] 6.16 Dashboard: a scholarship with no published version says so and offers no run, rather
  than starting one that fails when it reaches the prompt. Publishing is scoped to the
  scholarships that have a cohort, so a brand-new scholarship's workbook goes up first.
- [x] 6.17 Dashboard: the four triggers — score the unscored, recompute after a weight
  change, rescore what changed, retry what failed — each scoped to the chosen scholarship, year,
  and rubric version. A trigger with nothing to do is shown unavailable with its count at zero,
  not hidden.
- [x] 6.18 Dashboard: progress counted off the cohort read — done, running, left, failed.
  No run record is stored.
- [x] 6.19 Path choice on screen before a run starts: how many applications it covers, which
  worker it will use, and the 500 line. A person can override the choice. An override to batch
  below the minimum records is refused on screen with the number a job needs, not accepted and
  then dropped.
- [x] 6.20 Confirm no trigger, upload, publish, or recompute exists on any screen but the
  dashboard.
- [x] 6.21 Reviews screen: says sign-off is not built. No reviewer identity, no approval, and
  no comparison against a human score anywhere in the app.
- [x] 6.22 Cohort export: JSON built from the cohort the screen already fetched. Per-criterion
  scores and maxima, total, rubric version, and state. Nothing written to S3. No claim fields,
  attempt counts, content hashes, raw keys, or DynamoDB type wrappers. Unscored and failed
  applications are in it with their state, and it repeats the screen's warnings.
- [x] 6.23 A checkbox on the export for reasoning and evidence, defaulting to off. Checking it
  says how many applications will be read and that the file will be larger and slower, before
  it runs.
- [x] 6.24 With the box checked, fetch the newest score item per exported application by
  `BatchGetItem` on `APP#…` plus `SCORE#<latest_scored_at>` — 100 keys a request, keys taken
  from the cohort read. Show progress. An application whose score item is missing or unreadable
  stays in the file with its scores and its reasoning marked as not read; the export does not
  fail whole.
- [x] 6.25 Single-application export: the open application with its per-criterion reasoning
  and evidence in full whatever the box says, built from the score item the detail already read.
- [x] 6.26 Scoring states on screen: an application that is unscored, running, or failed reads
  that way instead of showing a score.

## 7. Tests

Unit tests, fast, no model call and no AWS. One end-to-end at the end, kept out of the fast
suite and run by a person — it is the only item here with no checkbox.

- [x] 7.1 Reply check: a truncated reply, a missing criterion, an unknown criterion id, and a
  score above its maximum each fail. A complete valid reply passes. This is where a wrong
  answer becomes a real score, so cover it closely.
- [x] 7.2 Half-point rule: 3.5 of 4 and 0.5 of 1 are accepted, 3.7 fails and is not rounded
  to 3.5 or 4. Rounding here would move a total by up to 5 out of 100.
- [x] 7.3 The criteria come from the rubric: a fixture rubric with a different criteria set
  and different maxima drives the prompt, the range check, and the total — nothing falls back
  to the SJSU General five.
- [x] 7.4 Weighted total: the five criteria at 10/40/30/10/10 produce the expected number out
  of 100, and it is stamped with the rubric version whose weights made it.
- [x] 7.5 Recompute versus rescore: a weight-only change recomputes from stored scores with
  no model call, and a criterion change does not.
- [x] 7.6 Claim: a second worker cannot claim an application already claimed and unexpired,
  and can claim one whose claim has expired. A run for `v2` claims an application stored at
  `v1` and skips one already at `v2`, and a run never reaches an application in another
  scholarship or year — this is what keeps a new rubric from rescoring last year's cohort.
- [x] 7.7 Ranking exclusions, at the write: storing a total writes `rank_pk` for the cohort and
  rubric version, recomputing under a new version moves it, and a failure removes it — so a
  cohort mixing scored, unscored, failed, and older-rubric applications puts only the comparable
  ones in the index, and the counts off the cohort read cover the rest.
- [x] 7.8 Export shaping: the cohort export has no claim fields, attempt count, content hash,
  raw keys, or type wrappers, and an unscored application is present with its state. With the
  reasoning box off there is no reasoning text; with it on there is. An application whose score
  item is missing comes back marked not read rather than dropped or throwing.
- [x] 7.9 Path choice at the boundary: 499 goes on demand, 500 goes to batch, an override wins
  at both, and an override to batch below the minimum records is refused rather than submitted
  or silently downgraded.
- [x] 7.10 The parser, on `rubric.md` itself: five criteria with maxima 1/4/4/3/3, the level
  values each block lists, the `Prompt:` and `Evidence can come from` lines as that criterion's
  guidance, and both `===` banners in the preamble. Drop the preamble and the prompt stops
  asking for half points, which moves scores — so this is the test that the whole file survives
  the parse, not just the criteria.
- [x] 7.11 Parser refusals, each reporting the line that caused it and correcting nothing: a
  `Category:` line with no range, a level above its maximum, a level value finer than a half
  point, a repeated level value, a block with no level at 0, and two criteria whose names slug
  to the same id.
- [x] 7.12 Weight validation: 10/40/30/10/10 publishes; 99 and 101 are refused; a missing
  weight and a zero weight are refused. A maximum is never read as a weight.
- [x] 7.13 Saving a score: the score item and the application's copy are both written, the
  total carries `rank_pk` for the cohort and version, and the application write only lands if
  the claim still names that run. A claim that moved on leaves the score item in place and the
  application untouched — the attempt is kept as history, not applied over a newer run.
- [x] 7.14 Failure state clears what a score would have said: `category_scores`, `total_score`,
  `rubric_version`, `rank_pk`, and `latest_scored_at` all go, so no screen reads a failed
  application and still shows a number. Releasing puts it back to `parsed` with the reason.
  Neither write lands when the claim no longer names the caller. A batch job that produced
  nothing releases every item it held.
- [x] 7.15 The prompt inside a batch record: the static prefix is byte-identical to the
  on-demand call's, the applicant's text follows it, the record id is the application key, and
  the record carries no tool definition and no structured-output setting. Batch supports
  neither, so a record that sends one fails the whole job hours after anyone could fix it.
- [x] 7.16 A reply cut off at the output token limit fails and writes no partial score, and its
  reason says the reply was cut off rather than that it was not JSON — the limit is the thing to
  raise, and a JSON-parse message sends whoever reads it after the wrong problem.
- [x] 7.17 Reading a job's output, on a small fixture of the real thing — one `.jsonl.out` and
  its `manifest.json.out`: each `recordId` writes to the application whose key it is, a record
  carrying `error` in place of `modelOutput` fails that item alone, and a claimed item with no
  record in the output is failed with a reason rather than left claimed. A `recordId` matched to
  the wrong application puts one applicant's score on another's row and nothing about it looks
  broken, so this is the closest cover in the batch path.
- [x] 7.18 The counts are checked, not assumed: a manifest whose `successRecordCount` disagrees
  with the number of items written is reported as a failed run. Without this a job that quietly
  dropped records reads as a finished cohort.
- [x] 7.19 Collecting the same job twice changes nothing and says the job was already done. The
  job-state event can arrive more than once, so this is ordinary traffic, not an edge case.
- [x] 7.20 A re-ingest never drops a score: reading the same workbook again leaves
  `category_scores`, `total_score`, and `rubric_version` on an application that already has them,
  and two rows in one file that resolve to the same application are reported rather than silently
  reduced to one. This one destroys work instead of failing, which is why it is worth a test.
- [x] 7.21 The attempt limit holds: an item at the limit is not picked up by any run, and one
  below it is. Wrong in one direction it retries a poison item forever on real tokens, wrong in
  the other it abandons work that deserved another go. Alongside it, a batch claim's hold outlasts
  the 36 hours a job is given, so a clock never frees an item a live job is still working on.
- [x] 7.22 Reading a workbook, on a small fixture of a few rows: the column map produces the
  fields the rest of the system expects, a filename carrying no year is refused with the file
  named, and an empty file or one with no header row is refused rather than ingested as nothing.
  The year decides which cohort every row lands in, so reading it wrong files a whole intake
  under the wrong year.
- [x] 7.23 One refresh at a time: several calls made while the access token is expiring share one
  refresh, and a refresh the directory has already refused sends the person to sign-in rather than
  retrying. Each call spending the token separately logs everyone out mid-session, and it only
  shows up when calls overlap.
- [x] 7.24 The `spa-rewrite` function, called directly with the URIs it sees: an extensionless
  path becomes `/index.html`, a path that already names a file is left alone. Wrong one way every
  deep link breaks, wrong the other a missing hashed asset comes back as HTML with a 200.
- [x] 7.25 A publish that loses the race takes the next version number instead of overwriting the
  winner: the conditional write refused once, the retry succeeds at `V#v<n+1>`. Scores are stamped
  with a rubric version, so a lost one cannot be reconstructed.
- [x] 7.26 Progress counted off the applications, not a stored run: a cohort mixing scored,
  claimed, failed, and untouched applications reports the right numbers done and left, and a
  cohort claimed by a batch job reports a wait of hours rather than reading as nearly finished.
- 7.27 One end-to-end, slow, **a person's to run, not an agent's**: upload a small workbook
  through the dashboard, publish `rubric.md` as a version with its weights, press score, wait
  for the cohort to finish, rank it, open an application, and export. Against real AWS in `dev`.
  Not part of the fast suite, and it carries no checkbox — nobody ticks this off on someone
  else's word. Whoever runs it says what they saw.

## 8. What a review found, before the deploy

Six gaps between what the earlier sections claim and what the code does. Each is small, and each
one leaves a screen or a file saying something that is not true, so they land before `dev` is
deployed.

- [x] 8.1 The upload's one CORS rule. `DataStack`: a single rule on the environment bucket —
  `PUT` alone, origins the CloudFront domain and `http://localhost:3000`, `ETag` exposed, no
  other method and no wildcard. Without it every upload dies at the preflight, because the
  browser preflights a cross-origin `PUT` and only the bucket can answer that `OPTIONS`. Create
  `EdgeStack` before `DataStack` in `infra/bin/app.ts` and pass the distribution domain in as a
  string. They are siblings today, so this adds no cycle — only `ComputeStack` depends on both.
- [x] 8.2 The API is called with the ID token. `apps/web/src/auth.ts` holds and refreshes the ID
  token alongside the access token, and `api.ts` sends the ID token as the bearer. The access
  token carries no `email` claim, so `published_by` on every rubric version is currently written
  from a claim that is not there. The authorizer accepts either token, so nothing at the edge
  changes.
- [x] 8.3 `/run` takes a scope. `shared/work.py::claimable` accepts one narrowing scope —
  never scored, failed, or scored under a different version — and applies it on top of the
  version comparison. `handlers/run.py` validates the scope and refuses an unknown one.
  Today all four dashboard triggers start the same run, so "score the unscored" also rescores
  and "retry what failed" also picks up work that never failed.
- [x] 8.4 Search covers the cohort while ranked. `applications-list.tsx` searches and filters
  over the cohort read whichever order the list is in, so an unscored or failed applicant is
  findable. Today search runs over the ranked page only, which is exactly the set that leaves
  those applicants out.
- [x] 8.5 The export is what the screen shows. `export.ts` takes the matched rows in the order
  displayed, not the whole cohort, and carries the coverage counts the screen shows beside the
  list — ranked, unscored, failed, older version — plus the list of fields it left out, so
  nobody reads a filtered file as a full one or a trimmed row as a complete record.
- [x] 8.6 A cut-off reply is diagnosed from `stopReason`. `shared/model.py` carries the model's
  own `stopReason` on `Answer`, both workers read it, and `shared/reply.py` stops guessing at a
  cut-off from unbalanced JSON. The model says when it hit the token limit; inspecting the text
  gets it wrong in both directions.
- [x] 8.7 Tests for the above, at the end as usual: the scope narrows what a run may claim and an
  unknown scope is refused (8.3); a search term matches an unscored applicant while the list is
  ranked (8.4); an export of a filtered list carries those rows in that order with the coverage
  counts (8.5); a reply the model marked cut off fails with that reason and one it did not,
  containing the same text, does not (8.6). Extend `test_batch.py` and `test_reply.py` rather
  than adding files. No test for 8.1 or 8.2 — a CORS rule and a header swap are wiring.
