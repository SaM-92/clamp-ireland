# Roadmap / Phased Backlog (v8 — private deployment preparation and bounded photos)

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
- [x] `0002_reviewed_public_notes.sql` — review gate, safe public notes view,
      legacy requeue, restricted role updates and location RPC execution
- [x] `0003_aggregate_traffic.sql` — service-only UTC daily pageview counters;
      opt-in collection, no visitor identity or raw event table
- [x] `0004_reviewed_area_summaries.sql` — complete 500 m approved-source
      snapshots, private drafts, review, freshness and generation admission
- [x] `0005_report_votes.sql` — unique confirmed-account feedback, private
      own selections, safe public counts and atomic set/switch/remove
- [x] `0006_content_policy.sql` prepared — checked usernames, direct-write
      restrictions and atomic per-account/global inference quotas
- [x] Create GitHub repo under SaM-92 (`clamp-ireland`; initial scaffold pushed)
- [ ] Supabase project actually created (dev) — migration has not been run
      against a real project yet
- [ ] PWA plugin wired in (manifest.json placeholder exists, no icons/SW yet)
- [x] Azure architecture consultation recorded in handoff 13
- [x] Owner approved a development-only deployment direction and photo limits
- [x] Azure Blob adapter, image normalization and initial infrastructure templates
- [ ] Revised all-endpoint IP-isolated backend/connectivity design: hosted Supabase
      HTTPS APIs cannot meet the newly required IP restriction; deployment is blocked

## Phase 1 — Core map + auth (MVP walking skeleton)
- [x] Email/password sign-in and one-time confirmation flow; optional Google
      OAuth button behind configuration (`src/modules/auth`). Supersedes
      magic links. Real email delivery/Google credentials not tested yet.
- [x] MapLibre street map, Dublin default, OpenFreeMap Bright, city shortcuts,
      user-triggered geolocation, visible error/retry state
- [x] Naas/city shortcuts and explicit-submit Photon town/street search,
      island-of-Ireland filtering, caching, no-results/error handling
- [x] Explicit version-matched worker/shared assets in dev and production
- [x] Development-only no-auth preview; browser-local pins/counts, reset,
      local note text with simulated approval, no backend writes or stored
      photo files; production remains authenticated
- [x] Drop a pin -> `find_or_create_location` RPC (server-side only, per RLS)
- [x] Submit a report with/without image (reporter_type selector, description)
- [x] Risk-level colour-coded pins driven by the real scoring engine
- [x] Clickable pins/areas with latest 50 reviewed notes; 100 m circles at
      50% opacity, weighted green/amber/red signal, show/hide toggle
- [ ] Manual smoke test against a **live** Supabase project (only tested
      against the graceful "not configured" fallback so far)

## Phase 2 — Evidence & scoring
- [x] Private Azure Blob upload/signing; JPEG/PNG/WebP/HEIC/HEIF up to
      50 MiB / 64 MP, metadata removal and at most 3 MiB processed WebP
- [x] Worker/body/time/concurrency bounds, explicit rollback cleanup and
      original HEIC fixtures; independently packaged public/admin runtimes
- [ ] Automatic orphan reconciliation, image erasure workflow and retention review
- [x] **Human-in-the-loop text and image review queue** — every report
      starts `moderation_status = 'pending'`; admin approves/rejects via
      `src/modules/moderation`, editing public text and confirming review
      before it counts or becomes public
- [x] **Heuristic editing aid**, not AI anonymisation — interface at
      `src/modules/reports/server/textSoftening.ts`; currently a heuristic
      fallback (de-shouts, trims exclamation spam); real model call behind
      `OPENAI_API_KEY` is a stubbed TODO, not yet implemented
- [x] Scoring engine implemented per `03-scoring-algorithm.md`
- [x] Public aggregate dashboard: "transparency signal" counters
      (`src/modules/dashboard`) — total reports, this month, high-risk
      locations, total locations
- [x] Admin-requested GPT-5 mini nearby summaries, one short attributed
      sentence, separate human approval and source-fresh public cache
- [x] Existing Azure GPT-5 mini reused through a shared bounded server provider;
      real synthetic local summary and allowed/blocked content calls verified
- [ ] Production inference identity, processing/privacy approval and broader
      model-quality evaluation (a few synthetic examples are not certification)
- [ ] Verify 499/500/501 m source boundaries against a real PostGIS instance
- [ ] Bounded batching for summary source sets beyond current 200-note/48KB limits
- [ ] Server-side auto-blur pass (license plates/faces) as an assist before
      human review — see `04-legal-considerations.md` §4 (GDPR) — **not
      implemented yet**; human reviewer currently has no tooling to redact,
      only approve/reject
- [ ] Scheduled recompute of risk_score (currently only recomputes on
      moderation-status change, see `03-scoring-algorithm.md` §6)
- [ ] Wire up the real AI call in `textSoftening.ts` (currently heuristic-only)

## Phase 3 — Anti-abuse & legal-required features (partly implemented)
- [x] Server-side report and username profanity/contextual AI policy checks,
      fail-closed errors, confirmation-before-inference and approval-before-write
- [x] Pseudonymous username onboarding, ignoring untrusted signup/OAuth names
- [x] Prepared database permissions prevent direct browser policy bypass;
      per-account/hour and global/day AI reservations bound costs across instances
