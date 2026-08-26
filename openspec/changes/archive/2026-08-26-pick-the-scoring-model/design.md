## Context

See proposal.md — Why. The constraints that shape the approach:

**One constant, three consumers.** `MODEL_ID` in `infra/lib/compute-stack.ts` is the model id, the
value of both workers' `MODEL_ID` environment variable, and the input to `modelResources()`, which
builds the two Bedrock policy statements. The workers read it once at import
(`MODEL_ID = os.environ["MODEL_ID"]`). Nothing downstream of that can name a different model.

**Three models, both paths, all checked.** Checked against `dxhub-automation` in `us-west-2` on
2026-08-20 rather than taken from recollection. Each profile is `ACTIVE` in
`list-inference-profiles`, each answers a `Converse` call on `bedrock-runtime`, and each has a
us-west-2 row under cross-region inference profile support in AWS's batch-inference table:

| Tier | Model id | Converse | Batch |
| --- | --- | --- | --- |
| strongest | `us.anthropic.claude-opus-4-6-v1` | answers | supported in us-west-2 |
| everyday | `us.anthropic.claude-sonnet-4-6` | answers | supported in us-west-2 |
| cheap and fast | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | answers | supported in us-west-2 |

Sonnet 4.6 is the new default. Haiku 4.5 is what every score in the table today came from.

Two facts from that check that are not guessable from the model names:

- **The ids are not uniform.** Opus 4.6 is `claude-opus-4-6-v1` and Sonnet 4.6 is
  `claude-sonnet-4-6` — no `-v1`, no date — while Haiku 4.5 carries a date and a `:0`. There is no
  pattern to derive; each id is copied from `list-inference-profiles`.
- **A bare model id will not work.** An id without the `us.` prefix is refused —
  *"Invocation of model ID … with on-demand throughput isn't supported. Retry your request with
  the ID or ARN of an inference profile."* Every entry is a `us.` cross-region inference profile,
  which is also why the IAM policy has to allow the foundation model in any US region as well as
  the profile in this one. `modelResources()` already does exactly that for one model.

**Why 4.x and not the 5 series.** The 5-series models were considered and are not on the list. The
deciding fact is batch: Sonnet 5, Opus 5, and the GPT-5.6 models have no row in AWS's
batch-inference table, so picking one would silently take away the batch trigger — the discounted
path a 1,900-row cohort needs. Claude Fable 5 is refused outright by this account
(*"data retention mode 'default' is not available for this model"*). Three 4.x models that both
paths can run beats six where the choice decides which triggers still work.

**No run record exists.** Progress is counted off the application items; nothing stores a row per
run. A model choice has nowhere to be stored as "the run's model" without inventing that row.

## Goals / Non-Goals

**Goals:**

- One list of allowed models, read by both the CDK and the workers, so the policy and the
  validation cannot disagree.
- The choice travels with the run and is recorded on what it produced.
- Two models' totals for the same cohort live side by side. Running the second does not destroy the
  first.
- A cohort holding totals from two models cannot be read as one comparable set.
- Sonnet 4.6 as the default.

**Non-Goals:**

- Per-criterion or per-scholarship model policy. One model per run.
- A computed comparison. The two sets are stored side by side and a screen shows one at a time,
  with the detail screen showing an application's totals together. Nothing scores a diff, ranks the
  disagreement, or stores a verdict about which model was better — reading them against each other
  is a person's job.
- Scoring against two models in one pass. Two runs, one model each.
- Extended thinking, temperature, or token limits as choices. `temperature: 0` and the current
  `maxTokens` stay as they are for every model. Opus 4.6 and Sonnet 4.6 both take adaptive
  thinking; not turning it on is deliberate, because it is a second dial with the same effect on
  the score and nobody has asked for it.
- Other providers. Bedrock in this account serves several, and adding one means checking it on
  both paths and against the reply check. Not in this change.
- Moving off Bedrock, or a second SDK client.
- Rescoring anything.

## Decisions

