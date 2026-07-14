# infra — deferred on purpose

We build and prove everything locally all week, then deploy once at the end.
Nothing here yet, and that is the point: no CloudFormation to babysit while the
scoring method is still moving.

Deploy target when we get there:

```
  web   -> AWS Amplify (static build of apps/web)
  api   -> Lambda + API Gateway (FastAPI via Mangum adapter)
  db    -> DynamoDB (applications + scores tables)
  score -> Lambda batch job, run on demand
```

Local dev talks to DynamoDB with the same env-driven table names the deployed
Lambdas will use (see `apps/api/.env.example`), so nothing changes shape at
deploy time.
