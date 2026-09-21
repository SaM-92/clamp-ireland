# Roadmap / Phased Backlog (v2 — updated after initial implementation)

Depends on: 00-product-plan.md, 01-architecture.md, 02-data-model.md,
03-scoring-algorithm.md, 04-legal-considerations.md.
This is the hand-off backlog for whichever agent/session picks up work
next. Keep this file updated as phases complete — do not let progress live
only in chat history.

## Phase 0 — Repo & environment scaffolding
- [x] Next.js + TypeScript scaffold (App Router, `src/` dir, Tailwind)
- [x] Module-based structure under `src/modules/*`
- [x] Base `.env.example` documenting every required secret
- [x] `supabase/migrations/0001_init.sql` — full schema, RLS, RPC
- [ ] Create GitHub repo under SaM-92 and push (not yet done)
- [ ] Supabase project actually created (dev) — migration has not been run
      against a real project yet
- [ ] PWA plugin wired in (manifest.json placeholder exists, no icons/SW yet)
- [ ] Vercel project linked, deploys on push to main

## Phase 1 — Core map + auth (MVP walking skeleton)
- [x] Email magic-link sign-in via Supabase Auth (`src/modules/auth`)
- [x] Map view (MapLibre GL) centered on Ireland (`src/modules/map`)
- [x] Drop a pin -> `find_or_create_location` RPC (server-side only, per RLS)
- [x] Submit a report with/without image (reporter_type selector, description)
- [x] Risk-level colour-coded pins driven by the real scoring engine
- [ ] Manual smoke test against a **live** Supabase project (only tested
      against the graceful "not configured" fallback so far)

## Phase 2 — Evidence & scoring
- [x] Image upload flow (Supabase Storage, private `report-images` bucket)
- [x] **Human-in-the-loop image review queue** — every report with an image
      starts `moderation_status = 'pending'`; admin approves/rejects via
      `src/modules/moderation` before it's ever public
- [x] **AI text-softening pass** for report descriptions — interface at
      `src/modules/reports/server/textSoftening.ts`; currently a heuristic
      fallback (de-shouts, trims exclamation spam); real model call behind
      `OPENAI_API_KEY` is a stubbed TODO, not yet implemented
- [x] Scoring engine implemented per `03-scoring-algorithm.md`
- [x] Public aggregate dashboard: "transparency signal" counters
      (`src/modules/dashboard`) — total reports, this month, high-risk
      locations, total locations
- [ ] Server-side auto-blur pass (license plates/faces) as an assist before
      human review — see `04-legal-considerations.md` §4 (GDPR) — **not
      implemented yet**; human reviewer currently has no tooling to redact,
      only approve/reject
- [ ] Scheduled recompute of risk_score (currently only recomputes on
      moderation-status change, see `03-scoring-algorithm.md` §6)
- [ ] Wire up the real AI call in `textSoftening.ts` (currently heuristic-only)

## Phase 3 — Anti-abuse & legal-required features (not started)
- [ ] Cloudflare Turnstile on signup + report submission
- [ ] Per-account/IP rate limiting
- [ ] Anti-brigading cap in the scoring engine (see `03-scoring-algorithm.md` §7)
- [ ] Real notice-and-action flow (flag button + admin queue UI, published
      contact email, statement-of-reasons/appeal) — see
      `04-legal-considerations.md` §3 (DSA)
- [ ] Privacy Policy + Terms of Service pages published
- [ ] Account deletion / right-to-erasure flow
- [ ] Disclaimer banner on every location detail page
- [ ] "How to appeal a clamp" info page linking to the official NTA
      two-stage appeals process — see `04-legal-considerations.md` §1

## Phase 4 — Polish & community growth (not started)
- [x] "Support this project" donation link (`src/modules/donations`) —
      placeholder URL, swap in a real Buy Me a Coffee / Ko-fi link before
      launch
- [ ] Installable PWA (manifest, icons, offline shell)
- [ ] Share-a-location link (for warning friends before they park)
- [ ] Basic analytics (privacy-respecting, e.g. Plausible free/self-host or none)

## Naming
Working name "ClampWatch" / "Clamp Transparency Signal" — repo is currently
named `clamp-ireland` locally. Confirm final public name/domain before
Phase 0's GitHub repo creation.

## Explicitly out of scope for MVP (revisit later if community grows)
- Native mobile apps
- Payment processing infra beyond a static donation link
- Structured, scored "company reputation" entity (legal risk — see product plan)