**The choice travels with the run; it is not configuration.** The picker sends the model with
`POST /run`, the handler validates it and passes it in the worker's invoke payload, and the worker
uses it for that invocation. Nothing writes it anywhere as a current setting.

*Alternative — a settings row in DynamoDB, or an SSM parameter.* Rejected. It reads as a global
switch, which is the shape that produces the worst failure here: someone changes it, a run that
was already in flight or a rescore started an hour later picks up a different model, and two
halves of a cohort end up on different models with nothing on screen saying why. A run's model
belongs to the run, exactly as its rubric version does.

*Alternative — keep it in the environment variable and redeploy.* That is what we have. It is the
problem.

**The allowed list lives in TypeScript and is generated into the workers' environment.** The CDK
is where it has to live, because the IAM policy is built from it and the policy is the hard limit
— a model the policy does not cover comes back as an access denial from inside a worker, which is
the least actionable error in the system. The workers get the same list as one environment
variable so they can refuse an unknown model with a message, before claiming anything.

*Alternative — the list in Python, imported by the CDK.* Rejected: the CDK cannot import Python,
so it would mean parsing a `.py` file at synth time.

*Alternative — two lists, one each side.* Rejected outright. They drift, and the way you find out
is a denied Bedrock call halfway through a cohort.

**The picker is a closed list.** Three options, no free text field, no id entry. The list is short
enough that a text box adds nothing but a way to reach a model nobody checked, and the failure from
that lands mid-run rather than on the screen where it was typed.

**A total is a row of its own, keyed by rubric version and model.** This is the decision the rest
of the change hangs off, and it is a reversal: the first draft of this design put one `model_id`
attribute on the application item beside `rubric_version`, overwritten by each run. That cannot
hold. Running the same cohort on a second model is the whole point of the change, and with one
total per application the second run replaces the first — the comparison is gone the moment it
finishes, and the only trace is a `SCORE#` item no list, ranking, or export opens.

So the comparable numbers move to their own item in the cohort partition:

```
sk  TOTAL#<rubric_version>#<model_id>#<student_uuid>
    total_score, category_scores, latest_scored_at
    rank_pk  RANK#<scholarship>#<year>#<rubric_version>#<model_id>
```

One row per application per **set**, where a set is one rubric version and one model. A run writes
the row for its own set and touches no other. Reading one set is a prefix Query on the cohort
partition — `TOTAL#v2#us.anthropic.claude-sonnet-4-6#` — so a screen showing a set makes one read,
by key, as it does today.

The model goes into `rank_pk`, which the first draft rejected. The rejection was right about the
danger and wrong about the cause: it said a mixed cohort would silently vanish from a ranking. What
makes that danger go away is not keeping the model out of the key — it is the set being a thing the
screen names and the counts report. A ranking covers one version and one model, the screen says
which, and it names the other sets with their counts beside it. Nothing vanishes; it is somewhere
else, and the screen says where.

**The application item keeps the newest total, and stops carrying `rank_pk`.** It stays the
applicant's record and the claim holder — status, `claimed_by`, `attempt`, `failure` — and keeps
`total_score`, `rubric_version`, `model_id`, and `latest_scored_at` for the newest total written to
it, so the state badges and the cohort states count off one read as they do now. It is a copy, with
one writer, of the newest `TOTAL#` row. `rank_pk` moves off it, because a ranking is now a set's
ranking and the application item is not a set.

The stored model value is the id string the Converse call used — `us.anthropic.claude-sonnet-4-6`,
not `sonnet` and not `balanced`. A tier label is a description of today's list and will not mean the
same thing in a year; the id is what the call actually named. The tier label is a display concern:
the screens map a stored id to a label, and fall back to showing the id when it is no longer on the
list.

**Totals scored before the model was recorded are their own set, `unknown`.** Every score in the
table today came from Haiku 4.5, but the application item does not say so, and writing Haiku onto
them would be a guess dressed as a record. They migrate to `TOTAL#<version>#unknown#<student>`, and
the screens offer that set as "no model recorded". It keeps today's ranking working, under a name
that is true.

