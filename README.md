# Clamp Transparency Signal

A community map of reported clamping and parking-fine hotspots in Ireland.
People share experiences; the map shows weighted reports, not a probability of
a fine or a verified accusation. Companies, individuals and private photo
evidence are not named or exposed in public notes.

**Current stack: Next.js + SQLite + Google sign-in + private Azure Blob.**
SQLite is free and embedded in the application; there is no separate database
service, Supabase account, app password, SMTP service or confirmation-email flow.
Hosting, persistent disk, Blob and AI usage still have operating costs.
**Nothing is deployed to Azure.** Durable hosting and private networking still
need approval and configuration. The EUR 10/month target is not a spending cap.

## Local preview

Use Node.js 24, the CI/container baseline. The built-in `node:sqlite` API used by
this project is experimental in this Node version; SQLite itself is the embedded
database engine. Keep Node upgrades covered by the database and packaging tests.

```powershell
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Open http://localhost:3001. When `DATABASE_PATH` is unset, development offers a
clearly labelled, browser-only preview with simulated moderation. Notes/votes
stay in that browser and Reset preview clears them. Photos are not uploaded or
stored. Production never enables this preview, and real mutations require a
server-verified account.

MapLibre uses OpenFreeMap street tiles; explicit-submit place searches use
Photon/OpenStreetMap, with attribution and no Google Maps billing. Coverage and
availability depend on those providers. Display circles are **100 m at 50%
opacity**; the separate summary neighbourhood is a fixed **500 m** radius.
The phone map uses two fingers to pan. `/appeal` links to official Republic of
Ireland appeal guidance; reporting here does not lodge an appeal.

The optional local Azure AI demonstration remains development-only, synthetic
and limited to its existing ten-attempt budget. Do not reset that budget.

## Real local database and Google sign-in

1. Copy `.env.example` to `.env.local` only if the latter does not already
   exist; preserve any existing private settings. Set `DATABASE_PATH` to an
   **absolute local-disk path**, for example
   `Q:\Repos\ClampIreland\.local\clamp.sqlite`. Run `npm run db -- init`.
   Migrations run automatically when an application opens the database.
2. Create a Google OAuth **web application** client and configure its consent
   screen/test users as required by Google. Register these exact development
   redirect URIs: `http://localhost:3001/api/auth/callback` and
   `http://localhost:3003/api/auth/callback`. For hosted operation use the actual
   HTTPS origins; never guess them.
3. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
   `AUTH_PUBLIC_ORIGIN=http://localhost:3001` in the public server's private
   environment. These are server settings, not `NEXT_PUBLIC_` variables.
   Keep `ALLOW_PUBLIC_SIGNUP=false` for private testing, and privately set
   `AUTH_ALLOWED_EMAILS` to invited Google email addresses. Google must return a
   verified email; the app does not send email. Existing accounts can still
   sign in when new registration is closed.
4. Start the public app, sign in with Google, and choose a checked public
   pseudonym. Google names/photos are not imported. Content checking requires
   the configured server-only AI provider; it is not bypassed for setup.
5. Configure `apps/admin/.env.local` from its example. Use the **same absolute
   `DATABASE_PATH`** as the public app and configure Google credentials and
   `ADMIN_SITE_URL=http://localhost:3003`. After both intended administrators
   have signed in on the public app, run `npm run db -- accounts` locally.
   Assign their two existing UUIDs with
   `npm run db -- admins <first-uuid> <second-uuid>`, then privately set
   `ADMIN_ALLOWED_USER_IDS` to those same two comma-separated IDs. This command
   revokes prior admin sessions. Never commit real IDs or credentials.
6. Run `npm run dev:admin -- --hostname 127.0.0.1`. Only the two listed,
   non-banned administrator profiles can enter the separate admin website.
   There is no admin signup or preview bypass.

Google credentials and the real administrator accounts are **not configured
in this repository**. Synthetic tests are not proof of live Google consent setup.
Public sessions expire after 24 hours; admin sessions after one hour. Cookies
are HttpOnly, host-only and audience-separated. Session tokens are hashed in
SQLite; cookie-authenticated writes require the exact configured Origin.

## Persistent storage and backups

Both app processes must run on **one persistent host/local filesystem**.
Do not place SQLite on ephemeral Container Apps storage or Azure Files/SMB/NFS,
and do not scale the processes across hosts. Database/WAL/SHM files and backups
are ignored by git and excluded from images.

```powershell
npm run db -- backup Q:\Backups\clamp-backup.sqlite
```

