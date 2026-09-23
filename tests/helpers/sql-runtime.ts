import sql from "mssql";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { openDatabase, closeDatabase, database as adapt, transaction } from "../../database/sql-store.mjs";
import type { AzureSqlConfig, SqlConnection } from "../../database/sql-store.d.mts";
import { policyRuntime } from "./content-policy-runtime";

export const owner = "20000000-0000-4000-8000-000000000001";
export const cofounder = "20000000-0000-4000-8000-000000000002";
export const outsider = "20000000-0000-4000-8000-000000000003";
export const locationId = "30000000-0000-4000-8000-000000000001";
export const publicOrigin = "https://public.fixture.invalid";
export const adminOrigin = "https://admin.fixture.invalid";

// A local/CI-only SQL Server container (see docs/20-azure-sql-migration.md);
// never a real Azure SQL hostname, so SQL-auth mode is allowed (sql-store.mjs
// refuses it outright against any *.database.windows.net server).
const testServer = process.env.TEST_SQL_SERVER ?? "localhost";
const testPort = Number(process.env.TEST_SQL_PORT ?? 14330);
const testUser = process.env.TEST_SQL_USER ?? "sa";
const testPassword = process.env.TEST_SQL_PASSWORD ?? "ClampTest_2024!Xq";

async function withAdminPool<T>(work: (admin: sql.ConnectionPool) => Promise<T>): Promise<T> {
  const admin = await new sql.ConnectionPool({
    server: testServer, port: testPort, user: testUser, password: testPassword, database: "master",
    options: { encrypt: true, trustServerCertificate: true },
  }).connect();
  try {
    return await work(admin);
  } finally {
    await admin.close();
  }
}

/** One throwaway database per call, mirroring the old `:memory:` SQLite
 * isolation - Azure SQL has no in-memory mode, so a real (tiny, disposable)
 * database stands in for it. Call the returned `close()` to drop it. */
export async function sqlRuntime(dependencies: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const name = `clamp_test_${randomUUID().replace(/-/g, "")}`;
  await withAdminPool((admin) => admin.request().batch(`CREATE DATABASE [${name}]`));
  const config: AzureSqlConfig = {
    server: testServer, port: testPort, database: name, authMode: "sql", production: false,
    user: testUser, password: testPassword,
  };
  const pool = await openDatabase(config);
  const db: SqlConnection = adapt(pool);
  const now = new Date().toISOString();
  for (const [id, name_, admin] of [[owner, "river_walker", 1], [cofounder, "park_walker", 1], [outsider, "other_walker", 0]] as const) {
    await db.prepare(`INSERT INTO profiles(id,google_subject,email,display_name,username_policy_checked_at,is_admin,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(id, `google-${id}`, `${name_}@fixture.invalid`, name_, now, admin, now);
  }
  await db.prepare("INSERT INTO locations(id,lat,lng,created_at,updated_at) VALUES (?,53.3,-6.2,?,?)").run(locationId, now, now);
  const environment = {
    AZURE_SQL_SERVER: testServer, AZURE_SQL_DATABASE: name, AZURE_SQL_AUTH_MODE: "sql",
    AZURE_SQL_USER: testUser, AZURE_SQL_PASSWORD: testPassword, AZURE_SQL_PORT: testPort,
    AUTH_PUBLIC_ORIGIN: publicOrigin, ADMIN_SITE_URL: adminOrigin,
    ADMIN_ALLOWED_USER_IDS: `${owner},${cofounder}`, GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret",
    AUTH_ALLOWED_EMAILS: "", ALLOW_PUBLIC_SIGNUP: false, ENABLE_AREA_SUMMARIES: true,
    AI_PROVIDER: "openai", OPENAI_API_KEY: "fixture-only", ENABLE_TRAFFIC_ANALYTICS: false,
  };
  const runtime = policyRuntime({
    "@/lib/env": { env: environment, isDatabaseConfigured: true },
    "@/lib/db/server": {
      database: async () => db,
      writeTransaction: <T>(work: (db: SqlConnection) => Promise<T>) => transaction(pool, work),
    },
    ...dependencies,
  }, globals);
  async function cookie(userId = owner, audience: "public" | "admin" = "public", expiresAt = Date.now() + 3600_000) {
    const token = randomBytes(32).toString("base64url");
    await db.prepare("INSERT INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run(createHash("sha256").update(token).digest("hex"), userId, audience, expiresAt, Date.now());
    return `__Host-clamp-${audience}-session=${token}`;
  }
  async function request(route: string, options: RequestInit = {}, userId = owner, audience: "public" | "admin" = "public") {
    const origin = audience === "public" ? publicOrigin : adminOrigin;
    const headers = new Headers(options.headers);
    headers.set("cookie", await cookie(userId, audience));
    headers.set("origin", origin);
    return new Request(`${origin}${route}`, { ...options, headers });
  }
  async function report(options: { id?: string; location?: string; status?: "pending" | "published" | "rejected"; text?: string; photo?: string; user?: string } = {}) {
    const id = options.id ?? randomUUID();
    const status = options.status ?? "published";
    const createdAt = new Date().toISOString();
    await db.prepare(`INSERT INTO reports(id,location_id,user_id,reporter_type,has_image,image_url,description,description_raw,
      created_at,moderation_status,reviewed_at) VALUES (?,?,?,'witness',?,?,?,?,?,?,?)`).run(
      id, options.location ?? locationId, options.user ?? owner, Number(Boolean(options.photo)), options.photo ?? null,
      options.text ?? "Parking permits are mentioned.", "PRIVATE ORIGINAL", createdAt, status,
      status === "published" ? new Date().toISOString() : null);
    return id;
  }
  async function close() {
    try { await closeDatabase(config); } catch { /* pool may already be closed by the test */ }
    await withAdminPool((admin) => admin.request()
      .batch(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`));
  }
  return { ...runtime, db, pool, env: environment, cookie, request, report, close };
}
