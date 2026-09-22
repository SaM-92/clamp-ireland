# Deployment preparation status

Status: **Preparation verified; deployment blocked and on hold**.

Cloud deployment: **on hold by explicit owner choice**. Azure validation
assessed the prepared release path; missing production prerequisites prevent a
`Validated` deployment status. No deployment or provisioning is authorized.

## Current preparation request

Prepare modular GitHub Actions, unit/integration/smoke test gates, release tags,
deployment version records, an Azure-backed one-sentence summary demonstration,
and text/username content moderation. Inspect existing implementations before
finalizing the plan. This request does not yet authorize production deployment,
new model deployments, resource creation, role changes or database migrations.

- [x] Inspect existing test, release, summary and account/report entry points.
- [x] Inspect available deployments on the owner's existing AI resource read-only.
- [x] Confirm preparation scope, live demonstration limits and moderation policy.
- [x] Implement approved changes and verify local builds, unit/SQL/release
  contracts, synthetic live AI and both isolated Linux container runtimes.
- [x] Finish hosted CI smoke validation and record deployment readiness blockers.

## Implemented artifacts and local evidence

- `.github/workflows/ci.yml`: PR/master test and production smoke gates.
- `.github/workflows/release.yml`: manual tagged release; deployment requires
  opt-in, a protected production environment and Azure OIDC.
- `Dockerfile`: independent public/admin standalone targets.
- `scripts/release`: validated tags/metadata, digest-only promotion, bounded
  read-only smoke and durable sanitized attempt records.
- `src/modules/ai`, `ai-demo`, `content-policy`: server-only Azure provider,
  synthetic local demo and report/username admission checks.
- Migrations 0006 and 0007 prepared, not applied.
- Local verification: both final application builds pass; public/admin Linux
  image builds and network-isolated container smoke pass. Unit/server, SQL and
  release contracts pass. Integrated development coverage exposed a small-phone
  banner regression and a production-only test selector; both were corrected
  and focused regressions pass.
- Real Azure synthetic summary and moderation calls succeeded using the
  existing deployment and local CLI identity, within the ten-attempt approval.
- Source milestones have been committed/pushed regularly. Hosted CI succeeded;
  no manual release or deployment workflow has been dispatched.

## Known deployment blockers

Production targets are not provisioned/configured for this app. GitHub
release/production environments, reviewer protection, OIDC and build/runtime
settings still need owner-approved setup. Supabase, both real administrator
identities, migrations, private photo-storage choice, production inference
permissions, domains and privacy/launch approval remain unresolved. The
workflow rejects missing configuration rather than provisioning resources or
deploying an unconfigured success-shaped fallback.

## All validation checks pass

This overall deployment checkbox remains incomplete:

- [x] Azure CLI installation verified.
- [x] Authentication to the owner-approved subscription verified read-only.
- [ ] Bicep compilation: no infrastructure template was requested/generated;
  the pipeline promotes images to separately provisioned existing targets.
- [ ] ARM template validation and what-if: not applicable to these image-only
  artifacts; future provisioning requires a separate approved plan.
- [x] Both independent Linux Docker builds and isolated container smoke pass.
- [ ] Production target, Azure Policy and static role verification: blocked
  until the owner approves/provisions targets and runtime/OIDC identities.
- [x] GitHub CI executes the actual lint/unit/SQL/release and production gates.
- [ ] GitHub release/production environments, protected reviewers, deployment
  opt-in and required settings: absent, so deployment is deliberately denied.

## 7. Validation Proof

The table below records the original `v0.1.0` preparation baseline.

| Check | Actual command/evidence | Result |
| --- | --- | --- |
| CLI | `az version --output json` | Installed |
| Authentication | `az account show` scoped to the approved subscription, state-only projection | Enabled; no default subscription changed |
| App builds | `npm run build:all` | Public and private admin builds passed |
| Unit/server | `npm run test:unit` | 74 passed, mocked transport/no paid inference |
| SQL | `npm run test:sql` | 16 passed in PGlite; no live migrations |
| Release controls | `npm run test:release` | 15 passed |
| Linux packaging | `docker build --target public` and `--target admin`, synthetic build identity | Both built locally; no registry push |
| Container execution | `node scripts/release/container-smoke.mjs` | Both passed with external networking disabled; test containers removed |
| Hosted CI | GitHub Actions run `35754929186`, commit `287a0e3d3bce936fbd79129ae33bb77517019318` | Success, including 7 production browser smoke tests |
| Source version | Annotated tag `v0.1.0` at the above CI-verified commit | Pushed; source tag is not a deployment claim |
| Deployment prerequisites | GitHub environment/variable/secret names inspected read-only | No configured environments/required settings; deployment blocked |
| Role templates | No IaC role assignments generated | Production roles unverified; no role changes authorized |

### Readiness recheck: 2026-09-22

- Application commit `961ebb167b812fbd8f25d1933ec3e45c932e1eb5` passed
  hosted CI run `35759192462`: lint/unit/server/SQL and both production
  builds with synthetic browser smoke.
- `gh api repos/SaM-92/clamp-ireland/environments` returned no environments.
  Repository variable and secret **name-only** listings were also empty.
  Release/production setup, reviewer protection and deployment settings
  therefore remain blockers.
- `Test-Path infra\main.bicep` returned false. There is no approved
  provisioning template to compile, validate or run what-if against.
  Production targets, RBAC and real backend operations remain unverified.
- `git rev-list -1 v0.1.0` resolved to `287a0e3...`, not the latest application
  commit. Before releasing the newer fixes, commit a new package version and
  matching source tag; do not move the published baseline tag.
- Migration 0007 is now required for concise v2 summaries, in addition to
  the prior backend migrations. No live migration was performed.

Result: **code and release automation are verified; production deployment
readiness is still blocked**. This readiness question did not lift the
owner's hold or authorize provisioning, identity changes or deployment.

Local Azure inference was verified separately using only fixed synthetic
examples and the existing CLI identity. It does not establish managed-identity
access in production. Backend identities, image storage and real user flows
remain launch prerequisites. Do not invoke azure-deploy from this state.

## Proposed implementation scope

Mode: MODIFY. Stack: two independent Next.js/TypeScript applications, Supabase
data/auth and private image storage. Existing Playwright tests include pure
contracts, mocked server integrations, SQL policy checks and browser workflows.
Before this preparation, no GitHub Actions workflows or deployment
environments existed. Workflows are now implemented; environments remain absent.

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
