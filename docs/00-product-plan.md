# ClampWatch (working name) — "Clamp Transparency Signal" — Product Plan

Status: DRAFT v1 — agreed decisions baked in, implementation underway.
Owner: @SaM-92 (personal project)
Last updated: 2026-09-22

## 0. Positioning / framing
The product is deliberately framed as a **transparency signal**, not an
accusation tool: users report their own factual experience at a *location*
(never naming a company/individual within the app's own structured data);
the app aggregates these into a public-interest signal — e.g. a dashboard
count of "clamps reported this month/year" and a per-location report count.
This is the same legal/product category as Glassdoor (anonymous employer
reports), Reddit complaint threads, and Google Maps/Waze location-tagged
reports — see `04-legal-considerations.md` §5 for the full legal comparison.

## 1. Problem statement
In Ireland, private clamping/towing operators set traps (misleading/absent
signage, ambiguous private land boundaries) and clamp cars, charging release
fees. Victims have no shared, trustworthy way to know a location is high-risk
before parking. Goal: a community-reporting map so people can check a
location before parking and warn others after being clamped.

## 2. Decisions locked in with the user (2026-09-21)
| Topic | Decision |
|---|---|
| Naming clamping companies | **Location-only signal.** Public wording must avoid identifying or accusing people or companies. Moderators edit or reject unsuitable notes; no company reputation entities are scored. This reduces, not eliminates, legal risk. |
| Moderation (supersedes initial AI plan) | **All text and photos require human approval until real AI moderation is ready.** The existing heuristic is only an editing aid. Moderators edit public wording and explicitly confirm review; reject images needing redaction because blurring tooling is not implemented. Notice/flag/appeal flows remain backlog, not completed safeguards. |
| Platform | **Web app only**, mobile-friendly, installable **PWA**. No native app store cost/overhead for MVP. |
| Budget ceiling | **Up to ~$10/month.** Everything must run on free tiers first; the $10 is headroom (e.g. a paid geocoding tier or a domain name), not a starting cost. |
| Stack | Agent's choice, optimized for lowest cost + easiest solo maintenance: **Next.js + Postgres**, single free-tier host. |
| Sign-in (updated 2026-09-22) | Browse without an account; email/password with one-time email confirmation to contribute. Optional Google OAuth after provider setup. No app-imposed two-factor authentication. |
| Local preview | Development without Supabase has browser-local test reporting, visibly separated from public reports. Never bypass API authentication or enable this mode in production. |
| Visual design | Minimal light, map-first interface with street detail, neutral wording, compact counts, and accessible report entry. See `06-ui-handoff.md`. |
| Mobile priority | Most use is expected on phones. Search/map before report lists and statistics; touch targets, scrollable dialogs, 16px inputs, and two-finger map panning on touchscreens. |
| Map search | OpenFreeMap Bright streets; city shortcuts include Naas. Explicit-submit Photon search covers the island of Ireland subject to OSM indexing. No guarantee of every address. |
| Coloured areas | **100 m radius, 50% opacity, existing weighted score.** Green/amber/red per report location. Circles do not merge or create a new clustering algorithm. |
| Area summaries | **500 m radius around the selected spot**, explicitly chosen by the owner. One small model summarises approved notes into a short, cautiously attributed sentence. Generated drafts require admin approval and become stale when source notes change. This does not change the 100 m map circles or risk scores. |
| Note feedback | **Agreed / Disagreed**, one vote per confirmed account, public counts and private voter identities. Tap the selected choice to remove or the other to switch. Votes do not affect risk scores, report counts, evidence weighting or summary sources. Local preview simulates one browser voter. |
| Administration (updated 2026-09-22) | **Separate login-protected website**, not VPN-only. Only two explicitly approved accounts may access dashboard pages and administrative APIs. No admin routes/links on the community website and no unauthenticated admin preview. No Azure deployment is approved by this change. |

## 3. Users & contribution types (scoring intent)
Every report is tied to a map location (pin). Report **type** and **evidence**
both affect how much a single report moves that location's risk score.

| Reporter type | With photo | Without photo |
|---|---|---|
| Victim (was clamped here) | Highest weight | High weight |
| Neighbour / local resident | Medium-high weight | Medium weight |
| Witness (saw it happen to someone else) | Medium weight | Low weight |

Exact numeric weights, decay-over-time, and anti-brigading rules are in
`03-scoring-algorithm.md`, and are implemented in `src/modules/scoring/`.

## 4. Anti-bot / anti-abuse approach
- Email/password via Supabase Auth with email confirmation enabled, plus
  optional Google OAuth. This supersedes the original magic-link plan.
  Verification reduces casual abuse but does not prove a report is genuine.
- Cloudflare Turnstile (free, privacy-friendlier than reCAPTCHA) on
  signup/report submission — tracked as a roadmap item, not yet implemented.
- Per-account and per-IP rate limits on report submission — roadmap item.
- A flag/report/appeal flow remains required before launch. The implemented
  admin queue pre-approves all text and images.
- EXIF stripped from uploaded images server-side before storage — roadmap
  item, alongside the human-in-the-loop review queue that already gates
  every report today.

## 5. Legal / compliance notes (Ireland + GDPR — non-negotiable, must ship with MVP)
- Privacy Policy + Terms of Service required before public launch (GDPR).
- Disclaimer on every location page: content is user-submitted opinion, not a
  verified legal finding; app does not accuse any named business.
- Right-to-erasure flow: user can delete their own account + their reports.
- Data retention policy: define how long raw reports/images are kept.
- Takedown process: documented steps + contact email for disputed content.
- These are tracked as MVP-blocking backlog items in `05-roadmap.md`, not
  nice-to-haves.
- Full legal research (defamation, DSA, GDPR/license-plate photos, and how
  Ireland's existing Vehicle Clamping Act 2015 / NTA appeals process actually
  helps this project) is in `04-legal-considerations.md`. **This is
  informational, not legal advice** — a solicitor consult is recommended
  before public launch.

## 6. Monetization / sustainability
- No payment processing in MVP (avoids PCI/compliance overhead + cost).
- A "Buy Me a Coffee"-style donation link is included from day one
  (`src/modules/donations/`) — just a link, no payment code in this repo.

## 7. Open items for next planning pass
- Confirm expected search volume and provider fair-use before public launch
  (see `01-architecture.md`).
- Domain name choice (affects the $10/month headroom).
