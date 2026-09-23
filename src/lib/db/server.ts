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

let pool: Promise<ConnectionPool> | undefined;
function connection(): Promise<ConnectionPool> {
  pool ??= openDatabase(config()).catch((error: unknown) => {
    pool = undefined;
    throw error;
  });
  return pool;
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
