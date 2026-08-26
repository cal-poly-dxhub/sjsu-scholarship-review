## Purpose

Which model scores a run, who picks it, and what has to stay true once a cohort has been scored
by more than one. A model choice moves every total in a run, so it is a choice made on screen and
recorded on what it produced, not a constant compiled into the platform.

## ADDED Requirements

### Requirement: A run is scored by a model a person picked

A person SHALL choose which model a scoring run uses, from the same screen the run starts from,
and that choice SHALL apply to the run it was made for and no other. There SHALL be a default, so
a run nobody configured still runs. The default SHALL be the balanced tier, not the cheapest —
the cheapest model is a choice someone makes on purpose, not one made for them by whatever the
platform was stood up on.

Changing the model SHALL NOT require a deploy, a code edit, or an environment variable change.

The choice SHALL NOT be stored as the system's current model. Nothing SHALL read "the model" out
of a store to decide how a later run behaves: a run carries its own, the same way it carries its
rubric version.

#### Scenario: A person picks a model

- **WHEN** a person picks a model and presses a trigger
- **THEN** that run's applications are scored by that model

#### Scenario: Nobody picks

- **WHEN** a run is started without a model named
- **THEN** it runs on the default, and the run says which model that was

#### Scenario: A second run

- **WHEN** a later run is started on the same cohort
- **THEN** it takes the model picked for it, and is not affected by what the previous run used

### Requirement: The models that may be used are a fixed set, named in one place

There SHALL be one list of the models a run may use. A run naming a model outside it SHALL be
refused before any work is claimed, and the refusal SHALL say which models are available.

The permission a worker holds to call a model SHALL be built from that same list, so a model on
the list is always callable and a model off it is never reached. The list SHALL NOT be editable
at run time.

A model SHALL NOT be on the list unless it has been checked to answer in this account and region,
and to be usable by both scoring paths. Being documented as available is not the check — a model
can be listed by the platform and still refused for the account, and a model that answers a single
call can still be unavailable to the batch path.

#### Scenario: A model that is not on the list

- **WHEN** a run names a model the list does not carry
- **THEN** it is refused with the available models named, and nothing is claimed

#### Scenario: A model on the list

- **WHEN** a run names a model on the list
- **THEN** the worker is permitted to call it, without a permission change

#### Scenario: A model the account will not serve

- **WHEN** a model is documented as available but the account refuses to invoke it
- **THEN** it is not on the list, and the reason it is not is recorded

### Requirement: The list covers tiers

The list SHALL offer more than one level of capability and cost, so the question "would a stronger
model score this differently" can be answered by running it. Each entry SHALL say what it is for
in plain words — which is the strongest, which is the everyday one, which is the cheap fast one —
so a choice does not require knowing a model's name.

Every model on the list SHALL be reachable by the same call both scoring paths already make, and
SHALL work on both paths. A model requiring a different API, endpoint, or client SHALL NOT be
added, because a second call shape is a second prompt shape and a second place for the two paths
to disagree. A model one path cannot run SHALL NOT be added either — a list where the choice
silently decides which trigger still works is worse than a shorter list.

The picker SHALL offer the list and nothing else. There SHALL be no way to type a model id, paste
one, or reach a model that is not on the list from a screen. A model absent from the list is
absent because it does not work here or has not been checked, so offering a way around the list
only moves the failure from the screen to the middle of a run.

#### Scenario: Choosing across tiers

- **WHEN** a person opens the model picker
- **THEN** every tier is offered, each labelled by what it is for rather than by its identifier
  alone

#### Scenario: Nothing but the list

- **WHEN** a person uses the picker
- **THEN** the only models they can choose are the ones on the list, with no free text entry

#### Scenario: Either trigger

- **WHEN** a person picks a model and presses either the on-demand or the batch trigger
- **THEN** the run starts on that path with that model; the choice does not decide which triggers
  are available

#### Scenario: A model that needs a different call

- **WHEN** a model is only reachable over an API the workers do not use
- **THEN** it is not offered

### Requirement: A total says which model made it

Storing a total SHALL record the model that produced it, and SHALL record it where a cohort read
finds it — not only on the scoring record. A screen showing a total SHALL be able to say which
model made it without opening a scoring record per application.

The stored value SHALL be the model's own id, as a plain string — the same string the Bedrock call
was made with. It SHALL NOT be a tier name, a short code, a number, or an index into the list.
A stored score has to say which model made it years from now, when the list has changed and the
tier labels have moved; only the id the call was made with survives that.

An application that was scored before this field existed SHALL read as no model rather than as a
guess. It is not knowable from the application item which model produced those totals, so those
totals SHALL be a set of their own — a set whose model is unknown — and SHALL NOT be folded in
with any named model's.

Wherever a rubric version is shown beside a total, the model SHALL be shown too — in a list row,
on a detail screen, and in an exported file. A rubric version and a model are the same kind of
fact about a number: which rules made it, and which reader applied them. Screens SHALL show the
tier label for a stored id, and SHALL show the id itself when it is not on the current list.

