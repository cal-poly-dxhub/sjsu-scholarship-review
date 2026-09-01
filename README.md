# SJSU Scholarship Application Review

AI does a first-pass rubric score of applications, a human makes the final call. Runs in
shadow mode next to human review, then we compare.

# Deployment

The [AWS Cloud Development Kit](https://docs.aws.amazon.com/cdk/v2/guide/home.html) (CDK)
is an open-source framework for defining cloud infrastructure in code and provisioning it
through AWS CloudFormation. You define resources as constructs, compose them into stacks,
and `cdk deploy` synthesizes CloudFormation templates that create or update the resources.

This app is in `infra/`, in TypeScript, and defines three stacks. The website uploads
separately; no stack copies the built files in.

Nothing in this repo names an account or a region — CDK takes both from the profile you
run with. Fill in every `<angle bracket>` from your account or from the stack outputs.

Commands run from `infra/`. `corepack` runs the pnpm version the repo pins, and
`pnpm exec` runs the CDK in `infra/node_modules` rather than a global one. From the repo
root, add `--filter @sjsu/infra`.

## What gets created

| Stack | Contents | Survives `cdk destroy` |
| --- | --- | --- |
| `dev-EdgeStack` | User pool, hosted sign-in page, site bucket, CloudFront, HTTP API | User pool only |
| `dev-DataStack` | DynamoDB table, environment bucket | Both — they carry RETAIN |
| `dev-ComputeStack` | 13 route handlers, 5 workers, EventBridge rules | Nothing |

Stacks are split by resource lifetime, so a `destroy` cannot remove applicant data.

`dev-` is the environment name, from CDK context. `cdk.json` sets it to `dev`; `-c env=`
on the command line overrides it:

```bash
corepack pnpm exec cdk deploy --all -c env=staging
```

That deploys `staging-EdgeStack`, `staging-DataStack`, and `staging-ComputeStack`. The
same flag goes on every other CDK command — `cdk list -c env=staging`,
`cdk diff -c env=staging`, `cdk destroy staging-ComputeStack -c env=staging` — and the
stack name you type has to match the name the flag produces.

The environment name prefixes every stack name and every resource name that has to be
unique, so two environments fit in one account. Missing context is an error, not a
default.

Order: Edge, Data, Compute. The environment bucket answers an upload preflight for the
CloudFront origin, and DataStack takes that domain as a string. Compute needs both.
`cdk deploy --all` resolves the order itself.

## Requirements

- [Node 20 or newer](https://nodejs.org/en/download) — `.nvmrc` pins 20, and it builds on 24
- [Python 3.13](https://www.python.org/downloads/), on PATH as `python`
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [uv](https://docs.astral.sh/uv/getting-started/installation/), to run the Lambda tests
- An AWS account in a US region, with Bedrock access to Claude Sonnet enabled

Two things the installers leave to you:

- **`corepack enable`**, from a shell with admin rights — it puts the pnpm shims next to
  `node`, and the repo drives pnpm through it.
- **`python` on PATH**, not just `python3` — tick "Add python.exe to PATH" in the Windows
  installer. The layer build shells out to `python` and falls back to Docker without it.

Check each one before going on:

```bash
node --version            # v20 or newer
python --version          # 3.13.x
aws --version             # aws-cli/2.x
uv --version
corepack pnpm --version
```

Then the project's own dependencies, from the repo root:

```bash
corepack pnpm install          # web and CDK packages
uv sync --extra dev            # Python: pytest, moto, openpyxl for the Lambda tests
```

`uv` installs Python packages on your machine; it is not part of a deploy. Nothing bundles
the Lambda dependencies from it either: the Python 3.13 runtime already ships boto3, and
the two layers built from `lambdas/requirements/` supply openpyxl and a newer boto3 that
knows batch Converse.

Sign in each session:

```bash
aws sso login --profile <your-profile>
export AWS_PROFILE=<your-profile>
```

## First deploy

**1. Confirm the target.** CDK uses the resolved region, and a wrong one deploys a second
copy of the system. `AWS_REGION` beats `AWS_DEFAULT_REGION`.

```bash
aws sts get-caller-identity
aws configure get region
```

**2. Bootstrap.** Once per account and region. Creates the `CDKToolkit` stack — staging
bucket, ECR repo, deploy roles.

```bash
cd infra
corepack pnpm exec cdk bootstrap
```

**3. Deploy.**

```bash
corepack pnpm exec cdk deploy --all --outputs-file cdk-outputs.json
```

**4. Keep the outputs.** `infra/cdk-outputs.json` is git-ignored — the values belong to one
account.

```json
{
  "dev-EdgeStack": {
    "SiteUrl": "https://<distribution>.cloudfront.net",
    "SiteBucketName": "dev-sjsu-scholarship-site-<account-id>",
    "DistributionId": "<distribution-id>",
    "UserPoolId": "<region>_<pool>",
    "UserPoolClientId": "<client-id>",
    "SignInDomain": "dev-sjsu-scholarship-<account-id>.auth.<region>.amazoncognito.com"
  }
}
```

Read them back without deploying:

```bash
aws cloudformation describe-stacks --stack-name dev-EdgeStack \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
```

**5. Upload the website.** The stacks create an empty bucket; see the next section.

## Uploading the website

Every value in these steps comes from the EdgeStack outputs. Read them from any of:

- `infra/cdk-outputs.json`, if the deploy used `--outputs-file`
- `aws cloudformation describe-stacks --stack-name dev-EdgeStack --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table`
- The console: **CloudFormation → Stacks → dev-EdgeStack → Outputs**

| Output | Goes into | Also in the console at |
| --- | --- | --- |
| `UserPoolId` | `VITE_USER_POOL_ID`, and `admin-create-user --user-pool-id` | Cognito → User pools → the pool → **User pool ID** |
| `UserPoolClientId` | `VITE_USER_POOL_CLIENT_ID` | Cognito → the pool → App clients → **Client ID** |
| `SignInDomain` | `VITE_SIGN_IN_DOMAIN` | Cognito → the pool → Branding → Domain |
| `SiteUrl` | `DEV_API_ORIGIN`, and the URL you open | CloudFront → the distribution → **Distribution domain name** |
| `SiteBucketName` | `aws s3 sync … s3://<SiteBucketName>` | S3 → Buckets |
| `DistributionId` | `create-invalidation --distribution-id` | CloudFront → Distributions → **ID** |

**1. Point the build at the environment.** Copy `apps/web/.env.example` to
`apps/web/.env.local` and fill in:

```
VITE_USER_POOL_ID=<UserPoolId>
VITE_USER_POOL_CLIENT_ID=<UserPoolClientId>
VITE_SIGN_IN_DOMAIN=<SignInDomain>
```

All three are required; the build fails without them. The build reads no API URL — the API
is same-origin under `/api/`. `DEV_API_ORIGIN` in the same file applies only to `vite dev`;
set it to the `SiteUrl` of the environment the dev server should call.

**2. Build.**

```bash
corepack pnpm --filter @sjsu/web build
```

**3. Upload and invalidate.** CloudFront serves the cached `index.html` until the
invalidation completes.

```bash
aws s3 sync apps/web/dist s3://<SiteBucketName> --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths '/*'
```

`--delete` is required: asset filenames are content-hashed, so without it the bucket keeps
every past build.

A CloudFront function rewrites any path without a file extension to `/index.html`. The
app is a single page, so paths like `/rubrics` have no object in the bucket.

## Adding a reviewer

No public sign-up. An admin creates each account, with either this command:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username someone@sjsu.edu \
  --user-attributes Name=email,Value=someone@sjsu.edu Name=email_verified,Value=true
```

or the AWS Management Console: **Cognito → User pools → the pool → Users → Create user**.
Send an email invitation, and set the email address as both the user name and the email.

They get a temporary password by email and set their own on first sign-in. The policy is
12 characters with an upper case letter, a lower case letter, and a digit.

## Deploying a change

```bash
cd infra
corepack pnpm exec cdk diff
```

Deploy only the stack you touched.

| Changed | Deploy |
| --- | --- |
| Lambda code or a worker | `cdk deploy dev-ComputeStack` |
| Website only | No CDK — build, sync, invalidate |
| API, sign-in, or CloudFront | `cdk deploy dev-EdgeStack`, then rebuild and re-upload the site if the pool or its callbacks changed |
| Table or bucket | `cdk deploy dev-DataStack` — read the diff first |

The table's `pk` and `sk` keys and the two index key schemas cannot be changed after the
table exists. CloudFormation replaces the table to do it and keeps the old one, leaving an
empty table with the data stranded beside it.

Before any deploy:

```bash
corepack pnpm -r typecheck
corepack pnpm -w run test
```

37 tests, about one second.

## Teardown

```bash
cd infra
corepack pnpm exec cdk destroy dev-ComputeStack dev-EdgeStack
```

The site bucket is emptied and deleted. The user pool is retained, since deleting it would
remove every reviewer account.

The table and the environment bucket carry RETAIN, so `cdk destroy dev-DataStack` drops the
stack and leaves them in the account. To remove the applicant data, delete them by name
afterwards.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Expired or missing credentials | SSO token timed out | `aws sso login --profile <your-profile>` |
| "No environment name" | CDK ran without context | Run from `infra/`, or pass `-c env=dev` |
| The layer build asks for Docker | `python -m pip` was not usable | Put Python on PATH, or start Docker |
| Access denied on a Bedrock call | Model not enabled in this account | Enable Claude Sonnet in the Bedrock console, US region |
| A Bedrock call from the shell hits the wrong account | `AWS_BEARER_TOKEN_BEDROCK` is set and beats the profile | Unset it for that command. CLI only — deployed workers use their execution roles |
| Sign-in redirects to an error | The URL is not one of the app client's callbacks | Use the CloudFront domain or `http://localhost:3000` |
| The site serves an old build | Invalidation skipped or still running | `aws cloudfront get-invalidation --distribution-id <id> --id <invalidation-id>` |
| A screen loads, its data does not | The route handler failed | Read that function's log group in CloudWatch — one per function, named for it |

## Limitations

No CI and no pipeline: every deploy is run by hand. One environment, `dev`. This has not
been through a production readiness review, and the API's authorizer does not distinguish
one signed-in reviewer from another.

# Local development

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in from the EdgeStack outputs
pnpm dev                                        # web on :3000, /api/ to the deployed API
```

The API does not run locally. The dev server forwards `/api/` to a deployed environment,
and sign-in goes to that environment's user pool.

# Repository layout

```
apps/
  web/      React + Vite dashboard
infra/      CDK app: data, edge, and compute stacks
lambdas/    API handlers and scoring workers, on boto3
openspec/   specifications and in-flight changes
```

React 18 · Vite 6 · Tailwind 4 · Lambda on boto3 · DynamoDB · AWS Bedrock, behind
CloudFront and a Cognito login.

## Unused UI code

61 files under `apps/web/src` are not reachable from `src/main.tsx`:

- 38 shadcn/ui components in `src/sjsu/components/ui/`
- 18 icons in `src/sjsu/components/icons/`
- 2 illustrations in `src/components/illustrations/`
- `sjsu/components/ascii-dots.tsx`, `sjsu/hooks/use-sliding-tab-indicator.ts`,
  `sjsu/lib/date-format.ts`

They were left in place as a component library for later screens. Vite does not bundle
them, so they cost nothing in the output; `tsc --noEmit` does typecheck them.

Delete them if the kit is not wanted. Standard shadcn components can be re-added with
`npx shadcn@latest add <name>`, but `live-waveform`, `voice-button`, `hover-hint`,
`tabs-with-slider`, `direction`, `menu-styles`, and the icons were written for this project
and would exist only in git history.

`src/vite-env.d.ts` is also unimported, and has to stay: it declares the `VITE_*` types,
and tsconfig picks it up through `include`.

---

# Collaboration

Thanks for your interest in our solution. Having specific examples of replication and cloning allows us to continue to grow and scale our work. If you clone or download this repository, kindly shoot us a quick email to let us know you are interested in this work!

[wwps-cic@amazon.com]

---

# Disclaimers 

Customers are responsible for making their own independent assessment of the information in this document. 

This document: 

(a) is for informational purposes only, 

(b) references AWS product offerings and practices, which are subject to change without notice, 

(c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided "as is" without warranties, representations, or conditions of any kind, whether express or implied. The responsibilities and liabilities of AWS to its customers are controlled by AWS agreements, and this document is not part of, nor does it modify, any agreement between AWS and its customers, and 

(d) is not to be considered a recommendation or viewpoint of AWS. 

Additionally, you are solely responsible for testing, security and optimizing all code and assets on GitHub repo, and all such code and assets should be considered: 

(a) as-is and without warranties or representations of any kind, 

(b) not suitable for production environments, or on production or other critical data, and 

(c) to include shortcuts in order to support rapid prototyping such as, but not limited to, relaxed authentication and authorization and a lack of strict adherence to security best practices. 

All work produced is open source. More information can be found in the GitHub repo.
