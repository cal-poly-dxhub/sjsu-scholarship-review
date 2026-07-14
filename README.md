# SJSU Scholarship Application Review

Monorepo. AI does a first-pass rubric score of scholarship applications, a human
makes the final call. Runs in shadow mode next to human review, then we compare.

```
apps/
  web/      React + Vite dashboard
  api/      tRPC server
packages/
  shared/   types shared by web + api (empty until we lock them)
infra/      deployment (deferred, see infra/README.md)
materials/  s3 data mirror (gitignored)
```

## Run it

```
pnpm install
pnpm dev      # web on :3000, api on :3005
```

## Stack

React 18 · Vite 6 · Tailwind 4 · tRPC v11. No auth.

DB, Bedrock scoring, and the grading method are not built yet, by design.
