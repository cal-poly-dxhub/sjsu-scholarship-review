## ADDED Requirements

### Requirement: A reviewer-score file is uploaded from the dashboard against a picked cohort

The dashboard SHALL be where a person uploads a reviewer-score file, beside where an application
export is uploaded and clearly distinguished from it. The picker SHALL accept an `.xlsx` or a `.csv`
and SHALL refuse any other suffix on the screen rather than handing out an upload URL for a file
nothing will read.

The file SHALL be stored under its own prefix in the environment's bucket, apart from the application
exports, so neither ingest ever reads the other's file. Because a reviewer-score file names neither
the scholarship nor the academic year, the stored object SHALL carry the cohort the person picked,
and the ingest SHALL take the cohort from that rather than from the file name. A person SHALL NOT be
able to upload one without a cohort picked. An upload SHALL NOT start scoring.

#### Scenario: A person uploads reviewer scores

- **WHEN** a person picks a reviewer-score file with a cohort picked
- **THEN** it is stored under the reviewer-score prefix against that cohort, the ingest stores the
  reviewer scores, and the screen says how many rows came in and how many could not be placed

#### Scenario: No cohort is picked

- **WHEN** a person tries to upload a reviewer-score file with no cohort picked
- **THEN** the screen says a cohort has to be picked first, and nothing is uploaded

#### Scenario: A person picks a file of some other kind

- **WHEN** a person picks a file that is neither an `.xlsx` nor a `.csv`
- **THEN** the screen says which two kinds it takes, and nothing is uploaded

#### Scenario: An upload lands

- **WHEN** a reviewer-score file finishes uploading
- **THEN** nothing is scored or re-scored, and no application's model score changes

#### Scenario: An application export lands under the reviewer-score prefix

- **WHEN** a file under the reviewer-score prefix does not name the reviewer-score columns in its
  first row
- **THEN** it is refused whole, nothing is written, and the message says the file does not look like
  a reviewer-score export

### Requirement: A reviewer-score file is read by the same reader as an export

A reviewer-score file SHALL be read as an `.xlsx` workbook or a `.csv` by the same row reader, header
check, and encoding handling that reads an application export, and SHALL produce the same reviewer
scores from either. A file under the reviewer-score prefix with any other suffix SHALL be left alone
rather than failed.

The columns the file names SHALL be mapped to the rubric's criteria in one declared place. A column
SHALL NOT be matched to a criterion by guessing at its name, and a criterion's maximum SHALL come
from the rubric rather than from the values seen in the file.

A criterion cell SHALL be read as a block naming one or more reviewers and the score each gave. A
cell the reader cannot take apart SHALL be reported for its row rather than read as a zero.

#### Scenario: The file is a workbook

- **WHEN** a reviewer-score file is uploaded as an `.xlsx`
- **THEN** the same reviewer scores are stored as from the equivalent `.csv`

#### Scenario: A CSV that is not UTF-8

- **WHEN** a reviewer's name in a CSV contains a character written in a Windows code page rather than
  UTF-8
- **THEN** the file is read and the name is kept, rather than the whole file failing on one byte

#### Scenario: A cell holds several reviewers

- **WHEN** a criterion cell names two reviewers and the score each gave
- **THEN** both scores are read, each against the reviewer who gave it

#### Scenario: A cell cannot be taken apart

- **WHEN** a criterion cell holds text the reader cannot read as reviewers and scores
- **THEN** that row is reported with what stopped it, and no score is stored for it as a zero

#### Scenario: Some other file lands under the reviewer-score prefix

- **WHEN** a file that is neither an `.xlsx` nor a `.csv` lands under the reviewer-score prefix
- **THEN** nothing is ingested and nothing is reported as a failure

### Requirement: A row is matched to an application by the identifier the office exports

A reviewer-score row SHALL name its applicant by the identifier the office's export carries, and the
ingest SHALL resolve it to one application in the picked cohort. The resolution SHALL be exact. A row
SHALL NOT be matched by position in the file, by grade point average, by name, or by any other value
that is not an identifier.

A row whose identifier is missing, damaged, or matches no application in the cohort SHALL be reported
with its row number and the identifier as it appeared, and SHALL NOT be written. Two rows resolving
to the same application SHALL be reported as duplicates rather than one quietly overwriting the
other.

#### Scenario: A row names an applicant in the cohort

- **WHEN** a row's identifier resolves to one application in the picked cohort
- **THEN** its reviewer scores are stored against that application

#### Scenario: A spreadsheet program damaged an identifier

- **WHEN** a row's identifier has been turned into scientific notation or has lost a leading
  character
- **THEN** the row is reported with its row number and the identifier as it appeared, and nothing is
  written for it

#### Scenario: A row names nobody in the cohort

- **WHEN** a row's identifier matches no application in the picked cohort
- **THEN** the row is reported, and it is not written against some other cohort's application

#### Scenario: Two rows for one application

