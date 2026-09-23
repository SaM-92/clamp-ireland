import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openDatabase, database as adapt } from "../../database/sql-store.mjs";
import type { AzureSqlConfig } from "../../database/sql-store.d.mts";

export const adminBaseURL = "http://127.0.0.1:3016";
export const adminUrl = (path: string) => `${adminBaseURL}${path}`;
export const fixtureSession = (label: string) => createHash("sha256").update(`clamp-browser-fixture:${label}`).digest("base64url");

export async function authorizeAdmin(page: Page, token = "owner-session") {
  const ids: Record<string, string> = {
    "owner-session": "10000000-0000-4000-8000-000000000001",
    "cofounder-session": "10000000-0000-4000-8000-000000000002",
    "outsider-session": "10000000-0000-4000-8000-000000000003",
  };
  if (ids[token]) {
    const connectionFile = path.resolve("test-results", "admin-fixture", "connection.json");
    if (!existsSync(connectionFile)) throw new Error("Isolated admin test database is not running.");
    const config: AzureSqlConfig = JSON.parse(readFileSync(connectionFile, "utf8"));
    const pool = await openDatabase(config);
    const db = adapt(pool);
    await db.prepare(`MERGE INTO sessions WITH (HOLDLOCK) AS target
      USING (SELECT ? AS token_hash) AS source ON target.token_hash=source.token_hash
      WHEN MATCHED THEN UPDATE SET expires_at=?
      WHEN NOT MATCHED THEN INSERT (token_hash,user_id,audience,expires_at,created_at) VALUES (source.token_hash,?,'admin',?,?);`)
      .run(createHash("sha256").update(fixtureSession(token)).digest("hex"), Date.now() + 3600_000,
        ids[token], Date.now() + 3600_000, Date.now());
  }
  await page.context().addCookies([{
    name: "clamp-admin-session", value: fixtureSession(token), url: adminBaseURL,
    httpOnly: true, sameSite: "Strict",
  }]);
}