This uses SQLite's online backup API and integrity/foreign-key checks, not a
copy of an active WAL file. An existing backup is never overwritten. For restore,
stop both websites, set `DATABASE_PATH` to a **new** absolute path, and run:

```powershell
npm run db -- restore Q:\Backups\clamp-backup.sqlite
```

Then point both apps at the restored file and restart. The restore command
refuses an existing destination or leftover WAL/SHM files and revokes restored
sessions. Reconcile bans and takedowns made after the backup before reopening.
Protect backups as private data and retain a separate failure-domain copy; backup scheduling,
off-host retention and hosted disaster recovery remain deployment work.

`compose.yaml` provides a loopback-only local Docker arrangement: both apps
share one local named volume, run non-root, and have independent memory limits.
Prepare both private env files, set `$env:APP_RELEASE_SHA = git rev-parse HEAD`,
then use `docker compose up --build`. Stop other servers on ports 3001/3003
first. The named volume survives container replacement; do not run
`docker compose down --volumes` on data you need. Containers cannot use the host's
Azure CLI login automatically; hosted Blob/AI identity remains separate setup.

## Moderation, photos and optional features

Every report starts pending. An eligible human reviews/edits the public wording
and checks private photo evidence before approval. Missing photos block approval.
The original note, Google email, account IDs and Blob paths never appear in public
notes. Reject images needing redaction until a redaction tool exists.

JPEG/PNG/WebP/HEIC/HEIF sources are limited to **50 MiB / 64 MP**, processed in a
bounded worker, stripped of metadata and stored as WebP at most **3 MiB**.
RAW/DNG and animations are rejected. Configure the private `report-images`
Blob container and server identity; no storage keys or public container fallback
are used. See [photo handoff](docs/18-private-deployment-and-photos.md).

Report/username checks use one explicitly configured AI provider; atomic SQLite
admission caps attempts at 10/account/hour and 200 globally/day. Failures consume
reservations; there is no automatic paid retry. Optional reviewed summaries use
GPT-5 mini, complete sets of at most 200 notes / 48,000 UTF-8 bytes, human approval
and freshness checks. Votes do not change scores or summary sources.

`ENABLE_AREA_SUMMARIES`, `ENABLE_TRAFFIC_ANALYTICS` and `ALLOW_INDEXING` default
off. Aggregate traffic stores only UTC day, route, coarse viewport and count,
with 30-day pruning on new traffic; no visitor IDs. Configure an actual HTTPS
`SITE_URL` and review privacy/legal policies before enabling indexing or analytics.
`NEXT_PUBLIC_DONATION_URL` accepts a real hosted support link; leave it blank
until one exists. No payment account is provisioned by this code.

## Development and checks

```powershell
npm run lint
npm run test:unit
npm run test:sql
npm run test:release
npm run build:all
npm run test:infra
```

`test:sql` runs real SQLite constraints, WGS84 boundaries, persistence, backups
and concurrent writers. Unit tests exercise the real OIDC library with a locally
signed synthetic provider, never live Google or paid AI. `test:infra` compiles
**retired** network templates for historical contract coverage; it is not
validation of a deployable SQLite topology.

CI builds both apps and runs production smoke in a clean checkout without local
env files. Browser tests seed isolated SQLite sessions outside application code;
there is no shipped fixture endpoint or auth bypass. Stop the admin dev server
before development browser tests because both use its `.next/dev` directory.
Windows uses Edge for development tests; CI uses Playwright Chromium.

The manual release workflow packages images without database/OAuth build secrets.
Tags and pushes do not deploy. The old `v0.1.0` tag stays unchanged; a later
release needs its own matching package version/tag. Cloud deployment remains
hard-blocked until persistent hosting, costs, private connectivity and
deployment-time approved IPs are resolved. No current-IP snapshot is retained.

## Handoffs and contribution

Start with [roadmap](docs/05-roadmap.md), [architecture](docs/01-architecture.md),
[data model](docs/02-data-model.md), [scoring](docs/03-scoring-algorithm.md) and
[legal considerations](docs/04-legal-considerations.md). The current migration
handoff is [SQLite and Google](docs/19-sqlite-google-handoff.md).
Earlier numbered handoffs remain historical context; their Supabase/password
and Container Apps instructions are superseded.

Domain code lives in `src/modules`, shared configuration/database access in
`src/lib`, the public application in `src/app`, and the separate private website
in `apps/admin/src/app`. The public build must never contain administrative
pages or APIs. Update the roadmap and directly related handoffs with changes.
