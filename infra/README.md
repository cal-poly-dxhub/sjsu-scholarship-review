# infra — deferred on purpose

We build and prove everything locally all week, then deploy once at the end.
Nothing here yet, and that is the point: no CloudFormation to babysit while the
scoring method is still moving.

When we deploy, target the lighter path:

```
  web   -> AWS Amplify (static build of apps/web)
  api   -> Lambda + API Gateway (@trpc/server/adapters/aws-lambda)
  db    -> RDS Postgres (or keep the dev serverless-PG url)
  score -> Lambda batch job, run on demand
```

Reference: stealth-seller-backend/infra/cloudformation-template.yaml is the
template to copy and strip (drop auth, stripe, sqs, ECS/Fargate).