**A run's scope is the set it is for.** `claimable()` compares against the rubric version today. It
compares against the pair now: an application with no `TOTAL#` row for this version and this model
is work. So picking Opus on a Sonnet-scored cohort finds the whole cohort, which is what someone
pressing it expects, and "nothing to do" names the version and the model it found nothing for.

That took a fifth trigger, found while building the screens. The outer comparison leaves the
cohort in scope, but each trigger's own scope then cuts it back out: "score the unscored" wants no
version stored, and "rescore what changed" wants a *different* version — an application scored at
v1 by Sonnet is left out of both when the picked set is v1 on Opus. So there is an `other_model`
scope for exactly that case: a total at this version that this model did not make. The four scoring
scopes divide up everything the set comparison left, and no application is in two of them. The
dashboard's counts for them come off a second cohort read for the picked set, because the
application item's copy of its newest total cannot say whether *this* model scored it.

*Alternative — one total per application, with the model as an attribute.* That is what the first
draft said, and it is what the code built before this update. Rejected above.

*Alternative — a `totals` map on the application item, one entry per set.* Rejected. A ranking is a
Query on a global secondary index, and an index keys on a scalar attribute of an item — it cannot
key on an entry inside a map. Ranking 1,900 applications would move into the browser, off a read of
the whole cohort, which is the shape the ranking index exists to avoid.

*Alternative — leave the second run overwriting, and narrow the spec instead.* Considered and
rejected with the user. It is the smaller change, and it gives up the comparison the picker was
built for.

**On screen, a set is picked the way a rubric version already is.** The applications list already
has a rubric version picker, and that picker decides three things: which total each row shows, which
criterion columns sit beside it, and which ranking the sort reads. A set is one version and one
model, so the model picker goes beside it and feeds the same three things. Each option carries its
count off the cohort read — `v2 · Sonnet 4.6 · 1,900 scored` — so the choice is made against what is
actually stored rather than against a list of what exists.

What each screen does with it:

- **The trigger, on the dashboard.** The model picker is beside the rubric version picker, closed
  list of three tiers, with a line saying which tier is expensive. It also says what the run will
  and will not touch: the count it covers, and that totals from other models stay as they are. A run
  that finds nothing names the version *and* the model, so "nothing to do" is never a mystery.
- **The list header.** One line naming the set being shown, and beside it every other set present
  with its count. More than one set is a warning badge and a plain sentence: totals from different
  models are not comparable, and the list shows one at a time. Nothing is hidden — a set not being
  shown is named, counted, and one click away.
- **A row.** The version and model badges leave the row, because every row on screen is now from
  the picked set and repeating it 200 times says nothing. What the row does say is the case that
  matters: an application with no total in the picked set reads **"not scored on this model"**, not
  a dash and not a blank. A missing number that looks like a low number is the one failure a ranking
  screen must not allow.
- **The detail screen.** This is where two models are read against each other. It shows every total
  the application holds, one line per set — version, model tier, total, when it was scored — with
  the picked set marked. The numbers come from the score items, which already carry `model_id` and
  have since the first version of this change, so the comparison needs no new write.
- **The reliability section, on the dashboard.** The count per model becomes a count per set, with
  the same warning line when a cohort holds more than one.
- **The export.** A file is one set. It names the version and model in the header, every row carries
  them, and a warning names the other sets present with their counts — so nobody reads a one-model
  file as the whole cohort's ranking.

*Alternative — show every model's total as extra columns in one list.* Rejected. Three models is
three totals and three sets of criterion columns per row, which reads as a comparison someone can
scan and is not one: the columns line up, the numbers do not. One set at a time, named, with the
per-applicant comparison on the detail screen.

**Every model works on both paths, so neither path restricts the picker.** All three are batch-
supported in us-west-2, which is why the list is these three. The batch worker still treats a
rejected submission as a refusal — release the claims, name the model, offer the on-demand path —
because the support table is AWS's and changes as models ship, and our copy of it is one day old.
That refusal is a backstop, not a routine path.

