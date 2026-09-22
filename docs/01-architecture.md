# Architecture & Cost Plan (v1)

Depends on: `00-product-plan.md` (decisions locked in there).

## 1. Why not plain Google Maps / plain public OSM
- Google Maps API: free tier exists but requires a billing account + card on
  file, and costs scale with usage — user explicitly wants to avoid this.
- OSM data is open; OSMF-hosted services have separate usage policies, not
  a blanket production/commercial prohibition. Public raster tiles require
  attribution, caching, identification, and no bulk/offline downloads.
  Nominatim has a 1 request/second **per-app** ceiling and forbids
  autocomplete. We use neither endpoint in this implementation:
  https://operations.osmfoundation.org/policies/tiles/ and
  https://operations.osmfoundation.org/policies/nominatim/.

## 2. Chosen stack (all free-tier at MVP scale)
| Layer | Choice | Free tier | Why |
|---|---|---|---|
| Frontend + API | **Next.js (App Router, TypeScript)** | Hosted on Vercel Hobby (free) | One codebase, API routes = no separate backend to host, huge community, PWA support via `next-pwa` |
| Hosting | **Vercel** (Hobby plan) | Free for personal/non-commercial-scale projects | Zero-config Next.js deploys, HTTPS, CDN included |
| Database + Auth + Storage | **Supabase** (free project) | Check current quotas before launch | Postgres/PostGIS, email/password with one-time email confirmation, optional Google OAuth, private image storage |
| Map rendering | **MapLibre GL JS** (open source, fork of Mapbox GL) | Free forever, no usage cap (client library only) | No lock-in; works with many tile providers |
| Map tiles | Hosted **OpenFreeMap** Bright style | No API key | Configurable via `NEXT_PUBLIC_MAP_TILE_STYLE_URL`; attribution stays on the map. Positron is an optional quieter style. No provider is silently substituted. |
| Geocoding | Public **Photon** service, based on OSM | Reasonable low-volume use, no SLA | Explicit-submit search through `/api/places`, Ireland bounding box and IE/Northern Ireland filtering, 24-hour upstream caching, 8-second timeout. Not autocomplete. |
| Bot/abuse protection | **Cloudflare Turnstile** | Free, unlimited | Privacy-friendly captcha alternative |
| Domain (optional, inside the $10/mo headroom) | e.g. `.ie` or `.com` via Namecheap/Cloudflare Registrar | ~$1-15/yr amortized | Not required for MVP; Vercel gives a free `*.vercel.app` subdomain |

**Total recurring cost at MVP scale: $0/month.** The $10/month budget is
headroom for: a custom domain, or upgrading MapTiler/LocationIQ if usage
grows past free-tier limits.

## 3. High-level architecture
```
Browser (PWA)
   │  MapLibre GL (renders OpenFreeMap streets and 100 m report circles)
   │  fetch() to Next.js API routes
   ▼
Next.js app (Vercel)
   │  Server-side: authenticated submissions, protected human review,
   │  safe public notes, cached Photon search
   ▼
Supabase (Postgres + PostGIS, Auth, Storage)
   │  locations, reports, profiles, flags tables
   │  RLS + restricted views; writes pass through service-role API routes
```

## 4. Key non-functional decisions
- **PostGIS** extension (free, built into Supabase) for geo queries — e.g.
  "find/cluster all pins within X meters" — instead of naive lat/lng math.
- **Row Level Security (RLS)** in Postgres as the primary authorization
  mechanism (not just app-level checks) — safer default, and free.
- Image resizing, EXIF removal, rate limits and Turnstile remain planned;
  do not infer that the current upload endpoint provides these safeguards.
- Risk score is **computed and cached** on the location row (not recalculated
  per page view). Approval/rejection recomputes synchronously; scheduled
  refresh for time decay remains backlog.
- `reports_public` is a column-limited, security-barrier view, intentionally
  using owner access so anonymous users need no raw-table policy. Its
  predicate requires published, reviewed, nonremoved reports. Keep those
  filters and never add raw text, identity or image paths to the view.
- Display zones are geodesic 100 m polygons, filled at 0.5 opacity below
  map labels. Production location deduplication remains a separate 30 m
  PostGIS operation; overlapping circles are not merged.

## 5. Local dev
- `supabase` CLI can spin up the whole backend (Postgres + Auth + Storage)
  locally in Docker for free, so no cloud cost during development.
- No-backend development also supports explicitly labelled local preview
  reports. Only coordinates, type, evidence presence, and timestamps are
  persisted to browser storage, along with note text and optional incident
  date. No files or identity are persisted. Approval is simulated locally.
- MapLibre 6 ships a worker that imports a sibling shared ESM module.
  `scripts/prepare-map-assets.mjs` copies both version-matched assets before
  `npm run dev` and `npm run build`. `MapView` explicitly sets a same-origin
  worker URL; relying on bundled `import.meta.url` resolves to HTML, not JS.
  The library's CSS also requires a nonzero-height container. Keep
  `.map-view .map-canvas` sizing more specific than `.maplibregl-map`.
- See `06-ui-handoff.md` for the current UI, browser verification, and limits.

## 6. Risks / things to revisit if usage grows
- OpenFreeMap and public Photon availability are external dependencies.
  Photon may throttle/block heavy traffic; there is no distributed search
  rate limiter yet. Add one and consider a supported provider or self-hosting
  before scale. Terms: https://github.com/komoot/photon#public-demo-server .
- Search sends only the entered query to Photon, not report notes or photos.
  Its OSM index can omit or lag towns, streets, and addresses. City shortcuts,
  geolocation and manual pan/zoom still work when search fails.
- Confirm current Supabase quotas, inactivity-pause behavior and SMTP
  limits before launch; free-tier service is not an availability guarantee.
