# Admin dashboard: steps 1 and 2

## Routes and ownership

- `/admin`: minimal, responsive overview and the existing moderation queue.
- `/admin/moderation`: dedicated review workspace; both pages have Overview,
  Moderation queue and Back to map links, and inherit `noindex, nofollow,
  noarchive` metadata from the admin layout.
- `GET /api/admin/overview`: `requireAdmin` runs before any count query.
  Responses are `private, no-store` and vary by Authorization. Missing/non-admin
  access returns 403; configuration/database failures return 500, never
  success-shaped zero counts. No service-role client enters browser code.

UI/server code lives in `src/modules/admin`; new styles are CSS modules.
The site's footer links to `/admin`. Shared global styling stays separate
from the dashboard's CSS modules.

## Counts and configuration

The service-role client performs exact, head-only counts:

| Field | Meaning |
| --- | --- |
| `pending` | Pending reports not soft-removed |
| `published` | Published reports not soft-removed |
| `rejected` | All rejected reports, including soft removals |
| `totalReports` | All report records, including soft removals |
| `totalUsers` | All `profiles` records, not active users or sessions |

Counts are separate concurrent queries, not a transactional snapshot; changes
during a refresh can briefly make totals differ. These are operational totals,
not analytics.

Live configuration uses existing `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and server-only `SUPABASE_SERVICE_ROLE_KEY`.
Apply migrations 0001 and 0002, retain the private `report-images` bucket,
and manually grant `profiles.is_admin` to trusted operators. Sign in using a
confirmed Supabase account. There is no self-service admin grant.

Unauthenticated live pages expose only the shell and sign-in guidance.
The dashboard loads its queue only after the overview API authorizes access.
Auth changes clear private UI state. API authorization remains authoritative;
there is no preview bypass on any endpoint.

## Review safety

The reused queue supports note editing, explicit review confirmation,
approval/rejection, reload, error feedback and decision announcements. Editing
resets confirmation; failed saves retain wording. Dashboard counts refresh
after a successful decision. Rejection now targets pending, non-removed
reports, matching approval's existing stale-decision guard.

Private photo URLs last 10 minutes and are displayed directly, not through
Next's public image optimizer. Signing/missing-path failures return explicit
per-report `hasImage`/`imageError` state; they do not masquerade as no photo.
Browser load failure, expiration or a 15-second loading timeout blocks
confirmation and approval. Reload refreshes links and discards unsaved edits.
The repository also refuses approval when evidence has no path or signing
fails. Full-size viewing uses a private link with no referrer. Never share it.

No image-redaction tool exists: reject evidence requiring redaction. Human
confirmation is still required; the system cannot prove a person examined an
image. Public report endpoints and existing public reports are unchanged.

## Read-only local preview

Only the server's `development && !isSupabaseConfigured` condition enables
the dashboard preview. It reads the existing `clamp-local-preview-v1` browser
storage through its validator, without creating or changing reports. There
are no fabricated incidents, admin mutations, account totals or image
thumbnails. All local reports are labelled simulated approval; pending and
rejected counts are zero because this storage has no moderation workflow.
User profiles are `N/A`. Photo files were not retained during entry, which is
explained explicitly. Empty, invalid and inaccessible storage states are
distinct. Production ignores this storage and query-string preview flags.
The dedicated moderation route always uses protected live APIs.

## Verification and limits

With the existing development server on port 3001:

```powershell
npx playwright test 'admin.*\.spec\.ts' --reporter=line
```

Server tests execute actual route/repository modules with external
auth/database/storage dependencies mocked: admin/non-admin gating, exact
count semantics, missing/error counts, signing failures and the production
preview policy matrix. Browser tests cover real unauthenticated API rejection,
local storage data, corruption/empty states, noindex, 375px overflow, keyboard
confirmation/editing, approve/reject payloads, and private-image failure/retry.
Test incidents and photos exist only in test fixtures and route mocks.

Development run: 12 passed, 2 production-only checks skipped. Scoped ESLint
and source/test TypeScript checking passed. Full `tsc --noEmit` encountered
conflicting existing `.next/types` and current `.next/dev/types` layout
declarations (`/admin` versus `/`). Generated files were not rewritten while
the parent was using the preview. Regenerate route types during integration
before the final full-project typecheck.

Production browser checks are included but require an already-running
production server: set `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_PRODUCTION=true`.
They cover preview suppression, live overview counts, post-review refresh and
overview failure without zero fallbacks. No production build was run here
because the parent owns the current preview process. Live Supabase auth,
Storage/RLS and real moderator decisions still need deployment verification.

Step 1 adds no account banning, user management, audit log, pagination or image
redaction. The existing pending queue fetches all pending reports; pagination
is a later scaling task.

## Step 2: optional aggregate traffic

Apply `supabase/migrations/0003_aggregate_traffic.sql`. It creates only
`traffic_daily(day, route, viewport, pageviews)` and the `increment_traffic`
RPC, not a raw event log. The primary key is UTC date + route + viewport.
The RPC uses an atomic `INSERT ... ON CONFLICT DO UPDATE` increment. RLS is
enabled; anon/authenticated roles have no table or RPC access. Only the
service role can execute the write function or read aggregate rows; even
that role has no direct table-write grant. The security-definer function has
an empty search path and fully qualified table references.

Collection requires **all** of:

- `ENABLE_TRAFFIC_ANALYTICS=true` (existing server-only flag, default false).
- Production runtime (`NODE_ENV=production`).
- Supabase URL, anon key and service-role key configured.
- `VERCEL_ENV` absent for self-hosting, or exactly `production`. Vercel
  preview/development and unknown deployment values remain disabled.

The root layout mounts the tracker once:

```tsx
import { TrafficTracker } from "@/modules/analytics/components/TrafficTracker";

