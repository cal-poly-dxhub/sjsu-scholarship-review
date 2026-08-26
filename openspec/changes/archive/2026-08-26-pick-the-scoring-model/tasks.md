## 1. The list of models

- [x] 1.1 In `infra/lib/compute-stack.ts`, replace the single `MODEL_ID` with a list of three
  entries — id, tier label, and one line of what it is for. Copy each id from
  `list-inference-profiles`; they do not follow a pattern. Sonnet 4.6 is marked the default.
- [x] 1.2 Widen `modelResources()` to return the ARN pair for all three, and give both scoring
  workers the widened policy. Keep the same shape it has for one model: the `us.` inference
  profile in this region, plus the foundation model in any US region.
- [x] 1.3 Pass the list and the default to both workers as environment variables, so the workers
  can validate a model without a second copy of the list in Python.

## 2. Choosing a model for a run

- [x] 2.1 In `lambdas/shared/model.py`, take the model id from the call instead of reading it
  from the environment at import. Nothing else about the Converse call changes. (`converse()`
  already took `model_id` per call; what the module gained is the allowed list and `checked_model`.)
- [x] 2.2 In `lambdas/handlers/run.py`, accept an optional model with the request, fall back to
  the default, and refuse an unknown one with the available models named — before any application
  is claimed.
- [x] 2.3 In `lambdas/workers/score_ondemand.py`, take the model from the work and use it for
  every Converse call in that invocation.
- [x] 2.4 In `lambdas/workers/score_batch.py`, do the same, and treat a rejected
  `CreateModelInvocationJob` as a refusal of the run: release the claims, log the model, say the
  on-demand path can run it. Do not fall back to on-demand on its own. All three models support
  batch today, so this is the backstop for the day one stops.

## 3. Storing and reading the model

- [x] 3.1 Write `model_id` onto the application item beside `rubric_version` — a plain string,
  the id the Converse call used. Same write that sets `total_score`, same failure path that clears
  it. `lambdas/shared/scores.py` and `lambdas/shared/claims.py`; `table.py` holds only key
  builders, so nothing there changed. An application with no `model_id` reads as no model, not as
  the default.
- [x] 3.2 Return `model_id` per application from the cohort read, and add a `scored_by_model`
  count beside `scored_by_rubric_version`. Both live in `lambdas/shared/reads.py` — the projection
  and `counts()` — which `handlers/cohort.py` calls.
- [x] 3.3 Return `model_id` from the application detail read in `lambdas/handlers/application.py`.
  No change needed: the detail read is a `GetItem` with no projection, so it already returns the
  application's `model_id`, and the score item has carried one since it was written.

## 4. The screens

- [x] 4.1 A model picker in `trigger-section.tsx`, beside the rubric version picker, labelled by
  tier. A closed list of the three — no free text, no way to name a model that is not on it. Both
  triggers offer all three. Every trigger sends the chosen model. Say plainly which tier is
  expensive. The list and the id→tier mapping live in `apps/web/src/lib/models.ts`, a second copy
  of the CDK list; the run handler's refusal is what keeps a drift cheap.
- [x] 4.2 Show the model beside the total: the row badge in `applications-list.tsx`, the badge in
  `application-detail.tsx`. Map the stored id to its tier label; show the raw id if it is not on
  the current list, and show nothing where there is no model.
- [x] 4.3 Show the mixed-cohort warning with the count per model, wherever
  `scored_by_rubric_version` is shown today — the list header and `reliability-section.tsx`.
- [x] 4.4 Add a `model_id` column to the export in `export.ts`, beside `rubric_version`. The file
  is JSON, not CSV, so this is a field per row plus a comparability warning.

## 5. Deploy and check

Runs last, after groups 7, 8, and 9. The storage shape decides what gets deployed.

- [x] 5.1 Deploy `dev` and confirm each of the three models scores one application on the
  on-demand path with a clean reply. A model that cannot produce a valid reply against the current
  prompt comes off the list, with the reason recorded in `design.md`. All three came back
  `scored: 1, failed: 0` with no problems, and each left a `TOTAL#v1#<model>#<student>` row with its
  own `rank_pk`. The migration ran first: 130 totals into the `unknown` set, `rank_pk` off every
  application item, the same numbers on a second run.
