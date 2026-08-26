## Why

One model id is compiled into the platform. `infra/lib/compute-stack.ts` holds
`MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'`, hands it to both scoring workers as
an environment variable, and builds the Bedrock IAM policy from it. Scoring a cohort with
anything else is a code edit and a deploy.

That is the wrong shape for the question people keep asking. Haiku 4.5 is the cheapest model on
the platform, and nobody can say what the cohort would look like scored by a stronger model
instead — whether the model is the reason for a gap against a reader's score, or the rubric is.
Answering it means running the same cohort twice on two models, and today that is a deploy in
between.

## What Changes

- The model a run uses is chosen on the dashboard, per run, from a fixed list of three Anthropic
  tiers: Claude Opus 4.6, Claude Sonnet 4.6, and Claude Haiku 4.5. It is sent with the run and
  reaches the worker as part of the work, not as a deploy-time constant.
- All three answer the Converse call the workers already make, and all three can take a batch job
  in this region. So no new library, no second SDK client, no second prompt shape, and no path
  that stops working because of the model picked.
- One place names the allowed models. The CDK reads it to build the Bedrock policy, and the
  workers read it to refuse a model that is not on the list. A model off the list is refused with
  the list, rather than reaching Bedrock and coming back as an access denial nobody can act on.
- **A total is identified by its rubric version and its model together, and stored as its own row.**
  Running the cohort on a second model adds a second set of totals beside the first instead of
  replacing it — otherwise the comparison the change exists for is destroyed by the run that
  produces it. A run's scope is its own set, so picking a model the cohort has not been scored on
  finds work rather than reading as "nothing to do".
- A cohort holding more than one set says so. Two totals made by different models are not
  comparable, so a ranking covers one set, the screen names the set it is showing, and it names the
  others with the count in each. An application with no total in the shown set reads as not scored on
  that model, never as a blank or a zero.
- **The default moves to Sonnet 4.6.** Haiku 4.5 was the default because it was what the platform
  was stood up on, not because anyone compared it against a reader's score. A run nobody
  configured should be the middle tier, not the cheapest. Haiku 4.5 stays on the list.
- No cohort is rescored by this change, and no stored score changes. What the new default does
  mean is that the next run on an already-scored cohort produces totals from a different model
  than the ones beside them — which is exactly what the mixed-model rule is for.

## Capabilities

### New Capabilities

- `model-choice`: which model scores a run, who picks it, what the allowed set is, and what has
  to be true about a cohort scored by more than one.

### Modified Capabilities

<!-- None. `openspec/specs/` does not exist yet: the `aws-platform` capability is still a delta
     inside the unarchived `aws-overhaul` change. This change's spec stands beside it and is
     folded in when both are archived. -->

## Impact

- `infra/lib/compute-stack.ts` — `MODEL_ID` becomes a list with a default rather than the only
  value. `modelResources()` has to cover every allowed model, so both workers' Bedrock policies
  widen from one model to three. The batch service role is unaffected; it touches S3, not Bedrock.
- `lambdas/shared/model.py` — the Converse call takes the model id from the work instead of
  reading it once from the environment at import.
- `lambdas/workers/score_ondemand.py`, `lambdas/workers/score_batch.py` — both take a model with
  the run and validate it before claiming anything.
- `lambdas/handlers/run.py` — accepts and validates the model, and refuses an unknown one.
- `apps/web/src/features/dashboard/trigger-section.tsx` — a model picker beside the rubric
  version picker, and every trigger sends it.
- DynamoDB — a total becomes its own row, `TOTAL#<version>#<model>#<student>` in the cohort
  partition, carrying the numbers and a `rank_pk` that names the model. The application item keeps
  the newest total as a copy for the state badges and stops carrying `rank_pk`. `shared/table.py`
  gains the keys; `shared/scores.py` and `shared/claims.py` write and clear them.
- `lambdas/shared/work.py` — a run's scope becomes its own version *and* model, so a model the
  cohort has not been scored on finds the whole cohort.
- `lambdas/shared/reads.py` and `lambdas/handlers/cohort.py` — one read of a set's totals, plus a
  count per set beside `scored_by_rubric_version`, so a cohort holding more than one is visible from
  the read every screen already makes. `handlers/ranked.py` takes a model with the version.
- One migration over existing cohorts: today's totals become the `unknown` set and `rank_pk` comes
  off the application items.
- The screens follow the set: the list gets a model picker beside its version picker and a header
  naming the set and the others present (`applications-list.tsx`), the detail screen shows every set
  an application has (`application-detail.tsx`), the dashboard counts per set
  (`reliability-section.tsx`), and the export is one set, named (`export.ts`).
- No new dependency. All three models answer the same `bedrock-runtime` Converse call the workers
  already make — checked against `dxhub-automation` in `us-west-2`, not assumed.
