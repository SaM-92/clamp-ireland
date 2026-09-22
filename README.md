# Clamp Transparency Signal (working repo name: `clamp-ireland`)

A community-reporting map for clamping / high-risk parking-fine hotspots in
Ireland. People who've been clamped (or who witnessed it, or live nearby)
drop a pin and file a report; the app aggregates reports per location into a
public, factual "transparency signal" — a risk level and a report count — so
others can check a spot before parking. It never names or accuses a company
or individual; see `docs/00-product-plan.md` and
`docs/04-legal-considerations.md` for why, and how that's enforced.

This is a personal/community project, not a commercial product. Everything
is built to run on free tiers.

**Status: local prototype, not launch-ready.** The map works without a
backend. Live accounts, moderation, and report storage need Supabase.
Privacy/legal policies, abuse controls, real AI text review, and image
redaction tooling remain launch prerequisites; see the roadmap.

## Quick local preview (no account needed)

```powershell
npm ci
npm run dev -- --port 3001
```

Open http://localhost:3001. Without Supabase configuration, development
automatically enables a clearly labelled **Local preview**. Add a report,
choose a point on the map (or use the keyboard-accessible map-centre button),
and save it. Pins, counts, and note text persist in this browser until
**Reset preview**. Approval is simulated locally. Photos are not saved or
uploaded; neither are accounts or identity details.
Production builds never enable this preview, and API writes still require
a valid, email-confirmed Supabase user.

Search Irish towns or street names (for example **Main Street, Naas**), or
use the city shortcuts. Pins and coloured zones open the notes at that spot.
Zones are **100 m circles at 50% opacity**, using the existing weighted
score, not a probability of a fine. Search uses Photon/OpenStreetMap;
coverage depends on their indexing and the free service has no availability
guarantee. Searches run on submission, not each keystroke.

The phone layout puts search and the map ahead of the report list and
statistics. Touchscreen maps use two fingers to pan, allowing one-finger
page scrolling. Forms and notes scroll within the available screen space.

Open `/admin` for the dashboard (read-only browser-local preview without
Supabase), or `/appeal` for the official-source Republic of Ireland appeal
guide. The latter explains the two stages and deadlines; posting a community
report is not an appeal.

## How it's organized
Read these in order for full context (each depends on the ones before it):

- [`docs/00-product-plan.md`](docs/00-product-plan.md) — what this is, and
  the product decisions already locked in.
- [`docs/01-architecture.md`](docs/01-architecture.md) — stack choice and
  why (Next.js, Supabase, MapLibre, free-tier map tiles), cost breakdown.
- [`docs/02-data-model.md`](docs/02-data-model.md) — database tables and RLS.
- [`docs/03-scoring-algorithm.md`](docs/03-scoring-algorithm.md) — exactly
  how a location's risk score/level is calculated.
- [`docs/04-legal-considerations.md`](docs/04-legal-considerations.md) —
  informational (not legal advice) research behind the moderation/wording
  decisions.
- [`docs/05-roadmap.md`](docs/05-roadmap.md) — phased backlog; **the
  canonical "what's done vs. not" list** — check this before starting new
  work, and keep it updated as you finish things.
- [`docs/06-ui-handoff.md`](docs/06-ui-handoff.md) — design decisions,
  map-worker repair, local preview boundaries, and browser regression checks.
- [`docs/07-admin-handoff.md`](docs/07-admin-handoff.md) — dashboard,
  protected moderation/photo review and optional aggregate traffic.
- [`docs/08-appeal-handoff.md`](docs/08-appeal-handoff.md) — NTA source,
  deadline wording, scope and accessibility.
- [`docs/09-search-handoff.md`](docs/09-search-handoff.md) — opt-in search
  indexing, canonical domain, crawler controls and deployment checks.
- [`docs/10-support-payments.md`](docs/10-support-payments.md) — Stripe
  Payment Links recommendation, wallet support, fees and alternatives.

Code is module-based under `src/modules/*`, one folder per domain concept
(`scoring`, `locations`, `reports`, `moderation`, `map`, `auth`,
`donations`, `dashboard`), each with its own `types`, client `api`, optional
`server/` (service-role-only logic), and `components/`. Shared, cross-module
code lives in `src/lib` (env access, Supabase clients). Routes and API
handlers live in `src/app`.

