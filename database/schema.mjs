export const migrations = [`
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT UNIQUE,
  username_policy_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0,1)),
  CHECK ((display_name IS NULL AND username_policy_checked_at IS NULL) OR
    (display_name IS NOT NULL AND username_policy_checked_at IS NOT NULL
      AND length(display_name) BETWEEN 3 AND 24 AND display_name NOT GLOB '*[^a-z0-9_]*'
      AND substr(display_name,1,1) GLOB '[a-z]'))
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('public','admin')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_attempts (
  token_hash TEXT PRIMARY KEY,
  audience TEXT NOT NULL CHECK (audience IN ('public','admin')),
  state TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  address_label TEXT,
  risk_score REAL NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reporter_type TEXT NOT NULL CHECK (reporter_type IN ('victim','neighbour','witness')),
  has_image INTEGER NOT NULL CHECK (has_image IN (0,1)),
  image_url TEXT,
  description TEXT NOT NULL CHECK (length(description) <= 2000),
  description_raw TEXT NOT NULL CHECK (length(description_raw) <= 2000),
  incident_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  is_removed INTEGER NOT NULL DEFAULT 0 CHECK (is_removed IN (0,1)),
  is_flagged INTEGER NOT NULL DEFAULT 0 CHECK (is_flagged IN (0,1)),
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','published','rejected')),
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  CHECK (has_image = (image_url IS NOT NULL)),
  CHECK (moderation_status <> 'published' OR reviewed_at IS NOT NULL)
) STRICT;
CREATE INDEX reports_location ON reports(location_id,moderation_status,is_removed,created_at);
CREATE INDEX reports_queue ON reports(moderation_status,is_removed,created_at);
CREATE TABLE report_votes (
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('agree','disagree')),
  PRIMARY KEY (report_id,user_id)
) STRICT;
CREATE VIEW reports_public AS
 SELECT r.id,r.location_id,r.reporter_type,r.description,r.incident_date,r.created_at,
   (SELECT count(*) FROM report_votes v WHERE v.report_id=r.id AND v.vote='agree') AS agree_count,
   (SELECT count(*) FROM report_votes v WHERE v.report_id=r.id AND v.vote='disagree') AS disagree_count
 FROM reports r WHERE r.moderation_status='published' AND r.reviewed_at IS NOT NULL AND r.is_removed=0;
CREATE TABLE content_policy_limits (
  scope TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0)
) STRICT;
CREATE TABLE traffic_daily (
  day TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('/','/appeal')),
  viewport TEXT NOT NULL CHECK (viewport IN ('mobile','tablet','desktop')),
  pageviews INTEGER NOT NULL CHECK (pageviews > 0),
  PRIMARY KEY (day,route,viewport)
) STRICT;
CREATE TABLE area_summaries (
  id TEXT PRIMARY KEY,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_metres INTEGER NOT NULL DEFAULT 500 CHECK (radius_metres=500),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint)=64 AND source_fingerprint NOT GLOB '*[^a-f0-9]*'),
  source_count INTEGER NOT NULL CHECK (source_count BETWEEN 1 AND 200),
  source_bytes INTEGER NOT NULL CHECK (source_bytes BETWEEN 0 AND 48000),
  oldest_source_created_at TEXT NOT NULL,
  newest_source_created_at TEXT NOT NULL,
  newest_source_reviewed_at TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-5-mini' CHECK (model='gpt-5-mini'),
  contract_version TEXT NOT NULL DEFAULT 'area-summary-v2' CHECK (contract_version='area-summary-v2'),
  sentence TEXT NOT NULL CHECK (valid_summary(sentence)=1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','stale')),
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  CHECK (status <> 'approved' OR reviewed_at IS NOT NULL)
) STRICT;
CREATE INDEX area_summary_cache ON area_summaries(latitude,longitude,source_fingerprint,contract_version,status);
CREATE TABLE area_summary_generation_leases (
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  lease_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (latitude,longitude)
) STRICT;
CREATE TRIGGER summaries_report_insert AFTER INSERT ON reports
WHEN NEW.moderation_status='published' AND NEW.reviewed_at IS NOT NULL AND NEW.is_removed=0
BEGIN
 UPDATE area_summaries SET status='stale' WHERE status IN ('draft','approved') AND EXISTS (
   SELECT 1 FROM locations l WHERE l.id=NEW.location_id AND distance_m(l.lat,l.lng,latitude,longitude)<=500.000001);
END;
CREATE TRIGGER summaries_report_delete BEFORE DELETE ON reports
WHEN OLD.moderation_status='published' AND OLD.reviewed_at IS NOT NULL AND OLD.is_removed=0
BEGIN
 UPDATE area_summaries SET status='stale' WHERE status IN ('draft','approved') AND EXISTS (
   SELECT 1 FROM locations l WHERE l.id=OLD.location_id AND distance_m(l.lat,l.lng,latitude,longitude)<=500.000001);
END;
CREATE TRIGGER summaries_report_update AFTER UPDATE OF description,location_id,created_at,reviewed_at,moderation_status,is_removed ON reports
WHEN OLD.description IS NOT NEW.description OR OLD.location_id IS NOT NEW.location_id OR
 OLD.created_at IS NOT NEW.created_at OR OLD.reviewed_at IS NOT NEW.reviewed_at OR
 OLD.moderation_status IS NOT NEW.moderation_status OR OLD.is_removed IS NOT NEW.is_removed
BEGIN
 UPDATE area_summaries SET status='stale' WHERE status IN ('draft','approved') AND EXISTS (
   SELECT 1 FROM locations l WHERE
   ((l.id=OLD.location_id AND OLD.moderation_status='published' AND OLD.reviewed_at IS NOT NULL AND OLD.is_removed=0)
    OR (l.id=NEW.location_id AND NEW.moderation_status='published' AND NEW.reviewed_at IS NOT NULL AND NEW.is_removed=0))
   AND distance_m(l.lat,l.lng,latitude,longitude)<=500.000001);
END;
CREATE TRIGGER summaries_location_update AFTER UPDATE OF lat,lng ON locations
WHEN OLD.lat IS NOT NEW.lat OR OLD.lng IS NOT NEW.lng
BEGIN
 UPDATE area_summaries SET status='stale' WHERE status IN ('draft','approved') AND
 (distance_m(OLD.lat,OLD.lng,latitude,longitude)<=500.000001 OR distance_m(NEW.lat,NEW.lng,latitude,longitude)<=500.000001);
END;
CREATE TRIGGER summaries_location_delete BEFORE DELETE ON locations
BEGIN
 UPDATE area_summaries SET status='stale' WHERE status IN ('draft','approved') AND
 distance_m(OLD.lat,OLD.lng,latitude,longitude)<=500.000001;
END;
`];
