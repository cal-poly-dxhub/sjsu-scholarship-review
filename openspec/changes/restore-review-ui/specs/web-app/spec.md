## Purpose

What each screen of the web app shows, what a reviewer can do on it, and what it says when the
read behind a section does not exist. Covers the nav, the dashboard's two halves, the scholarships
list and detail, the reviews queue and the hand-scoring form, and the two rubric screens.

## ADDED Requirements

### Requirement: Every built screen is reachable from the nav

The nav SHALL offer one entry per screen the app has, and every entry SHALL lead to a screen that
renders. A screen that exists but is unreachable is not built as far as a reviewer is concerned, so
no screen SHALL be left out of the nav on the grounds that it cannot yet do its job.

#### Scenario: Reviewer opens the rubrics screen

- **WHEN** a reviewer clicks the Rubrics entry in the nav
- **THEN** the rubrics screen renders
- **AND** it is the same entry on every visit, not one that appears only when a rubric exists

#### Scenario: Every entry leads somewhere

- **WHEN** a reviewer clicks each nav entry in turn
- **THEN** each one renders a screen with a heading naming it
- **AND** none renders a blank frame or an error

### Requirement: Every word on screen is written for a scholarship reviewer

The reader is a person who reviews scholarship applications, not a person who maintains the system.
Every heading, label, button, hint, empty state, and error SHALL be written in the words that person
already uses — applications, scholarships, criteria, scores, rubrics, spreadsheets. Screen text
SHALL NOT name or explain the machinery behind it: no endpoint, path, or HTTP verb, no service,
queue, worker, job, table, or log group, no field or type name from the code, and no account or
billing detail. Where a limit or a wait comes from the machinery, the screen SHALL say what it means
for the reviewer's work instead of how it is arranged. Text SHALL be short enough to read once and
act on.

Capitalization SHALL be consistent across every screen. Headings, labels, buttons, table headers, and
body text SHALL be sentence case — the app's existing convention — with capitals kept for proper
nouns and for names the app gives things. A short status badge MAY be uppercase where that is already
the badge style. The same thing SHALL NOT be capitalized one way in one place and another way
elsewhere.

#### Scenario: The same thing named on two screens

- **WHEN** the same thing is named on two screens
- **THEN** it is spelled and capitalized the same way in both

#### Scenario: A restored heading beside a current one

- **WHEN** a restored section's heading sits near a heading the app already has
- **THEN** both are sentence case
- **AND** a mid-sentence word is capitalized only if it is a proper noun or a name the app gives

#### Scenario: A section cannot show something

- **WHEN** a section cannot show what its title promises
- **THEN** it says in one short line what is missing in the reviewer's terms
- **AND** it says what the reviewer can do instead, if there is anything
- **AND** it names no endpoint, service, worker, table, or log

#### Scenario: A wait a reviewer has to sit through

- **WHEN** the size of a cohort changes how the work runs or how long it takes
- **THEN** the screen says what that means — roughly how long, and whether to wait or come back
- **AND** it does not explain which mechanism runs, or why one is cheaper than another

#### Scenario: Something goes wrong

- **WHEN** a request fails
- **THEN** the screen says what did not happen and what to try
- **AND** it does not print a status code, a path, or a stack of internal detail as the whole message

### Requirement: A section with no read behind it says so and draws nothing

A section whose data the API cannot supply SHALL say plainly that the app cannot show it yet, and
SHALL draw no figure. It SHALL NOT show a zero, an empty chart, a percentage of nothing, or a dash
where a number would go, because each of those reads as a measured result.

#### Scenario: Reliability section with nothing to compare

- **WHEN** a reviewer opens the dashboard
- **THEN** the reliability section says no reviewer scores are saved yet, so there is nothing to compare
- **AND** no agreement rate, variance figure, or chart bar is drawn
- **AND** the wording does not suggest the comparison ran and found nothing

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

#### Scenario: Reviewer reads the section before any data exists

- **WHEN** a reviewer scrolls to the reliability section
- **THEN** the banner, both comparison cards, and each breakdown are present and titled
- **AND** each says no reviewer scores are saved yet, so there is nothing to compare
- **AND** no part of it is collapsed away or absent

