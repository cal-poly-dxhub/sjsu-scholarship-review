## 0. What the checks found

The facts this change was waiting on are settled. Nothing here blocks a task any more — the
answers are in the spec and design, and they are recorded here so nobody re-opens them.

- **The `Student` column holds a UUID, and there is no name column.** The export is anonymized
  on purpose: `scholarship_config.py` maps `Student` to `student_uuid`, and `handler.py` sets
  the name to `None` with the note "not present in this anonymized data". The UUID is the
  applicant's identifier throughout. Nothing stores a name and nothing searches one.
- **The prompt is too small to cache.** `rubric.md` plus the schema block is 3,936 characters,
  about 1,000 tokens, against a 4,096-token minimum on every current model. Estimated from
  character count, not measured — `ANTHROPIC_API_KEY` is not set — but a 4× margin makes the
  answer safe. Caching is dropped from both paths.
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

- [ ] 0.1 Seed the first rubric item from `rubric.md`: `RUBRIC#sjsu_general` / `V#v1`, one
  `criteria` entry per criterion carrying id, name, maximum, weight, and level descriptions.
  `rubric.md` has no weights in it, so they come from the table those five criteria have always
  used — 10/40/30/10/10. Nothing can be scored before this item exists.
- [ ] 0.2 The prompt's rubric text is assembled from that item's criteria, not read from a file
  at run time. `rubric.md` stays as the human-readable original;
  `lambdas/score-applications/sjsu_general_rubric.md` goes with the sample. Only one of the two
  files mentions half points, and it is the one the item is seeded from.

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
- [x] 2.3 `DataStack`: the `<env>` bucket with `uploads/`, `batch/`, and `analytics/`
  prefixes, versioning, encryption, TLS-only bucket policy, public access blocked,
  `RETAIN` on delete.
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
  API Gateway, forwarding `Authorization`, caching nothing. Confirm no CORS configuration
  exists anywhere — same origin is the point.
- [ ] 2.10 Access logging on the API so a rejected call leaves a line with path, method,
  status, and why the check failed. No token or applicant field in a log line.
- [ ] 2.11 Deploy all three stacks. Create the first user by hand. Check that an
  unauthenticated `/api/` call is rejected at the edge and never reaches an integration.

## 3. Phase 1 — the web app's edges

- [ ] 3.1 Build-time config carries the user pool id, app client id, and sign-in domain.
  No API base URL — the API is same-origin.
- [ ] 3.2 One auth module of plain `fetch`: redirect to `/oauth2/authorize` with a PKCE
  challenge, swap the code at `/oauth2/token`, hold the tokens, refresh before expiry. No
  new dependency.
- [ ] 3.3 Replace `API_URL` in `apps/web/src/api.ts` with relative `/api/` paths, and put
  the access token on every request. A 401 sends the user back through sign-in.
- [ ] 3.4 Point the deployed rubric weights at the rubric item's `criteria`, and delete
  `REVIEW_WEIGHTS` from `apps/api/main.py` when that code goes in phase 2. The weight table
  has one home.
- [ ] 3.5 Build, upload to the site bucket, invalidate. Sign in through the hosted UI and
  reach the app.

## 4. Phase 3 — the scoring workers

Phase 2 — the route contract and the Lambda handlers — has no tasks yet. The workers below are
triggered directly until those routes exist.

- [ ] 4.1 Shared prompt builder and shared reply check, used by both workers. Both read the
  rubric item's `criteria` — no criterion id, name, maximum, or weight is written into the
  code. The check requires every criterion the rubric names, ids that match, and each score
  inside its criterion's maximum. A reply that misses any of that is a failure — there is no
  partial parse and no JSON repair branch.
- [ ] 4.2 Half-point rule in the reply check: a score is a whole or half point up to the
  criterion's maximum. Anything finer fails and is not rounded.
- [ ] 4.3 Weighted total from the per-criterion scores using the weights on the rubric item,
  stamped with the `rubric_version` that produced it. The model is never asked for a total.
- [ ] 4.4 Claim before score: conditional write of `claimed_by` and `claimed_until` on an
  application whose `status` is not `processing` and whose stored `rubric_version` is not the
  version the run is for. Only what the write succeeded on is scored. An expired claim is
  reclaimable. The run's version is the only thing that decides what is in scope — there is no
  separate record of which version a cohort belongs to.
- [ ] 4.5 Ingest worker: reads an uploaded workbook with `openpyxl`, writes applications into
  the cohort partition keyed by scholarship, year, and student. It never uses `put_item` on
  an existing item, so a re-ingest cannot drop `category_scores`, `total_score`, or
  `rubric_version`. Duplicate rows inside one file are reported, not silently dropped. It
  writes no name field — the `Student` UUID is the identifier, and the sample parser's
  `student_name` mapping goes with the sample.
