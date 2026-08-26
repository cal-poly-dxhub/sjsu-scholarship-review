# human-in-the-loop Specification

## Purpose
Where a person decides, and what the system has to record about it. The scoring
workers stop at a stored score; everything after that — sign-off, the review queue,
and the AI-detection gate — lives here.
## Requirements
### Requirement: A sign-off records who signed it

An approval SHALL carry the reviewer's identity, taken from their token rather than
from the request body, and the time it was given. An approval SHALL NOT be stored
without an identity.

#### Scenario: Reviewer signs off

- **WHEN** a reviewer approves an application's scores
- **THEN** the record carries their subject and email from the token, and when they
  approved it

#### Scenario: No identity on the request

- **WHEN** a sign-off arrives with no caller identity
- **THEN** it is refused and no approval is stored

#### Scenario: Identity cannot be claimed by the caller

- **WHEN** a request body names a different reviewer than the token does
- **THEN** the token's identity is the one recorded

### Requirement: An application in review is held by one reviewer

An application SHALL be held by at most one reviewer at a time. A submission from a
reviewer who no longer holds it SHALL be refused rather than overwriting what is there.

#### Scenario: Two reviewers open the same application

- **WHEN** a second reviewer opens an application another reviewer is holding
- **THEN** they are told it is taken and cannot submit scores for it

#### Scenario: Reviewer walks away

- **WHEN** a hold passes its expiry with no submission
- **THEN** the application returns to the queue for someone else

#### Scenario: Late submission

- **WHEN** a reviewer submits scores after their hold has expired and someone else has
  already scored it
- **THEN** the submission is refused and the stored scores are unchanged

### Requirement: Approval does not outlive the score it approved

An approval SHALL apply to one scoring result. Anything that changes how the score was
produced SHALL leave the application needing sign-off again.

#### Scenario: Application is scored again

- **WHEN** an approved application is scored again
- **THEN** the new score is unapproved, and the earlier approval stays attached to the
  earlier result

#### Scenario: Rubric or questionnaire changes

- **WHEN** the rubric or questionnaire version behind a score changes
- **THEN** approvals made against the old version no longer count as sign-off

### Requirement: An unreviewed score is shown as unreviewed

A score no one has signed off SHALL be labelled as such wherever it is shown, and SHALL
NOT be presented as a final result.

#### Scenario: Score is shown before sign-off

- **WHEN** a score with no approval is displayed
- **THEN** it is marked unreviewed

#### Scenario: Cohort still being scored

- **WHEN** part of a cohort is still unscored
- **THEN** any ranking or total across that cohort says how much of it is missing

### Requirement: The weights live in one place and every total comes from the per-criterion scores

Each criterion's scale and weight SHALL be defined once, on the rubric, and used for both
the model's scores and a reviewer's. A total SHALL be worked out from per-criterion scores
and those weights, and SHALL record which rubric version's weights produced it. A
criterion with no mapping SHALL be refused, not scored as zero.

#### Scenario: A weight changes

- **WHEN** a criterion's weight or scale is changed in the one place it is defined
- **THEN** both the model's total and a reviewer's total are worked out again from the
  per-criterion scores already stored, and no per-criterion score is rewritten

#### Scenario: A total is shown

- **WHEN** a total is shown for an application
- **THEN** it says which rubric version's weights produced it, and a total from a
  different version is not presented as comparable

#### Scenario: Unknown criterion

- **WHEN** a submitted score names a criterion the mapping does not know
- **THEN** the submission is refused with the criterion named, and no total is shown that
  silently omits it

### Requirement: A detection zero is never applied without a person

A score of zero from the AI-written-essay rule SHALL be held for a person to confirm.
It SHALL NOT be stored as the application's score on the rule alone.

#### Scenario: Essay is flagged as AI-written

- **WHEN** the detection rule would zero an application
- **THEN** the zero is held pending a decision and is not stored as the score

#### Scenario: Person confirms

- **WHEN** a reviewer agrees the essay is AI-written
- **THEN** the zero is stored with their identity against it

#### Scenario: Person disagrees

- **WHEN** a reviewer rejects the detection
- **THEN** the application is scored on the questionnaire as normal, and the rejection
  is recorded

