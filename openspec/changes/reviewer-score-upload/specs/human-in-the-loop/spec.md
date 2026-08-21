## ADDED Requirements

### Requirement: A reviewer's scores arrive as a file, not from the app

A reviewer's scores SHALL enter the system by uploading a file the scholarship office exports.
There SHALL be no way to submit a reviewer's score from inside the app, and the app SHALL say so
where a reviewer would expect to. A file SHALL be uploaded against the cohort a person picks on
screen, because the file names neither the scholarship nor the academic year.

#### Scenario: A reviewer's scores are uploaded

- **WHEN** a person picks a reviewer-score file for a cohort they have picked
- **THEN** the reviewer scores it holds are stored against that cohort's applications
- **AND** nothing is scored, re-scored, or signed off as a result

#### Scenario: A reviewer types scores into the app instead

- **WHEN** a reviewer enters scores on the hand-scoring screen
- **THEN** submitting stays unavailable, and the screen says a reviewer's scores are added by
  uploading the office's file
- **AND** nothing is stored from what they typed

### Requirement: Every reviewer's own scores are kept

Where more than one reviewer scored an application, each reviewer's per-criterion scores SHALL be
stored separately, under their own identity. A file's own average SHALL NOT replace the individual
scores it was made from, and nothing SHALL be discarded on the way in because this change does not
yet report on it.

#### Scenario: Two reviewers scored one application

- **WHEN** a file gives two reviewers' scores for one application
- **THEN** both reviewers' per-criterion scores are stored, each carrying which reviewer gave them
- **AND** the file's stated average is not stored in place of either

#### Scenario: One reviewer scored an application

- **WHEN** a file gives one reviewer's scores for an application
- **THEN** that reviewer's scores are stored, and nothing is invented for a second reviewer

### Requirement: A reviewer's total is worked out here, never read from the file

A reviewer's total SHALL be worked out from their per-criterion scores and the weights of the rubric
version that produced the application's model score, by the same rule that produces the model's
total. A total the file supplies SHALL NOT be stored or shown as the reviewer's total.

A reviewer's score for a criterion the rubric does not have SHALL be refused with the criterion
named, and SHALL NOT be counted as zero. A reviewer who did not score every criterion SHALL NOT be
given a total, and SHALL NOT be counted in a gap.

#### Scenario: The file carries its own total

- **WHEN** a reviewer-score file carries a total of its own beside the per-criterion scores
- **THEN** the stored total is the one worked out from the per-criterion scores and the rubric's
  weights, and the file's own total is not shown as the reviewer's total

#### Scenario: A criterion the rubric does not have

- **WHEN** a file names a criterion the rubric version does not have
- **THEN** the row is refused with that criterion named, and no total is stored that quietly leaves
  it out

#### Scenario: A reviewer scored only some criteria

- **WHEN** a reviewer scored some but not all of the rubric's criteria for an application
- **THEN** their per-criterion scores are stored, no total is worked out for them, and they are left
  out of the application's gap

#### Scenario: A total is compared across rubric versions

- **WHEN** an application's model total came from a different rubric version than the one a
  reviewer's total was worked out under
- **THEN** the two are not compared, and no gap is stored for that application

### Requirement: An application is routed to a person when the model and the reviewers disagree

An application SHALL be flagged for a second look when the distance between its model total and its
reviewers' total is at least the disagreement line. Where more than one reviewer gave a total, the
reviewers' total SHALL be the mean of them. An application with no model total, or no reviewer total,
SHALL NOT be flagged and SHALL NOT be described as agreeing.

The disagreement line SHALL be defined in one place and used by every screen and read that reports a
flag, so no two parts of the system can flag differently.

#### Scenario: Model and reviewer disagree

- **WHEN** an application's model total and its reviewers' mean total are at least the disagreement
  line apart
- **THEN** the application is flagged for a second look, carrying the size of the gap

#### Scenario: Model and reviewer agree

- **WHEN** the gap is under the disagreement line
- **THEN** the application is not flagged, and its gap is still stored so it can be reported on

#### Scenario: Two reviewers, one gap

- **WHEN** two reviewers each gave a total for one application
- **THEN** the gap is measured against the mean of their two totals

#### Scenario: An application nothing has scored

- **WHEN** an application has reviewer scores but no model score
- **THEN** it is not flagged, it is not counted as agreeing, and the screens say its model score is
  missing rather than showing a zero or a full gap

#### Scenario: An application no reviewer scored

- **WHEN** an application has a model score and no reviewer scores
- **THEN** it is not flagged, and it is not counted in any agreement figure

### Requirement: The disagreement line is a stated choice, not a measured result

The disagreement line SHALL be recorded as a chosen number with the reason it was chosen, and the
app SHALL NOT present it as a level derived from the data. No screen SHALL describe a flag as
statistically significant, or the line as a confidence level or a tolerance the system worked out.

#### Scenario: A reviewer asks why an application is flagged

- **WHEN** a screen explains why an application is flagged
- **THEN** it says the model and the reviewers are at least that many points apart
- **AND** it does not describe the line as measured, learned, or significant

### Requirement: A reviewer's score is not sign-off

Storing a reviewer's score SHALL NOT approve an application, clear a flag, or mark any score as
reviewed. An application whose reviewer scores are stored SHALL still be shown as not signed off.

#### Scenario: Reviewer scores are stored for a scored application

- **WHEN** a reviewer's scores are stored against an application that already has a model score
- **THEN** both scores are shown as not signed off
- **AND** no message says the application was reviewed, approved, or completed

#### Scenario: A flagged application is looked at

- **WHEN** an application is flagged for a second look
- **THEN** nothing in the app clears the flag, because there is no sign-off to clear it with
- **AND** the screen says the flag stays until sign-off is built
