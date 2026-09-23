import { expect, test } from "@playwright/test";
import { sqlRuntime, owner, cofounder } from "./helpers/sql-runtime";

test("votes are idempotent, account-specific, bounded and cannot vote on private notes", async () => {
  const f = await sqlRuntime();
  try {
    const id = await f.report();
    const pending = await f.report({ status: "pending" });
    const repo = f.load<typeof import("../src/modules/votes/server/repository")>("src/modules/votes/server/repository.ts");
    for (let n = 0; n < 3; n++) {
      expect(await repo.setReportVote(id, owner, "agree")).toEqual({ reportId: id, vote: "agree", agreeCount: 1, disagreeCount: 0 });
    }
    await repo.setReportVote(id, cofounder, "disagree");
    expect(await repo.setReportVote(id, owner, "disagree")).toMatchObject({ agreeCount: 0, disagreeCount: 2 });
    expect(await repo.getOwnReportVotes([id], owner)).toEqual([{ reportId: id, vote: "disagree" }]);
    expect(await repo.setReportVote(id, owner, null)).toMatchObject({ vote: null, agreeCount: 0, disagreeCount: 1 });
    expect(await repo.setReportVote(id, owner, null)).toMatchObject({ vote: null, disagreeCount: 1 });
    await expect(async () => repo.setReportVote(pending, owner, "agree")).rejects.toThrow("no longer available");
    await expect(async () => repo.getOwnReportVotes(Array(51).fill(id), owner)).rejects.toThrow();
    await f.db.prepare("UPDATE profiles SET is_banned=1 WHERE id=?").run(owner);
    await expect(async () => repo.setReportVote(id, owner, "agree")).rejects.toThrow("Sign in");
    await f.db.prepare("DELETE FROM reports WHERE id=?").run(id);
    expect((await f.db.prepare("SELECT count(*) AS total FROM report_votes").get())?.total).toBe(0);
  } finally { await f.close(); }
});

