# Active data model: SQLite

The authoritative schema is `database/schema.mjs`; `database/store.mjs` opens
and migrates it. The old `supabase/migrations` files are history, not runtime
migrations. There was no live PostgreSQL database to import.

The database uses STRICT tables, foreign keys, WAL, full synchronous commits,
an application marker and `user_version`. Startup refuses unrelated files or
future schema versions. Both application processes use the same absolute file
path on one host's persistent local filesystem. Node's SQLite API is experimental
in the Node 24 baseline; integration and packaging checks cover its usage.

| Table / view | Purpose and key invariants |
|---|---|
| `profiles` | App UUID, unique immutable Google subject, private verified email, optional checked pseudonym, admin/ban flags and creation time. No provider real name/photo or password is stored. |
| `sessions` | SHA-256 token hash, account FK, public/admin audience and millisecond creation/expiry timestamps. No raw bearer token or Google access/refresh token. |
| `oauth_attempts` | Hashed browser-flow token, audience, state, nonce, PKCE verifier and ten-minute expiry. Callback atomically consumes it before token exchange. |
| `locations` | UUID, validated latitude/longitude, optional label, cached score/level/public count and timestamps. WGS84 scalar distance function replaces PostGIS. |
| `reports` | Location/account FKs, reporter type, private Blob path/evidence flag, reviewed wording, private original, optional incident date, pending/published/rejected state, flags and reviewer stamps. Publication requires a review time. |
| `reports_public` | Reviewed, published, nonremoved notes and aggregate agree/disagree counts only; no original, user ID, private photo or reviewer field. |
| `report_votes` | Unique report/account pair and agree/disagree choice. Eligible account/public-note checks are performed by server code in the write transaction. Removing a vote deletes the row. |
| `content_policy_limits` | Global UTC-day and account UTC-hour reservations. Both counters are checked and incremented atomically before inference; caps are 200/day and 10/hour. |
| `area_summaries` | Fixed centre/500 m radius, complete-source fingerprint/count/bytes/timestamps, v2 model contract, bounded sentence, draft/approved/rejected/stale status and private review metadata. |
| `area_summary_generation_leases` | Exact coordinate pair, lease UUID, request/expiry times; 90-second admission lease and at least 60-second cooldown after release. |
| `traffic_daily` | UTC day, public route, mobile/tablet/desktop bucket and count. Unique aggregate key; prune before UTC today minus 29 days when recording new traffic. No raw events/visitor identifiers. |

The former unused trust-score and report-flags tables are not carried forward;
future trust/flagging workflows need an explicit migration and authorization
design. Existing report `is_flagged` and `is_removed` fields remain available.

## Identity and authorization

Google subject, not email, is the account key. Verified email may update for the
same subject; a different subject is never silently linked to an existing account
because an email matches. New registration is either explicitly open or invited
through `AUTH_ALLOWED_EMAILS`; admin sign-in never creates accounts.

Pseudonyms are unique, lowercase `[a-z][a-z0-9_]{2,23}` with a policy-check
timestamp, or both fields are null. Only a checked server-issued capability can
save a username. Admin roles are assigned out-of-band to exactly two real account
UUIDs; each admin request also checks the configured two-ID allowlist and ban.

SQLite has **no PostgreSQL RLS/service-role mechanism**. The filesystem and
server routes form the access boundary. Do not expose an arbitrary SQL endpoint
or create a browser-accessible database service. Authorization headers and
client-provided account IDs do not substitute for server sessions.

## Transactions and summary freshness

Location deduplication, quota reservation, voting, human summary approval and
moderation use short synchronous transactions. Photo signing and inference occur
outside transactions. A successful moderation transaction updates publication,
invalidates summary rows through triggers and recomputes the location score.

Summary fingerprints include the centre, radius, exact membership, approved
wording, source timestamps and geometry. Source queries return at most 201 rows
with whole-set window totals; over-limit sets are explicitly blocked, never
partially sent to a model. Draft save and approval recompute the complete
fingerprint under the write lock. Public reads recheck it and project only
reviewed summary metadata.

Source inserts/deletes/edits and location movement/deletion permanently stale
affected drafts/approvals. Undoing an edit cannot revive them. Votes do not
invalidate a summary. Photo objects are deleted after insertion failures only
when rollback is confirmed; uncertain outcomes retain private evidence.

## Operations

Use `npm run db -- init`, `accounts`, `admins`, `backup` and `restore`; see the
README. Online backup includes committed WAL state and is verified. Restore
requires stopped applications and a new destination. Protect the database,
WAL/SHM and backups as private data; database files/backups must never enter git
or images. Off-host encrypted backup retention and automated restore drills are
deployment prerequisites, not implemented cloud resources.
