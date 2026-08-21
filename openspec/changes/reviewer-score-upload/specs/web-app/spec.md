## ADDED Requirements

### Requirement: The dashboard takes a reviewer-score file beside the application export

The dashboard SHALL offer uploading a reviewer-score file next to uploading an application export,
and SHALL make plain which one each control takes — one brings applications in, the other brings a
reviewer's scores for applications already in. Both SHALL use the same picker, the same accepted
suffixes, and the same wording for a refused file.

The reviewer-score control SHALL require a cohort to be picked before it will take a file, and SHALL
say so rather than failing after the file is chosen.

#### Scenario: A person looks at the two controls

- **WHEN** a person opens the dashboard
- **THEN** each upload control says in one short line what kind of file it takes and what that file
  adds

#### Scenario: No cohort is picked

- **WHEN** a person opens the reviewer-score control with no cohort picked
- **THEN** it says a cohort has to be picked first, and does not offer to take a file

#### Scenario: A file of the wrong kind

- **WHEN** a person picks a file that is neither an `.xlsx` nor a `.csv`
- **THEN** the same wording is used as for a refused application export

### Requirement: The upload panel reports the rows it could not place

After a reviewer-score file is uploaded, the screen SHALL show that file's ingest report: how many
rows were read, how many reviewer scores were stored, and each row that could not be placed with its
row number and the reason in a reviewer's words. It SHALL NOT report an upload as finished while the
report says rows were rejected, and SHALL NOT report a clean result it did not read.

While it is waiting for the report the screen SHALL say it is waiting, and SHALL NOT describe stages
or advance a bar.

#### Scenario: Some rows could not be placed

- **WHEN** an uploaded file's report names rejected rows
- **THEN** the screen lists them by row number with the reason for each
- **AND** it does not describe the upload as a clean ingest

#### Scenario: The report has not arrived yet

- **WHEN** the file has uploaded and the report is not there yet
- **THEN** the screen says it is waiting for the file to be read
- **AND** it names no stage and shows no progress it cannot observe

#### Scenario: The report never arrives

- **WHEN** the screen has waited longer than it is willing to
- **THEN** it says it stopped waiting and that the file may still be being read, and offers to check
  again
- **AND** it does not say the ingest failed

#### Scenario: The whole file was refused

- **WHEN** a file was refused before anything was stored
- **THEN** the screen says nothing was stored, and why

### Requirement: The reviews queue holds the applications where the model and a reviewer disagree

The Reviews screen SHALL list the applications flagged because their model total and their reviewers'
total are at least the disagreement line apart, widest gap first, across every cohort that has
reviewer scores. Each row SHALL show the applicant, the scholarship, the model total, the reviewers'
total, and the gap. The screen SHALL say what puts an application in the queue and how many points
apart counts.

The queue's filters and its paging SHALL work. Where the queue is empty, the screen SHALL say whether
that is because no reviewer scores are stored yet or because nothing crosses the line, and SHALL NOT
use one wording for both.

#### Scenario: A reviewer opens the queue

- **WHEN** a reviewer opens the Reviews screen and reviewer scores are stored
- **THEN** the flagged applications are listed widest gap first
- **AND** one short line says an application is here because the model and the reviewers are at least
  that many points apart

#### Scenario: Nothing crosses the line

- **WHEN** reviewer scores are stored and no application's gap reaches the line
- **THEN** the screen says the model and the reviewers agree within the line on every application
  scored so far
- **AND** it says how many applications that covers, so it does not read as a claim about the whole
  cohort

#### Scenario: No reviewer scores at all

- **WHEN** no reviewer scores are stored
- **THEN** the screen says nothing can be flagged yet because no reviewer scores have been uploaded,
  and points at the dashboard's upload
- **AND** it does not say the queue is clear or that the model and reviewers agree

#### Scenario: The queue is paged and filtered

- **WHEN** a reviewer filters the queue and moves through its pages
- **THEN** the filters change which rows are listed and the paging moves through them
- **AND** the filters take the same form and clear the same way as the applications list's

#### Scenario: An application in the queue is opened

- **WHEN** a reviewer opens a flagged application from the queue
- **THEN** they see the model's and each reviewer's per-criterion scores side by side
- **AND** nothing on the screen offers to resolve, clear, or sign off the flag

### Requirement: The applications list filters and orders by the score gap

