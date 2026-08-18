# CLAUDE.md

## AWS access

Anything that touches AWS runs against the `dxhub-automation` profile. Log in with
`aws sso login --profile dxhub-automation` before any AWS or CDK command, and pass
`--profile dxhub-automation` (or set `AWS_PROFILE=dxhub-automation`) so nothing runs
in the wrong account. If a command fails with expired or missing credentials, log in
again rather than switching profiles.

## How to talk to me

Use plain words. Pick the common word over the fancy one ("use" not "leverage",
"start" not "initiate", "so" not "thereby"). Skip jargon, buzzwords, and filler —
if a term has a simple everyday equivalent, use that. Say what happened and what
it means for the work, in short sentences someone can read once and follow. Same
rule for comments, docs, logs, and CLI text.

Report outcomes straight. If a test fails, show it. If you skipped a step, say so.
Don't hedge on work that's done and verified.

## Specs before code

Any change worth planning goes through **OpenSpec**. Agree the plan before writing
code — don't start a multi-file change from a chat message alone. Small, obvious
fixes (a typo, a one-line bug) don't need a proposal.

**The workflow.** Four slash commands, in order:

1. **`/opsx:explore`** — optional. A thinking partner: read the code, weigh options,
   settle open questions. Writes no artifacts and no code. Use it when the shape of
   the change isn't obvious yet.
2. **`/opsx:propose "<what you want>"`** — creates
   `openspec/changes/<change-name>/` with four artifacts:
   - `proposal.md` — what and why
   - `specs/<capability>/spec.md` — what the system must do, as a **delta** against
     the main spec, written as `SHALL` statements and WHEN/THEN scenarios
   - `design.md` — how
   - `tasks.md` — the numbered implementation checklist

   This is **planning only**. It stops after the artifacts, even if the request said
   "build it". Read them and push back before moving on.
3. **`/opsx:apply <change-name>`** — works through `tasks.md`, ticking items off as
   it goes. Start it in a fresh context with a high-reasoning model; a full plan plus
   a full implementation in one window goes badly.
4. **`/opsx:archive <change-name>`** — after the work lands: folds the delta into
   `openspec/specs/` (the living description of the system) and moves the change to
   `openspec/changes/archive/YYYY-MM-DD-<name>/`.

Two more: **`/opsx:update`** revises a change's artifacts when a decision shifts
mid-flight (keeps proposal, design, spec, and tasks consistent; never touches code),
and **`/opsx:sync`** pushes a delta into the main specs without archiving.

**Habits that matter.** `openspec/specs/` is the source of truth for how the system
behaves — read it before proposing, and never let code drift from it silently. If
implementation reveals the plan was wrong, stop and `/opsx:update` the change rather
than quietly building something else. One change folder per coherent unit of work.
Project-wide conventions belong in `openspec/config.yaml` under `context:`, not
repeated in every proposal.

## When to use subagents

Delegate to keep this context clean — a subagent's final answer comes back, not its
file dumps. Launch independent ones in parallel. Only use custom subagents, unless
the user says otherwise.

- **`codebase-locator`** / **`Explore`** — "where is X?" file and symbol searches.
  Use whenever you'd otherwise grep more than once.
- **`codebase-analyzer`** — how one specific piece works. Deep-dive on a component.
- **`codebase-pattern-finder`** — find existing code to model after.
- **`thoughts-locator`** / **`thoughts-analyzer`** — dig through `.claude/thoughts/`
  plans and research.
- **`web-search-researcher`** — external or current information.
- **`aws-docs-researcher`** — any AWS question. Prefer it over web search there.
- **`aws-diagram-developer`** — turn an architecture markdown into a PNG diagram.
- **`claude-code-guide`** — questions about Claude Code, the Agent SDK, or the
  Claude API.

## Testing

Write few tests, and make them count.

- **Tests come last, not first.** In a spec's `tasks.md`, testing tasks go at the
  end — build the behavior, then cover it. Don't write tests up front and don't
  scatter a test task after every implementation step.
- **Unit tests are the default.** Test one unit of behavior directly. Reach for an
  integration test only when the thing being checked is the whole path — real input
  in one end, real output the other — and a unit test can't show it.
- **Only for complex behavior.** If the logic is a getter, a one-line mapping, a
  constant, or a wrapper that forwards its arguments, don't test it. Branching,
  parsing, scoring, edge cases, failure paths — that's what earns a test.
- **This holds for integration tests too.** Calling it an integration test doesn't
  make a basic check worth keeping. Don't write a test that only proves a file
  loads, a class constructs, a field round-trips, or a call returns without
  throwing. If the assertion would still pass with the interesting logic ripped
  out, it's a basic test — skip it, whatever the label.
- **Don't test basic wiring.**
- **Tests have to run fast.** The whole suite should finish in seconds. No test
  that calls a real model, hits the network, deploys to AWS, or waits on a sleep or
  a retry backoff. Feed the unit a small fixture instead of a full export,
  and stub the slow boundary. If a test needs minutes to prove its point, it's the
  wrong test — either shrink the input or check the logic directly. The one
  exception is a final end-to-end check as the last task in a change's `tasks.md`:
  that one may be slow and hit real boundaries. Keep it to a single test, and keep
  it out of the fast suite.
- **Mission-critical code gets close cover** — scoring, criteria matching, and any
  verdict a reviewer's judgment or a compliance claim rests on.
- A test that would pass with the logic deleted isn't worth writing.

## Coding standards

- **Plain words over jargon** — in comments, docs, log lines, CLI text, commit
  messages, and how you talk to the user.
- **Comments are short and precise** — and they explain the **why**, not the *what*.
  The code already says what it does; a comment that restates it is noise. Say the
  reason, the constraint, or the trap: `// sparse ground truth is unencoded, not a
  "no"`. One line beats a paragraph. Match the density of the surrounding file.
- **Describing a function is a docstring's job, not a comment's** — if you're
  explaining what a function takes, returns, or is for, write a docstring on it
  (Python `"""…"""`, TypeScript `/** … */`). Keep inline comments for the surprising
  bits inside the body. Use the test: if a comment sitting above a function couldn't
  be that function's docstring, it's a bad comment — it's describing a task, not the
  code. Delete it or turn it into the docstring.
- **Don't leak the prompt into the code** — comments describe the code as it stands,
  for whoever reads it next. They are not a record of what I asked for, what you
  planned, what step of the task this was, or what changed. No `// as requested`,
  `// new implementation`, `// per the spec, we now need to…`, `// TODO from
  review`, `// Step 3:`. Someone reading the file cold has no conversation to refer
  back to — write for them. Intent that matters lives in the spec and the commit
  message, not in a comment.
- **Don't over-engineer** — no abstraction layers, config flags, or "future
  proofing" for cases we don't have. Solve the task in front of you.
- **Type everything** — annotate function arguments and return values in Python, and
  keep TypeScript strict. Use the built-in generics (`list[str]`, `dict[str, int]`,
  `X | None`), not the old `typing` aliases. No bare `Any` or `as any` to get past a
  type error — fix the type.
- **No new libraries without asking** — don't add a dependency, or import one that
  isn't already in `pyproject.toml` / `package.json`, until I've said yes. Use the
  standard library and what's already installed. If you think a new library is the
  right call, stop and make the case: what it's for, and why the existing tools
  won't do.
- **Human-readable output** — logs, CLI messages, and error text should read plainly
  at a glance: what happened, where, what to do next. Artifacts stay legible
  JSON/CSV.
- **Never imply a check that didn't happen** — if something isn't checkable, say
  *not checkable*. Don't guess a rating or invent a comparison.
