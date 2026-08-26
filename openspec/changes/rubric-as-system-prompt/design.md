## Context

See proposal.md — Why. What matters for the approach:

- Every published version item already carries `source_file` and `source_text`, written by
  `rubric_publish`. `rubric_version_item` does a `get_item` with no projection, so the file
  is already in hand wherever a worker holds a rubric. Nothing needs a new read.
- `parse_rubric` is still needed at publish time: the criteria, ids, maxima, and levels it
  produces are what the weights screen, the reply check, the total, and the web app's
  columns are built from. Only the re-rendering half of the pipeline goes.
- The two calls the workers make are Bedrock `Converse` and a Bedrock batch job with
  `modelInvocationType: "Converse"`. Both take a `system` list of content blocks beside
  `messages`, so one prompt shape covers both paths.
- Criterion ids are slugs of the category names (`career_goals_essay`). They exist because
  the stored score map, the weights object, and the web app's columns are keyed by them.
  They have never appeared in a rubric file, which is why the current code injects them
  into the rewritten header.

## Goals / Non-Goals

**Goals:**

- One prompt builder, shared by both workers, that takes a rubric item and an application
  and returns the two system blocks and the user text.
- The published file passes through untouched — no strip, no normalise, no trailing
  newline added or removed.
- The stored score shape and the web app carry on unchanged. The reply check keeps every
  rule that decides whether a reply is usable, and loses only the one about how fine a
  score may be.

**Non-Goals:**

- Prompt caching. The system parts are still around 1,000 tokens against a 4,096-token
  minimum, and the existing requirement already covers when that changes.
- Structured outputs or a tool call to force the JSON shape. The batch path cannot offer a
  tool, and the two paths have to agree.
- Changing how a rubric is published, parsed, or weighted. `parse_rubric` keeps refusing a
  *level* finer than a half point — that is a rule about what a rubric file may declare,
  checked once at publish time, and it is not the same thing as what a model may score.
- Re-scoring existing cohorts. Applications already scored keep the version they were
  scored under, as they do for any criteria change.
- Moving the weights out of the criteria list. They stay inside each criterion, where the
  total, the recompute, and the web app already find them.

## Decisions

**The file is the first system block; the output contract is a second, separate block.**
Two blocks rather than one concatenated string, so nothing is ever glued onto the file —
concatenation is how a "verbatim" file picks up an extra newline or a stray heading. The
split also reads correctly to the model: the file is the rubric, the contract is the
answer format. Alternative: one system block with the contract appended after a separator.
Rejected — it makes "unmodified" a matter of what the separator happens to be, and there
is no reason to give up the block boundary the API already offers.

**The contract is generated from `criteria`, not written by hand.** It has to name ids and
maxima that came from the parse, and a hand-written one for the SJSU five would put
criterion names into code — the existing requirement forbids that. Its per-criterion lines
are `- <id>: <name>, score 0 to <max>`.

**The model is told the ids; it is not asked to find them.** The current
`SCHEMA_BLOCK` line — "the id given for the criterion, exactly as written above" — only
works because the rewritten header carried the id. With the file untouched there is no id
in the rubric text, so the contract lists them itself. Alternatives considered and
rejected: matching a reply's criterion names back to ids by slugging them at read time
(a model that writes "Career Goals" instead of the exact heading silently fails, and the
failure looks like a bad reply rather than a naming mismatch); and matching by position in
the returned array (a reordered or short array quietly scores the wrong criterion). The
contract stating the ids keeps `check_reply` exactly as it is: an unknown id fails, a
repeated id fails, a missing one fails.

**A score is a number in the range, and the check stops policing how fine it is.**
`_checked_score`'s `score * 2 != int(score * 2)` refusal goes. It was there when the
prompt was assembled and the system decided the step; with the file sent whole, the step is
what the file says, and a step enforced in code can only disagree with it. So 3.7 is
stored as 3.7. The contract says a score may be a whole number or a fraction inside the
range and names no step, so it cannot contradict a file that asks for half points. A whole
number needs nothing special: `float(3)` and `float(3.0)` are the same score, and
`weighted_total` already divides in floats.

The trade-off is that a wildly precise score — 3.68421 — is now accepted rather than
failed. That is the right side to err on: the alternative refused real scores, and a score
the model gave is evidence about the applicant, while a rejection is a re-run. The range
check, the id checks, and the missing-criterion check are untouched, so nothing that made
a reply unusable becomes usable.

Alternative considered: keep the refusal and have the contract name the half-point step.
Rejected — the published file is the rubric, and a file that scores 0-4 in tenths would
have every reply fail on a rule nobody wrote down in it.