- [ ] 4.6 Write-back on success: `category_scores`, `total_score`, `rubric_version`,
  `rank_pk`, `latest_scored_at`, and `status: scored` on the application, plus an immutable
  score item under `SCORE#<timestamp>` carrying each criterion's reasoning and evidence, the
  model id, which worker produced it, and its token counts. `rank_pk` is what puts the
  application into the ranking index, so it is written with the total and removed when a
  failure invalidates one.
- [ ] 4.7 On-demand worker: Bedrock Converse, one application per call. No cache checkpoint
  and no cache figures in the log — the prompt is a quarter of the minimum size. The static
  part stays byte-identical between calls anyway, which costs nothing.
- [ ] 4.8 Batch worker: writes one record per claimed item under `batch/` in `Converse` format
  via `modelInvocationType`, submits a `CreateModelInvocationJob`, reads results back from
  `batch/`. No tool call and no structured output — JSON is asked for in the prompt.
  `claimed_by` holds the job id.
- [ ] 4.9 Read the minimum-records quota for the model rather than hardcoding it, and refuse a
  set below it instead of submitting a job that cannot run. Release the claims, say how many
  records a job needs, and do not hand the work to the on-demand worker instead — the automatic
  500 line clears the floor, so only a manual override can reach it, and it is told why rather
  than downgraded quietly.
- [ ] 4.10 Failure handling: bounded attempts with the error fed back into the next one — not
  three identical calls at `temperature: 0`. A failure clears the derived score fields it
  invalidates, so nothing reads `score_failed` and still shows a score.
- [ ] 4.11 Per-item results, not a per-batch status. A transient Bedrock error is retried, not
  written as a permanent `score_failed`, and the handler does not return 200 for a batch that
  partly failed.
- [ ] 4.12 IAM: each worker gets the table, the prefixes it uses, and the Bedrock model it
  calls. Nothing broader.

## 5. Phase 4 — the screens

- [ ] 5.1 Two reads, and nothing else touches the table from a screen: a cohort read — one
  Query on the cohort partition with a `ProjectionExpression` that leaves out `qa_pairs`, and
  `ExpressionAttributeNames` for `status` and `year`, serving search, states, and counts — and a
  ranked read, one Query on the ranking index. Every feature below uses one of the two.
- [ ] 5.2 Scholarships screen: carry forward the filter panel from
  `features/scholarships/applications-list.tsx`. Repoint the cohort id to scholarship plus
  year, drop or repoint any filter whose field the new model does not have, and rebuild the
  markup on `Table`, `SortableHead`, `useTableSort`, and `TableEmptyOverlay`. No hand-rolled
  input, button, or table, and no hard-coded colour. Remove the dead `font-mondwest` class.
  Search matches the identifier and the stored fields only — no essay text. A word typed from
  an essay returns nothing and the screen says what search covers.
- [ ] 5.3 Per-criterion columns are built from the rubric item's `criteria`, in its order. No
  criterion name, maximum, or weight is written into the web app.
- [ ] 5.4 Ranking is a Query on the ranking index, read in the direction the person asked for.
  Nothing sorts a cohort in a handler or in the browser. `useTableSort` already cycles highest,
  lowest, off — keep it as the control and have it drive the read direction, and do not add a
  second sort control.
- [ ] 5.5 Unscored, failed, and older-rubric-version applications are absent from the index by
  construction, so no filter holds them out. Count them off the cohort read and say so beside
  the list. None of them is ranked as zero.
- [ ] 5.6 Application detail: open one application and read its per-criterion scores,
  reasoning, and evidence from its score item. Nothing else opens a score item.
- [ ] 5.7 Mark every score unreviewed, on the list and on the detail, and say how much of the
  cohort a ranking covers.
- [ ] 5.8 Dashboard: split the page into two independent fetches and delete the
  `statsLoading || analyticsLoading` early return. The reliability half failing must not
  blank the trigger section, and the two do not share a cohort picker — the trigger section is
  scoped to one scholarship and year, the reliability sections span every scholarship.
- [ ] 5.9 Dashboard: keep every reliability section as it is — human-versus-human against
  AI-versus-human, reviewer distribution, per-criterion and per-scholarship breakdowns. They
  are not rebuilt in this phase and not deleted; the trigger section sits above them. Where
  there is no human score, the section says it is waiting on data and renders no number, no
  percentage, and no empty chart.