#### Scenario: The section has no data and the controls above it do work

- **WHEN** the reliability section has nothing to show
- **THEN** the upload, cohort, rubric, and run controls above it still work

### Requirement: Scoring coverage is drawn from the read that exists

The dashboard SHALL show scoring coverage for the picked cohort from data the API already serves:
how many applications are scored, unscored, running, and failed, and how many were scored under
each published rubric version. These SHALL be real counts, and the section SHALL NOT present them
as agreement or reliability figures.

#### Scenario: Coverage for a cohort with mixed states

- **WHEN** a reviewer picks a cohort holding scored, unscored, and failed applications
- **THEN** each state's count is shown
- **AND** the count for each rubric version that scored any of them is shown
- **AND** the panel's wording says these are counts of work done, not a measure of agreement

### Requirement: The reviews queue is present and says what would fill it

The Reviews screen SHALL show the review queue's table, its filters, and its paging, and SHALL say
that nothing can land in the queue yet, because an application is flagged for review when a
reviewer's score disagrees with the model's, and no reviewer scores are saved yet. It SHALL NOT
present an empty table as "no applications need review".

#### Scenario: Reviewer opens the queue

- **WHEN** a reviewer opens the Reviews screen
- **THEN** the queue's columns and controls are visible
- **AND** the screen says nothing can be flagged for review yet, and why, in one or two short lines
- **AND** it does not say the queue is clear or that all flags are resolved

### Requirement: A reviewer can score an application by hand

The app SHALL offer a screen where a reviewer reads an application's answers, sees the model's
score and its reasoning for each criterion of the rubric version that scored it, and enters their
own score per criterion. Each entry SHALL be bounded by that criterion's maximum from the published
rubric, and the rubric SHALL be the only source of the criteria, their names, and their maxima.

#### Scenario: Reviewer scores every criterion

- **WHEN** a reviewer opens an application on the hand-scoring screen
- **THEN** the answers are shown in full
- **AND** each criterion of the scoring rubric version is listed with the model's score and reasoning
- **AND** each criterion offers an entry bounded by its own maximum

#### Scenario: A score above the criterion's maximum

- **WHEN** a reviewer enters a score above a criterion's maximum
- **THEN** the screen refuses it and names the maximum

#### Scenario: The application has no model score

- **WHEN** a reviewer opens an application nothing has scored
- **THEN** the criteria are listed from the newest published rubric version
- **AND** the model column says the application is unscored rather than showing a zero

### Requirement: A hand-typed score cannot be saved, and the screen says so first

There is nowhere to write a reviewer's score, so the hand-scoring screen SHALL say that before any
score is entered, SHALL leave submitting unavailable, and SHALL NOT accept a submission that goes
nowhere. It SHALL let the reviewer take their entered scores away as a file so the reading is not
lost.

#### Scenario: Reviewer arrives at the screen

- **WHEN** the hand-scoring screen opens
- **THEN** it says scores typed here cannot be saved yet, and that they can be downloaded instead
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

### Requirement: The human comparison columns are offered without disturbing the working list

The applications list SHALL offer the human, model, final, and variance columns and the review flag
as a group a reviewer turns on, off by default. Turning the group on SHALL NOT change, reorder, or
remove the total and per-criterion columns the list shows now. Every cell in the group SHALL read
as not stored.

#### Scenario: Default view

- **WHEN** a reviewer opens a cohort's applications
- **THEN** the total and per-criterion columns are shown as they are now
- **AND** the comparison columns are not shown

#### Scenario: Reviewer turns the group on

- **WHEN** a reviewer turns on the comparison columns
- **THEN** the human, model, final, and variance columns and the review flag appear
- **AND** every one of their cells says the figure is not stored
- **AND** the existing columns are unchanged and in the same order

#### Scenario: No variance is invented

- **WHEN** the comparison columns are shown for a scored application
- **THEN** the model column does not restate the stored total as a second opinion
- **AND** no variance is computed between the stored total and itself

### Requirement: A restored filter that cannot filter is visible and unavailable

