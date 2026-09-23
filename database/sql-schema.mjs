// Azure SQL (T-SQL) translation of schema.mjs's SQLite DDL.
//
// Differences from the retired SQLite schema, and why:
// - No STRICT keyword: T-SQL columns are always statically typed.
// - IDs stay `nvarchar(36)` (app-generated UUIDs); no native uuid/identity column.
// - Every *_at/*_date column is `nvarchar(30)` holding an ISO-8601 UTC string
//   written by the application (`new Date().toISOString()`), never a SQL
//   default. This keeps the exact text format the app already parses/renders,
//   and avoids CONVERT() format-string tricks for a trailing "Z".
// - Epoch-millisecond columns (`sessions`/`oauth_attempts`/lease expiry) use
//   `bigint`, not `int`: current epoch-ms values already exceed int32 range.
// - `GLOB` patterns become `LIKE` with the same `[...]` character classes;
//   this only stays case-sensitive because the database uses a binary
//   (`Latin1_General_100_BIN2_UTF8`) collation - see infra/preflight/sql.bicep.
// - The `distance_m()`/`valid_summary()` SQLite scalar functions have no T-SQL
//   equivalent (no arbitrary server-side JS). Geodesic filtering moves to the
//   application layer (bounding-box prefilter in SQL, exact WGS84 distance in
//   JS via the same geographiclib-geodesic library - see sql-store.mjs). The
//   `valid_summary()` CHECK is dropped from the schema; every write path already
//   validates the sentence with the shared Zod `summaryOutputSchema` first, so
///  the DB constraint was defense-in-depth, not the sole enforcement.
// - The five SQLite staleness triggers (summaries_report_*/summaries_location_*)
//   have no T-SQL equivalent that can call geodesic distance math. They are
//   replaced by an explicit `invalidateNearbyAreaSummaries()` application
//   helper, called in the same transaction as the one write path that can
//   currently publish a report (report approval). See docs/20-azure-sql-migration.md.
// - `ON CONFLICT ... DO UPDATE` upserts become `MERGE ... WITH (HOLDLOCK)`
//   inside an explicit transaction, which is the standard SQL Server pattern
//   for atomic, race-free upserts.
// - `RETURNING` becomes T-SQL `OUTPUT inserted.col`/`OUTPUT deleted.col`.
//
// Migrations are additive SQL applied in order and tracked in
// dbo.schema_migrations, mirroring the SQLite `user_version` migration runner.
// A line containing only `GO` splits a migration into separate batches (the
// same convention sqlcmd/SSMS use); sql-store.mjs's migration runner splits on
// it before executing each batch. This is required wherever CREATE VIEW,
// CREATE PROCEDURE, CREATE TRIGGER or CREATE FUNCTION must be the sole
// statement in their batch - a real T-SQL restriction, not a stylistic choice.
export const migrations = [`
CREATE TABLE dbo.profiles (
  id nvarchar(36) NOT NULL PRIMARY KEY,
  google_subject nvarchar(255) NOT NULL,
  email nvarchar(254) NOT NULL,
  display_name nvarchar(24) NULL,
  username_policy_checked_at nvarchar(30) NULL,
  created_at nvarchar(30) NOT NULL,
  is_admin bit NOT NULL DEFAULT 0,
  is_banned bit NOT NULL DEFAULT 0,
  CONSTRAINT profiles_google_subject_unique UNIQUE (google_subject),
  CONSTRAINT profiles_username_shape CHECK (
    (display_name IS NULL AND username_policy_checked_at IS NULL) OR
    (display_name IS NOT NULL AND username_policy_checked_at IS NOT NULL
      AND LEN(display_name) BETWEEN 3 AND 24
      -- COLLATE ...BIN forces byte-for-byte comparison; the database's
      -- default collation is case-insensitive, which would otherwise let
      -- 'UPPER' or 'Name' satisfy an [a-z] pattern.
      AND display_name COLLATE Latin1_General_BIN NOT LIKE '%[^a-z0-9_]%'
      AND SUBSTRING(display_name,1,1) COLLATE Latin1_General_BIN LIKE '[a-z]')
  )
);
-- A plain UNIQUE constraint treats NULL as one value in SQL Server (unlike
-- SQLite, where every NULL is distinct), which would wrongly forbid more than
-- one profile without a username yet. A filtered unique index only enforces
-- uniqueness once a display_name is actually set.
CREATE UNIQUE INDEX profiles_display_name_unique ON dbo.profiles(display_name) WHERE display_name IS NOT NULL;
CREATE TABLE dbo.sessions (
  token_hash nvarchar(64) NOT NULL PRIMARY KEY,
  user_id nvarchar(36) NOT NULL REFERENCES dbo.profiles(id) ON DELETE CASCADE,
  audience nvarchar(10) NOT NULL CHECK (audience IN ('public','admin')),
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX sessions_expiry ON dbo.sessions(expires_at);
CREATE TABLE dbo.oauth_attempts (
  token_hash nvarchar(64) NOT NULL PRIMARY KEY,
  audience nvarchar(10) NOT NULL CHECK (audience IN ('public','admin')),
  state nvarchar(255) NOT NULL,
  nonce nvarchar(255) NOT NULL,
  verifier nvarchar(255) NOT NULL,
  expires_at bigint NOT NULL
);
CREATE TABLE dbo.locations (
  id nvarchar(36) NOT NULL PRIMARY KEY,
  lat float NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng float NOT NULL CHECK (lng BETWEEN -180 AND 180),
  address_label nvarchar(400) NULL,
  risk_score float NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  risk_level nvarchar(10) NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  report_count int NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  created_at nvarchar(30) NOT NULL,
  updated_at nvarchar(30) NOT NULL
);
CREATE TABLE dbo.reports (
  id nvarchar(36) NOT NULL PRIMARY KEY,
  location_id nvarchar(36) NOT NULL REFERENCES dbo.locations(id) ON DELETE CASCADE,
  user_id nvarchar(36) NOT NULL REFERENCES dbo.profiles(id) ON DELETE CASCADE,
  reporter_type nvarchar(10) NOT NULL CHECK (reporter_type IN ('victim','neighbour','witness')),
  has_image bit NOT NULL,
  image_url nvarchar(1000) NULL,
  description nvarchar(2000) NOT NULL CHECK (LEN(description) <= 2000),
  description_raw nvarchar(2000) NOT NULL CHECK (LEN(description_raw) <= 2000),
  incident_date nvarchar(30) NULL,
  created_at nvarchar(30) NOT NULL,
  is_removed bit NOT NULL DEFAULT 0,
  is_flagged bit NOT NULL DEFAULT 0,
  moderation_status nvarchar(10) NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','published','rejected')),
  reviewed_at nvarchar(30) NULL,
  -- NO ACTION, not SET NULL: SQL Server refuses a second cascade path into
  -- this table (profiles->reports already cascades via user_id). Profiles
  -- are never deleted by the app (banning sets is_banned instead), so this
  -- never needs to fire.
  reviewed_by nvarchar(36) NULL REFERENCES dbo.profiles(id) ON DELETE NO ACTION,
  CONSTRAINT reports_image_flag CHECK (has_image = CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END),
  CONSTRAINT reports_published_reviewed CHECK (moderation_status <> 'published' OR reviewed_at IS NOT NULL)
);
CREATE INDEX reports_location ON dbo.reports(location_id,moderation_status,is_removed,created_at);
CREATE INDEX reports_queue ON dbo.reports(moderation_status,is_removed,created_at);
CREATE TABLE dbo.report_votes (
  report_id nvarchar(36) NOT NULL REFERENCES dbo.reports(id) ON DELETE CASCADE,
  -- NO ACTION, not CASCADE: SQL Server refuses a second cascade path into this
  -- table (profiles->reports->report_votes already cascades via report_id).
  -- Profiles are never deleted by the app (banning sets is_banned instead),
  -- so this never needs to fire.
  user_id nvarchar(36) NOT NULL REFERENCES dbo.profiles(id) ON DELETE NO ACTION,
  vote nvarchar(10) NOT NULL CHECK (vote IN ('agree','disagree')),
  PRIMARY KEY (report_id,user_id)
);
GO
-- CREATE VIEW must be the only statement in its batch.
CREATE VIEW dbo.reports_public AS
 SELECT r.id,r.location_id,r.reporter_type,r.description,r.incident_date,r.created_at,
   (SELECT count(*) FROM dbo.report_votes v WHERE v.report_id=r.id AND v.vote='agree') AS agree_count,
   (SELECT count(*) FROM dbo.report_votes v WHERE v.report_id=r.id AND v.vote='disagree') AS disagree_count
 FROM dbo.reports r WHERE r.moderation_status='published' AND r.reviewed_at IS NOT NULL AND r.is_removed=0;
GO
CREATE TABLE dbo.content_policy_limits (
  scope nvarchar(200) NOT NULL PRIMARY KEY,
  window_start bigint NOT NULL,
  attempts int NOT NULL CHECK (attempts >= 0)
);
CREATE TABLE dbo.traffic_daily (
  day nvarchar(10) NOT NULL,
  route nvarchar(10) NOT NULL CHECK (route IN ('/','/appeal')),
  viewport nvarchar(10) NOT NULL CHECK (viewport IN ('mobile','tablet','desktop')),
  pageviews int NOT NULL CHECK (pageviews > 0),
  PRIMARY KEY (day,route,viewport)
);
CREATE TABLE dbo.area_summaries (
  id nvarchar(36) NOT NULL PRIMARY KEY,
  latitude float NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude float NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_metres int NOT NULL DEFAULT 500 CHECK (radius_metres=500),
  source_fingerprint nvarchar(64) NOT NULL CHECK (LEN(source_fingerprint)=64 AND source_fingerprint COLLATE Latin1_General_BIN NOT LIKE '%[^a-f0-9]%'),
  source_count int NOT NULL CHECK (source_count BETWEEN 1 AND 200),
  source_bytes int NOT NULL CHECK (source_bytes BETWEEN 0 AND 48000),
  oldest_source_created_at nvarchar(30) NOT NULL,
  newest_source_created_at nvarchar(30) NOT NULL,
  newest_source_reviewed_at nvarchar(30) NOT NULL,
  model nvarchar(20) NOT NULL DEFAULT 'gpt-5-mini' CHECK (model='gpt-5-mini'),
  contract_version nvarchar(20) NOT NULL DEFAULT 'area-summary-v2' CHECK (contract_version='area-summary-v2'),
  sentence nvarchar(200) NOT NULL,
  status nvarchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','stale')),
  generated_at nvarchar(30) NOT NULL,
  reviewed_at nvarchar(30) NULL,
  reviewed_by nvarchar(36) NULL REFERENCES dbo.profiles(id) ON DELETE SET NULL,
  CONSTRAINT area_summaries_approved_reviewed CHECK (status <> 'approved' OR reviewed_at IS NOT NULL)
);
CREATE INDEX area_summary_cache ON dbo.area_summaries(latitude,longitude,source_fingerprint,contract_version,status);
CREATE TABLE dbo.area_summary_generation_leases (
  latitude float NOT NULL,
  longitude float NOT NULL,
  lease_id nvarchar(36) NOT NULL,
  requested_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  PRIMARY KEY (latitude,longitude)
);
`];
