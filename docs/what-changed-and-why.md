# What changed, and why

What I kept from your build, what changed and why, and the two Bedrock features that decide
what a full run costs.

## The goal

1. Make the existing work deployable with CDK.
2. Add the missing endpoints, mostly as Lambdas.
3. Host the website on CloudFront.
4. Do not go beyond the features you scoped.

## What changed

The backend is now CDK. Three stacks in `infra/`, split by lifetime rather than by phase, so
the table and the environment bucket carry RETAIN and a bad `cdk destroy` cannot take
applicant data. The FastAPI app became 13 route handlers and 5 workers on boto3, in
`lambdas/`.

The site and the API share one origin: CloudFront serves the site and forwards `/api/*` to
the HTTP API, so there is no API URL in the build. The only build-time values are the three
Cognito ones.

## The endpoints that were added

| Route | What it answers |
| --- | --- |
| `POST /api/upload` | A filename in, a URL to PUT the file to out. The file goes straight from the browser to S3, so it never travels through a Lambda's 6 MB request body. |
| `GET /api/upload-report` | What the ingest made of one uploaded file. |
| `POST /api/rubric-parse` | What the parser makes of a rubric file. Nothing is written. |
| `POST /api/rubric-versions` | Publish a rubric file and its weights as the next version. |
| `GET /api/rubric-versions` | A scholarship's rubric versions, newest first. |
| `POST /api/run` | Start a run for one cohort and one rubric version. |
| `GET /api/cohorts` | Every cohort that has been ingested. The one read that names no cohort. |
| `GET /api/cohort` | One cohort's applications without their essays, plus what the cohort is doing. |
| `GET /api/ranked` | One page of a cohort's ranking, in the order the index holds it. |
| `GET /api/application` | One application, its newest score, and any reviewer's scores. |
| `POST /api/scores` | The newest score items for up to a hundred applications — the read behind an export that carries reasoning. |
| `GET /api/flagged` | The review queue: where the model and the reviewers disagree, widest gap first. |
| `GET /api/agreement` | How far apart the model and the reviewers are, per cohort and overall. |

Behind them, five workers: `ingest` (an export becomes applications), `reviewer_ingest` (a
reviewer-score file becomes reviewer items and a gap), `score_ondemand`, `score_batch`, and
`recompute` (move a cohort's totals onto a version that changed weights and nothing else).

## Cost

Two Bedrock features are worth using on this workload: batch inference for a full run, and
prompt caching for scoring one application at a time. Both are described in the AWS docs.

### Batch inference

From [Process multiple prompts with batch inference](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html):

> With batch inference, you can submit multiple prompts and generate responses
> asynchronously. […] Batch inference helps you process a large number of requests
> efficiently by sending a single request and generating the responses in an Amazon S3
> bucket. […] You can use batch inference to improve the performance of model inference on
> large datasets.

This build uses it. A run over a whole cohort goes as one job, and the results come back from
S3 hours later.

### Prompt caching

From [Prompt caching for faster model inference](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html):

> Prompt caching is an optional feature that you can use with supported models on Amazon
> Bedrock to reduce inference response latency and input token costs.

> Prompt caching can help when you have workloads with long and repeated contexts that are
> frequently reused for multiple queries.

That is this workload: every call carries the same rubric as its system prompt, and only the
applicant's text changes. The static part is kept byte-identical between calls, which is what
any cache needs, and Claude on Bedrock tries to reuse it with no code at all:

> Implicit Prompt Caching automatically attempts to reuse eligible prompt prefixes without
> requiring cache controls in your request.

> Implicit Prompt Caching is best effort. Repeating an identical prompt doesn't guarantee a
> cache hit, and cache-hit rates can vary.

No cache checkpoint is placed on top of that, because of the floor the docs set:

> Cache checkpoints have a minimum and maximum number of tokens, depending on the model. You
> can only create a cache checkpoint if your total prompt prefix meets the minimum number of
> tokens. […] If you add a cache checkpoint before meeting the minimum number of tokens, your
> inference still succeeds, but your prefix isn't cached.

The rubric plus the output contract comes to about 1,000 tokens, and Claude Sonnet 4.6 needs
1,024 — a hair short. A longer rubric file clears the minimum, and then an explicit checkpoint
is worth placing.

### What it saves

The two do not combine:

> Prompt caching is only supported for on-demand inference endpoints. It is not supported with
> the batch inference API.

So they cover the two different ways this system calls the model.

| | Saving | Cost |
| --- | --- | --- |
| Batch inference | ["at a 50% lower price compared to on-demand inference pricing"](https://aws.amazon.com/bedrock/pricing/) | The wait goes from seconds to hours |
| Prompt caching | Repeated input is billed at the model's cache-read rate instead of the standard input rate | Cache writes can cost more than standard input, and the prompt prefix has to clear the model's minimum |

For a full cohort — several thousand applications, scored overnight, nobody waiting on a
screen — batch is the one that matters, and it halves the token bill. Caching is for the
on-demand path, where a reviewer rescores applications one at a time against the same rubric.

## Future work

- **Human in the loop.** The hand-scoring screen exports a file, and the file says nothing was
  saved. There is no endpoint that stores a reviewer's score or an approval — reviewer scores
  get in by file upload only.
- **Reviewer and applicant accounts.** There is one kind of account today. The authorizer
  checks a token came from this pool and this app client, and every signed-in account reaches
  every endpoint and every cohort. The caller's identity is used in one place: the email claim
  is stamped on a published rubric version as `published_by`. Applicants have no account at
  all — they are rows in an export, and a reviewer's scores are matched to them by the name in
  an uploaded file. Separating the two needs user pool groups the authorizer or the handlers
  check, and a reviewer identity on the stored score so it belongs to an account rather than
  to a spelling of a name.
- **Campus sign-in.** Accounts are created one at a time with `admin-create-user`. SJSU signs
  people in with its own service, not an AWS one, so what it takes to point the app at it has
  not been worked out here. That and the university's security review are open.
- **PeopleSoft instead of the Excel upload.** Today the browser gets a presigned URL and PUTs
  the export to a bucket prefix, and the file landing starts the ingest. A PeopleSoft REST API
  call replaces the upload and the prefix; the ingest worker stays as it is.
- **Model testing.** Only the 26-27 file has reviewer scores that can be placed on
  applications, so that is the only cohort with a baseline. Agree on one measurement first —
  yours was per criterion, this build's is a total, so the two numbers are not comparable.
