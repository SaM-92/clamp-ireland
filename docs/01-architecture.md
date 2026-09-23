# Architecture and cost plan: SQLite / Google

Supersedes the original hosted PostgreSQL/Auth design. See
`19-sqlite-google-handoff.md` for migration and operating details.

| Layer | Current choice | Cost / boundary |
|---|---|---|
| Public and private websites | Two Next.js applications, shared modules | Same persistent host for SQLite; no admin routes in the public build |
| Database | SQLite through Node 24 `node:sqlite` | No database service fee; local durable disk and backups still needed |
| Sign-in | Google OIDC through maintained `openid-client` | One-time Google client setup; no app passwords, SMTP or confirmation emails |
| Evidence | Private Azure Blob, managed identity | Storage/operations billed; human review and temporary private URLs |
| Geography | GeographicLib WGS84 geodesics | No PostGIS service; bounded neighbourhood selection on a small dataset |
| Map | MapLibre + OpenFreeMap | No API key; external provider availability/policy applies |
| Search | Photon/OpenStreetMap | Explicit submit, not autocomplete; cached and Ireland-filtered |
| Inference | Existing server-side provider integration | Explicit AI usage charges; fixed atomic reservation limits |

SQLite is not a second database or a cache: it stores identities, sessions,
reports, moderation, scores, votes, summaries, leases, quota reservations and
aggregate traffic. Photos remain outside it in Blob.

## Trust and process boundaries

Browsers call only the corresponding application's API. Google authenticates
the account; the application owns opaque, hashed SQLite sessions and pseudonyms.
Authorization belongs to server code, not a SQLite role/RLS system. Every
admin page/API must use the two-account gate. Public writes check session
audience, expiry, bans and exact Origin; content creation also requires a
server-issued policy capability. Public projections must never include
private text, account IDs, Google email or Blob paths.

Two same-host processes share one **absolute** database path. WAL, foreign keys,
full synchronous commits and a bounded busy timeout are enabled. Transactions
are short and synchronous; no network or model call holds a write transaction.
Moderation checks Blob first, then conditionally updates, invalidates summaries
and recomputes scores in one transaction. SQL is parameterized.

Do not use network filesystems for WAL or run replicas on separate hosts.
The SQLite file is never included in an image. The local Docker arrangement
uses one named local volume and runs both processes as the same non-root UID.
Application builds are independent, but this does not make the shared database
an independent security boundary against a compromised server process.

## Geography and product behavior

Location deduplication is nearest-within-30 m. Summary selection is a fixed,
inclusive 500 m WGS84 radius, not transitive clustering. A one-micrometre
numerical tolerance handles floating-point boundary representation; it is
not a geographical padding zone. Display circles remain 100 m / 50% opacity.
Scores and their 180-day half-life formula are unchanged. Scheduled score
refresh remains backlog.

OpenStreetMap data is open, but hosted services have their own usage policies.
We do not use public Nominatim or OSM raster tile endpoints. Photon searches
send the submitted search string, not report text or photos. Preserve attribution,
explicit-submit behavior, timeouts, caching and visible upstream failures.

## Hosting and costs

**No Azure resources have been deployed.** A permanent host with local storage,
backup retention and an approved cost estimate is still required. Do not claim
zero hosting cost or a guaranteed EUR 10/month cap because SQLite is free.
Large HEIC processing previously measured approximately 1.3 GiB decoder RSS;
the public container retains 2 GiB and the admin container 0.5 GiB limits.

The old scale-to-zero Container Apps / hosted-database Bicep is archived under
`infra/legacy-container-apps/`; it cannot host this database durably. Do not deploy
it or move SQLite onto Azure Files to preserve that topology.

Before cloud deployment: approve the persistent host/storage price, preserve
the development-only subscription restriction, prepare private Blob/inference
connectivity, configure real OAuth clients/admin accounts, provide approved IPs
privately at deployment time, and test access both inside and outside that list.
Do not retain a current-IP snapshot or change shared inference networking as an
implicit workaround. The release deployment hold remains unconditional.