The applications list SHALL let a reviewer filter to the flagged applications and filter on a range
of gap sizes, and those filters SHALL count toward the number of filters in use and SHALL change
which rows are shown. An application with no gap stored SHALL NOT match a gap range filter, and SHALL
stay findable by the filters that do not depend on a gap.

#### Scenario: Filtering to the flagged applications

- **WHEN** a reviewer filters a cohort's applications to the flagged ones
- **THEN** only applications whose gap reaches the line are listed
- **AND** the count of filters in use includes it

#### Scenario: An application with no reviewer score

- **WHEN** a reviewer filters on a gap range
- **THEN** an application no reviewer scored does not match
- **AND** it stays findable by its identifier, program, level, major, GPA, or total

## MODIFIED Requirements

### Requirement: A section with no read behind it says so and draws nothing

A section whose data the API cannot supply SHALL say plainly that the app cannot show it yet, and
SHALL draw no figure. It SHALL NOT show a zero, an empty chart, a percentage of nothing, or a dash
where a number would go, because each of those reads as a measured result.

Where a section has a read behind part of it and not the rest, the part with data SHALL draw its
figures and the rest SHALL keep saying what is missing. A figure SHALL NOT be drawn across
applications it does not cover, so any figure made from reviewer scores SHALL say how many
applications it covers.

#### Scenario: Reliability section before any reviewer scores exist

- **WHEN** a reviewer opens the dashboard and no reviewer scores are stored
- **THEN** the reliability section says no reviewer scores are saved yet, so there is nothing to
  compare
- **AND** no agreement rate, variance figure, or chart bar is drawn
- **AND** the wording does not suggest the comparison ran and found nothing

#### Scenario: Reliability section with reviewer scores for part of a cohort

- **WHEN** reviewer scores are stored for some of a cohort's applications
- **THEN** the disagreement figures are drawn from the applications that have both a model and a
  reviewer total
- **AND** each says how many applications it covers, and that the rest are not in it

#### Scenario: A section that normally works fails to load

- **WHEN** a section's data normally loads but the request fails
- **THEN** the section says it could not load and offers to try again
- **AND** the wording differs from the wording used where the app cannot show something at all

#### Scenario: Two sections, one with no data behind it

- **WHEN** one section has no data behind it and another does
- **THEN** the section with data draws its figures
- **AND** the other does not prevent it from rendering

### Requirement: The reliability section shows its full layout

The dashboard SHALL show the reliability section's whole layout — the summary banner, the
human-against-human and model-against-human comparison cards, and the agreement and variance
breakdowns — below the controls that start work. Each part SHALL stay visible and say what it will
report, rather than be hidden, so a reviewer can see what the section is for.

The model-against-human card, the score-gap breakdown, and the per-scholarship breakdown of the gap
SHALL be drawn from the stored reviewer scores once any exist. The human-against-human card and the
per-reviewer distribution SHALL keep saying they are not built, because comparing two reviewers with
each other is not in this change even though both reviewers' scores are stored.

#### Scenario: Reviewer reads the section before any reviewer scores exist

- **WHEN** a reviewer scrolls to the reliability section and no reviewer scores are stored
- **THEN** the banner, both comparison cards, and each breakdown are present and titled
- **AND** each says no reviewer scores are saved yet, so there is nothing to compare
- **AND** no part of it is collapsed away or absent

#### Scenario: Reviewer reads the section once reviewer scores exist

- **WHEN** reviewer scores are stored
- **THEN** the model-against-human card, the score-gap breakdown, and the per-scholarship breakdown
  show real figures with the number of applications behind each
- **AND** the human-against-human card and the per-reviewer distribution say comparing reviewers with
  each other is not built yet
- **AND** neither of those draws a zero, an empty bar, or a dash

#### Scenario: The section has no data and the controls above it do work

- **WHEN** the reliability section has nothing to show
- **THEN** the upload, cohort, rubric, and run controls above it still work

### Requirement: A hand-typed score cannot be saved, and the screen says so first

There is nowhere to write a reviewer's score from inside the app, so the hand-scoring screen SHALL
say that before any score is entered, SHALL leave submitting unavailable, and SHALL NOT accept a
submission that goes nowhere. It SHALL say that a reviewer's scores are added by uploading the
office's reviewer-score file on the dashboard, so the screen does not read as a dead end. It SHALL let
the reviewer take their entered scores away as a file so the reading is not lost.

