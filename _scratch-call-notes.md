# call notes (my understanding)

temp file. scratch. scholarship project only.

## #1 open question (blocker)
- we don't have the human grades. no scores in any file.
- without them there's nothing to compare AI against.
- ask Harish (leading it) or Carolyn/Andrew (own the scholarships) for last year's human scores.
- no human grades = no comparison = shadow mode can't run.

## the problem today
- 8,000+ scholarship apps a year.
- every app needs at least 2 reviews.
- reviews done by volunteers from all over campus.
- they read on paper. by hand.
- short window to get it done. it's a crush.
- different readers score differently. inconsistent.
- readers get tired. fatigue.
- that creates unfairness for students. real or perceived.

## what they want
- an AI agent takes the first pass.
- it reads each app. scores it against the rubric.
- it gives a short quote as evidence for each score.
- the quote tells the human why it scored that way.
- a human always makes the final call. AI never decides.

## the goal
- not to replace humans. to take load off them.
- faster. so students get their money on time.
- more consistent. kill the reader-to-reader gap.
- less burnout on volunteers.

## how they test it this year (shadow mode)
- humans review like normal. same as always.
- they are NOT told an AI is running too.
- AI scores on the side, quietly.
- then we compare AI scores vs human scores.
- run on last year's data too. see how it stacks up.

## what it should have (from the call)
- reads each app. scores every rubric criteria.
- a short evidence quote per score. says why it scored that way.
- the score gets forwarded to a human.
- human at the end makes the final call.
- compare AI vs human. last year's data + this year's.
- note: they never said what it should look like. no layout, no screens.
- ignore: spanish/hindi idea was said about the chatbot, not scholarship.

## what it should NOT have
- no student frontend. Harish said it plain: "no front end."
- AI never touches students. only reads apps already submitted.
- no reviewer screen this year. shadow mode. readers aren't told.
- no final-decision UI. AI hands a score to a human. that's it.

## the ui (mostly our design, not from the call)
- the call asked for NO ui. deliverable is just the scoring record.
- realistic shape: a table. AI score vs human score side by side.
- one row per app:

```
  app_id   human   AI    gap
  001       78%    85%    7%    <- click in
```

- click a row to see the WHY. per rubric criteria:

```
  criteria         AI   quote
  leadership        4   "led a team of 12 volunteers..."
  essay quality     1   "vague, no specifics..."   <- why AI scored low
```

- overall score is % based. normalizes all 4 rubrics to 0-100.
- only Spartan rubric is natively %. other 3 we convert points -> %.

what's from the call vs ours:
- human grade + AI grade + the why quote -> from the call.
- per-criteria scores -> from the call ("scoring every rubric criteria").
- table, click-to-expand, % overall -> OUR design. good, but not their ask.

## the click-in dialog (our design)
- no pie. a pie tells a tired reader nothing. keep % as plain big text.
- the hero is the essay with the evidence quote highlighted inside it. that's the trust maker.
- layout: essay on the left, scores in a side panel on the right.

```
+-----------------------------------------------------------+
|  app 001        human 78%   AI 85%   gap 7%               |
+------------------------------+----------------------------+
|  THE ESSAY (the why)         |  SIDE PANEL (the scores)   |
|                              |                            |
|  "...I led a team of 12      |  leadership    4/5  *high  |
|   ###############            |   what a 4 means: clear    |
|   volunteers through..."     |   evidence of leading      |
|   ^^ highlighted = the       |                            |
|      quote AI used           |  essay quality 1/5  *low   |
|                              |   what a 1 means: vague    |
|  (rest of essay, dimmed)     |                            |
|                              |  --------------            |
|                              |  composite    85%          |
|                              |  confidence   medium       |
+------------------------------+----------------------------+
```

- left: full essay, evidence quote highlighted. click a criteria -> its quote lights up.
- right: per-criteria score + rubric anchor inline ("what a 4 means") so no pdf needed.
- confidence dot per criteria. composite % + overall confidence at the bottom.
- from the call: only per-criteria score + the highlighted quote. rest is our design.

## other notes
- no student frontend. input is apps already submitted.
- lots of scholarships. all different. rubrics vary.
- nice to have: answers in spanish or hindi.
