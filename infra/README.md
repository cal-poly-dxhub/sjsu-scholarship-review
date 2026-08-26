# infra — the CDK app

Every deployed piece of the system is defined here, in TypeScript. One environment
so far: `dev`.

## Layout

```
bin/app.ts          entry point — reads the environment name, makes the three stacks
lib/env.ts          the environment name and the props every stack takes
lib/data-stack.ts   DynamoDB table + environment bucket — outlives the others, RETAIN
lib/edge-stack.ts   user pool, hosted UI, site bucket, CloudFront, the HTTP API
lib/compute-stack.ts route handlers, ingest worker, the two scoring workers
```

Stacks are split by how long the thing inside them lives, not by phase. The data
stores survive every redeploy; the front door and the compute are replaceable. A bad
`cdk destroy` must not be able to take applicant data with it.

Sign-in is in `EdgeStack` rather than a stack of its own because the app client's
callback URL is the CloudFront domain and the JWT authorizer needs the client. In one
stack CloudFormation orders that itself; split in two it becomes a two-pass deploy. The
pool still carries `RETAIN`, so destroying the stack does not take the accounts.

## Running it

Everything runs against the `dxhub-automation` profile.

```bash
aws sso login --profile dxhub-automation
export AWS_PROFILE=dxhub-automation

pnpm --filter @sjsu/infra exec cdk list
pnpm --filter @sjsu/infra exec cdk synth
pnpm --filter @sjsu/infra exec cdk deploy dev-DataStack
```

The environment name comes from CDK context. `cdk.json` defaults it to `dev`; pass
`-c env=<name>` for anything else. It is part of every stack name and every resource
name that has to be unique, so two environments can share an account.

`cdk bootstrap` is a one-time step per account and region. `dxhub-automation` in
`us-west-2` is already bootstrapped at version 32.

## Deploy order

`DataStack`, then `EdgeStack`, then `ComputeStack`. Data first because everything else
references it.

`http://localhost:3000` is a callback alongside the CloudFront domain, so the Vite dev
server signs in against the same pool.

## Publishing the app

`EdgeStack` uploads `apps/web/dist` to the site bucket and invalidates CloudFront, so a
deploy ships the app the way it ships the Lambdas. It does not run the build. The bundle
carries the user pool ids, which come out of this same stack, so a new environment goes:

```bash
pnpm --filter @sjsu/infra exec cdk deploy dev-EdgeStack   # makes the pool, no site yet
# copy UserPoolId, UserPoolClientId, SignInDomain into apps/web/.env.local
pnpm --filter @sjsu/web build
pnpm --filter @sjsu/infra exec cdk deploy dev-EdgeStack   # publishes the build
```

After that a deploy publishes whatever the last build wrote. With no `dist` at all — a
fresh clone — the deploy warns and leaves the bucket alone rather than failing.

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

The `sjsu-*` tables and the export bucket that local dev used to point at were
destroyed in the account. CDK creates the stores from nothing — there is nothing to
import and no data to migrate. The first deploy comes up empty, and a workbook has to
be ingested before any screen has something to show.

The old three-table split went with them. One table now, keyed `pk` and `sk`, with
`COHORT#`, `APP#`, and `RUBRIC#` prefixes doing what the table names used to do.
Those two key attributes are the one thing that cannot be changed after the table
exists.