#### Scenario: Reviewer arrives at the screen

- **WHEN** the hand-scoring screen opens
- **THEN** it says scores typed here cannot be saved, that reviewer scores are added by uploading the
  office's file on the dashboard, and that what is typed here can be downloaded instead
- **AND** the statement is visible before any score is entered

#### Scenario: Reviewer finishes scoring

- **WHEN** a reviewer has entered a score for every criterion
- **THEN** submitting is still unavailable and still says why
- **AND** the reviewer can download their entered scores, the application's identifier, and the
  rubric version as a file

#### Scenario: Nothing is claimed to have been saved

- **WHEN** a reviewer leaves the hand-scoring screen
- **THEN** no message says a review was submitted, recorded, or completed
- **AND** no review flag is described as cleared

#### Scenario: The application already has uploaded reviewer scores

- **WHEN** a reviewer opens the hand-scoring screen for an application that already has reviewer
  scores from a file
- **THEN** those scores are shown per criterion, naming the reviewer who gave each
- **AND** what the reviewer types here is still not saved, and still says so

### Requirement: The human comparison columns are offered without disturbing the working list

The applications list SHALL offer the human, model, final, and variance columns and the review flag
as a group a reviewer turns on, off by default. Turning the group on SHALL NOT change, reorder, or
remove the total and per-criterion columns the list shows now.

The human, variance, and review flag cells SHALL carry real figures for an application that has both
a model total and a reviewer total. Where an application is missing either, those cells SHALL say
which one is missing rather than showing a zero, a dash, or a full gap. The final column SHALL read
as not stored, because sign-off is not built.

#### Scenario: Default view

- **WHEN** a reviewer opens a cohort's applications
- **THEN** the total and per-criterion columns are shown as they are now
- **AND** the comparison columns are not shown

#### Scenario: Reviewer turns the group on

- **WHEN** a reviewer turns on the comparison columns
- **THEN** the human, model, final, and variance columns and the review flag appear
- **AND** the existing columns are unchanged and in the same order

#### Scenario: An application with both totals

- **WHEN** an application has a model total and at least one reviewer total
- **THEN** the human column shows the reviewers' total, the variance column shows the gap, and the
  flag says whether it reaches the line
- **AND** the final column says it is not stored

#### Scenario: An application no reviewer scored

- **WHEN** an application has a model total and no reviewer total
- **THEN** the human, variance, and flag cells say no reviewer has scored it
- **AND** no gap is shown as zero and no flag is shown as clear

#### Scenario: An application nothing has scored

- **WHEN** an application has reviewer scores and no model total
- **THEN** the variance and flag cells say the model has not scored it
- **AND** the reviewers' total is still shown

#### Scenario: No variance is invented

- **WHEN** the comparison columns are shown
- **THEN** the model column does not restate the stored total as a second opinion
- **AND** no variance is computed between the stored total and itself

### Requirement: A restored filter that cannot filter is visible and unavailable

The list SHALL show the reviewer score, model score, and score gap range filters and SHALL leave
working the ones there is now a read behind: the reviewer score range, the score gap range, and the
flagged filter. A filter the app still cannot serve SHALL stay present and unavailable with one
reason, SHALL NOT count toward the number of filters in use, and SHALL NOT change which rows are
shown.

#### Scenario: Reviewer opens the filters

- **WHEN** a reviewer opens the filter panel
- **THEN** the program, level, major, GPA, total, reviewer score, score gap, and flagged filters work
- **AND** any filter that depends on sign-off is present and unavailable with a reason
- **AND** the count of filters in use covers only the ones that work

#### Scenario: A filter that has become available

- **WHEN** a filter that used to be unavailable now has a read behind it
- **THEN** it takes a value and changes which rows are shown
- **AND** no reason for being unavailable is left on it

## REMOVED Requirements

### Requirement: The reviews queue is present and says what would fill it

**Reason**: Reviewer scores can now be stored, so the queue fills. What replaced it is the added
requirement "The reviews queue holds the applications where the model and a reviewer disagree", which
keeps the empty-state wording this requirement asked for and separates the two reasons the queue can
be empty.

**Migration**: None. No stored data or API depends on this requirement; it described an empty screen.
The wording it required for "nothing can be flagged yet, and why" is carried forward as the no
reviewer scores at all scenario of the replacing requirement.
