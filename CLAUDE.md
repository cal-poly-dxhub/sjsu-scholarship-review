# SJSU Scholarship Application Review

Shared team notes for this repo. Write what the whole group should know here —
project decisions, conventions, setup steps, gotchas. Any Claude chat in this
repo reads this file automatically.

> Personal / machine-specific notes (your own AWS creds, private scratch) go in
> `CLAUDE.local.md`, which is git-ignored and never shared.

## Project
_TODO: one-paragraph summary the whole team agrees on._

## Setup
_TODO: how a teammate gets running (deps, data access, env)._

### Excalidraw MCP
The repo `.mcp.json` wires up the Excalidraw+ MCP server (our diagrams live
there). It reads the key from an env var, so set it once:

1. Get an Excalidraw+ API key (ask William, or create one in your Excalidraw+
   workspace settings).
2. Put it in `.claude/settings.local.json` (git-ignored):
   ```json
   { "env": { "EXCALIDRAW_API_KEY": "<your key>" } }
   ```
3. Restart Claude Code in this repo and approve the server when prompted.

## Conventions
_TODO: languages, frameworks, structure, naming, anything the group standardizes on._

## Decisions
- Backend runs on AWS Lambda with DynamoDB for storage (2026-07-14). The
  FastAPI app in `apps/api` is the local dev shape; it deploys to Lambda.
