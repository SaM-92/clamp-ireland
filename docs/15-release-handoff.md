# Release foundations: preparation only

No workflow was dispatched, image published, Azure application deployed, role
changed, secret written or migration applied as part of this preparation.
The existing public and two-account private-admin applications remain separate.
Production operation still requires the owner setup in handoffs 13 and 14.

## Gates and commands

Use Node 24 and the committed npm lockfile (`npm ci`). No additional test
dependencies are needed. The root package scripts should map as follows:

| Script | Command | Scope |
|---|---|---|
| `test:unit` | `node scripts/ci/run.mjs unit` | Pure contracts and mocked server routes; no server/browser fixture |
| `test:sql` | `node scripts/ci/run.mjs sql` | In-memory PGlite SQL policies; no live database/migrations |
| `test:smoke` | `node scripts/ci/run.mjs smoke` | Already-built production apps on isolated ports 3015/3016 |
| `test:release` | `node --test scripts/release/*.test.mjs` | Release/tag, environment, network, smoke and deployment failure contracts |

The original `test:e2e` development workflow is unchanged. It can still conflict
with the ordinary admin development server because of its shared `.next/dev`
directory; do not run it concurrently. The new unit/SQL commands never start
that fixture. Smoke requires both production builds, Chromium and unused
3015/3016 ports; it neither reuses nor stops existing servers. Do not run a
build against a directory another process is building or serving.

`playwright.unit.config.ts` selects `*-unit`, `*-contract`, `*-runtime`,
`*-server` and `*-access` tests, plus the pure SEO/traffic cases. SQL selects
`*-policy` and `*-database`, plus the traffic migration case. Mixed legacy
traffic/SEO files are explicitly filtered, so these commands need no browser.
Add new server/SQL tests under these naming conventions.

The wrapper uses an allowlisted environment, discards inherited credentials
and disables paid/analytics features. Tests prohibit non-loopback Node
connections/fetch; smoke browser contexts block external requests. Admin smoke
and container fixtures explicitly force `AI_PROVIDER=openai`, an empty
`OPENAI_API_KEY`, and `ENABLE_LOCAL_AI_DEMO=false`, and blank Azure provider,
identity and managed-identity endpoint settings before Next loads environment
files. Developer Entra/demo configuration must never carry into a fixture.
Production must return demo 404s regardless of the demo flag; disabling the
fixture flag is not a replacement for that production route guard. Admin smoke
uses the real authorization gates and the synthetic identity transport, including
both approved fixture accounts and denial of a third/unconfirmed account.
Production smoke requires `/dev/ai-demo` and `/api/dev/ai-demo` to return 404,
including an empty unauthenticated POST to the API in synthetic CI only.
CI never authenticates to a live backend or model. The wrapper refuses local
`.env` files before builds/smoke instead of accidentally importing real settings.
Supabase public variables are **absent**, not compiled as empty strings, in CI
builds so the synthetic server-side identity transport can be set at runtime.

`.github/workflows/ci.yml` runs for PRs, master pushes and reusable release
checks: lockfile install, lint, release contracts, unit/server, SQL, both
production builds, standalone-path/route-boundary checks, and browser smoke.
Reports, traces and screenshots contain synthetic data only and expire after
14 days. No deployed build directory or environment file is uploaded.
All third-party action references are full commit SHAs, resolved and verified
using `gh api`; update pins deliberately, not by replacing them with tags.

Configure branch protection/rulesets separately to require the CI
`Lint, unit, server and SQL` and `Production builds and synthetic browser smoke`
jobs (use the exact check names shown by the first actual run). Workflow files
do not themselves enable repository branch protection.

## Build identity and health

Both Next configs enable `output: "standalone"` and inject only two validated,
non-sensitive build constants: `APP_RELEASE_VERSION` from root `package.json`,
and `APP_RELEASE_SHA`. Release/CI builds set `RELEASE_BUILD=true`; a full
lowercase 40-character SHA is then required. Local builds without a supplied
SHA identify as `local`. An environment override cannot invent a different
package version. These constants are intentionally separate from runtime
service settings in `src/lib/env.ts`.
The configs resolve their shared metadata module with a repository-anchored
`createRequire`, since Next's synthetic compiled-config module can otherwise
resolve the admin's relative imports against the shell working directory.
A regression test exercises Next's actual config loader without building.

