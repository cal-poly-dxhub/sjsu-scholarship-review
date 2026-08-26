# Connecting PeopleSoft to the AWS build

What PeopleSoft can hand over, how it would reach this pipeline, and the two things that
have to be settled first. Checked against the Campus Solutions 9.2 docs (Update Image 38)
and against the code in this repo.

## The seam we already have

`lambdas/workers/ingest.py` runs off an EventBridge rule on S3 `Object Created`
(`infra/lib/compute-stack.ts:140`). Anything that lands an acceptable file in `uploads/`
runs the whole pipeline with no code change. The contract:

- **Prefix** `uploads/` (`infra/lib/data-stack.ts:10`); the bucket has `eventBridgeEnabled: true`
- **Suffix** `.xlsx` or `.csv` — anything else is skipped, not failed
- **The filename carries the academic year** — a name that does not match raises `IngestError`
- **Header names are exact** — `Student`, `AvailabilityId_t`, the four `PS_*` columns, and the
  three `FASO_General_*` essay columns
- Re-ingest is safe: `update_item` plus a `content_hash`, so a repeated pull is idempotent and
  only changed content resets scoring

Today the only writer is the dashboard's presigned PUT (`infra/lib/compute-stack.ts:242`).
Nothing stops a second writer.

One more fact that decides half the options below: **there is no VPC in the CDK app.** Every
Lambda is non-VPC.

## What PeopleSoft actually exposes

| Protocol | Service | Covers |
| --- | --- | --- |
| REST/JSON, OAuth 2.0 | Edu-API (1EdTech v1p0); CS is a certified producer | person, student, enrollment, program, academic session — read-only `get*` endpoints |
| SOAP/XML | AAWS, service `SAD_ADMISSIONS`: `SAD_GETAPPLS`, `SAD_GETAPPL`, `SAD_GETATTACH` | admission applications and their attachments; payload is the `SCC_ENTITY_APPLICATION` schema |
| HTTPS out | Integration Broker HTTP target connector | whatever PS is configured to push |
| SFTP | scheduled PS Query / App Engine to a file | anything a query can select |
| SQL | direct read of a CS replica | anything in the database |

There is no delivered REST or SOAP service for Financial Aid need or awards, and no
scholarship application service. An awarded scholarship goes back into FA as an
**external award** posted against a Financial Aid item type.

## Options, matched to this build

| # | PeopleSoft side | AWS side | Direction | Pipeline change |
| --- | --- | --- | --- | --- |
| A | scheduled query → CSV, pushed by SFTP | AWS Transfer Family on the existing bucket, into `uploads/` | campus → AWS | **none** |
| B | Edu-API REST + AAWS SOAP | new `peoplesoft-sync` Lambda, HTTPS out, writes a CSV to `uploads/` | AWS → campus | new Lambda only |
| C | Integration Broker HTTP target connector | dedicated HTTP API route, mTLS or API key | campus → AWS | new route and auth path |
| D | direct SQL | Lambda in a VPC over VPN or Direct Connect | private | VPC, NAT, VPN, Oracle driver |

**A first.** Zero pipeline change, auth is an SSH key, and the direction is outbound from
campus — the easiest thing for campus IT to approve. The wart is cost: Transfer Family bills
per enabled endpoint-hour (about $215/month) whether anyone connects or not. If that is too
much for a nightly file, the same shape works by driving the dashboard's presigned PUT from a
script on the campus side.

**B is the right long-term shape.** Two protocols, not one: REST for Edu-API, SOAP for AAWS.
Both are HTTPS out of a plain Lambda — no VPC, no inbound hole, credentials in Secrets
Manager. Have the sync Lambda write a CSV to `uploads/` rather than writing DynamoDB items
directly: ingest stays the single row reader, the `content_hash` idempotency still applies,
and a provenance file stays in the bucket.

**C** only if campus refuses an inbound call from AWS. The API sits behind a Cognito JWT
authorizer and Integration Broker cannot do the hosted-UI code flow, so it needs mutual TLS
(which needs a custom domain, out of scope in phase 1) or a shared API key.

**D** rejected: a VPC, NAT, a VPN, an Oracle driver in a layer, and DBA sign-off, against a
design that runs zero VPC Lambdas — and it bypasses every access control PeopleSoft has.

**Network question to ask IT early**, because the answer picks the option: allowlist our
egress IP (needs a VPC, NAT and an Elastic IP for a stable address), come over a VPN, or push
to us.

## Two blockers no protocol solves

**PeopleSoft does not have the essays.** The eligibility columns in the export are already
PeopleSoft data pulled through Scholarship Manager — `PS_Academic Program`, `PS_Major(s)`,
`PS_Academic Level`, `PS_Cumulative GPA`. The scored content is `FASO_General_*`, which is
Scholarship Manager's own form. Scholarships are not admission applications, so AAWS does not
have them either. A PeopleSoft connection replaces the `PS_*` columns, not the export.

**There is no join key.** `Student` is a UUID and the export is anonymized on purpose; there
is no `emplid` anywhere in the repo. PeopleSoft speaks EMPLID. Without a UUID→EMPLID
crosswalk, nothing pulled from PeopleSoft can be attached to the essays it belongs with.

## Next steps

1. Settle the join key — can Scholarship Manager expose a UUID→EMPLID crosswalk, or does the
   export stop being anonymized?
2. Ask IT which network path they will allow.
3. Read `SCC_ENTITY_APPLICATION` on the instance (PeopleTools > Integration Broker >
   Integration Setup > Messages > Schema) if the admissions application data turns out to
   matter — it is the only place the real field list lives.
4. Then open an OpenSpec change for the sync path.