- [x] 5.2 Submit one small batch job per model. AWS's support table says all three work in
  us-west-2; this is the check that the table matches the account. All three took a 100-record job
  (the account's minimum) and read back `Submitted` with no message. What a finished job writes is
  not checkable yet — the jobs take hours and the collector runs off their state-change event.

## 6. Tests

- [x] 6.1 A model off the list is refused with the list named, and nothing is claimed.
  (`test_run.py::test_a_model_off_the_list_is_refused_with_the_list_named`)
- [x] 6.2 A run with no model named gets Sonnet 4.6, and the model it used comes back with the run.
  (`test_run.py::test_a_run_that_names_no_model_gets_the_default_and_says_which`)
- [x] 6.3 A cohort holding two models reads as mixed, with the right count per model; a cohort on
  one model reads as not mixed. (`test_progress.py`)
- [x] 6.4 The batch worker's refusal releases every claim it took and does not submit the job.
  (`test_batch.py::test_a_submission_bedrock_refuses_frees_every_claim_and_submits_nothing`)
- [x] 6.5 The export carries the model per row. (`export.test.ts`)

## 7. A total is its own row, keyed by version and model

Groups 1–4 stored one total per application with the model as an attribute, so a second run on
another model overwrote the first. This group is the fix. It supersedes 3.1, 3.2, and 3.3, and the
`model_id` written there stays as the application item's copy of its newest total.

- [x] 7.1 In `lambdas/shared/table.py`, add `total_sk(rubric_version, model_id, student_uuid)` for
  `TOTAL#<version>#<model>#<student>`, add the prefix a set's read uses, and take the model into
  `rank_pk`. Every key in the system is built here, so nothing else composes one.
- [x] 7.2 In `lambdas/shared/scores.py`, write the `TOTAL#` row with the numbers and its `rank_pk`,
  and stop writing `rank_pk` onto the application item. The application keeps `total_score`,
  `rubric_version`, `model_id`, and `latest_scored_at` as the copy of its newest total. Both writes
  stay under the same claim condition, so a job collected late still cannot apply over a newer run.
- [x] 7.3 In `lambdas/shared/claims.py`, `mark_failed` clears the application's copy and no longer
  removes `rank_pk`. A failed run on one model must not touch a `TOTAL#` row another model's run
  wrote — those are separate rows, so this is a check that nothing deletes across sets.
- [x] 7.4 In `lambdas/shared/work.py`, a run's scope becomes its version **and** its model: an
  application with no `TOTAL#` row for that pair is work. Read the set's rows once as a prefix Query
  and exclude those students. Re-read the three scopes against the new shape — `unscored` and
  `changed_version` are both phrased on `rubric_version` today.
- [x] 7.5 In `lambdas/shared/reads.py`: one read of a set's totals by prefix; `counts()` reports a
  count per set instead of `scored_by_model`; `ranked()` takes a model beside the version.
- [x] 7.6 In `lambdas/handlers/ranked.py`, take the model with the rubric version and refuse a
  request that names no model — a ranking with no model named is the mixed ranking this change
  exists to prevent.
- [x] 7.7 The recompute path in `work.py`'s `recomputable()` moves a total to another rubric version
  by arithmetic. It moves within one model now: the new `TOTAL#` row is the target version, same
  model, and a recompute never changes which model made a number.
- [x] 7.8 A migration that walks each cohort, writes `TOTAL#<version>#unknown#<student>` from the
  numbers already on every scored application, and removes `rank_pk` from the application item.
  Idempotent and re-runnable. It changes no total.

## 8. The screens show one set, and say which

Supersedes 4.2, 4.3, and 4.4.

- [x] 8.1 In `applications-list.tsx`, a model picker beside the rubric version picker. The pair is
  the set, and it decides the totals shown, the criterion columns, and the ranking read. Each option
  carries its count off the cohort read, as the version picker's already does. The cohort read takes
  the set and overlays its totals (`reads.with_set`, `handlers/cohort.py`), because the application
  item only carries a copy of its newest total.
- [x] 8.2 The list header names the set being shown and every other set present with its count, with
  a warning badge and one plain sentence when there is more than one. A set not shown is named and
  counted, never hidden.
- [x] 8.3 A row's version and model badges come off — every row is from the picked set. An
  application with no total in that set reads "not scored on this model", not a dash and not a blank.
- [x] 8.4 In `application-detail.tsx`, every total the application holds, one line per set: version,
  model tier, total, when it was scored, with the shown set marked. The numbers come off the score
  items, which have carried `model_id` from the start.
- [x] 8.5 In `reliability-section.tsx`, the count per model becomes the count per set, with the same
  warning when a cohort holds more than one.
- [x] 8.6 In `export.ts`, a file is one set: the version and model in the header, on every row, and a
  warning naming the other sets present with their counts.
- [x] 8.7 In `trigger-section.tsx`, a run that finds nothing names the version and the model it found
  nothing for, and the trigger says plainly that totals from other models are left as they are.
- [x] 8.8 A fifth trigger, because none of the four could reach an application scored at the picked
  version by another model: `unscored` needs no version stored and `changed_version` needs a
  different one. A new `other_model` scope in `work.py` takes exactly those, and the dashboard's
  counts come off a second cohort read for the picked set — the item's copy cannot say whether
  *this* model scored it.

## 9. Tests for the new shape

- [x] 9.1 Two runs at one rubric version on two models leave two totals for the same application,
  each naming its model, and neither run's numbers changed by the other.
  (`test_scores.py::test_two_models_at_one_version_leave_two_totals_neither_touching_the_other`)
- [x] 9.2 A run on a model the cohort has not been scored on finds the whole cohort as work; a run on
  the model it was already scored on at that version finds none.
  (`test_claims.py::test_a_second_model_finds_the_cohort_it_has_not_scored`, plus
  `test_a_total_with_no_model_recorded_is_nobodys_set` for the items in the table today)
- [x] 9.3 A ranking covers one set: an application scored only on the other model is absent from it
  rather than ranked at the bottom. (`test_scores.py::test_a_ranking_covers_one_set_and_nothing_else`)
- [x] 9.4 A failed run on one model does not remove the total another model's run wrote.
  (`test_scores.py::test_a_failure_clears_the_copy_and_leaves_another_models_total_alone`)
- [x] 9.5 The migration writes the `unknown` set from existing items, removes `rank_pk`, changes no
  total, and does the same thing run twice. (`test_migrate_totals.py`)
- [x] 9.6 A recompute moves each model's total to the new version under the model that made it.
  (`test_recompute.py::test_a_recompute_moves_each_models_total_and_keeps_them_apart`)
- [x] 9.7 The `other_model` scope takes an application scored at the picked version by another model
  and nothing else — not the unscored, not one at a different version.
  (`test_claims.py::test_a_scope_takes_only_the_work_its_button_names`)
- [x] 9.8 The cohort read with a set on it carries that set's total per row, and nothing for an
  application scored only in another set.
  (`test_progress.py::test_a_read_of_one_set_shows_that_sets_numbers_and_no_others`)