The list SHALL show the human score, model score, and variance range filters, SHALL leave them
unavailable, and SHALL give one reason. An unavailable filter SHALL NOT count toward the number of
filters in use and SHALL NOT change which rows are shown.

#### Scenario: Reviewer opens the filters

- **WHEN** a reviewer opens the filter panel
- **THEN** the program, level, major, GPA, and total filters work
- **AND** the human, model, and variance range filters are present and unavailable with a reason
- **AND** the count of filters in use covers only the ones that work

### Requirement: A superseded score is never shown as a current figure

Wherever a score appears — the list, the detail screen, the hand-scoring screen, the comparison
columns, or an exported file — a score that is no longer current SHALL be marked as the previous
one, with the reason. A superseded total SHALL NOT be shown as a number in a column, SHALL NOT be
matched by a score range filter, and SHALL NOT be ranked.

#### Scenario: Answers changed after scoring

- **WHEN** an application's answers changed after its score was made
- **THEN** its total is not shown as a number in the list
- **AND** its state says the score is out of date
- **AND** the detail and hand-scoring screens show the score marked as the previous one, with the reason

#### Scenario: A range filter over superseded totals

- **WHEN** a reviewer filters on a total range
- **THEN** an application whose total is superseded does not match
- **AND** it stays findable by searching its identifier, program, level, major, or GPA

### Requirement: The rubrics screen takes a file and reports the real state of the request

The rubrics screen SHALL accept a rubric file, show it alongside the criteria and options being
edited, and let a reviewer edit a draft's criteria, options, and score bands. Turning a PDF into a
rubric on its own is not built, so the screen SHALL say so and point at the way that works today.

#### Scenario: Reviewer picks a rubric PDF

- **WHEN** a reviewer picks a rubric PDF
- **THEN** the file is shown on the screen
- **AND** the screen says it cannot build a rubric from the PDF yet

#### Scenario: Reviewer is pointed at what works

- **WHEN** the rubrics screen says it cannot build a rubric from the PDF
- **THEN** it says the dashboard takes a rubric pasted as a text or Markdown file and publishes it

### Requirement: No screen reports a step it did not perform

A screen SHALL describe only work that happened. It SHALL NOT advance a named stage, tick a check,
or report progress on a timer, an estimate, or anything other than the state of the work itself. A
stage that cannot be observed SHALL NOT be named.

#### Scenario: A request with no progress to report

- **WHEN** a screen is waiting on a request that reports no progress
- **THEN** it says it is waiting
- **AND** it does not name stages, tick checks, or advance a bar as if it knew how far along the work is

#### Scenario: A check that nothing performs

- **WHEN** no step verifies that a rubric's options were copied word for word
- **THEN** no screen says that check ran, passed, or is running

### Requirement: One cohort is addressed one way across every screen

Every screen that works on a cohort SHALL address it by the same pair a reviewer picks — the
scholarship and the academic year — and every screen that works on one application SHALL address it
by the applicant identifier within that cohort. No screen SHALL ask a reviewer for an identifier the
store cannot resolve.

#### Scenario: Reviewer moves between screens

- **WHEN** a reviewer picks a cohort on one screen and moves to another that works on a cohort
- **THEN** the second screen offers the same picker over the same list of ingested cohorts
- **AND** it does not ask for a different identifier for the same cohort

#### Scenario: Nothing has been uploaded yet

- **WHEN** no cohort has been uploaded
- **THEN** each cohort picker says there is nothing to pick yet and that uploading a spreadsheet
  is what adds one
- **AND** a reviewer can still type a scholarship and year, with an example of each shown

### Requirement: The same control behaves the same on every screen

A filter, a search box, an empty state, and a statement that the app cannot show something SHALL
look and behave the same on every screen that uses one. A restored screen SHALL NOT introduce a
second set of controls that does the same job differently.

#### Scenario: Filters on two screens

- **WHEN** a reviewer opens the filters on the applications list and on the reviews queue
- **THEN** the same kinds of filter take the same form and clear the same way

#### Scenario: The same gap described twice

- **WHEN** two screens cannot show something for the same reason
- **THEN** both say it the same way, in the same words
