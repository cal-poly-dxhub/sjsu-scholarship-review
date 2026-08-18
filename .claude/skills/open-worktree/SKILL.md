---
name: open-worktree
description: Open a git worktree in a new VS Code window so its changes show up in Source Control. Use right after a worktree is created (including an agent launched with isolation "worktree"), and whenever the user asks to open, see, view, or review a worktree, its files, or its diffs.
---

# Open a Worktree in VS Code

Worktrees under `.claude/worktrees/` are invisible in the main window: that path is in
`.gitignore`, so the main repo's Source Control panel skips it. Opening the worktree as
its own window (or its own workspace folder) makes VS Code treat it as a separate
repository, with diff gutters and file diffs.

## When to run

- **A worktree was just created** — after `git worktree add`, after `EnterWorktree`, or
  after launching an agent with `isolation: "worktree"`. Offer to open it; don't open it
  silently while an agent is still writing to it unless the user asked to watch the work.
- **The user wants to look at one** — "open the worktree", "show me what that agent
  changed", "let me see those diffs", "review the worktree".

## Process

1. **Find the worktrees.**

   ```bash
   git worktree list
   ```

   Skip the first line — that's the main checkout.

2. **Pick one.** If the user named a worktree or branch, match it. If exactly one
   candidate fits the conversation, use it. If several could fit, show their paths and
   ask which.

3. **Say what's in it** before opening, so the user knows whether it's worth a window:

   ```bash
   git -C <worktree-path> status --short
   git -C <worktree-path> log --oneline -5
   ```

   Report the counts plainly — "9 modified, 6 new files, 1 commit ahead". Note when a
   worktree is empty; that usually means the agent hasn't written anything yet.

4. **Open it in a new window.**

   ```bash
   code -n "<worktree-path>"
   ```

   `-n` forces a new window instead of reusing the current one. Use the absolute path.
   The command prints nothing on success.

5. **Tell the user where to look** — the Source Control panel in the new window shows the
   worktree's own changes; the branch name is in the status bar.

## Opening several at once

To compare worktrees side by side, add them to the current window as extra workspace
folders instead of opening one window each:

```bash
code --add "<path-a>" "<path-b>"
```

Each becomes its own repository in Source Control. To undo: right-click the folder in
Explorer → **Remove Folder from Workspace**. Prefer separate windows when a worktree has
its own dev server or Python environment.

## Instead of opening a window

When the user only wants to know what changed, don't open anything:

```bash
git -C <worktree-path> diff
git -C <worktree-path> diff <base-branch>...HEAD    # committed work only
```

## Remember

- Never `git worktree remove` or delete a worktree as part of this — opening is
  read-only. Removal is a separate, explicit ask.
- A worktree's `.git` is a file pointing back at the main repo. That's normal; VS Code
  handles it.
- If `code` isn't found, it's at
  `/c/Users/<user>/AppData/Local/Programs/Microsoft VS Code/bin/code` on Windows.
