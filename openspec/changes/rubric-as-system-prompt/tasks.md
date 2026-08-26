## 1. The prompt builder

- [x] 1.1 In `lambdas/shared/prompt.py`, replace `SCHEMA_BLOCK` with a generated output
      contract built from a rubric item's `criteria`: one line per criterion giving its id,
      its name, and `score 0 to <max>`; the JSON object shape; and the rules — one entry
      per criterion by id, no extras, a whole number or a fraction anywhere in the range
      with no step named, no total, score only from the application text
- [x] 1.2 Add the function that returns the two system parts for a rubric item: the stored
      file exactly as read, then the output contract. Nothing is stripped, joined, or
      appended
- [x] 1.3 Raise a named error from that function when the rubric item's stored file is
      absent or empty, with the scholarship and version in the message
- [x] 1.4 Delete `rubric_text`, `static_prefix`, and `_plain`, and update the module
      docstring — the rubric text is no longer assembled and the published file is now
      read at run time
- [x] 1.5 Leave `applicant_text` as it is; it is already the user part

## 2. The score check

- [x] 2.1 In `lambdas/shared/reply.py`, drop the half-point refusal from `_checked_score`
      and the comment that argued for it. Keep the not-a-number and range checks, and keep
      reading the score as a float so 3 and 3.0 are one score
- [x] 2.2 Reword the module docstring — a reply is accepted on complete, matching ids and
      scores inside their own maxima, with nothing said about a step

## 3. The two model calls

- [x] 3.1 Change `converse` in `lambdas/shared/model.py` to take the system parts and the
      user text and pass a `system` list of content blocks beside `messages`
- [x] 3.2 In `score_ondemand`, build the system parts once per run from the rubric item,
      send the applicant text as the user part, and append the retry complaint to the user
      part so the system parts stay byte-identical between the two calls
- [x] 3.3 In `score_batch`, put the system parts on each record's `modelInput` beside
      `messages`
- [x] 3.4 In both workers, read the rubric item and build the system parts before
      `claimable`, so a version with no stored file fails the run with nothing claimed

## 4. The version fingerprint

- [x] 4.1 Change `prompt_shape` in `lambdas/shared/versions.py` to fingerprint the stored
      file plus each criterion's id, name, and maximum, and update its docstring to say
      why levels, guidance, and preamble are no longer in it

## 5. A unique file name, and a dashboard that compares the file

- [x] 5.1 In `lambdas/handlers/rubric_publish.py`, refuse a publish whose file name a
      version of that scholarship has already used, naming the version that holds it and
      asking for a name of this file's own. Check it before anything is written
- [x] 5.2 In `lambdas/handlers/rubric_versions.py`, add `source_text` to `LIST_FIELDS` and
      replace the docstring's reason for leaving it out — the dashboard needs the file to
      tell a weights-only change from a criteria change
- [x] 5.3 In `apps/web/src/features/dashboard/version-change.ts`, compare `source_text` and
      each criterion's id, name, and maximum, matching what `prompt_shape` compares. Delete
      `promptShape` and the `Level` type, and cut `Criterion` down to the three fields that
      are compared

## 6. Tests

- [x] 6.1 The system parts for a published version: first part equal to the stored file
      byte-for-byte, including its closing banner and the full text of every category line
- [x] 6.2 The output contract names every criterion's id and range, allows a fraction
      anywhere in the range, names no step, and asks for no total
- [x] 6.3 A score of 3.7 out of 4 is accepted and stored as 3.7; a score of 3 and a score
      of 3.0 give the same stored score and the same total; a score above the maximum or
      below zero still fails
- [x] 6.4 A rubric item with no stored file fails, and the on-demand run claims nothing
- [x] 6.5 A retry's second call changes only the user part
- [x] 6.6 A batch record carries the system parts and the applicant text as the user
      message, and still carries no tool definition
- [x] 6.7 `prompt_shape`: two versions differing only in weights compare equal; two
      differing by one character in the stored file do not
- [x] 6.8 Update the existing tests that build a prompt, check a reply, or build a batch
      record — `test_reply.py`, `test_batch.py`, `test_run.py`, `test_recompute.py`, and the
      fixtures in `helpers.py` and `conftest.py`. The half-point refusal cases in
      `test_reply.py` now assert the opposite
- [x] 6.9 Publishing refuses a file name a version of that scholarship already used, names
      that version, and writes nothing; the same name under a different scholarship is
      accepted; and a republish of the same text under a new name is still a weights-only
      change
- [x] 6.10 Run the suite and confirm it still finishes in seconds

## 7. Checked against the real thing

- [ ] 7.1 Score one application on demand against the deployed SJSU version and read the
      logged request: the first system block equal to the stored file, the user block the
      applicant text alone
- [ ] 7.2 Submit one small batch job and confirm Bedrock accepts records carrying `system`
