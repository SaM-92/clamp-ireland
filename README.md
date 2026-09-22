# Clamp Transparency Signal (working repo name: `clamp-ireland`)

A community-reporting map for clamping / high-risk parking-fine hotspots in
Ireland. People who've been clamped (or who witnessed it, or live nearby)
drop a pin and file a report; the app aggregates reports per location into a
public, factual "transparency signal" — a risk level and a report count — so
others can check a spot before parking. It never names or accuses a company
or individual; see `docs/00-product-plan.md` and
`docs/04-legal-considerations.md` for why, and how that's enforced.

This is a personal/community project, not a commercial product. It targets
very low operating costs using free tiers where appropriate; hosting,
storage, email and model usage are not guaranteed free.

**Status: local prototype, not launch-ready.** The map works without a
backend. Live accounts, moderation, and report storage need Supabase.
Server-side AI content checks are implemented, but backend configuration,
privacy/legal policies, production abuse safeguards and image redaction
tooling remain launch prerequisites; see the roadmap.

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
Each note also has **Agreed / Disagreed** feedback. In local preview this
simulates one browser voter; Reset preview clears both notes and votes.
Production builds never enable this preview, and API writes still require
a valid, email-confirmed Supabase user.

For a **real Azure AI demonstration**, configure the existing GPT-5 mini
deployment in ignored `.env.local`, enable `ENABLE_LOCAL_AI_DEMO`, and bind
the dev server to loopback:

