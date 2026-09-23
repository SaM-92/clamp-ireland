import http from "node:http";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import next from "next";
import { openDatabase } from "../../database/store.mjs";
import { disabledAiEnvironment } from "../../scripts/ci/environment.mjs";

// Test-only data, not a runtime identity bypass. All real page/API/session gates run.
const directory = path.resolve("test-results", "admin-fixture");
mkdirSync(directory, { recursive: true });
const filename = path.join(directory, "sessions.sqlite");
for (const file of [filename, `${filename}-wal`, `${filename}-shm`]) rmSync(file, { force: true });
const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];
const db = openDatabase(filename);
for (const [index, label] of ["owner-session", "cofounder-session", "outsider-session"].entries()) {
  db.prepare("INSERT INTO profiles(id,google_subject,email,is_admin) VALUES (?,?,?,?)")
    .run(ids[index], ids[index], "synthetic@fixture.invalid", Number(index < 2));
  const token = createHash("sha256").update(`clamp-browser-fixture:${label}`).digest("base64url");
  db.prepare("INSERT INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,'admin',?,?)")
    .run(createHash("sha256").update(token).digest("hex"), ids[index], Date.now() + 86_400_000, Date.now());
}
db.close();
const production = process.env.PLAYWRIGHT_ADMIN_PRODUCTION === "true";
Object.assign(process.env, {
  ...disabledAiEnvironment, NODE_ENV: production ? "production" : "development",
  DATABASE_PATH: filename, GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret",
  ADMIN_ALLOWED_USER_IDS: `${ids[0]},${ids[1]}`, ADMIN_SITE_URL: "http://127.0.0.1:3016",
  AUTH_PUBLIC_ORIGIN: "", AUTH_ALLOWED_EMAILS: "", ALLOW_PUBLIC_SIGNUP: "false",
  ENABLE_AREA_SUMMARIES: "false", ENABLE_TRAFFIC_ANALYTICS: "false", SITE_URL: "", ALLOW_INDEXING: "false",
});
const app = next({ dev: !production, dir: path.resolve("apps", "admin"), hostname: "127.0.0.1", port: 3016 });
const handler = app.getRequestHandler();
await app.prepare();
const server = http.createServer((request, response) => handler(request, response));
await new Promise((resolve) => server.listen(3016, "127.0.0.1", resolve));
console.log("Isolated SQLite admin test server ready on 127.0.0.1:3016");
async function close() {
  server.closeAllConnections(); server.close();
  await app.close();
  // Windows may retain the app-owned SQLite handle until process exit.
  if (process.platform !== "win32") rmSync(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
