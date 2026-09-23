import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../../database/store.mjs";

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
    const filename = path.resolve("test-results", "admin-fixture", "sessions.sqlite");
    if (!existsSync(filename)) throw new Error("Isolated admin test database is not running.");
    const db = openDatabase(filename);
    try {
      db.prepare(`INSERT INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,'admin',?,?)
        ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at`).run(
        createHash("sha256").update(fixtureSession(token)).digest("hex"), ids[token], Date.now() + 3600_000, Date.now());
    } finally { db.close(); }
  }
  await page.context().addCookies([{
    name: "clamp-admin-session", value: fixtureSession(token), url: adminBaseURL,
    httpOnly: true, sameSite: "Strict",
  }]);
}
