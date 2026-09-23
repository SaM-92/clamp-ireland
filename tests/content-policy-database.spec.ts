import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sqliteRuntime, owner, cofounder } from "./helpers/sqlite-runtime";

test("SQLite enforces checked unique usernames and active-account atomic hourly/global quotas", async () => {
  const f = sqliteRuntime();
  try {
    for (const name of ["x", "John Smith", "UPPER", "name@domain", "a".repeat(25)]) {
      expect(() => f.db.prepare("UPDATE profiles SET display_name=? WHERE id=?").run(name, owner)).toThrow();
    }
    expect(() => f.db.prepare("UPDATE profiles SET display_name='river_walker' WHERE id=?").run(cofounder)).toThrow();
    expect(() => f.db.prepare("UPDATE profiles SET username_policy_checked_at=NULL WHERE id=?").run(owner)).toThrow();
    const quota = f.load<typeof import("../src/modules/content-policy/server/rateLimit")>("src/modules/content-policy/server/rateLimit.ts");
    for (let n = 0; n < 10; n++) await quota.consumeContentPolicyAttempt(owner);
    await expect(Promise.resolve(quota.consumeContentPolicyAttempt(owner))).rejects.toMatchObject({ status: 429 });
    expect(f.db.prepare("SELECT attempts FROM content_policy_limits WHERE scope='global'").get()?.attempts).toBe(10);
    for (let n = 0; n < 19; n++) {
      const id = randomUUID();
      f.db.prepare("INSERT INTO profiles(id,google_subject,email) VALUES (?,?,?)").run(id, id, "fixture@fixture.invalid");
      for (let attempt = 0; attempt < 10; attempt++) await quota.consumeContentPolicyAttempt(id);
    }
    await expect(Promise.resolve(quota.consumeContentPolicyAttempt(cofounder))).rejects.toMatchObject({ status: 429 });
    expect(f.db.prepare("SELECT attempts FROM content_policy_limits WHERE scope='global'").get()?.attempts).toBe(200);
    f.db.prepare("UPDATE content_policy_limits SET window_start=0").run();
    await quota.consumeContentPolicyAttempt(owner);
    expect(f.db.prepare("SELECT attempts FROM content_policy_limits WHERE scope='global'").get()?.attempts).toBe(1);
    f.db.prepare("UPDATE profiles SET is_banned=1 WHERE id=?").run(owner);
    await expect(Promise.resolve(quota.consumeContentPolicyAttempt(owner))).rejects.toMatchObject({ status: 503 });
  } finally { f.db.close(); }
});
