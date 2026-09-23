import "server-only";
import { writeTransaction } from "@/lib/db/server";
import { ContentPolicyError, POLICY_UNAVAILABLE_MESSAGE } from "../policy";

export async function consumeContentPolicyAttempt(userId: string, signal?: AbortSignal): Promise<void> {
  let allowed: boolean;
  try {
    signal?.throwIfAborted();
    allowed = writeTransaction((db) => {
      if (!db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(userId)) throw new Error("Account unavailable.");
      const now = Date.now();
      const windows = [
        { key: `user:${userId}`, start: Math.floor(now / 3_600_000) * 3_600_000, max: 10 },
        { key: "global", start: Math.floor(now / 86_400_000) * 86_400_000, max: 200 },
      ];
      for (const window of windows) {
        const row = db.prepare("SELECT attempts FROM content_policy_limits WHERE scope=? AND window_start=?").get(window.key, window.start);
        if (row && Number(row.attempts) >= window.max) return false;
      }
      for (const window of windows) {
        db.prepare(`INSERT INTO content_policy_limits(scope,window_start,attempts) VALUES (?,?,1)
          ON CONFLICT(scope) DO UPDATE SET window_start=excluded.window_start,
          attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END`).run(window.key, window.start);
      }
      db.prepare("DELETE FROM content_policy_limits WHERE window_start<?").run(now - 86_400_000);
      return true;
    });
  } catch {
    console.error("[Content policy] capacity reservation failed");
    throw new ContentPolicyError("content_policy_unavailable", 503, POLICY_UNAVAILABLE_MESSAGE);
  }
  if (!allowed) throw new ContentPolicyError("content_policy_rate_limited", 429, "Content-check capacity has been reached. Nothing was submitted. Please try again later.");
}
