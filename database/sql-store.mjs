import sql from "mssql";
import geodesic from "geographiclib-geodesic";
import { ManagedIdentityCredential, AzureCliCredential } from "@azure/identity";
import { migrations } from "./sql-schema.mjs";

export function distanceMetres(lat, lng, otherLat, otherLng) {
  if (![lat, lng, otherLat, otherLng].every(Number.isFinite) ||
      Math.abs(lat) > 90 || Math.abs(otherLat) > 90 || Math.abs(lng) > 180 || Math.abs(otherLng) > 180) {
    throw new Error("Invalid geographic coordinates.");
  }
  return geodesic.Geodesic.WGS84.Inverse(lat, lng, otherLat, otherLng).s12;
}

export function validSummary(value) {
  return typeof value === "string" && value.length >= 18 && value.length <= 160
    && value.trim().split(/\s+/u).length <= 20 && /^Reports mention [^.!?\r\n]+\.$/.test(value)
    && !/[\u0000-\u001f\u007f<>@]|https?:|www\./i.test(value);
}

/**
 * A coarse SQL prefilter box, generous enough to always be a superset of the
 * exact geodesic radius. Ireland sits far from the antimeridian and poles, so
 * longitude wraparound and pole clamping beyond a simple min/max are not
 * handled; this is a known, documented limitation, not an oversight.
 */
export function boundingBox(lat, lng, marginMetres) {
  const latMargin = marginMetres / 110_574;
  const cos = Math.cos((lat * Math.PI) / 180);
  const lngMargin = marginMetres / (111_320 * (Math.abs(cos) > 0.01 ? Math.abs(cos) : 0.01));
  return {
    minLat: Math.max(lat - latMargin, -90), maxLat: Math.min(lat + latMargin, 90),
    minLng: lng - lngMargin, maxLng: lng + lngMargin,
  };
}

// Translates our own trusted `?`-placeholder SQL text (never user input) into
// mssql named parameters. Safe only because our SQL text never contains a
// literal `?` character inside a string/identifier.
function toNamedQuery(text) {
  let index = 0;
  const names = [];
  const query = text.replace(/\?/g, () => {
    const name = `p${index++}`;
    names.push(name);
    return `@${name}`;
  });
  return { query, names };
}

async function exec(target, text, args, mode) {
  const { query, names } = toNamedQuery(text);
  const request = new sql.Request(target);
  names.forEach((name, position) => {
    const value = args[position];
    // Every nullable column in sql-schema.mjs is textual; if that ever
    // changes, this default must be revisited alongside the new column.
    if (value === null || value === undefined) request.input(name, sql.NVarChar, null);
    else request.input(name, value);
  });
  const result = await request.query(query);
  if (mode === "get") return result.recordset?.[0];
  if (mode === "all") return result.recordset ?? [];
  return { changes: (result.rowsAffected ?? []).reduce((sum, count) => sum + count, 0) };
}

/** Mirrors the shape of a better-sqlite3 statement (`.get`/`.all`/`.run`) so
 * repository call sites stay close to their previous form; only `async`/
 * `await` and OUTPUT/MERGE SQL text differ per call site. */
function adapt(target) {
  return {
    prepare(text) {
      return {
        get: (...args) => exec(target, text, args, "get"),
        all: (...args) => exec(target, text, args, "all"),
        run: (...args) => exec(target, text, args, "run"),
      };
    },
    // Test-only escape hatch for raw DDL/multi-row batches (e.g. throwaway
    // triggers to simulate insert failure); production code always uses
    // `prepare` so every real query stays parameterized.
    async exec(text) {
      await new sql.Request(target).batch(text);
    },
  };
}

export async function transaction(pool, work) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await work(adapt(tx));
    await tx.commit();
    return result;
  } catch (error) {
    try {
      await tx.rollback();
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Could not confirm Azure SQL rollback.");
    }
    throw error;
  }
}

function buildCredential(config) {
  return config.production
    ? new ManagedIdentityCredential(config.clientId ? { clientId: config.clientId } : {})
    : new AzureCliCredential({ processTimeoutInMs: 7_000 });
}