#### Scenario: A total is shown

- **WHEN** a total appears in a list or on a detail screen
- **THEN** the model that produced it is shown beside it, by what the model is rather than by its
  identifier alone

#### Scenario: A cohort is read

- **WHEN** a cohort is read for a list
- **THEN** the model behind each total comes with it, in that read

#### Scenario: Scores are exported

- **WHEN** scores are exported to a file
- **THEN** each row carries the model that produced it, beside the rubric version

### Requirement: A rubric version and a model together identify a stored total

A stored total SHALL be identified by the pair of its rubric version and its model. Storing a
total SHALL NOT replace a total made by a different model, and SHALL NOT replace one made under a
different rubric version.

Running the same cohort on a second model is the reason this change exists. If the second run
overwrites the first, the question it was run to answer — would a stronger model score this
differently — is unanswerable the moment it finishes, and the only trace left is a scoring record
no list, ranking, or export opens.

A run SHALL find work where no total exists for **its** rubric version and **its** model. An
application already scored at that version by a different model is work; an application already
scored at that version by that model is not. A run that finds nothing SHALL say which pair it
found nothing for.

#### Scenario: The same cohort on a second model

- **WHEN** a cohort scored at one rubric version on one model is run again at that version on
  another
- **THEN** it is work, and when it finishes both totals exist and each says which model made it

#### Scenario: The same cohort on the same model

- **WHEN** a cohort is run again at the same rubric version on the same model
- **THEN** there is no work, and the run says which version and model it found nothing for

#### Scenario: A total is stored

- **WHEN** a total is stored for a version and model
- **THEN** no total held for that application under any other version or model is changed or
  removed

### Requirement: A cohort scored by more than one model says so

Two totals made by different models SHALL NOT be presented as comparable without saying they are
not. A ranking or a comparison over a cohort holding totals from more than one model SHALL say
so, and SHALL say how many came from each.

This SHALL hold however the rubric version reads. A run under one rubric version on two different
models produces two sets of numbers that agree on the weights and on nothing else, and the rubric
version alone cannot tell them apart.

A ranking SHALL cover one rubric version and one model. A screen showing totals across a cohort
SHALL show one such set at a time, SHALL say which set it is showing, and SHALL name the other
sets present with the count in each. An application with no total in the set being shown SHALL
read as not scored by that model, and SHALL NOT read as a blank, a dash, or a zero — a missing
number and a low number are the two things a ranking must never confuse.

The count per set SHALL come from the cohort read itself, the same way the count per rubric
version does, so it is available to every screen that reads a cohort without a second request.

#### Scenario: One cohort, two models

- **WHEN** a cohort holds totals from two models
- **THEN** the screen shows one model's set, says which, names the other and how many totals it
  holds, and no ranking mixes the two

#### Scenario: One cohort, one model

- **WHEN** every total in a cohort came from the same model
- **THEN** no mixed-model warning is shown, and the set being shown is still named

#### Scenario: An application missing from the shown set

- **WHEN** an application has a total on one model and none on the model being shown
- **THEN** its row says it was not scored by that model, and it is absent from that model's
  ranking rather than ranked at the bottom

#### Scenario: The default changed under an already-scored cohort

- **WHEN** a cohort scored under the old default is run again on the new one
- **THEN** both sets of totals exist side by side, each named by its model, and the cohort reads
  as holding two sets rather than as one set of comparable numbers

#### Scenario: One application, two models

- **WHEN** an application's detail screen is opened after it has been scored by two models
- **THEN** every total it holds is shown, one per model, so the two can be read against each other

### Requirement: A batch job that cannot be submitted refuses the run

The batch path SHALL treat a rejected job submission as a refusal of the run rather than a reason
to fall back. A refusal SHALL release the claims it took and name the model. It SHALL NOT quietly
send the work down the on-demand path instead.

Every model on the list can take a batch job today. This requirement is for the day that stops
being true — a model withdrawn from batch, a region that loses it, a list entry added without the
check. A batch job runs for hours: a run refused at the press is an error someone can act on.

#### Scenario: A submission is rejected

- **WHEN** a batch job cannot be submitted for the chosen model
- **THEN** the run is refused with the model named, every claim it took is released, and the
  on-demand path is offered rather than substituted

#### Scenario: A submission is accepted

- **WHEN** a batch job can be submitted
- **THEN** it is submitted as it is today

### Requirement: Changing the model changes nothing already stored

Adding the choice, or changing the default, SHALL NOT rescore any application, alter any stored
score, invalidate a rubric version, or change what any existing scoring record says.

#### Scenario: The choice is added

- **WHEN** the model picker and the new default are in place
- **THEN** every application keeps the total, the scoring record, and the rubric version it had,
  and no run starts on its own
