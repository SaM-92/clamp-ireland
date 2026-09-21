# ClampWatch (working name) — "Clamp Transparency Signal" — Product Plan

Status: DRAFT v1 — agreed decisions baked in, implementation underway.
Owner: @SaM-92 (personal project)
Last updated: 2026-09-21

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
| Naming clamping companies | **Location-only risk score.** The app itself never asserts a named company is guilty. Company names may appear only inside free-text user descriptions (as user speech, with a disclaimer), not as a structured/scored entity. Lowest defamation exposure. |
| Moderation (updated 2026-09-21) | **Images:** human-in-the-loop review before publish — a moderator confirms relevance and blurs/redacts faces/plates. **Text:** AI rephrasing pass that softens angry tone and strips stray names, preserving the facts (time/location/what happened); the rephrased version is what's published. See `04-legal-considerations.md` §6 for full rationale. Abuse/flag button + admin takedown still exists as a backstop for anything that slips through. |
| Platform | **Web app only**, mobile-friendly, installable **PWA**. No native app store cost/overhead for MVP. |
| Budget ceiling | **Up to ~$10/month.** Everything must run on free tiers first; the $10 is headroom (e.g. a paid geocoding tier or a domain name), not a starting cost. |
| Stack | Agent's choice, optimized for lowest cost + easiest solo maintenance: **Next.js + Postgres**, single free-tier host. |

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
- Email-only passwordless sign-in (magic link, via Supabase Auth) — no
  passwords to leak, cheap, filters out the laziest bots.
- Cloudflare Turnstile (free, privacy-friendlier than reCAPTCHA) on
  signup/report submission — tracked as a roadmap item, not yet implemented.
- Per-account and per-IP rate limits on report submission — roadmap item.
- Flag/report button on every pin + every report, feeding a lightweight
  admin queue (manual takedown only, not manual pre-approval of text).
- EXIF stripped from uploaded images server-side before storage — roadmap
  item, alongside the human-in-the-loop review queue that already gates
  every image today.

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
- Final pick between candidate map/geocoding providers, pending confirmation
  of expected monthly pin/search volume (see `01-architecture.md`).
- Domain name choice (affects the $10/month headroom).
