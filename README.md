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
2. In the SQL Editor, run the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   This creates all tables, enables PostGIS, sets up Row Level Security, and
   creates the `find_or_create_location` RPC. (Alternatively, if you have the
   [Supabase CLI](https://supabase.com/docs/guides/cli) linked to the
   project, `supabase db push` applies the same migration.)
3. In **Storage**, create a new bucket named `report-images` and set it to
   **private** (not public) — signed URLs are generated server-side only for
   published reports; see `docs/00-product-plan.md` and the moderation
   pipeline in `src/modules/reports/server/repository.ts`.
4. In **Authentication → Providers**, confirm Email is enabled and set to
   magic-link / OTP (default). No password provider is used.
5. Copy your Project URL, `anon` public key, and `service_role` secret key
   from **Project Settings → API**.

### 3. Configure environment variables
```bash
cp .env.example .env.local
```
Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase project above. The
  service-role key is server-only and must never be exposed to the browser
  or committed.
- `NEXT_PUBLIC_MAP_TILE_STYLE_URL` — defaults to the free, no-signup
  [OpenFreeMap](https://openfreemap.org) style; swap for a MapTiler style
  URL if you need higher volume (see `docs/01-architecture.md`).
- `NEXT_PUBLIC_DONATION_URL` — your real Buy Me a Coffee / Ko-fi / GitHub
  Sponsors link (a placeholder is provided).
- `OPENAI_API_KEY` — optional. Without it, report text goes through a
  heuristic softener instead of an AI rephrasing pass (see
  `src/modules/reports/server/textSoftening.ts`).

The app also runs, and `npm run build` succeeds, without any of the above
set — every server-rendered page and API route degrades gracefully to
empty/zero data so you can develop the UI before a backend exists. Actually
submitting a report or reading the moderation queue does require a real
Supabase project.

### 4. Run it
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

### 5. Becoming an admin (to see the moderation queue)
A `profiles` row is created automatically for every new user (see the
`on_auth_user_created` trigger in the migration). The admin gate
(`src/modules/auth/lib/requireAdmin.ts`) checks that row's `is_admin` flag.
There's no self-service admin signup by design — after signing in once, set
`is_admin = true` for your user directly in the Supabase Table Editor/SQL
Editor.

## Scripts
```bash
npm run dev     # start dev server
npm run build   # production build
npm run start   # run a production build
npm run lint    # ESLint
```

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
