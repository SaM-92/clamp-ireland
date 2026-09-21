# Architecture & Cost Plan (v1)

Depends on: `00-product-plan.md` (decisions locked in there).

## 1. Why not plain Google Maps / plain public OSM
- Google Maps API: free tier exists but requires a billing account + card on
  file, and costs scale with usage — user explicitly wants to avoid this.
- Public OSM tile servers (`tile.openstreetmap.org`) and the public Nominatim
  geocoder explicitly **forbid production/commercial use** and cap at ~1
  request/sec system-wide (not per-user) — see
  https://operations.osmfoundation.org/policies/tiles/ and
  .../policies/nominatim/. Fine for local dev, not for a live app.

## 2. Chosen stack (all free-tier at MVP scale)
| Layer | Choice | Free tier | Why |
|---|---|---|---|
| Frontend + API | **Next.js (App Router, TypeScript)** | Hosted on Vercel Hobby (free) | One codebase, API routes = no separate backend to host, huge community, PWA support via `next-pwa` |
| Hosting | **Vercel** (Hobby plan) | Free for personal/non-commercial-scale projects | Zero-config Next.js deploys, HTTPS, CDN included |
| Database + Auth + Storage | **Supabase** (free project) | 500MB DB, 1GB file storage, 50k monthly active auth users | Postgres (real SQL, PostGIS available for geo queries), built-in email magic-link auth, built-in image storage — one vendor covers 3 needs |
| Map rendering | **MapLibre GL JS** (open source, fork of Mapbox GL) | Free forever, no usage cap (client library only) | No lock-in; works with many tile providers |
| Map tiles | **MapTiler Cloud free tier** (100k tile loads/month) as primary, self-hosted **OpenFreeMap** (fully free, no signup) as backup/fallback | Free | MapTiler covers early growth with generous limits; OpenFreeMap (openfreemap.org) is a newer fully-free alternative if we outgrow it |
| Geocoding (address search / reverse geocode for pin drop) | **Photon** (open-source, komoot-hosted public instance) for light use; move to **LocationIQ free tier** (5,000 req/day) if we need an SLA | Free | Public Nominatim is off-limits per policy above; Photon's public instance has friendlier fair-use norms but same "be a good citizen" caveat — LocationIQ is the fallback with an actual documented free quota |
| Bot/abuse protection | **Cloudflare Turnstile** | Free, unlimited | Privacy-friendly captcha alternative |
| Domain (optional, inside the $10/mo headroom) | e.g. `.ie` or `.com` via Namecheap/Cloudflare Registrar | ~$1-15/yr amortized | Not required for MVP; Vercel gives a free `*.vercel.app` subdomain |

**Total recurring cost at MVP scale: $0/month.** The $10/month budget is
headroom for: a custom domain, or upgrading MapTiler/LocationIQ if usage
grows past free-tier limits.

## 3. High-level architecture
```
Browser (PWA)
   │  MapLibre GL (renders tiles from MapTiler/OpenFreeMap)
   │  fetch() to Next.js API routes
   ▼
Next.js app (Vercel)
   │  Server-side: image EXIF stripping, rate limiting, Turnstile verify
   ▼
Supabase (Postgres + PostGIS, Auth, Storage)
   │  locations, reports, users, flags tables
   │  Row Level Security enforces: users can only edit/delete their own reports
```

## 4. Key non-functional decisions
- **PostGIS** extension (free, built into Supabase) for geo queries — e.g.
  "find/cluster all pins within X meters" — instead of naive lat/lng math.
- **Row Level Security (RLS)** in Postgres as the primary authorization
  mechanism (not just app-level checks) — safer default, and free.
- Images resized/compressed client-side before upload to stay inside the 1GB
  free storage tier as long as possible.
- Risk score is **computed and cached** on the location row (not recalculated
  per page view) — a scheduled Supabase Edge Function (free tier includes a
  generous invocation quota) recomputes with time-decay periodically.

## 5. Local dev
- `supabase` CLI can spin up the whole backend (Postgres + Auth + Storage)
  locally in Docker for free, so no cloud cost during development.

## 6. Risks / things to revisit if usage grows
- MapTiler free tier (100k tile loads/mo) — monitor via their dashboard;
  OpenFreeMap is the no-cost fallback if exceeded.
- Supabase free project pauses after 1 week of total inactivity (auto-resumes
  on next request, ~a few seconds cold start) — acceptable for a
  community project, worth noting so a future agent doesn't mistake it for
  an outage.
- LocationIQ 5,000 req/day is per-app, not per-user — needs basic caching of
  repeat address lookups if the community grows.