- **WHEN** two rows in one file resolve to the same application
- **THEN** the duplicate is reported rather than silently keeping one

#### Scenario: Every row fails to match

- **WHEN** no row in a file matches any application in the picked cohort
- **THEN** the report says the file matched nothing and names the cohort it was uploaded against,
  rather than reporting a clean ingest of zero rows

### Requirement: A reviewer's score is its own item and does not disturb the model's

A reviewer's scores for one application SHALL be stored as an item distinguished by the application
and the reviewer, so one application can carry several reviewers' scores and no reviewer's scores
overwrite another's. Storing them SHALL NOT change the application's model score, its per-criterion
scores, its rubric version, its scoring state, or its place in a ranking by total.

#### Scenario: Two reviewers for one application

- **WHEN** two reviewers' scores are stored for one application
- **THEN** both are readable as separate records, each naming its reviewer

#### Scenario: Reviewer scores land on a scored application

- **WHEN** reviewer scores are stored against an application that is already scored
- **THEN** its model score, its state, and its rank by total are unchanged afterwards

#### Scenario: The same reviewer's scores arrive again

- **WHEN** the same reviewer's scores for the same application are ingested a second time
- **THEN** one record is left, not two

### Requirement: Ingesting a reviewer-score file again is safe

Ingesting the same reviewer-score file again SHALL leave the same stored result and SHALL NOT
double-count anything. Any figure the ingest maintains across a cohort SHALL be rebuilt from what is
stored rather than added to what was there.

#### Scenario: The same file is uploaded twice

- **WHEN** a reviewer-score file is uploaded a second time
- **THEN** the stored reviewer scores, gaps, flags, and cohort figures are the same as after the
  first upload

#### Scenario: A corrected file is uploaded

- **WHEN** a file is uploaded again with a reviewer's score corrected
- **THEN** that reviewer's stored score, the application's gap, and whether it is flagged all follow
  the corrected file
- **AND** applications the file no longer mentions keep the reviewer scores they already had

### Requirement: The ingest reports what it could not place

A reviewer-score ingest SHALL leave a report a screen can read back, because the ingest runs after
the upload finishes and the person who uploaded is no longer in the request. The report SHALL say
which file it was, which cohort it was read against, how many rows were read, how many reviewer
scores were stored, and every row it could not place, with the row number and the reason.

A report SHALL NOT describe a file as ingested cleanly when rows were rejected.

#### Scenario: A file with some unusable rows

- **WHEN** a file is ingested and some of its rows cannot be placed
- **THEN** the report names each of those rows and why, alongside the counts of what was stored

#### Scenario: A person watches an upload finish

- **WHEN** a person has uploaded a reviewer-score file
- **THEN** the screen shows that file's report once the ingest has run, rather than only that the
  upload succeeded

#### Scenario: The file could not be read at all

- **WHEN** a file is refused whole
- **THEN** the report says nothing was stored and why, rather than leaving the screen waiting

### Requirement: The gap is stored so the queue and the figures are read without scanning

An application's gap between its model total and its reviewers' total SHALL be stored on the
application, and an application that is flagged SHALL be addressable in an order by the size of that
gap. Reading the review queue SHALL be a paged read of that order, not a scan of the table.

Figures the reliability section reports across cohorts SHALL be read from a stored summary per
cohort, rebuilt by each ingest from what that cohort holds. Reading them SHALL NOT read every
application, and SHALL NOT be a scan.

#### Scenario: The queue is paged

- **WHEN** a page of the review queue is read
- **THEN** it comes from the order by gap size, widest first, and no cohort's applications are
  scanned to produce it

#### Scenario: A gap stops crossing the line

- **WHEN** a corrected reviewer score brings an application's gap under the disagreement line
- **THEN** the application no longer appears in the queue

#### Scenario: An application loses its model score

- **WHEN** an application is marked for scoring again and its total is taken away
- **THEN** its gap and its flag are taken away with it, so no gap is shown against a total that is
  no longer there

#### Scenario: Reliability figures are read

- **WHEN** the reliability section's disagreement figures are read
- **THEN** they come from the per-cohort summaries, and the number of reads does not grow with the
  number of applications

### Requirement: A reviewer is identified by the name the file gives, tidied once

A reviewer SHALL be identified by the name the file gives them, with surrounding and repeated
whitespace tidied, so one reviewer whose name is spelled with different spacing in different cells is
one reviewer. The name SHALL be kept as it was written for showing on screen. No email address,
account, or identity from the signed-in user SHALL be attached to a reviewer read out of a file.

#### Scenario: The same reviewer, spaced differently

- **WHEN** a file spells one reviewer's name with a doubled space in one cell and a single space in
  another
- **THEN** both are stored against one reviewer

#### Scenario: A reviewer is shown

- **WHEN** a reviewer's name is shown on screen
- **THEN** it reads as the file wrote it
- **AND** it is not presented as an account in the app