```powershell
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Open http://localhost:3001/dev/ai-demo. Fixed synthetic examples show a real
one-sentence summary, allowed factual criticism and blocked abuse/usernames.
It clearly distinguishes Azure output, cached output and no-cost local rules.
The demo has a persistent ten-attempt budget and is unavailable in production.
It never bypasses administrator authentication or publishes community content.
See [the AI handoff](docs/17-azure-ai-handoff.md) for limits and setup.

Search Irish towns or street names (for example **Main Street, Naas**), or
use the city shortcuts. Pins and coloured zones open the notes at that spot.
Zones are **100 m circles at 50% opacity**, using the existing weighted
score, not a probability of a fine. Search uses Photon/OpenStreetMap;
coverage depends on their indexing and the free service has no availability
guarantee. Searches run on submission, not each keystroke.

The phone layout puts search and the map ahead of the report list and
statistics. Touchscreen maps use two fingers to pan, allowing one-finger
page scrolling. Forms and notes scroll within the available screen space.

The public website has **no admin links, admin pages or administrative APIs**.
Administration is a separate application; see setup step 5. There is no
unauthenticated admin preview. `/appeal` remains the official-source Republic
of Ireland guide; posting a community report is not an appeal.

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
- [`docs/11-area-summaries-handoff.md`](docs/11-area-summaries-handoff.md) —
  500 m source selection, small-model generation, review and cache freshness.
- [`docs/12-voting-handoff.md`](docs/12-voting-handoff.md) — confirmed-account
  feedback, public counts, private own-vote state and browser-local simulation.
- [`docs/13-azure-architecture-options.md`](docs/13-azure-architecture-options.md) —
  Azure hosting/Blob recommendation, database alternatives and cost caveats;
  deployment still requires explicit approval.
- [`docs/14-private-admin-handoff.md`](docs/14-private-admin-handoff.md) —
  separate administration app, two-account access, private sessions and setup.
- [`docs/15-release-handoff.md`](docs/15-release-handoff.md) — CI gates,
  image packaging, version tags and approval-gated deployment records.
- [`docs/16-content-policy-handoff.md`](docs/16-content-policy-handoff.md) —
  report/username policy checks, onboarding and direct-write restrictions.
- [`docs/17-azure-ai-handoff.md`](docs/17-azure-ai-handoff.md) — shared Azure
  model provider, local live demonstration and bounded inference.

Code is module-based under `src/modules/*`, one folder per domain concept
(`scoring`, `locations`, `reports`, `moderation`, `map`, `auth`,
`donations`, `dashboard`, `admin`, `analytics`, `seo`, `area-summaries`, `votes`,
`ai`, `ai-demo`, `content-policy`, `release`),
with domain-specific `types`, client `api`, optional
`server/` (service-role-only logic), and `components/`. Shared, cross-module
code lives in `src/lib` (env access, Supabase clients). Routes and API
handlers for the community website live in `src/app`. Administrative pages,
sign-in and APIs live exclusively in `apps/admin/src/app`, with an independent
Next.js build and shared domain modules.

## Prerequisites
- Node.js 24 (the CI/container baseline)
- A free [Supabase](https://supabase.com) account (for Postgres + Auth + Storage)

## Tests and release preparation

```powershell
npm run test:unit
npm run test:sql
npm run test:release
```

GitHub Actions runs these gates, lint, both production builds and
`npm run test:smoke` on pull requests and master pushes. Smoke uses isolated
synthetic services, not real accounts or paid AI. Its build/smoke wrapper
requires a clean checkout without local environment files; see handoff 15.
The existing `npm run test:e2e` covers the running development preview.

Source tag **`v0.1.0`** is the first CI-verified release-preparation baseline.
The separate manual release workflow resolves a matching version tag, builds
independent images and records commit/digests/outcomes. Deployment additionally
requires explicit opt-in, protected approval, OIDC and configured existing
Azure apps. Pushing code or a tag never deploys. **No Azure deployment has
been performed.**

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create a Supabase project
1. Create a new project at [supabase.com](https://supabase.com) (free tier).
2. Apply migrations **in numeric order**:
   [`0001_init.sql`](supabase/migrations/0001_init.sql), then
   [`0002_reviewed_public_notes.sql`](supabase/migrations/0002_reviewed_public_notes.sql).
   Then apply [`0003_aggregate_traffic.sql`](supabase/migrations/0003_aggregate_traffic.sql)
   for optional admin traffic counts; collection stays disabled until opted in.
   Apply [`0004_reviewed_area_summaries.sql`](supabase/migrations/0004_reviewed_area_summaries.sql)
   for reviewed 500 m summaries, then
   [`0005_report_votes.sql`](supabase/migrations/0005_report_votes.sql)
   for public feedback counts and private confirmed-account voting.
   Then [`0006_content_policy.sql`](supabase/migrations/0006_content_policy.sql)
   adds username moderation, submission rate admission and direct-write
   restrictions. Then
   [`0007_concise_area_summaries.sql`](supabase/migrations/0007_concise_area_summaries.sql)
   enforces 20-word/160-character v2 summaries and retires cached v1 drafts
   and approvals without rewriting historical text. Apply each migration once.
   Migrations 0006/0007 and a configured AI provider are required before
   deploying this version against a backend.
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
- `AI_PROVIDER=azure`, `AZURE_OPENAI_ENDPOINT`,
  `AZURE_OPENAI_DEPLOYMENT=gpt-5-mini`, `AZURE_OPENAI_AUTH_MODE=entra` —
  the public server's report/username classifier and the separate admin
  server's optional summary generator each need their own server-side
  inference access. Local Entra authentication uses Azure CLI; production
  uses managed identity. No role assignments are created automatically.
  Optional API-key mode uses `AZURE_OPENAI_API_KEY` server-side only.
  The earlier `AI_PROVIDER=openai` / `OPENAI_API_KEY` transport remains
  available, but there is no silent cross-provider fallback.
- `ENABLE_AREA_SUMMARIES` — default `false` in both apps. After migration
  0004, enable on the public app to read reviewed summaries, and independently
  on the admin app to permit paid draft generation. Public reads need neither
  model credentials nor the service-role key. Review the data-processing/privacy
  notice before sending approved notes to the model provider.
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

### 5. Private administrator website

Run `npm run dev:admin` separately from the community website. Its local URL
is http://localhost:3003. Only the sign-in screen is public; private pages
redirect before rendering without approved administrator access.

Copy `apps/admin/.env.example` to `apps/admin/.env.local` and configure that
app's backend independently. Set `ADMIN_ALLOWED_USER_IDS` to **exactly two
distinct, confirmed Supabase user UUIDs**, and `ADMIN_SITE_URL` to its exact
origin (HTTPS in deployment; loopback HTTP is allowed locally). Both profiles
must also have `is_admin = true` and `is_banned = false`, assigned through
trusted database administration. No public registration can grant access.
Never commit these IDs or credentials, or use `NEXT_PUBLIC_` for the allowlist.

The dedicated sign-in uses existing email/password accounts and an HttpOnly,
host-only session cookie, not the community website's browser session.
Sessions last at most one hour. Missing/malformed configuration denies all
access, even in development; there is **no local admin preview**. The real
backend and the two approved accounts have not been configured here.

On the admin origin only, `/admin` contains counts and moderation,
`/admin/moderation` the dedicated review queue, and `/admin/summaries`
summary review. None of these paths or APIs is served by the public app.

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

### 6. Optional nearby-area summaries

`/admin/summaries` on the separate admin website is the review workspace for one-sentence summaries of
approved notes within **500 metres** of a selected reported spot. This does
not change the **100 m map circles** or weighted risk scores. It is a
radius query, not a chain that joins distant neighbouring areas.

An admin requests a GPT-5 mini draft, reviews/edits it, then explicitly
approves publication. Opening a location on the public map only reads an
approved fresh cache entry; changes to its source reports invalidate that
entry. Summaries attribute information to reports rather than asserting a
parking restriction or allegation as fact.

Generation includes the complete selected source set or fails explicitly;
it never silently selects only the newest notes. The current single-pass
resource guard is 200 notes / 48,000 UTF-8 source bytes. Larger clusters need
a future bounded batch-summarisation workflow. Local preview notes/photos
are not sent to a model. No live inference has been performed in this
session, and no model account or API key has been configured.

### 7. Community feedback on approved notes

Agreed / Disagreed counts are public. A confirmed account can have one vote
per approved note: tap the selected choice to remove it, or the other choice
to switch. Voter identities and the viewer's selection are never public.

Votes are feedback only, not proof that a report is true. They do not change
risk scores, report counts, evidence weights or the source set for summaries.
Removed, unreviewed and rejected notes cannot receive new feedback.
Per-account uniqueness is not an anti-bot or anti-brigading guarantee.

## Scripts
```bash
npm run dev     # start dev server
npm run dev:admin # separate admin server on port 3003
npm run build   # production build
npm run build:admin # independent admin production build
npm run build:all # build both applications
npm run start   # run a production build
npm run start:admin # run the admin production build
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

Playwright starts an isolated admin test server on loopback port 3016 with
a local mock identity/database transport. The real page and API guards run;
this fixture is never part of either deployed app. Stop the admin dev server
before running these tests, because both use the admin project's development
build directory. The community preview can stay running on port 3001.

## Deploying
**Azure deployment is not approved or performed.** The current recommendation
is separate public/admin Container Apps Consumption deployments plus private Azure Blob, retaining Supabase
Free for data/auth. Blob integration is not implemented yet; the current
storage adapter still uses Supabase Storage. See the architecture handoff
above before creating resources. Shared Azure allowances mean this is not
a promise of free hosting.

Any Next.js-compatible host can run the app.
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
