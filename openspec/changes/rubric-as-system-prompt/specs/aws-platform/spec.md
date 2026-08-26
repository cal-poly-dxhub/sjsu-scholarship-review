## RENAMED Requirements

- FROM: `### Requirement: The prompt has a static prefix, and no cache is claimed for it`
- TO: `### Requirement: The prompt is the rubric file, the output contract, and the applicant's text`

- FROM: `### Requirement: Scores go in half points`
- TO: `### Requirement: A score is any number inside its criterion's range`

## MODIFIED Requirements

### Requirement: The prompt is the rubric file, the output contract, and the applicant's text

Both workers SHALL build the prompt as two system parts followed by one user part. The
first system part SHALL be the rubric file the version was published from, byte-for-byte
as it was stored: no reordering, no rewritten headers, no dropped lines, and nothing
appended to it. The second system part SHALL be the output contract. The user part SHALL
be the applicant's own text and nothing else — no rubric text, no instructions, no
timestamps or ids. Neither worker SHALL place a cache checkpoint, and neither SHALL report
cache savings, because the system parts are about 1,000 tokens against a 4,096-token
minimum on every current model.

#### Scenario: Two items scored in one run

- **WHEN** two applications are scored in the same run
- **THEN** both system parts are byte-identical between the two calls, and the only
  difference is the user part

#### Scenario: The published file reaches the model as it was written

- **WHEN** a rubric version's file is sent as the first system part
- **THEN** it matches the stored file byte-for-byte, including its banner blocks wherever
  they sit in the file, the full text of every category line, and the order the guidance
  and the level lists were written in

#### Scenario: A retry tells the model what was wrong

- **WHEN** the on-demand worker calls the model a second time because the first reply
  failed the check
- **THEN** what was wrong is added to the user part, and both system parts are unchanged
  from the first call

#### Scenario: A run reports what it cost

- **WHEN** a run finishes
- **THEN** its log line gives input and output tokens and claims no cache read, cache
  write, or saving

#### Scenario: The system parts grow past the minimum

- **WHEN** the system parts of the prompt are measured at or above the model's minimum
  checkpoint size
- **THEN** caching is worth adding, and until it is measured that way nothing in the
  system claims a cache

### Requirement: The rubric item is the only source of the criteria

The output contract, the reply check, the weighted total, and the columns a screen shows
SHALL all be built from the `criteria` list on the rubric item. No criterion id, name,
maximum, weight, or level description SHALL be written into a worker, a handler, or the
web app. The rubric text a model reads SHALL be the file the version was published from,
read from the version item at run time and sent unmodified; no rubric text SHALL be
assembled from the criteria list.

#### Scenario: The prompt's rubric text comes from the published file

- **WHEN** a worker builds the prompt for a cohort
- **THEN** the rubric text in it is the version's stored file, and the ids and ranges the
  reply check enforces are stated in the output contract beside it, so the text the model
  reads and the ranges the check enforces cannot disagree

#### Scenario: The first rubric version for a scholarship

- **WHEN** a scholarship's first rubric version is created
- **THEN** it is published the way every later one is: a file uploaded on the dashboard, parsed
  into criteria, weighted on screen, and written as a version. Nothing is seeded by hand, and
  `rubric.md` is a file someone can upload rather than a file the system knows about

#### Scenario: A scholarship uses a different set of criteria

- **WHEN** a rubric is published for a scholarship with criteria that are not the SJSU
  General five
- **THEN** its cohort is scored, totalled, and shown against its own criteria, with no code
  change — the rubric item is a data change

#### Scenario: A criterion's maximum or weight changes

- **WHEN** a new rubric version changes a maximum or a weight
- **THEN** the output contract, the range check, and the total all follow it, because none
  of them holds a copy

#### Scenario: A ranked list shows per-criterion columns

- **WHEN** a cohort's per-criterion scores are shown
- **THEN** the columns come from the rubric's criteria in its order, not from a list held
  in the web app

### Requirement: A score is any number inside its criterion's range

A criterion's score SHALL be any number from zero up to that criterion's maximum. A
fractional score SHALL be a valid answer, stored as the model gave it: 0.5, 2.5, and 3.7
are scores the system accepts. A whole number SHALL be the same value with nothing after
the point, so 3 and 3.0 are one score. The system SHALL NOT round a score, snap it to a
step, or refuse it for being too fine. How fine to score SHALL be the published rubric
file's business, not a rule held in code.

#### Scenario: A fractional score is returned

- **WHEN** a reply scores a criterion at 3.5 of 4, or 0.5 of 1
- **THEN** it is accepted and stored as given, and the weighted total is worked out from it

#### Scenario: A score finer than a half point is returned

- **WHEN** a reply scores a criterion at 3.7 of 4
- **THEN** it is accepted and stored as 3.7. Rounding it to 3.5 would be the check
  inventing a score the model did not give, and refusing it would throw away one the model
  did

#### Scenario: A whole number is returned

