## Why

The rubric text the model reads today is not the rubric anyone wrote. `parse_rubric` pulls
a published file apart and `rubric_text` writes a new one back out, and the round trip does
not come back the same: the closing REMINDER banner is hoisted to the top of the preamble,
each `Category:` header is rewritten and its `— half points allowed (e.g., 0.5)` clause is
dropped, and every criterion's `Use half points …` line is moved above the level list it
refers to. The file is already stored byte-for-byte on the version item as `source_text`,
so the system holds the text the scholarship office signed off on and then sends the model
something else.

## What Changes

- **BREAKING** The published rubric file is sent to the model unmodified, as the Bedrock
  `system` field. Both workers stop assembling rubric text from the criteria list.
- The applicant's own text becomes the only user message. Nothing else is in it.
- The output contract — the JSON shape, the criterion ids and their ranges, and the rules
  the reply check enforces — becomes a second system block, still generated from the
  rubric item's `criteria`. It is the only generated text the model reads.
- The output contract names every criterion id and range itself, so the model no longer
  has to read an id out of the rubric text. Criterion ids stay internal: they key the
  stored score map, the weights, and the web app's columns, and `check_reply` is unchanged.
- **BREAKING** A score is any number from zero to the criterion's maximum. The output
  contract stops asking for whole or half points and the reply check stops refusing a finer
  value — 3.7 is a score the model gave, not a malformed reply. A whole number is the same
  value with nothing after the point, so 3 and 3.0 are one score. How fine to go is the
  rubric file's business, and the file is now sent whole, so its own guidance carries.
- A version's prompt fingerprint is taken from `source_text` and the ids, names, and
  maxima the contract carries, not from the parsed preamble, guidance, and level
  descriptions. Editing the contract's wording now counts as a criteria change, which is
  what stops a recompute treating it as weights-only.
- A version with no `source_text` refuses to score rather than falling back to assembled
  text. `parse_rubric` stays where it is — publishing still parses the file to get the
  criteria, ranges, and weights.
- Publishing refuses a rubric file whose name a version of that scholarship has already
  used, and tells the person to give the file its own name. Every published version then
  carries a name of its own, so two of them can be told apart by eye.
- The versions list carries `source_text`, and the dashboard tells a weights-only change
  from a criteria change by comparing that file. It stops rebuilding a fingerprint out of
  the preamble, the guidance, and the level descriptions, which are what survive a parse
  rather than what the model now reads.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `aws-platform`: the prompt is a system part and a user part rather than a static prefix
  glued to the applicant's text; the file a version was published from is read at run time
  and sent to the model, which the current spec forbids; a score is any number in its
  criterion's range rather than a whole or half point; publishing needs a file name no
  version of that scholarship has used; and the dashboard tells a recompute from a rescore
  by the file rather than by a criterion's id, name, maximum, or level text.

## Impact

- `lambdas/shared/prompt.py` — `rubric_text`, `static_prefix`, and `_plain` go; a system
  block pair and the output contract take their place.
- `lambdas/shared/model.py` — `converse` takes a system part and a user part instead of one
  prompt string.
- `lambdas/workers/score_ondemand.py` — builds the two system blocks once per run, sends
  the applicant text as the user message, and appends the retry complaint to that message.
- `lambdas/workers/score_batch.py` — each record's `modelInput` carries `system` alongside
  `messages`.
- `lambdas/shared/versions.py` — `prompt_shape`, and through it `weights_only_change` and
  the recompute trigger.
- `lambdas/shared/work.py` — `rubric_version_item` already returns the whole item, so
  `source_text` needs no new read and no migration: every version published to date has it.
- `lambdas/shared/reply.py` — the half-point refusal in `_checked_score` goes. The range
  check, the id checks, and the missing-criterion check stay.
- `lambdas/handlers/rubric_publish.py` — a file name already used by a version of that
  scholarship is refused before anything is written.
- `lambdas/handlers/rubric_versions.py` — the list carries `source_text`, so the dashboard
  can compare the file the model read. Its docstring's reason for leaving the file out no
  longer holds.
- `apps/web/src/features/dashboard/version-change.ts` — `promptShape` goes; the comparison
  is the file. The module's `Level` and `Criterion` types go with it, since the dashboard
  reads nothing else off a version.
- Unchanged: the stored score shape, `weighted_total`, `parse_rubric`, and how weights are
  stored — they stay inside each criterion, where every reader already finds them.
