import "server-only";
import { writeTransaction } from "@/lib/db/server";
import type { SqlConnection } from "../../../../database/sql-store.d.mts";
import { ContentPolicyError, POLICY_UNAVAILABLE_MESSAGE } from "../policy";

interface RateWindow { key: string; start: number; max: number }

/** Shared MERGE-based sliding-bucket check+increment used by every rate-limited scope. */
async function reserveWindows(db: SqlConnection, windows: RateWindow[], now: number): Promise<boolean> {
  for (const window of windows) {
    const row = await db.prepare("SELECT attempts FROM content_policy_limits WHERE scope=? AND window_start=?").get(window.key, window.start);
    if (row && Number(row.attempts) >= window.max) return false;
  }
  for (const window of windows) {
    await db.prepare(`MERGE INTO content_policy_limits WITH (HOLDLOCK) AS target
      USING (SELECT ? AS scope,? AS window_start) AS source
      ON target.scope=source.scope
      WHEN MATCHED THEN UPDATE SET window_start=source.window_start,
        attempts=CASE WHEN target.window_start=source.window_start THEN target.attempts+1 ELSE 1 END
      WHEN NOT MATCHED THEN INSERT (scope,window_start,attempts) VALUES (source.scope,source.window_start,1);`)
      .run(window.key, window.start);
  }
  await db.prepare("DELETE FROM content_policy_limits WHERE window_start<?").run(now - 86_400_000);
  return true;
}

/**
 * Signed-in reports are keyed per account: hourly/daily caps bound sustained
 * volume, alongside the shared "global" AI content-check capacity budget
 * every submission draws from. No per-request cooldown here - a signed-in,
 * username-checked person can legitimately report several real clamped cars
 * in quick succession (e.g. walking down one street).
 */
export async function consumeContentPolicyAttempt(userId: string, signal?: AbortSignal): Promise<void> {
  let allowed: boolean;
  try {
    signal?.throwIfAborted();
    allowed = await writeTransaction(async (db) => {
      if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(userId))) throw new Error("Account unavailable.");
      const now = Date.now();
      return reserveWindows(db, [
        { key: `user:${userId}:hour`, start: Math.floor(now / 3_600_000) * 3_600_000, max: 10 },
        { key: `user:${userId}:day`, start: Math.floor(now / 86_400_000) * 86_400_000, max: 30 },
        { key: "global", start: Math.floor(now / 86_400_000) * 86_400_000, max: 200 },
      ], now);
    });
  } catch {
    console.error("[Content policy] capacity reservation failed");
    throw new ContentPolicyError("content_policy_unavailable", 503, POLICY_UNAVAILABLE_MESSAGE);
  }
  if (!allowed) throw new ContentPolicyError("content_policy_rate_limited", 429, "Content-check capacity has been reached. Nothing was submitted. Please try again later.");
}

/**
 * Anonymous reports have no account to key a limit on, so this is keyed on a
 * hashed client IP instead (see clientIp.ts): a short cooldown blocks
 * rapid-fire bursts (a real "I was just clamped" report has no reason to
 * repeat within a minute), then hourly/daily caps looser than a bot-flood
 * would need but still well below signed-in users get, plus the same shared
 * "global" AI content-check capacity budget. Windows are intentionally wide
 * enough that someone fixing a validation error (e.g. a bad date) and
 * resubmitting, or reporting a couple of different clamped cars nearby, is
 * never mistaken for abuse.
 */
export async function consumeAnonymousReportAttempt(ipHash: string, signal?: AbortSignal): Promise<void> {
  let allowed: boolean;
  try {
    signal?.throwIfAborted();
    allowed = await writeTransaction(async (db) => {
      const now = Date.now();
      return reserveWindows(db, [
        { key: `anon-ip:${ipHash}:cooldown`, start: Math.floor(now / 60_000) * 60_000, max: 1 },
        { key: `anon-ip:${ipHash}:hour`, start: Math.floor(now / 3_600_000) * 3_600_000, max: 8 },
        { key: `anon-ip:${ipHash}:day`, start: Math.floor(now / 86_400_000) * 86_400_000, max: 20 },
        { key: "global", start: Math.floor(now / 86_400_000) * 86_400_000, max: 200 },
      ], now);
    });
  } catch {
    console.error("[Content policy] anonymous capacity reservation failed");
    throw new ContentPolicyError("content_policy_unavailable", 503, POLICY_UNAVAILABLE_MESSAGE);
  }
  if (!allowed) throw new ContentPolicyError("content_policy_rate_limited", 429, "Too many anonymous reports from this connection. Please try again later, or sign in for a higher limit.");
}
