# Azure SQL migration handoff

## Scope and honest status

Persistence moved from embedded SQLite (`docs/19-sqlite-google-handoff.md`) to
Azure SQL Database (mssql/T-SQL), to run behind Azure Container Apps instead of
a VM. This document supersedes 19 for anything related to storage. No Azure SQL
server has been provisioned yet in this segment; this covers the application
and test-suite side of the migration only.

## What changed

- `database/sql-schema.mjs`, `sql-store.mjs`, `sql-store.d.mts` replace
  `schema.mjs`/`store.mjs`/`store.d.mts`. Same domain tables, translated to
  T-SQL: `TEXT`→`nvarchar`, `INTEGER PRIMARY KEY`→`nvarchar(36)` UUIDs,
  `CHECK`/`UNIQUE` constraints preserved (see `profiles_username_shape` and the
  filtered `profiles_display_name_unique` index — SQL Server treats `NULL` as
  distinct in a plain `UNIQUE` constraint, so uniqueness is enforced only once
  `display_name` is actually set).
- All domain repositories (`src/modules/**/server/repository.ts`) now do
  parameterized T-SQL through the `database(pool)` adapter instead of
  `better-sqlite3` calls, and are `async` throughout (SQLite was synchronous).
- `src/lib/db/server.ts` builds an `AzureSqlConfig` from environment variables
  and picks Entra (managed identity/CLI) or SQL auth.
- SQLite had 5 trigger-based staleness rules for `area_summaries` that used
  SQLite-specific geodesic math; T-SQL has no equivalent trigger mechanism for
  this. They are replaced by an application-level helper,
  `invalidateNearbyAreaSummaries(spot, db)` in
  `src/modules/area-summaries/server/repository.ts`, which every write path
  that changes report/location facts near an existing summary must call. Only
  `approveReport` (`src/modules/moderation/server/repository.ts`) does today;
  any future write path (editing/removing a published report, moving/deleting
  a location) must call it too, or approved summaries can silently go stale
  without being marked so.
- `scripts/database.mjs` (the ops CLI) is now async and Azure-SQL-only. Azure
  SQL Database has no T-SQL `BACKUP`/`RESTORE` (that's a SQL Managed
  Instance/on-prem feature) — it relies on the platform's automatic
  point-in-time restore (PITR). The `backup`/`restore` verbs were removed; the
  CLI now throws pointing operators at `az sql db restore` / Azure Portal PITR.

## CLI usage (`scripts/database.mjs`)

```
npm run db -- init                                    # apply pending migrations
npm run db -- accounts                                # list profiles
npm run db -- admins <uuid1> <uuid2>                  # assign exactly two admins, revoke admin sessions
```

Requires `AZURE_SQL_SERVER` and `AZURE_SQL_DATABASE` (see env vars below). Any
`backup`/`restore` invocation throws immediately with PITR guidance instead of
running.

## Environment variables (mirrors `src/lib/db/server.ts`)

| Variable | Purpose |
|---|---|
| `AZURE_SQL_SERVER` | Server hostname, e.g. `<name>.database.windows.net` |
| `AZURE_SQL_DATABASE` | Database name |
| `AZURE_SQL_AUTH_MODE` | `sql` for SQL auth; anything else (or unset) = Entra |
| `AZURE_CLIENT_ID` | User-assigned managed identity client ID (Entra mode, production) |
| `AZURE_SQL_USER` / `AZURE_SQL_PASSWORD` | SQL-auth credentials (non-production/local only) |
| `AZURE_SQL_PORT` | Optional, defaults to 1433 |
| `NODE_ENV` | `production` selects `ManagedIdentityCredential` + forbids SQL auth against `*.database.windows.net`; otherwise `AzureCliCredential` |

## Local test container

Tests and manual CLI verification use a local SQL Server container, not a real
Azure resource:

```
docker run -d --name clamp-sql-test -p 14330:1433 \
  -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='ClampTest_2024!Xq' \
  mcr.microsoft.com/mssql/server:2022-latest
```

Test env vars: `TEST_SQL_SERVER` (default `localhost`), `TEST_SQL_PORT`
(default `14330`), `TEST_SQL_USER` (default `sa`), `TEST_SQL_PASSWORD`
(default `ClampTest_2024!Xq`).

## Running tests

Use the scoped Playwright configs, not the raw default one (which also
matches real e2e browser specs that need a manually-started public dev server
on port 3001 — unrelated to this migration):

```
$env:TEST_SQL_PORT="14330"; npm run test:unit   # server/unit specs, incl. VM-sandboxed ones
$env:TEST_SQL_PORT="14330"; npm run test:sql    # *-policy/*-database specs + SQL-backed traffic test
```

Both are green as of this migration (84/84 unit, 8/8 sql).

## Not done yet

- No real Azure SQL server/database has been provisioned (this is app-side
  only). Infra work (Bicep, managed identity + SQL data-plane grants, private
  networking) is a separate step.
- `docs/19-sqlite-google-handoff.md` is retained as a historical record but
  superseded by this document for storage matters.
- `database/schema.mjs`/`store.mjs` (the SQLite files) are still present
  because a few release/CI smoke scripts (`scripts/release/*`,
  `scripts/sqlite/*`) still reference them; retiring those is out of scope
  for this migration and not yet assessed.