- [ ] Cloudflare Turnstile on signup + report submission
- [ ] Broader IP/signup/upload limits beyond the implemented AI admission quota
- [ ] Anti-brigading cap in the scoring engine (see `03-scoring-algorithm.md` §8)
- [ ] Real notice-and-action flow (flag button + admin queue UI, published
      contact email, statement-of-reasons/appeal) — see
      `04-legal-considerations.md` §3 (DSA)
- [ ] Privacy Policy + Terms of Service pages published
- [ ] Account deletion / right-to-erasure flow
- [ ] Disclaimer banner on every location detail page
- [x] `/appeal`: official NTA-sourced two-stage appeal guidance, deadlines,
      private evidence checklist, complaints distinction and Republic-only scope

## Phase 4 — Polish & community growth (not started)
- [x] "Support this project" donation link (`src/modules/donations`) —
      placeholder URL, swap in a real Buy Me a Coffee / Ko-fi link before
      launch
- [x] Minimal light responsive map-first UI, keyboard report selection,
      focus-managed reporting dialog, SVG icons, compact counters and legend
- [x] Playwright coverage for actual street rendering, worker MIME/URL,
      local preview persistence, mobile/landscape layout, failed-map retry,
      city/geolocation controls, and unauthenticated-write rejection
- [x] Search, note persistence, safe text rendering, measured 100 m geometry
      and 0.5 opacity; embedded Postgres publication/access policy checks
- [x] Touch-phone workflows at 320/375/390/430px, landscape, reduced-height
      forms, map before list/stats, 16px fields and cooperative map gestures
- [x] Agreed / Disagreed below each approved note; confirmed-account voting,
      public counts, one-browser preview and Reset preview cleanup
- [ ] Physical iPhone Safari / Android Chrome checks, including native
      keyboard, photo picker, location permission and installed PWA behavior
- [ ] Password reset flow for live email/password accounts
- [ ] Installable PWA (manifest, icons, offline shell)
- [ ] Share-a-location link (for warning friends before they park)
- [x] Separate admin application/build; no community-site admin links or
      routes, server-side page/API allowlist for two confirmed admin accounts,
      private cookie sessions, no unauthenticated admin preview
- [x] Admin overview and review workspace; explicit photo failures block approval
- [ ] Configure both real approved administrator accounts and deploy the private site
- [x] Optional first-party aggregate pageviews in admin, disabled by default;
      privacy/consent and hosting-log review still required before activation
- [x] Technical SEO/AEO: canonical domain validation, sitemap, crawler rules,
      default noindex, alternate-host/private protections, server-rendered guide
- [x] Hosted support payment options researched; Stripe Payment Link recommended
- [ ] Real support checkout/account configured by the owner
- [ ] Public domain/deployment, launch approval, Search Console and indexing opt-in
- [ ] Admin account management, review audit history and queue pagination

## Phase 5 — Release engineering (preparation only)
- [x] Explicit unit/server, database-policy and release-contract test gates
- [x] Separate public/admin standalone container packaging and build metadata
- [x] GitHub PR/default-branch CI and manually dispatched release/deploy workflow
- [x] Semantic source tags, digest-pinned promotion and per-attempt version records
- [x] Production builds, isolated Linux containers and hosted GitHub CI verified;
      source baseline tagged `v0.1.0` (not a cloud deployment)
- [x] Classifier decisions use `approve`/`blocked` and fixed explanations;
      v2 summaries enforce 20 words/160 characters, with forward migration
      `0007_concise_area_summaries.sql` prepared but not applied
- [x] Separate development/production release selection and environment-aware records
- [x] Default closed registration, exact IP-rule promotion checks and hard
      deployment hold until all backend endpoints satisfy IP isolation
- [ ] Configure release/development/production environments, reviewer protection,
      Azure OIDC and an approved-network self-hosted deployment runner
- [ ] Provision/approve hosting, backend identities, private storage and domains
- [ ] Apply reviewed migrations after owner approval
- [ ] First actual Azure deployment and post-deployment smoke

## Naming
Working name "ClampWatch" / "Clamp Transparency Signal" — repo is currently
named `clamp-ireland` locally. Confirm final public name/domain before
public launch.

## Latest implementation handoff

Read `06-ui-handoff.md` before changing map assets, the design system,
preview gating, or account flows. Handoffs 07-10 cover the admin dashboard,
appeal guide, search eligibility and support-payment setup; handoff 11 covers
500 m summaries, handoff 12 covers feedback, and handoff 13 records the
Azure architecture recommendation (not deployment approval). The app remains
a prototype: these features do not complete the Phase 2/3 launch safeguards.
Handoff 14 supersedes earlier same-site admin and admin-preview instructions.
Handoffs 15-17 cover release automation, content-policy enforcement and the
live synthetic Azure demo. Handoff 18 supersedes the original Supabase Storage
and unrestricted-network deployment assumptions. All cloud deployment is
blocked pending the required all-endpoint IP isolation.

## Explicitly out of scope for MVP (revisit later if community grows)
- Native mobile apps
- Payment processing infra beyond a static donation link
- Structured, scored "company reputation" entity (legal risk — see product plan)