- **WHEN** a reply scores a criterion at 3, with no decimal part
- **THEN** it is the same stored score as 3.0, and the total is the same either way

#### Scenario: A published rubric asks for a particular step

- **WHEN** a published version's file tells the grader to use half points
- **THEN** that instruction reaches the model, because the file is sent whole, and the
  check still accepts whatever number came back inside the range — the file guides the
  model and the check guards the range, and neither one enforces the other's job

### Requirement: The per-criterion scores are the source of truth and the total is derived from them

A worker SHALL store per-criterion scores and a total worked out from them and the
rubric's weights. Every stored total SHALL record which rubric version's weights produced
it. A total SHALL NOT be taken from the model, and SHALL NOT be the only record of a
score.

#### Scenario: A weight changes

- **WHEN** a criterion's weight is changed and the criteria themselves are unchanged
- **THEN** the totals are worked out again from the per-criterion scores already stored,
  no model is called, and the per-criterion scores are not touched

#### Scenario: The criteria change, not just the weights

- **WHEN** a rubric version's file differs by so much as a character, or it adds, removes,
  or renames a criterion, or changes a maximum
- **THEN** the stored per-criterion scores cannot be recomputed against it, and the
  affected applications keep the rubric version they were scored under until they are
  scored again — the file is what the model read, so a change anywhere in it is a change
  to the question that was asked

#### Scenario: The model returns a total of its own

- **WHEN** a model reply includes a total
- **THEN** it is ignored, and the stored total is the one worked out from the
  per-criterion scores

#### Scenario: A total becomes rankable, or stops being

- **WHEN** a total is stored, recomputed under a new rubric version, or invalidated by a
  failure
- **THEN** the application's ranking-index key is written, moved to the new version's
  partition, or removed with it, so what the index holds is exactly what is comparable

#### Scenario: A total is recomputed part-way

- **WHEN** a recompute over a cohort stops before it finishes
- **THEN** each application's stored rubric version says which weights its total came
  from, so the ones not yet recomputed are identifiable rather than silently mixed in

### Requirement: A rubric version is published from the dashboard

A person SHALL publish a rubric version by uploading its text on the dashboard. The text SHALL
be parsed into criteria, the weights SHALL be typed on screen, and both SHALL be shown for
checking before anything is written. A file that does not match the format SHALL be refused
with the line that stopped it, and SHALL NOT be partly accepted or corrected on the way in. A
file whose name a version of that scholarship has already published SHALL be refused, saying
which version has that name and asking for a name of the file's own, so every published
version can be told apart by the name on it. A published version SHALL NOT be editable — a
correction is the next version. Publishing SHALL write to no application.

#### Scenario: A rubric file is uploaded

- **WHEN** a person uploads a rubric on the dashboard
- **THEN** the screen shows every criterion parsed out of it with its maximum and its levels,
  beside the file as it was uploaded, and nothing is published until they say so

#### Scenario: The file does not match the format

- **WHEN** an uploaded file has a criterion with no score range, a level above that criterion's
  maximum, a level value finer than a half point, or two criteria whose names give the same id
- **THEN** it is refused with the line that caused it and no version is written. There is no
  partial parse and nothing is guessed at — the rule the reply check follows, for the same
  reason: a maximum that was guessed would move every score under it without failing anything

#### Scenario: The file name is already published

- **WHEN** a person publishes a file under a name a version of that scholarship already used
- **THEN** it is refused before anything is written, naming the version that holds it and
  asking for a name of this file's own

#### Scenario: The same rubric is republished with new weights

- **WHEN** a person changes only the weights and publishes the same rubric text again
- **THEN** they give the file a new name, because the old one is taken, and the new version
  is still a weights-only change: what decides that is the file's contents, which have not
  changed, and never its name

#### Scenario: Weights are supplied

- **WHEN** the parsed criteria are shown
- **THEN** a weight is typed for each one, the running total is on screen, and publishing stays
  unavailable until they sum to 100. No weight is inferred from a maximum or read out of the file

#### Scenario: A version is published

- **WHEN** a person publishes the checked rubric
- **THEN** it is written as the next version for that scholarship, carrying its criteria, its
  preamble, the file it came from, and who published it and when — and the screen says which
  version number it wrote

#### Scenario: Two people publish at once

- **WHEN** two people publish for the same scholarship at the same moment
- **THEN** each publish writes its own version and neither overwrites the other, because the
  write is conditional on that version number not already existing

#### Scenario: A published version is opened again

- **WHEN** a person opens a version that has already been published
- **THEN** it is readable and not editable. Every stored total names the version whose weights
  made it, so changing one in place would change what that name means for scores already written

#### Scenario: Publishing does not move a cohort

- **WHEN** a version is published
- **THEN** no application is written, no total changes, and no ranked list moves. A cohort
  reaches a new version only when someone starts a run for it

#### Scenario: A scholarship with no cohort yet

