# SQLite and Google-only migration handoff

## Scope and honest status

The owner approved replacing the hosted database with embedded SQLite and
email/password authentication with Google-only sign-in. This change does not
authorize an unpriced host or Azure deployment. No cloud resources, OAuth
credentials, real accounts or IP snapshots were created.

Local delivery is complete. Both ignored development environments point at the
same initialized, empty SQLite file; no sample users, admin identities or reports
were inserted. With `DATABASE_PATH` configured, the public app uses real storage
rather than the browser-only reporting preview. Google sign-in remains explicitly
unavailable until real provider configuration is supplied.

The active application no longer imports Supabase or PGlite. Historical SQL
remains marked retired in `supabase/README.md`. The old Bicep topology is archived
under `infra/legacy-container-apps/`, and release deployment still throws before
any resource mutation. The original `v0.1.0` tag is unchanged.

## Implementation map

- `database/schema.mjs`, `store.mjs`, `store.d.mts`: STRICT schema, identity
  marker/version, WAL, foreign keys, transactions, WGS84 distance and online backup.
- `src/lib/db/server.ts`: server-only connection, absolute `DATABASE_PATH`.
- Domain repositories: direct parameterized SQLite, no fluent emulation adapter
  or dual-database path. Scoring, moderation, votes and summary semantics remain.
- `src/modules/auth/server/google.ts`: real `openid-client` discovery, PKCE,
  state, nonce, signed ID-token checks and verified-email claims.
- `src/modules/auth/server/session.ts`: random opaque tokens, hashed storage,
  audience/expiry/ban checks, exact-Origin mutations and revoking logout.
- Public/admin `/api/auth/sign-in`, `/callback`, `/session`, `/sign-out`:
  Google-only routes. Application error messages omit callback codes, credentials
  and provider tokens; none are put in browser local storage. Configure platform
  access-log query redaction before enabling live OAuth callbacks.
- `scripts/database.mjs`: initialization, private account UUID listing,
  exactly-two admin role assignment, verified backup and new-path restore.
- `compose.yaml`: same-host local named volume, non-root identities and loopback
  ports. Production-mode containers have no local-report or AI-demo bypass.

Public sessions last 24 hours; admin sessions one hour. OAuth flow cookies are
HttpOnly/Lax for Google's top-level callback; final cookies are HttpOnly/Strict
and host-only, with Secure/`__Host-` names on HTTPS. Cookie names and database
audiences differ even when local websites share a hostname on different ports.
An admin role alone is insufficient without the exact two-ID allowlist.

Only Google subject links an account. Provider display-name/role metadata is
ignored. Public usernames still pass the existing content classifier; no
bootstrap code forges an approval. Closed signup still permits invited new
Google accounts and existing accounts; ban/revocation is separate.

## Persistence and limits

Use one absolute file on persistent **local** disk shared by both processes.
Never use an image layer, temporary Container Apps disk, Azure Files/SMB/NFS,
or independent scaled hosts. The adapter rejects a relative path, an unrelated
database or a newer schema. Node 24's built-in SQLite API is experimental;
keep the Node baseline and integration tests aligned.

No async/network callback is permitted inside a database transaction. The busy
timeout is five seconds. Initialization rechecks migration version after
acquiring its write lock, allowing both websites to start on an empty file.
Source/public projections are explicit; SQLite is not a replacement RLS engine.

Backups use SQLite's online backup, then integrity/foreign-key checks. Existing
destinations are refused. Stop both apps and restore to a new file, then update
both environments. No cloud backup scheduler, off-host storage or retention
policy has been provisioned.
Restore revokes sessions/OAuth attempts; reconcile later bans and takedowns
before reopening. CLI backup/accounts/admin commands refuse a missing source
instead of silently creating an empty database.

Unchanged safeguards include 50 MiB/64 MP source photos, 3 MiB processed WebP,
private Blob, bounded upload/worker admission, reviewed notes, score weights,
10/hour/account + 200/day policy reservations, no paid retries, complete summary
source limits and permanent invalidation. WGS84 tests distinguish 499/500/501 m.
Traffic now prunes to the same 30-day window it displays.

## Owner setup still required

Follow README setup using real Google web-client credentials and registered
public/admin callback origins. Keep registration closed and configure invitations
privately. Sign in on the public app first, choose checked pseudonyms, inspect
UUIDs locally, assign exactly two admin roles, then configure the same two IDs
in the private admin environment. Never put those identities in committed files.

Blob and inference permissions remain explicit server-side configuration.
The public app can read current human-approved summaries without model credentials.
Browsing never generates a paid summary. The existing local synthetic AI demo
budget was not reset and migration tests do not make paid requests.

## Verification and outstanding delivery

Real SQLite tests cover constraints, quotas, transactional moderation, votes,
public projections, WGS84 boundaries, complete source limits, stale approvals,
generation cooldown, reopening, online backup and separate concurrent writers.
OIDC tests use the real library and a locally signed fake provider to exercise
state/nonce/PKCE replay protection, issuer/audience/signature/expiry rejection,
verified email, invitation rules and admin isolation. This is not a live Google
consent-screen test.

Final local verification:

| Surface | Result |
| --- | --- |
| Unit/server contracts | 84 passed |
| Real SQLite policies, persistence and CLI | 13 passed |
| Release safeguards | 19 passed |
| Retired Bicep contracts | 4 passed; not cloud deployment validation |
| Admin and vote browser flows | 18 passed |
| Isolated production browser smoke | 7 passed |
| Lint, TypeScript and both production builds | Passed |
| Independent Linux public/admin images | Built and standalone routes verified |
| Real 64-MP HEIC / HTTP source boundary | ~1285 MiB peak decoder RSS; 50 MiB accepted, +1 byte rejected |
| Shared local volume | Non-root apps share publication state across both restarts |

CLI regression coverage includes refusal to create missing backup/account sources,
restore destination protection, preserved report-location/account data, restored
session/OAuth revocation, and atomic exactly-two admin assignment. Invalid grants
retain previous roles/sessions; successful grants revoke only admin sessions.
The real local empty database also passed backup/restore, and the two temporary
check files were removed.

Browser fixtures use their own `test-results/admin-fixture/sessions.sqlite`, never
the real development database. The authorization helper refreshes synthetic
sessions after logout to avoid test-order dependence. No fixture endpoint ships.
Do not build the same Next output while a browser suite is serving it; stop the
normal admin preview before development browser tests.

Both images remain local, with synthetic all-zero release SHA metadata; do not
publish them as releases. Packaging includes the OIDC/geodesic dependency license
files. No existing tag was changed and no release/deployment workflow was dispatched.

Remaining deployment work is approved persistent hosting and pricing, local disk/backup
operations, private Blob/inference networking, real OAuth/admin setup, and IP
restrictions applied during provisioning before endpoints become accessible.
An approved-network deployment runner and inside/outside access checks remain
required; do not temporarily allow public CI IPs or alter shared AI networking.