Public `GET /api/health` returns exactly `{status, version, sha}`; admin
`GET /api/health` returns only `{status}`. Both are no-store/noindex and perform
no database, identity, model or configuration health checks. They are liveness,
**not** readiness assertions for those dependencies. Private operations still
authorize every request. There are no public admin APIs.

## Independent container runtimes

Build from the repository root, choosing one final target:

```text
docker build --target public --build-arg RELEASE_SHA=<full-commit> -t clamp-public:<commit> .
docker build --target admin --build-arg RELEASE_SHA=<full-commit> -t clamp-admin:<commit> .
```

These default to the synthetic/unconfigured `ci` build profile. They must not
be mistaken for configured release images. Both use Node 24, lockfile installs,
non-root runtime UID and port 3000, but only their own standalone application.
Public starts `/app/server.js`; because admin traces to the monorepo root,
admin starts `/app/apps/admin/server.js` with its static assets at
`/app/apps/admin/.next/static`. CI checks those exact emitted paths.
The public runtime includes prepared MapLibre assets; no `.next/dev`, source
environment file, credentials, tests or developer `node_modules` are copied
from the host. `.dockerignore` allowlists inputs then excludes environment
and credential files even inside allowed directories. All `.local` directories,
including the development AI demo's persistent budget counters, are excluded.

Production builds use `BUILD_PROFILE=production` and two BuildKit secrets,
`public_supabase_url` and `public_supabase_anon_key`. They are public client
configuration, **not** service-role/model credentials. The builder requires
an HTTPS origin and an anon-role JWT or publishable key; it rejects a service
key. Next embeds this public configuration in the application, so it is
inherently visible to users of the browser bundle. It is not a private secret,
and must be protected with the database policies. Build logs, manifests and
workflow artifacts must not separately print the values. Changing public
client configuration requires a new image build. Do not expect runtime
`NEXT_PUBLIC_*` changes to replace compiled values.

The single shared backend public configuration is compiled into both apps.
Runtime administration allowlist, service keys and origins remain separately
provisioned per application; they are never Docker build inputs. The default
map provider remains unchanged, Google authentication is not enabled by this
pipeline, and optional client features needing other build-time public
settings require an explicit later packaging change.

The Node base image follows the Node 24 patch line rather than a pinned base
digest. Therefore rebuilding one commit can produce a new image digest.
The commit-addressed tag is discovery metadata; **the captured image digest
is the immutable deployment identity**. Each release attempt records it.

## Owner configuration, before any authorized release

1. Create/protect a GitHub `release` environment. Set environment secrets
   `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` with public client
   configuration only. Grant Actions permission to publish the repository's
   GHCR packages and create GitHub releases.
2. Commit a stable `X.Y.Z` package/lockfile version, then create/push its
   `vX.Y.Z` tag on master history. For example, update with
   `npm version X.Y.Z --no-git-tag-version`, review/commit, and tag that commit.
   Tags/rulesets should prevent changes to published release tags.
3. Dispatch **Manual versioned release** from master, selecting the existing
   tag. `deploy` defaults to false. The tag is resolved to a full commit,
   checked against package version and master ancestry, then the same commit
   passes reusable CI. Both images are pushed with `sha-<commit>` tags,
   exercised independently with **network disabled** and only read-only
   liveness/boundary smoke, and attached to a GitHub release by immutable
   digest manifest. No `latest` image is deployed.

Merely pushing a commit or tag never deploys anything. Publishing can leave
an image behind if the second build or smoke fails; that is not a successful
release. Each attempt records the available digests and failure/partial
state, and a later attempt has a separate release manifest.

## Additional owner setup, before any authorized Azure deployment

The workflow targets **already provisioned** Azure Container Apps only. It
never creates resources, applies migrations, assigns roles, creates provider
accounts, writes application settings/secrets or configures registry access.
It supports two distinct apps, each with one container, Single revision mode,
HTTPS external ingress and target port 3000. Other topologies fail closed.
Each runtime must already have correct backend settings, storage, admin
allowlist of exactly two confirmed accounts, domains/TLS and resource limits.

