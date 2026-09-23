import "server-only";
import { env } from "@/lib/env";
import { openDatabase, transaction, database as adapt } from "../../../database/sql-store.mjs";
import type { ConnectionPool } from "mssql";
import type { AzureSqlConfig, SqlConnection } from "../../../database/sql-store.d.mts";

function config(): AzureSqlConfig {
  if (!env.AZURE_SQL_SERVER || !env.AZURE_SQL_DATABASE) {
    throw new Error("Set AZURE_SQL_SERVER and AZURE_SQL_DATABASE.");
  }
  return {
    server: env.AZURE_SQL_SERVER,
    database: env.AZURE_SQL_DATABASE,
    authMode: env.AZURE_SQL_AUTH_MODE === "sql" ? "sql" : "entra",
    production: env.NODE_ENV === "production",
    clientId: env.AZURE_CLIENT_ID || undefined,
    user: env.AZURE_SQL_USER || undefined,
    password: env.AZURE_SQL_PASSWORD || undefined,
    port: env.AZURE_SQL_PORT,
  };
}

// Always re-resolve through openDatabase() rather than caching the pool promise
// here: sql-store.mjs's own cache re-authenticates ~20 minutes before an Entra
// access token's ~60-90 minute lifetime elapses, but only if openDatabase() is
// actually called again. Caching the resolved pool at this layer (the previous
// `pool ??= ...` pattern) prevented that refresh from ever running again after
// the first successful connection, so long-running dev/production processes
// eventually failed with "Login failed for user '<token-identified principal>'."
function connection(): Promise<ConnectionPool> {
  return openDatabase(config());
}

/** Returns the shared Azure SQL connection, wrapped in a `.prepare().get/.all/.run()`
 * adapter close to the previous synchronous better-sqlite3 shape - see
 * database/sql-store.mjs for why, and its `?`-placeholder/OUTPUT/MERGE notes. */
export async function database(): Promise<SqlConnection> {
  return adapt(await connection());
}

export async function writeTransaction<T>(work: (db: SqlConnection) => Promise<T>): Promise<T> {
  return transaction(await connection(), work);
}
