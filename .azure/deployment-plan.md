# Deployment preparation status

Status: **release automation and AI integration approved for implementation; cloud deployment on hold**.

## Current preparation request

Prepare modular GitHub Actions, unit/integration/smoke test gates, release tags,
deployment version records, an Azure-backed one-sentence summary demonstration,
and text/username content moderation. Inspect existing implementations before
finalizing the plan. This request does not yet authorize production deployment,
new model deployments, resource creation, role changes or database migrations.

- [x] Inspect existing test, release, summary and account/report entry points.
- [x] Inspect available deployments on the owner's existing AI resource read-only.
- [x] Confirm preparation scope, live demonstration limits and moderation policy.
- [ ] Implement and verify approved changes; document remaining release blockers.

## Proposed implementation scope

Mode: MODIFY. Stack: two independent Next.js/TypeScript applications, Supabase
data/auth and private image storage. Existing Playwright tests include pure
contracts, mocked server integrations, SQL policy checks and browser workflows.
No GitHub Actions workflows or deployment environments currently exist.

Recipe: GitHub Actions with Azure CLI for a manually approved release pipeline
to separately provisioned Container Apps. Custom release/version recording and
immutable container promotion are the reasons to use the AZCLI recipe rather
than introducing azd. Initial infrastructure creation is not part of this
preparation change; the workflow must explicitly reject missing configuration.

1. CI on pull requests and the default branch: lockfile install, lint, explicit
   unit/server/SQL tests, both production builds and production-mode smoke tests.
   External identity/model transports are mocked; CI must not spend model tokens.
2. Release preparation and manually dispatched deployment: semantic version
   tags, commit-addressed public/admin images, digest-pinned deployment,
   protected GitHub environment/OIDC authentication, and post-deployment smoke
   checks. Merely pushing code or a tag must not deploy to Azure.
3. Version records: build version/commit metadata, release notes, per-attempt
   deployment manifests and GitHub run/environment history. Failed/partial
   deployments must be recorded as failures, never reported as a successful
   release. No sensitive configuration in public artifacts.
4. Summaries: use the existing Azure GPT-5 mini deployment through a shared,
   bounded server-only Responses client. Keep one-sentence validation, manual
   triggering, caching and separate human approval. No always-running hosted
   agent and no new model deployment are necessary.
5. Local demonstration: show synthetic sample notes and a visibly labelled
   real Azure result/status, with an explicit click and bounded calls. Keep
   simulation distinct from live inference. Do not unlock private admin or
   introduce a production unauthenticated inference endpoint.
6. Content policy: a modular server-side gate for report text and username
   writes, inexpensive deterministic checks plus the existing small model for
   context. Block profanity, harassment, slurs, threats and abusive usernames,
   but permit non-abusive factual criticism. Validate AI responses strictly;
   provider failure blocks submission with a retryable service error, not a
   claim that the user's language was abusive. Preserve human publication review.
   Ensure direct database/profile writes cannot bypass the gate; prepare any
   required migration without applying it to live services.
7. Add focused policy/provider/version unit tests and browser/API smoke tests,
   including allowed criticism, rejected abuse, unavailable AI, malformed AI,
   prompt injection, identity boundaries and unchanged scoring/voting.
   Update README and handoffs, then make meaningful commits and push.

## Existing AI resource inspection

The owner's supplied AI Services resource has a successfully provisioned
`gpt-5-mini` deployment (GlobalStandard). Reuse it; this is a low-cost candidate
already compatible with the summary contract, not a claim that it is the
cheapest model on the market. Read-only management lookup does not prove
data-plane inference access. Prefer Entra authentication; keep credentials and
resource identifiers out of this public repository. Azure MCP is unavailable
in this session, so inspection used Azure CLI and official Microsoft docs.

GlobalStandard is not a guarantee of EU-only processing. Only synthetic notes
may be used for the local demonstration until production data-processing
disclosures and configuration have been reviewed.

## Approval and validation boundaries

The owner approved implementation and a real Azure demonstration, while
explicitly selecting preparation/testing only and keeping deployment on hold.
The proposed local demonstration uses at most ten short synthetic inference
requests against the existing model; it may incur small usage charges.
No resource/role creation, application deployment, database migration or
provider-account change is included. Confirm cloud subscription, region,
architecture, image registry access and budget separately before provisioning.
Live deployment readiness cannot be claimed until backend/admin identities,
OIDC/protected environment, application targets and private photo storage
decisions are configured. Invoke azure-validate before any eventual deployment.

## Approved application change

Separate the public community website and administration website into
independent Next.js applications/builds. The administration website may expose
a sign-in page over the internet, but dashboard pages and administrative APIs
must permit only two explicitly configured, confirmed accounts. No admin
registration or unauthenticated dashboard preview.

## Cloud approval boundary

No resource creation, deployment, database migration or identity-provider
configuration is approved by this change. Architecture handoff 13 remains a
recommendation, not authorization. Subscription identifiers and account
identifiers must not be committed.

## Pending deployment decisions

- Confirm hosting/data architecture, region, domains and incremental budget.
- Select the deployment recipe only when infrastructure work is requested.
- Specify separate public/admin hosting, credentials and identity settings.
- Configure the two approved account IDs through private server settings.
- Review Blob integration, email delivery, backups and launch safeguards.
- Validate the finalized deployment plan before any deployment.

## Local implementation

- [x] Inspect shared modules and current administration routes.
- [x] Separate administration routes/build and enforce the account allowlist.
- [x] Remove public administration entry points and preview bypasses.
- [x] Verify public isolation, administrator authorization and existing workflows.
- [x] Update handoffs and prepare the source changes for publication.

Local verification covers both builds and the real page/API gates with test
identity transport. Real backend credentials, both approved accounts, TLS,
domains and Azure resources remain unconfigured and require separate approval.
