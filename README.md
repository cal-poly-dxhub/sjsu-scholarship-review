# SJSU Scholarship Application Review

AI does a first-pass rubric score of scholarship applications, a human makes the
final call. Runs in shadow mode next to human review, then we compare.

## Project structure

```
apps/
  api/      FastAPI backend (rubric generation, DynamoDB persistence)
  web/      React + Vite dashboard
docs/       architecture & design docs
infra/      deployment plan (deferred)
```

## Quick start

```bash
pnpm install
cd apps/api && cp .env.example .env   # fill in AWS creds
cd ../..
pnpm dev                              # web on :5173, api on :3005
```

## Stack

React 18 · Vite 6 · Tailwind 4 · FastAPI · DynamoDB · AWS Bedrock. No auth.