## Prerequisites
- Node.js 20+
- A free [Supabase](https://supabase.com) account (for Postgres + Auth + Storage)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create a Supabase project
1. Create a new project at [supabase.com](https://supabase.com) (free tier).
2. Apply both migrations **in order**:
   [`0001_init.sql`](supabase/migrations/0001_init.sql), then
   [`0002_reviewed_public_notes.sql`](supabase/migrations/0002_reviewed_public_notes.sql).
   Then apply [`0003_aggregate_traffic.sql`](supabase/migrations/0003_aggregate_traffic.sql)
   for optional admin traffic counts; collection stays disabled until opted in.
   The second migration restricts public reads to reviewed notes, prevents
   self-assigned admin roles, and restricts location creation to the server.
   It intentionally requeues legacy published reports without review stamps
   and resets their location counts/scores; approve them again to rebuild
   the public signal. Run it once as a migration, not on every deployment.
   These migrations have not been applied to a live project in this session.
   (Alternatively, if you have the
   [Supabase CLI](https://supabase.com/docs/guides/cli) linked to the
   project, `supabase db push` applies pending migrations.)
3. In **Storage**, create a new bucket named `report-images` and set it to
   **private** (not public). Moderators receive temporary signed URLs in the
   protected review queue. Public notes expose no photos or storage paths.
4. In **Authentication → Providers**, enable Email and **Confirm email**.
   Registration uses email/password with a one-time confirmation link.
   Subsequent sign-in uses the password; this app does not add two-factor
   authentication. Configure SMTP for delivery beyond Supabase's limited
   development email service.
   Set the Auth Site URL and allow `http://localhost:3001`,
   `http://localhost:3001/auth/sign-in`, and the corresponding deployed URLs.
5. Copy your Project URL, `anon` public key, and `service_role` secret key
   from **Project Settings → API**.

### 3. Configure environment variables
```bash
Copy-Item .env.example .env.local
```
Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase project above. The
  service-role key is server-only and must never be exposed to the browser
  or committed.
- `NEXT_PUBLIC_MAP_TILE_STYLE_URL` — defaults to the free, no-signup
  [OpenFreeMap](https://openfreemap.org) Bright style. For a quieter basemap,
  set `https://tiles.openfreemap.org/styles/positron`. Any compatible
  MapLibre style URL can be configured (see `docs/01-architecture.md`).
- `NEXT_PUBLIC_DONATION_URL` — your real hosted support URL, such as a
  Stripe Payment Link, Ko-fi or Buy Me a Coffee. Leave blank for a
  non-clickable "Support us soon" placeholder. No payment account was created.
- `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` — `true` only after enabling Google in
  Supabase Auth. Put the Google OAuth client ID/secret in **Supabase**, not in
  browser variables; register the callback URL Supabase provides with Google.
  This is a Google OAuth client, not a Gmail API integration.
- `OPENAI_API_KEY` — reserved for future AI integration. The current text
  softener is heuristic-only; merely setting this key does not enable AI.
- `SITE_URL` — the actual public HTTPS origin, without a path, query or
  credentials. Leave blank locally; no guessed domain is emitted.
- `ALLOW_INDEXING` — default `false`. Enable only after the public site is
  ready. Development, preview deployments and private/admin routes remain
  noindex. Google/ChatGPT crawl eligibility does not guarantee inclusion.
- `ENABLE_TRAFFIC_ANALYTICS` — default `false`. After migration 0003 and
  privacy/consent/hosting-log review, opt in to production-only aggregate
  pageview counts. No application-stored visitor IDs, searches or report
  content. These are approximate pageviews, not unique people.

The app also runs, and `npm run build` succeeds, without any of the above
set. Public map/stat reads use empty data; development has the local
preview described above. Real report submission and moderation require
Supabase; do not use preview data as community evidence.

### 4. Run it
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

### 5. Becoming an admin
A `profiles` row is created automatically for every new user (see the
`on_auth_user_created` trigger in the migration). The admin gate
(`src/modules/auth/lib/requireAdmin.ts`) checks that row's `is_admin` flag.
There's no self-service admin signup by design — after signing in once, set
`is_admin = true` for your user directly in the Supabase Table Editor/SQL
Editor.

Open `/admin` with that account for live operational counts, moderation and
the traffic section; `/admin/moderation` is the dedicated review workspace.
Without backend configuration, development offers only a clearly labelled
read-only preview of this browser's existing test notes. It cannot review
discarded preview photos or grant live admin access.

**Every report, including
text-only reports, starts pending.** Edit the public wording, confirm that
text/photo review is complete, then approve or reject. A heuristic editing
aid is not AI anonymisation. Reject images requiring redaction: the
prototype does not yet include a blurring tool.

Private evidence failures block approval rather than silently hiding a
photo. Traffic shows an explicit disabled/setup state until configured.
When enabled it groups counts by UTC day, public route and viewport class;
it does not track individual journeys or deduplicate visitors. Old rows are
pruned on subsequent traffic, not by an unattended scheduled job.

## Scripts
```bash
npm run dev     # start dev server
npm run build   # production build
npm run start   # run a production build
npm run lint    # ESLint
npm run test:e2e # browser regression checks against localhost:3001
```

`predev` and `prebuild` copy MapLibre's matching worker and shared ESM
modules into `public/vendor/maplibre/<installed-version>/`. These generated
files are ignored by git and ESLint. Do not remove this step: MapLibre 6's
default worker URL does not survive the Next.js bundle, leaving a blank map.

Browser tests use installed Edge on Windows, Playwright Chromium elsewhere
(`npx playwright install chromium` if missing). `PLAYWRIGHT_CHANNEL`
overrides the browser channel. Tests load real OpenFreeMap street tiles and
require network access. Phone tests cover touch interaction at 320, 375,
390 and 430px, landscape, and a reduced-height form viewport. Embedded
Postgres tests exercise migration 0002's access rules; they do not validate
Supabase Auth, Storage or PostGIS integration. See the UI handoff for
production checks.

## Deploying
Any Next.js-compatible host works; [Vercel](https://vercel.com)'s free
Hobby tier is the path of least resistance (zero-config Next.js deploys).
Set the same environment variables from `.env.local` in the host's
dashboard — never commit `.env.local`.

## Contributing / picking up where this left off
This project is built to be worked on across many independent agent/human
sessions. Before starting:
1. Read `docs/05-roadmap.md` to see what's done and what's next.
2. Read the doc(s) relevant to the area you're touching (data model,
   scoring, legal) before changing behaviour there.
3. Update `docs/05-roadmap.md` as you complete items, so the next session
   doesn't have to reconstruct progress from git history or chat logs.
