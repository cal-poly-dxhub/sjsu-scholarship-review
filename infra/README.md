# infra — the CDK app

Every deployed piece of the system is defined here, in TypeScript. One environment
so far: `dev`.

## Layout

```
bin/app.ts          entry point — reads the environment name, makes the three stacks
lib/env.ts          the environment name and the props every stack takes
lib/data-stack.ts   DynamoDB table + environment bucket — outlives the others, RETAIN
lib/edge-stack.ts   user pool, hosted UI, site bucket, CloudFront, the HTTP API
lib/compute-stack.ts route handlers, the ingest workers, the scoring workers
```

Stacks are split by how long the thing inside them lives, not by phase. The data
stores survive every redeploy; the front door and the compute are replaceable. A bad
`cdk destroy` must not be able to take applicant data with it.

Sign-in is in `EdgeStack` rather than a stack of its own because the app client's
callback URL is the CloudFront domain and the JWT authorizer needs the client. In one
stack CloudFormation orders that itself; split in two it becomes a two-pass deploy. The
pool still carries `RETAIN`, so destroying the stack does not take the accounts.

## Running it

The account and region come from the profile you run with — nothing here pins either.

```bash
aws sso login --profile <your-profile>
export AWS_PROFILE=<your-profile>

pnpm --filter @sjsu/infra exec cdk list
pnpm --filter @sjsu/infra exec cdk synth
pnpm --filter @sjsu/infra exec cdk deploy dev-DataStack
```

The environment name comes from CDK context. `cdk.json` defaults it to `dev`; pass
`-c env=<name>` for anything else. It is part of every stack name and every resource
name that has to be unique, so two environments can share an account.

`cdk bootstrap` is a one-time step per account and region. A fresh account needs it
before the first deploy.

## Deploy order

`EdgeStack`, then `DataStack`, then `ComputeStack`. Edge first because the environment
bucket answers the upload preflight for the site's own origin, which is the CloudFront
domain, and `DataStack` takes that domain as a string. `ComputeStack` needs both.
`cdk deploy --all` works this out itself.

`http://localhost:3000` is a callback alongside the CloudFront domain, so the Vite dev
server signs in against the same pool.

Step-by-step instructions, including building and uploading the website, are in the
"Deployment" section of the root `README.md`.

## Who can sign in

An admin creates the account, and that is the whole of authorization: there is no public
sign-up, no groups, no scopes beyond `openid`, `email`, and `profile`, and no role claim
anyone reads. The JWT authorizer checks a token came from this pool and this app client;
nothing behind it asks who the caller is.

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId from the EdgeStack output> \
  --username someone@sjsu.edu \
  --user-attributes Name=email,Value=someone@sjsu.edu Name=email_verified,Value=true
```

They get a temporary password by email and have to set their own on first sign-in. The
policy is 12 characters with upper case, lower case, and a digit.

## The stores

CDK creates the stores from nothing — there is nothing to import and no data to
migrate. The first deploy comes up empty, and a workbook has to be ingested before any
screen has something to show.

One table, keyed `pk` and `sk`, with `COHORT#`, `APP#`, and `RUBRIC#` prefixes standing
in for what separate tables would have done. Those two key attributes are the one thing
that cannot be changed after the table exists.
