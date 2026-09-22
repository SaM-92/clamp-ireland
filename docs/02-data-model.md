# Data Model (reviewed public notes)

Depends on: `00-product-plan.md`, `01-architecture.md`.
Target: Postgres (Supabase) + PostGIS extension.

## Tables

### `profiles` (private profile extension of Supabase Auth)
| column | type | notes |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| display_name | text | optional, defaults to "Anonymous" style handle |
| created_at | timestamptz | |
| is_banned | boolean default false | admin takedown backstop |
| trust_score | int default 0 | increments with account age / non-flagged reports; used to lightly weight scoring later, not required for MVP v1 |
| is_admin | boolean default false | assigned only through trusted database administration, never by the account owner |

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
| user_id | uuid FK -> profiles | private account link |
| reporter_type | text | 'victim' \| 'neighbour' \| 'witness' |
| has_image | boolean | derived from whether `image_url` is set |
| image_url | text nullable | Supabase Storage object path |
| description | text nullable | draft initially; edited/reviewed public wording after approval |
| description_raw | text nullable | private original; never in public notes |
| incident_date | date nullable | when the clamping/incident happened, user-supplied |
| created_at | timestamptz | |
| is_flagged | boolean default false | |
| is_removed | boolean default false | soft delete after moderation takedown |
| moderation_status | text | pending, published, rejected; every submission starts pending |
| reviewed_at | timestamptz nullable | approval stamp required for publication/scoring |
| reviewed_by | uuid FK -> profiles nullable | private reviewer reference; set null if that profile is deleted |

### `flags`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| report_id | uuid FK -> reports | |
| flagged_by | uuid FK -> profiles | |
| reason | text | |
| created_at | timestamptz | |
| resolved | boolean default false | |

### `report_votes` (migration 0005)
| column | type | notes |
|---|---|---|
| report_id | uuid FK -> reports, ON DELETE CASCADE | first part of primary key |
| user_id | uuid FK -> profiles, ON DELETE CASCADE | private second part of primary key |
| vote | text | checked: agree or disagree |

The composite primary key enforces one current choice per account/report.
Service-only RPCs verify account confirmation and lock an eligible report
before setting, switching or removing a vote. Counts are derived, not mutable
increment counters. Vote writes do not update report or location rows, scores
or summary sources. Existing votes remain when a report is unpublished, but
their counts are hidden until it is republished.

## Public read surfaces
- `locations_public`: coordinates and cached aggregates. The app's location
  endpoint filters out rows with no approved reports.
- `reports_public`: only `id`, `location_id`, `reporter_type`, `description`,
  `incident_date`, `created_at`, `agree_count`, `disagree_count`, filtered to
  published + reviewed + nonremoved.
  No raw text, account/reviewer IDs, email, image path or signed URL.
- `/api/locations/[id]/reports`: UUID-validated, latest 50 reviewed notes at
  that location. Category, date and feedback counts are shown; author/voter
  identities are not.
- `/api/report-votes`: confirmed-account-only batched own selections (up to
  50 IDs), with private/no-store responses; never a public voter list.

## Row Level Security after migration 0002
- `reports`: authenticated authors can read their own raw records. Anonymous
  users cannot read raw records. No browser INSERT/UPDATE/DELETE policy;
  writes use authenticated Next.js endpoints and the server service role.
- `locations`: INSERT/UPDATE only via server-side service role (API route),
  never directly from the client, so risk_score can't be spoofed by a
  crafted client request. The `find_or_create_location` RPC is executable
  only by the service role.
- `profiles`: owners can read, but cannot update their own admin/banned flags.
- `flags`: INSERT allowed for any authenticated user; SELECT/UPDATE restricted
  by the profile's `is_admin` flag. The product notice/appeal UI is not built.
- `report_votes` (0005): no direct table access for anonymous, authenticated
  or service roles. Only the server role may execute its security-definer RPCs.

## Rate limiting (planned, not yet enforced)
- Plan: track submissions per `user_id` in a short-lived counter (e.g. Supabase
  Postgres function with a rolling window, or Vercel KV free tier) — cap at
  a small number of new reports per day per account (exact number is a
  product decision for the roadmap doc, suggest starting at 5/day).

## Migration and verification handoff
Apply `0001_init.sql` then `0002_reviewed_public_notes.sql`. The latter
requeues legacy published reports without a review stamp and resets location
aggregates. Subsequent human approvals rebuild counts and scores. Do not
re-run the migration to refresh scores.

`tests/public-notes-policy.spec.ts` executes migration 0002 on embedded
Postgres using a minimal predecessor schema. It checks anonymous reads,
private columns, review/removal gating, legacy requeue, RPC restrictions and
non-self-assignable admin roles. It does not exercise PostGIS or real
Supabase Auth/Storage. A live backend smoke test is still required.

Continue in numeric order through migrations 0003 (aggregate traffic), 0004
(reviewed area summaries) and 0005 (note feedback). Their details are in
handoffs 07, 11 and 12. Embedded PostgreSQL voting tests cover permissions,
safe counts, unique set/switch/remove behavior and deletion cascades; actual
multi-connection contention and live Supabase integration remain unverified.
