# Minimal community map: UI and implementation handoff

## Direction

The owner asked for a minimal community website, usable streets, and local
report testing without sign-in. UI/UX Pro Max was consulted locally:
`public service dashboard minimal` returned the "Accessible & Ethical"
direction (high-contrast navy/blue, light surfaces, visible focus, no ornate
effects). The first generic community query suggested a marketing carousel
and dark theme; those did not fit the product and were not adopted.

- Keep the street map the main interactive surface. The desktop sidebar
  lists reports; on phones the map comes before that sidebar.
- Light-only for now, deliberately consistent even under OS dark mode.
  Add a complete dark palette before enabling automatic dark mode.
- Semantic tokens in `src/app/globals.css`: navy `#152438`, action blue
  `#0369a1`, muted text `#526174`, light canvas `#f8fafc`, white surfaces.
- Reuse the existing self-hosted Geist font via Next, rather than adding
  font requests. Use the shared outlined SVG `Icon` component, not emoji.
- One primary "Add a report" action, descriptive labels, 44px primary
  targets, focus rings, reduced-motion support, no invented testimonials.
- Signal is not a probability or a safety guarantee. Empty counts are not
  evidence of safe parking. Do not invent sample community incidents.
- Donations are an inactive placeholder until a real URL is configured.

## Blank-map root cause and repair

In a real Edge browser, MapLibre's worker URL was `http://localhost:3001/`.
It received HTML, not a JavaScript module. The map's background could draw
but vector tiles were never decoded. Changing zoom or clearing `.next`
could not fix this.

MapLibre 6 needs **both** `maplibre-gl-worker.mjs` and
`maplibre-gl-shared.mjs`. The npm `predev`/`prebuild` hooks copy the installed
version to `public/vendor/maplibre/<version>/`. `MapView` calls
`setWorkerUrl` before constructing a map. This avoids CDN version drift,
preserves the worker's relative import, and works in production.

Generated assets are git/ESLint-ignored. Use the npm scripts, not a bare
`next build` on a clean checkout, or explicitly run the preparation script.
After upgrading MapLibre, verify its worker dependency layout again.

The renderer also needs an explicitly sized container.
`.map-view .map-canvas` must beat the library's `.maplibregl-map` positioning
rule; otherwise a zero-height clipping container can hide a loaded map.

The UI now shows a loading card, an actionable error and Retry on failures,
and a 15-second timeout for silent worker/network stalls. Geolocation errors
are separate from tile errors. The city picker is a shortcut; arbitrary
locations remain accessible by pan/zoom or explicit town/street search.

## Local preview boundaries

Enabled only by the server when `NODE_ENV === "development"` **and**
Supabase public configuration is absent. No toggle or query parameter can
bypass backend authentication. Production never offers preview posting.

`src/modules/reports/lib/previewReports.ts` stores anonymous test entries
under `clamp-local-preview-v1` in localStorage. It validates loaded data,
exposes a Reset action, and reuses the scoring math. Descriptions and optional
incident dates are saved locally; files are discarded, not uploaded.
Coordinates are grouped at four
decimal places for this simulation; production still uses PostGIS proximity.
Photo evidence weight in preview is illustrative, not a real moderation
approval. All preview pins, popups, and the page banner identify this mode.

Existing public API endpoints remain authenticated for writes. The map can
always be browsed without an account.

## Streets, search, circles and notes

- OpenFreeMap **Bright** is the default, with clearer coloured roads/land
  uses. Positron remains an environment-configured alternative.
- `/api/places` proxies explicit-submit Photon search with an Ireland
  bounding box and IE/Northern Ireland filtering. Naas is also a shortcut.
  No per-keystroke traffic; upstream results cache for 24 hours. The public
  service is low-volume/no-SLA, not guaranteed complete address coverage.
  Do not send notes or photos to the geocoder.
- `reportZones.ts` builds 64-segment geodesic 100 m circles; fill alpha is
  exactly 0.5 and labels render above them. Colours use existing weighted
  scores. This is not new clustering; circles can overlap.
- Pin "View notes", zone taps and sidebar cards open a native dialog. Public
  reads return latest 50 human-reviewed notes, source category and date,
  never author IDs/raw text/private images. Notes render as text, not HTML.
- All real submissions are pending. The moderator edits wording and confirms
  review. Migration 0002 is mandatory; it also requeues legacy unreviewed
  published entries. See the data-model handoff before configuring Supabase.

## Mobile-first behavior

The map/search precede the sidebar and statistics on phones. Controls are
touch-sized, input/select fonts avoid iOS focus zoom, and dialog height uses
`dvh` with internal scrolling. Viewport metadata supports keyboard resizing
where the browser implements it; zoom is not disabled. Safe-area padding
keeps content away from device cutouts. On coarse-pointer devices MapLibre
cooperative gestures allow one-finger page scrolling and two-finger map pan.

`tests/mobile.spec.ts` runs search, report entry, long note text, persistence,
pin taps and zone controls at 320/375/390/430px with touch emulation. It also
checks landscape and a 360px-tall form viewport. This is Chromium emulation,
not physical iOS/Android keyboard or Safari verification; those remain
pre-launch checks.

## Accounts

Email/password replaces magic links per the owner's updated request.
Supabase must have **Confirm email** enabled; confirmation is once at
registration, not a second factor at each login. API user resolution checks
the verified `email_confirmed_at` value from Supabase.

Optional Google OAuth uses `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`. Configure
Google credentials and callback in Supabase, not in client code. This is
not the Gmail API. No live project/provider credentials were available in
this session; real registration, email delivery and OAuth need follow-up.
Password recovery and all launch safeguards in the roadmap remain open.

## Browser verification

Start the development server on port 3001, then run `npm run test:e2e`.
Windows uses installed Edge; other platforms use Playwright Chromium.
Override `PLAYWRIGHT_CHANNEL` if needed.

The suite checks real vector-tile responses, the worker URL/MIME, visible
canvas dimensions and pixel variation (not merely a 200 page response),
preview persistence and no backend writes, mouse/keyboard popups, dialog
focus/Escape, 375px/768px/landscape layouts, failure/retry, city navigation,
geolocation, search, clickable notes/zones, geometry/opacity, mobile touch,
and unauthenticated API rejection. Screenshots and traces go to ignored
`test-results/`. Network access to OpenFreeMap and Photon is required.
PGlite executes the actual second migration against a minimal schema to
check public/private access rules, not full PostGIS/Auth/Storage integration.

For production:

```powershell
npm run build
npm run start -- --port 3002
# In another terminal:
$env:PLAYWRIGHT_BASE_URL = "http://localhost:3002"
$env:PLAYWRIGHT_PRODUCTION = "true"
npm run test:e2e
```

That mode excludes local-preview checks and instead verifies that production
cannot submit without signing in. Tests do not prove live Supabase auth or
moderation; do not present them as end-to-end backend verification.
