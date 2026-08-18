---
name: commit
description: Create git commits for this session's work — short messages, PRs marked AI generated, user approves before anything is committed. Use when the user asks to commit, stage, or check in changes.
---

# Commit Changes

Create git commits for the changes made during this session.

## Process

1. **Think about what changed**
   - Review the conversation to understand what was accomplished.
   - Run `git status` and `git diff` to see the actual modifications.
   - Decide whether this is one commit or several logical ones.

2. **Plan the commit(s)**
   - Group files that belong together.
   - Write a **short** message: one imperative subject line, ~50 characters, no
     trailing period. `Add course record checks`, not
     `Added the new course record checks to the review engine`.
   - Only add a body when the subject can't carry it — a line or two on *why*, not a
     changelog of what. Most commits need no body at all.
   - No bullet lists, no section headers, no restating the diff.

3. **Present the plan**
   - List the files per commit and the exact message(s).
   - Ask: "I plan to create [N] commit(s) with these changes. Shall I proceed?"

4. **Execute once confirmed**
   - `git add` the specific files — never `-A` or `.`.
   - Commit with the planned messages.
   - Show `git log --oneline -n [number]`.

5. **Open a pull request when asked**
   - Only when the user asks to push or open a PR. Branch first if on `main`.
   - Find the OpenSpec change the work belongs to: `openspec/changes/<change-name>/`.
     Read its `proposal.md` and `specs/<capability>/spec.md`.
   - Write the PR body as a short spec summary — what the change makes the system do,
     from the `SHALL` statements, not a list of edited files:
     - One or two sentences of *why*, from `proposal.md`.
     - A handful of bullets, one per capability, saying what it must now do in plain
       words. Skip the WHEN/THEN detail — link the spec file instead.
     - A closing line pointing at `openspec/changes/<change-name>/` for the full spec.
   - Keep it under ~15 lines. If there's no OpenSpec change (a small fix), say what
     changed in a sentence or two and stop there.
   - Create it with `gh pr create`. Show the plan and the body before running it.

## Say what is AI written

- End every PR body with a last line reading `AI generated`. Nothing after it.
- In a PR body, put any text the human wrote in double quotes. If they give you the
  wording for a paragraph or a bullet, quote their words instead of rewriting them —
  the quotes are what tells a reader which half is theirs.
- Commit messages carry none of this: no footer, no `Co-Authored-By`, no tool line.
  Write them as if the user wrote them.

## Remember

- Keep commits focused and atomic.
- Push only when the user asks. If on the default branch, branch first.