**Sonnet 4.6 as the default, Haiku kept on the list.** The old default was where the platform
happened to start. Sonnet 4.6 is the middle tier, so an unconfigured run is a reasonable run rather
than the cheapest possible one. Haiku stays available because a 1,900-row cohort on the cheap tier
is a legitimate choice — it just should not be the one made silently.

## Risks / Trade-offs

- **The default change makes the next run on an existing cohort mixed.** Every score stored today
  came from Haiku 4.5, and the items do not say so. → This is what the set requirement is for, and
  it is the reason that requirement is in this change rather than a later one. Today's totals become
  the `unknown` set, the new run becomes the Sonnet 4.6 set, and the list shows one at a time with
  both named and counted.

- **A cohort's item count grows with every set.** 1,900 applications scored at two versions on
  three models is 1,900 application items and up to 11,400 total rows on one partition. → A total
  row is small — no `qa_pairs`, no reasoning, no evidence — and every read of one is a prefix Query
  for one set, not a read of the partition. What does read the whole partition is the cohort read
  behind the counts, which is already how progress is counted; it grows with the number of sets, and
  a cohort that has been scored on six sets is the point to page it or store the counts. Not now.

- **The newest total is stored twice.** It is on the `TOTAL#` row and copied onto the application
  item, so the state badges and the state counts stay one read. → The same shape the score item and
  the application's copy already have, with one writer: the score write sets both, and the failure
  path clears both. Two writers to that copy would be the bug; there is one.

- **Existing items have to be migrated, and `rank_pk` has to leave the application item.** Left
  there, its old `RANK#…#<version>` value keeps serving a ranking that the screens no longer name a
  model for. → One pass over each cohort, writing a `TOTAL#<version>#unknown#<student>` row for
  every scored application and removing `rank_pk` from it. It is idempotent and re-runnable, it
  changes no total, and until it runs a cohort's ranking reads empty rather than wrong.

- **Widening the Bedrock policy from one model to three.** → Still three exact ARN pairs, not a
  wildcard on the service. The workers hold no other Bedrock permission, and a model off the list
  is refused by the handler before a call is made.

- **Opus 4.6 on a 1,900-row cohort costs a multiple of what it costs today.** Nothing here puts a
  ceiling on that. → The screen already shows the count a run covers before it starts, and the
  model picker sits beside it. Say plainly on screen which tier is expensive; a spend limit is not
  in this change and should not be invented here.

- **Three models, one prompt, one reply check.** The reply check requires exact criterion ids and
  half-point scores, with no repair — a model that formats its JSON differently fails every
  application rather than scoring badly. Lower risk than it would be across providers, since all
  three are Claude and the fence-stripping in `shared/reply.py` was written for exactly that habit.
  → The task list still ends with a run of one small cohort per model, and a model that cannot
  produce a clean reply does not go on the list.

- **The tier labels are Anthropic's, not measured here.** Nobody in this project has compared
  these three on scholarship essays. → The labels say what each model is *for*, which is the
  vendor's claim to make. What it costs and what it scores is what running it answers, and
  answering that is the reason for the change.

## Migration Plan

1. Deploy the widened Bedrock policy, the model list, and the new reads and writes. Nothing is
   rescored.
2. Run the migration over each cohort: for every scored application, write its
   `TOTAL#<version>#unknown#<student>` row from the numbers already on the item, then remove
   `rank_pk` from the application item. Idempotent, so it can be run again. Between the deploy and
   this pass a cohort's ranking reads empty; the list says the set has no totals rather than showing
   a ranking that is missing rows.
3. The default flips to Sonnet 4.6 in the same deploy. The first run after it writes a second set
   beside the `unknown` one instead of replacing it, and the list names both.
4. Rollback is setting the default back to Haiku 4.5 and redeploying. Stored totals are unaffected
   either way — each set is its own rows, and nothing in this change deletes a set.
