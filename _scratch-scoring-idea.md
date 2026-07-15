# Scoring idea — rubric → questionnaire → judge

## DECISION (locked)
- **Model = Sonnet** (claude-sonnet-4-6 on Bedrock, us-west-2)
- **Method = TEXT**: Sonnet sees the questionnaire and picks the option by its anchor SENTENCE (not the number, not a code). We map the sentence → number ourselves for the math.
- Judge returns per row: pick + reason + citation. Run 5x → majority = score, agreement % = confidence.

### why (evidence, not vibes)
- Benchmarked Sonnet-text vs Sonnet-code against Opus (stand-in for truth) on the 20 HARDEST real essays (where text/code disagree most):
  - MAE text vs Opus = 0.41, closer to Opus on 15/20
  - MAE code vs Opus = 1.18, closer on only 2/20
  - Opus mean 4.12, Sonnet-text 3.85, Sonnet-code 2.95 → code runs a full point too harsh, even blew close calls (graded ~2 what Opus called ~5)
- Number mode leaks the rank digit and grades stingy+wobbly on cheap models. Code mode overcorrects into harsh. Text tracks the best judge.
- Sonnet over Haiku: Haiku wins raw accuracy on easy cases but misses the hard ones — calls AI-slop a 3 (should be 1) and over-scores the 4-vs-5 middle. Sonnet catches AI-slop and calibrates the middle.
- Caveat: Opus is a proxy for truth, not truth. Real human scores (blocker #1) are still the final word.

### open next steps
- optional: Haiku 5x sidecar purely for the confidence wobble (Sonnet alone is too stable to wobble)
- AI-detection is a soft spot (~74%); may need its own check for rubrics with an AI rule (Spartan)
- middle band (3-vs-4) is a genuine coin-flip → this is exactly what the confidence flag + human tiebreak is for

## the flow
- rubric.pdf → AI → a fixed questionnaire (human approves it once)
- each row = one rubric criterion
- each option = the rubric's own words (5 = "specific, unique..." down to 0 = blank)
- essay + questionnaire → judge AI
- for each row the judge must give: a pick + a reason + a citation (quote from essay)
- run the judge 5x on the same essay
- score = the majority pick
- confidence = how much the 5 runs agreed (no separate "confidence" field, it falls out of the votes)
- your code adds the picks → final score (math is ours, never the LLM's)

## why
- deterministic-ish grading of any essay against any rubric
- not truly deterministic — it's auditable + routed (low agreement → human looks)
- citation = trust. the quote says why the grade

## the test — pick a number vs pick a sentence
- worry: if the judge sees the numbers (5,4,3,2,1,0) it may drift high (niceness / ethical bias, doesn't want to grade someone low)
- idea: hide the numbers. make it pick the anchor SENTENCE instead ("specific, unique statement strongly related to their major")
- we map the chosen sentence → number ourselves, after the fact
- the judge never sees a number, so no pull toward being generous

## code ID idea — output an opaque code, not a number
- give each rubric option a code that carries ZERO ranking signal
- rule: no order leak. A/B/C/D bad (model smells A > E). 5/4/3 obviously bad. use scrambled meaningless ids
- model sees only the sentences + their shuffled codes, picks one code
- we map code → score in our own table, after the fact
- model never sees a number and can't infer rank, so no niceness pull

example (COE essay row):
- "specific, unique, strongly related..."      k7q  → 5
- "pretty good, some elements specific"        m2p  → 4
- "fine but pretty much what everyone has"     x9a  → 3
- "some thought, very general, poor grammar"   b4t  → 2
- "little effort or clearly AI"                r1z  → 1
- "blank"                                      w8c  → 0

## still open / missing pieces
- the math per rubric — Spartan is weighted %, other 3 aren't. need to turn picks → one comparable score (overall as %)
- missing data — some rubric rows ask for stuff not in the app (physics: research, rec letters). judge needs a "can't grade / not in essay" code, not a guess
- the 4 rubrics are 4 shapes — mixed scales, tiers, weights. generator must handle all, this is the hard part
- no human scores yet — the whole point is AI-vs-human agreement, that data isn't in the bucket. biggest blocker
- GPA row = no LLM — pure number bands, our code does it. never send to the judge
- AI-detection rule — Spartan scores 0 if obviously AI-written. real option in that rubric
- vote ties — 5 runs come back 2-2-1, what wins? need a tiebreak rule
- DON'T shuffle codes — each judge run is isolated context, never sees other runs. no cross-run bias to shuffle away. keep codes fixed
- sampling — once questionnaires (rubric + options) are genned, sample across 100 essays x however many test cases (A/B/C)

## A/B/C test
- A = judge picks the number directly
- B = judge picks the anchor sentence (blind to numbers), we convert
- C = judge picks a scrambled code (blind + shuffled, hardest to game) ← strongest bias kill
- run all on the same essays + rubric
- compare: does B/C grade lower / more honestly than A? more stable across the 5 runs?

## to test
- [ ] build the questionnaire generator (rubric.pdf → rows + options)
- [ ] run generator on all 4 rubrics, confirm each converts cleanly
- [ ] build the judge (pick + reason + citation per row)
- [ ] run judge 5x, compute majority score + agreement %
- [ ] A/B/C bias test — does hiding the number grade lower / more stable?
- [ ] sample across 100 essays x each test case (A/B/C)
- [ ] tiebreak rule for split votes (2-2-1)
- [ ] "can't grade / not in essay" handling for missing-data rows
- [ ] per-rubric math → one comparable % score
- [ ] GPA row done by code, not LLM
