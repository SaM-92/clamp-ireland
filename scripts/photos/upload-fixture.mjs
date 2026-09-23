import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const filename = process.env.DATABASE_PATH;
if (filename !== "/tmp/clamp-upload-fixture.sqlite") throw new Error("Unexpected synthetic database path.");
const db = new DatabaseSync(filename);
db.function("valid_summary", { varargs: true }, () => 0);
db.function("distance_m", { varargs: true }, () => { throw new Error("The upload quota fixture must not read locations."); });
// Only the test preload is copied into /tmp; no fixture is part of a release image.
const { migrations } = await import("/tmp/sqlite-schema.mjs");
const initialized = db.prepare("PRAGMA user_version").get().user_version === 1;
if (!initialized) {
  db.exec(migrations[0]);
  db.exec("PRAGMA application_id=1129074000; PRAGMA user_version=1;");
}
const userId = "20000000-0000-4000-8000-000000000001";
const token = readFileSync("/tmp/upload-session-token", "utf8").trim();
db.prepare(`INSERT OR IGNORE INTO profiles(id,google_subject,email,display_name,username_policy_checked_at)
  VALUES (?,?,?,'river_walker','2026-01-01T00:00:00Z')`).run(userId, "fixture-subject", "synthetic@fixture.invalid");
db.prepare("INSERT OR IGNORE INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,'public',?,?)")
  .run(createHash("sha256").update(token).digest("hex"), userId, Date.now() + 3600_000, Date.now());
db.prepare("INSERT OR REPLACE INTO content_policy_limits VALUES ('global',?,200)").run(Math.floor(Date.now() / 86_400_000) * 86_400_000);
db.close();
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "127.0.0.1" && url.port === "3000") return nativeFetch(input, init);
  throw new Error("Unexpected network access in the synthetic upload fixture.");
};