async function poolConfig(config) {
  const base = {
    server: config.server, database: config.database, port: config.port ?? 1433, pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
    // Azure SQL serverless (the free/dev tier this project uses) auto-pauses
    // after inactivity; resuming it can take up to ~30s. The mssql defaults
    // (15s) are too short and turn a cold start into a user-facing 503, so
    // both timeouts are raised well past a typical resume.
    connectionTimeout: 45_000, requestTimeout: 30_000,
  };
  if (config.authMode === "sql") {
    // Local/CI containers only. The deployed Azure SQL server is Entra-only
    // (publicNetworkAccess disabled, azureADOnlyAuthentication true) and never
    // accepts a SQL login; see infra/preflight/sql.bicep.
    if (config.server === "database.windows.net" || config.server.endsWith(".database.windows.net")) {
      throw new Error("SQL-auth mode is refused against a real Azure SQL hostname.");
    }
    return { ...base, user: config.user, password: config.password, options: { encrypt: false, trustServerCertificate: true } };
  }
  const credential = buildCredential(config);
  const token = await credential.getToken("https://database.windows.net/.default");
  if (!token?.token) throw new Error("Could not acquire an Azure SQL access token.");
  return {
    ...base,
    authentication: { type: "azure-active-directory-access-token", options: { token: token.token } },
    options: { encrypt: true, trustServerCertificate: false },
  };
}

/** A resuming serverless database can still refuse the very first connection
 * attempt after its resume window opens; one retry after a short wait
 * absorbs that instead of failing the whole request. */
async function connectWithRetry(resolved) {
  try {
    return await new sql.ConnectionPool(resolved).connect();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    try {
      return await new sql.ConnectionPool(resolved).connect();
    } catch {
      throw error;
    }
  }
}

async function ensureMigrationTable(pool) {
  await new sql.Request(pool).query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='schema_migrations' AND schema_id=SCHEMA_ID('dbo'))
    CREATE TABLE dbo.schema_migrations (version int NOT NULL PRIMARY KEY, applied_at nvarchar(30) NOT NULL);`);
}

async function runMigrations(pool) {
  await ensureMigrationTable(pool);
  await transaction(pool, async (db) => {
    // sp_getapplock serializes concurrent migration attempts (e.g. both the
    // public and admin app starting at once) the same way the old SQLite
    // runtime relied on BEGIN IMMEDIATE's write lock.
    const lock = await db.prepare("DECLARE @r int; EXEC @r=sp_getapplock @Resource='clamp_ireland_migration',@LockMode='Exclusive',@LockOwner='Transaction'; SELECT @r AS result").get();
    if (Number(lock?.result) < 0) throw new Error("Could not acquire the schema migration lock.");
    const applied = await db.prepare("SELECT version FROM dbo.schema_migrations").all();
    const current = applied.reduce((max, row) => Math.max(max, Number(row.version)), 0);
    for (let index = current; index < migrations.length; index++) {
      const batches = migrations[index].split(/^GO$/m).map((batch) => batch.trim()).filter(Boolean);
      for (const batch of batches) await new sql.Request(pool).batch(batch);
      await db.prepare("INSERT INTO dbo.schema_migrations(version,applied_at) VALUES (?,?)").run(index + 1, new Date().toISOString());
    }
  });
}

// Keyed by config identity so tests may hold several independent pools (one
// per throwaway database) at once; production only ever uses one key.
const pools = new Map();

/** Lazily creates (and, near Entra token expiry, recreates) a shared pool. */
export async function openDatabase(config) {
  const key = `${config.server}::${config.database}::${config.authMode}`;
  const cached = pools.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.pool;
  if (cached) {
    try { await cached.pool.close(); } catch { /* replacing an already-broken pool */ }
  }
  const resolved = await poolConfig(config);
  const next = await connectWithRetry(resolved);
  await runMigrations(next);
  // Re-authenticate well before a typical Entra access token's ~60-90 minute
  // lifetime elapses; SQL-auth connections do not expire this way.
  const expiresAt = config.authMode === "sql" ? Number.POSITIVE_INFINITY : Date.now() + 20 * 60_000;
  pools.set(key, { pool: next, expiresAt });
  return next;
}

/** Test-only: closes and forgets a pool so its throwaway database can be dropped. */
export async function closeDatabase(config) {
  const key = `${config.server}::${config.database}::${config.authMode}`;
  const cached = pools.get(key);
  if (!cached) return;
  pools.delete(key);
  try { await cached.pool.close(); } catch { /* already closed/broken */ }
}

export function database(current) {
  return adapt(current);
}
