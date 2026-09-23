# Retired schema history

The SQL files here document the previous PostgreSQL/PostGIS/Supabase prototype.
No live backend or data was created using them. They are not current migrations
and must not be applied to run this version.

The active SQLite schema and ordered migrations are `database/schema.mjs`,
opened by `database/store.mjs`. The application has no Supabase runtime package,
API credentials, email-password authentication or PostgREST endpoint.

Historical handoffs that mention these SQL files are superseded by
`docs/19-sqlite-google-handoff.md`.
