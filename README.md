# SJSU Scholarship Application Review

AI does a first-pass rubric score of scholarship applications, a human makes the
final call. Runs in shadow mode next to human review, then we compare.

## Project structure

```
apps/
  web/      React + Vite dashboard
infra/      CDK app: data, edge, and compute stacks
lambdas/    the API handlers and the scoring workers, on boto3
openspec/   what the system must do, and the changes in flight
```

## Quick start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in from the EdgeStack outputs
pnpm dev                                        # web on :5173, /api/ to the deployed API
```

The API is not run locally — the dev server hands `/api/` to a deployed environment.

## Stack

React 18 · Vite 6 · Tailwind 4 · Lambda on boto3 · DynamoDB · AWS Bedrock, behind
CloudFront and a Cognito login.
