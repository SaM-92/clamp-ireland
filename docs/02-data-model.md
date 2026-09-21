# Data Model (v1 draft)

Depends on: `00-product-plan.md`, `01-architecture.md`.
Target: Postgres (Supabase) + PostGIS extension.

## Tables

### `users` (managed mostly by Supabase Auth; this is the public profile extension)
| column | type | notes |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| display_name | text | optional, defaults to "Anonymous" style handle |
| created_at | timestamptz | |
| is_banned | boolean default false | admin takedown backstop |
| trust_score | int default 0 | increments with account age / non-flagged reports; used to lightly weight scoring later, not required for MVP v1 |

### `locations`
One row per distinct clamping "hotspot" pin. Multiple reports attach to one location.
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| geom | geography(Point, 4326) | PostGIS point, indexed with GIST |
| address_label | text nullable | reverse-geocoded label, best-effort, not authoritative |
| risk_score | numeric default 0 | cached/computed value, see scoring doc |
| risk_level | text | enum-like: 'low' \| 'medium' \| 'high', derived from risk_score |
| report_count | int default 0 | cached count |
| created_at | timestamptz | |
| updated_at | timestamptz | bumped whenever risk_score recomputed |

Index: `CREATE INDEX ON locations USING GIST (geom);`

### `reports`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| location_id | uuid FK -> locations | |
| user_id | uuid FK -> users | |
| reporter_type | text | 'victim' \| 'neighbour' \| 'witness' |
| has_image | boolean | derived from whether `image_url` is set |
| image_url | text nullable | Supabase Storage object path |
| description | text nullable | free text; disclaimer shown alongside any report that names a business |
| incident_date | date nullable | when the clamping/incident happened, user-supplied |
| created_at | timestamptz | |
| is_flagged | boolean default false | |
| is_removed | boolean default false | soft delete after moderation takedown |

### `flags`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| report_id | uuid FK -> reports | |
| flagged_by | uuid FK -> users | |
| reason | text | |
| created_at | timestamptz | |
| resolved | boolean default false | |

## Row Level Security (RLS) intent (enforced in Postgres, not just app code)
- `reports`: INSERT allowed for any authenticated, non-banned user (rate limit
  enforced at API layer, see below). UPDATE/DELETE allowed only where
  `user_id = auth.uid()`.
- `locations`: INSERT/UPDATE only via server-side service role (API route),
  never directly from the client, so risk_score can't be spoofed by a
  crafted client request.
- `flags`: INSERT allowed for any authenticated user; SELECT/UPDATE restricted
  to an `is_admin` role (a small hardcoded allowlist for MVP — no need for a
  full roles system yet).

## Rate limiting (not a DB table — enforced in the Next.js API route)
- Track submissions per `user_id` in a short-lived counter (e.g. Supabase
  Postgres function with a rolling window, or Vercel KV free tier) — cap at
  a small number of new reports per day per account (exact number is a
  product decision for the roadmap doc, suggest starting at 5/day).

## Follow-up doc needed
`03-scoring-algorithm.md` — exact point values per reporter_type x has_image,
time-decay curve, and the risk_score -> risk_level thresholds. Not written
yet; flagged as the next open item before implementation starts.