// Inside <body>; no props.
<TrafficTracker />
```

This is a server component and calls Next's `connection()` so the enabled
decision is made at request time, not frozen during static prerendering.
Mounting it opts the containing route into dynamic rendering. The client
tracker is not rendered when collection is disabled. Layout, HomeClient,
environment files and manifests were not edited by this increment.

### Collection contract and privacy

`POST /api/analytics/pageview` accepts exactly:

```json
{ "route": "/", "viewport": "mobile" }
```

Routes are `/` and `/appeal` only. Viewport classes match the existing CSS
breakpoints: mobile <=760px, tablet <=1000px, otherwise desktop. These are
viewport sizes, **not** detected device types.

The client sends only those two enums after a committed pathname change;
Next prefetch, renders, resize events, query-only changes and hash changes
are not counted. A memory-only previous-route ref avoids duplicate effect
replays; it is not a visitor identifier. There are no cookies, localStorage,
sessionStorage, UUIDs, auth tokens, referrers, raw dimensions, user-agent
parsing, full URLs, searches, coordinates, email, report text or photos in
the event. Fetch is same-origin with `credentials: "omit"`,
`referrerPolicy: "no-referrer"`, `keepalive: true` and no redirects. An
8-second abort bounds waiting; failures are reported generically and not
retried because the server may already have counted the request.

The API enforces the exact enum-only schema, a 256-byte streaming body
limit (not merely Content-Length), JSON content type, matching Origin and
same-origin Fetch Metadata when present. The Origin is compared with the
server-visible request origin; reverse proxies must preserve the public
host/scheme. Invalid requests never reach the RPC. Disabled collection
returns `{ "enabled": false, "reason": "Analytics not enabled" }` before
parsing or accessing the database. Storage failures are non-2xx, not fake
success. The application does not read or store IP/referrer/identity headers
and does not log request bodies or underlying errors.

HTTP transport necessarily exposes connection metadata to the hosting
infrastructure. **The owner must review notices, any consent requirements,
host/access logs and retention before opting in. Cookie-free is not a
compliance guarantee.** Same-origin validation is not bot authentication:
bots and forged direct requests can inflate totals. Reloads also count;
blockers, failed delivery and disabled JavaScript undercount. No unique
visitor, unique device, person or billing-grade claims are made.

### Admin read and retention

`GET /api/admin/traffic` requires `requireAdmin` even when analytics is off.
It returns a clear disabled result without aggregate reads when not enabled.
Enabled reads are fixed to UTC today plus the preceding 29 days (maximum
180 aggregate rows); callers cannot extend the window with query parameters.
Responses are `private, no-store`, vary by Authorization, and contain only
the total pageviews, mobile-sized subset and recorded daily totals.
An empty enabled database legitimately returns zero; disabled/error states
never manufacture counts.

The dashboard adds **Pageviews (approximate)** with totals and an accessible
daily table, a refresh action and explicit error/disabled states. The local
dashboard preview shows setup/privacy guidance only, without any traffic
request or invented traffic data.

Rows **older than 90 UTC days** are pruned inside the next successful
increment. This is prune-on-next-traffic, **not an unattended retention
schedule**: if traffic stops or collection is disabled, old rows remain until
the next increment or an operator's separate cleanup. No scheduled job is
included.

### Step 2 checks

```powershell
npx playwright test 'traffic.*\.spec\.ts' --reporter=line
```

The suite executes the standalone migration in PGlite with minimal roles,
checking ACL/RLS, service-only RPC, UTC aggregation, repeated increments and
pruning boundaries. It executes actual route/repository modules with mocked
dependencies to test opt-in policy combinations, body/origin/schema
rejection before writes, auth boundaries, bounded reads and failure states.
Tracker tests check the payload/fetch privacy options, CSS categories,
committed-route effects and duplicate suppression. A 375px rendering check
uses the real traffic panel markup/CSS with fixture state. Browser tests
check the actual disabled API, protected admin endpoint and local dashboard.
The enabled live-dashboard request/refresh test requires an existing
production server (`PLAYWRIGHT_PRODUCTION=true`); no build or live Supabase
configuration is created by these tests.

Step 2 result: 10 tests passed, 1 production-only check skipped. Combined
admin + traffic regression run: 22 passed, 3 production-only checks skipped.
Scoped lint and source/test typechecking passed; the same generated-route
declaration conflict noted in Step 1 still blocks the unfiltered full
typecheck. No build, live migration, package addition or Git operation was
performed for this increment.

## Integrated status

The parent mounted `TrafficTracker` in the root layout and verified the
dashboard at phone and desktop sizes. Integrated admin/traffic/map checks
passed (28 passed, 4 production-only checks skipped). A complete production
build and its full TypeScript check passed, resolving the temporary generated
route-type conflict described in the earlier increment notes. No generated
type files were hand-edited. Live Supabase and enabled collection still need
owner configuration and deployment verification.
