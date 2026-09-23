import { expect, test } from "@playwright/test";
import { sqliteRuntime, owner, outsider, locationId } from "./helpers/sqlite-runtime";

test("admin overview authenticates before real SQLite counts and reports storage failure explicitly", async () => {
  const f = sqliteRuntime();
  try {
    f.report({ status: "pending" });
    const removed = f.report({ status: "pending" });
    f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(removed);
    f.report();
    f.report({ status: "rejected" });
    const route = f.load<typeof import("../apps/admin/src/app/api/admin/overview/route")>("apps/admin/src/app/api/admin/overview/route.ts");
    expect((await route.GET(f.request("/api/admin/overview", {}, outsider, "admin"))).status).toBe(403);
    const request = f.request("/api/admin/overview", {}, owner, "admin");
    const response = await route.GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ pending: 1, published: 1, rejected: 1, totalReports: 4, totalUsers: 3 });
    f.db.close();
    const failure = await route.GET(request);
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: expect.any(String) });
  } finally { if (f.db.isOpen) f.db.close(); }
});

test("private photo errors block approval; successful review atomically publishes and recomputes score", async () => {
  let missing = true;
  const f = sqliteRuntime({
    "@/modules/reports/server/imageStorage": { getSignedImageUrl: async () => {
      if (missing) throw new Error("Storage unavailable");
      return "https://private.fixture.invalid/synthetic-signed-photo";
    } },
  });
  try {
    const id = f.report({ status: "pending", photo: "private/photo.webp" });
    const repo = f.load<typeof import("../src/modules/moderation/server/repository")>("src/modules/moderation/server/repository.ts");
    const rows = await repo.listPendingReports();
    expect(rows[0]).toMatchObject({ hasImage: true, imageUrl: null, imageError: expect.stringContaining("Approval is blocked") });
    await expect(Promise.resolve(repo.approveReport(id, "Reviewed wording.", owner))).rejects.toThrow("Storage unavailable");
    expect(f.db.prepare("SELECT moderation_status FROM reports WHERE id=?").get(id)?.moderation_status).toBe("pending");
    missing = false;
    await expect(Promise.resolve(repo.approveReport(id, "Reviewed wording.", outsider))).rejects.toThrow("administrator");
    await repo.approveReport(id, "Reviewed wording.", owner);
    expect(f.db.prepare("SELECT report_count,risk_score FROM locations WHERE id=?").get(locationId)).toMatchObject({ report_count: 1, risk_score: expect.any(Number) });
    expect(f.db.prepare("SELECT description,description_raw FROM reports WHERE id=?").get(id)).toEqual({ description: "Reviewed wording.", description_raw: "PRIVATE ORIGINAL" });
    await expect(Promise.resolve(repo.approveReport(id, "Repeated approval.", owner))).rejects.toThrow("pending");
    const rejected = f.report({ status: "pending" });
    await repo.rejectReport(rejected);
    expect(f.db.prepare("SELECT moderation_status,is_removed FROM reports WHERE id=?").get(rejected)).toMatchObject({ moderation_status: "rejected", is_removed: 1 });
    expect(f.db.prepare("SELECT report_count FROM locations WHERE id=?").get(locationId)?.report_count).toBe(1);
  } finally { f.db.close(); }
});
