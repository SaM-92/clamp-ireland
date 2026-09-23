import http from "node:http";
import path from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import sql from "mssql";
import next from "next";
import { openDatabase, database as adapt } from "../../database/sql-store.mjs";
import { disabledAiEnvironment } from "../../scripts/ci/environment.mjs";

// Test-only data, not a runtime identity bypass. All real page/API/session gates run.
const directory = path.resolve("test-results", "admin-fixture");
mkdirSync(directory, { recursive: true });

const testServer = process.env.TEST_SQL_SERVER ?? "localhost";
const testPort = Number(process.env.TEST_SQL_PORT ?? 14330);
const testUser = process.env.TEST_SQL_USER ?? "sa";
const testPassword = process.env.TEST_SQL_PASSWORD ?? "ClampTest_2024!Xq";
const databaseName = `clamp_admin_e2e_${randomUUID().replace(/-/g, "")}`;

const admin = await new sql.ConnectionPool({
  server: testServer, port: testPort, user: testUser, password: testPassword, database: "master",
  options: { encrypt: true, trustServerCertificate: true },
}).connect();
await admin.request().batch(`CREATE DATABASE [${databaseName}]`);
await admin.close();

const config = {
  server: testServer, port: testPort, database: databaseName, authMode: "sql", production: false,
  user: testUser, password: testPassword,
};
const pool = await openDatabase(config);
const db = adapt(pool);

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];
for (const [index, label] of ["owner-session", "cofounder-session", "outsider-session"].entries()) {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO profiles(id,google_subject,email,is_admin,created_at) VALUES (?,?,?,?,?)")
    .run(ids[index], ids[index], "synthetic@fixture.invalid", Number(index < 2), now);
  const token = createHash("sha256").update(`clamp-browser-fixture:${label}`).digest("base64url");
  await db.prepare("INSERT INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,'admin',?,?)")
    .run(createHash("sha256").update(token).digest("hex"), ids[index], Date.now() + 86_400_000, Date.now());
}
// Read by tests/helpers/admin.ts so `authorizeAdmin` can renew fixture sessions
// against this same throwaway database.
writeFileSync(path.join(directory, "connection.json"), JSON.stringify(config));

const production = process.env.PLAYWRIGHT_ADMIN_PRODUCTION === "true";
Object.assign(process.env, {
  ...disabledAiEnvironment, NODE_ENV: production ? "production" : "development",
  AZURE_SQL_SERVER: testServer, AZURE_SQL_DATABASE: databaseName, AZURE_SQL_AUTH_MODE: "sql",
  AZURE_SQL_USER: testUser, AZURE_SQL_PASSWORD: testPassword, AZURE_SQL_PORT: String(testPort),
  GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret",
  ADMIN_ALLOWED_USER_IDS: `${ids[0]},${ids[1]}`, ADMIN_SITE_URL: "http://127.0.0.1:3016",
  AUTH_PUBLIC_ORIGIN: "", AUTH_ALLOWED_EMAILS: "", ALLOW_PUBLIC_SIGNUP: "false",
  ENABLE_AREA_SUMMARIES: "false", ENABLE_TRAFFIC_ANALYTICS: "false", SITE_URL: "", ALLOW_INDEXING: "false",
});
const app = next({ dev: !production, dir: path.resolve("apps", "admin"), hostname: "127.0.0.1", port: 3016 });
const handler = app.getRequestHandler();
await app.prepare();
const server = http.createServer((request, response) => handler(request, response));
await new Promise((resolve) => server.listen(3016, "127.0.0.1", resolve));
console.log("Isolated Azure SQL admin test server ready on 127.0.0.1:3016");
async function close() {
  server.closeAllConnections(); server.close();
  await app.close();
  try {
    const cleanup = await new sql.ConnectionPool({
      server: testServer, port: testPort, user: testUser, password: testPassword, database: "master",
      options: { encrypt: true, trustServerCertificate: true },
    }).connect();
    await cleanup.request().batch(`ALTER DATABASE [${databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${databaseName}];`);
    await cleanup.close();
  } catch { /* best-effort cleanup */ }
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