- [ ] 5.10 Dashboard: upload. Pick a workbook, it lands under `uploads/`, ingest reads it, and
  the screen says how many rows came in. The upload starts nothing else.
- [ ] 5.11 Dashboard: the four triggers — score the unscored, recompute after a weight
  change, rescore what changed, retry what failed — each scoped to a chosen scholarship and
  year. A trigger with nothing to do is shown unavailable with its count at zero, not hidden.
- [ ] 5.12 Dashboard: progress counted off the cohort read — done, running, left, failed.
  No run record is stored.
- [ ] 5.13 Path choice on screen before a run starts: how many applications it covers, which
  worker it will use, and the 500 line. A person can override the choice. An override to batch
  below the minimum records is refused on screen with the number a job needs, not accepted and
  then dropped.
- [ ] 5.14 Confirm no trigger, upload, or recompute exists on any screen but the dashboard.
- [ ] 5.15 Reviews screen: says sign-off is not built. No reviewer identity, no approval, and
  no comparison against a human score anywhere in the app.
- [ ] 5.16 Cohort export: JSON built from the cohort the screen already fetched. Per-criterion
  scores and maxima, total, rubric version, and state. Nothing written to S3. No claim fields,
  attempt counts, content hashes, raw keys, or DynamoDB type wrappers. Unscored and failed
  applications are in it with their state, and it repeats the screen's warnings.
- [ ] 5.17 A checkbox on the export for reasoning and evidence, defaulting to off. Checking it
  says how many applications will be read and that the file will be larger and slower, before
  it runs.
- [ ] 5.18 With the box checked, fetch the newest score item per exported application by
  `BatchGetItem` on `APP#…` plus `SCORE#<latest_scored_at>` — 100 keys a request, keys taken
  from the cohort read. Show progress. An application whose score item is missing or unreadable
  stays in the file with its scores and its reasoning marked as not read; the export does not
  fail whole.
- [ ] 5.19 Single-application export: the open application with its per-criterion reasoning
  and evidence in full whatever the box says, built from the score item the detail already read.
- [ ] 5.20 Scoring states on screen: an application that is unscored, running, or failed reads
  that way instead of showing a score.

## 6. Tests

Unit tests, fast, no model call and no AWS. One end-to-end at the end, kept out of the fast
suite.

- [ ] 6.1 Reply check: a truncated reply, a missing criterion, an unknown criterion id, and a
  score above its maximum each fail. A complete valid reply passes. This is where a wrong
  answer becomes a real score, so cover it closely.
- [ ] 6.2 Half-point rule: 3.5 of 4 and 0.5 of 1 are accepted, 3.7 fails and is not rounded
  to 3.5 or 4. Rounding here would move a total by up to 5 out of 100.
- [ ] 6.3 The criteria come from the rubric: a fixture rubric with a different criteria set
  and different maxima drives the prompt, the range check, and the total — nothing falls back
  to the SJSU General five.
- [ ] 6.4 Weighted total: the five criteria at 10/40/30/10/10 produce the expected number out
  of 100, and it is stamped with the rubric version whose weights made it.
- [ ] 6.5 Recompute versus rescore: a weight-only change recomputes from stored scores with
  no model call, and a criterion change does not.
- [ ] 6.6 Claim: a second worker cannot claim an application already claimed and unexpired,
  and can claim one whose claim has expired. A run for `v2` claims an application stored at
  `v1` and skips one already at `v2`, and a run never reaches an application in another
  scholarship or year — this is what keeps a new rubric from rescoring last year's cohort.
- [ ] 6.7 Ranking exclusions, at the write: storing a total writes `rank_pk` for the cohort and
  rubric version, recomputing under a new version moves it, and a failure removes it — so a
  cohort mixing scored, unscored, failed, and older-rubric applications puts only the comparable
  ones in the index, and the counts off the cohort read cover the rest.
- [ ] 6.8 Export shaping: the cohort export has no claim fields, attempt count, content hash,
  raw keys, or type wrappers, and an unscored application is present with its state. With the
  reasoning box off there is no reasoning text; with it on there is. An application whose score
  item is missing comes back marked not read rather than dropped or throwing.
- [ ] 6.9 Path choice at the boundary: 499 goes on demand, 500 goes to batch, an override wins
  at both, and an override to batch below the minimum records is refused rather than submitted
  or silently downgraded.
- [ ] 6.10 One end-to-end, slow, run by hand: upload a small workbook through the dashboard,
  press score, wait for the cohort to finish, rank it, open an application, and export.
  Against real AWS in `dev`. Not part of the fast suite.
