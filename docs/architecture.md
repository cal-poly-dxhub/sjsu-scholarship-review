# Architecture: AI-Assisted Scholarship Rubric Scoring

First-pass rubric scoring of scholarship applications, human always makes the
final call. Runs in shadow mode alongside the human readers so we can measure
how closely the AI agrees with them.

## Core idea

Rubric language is subjective ("outstanding" vs "strong"). We don't ask the
model to judge that. We turn each rubric into a **questionnaire of true/false
questions**, the model answers each question against the essay, and math turns
the answers into a score. Subjective grading becomes a set of deterministic
checks.

The model never invents a score. It answers narrow questions with evidence, and
the rubric's own math produces the number.

## Pipeline

```
  RUBRIC PDF                          APPLICATION FILES (.xlsx)
      │                                    │  columns vary per file/year
      ▼                                    ▼
┌──────────────────┐              ┌──────────────────┐
│ INGEST RUBRIC    │              │ INGEST APPS      │
│ pdf → draft      │              │ rows → clean     │
│ questionaire     │              │ essays per app   │
└────────┬─────────┘              └────────┬─────────┘
         ▼                                 │
   FACULTY LOOP                            │
   regenerate all / one / lock            │
         ▼                                 │
   VALIDATOR                               │
   coverage + fairness + answerable        │
         └──────────────┬──────────────────┘
                        ▼
              ┌──────────────────┐
              │ GRADER            │
              │ evidence →        │
              │ reasoning →       │
              │ verdict (T/F/?)   │
              └────────┬──────────┘
                       ▼
              ┌──────────────────┐
              │ SCORING MATH      │
              │ verdicts → scale  │
              │ + weights →       │
              │ composite + conf  │
              └────────┬──────────┘
                       ▼
              HUMAN APPROVES scores (per app)
                       ▼
              ┌──────────────────┐
              │ BENCHMARK         │
              │ AI vs human       │  ◄─ blocked on IT human scores
              └──────────────────┘
```

## Components

### 1. Ingest rubric → questionnaire
Takes a rubric PDF and drafts a questionnaire: a list of true/false questions
that, answered together, reconstruct the rubric's scoring. Each question maps to
one rubric criterion and one point on that criterion's scale.

### 2. Faculty loop
Faculty review the draft questionnaire. They can regenerate the whole thing,
regenerate a single question, or lock it. Nothing grades anyone until faculty
lock the questionnaire. This is the first of two human approval points.

### 3. Validator
Before a locked questionnaire goes live, a model pass checks it against the
rubric on three axes:
- **Coverage** — every rubric criterion has questions covering it.
- **Fairness** — no leading or loaded questions.
- **Answerable** — a normal essay can actually answer the question.

The answerable check is what handles missing data. A question like "did faculty
give a strong recommendation" can't be answered from an essay, so the validator
flags or kills it before grading. Missing-data problems get caught at
questionnaire time, not downstream.

### 4. Ingest apps → clean essays
The eight application files have different columns per scholarship and even
between years (26-27 dropped the GPA column). This normalizes any file into one
application object with named essay fields, marking which fields are missing.

### 5. Grader
For each question on the locked questionnaire, the model produces, in this order:
1. **Evidence** — verbatim sentences pulled from the essay that bear on the question.
2. **Reasoning** — why those sentences do or don't satisfy the question.
3. **Verdict** — true / false / cant-tell, decided last.

Order is deliberate. Evidence and reasoning come first so the verdict falls out
of them. If the model picked a verdict first and justified it after, it would
rationalize. Deciding last keeps it unbiased. "Cant-tell" is a real option, used
when the essay has nothing to answer the question, and it feeds confidence.

### 6. Scoring math
Turns the verdicts into the rubric's actual number. Each rubric has its own
scale and weights, so this is a per-rubric mapping, not a raw count:

| Rubric | Scale | Weights |
|---|---|---|
| SJSU Spartan | mixed 0-1 / 0-4 / 0-3 | weighted %, sums to 100 |
| Engineering | 0-5 per category | none |
| Lurie Education | 0-10 per category | none |
| Physics | tiered 5 / 3-4 / 1-2 | none |

Output per application: per-criterion score, evidence quotes, composite score,
and a confidence flag driven by the count of cant-tell answers.

### 7. AI-detection gate (Spartan only)
The Spartan rubric has a hard rule: if an essay is obviously AI-written
(placeholder text like "insert major", no personalization, no effort), score it
0 across all categories. This is a separate gate, not a normal question, because
it overrides the whole score. Acknowledged AI use is still graded on quality.

### 8. Human approval
Second approval point. A human signs off on the AI scores per application before
they count. The AI never makes the final award decision.

### 9. Benchmark
Compares AI scores to human scores to measure agreement, surfaces disagreements
for calibration. This is the entire point of the shadow run.

## Rubric-vs-data coverage

The data covers the essay-based rubrics well. Physics is the exception, it wants
data that isn't in the applications.

| Rubric | Criteria wanted | In the data? |
|---|---|---|
| Spartan | extracurricular, 2 essays, initiative, creative | all present, fully scoreable |
| Engineering | essays, extracurricular/jobs, GPA | all present |
| Lurie | career goals, personal growth, LCOE essay | all present |
| Physics | academics, research, service, financial, faculty rec | only GPA + challenges, 4 of 6 missing |

Design consequence: the agent must abstain and flag low confidence when a
criterion has no source. The validator catches most of this at questionnaire
time.

## Application volume

| Scholarship | 25-26 | 26-27 |
|---|---|---|
| SJSU General (Spartan) | 1,903 | 4,887 |
| CoE Engineering | 999* | 999* |
| Lurie Education | 281 | 222 |
| Physics | 9 | 15 |

*Both exactly 999, likely an export cap. Confirm with IT.

## Blockers

1. **No human scores in any file.** The benchmark is empty until IT delivers last
   year's human reader scores. This is the whole comparison, and the #1 ask.
2. **Physics wants data we don't have.** Either narrow scope to the three
   scoreable scholarships or source the missing fields.