Create a protected GitHub **production** environment with required reviewers
and **prevent self-review**. The preflight verifies this protection through
the GitHub API and fails if protection cannot be verified. Restrict the
environment to master and prevent bypass where supported. Set repository
variable `ENABLE_PRODUCTION_DEPLOY` to exactly `true` only after explicit
deployment approval; otherwise the deploy job fails before Azure login.

Set the following **production environment secrets**, not committed files:

| Secret | Meaning |
|---|---|
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | OIDC identity and target subscription |
| `AZURE_RESOURCE_GROUP` | Existing resource group containing both apps |
| `PUBLIC_CONTAINER_APP`, `ADMIN_CONTAINER_APP` | Distinct existing application names |
| `PUBLIC_SITE_ORIGIN`, `ADMIN_SITE_ORIGIN` | Distinct exact HTTPS origins, without trailing slash/path |

Federate the identity to the repository's `environment:production` OIDC
subject. Grant only the separately reviewed read/update permissions needed
on these two existing applications. No client secret is used. The target apps
must already be able to pull the GHCR images (for example owner-approved public
packages, or separately configured registry credentials). Publishing a GHCR
package does not configure Azure pull access.

After explicit cloud approval and `azure-validate`, dispatch from master with
`deploy=true`. Missing settings/opt-in/protection fail explicitly. Both target
shapes are checked before either update. The script updates only the image,
and verifies each configured smoke origin is an ingress/custom domain of its
own target. Azure CLI updates have a two-minute timeout and reads a 20-second
timeout; an update timeout
is an uncertain partial attempt, not proof that nothing changed. Images use
`ghcr.io/...@sha256:...`; the script verifies the desired digest and latest-ready
revision, then runs read-only smoke before proceeding to the second app.
No runtime settings, database writes, login attempts or model calls occur.

Post-deploy smoke retries at most 12 times with shared 10-second attempt deadlines
and delays. It validates the public version/SHA, minimal admin liveness,
public admin-route 404s, denied anonymous admin APIs and the sign-in redirect.
Both development AI demo URLs must also return 404 to GET requests; deployed
smoke never sends a POST or invokes inference.
Because admin health intentionally has no version, admin image identity is
checked through Azure's image digest and latest-ready revision, not through
an unauthenticated operational endpoint. Smoke proves neither authenticated
business operations nor provider/storage readiness. Cold starts may exceed
the bound; that is a failed verification, not a success-shaped fallback.

## Outcome history and limitations

The protected environment, job results and GitHub run history track attempts.
Their automatic deployment links can identify the workflow's dispatch commit
on master rather than the resolved release tag. The sanitized record therefore
separately identifies the release tag/full commit and dispatch commit, alongside
both available digests, job results, update states and smoke outcomes.
Records retain no subscription IDs, resource names, user identities, service
endpoints or provider error bodies. For a requested deployment after successful
release publication, the final record is attached to that existing published
GitHub release as `release-attempt-<run-id>-<run-attempt>.json`, including
success, failure and partial attempts. It is never overwritten, and attaching
it does not change its outcome or claim the applications were deployed.
The recording job adds contents-write permission solely for this upload; it
does not get Azure/OIDC permissions or create releases.

Every attempt on a supported master dispatch also retains the 90-day workflow
artifact fallback, including unresolved tags, pre-package failures and release
asset publication errors. Upload failures fail the record job explicitly while
the artifact upload still runs. Durable assets remain with their release until
the owner deletes them; they are not immutable/WORM audit storage. Successful
package manifests also remain attached to GitHub releases.

The two-app update is **not atomic**. A failure after any update may have
started is recorded as `partial`, even if the CLI timed out and the exact
state is uncertain. Failed first-app smoke prevents updating the second app.
There is no automatic rollback, no claim that failures left both apps unchanged,
and no automatic retry of Azure mutations. Inspect private Azure diagnostics
and make a separately approved recovery decision using recorded digests.
Cancellation/runner loss can prevent artifact upload; GitHub job/environment
history remains, and actual resource state must be inspected privately.

Local preparation verified unit/server, SQL, release safety contracts, scoped
lint and workflow syntax with actionlint. Production builds, browser smoke,
Docker execution, actual GitHub checks/protection, image publication, OIDC,
Azure targets/TLS and real two-account operations still require integration
verification by the parent/owner. This handoff does not claim those ran.