- **WHEN** a person wants to publish for a scholarship that has no applications
- **THEN** it is not offered — the scholarships available to publish for are the ones with a
  cohort, so its export is uploaded first

### Requirement: Every trigger lives on the dashboard

The dashboard SHALL be the one place a person starts work. It SHALL offer scoring the
unscored, recomputing totals after a weight change, rescoring what changed, and retrying
what failed — each scoped to a chosen scholarship and year. No other screen SHALL start
any of them. The count beside a button SHALL be worked out the same way the run itself
decides: by comparing the rubric file each version was published from, together with each
criterion's id, name, and maximum. It SHALL NOT compare a version's file name, and SHALL
NOT rebuild a shape out of the preamble, the guidance, or the level descriptions.

#### Scenario: A person looks for the button

- **WHEN** a person wants to start any kind of work on a cohort
- **THEN** they find it on the dashboard, and the screen that shows results offers no way
  to start it

#### Scenario: The trigger section is scoped to a cohort

- **WHEN** the dashboard is opened
- **THEN** its trigger section is scoped to one scholarship and year, because every count and
  every button in it means nothing without one. The reliability sections below keep their own
  scope, which is every scholarship

#### Scenario: A trigger with nothing to do

- **WHEN** a cohort has nothing unscored, nothing failed, and nothing carrying a version other
  than the one asked for
- **THEN** the matching button is offered as unavailable with its count at zero, rather
  than hidden or pressable to no effect

#### Scenario: A weight-only rubric change

- **WHEN** a person asks to move a cohort to a version published from the same rubric file
  with different weights
- **THEN** the dashboard offers a recompute over the stored per-criterion scores, and says
  it costs no model call

#### Scenario: A criteria change

- **WHEN** a person asks to move a cohort to a version published from a rubric file that
  differs from the stored version's by so much as a character
- **THEN** the dashboard offers a rescore rather than a recompute, because arithmetic over
  the stored scores cannot produce the new ones, and it says how many model calls that is
  before anything runs

#### Scenario: The count and the run agree

- **WHEN** the dashboard counts what a recompute would move and the run then works it out
  for itself
- **THEN** the two agree, because both compare the same things: the file, and each
  criterion's id, name, and maximum. A count taken from what survives a parse — the
  preamble, the guidance, the level descriptions — would call a file-only edit
  weights-only and offer a recompute that finds nothing to do

#### Scenario: A new version exists and nobody has asked for it

- **WHEN** a rubric version is published and no one has asked to move a cohort to it
- **THEN** the recompute and rescore buttons are unavailable with their counts at zero, and no
  cohort is described as stale — a cohort's applications say which version scored them, and a
  publish does not change that

#### Scenario: Nothing added to the dashboard needs a human score

- **WHEN** the upload, the triggers, or the progress counts are built
- **THEN** none of them compares the model against a reviewer, so all of them work while
  last year's reader scores are still missing

## ADDED Requirements

### Requirement: The output contract names every criterion and every score it will accept

The output contract SHALL carry everything the model needs to answer without reading
anything out of the rubric file: one line per criterion giving its id, its name, and its
range; the JSON object shape, with the reply being one JSON object and nothing else; and
the rules the reply check enforces. It SHALL say a score may be a whole number or a
fraction anywhere inside the range. It SHALL NOT name a step, tell the model to round, ask
for a total, or tell the model to take an id from the rubric text.

#### Scenario: A criterion has no id in the rubric file

- **WHEN** a published file names its categories in prose, with no id anywhere in it
- **THEN** the reply still carries the ids the check expects, because the contract lists
  each criterion's id against its name

#### Scenario: A reply's ids are checked

- **WHEN** a reply comes back
- **THEN** it is checked against the ids on the rubric item exactly as before: an unknown
  id fails, a repeated id fails, and a missing one fails

#### Scenario: The contract and the file disagree about a range

- **WHEN** a rubric file's category line and the parsed maximum for that criterion do not
  match
- **THEN** the mismatch is refused at publish time by the parse, not left for a worker to
  resolve, so no run is made against a contract that contradicts its own rubric text

#### Scenario: Fractional scores are allowed for

- **WHEN** the contract is built
- **THEN** it says a score may be a whole number or a fraction inside the range, so a
  fraction is an answer the model knows is wanted rather than one it avoids, and it names
  no step of its own that could contradict the rubric file's

### Requirement: A version with no stored file cannot be scored

A run SHALL refuse to start against a rubric version that has no stored file, naming the
scholarship and the version. It SHALL NOT fall back to text assembled from the criteria
list, and it SHALL NOT claim any item.

#### Scenario: The file is missing from the version item

- **WHEN** a run is started against a version whose stored file is absent or empty
- **THEN** the run fails before any item is claimed, with a message saying that version
  has no rubric file to send and must be published again

#### Scenario: Every published version has one

- **WHEN** the published versions in a deployment are read
- **THEN** each carries the file it was published from, because publishing has always
  stored it, so nothing needs migrating for this check to pass
