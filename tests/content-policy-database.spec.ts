import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sqlRuntime, owner, cofounder } from "./helpers/sql-runtime";

test("Azure SQL enforces checked unique usernames and active-account atomic hourly/global quotas", async () => {
  const f = await sqlRuntime();
  try {
    for (const name of ["x", "John Smith", "UPPER", "name@domain", "a".repeat(25)]) {
      await expect(async () => f.db.prepare("UPDATE profiles SET display_name=? WHERE id=?").run(name, owner)).rejects.toThrow();
    }
    await expect(async () => f.db.prepare("UPDATE profiles SET display_name='river_walker' WHERE id=?").run(cofounder)).rejects.toThrow();
    await expect(async () => f.db.prepare("UPDATE profiles SET username_policy_checked_at=NULL WHERE id=?").run(owner)).rejects.toThrow();
    const quota = f.load<typeof import("../src/modules/content-policy/server/rateLimit")>("src/modules/content-policy/server/rateLimit.ts");
    for (let n = 0; n < 10; n++) await quota.consumeContentPolicyAttempt(owner);
    await expect(async () => quota.consumeContentPolicyAttempt(owner)).rejects.toMatchObject({ status: 429 });
    expect((await f.db.prepare("SELECT attempts FROM content_policy_limits WHERE scope='global'").get())?.attempts).toBe(10);
    for (let n = 0; n < 19; n++) {
      const id = randomUUID();
      await f.db.prepare("INSERT INTO profiles(id,google_subject,email,created_at) VALUES (?,?,?,?)").run(id, id, "fixture@fixture.invalid", new Date().toISOString());
      for (let attempt = 0; attempt < 10; attempt++) await quota.consumeContentPolicyAttempt(id);
    }
    await expect(async () => quota.consumeContentPolicyAttempt(cofounder)).rejects.toMatchObject({ status: 429 });
    expect((await f.db.prepare("SELECT attempts FROM content_policy_limits WHERE scope='global'").get())?.attempts).toBe(200);
    await f.db.prepare("UPDATE content_policy_limits SET window_start=0").run();
    await quota.consumeContentPolicyAttempt(owner);
    expect((await f.db.prepare("SELECT attempts FROM content_policy_limits WHERE scope='global'").get())?.attempts).toBe(1);
    await f.db.prepare("UPDATE profiles SET is_banned=1 WHERE id=?").run(owner);
    await expect(async () => quota.consumeContentPolicyAttempt(owner)).rejects.toMatchObject({ status: 503 });
  } finally { await f.close(); }
});