**`prompt_shape` fingerprints `source_text` plus the ids, names, and maxima in the
contract.** These are exactly what the model reads. Weights and level descriptions drop
out of the fingerprint — the levels because they now reach the model only through
`source_text`, which already covers them. This closes a real hole in the current code:
today a change to `rubric_text`'s formatting changes the prompt for every already-published
version and `weights_only_change` cannot see it. The trade-off is that a version republished
from a file with one character changed is a criteria change and its cohort needs re-scoring.
That is the correct answer — the model was asked a different question.

**The dashboard compares the file, not a shape it rebuilds.** `version-change.ts` holds a
second copy of `prompt_shape`, written in TypeScript, and it was only ever right because
the old prompt was assembled out of the same parsed fields it stringified. Now the model
reads `source_text`, and the parse drops banner placement, whitespace, and each category
line's trailing text — so a file edit can leave every input the browser has identical. The
fix is to give the browser the same two things the server compares: `source_text`, and each
criterion's id, name, and maximum. `rubric_versions`'s `LIST_FIELDS` gains `source_text`;
`promptShape` and its `Level` type go, and `Criterion` shrinks to the three fields that are
compared.

The cost is the payload — every published version's file now rides along on a dashboard
load, order of tens of kilobytes per version, and the list handler's docstring says it
leaves the file out for that reason. That reason is retired: the dashboard needs the file to
answer a question it is already being asked. Alternative: publish a digest of the shape
alongside each version, so only a hash travels. Rejected — it is a stored field that can
drift from what the run computes, and the failure would be silent, which is the same class
of bug this decision is fixing.

**A published file name has to be one no version of that scholarship has used.** With the
shape no longer visible on screen, the file name is what tells two versions apart by eye, so
it has to be unique or it tells you nothing. `rubric_publish` reads the scholarship's
versions and refuses a name already there, saying which version holds it and asking for a
name of this file's own.

The trap worth writing down: the recompute comparison is on *contents*, never on the name.
A weights-only republish is the same bytes under a new name — comparing names would call it
a criteria change and burn a cohort's worth of model calls. Anyone tempted to "simplify" the
comparison to a name check breaks recompute; the unique-name rule exists for the reader, not
for the comparison.

**A missing `source_text` fails the run before anything is claimed.** The check goes where
the workers read the rubric item, ahead of `claimable`. A fallback to assembled text would
be the bug this change exists to remove, quietly reappearing on old data.

**`converse` takes `system` and `user` instead of one `prompt`.** The retry complaint moves
onto the user text, since the system blocks have to stay byte-identical between the two
calls. `rubric_text`, `static_prefix`, and `_plain` are deleted rather than left unused.

## Risks / Trade-offs

**The batch `modelInput` may not accept `system`** → The Converse batch record takes the
Converse request body, so `system` beside `messages` is expected to work, but it is worth
one real submission before this ships. If it turns out not to be accepted, the fallback is
a leading user message carrying the two blocks — which would break the byte-identical
guarantee for the batch path only, and would need a spec update rather than a quiet
workaround.

**The file was written for a human grader, not for a scoring model** → It may say things
the contract contradicts, e.g. a rubric that asks for a total or for prose. The contract is
the second system block and the more specific instruction, and its rules are the ones the
check enforces, so a mismatch shows up as a failed reply with the raw text kept rather than
as a wrong score. The parse already refuses a file whose structure it does not recognise.

**Prompt length grows** → The file carries banners and grader guidance that the assembled
text dropped. Order of tens of tokens per call on the SJSU rubric. No mitigation needed;
the token counts are already logged per run.

**Versions already published may share a file name** → The rule is checked at publish, so
nothing already stored is refused or rewritten. Two old versions with the same name stay
indistinguishable by eye until one of them is superseded. Nothing depends on the name, so
this costs nothing but the look of the list.

**Every version's fingerprint changes when this ships** → `prompt_shape` is computed on
read, not stored, so nothing needs rewriting. But the first comparison after deploy is
between two fingerprints of the new kind, so the recompute trigger behaves normally from
the start. Worth confirming on the dashboard's trigger section after deploy.

## Migration Plan

No data migration. `source_text` has been written on every version since publishing
existed, and the fingerprint is derived on read.

1. Deploy the workers and shared code together — `converse`'s signature changes, so a
   partial deploy fails fast rather than mis-scoring.
2. Score one application on demand against the existing SJSU version and read the request
   that went out: the first system block equal to the stored file, the user block the
   applicant text alone.
3. Submit one small batch job and confirm the records with `system` are accepted.
4. Deploy the list handler and the web app together — the dashboard's comparison needs
   `source_text` in the list, and without it every version reads as a criteria change.
5. Rollback is a redeploy of the previous version. Scores written under this change stay
   valid — the stored shape did not change, and a recompute reads stored per-criterion
   scores without putting them back through the reply check, so a stored 3.7 survives a
   rollback to the code that would have refused it in a reply.
