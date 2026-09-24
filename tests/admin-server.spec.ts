import { expect, test } from "@playwright/test";
import { sqlRuntime, owner, outsider, locationId } from "./helpers/sql-runtime";

test("admin overview authenticates before real Azure SQL counts and reports storage failure explicitly", async () => {
  const f = await sqlRuntime();
  try {
    await f.report({ status: "pending" });
    const removed = await f.report({ status: "pending" });
    await f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(removed);
    await f.report();
    await f.report({ status: "rejected" });
    const route = f.load<typeof import("../apps/admin/src/app/api/admin/overview/route")>("apps/admin/src/app/api/admin/overview/route.ts");
    expect((await route.GET(await f.request("/api/admin/overview", {}, outsider, "admin"))).status).toBe(403);
    const request = await f.request("/api/admin/overview", {}, owner, "admin");
    const response = await route.GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ pending: 1, published: 1, rejected: 1, totalReports: 4, totalUsers: 4, autoPublished: 0 });
    await f.pool.close();
    const failure = await route.GET(request);
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: expect.any(String) });
  } finally { await f.close(); }
});

test("private photo errors block approval; successful review atomically publishes and recomputes score", async () => {
  let missing = true;
  const f = await sqlRuntime({
    "@/modules/reports/server/imageStorage": { getSignedImageUrl: async () => {
      if (missing) throw new Error("Storage unavailable");
      return "https://private.fixture.invalid/synthetic-signed-photo";
    } },
  });
  try {
    const id = await f.report({ status: "pending", photo: "private/photo.webp" });
    const repo = f.load<typeof import("../src/modules/moderation/server/repository")>("src/modules/moderation/server/repository.ts");
    const rows = await repo.listPendingReports();
    expect(rows[0]).toMatchObject({ hasImage: true, imageUrl: null, imageError: expect.stringContaining("Approval is blocked") });
    await expect(async () => repo.approveReport(id, "Reviewed wording.", owner)).rejects.toThrow("Storage unavailable");
    expect((await f.db.prepare("SELECT moderation_status FROM reports WHERE id=?").get(id))?.moderation_status).toBe("pending");
    missing = false;
    await expect(async () => repo.approveReport(id, "Reviewed wording.", outsider)).rejects.toThrow("administrator");
    await repo.approveReport(id, "Reviewed wording.", owner);
    expect(await f.db.prepare("SELECT report_count,risk_score FROM locations WHERE id=?").get(locationId)).toMatchObject({ report_count: 1, risk_score: expect.any(Number) });
    expect(await f.db.prepare("SELECT description,description_raw FROM reports WHERE id=?").get(id)).toEqual({ description: "Reviewed wording.", description_raw: "PRIVATE ORIGINAL" });
    await expect(async () => repo.approveReport(id, "Repeated approval.", owner)).rejects.toThrow("pending");
    const rejected = await f.report({ status: "pending" });
    await repo.rejectReport(rejected);
    expect(await f.db.prepare("SELECT moderation_status,is_removed FROM reports WHERE id=?").get(rejected)).toMatchObject({ moderation_status: "rejected", is_removed: true });
    expect((await f.db.prepare("SELECT report_count FROM locations WHERE id=?").get(locationId))?.report_count).toBe(1);
  } finally { await f.close(); }
});

test("redacted approval publishes the redacted copy and keeps the original private, rolling back the upload if the report changed mid-flight", async () => {
  const uploads: { bytes: Uint8Array; ownerId: string }[] = [];
  const deletedPaths: string[] = [];
  let mutateOnDownload: (() => Promise<void>) | null = null;
  const f = await sqlRuntime({
    "@/modules/reports/server/imageStorage": {
      getSignedImageUrl: async () => "https://private.fixture.invalid/synthetic-signed-photo",
      downloadReportImage: async () => {
        if (mutateOnDownload) await mutateOnDownload();
        return new Uint8Array([1, 2, 3, 4]);
      },
      uploadReportImage: async (bytes: Uint8Array, ownerId: string) => {
        uploads.push({ bytes, ownerId });
        return `reports/${ownerId}/redacted-${uploads.length}.webp`;
      },
      deleteReportImage: async (path: string) => { deletedPaths.push(path); },
    },
    "./redact": { redactImage: async () => new Uint8Array([9, 9, 9]) },
  });
  try {
    const repo = f.load<typeof import("../src/modules/moderation/server/repository")>("src/modules/moderation/server/repository.ts");
    const region = { x: 0, y: 0, width: 0.2, height: 0.2, mode: "blackout" as const };

    const id = await f.report({ status: "pending", photo: "private/original.webp", user: owner });
    await repo.approveReport(id, "Reviewed wording.", owner, [region]);
    expect(uploads).toEqual([{ bytes: new Uint8Array([9, 9, 9]), ownerId: owner }]);
    expect(await f.db.prepare("SELECT image_url,original_image_url,moderation_status FROM reports WHERE id=?").get(id)).toEqual({
      image_url: `reports/${owner}/redacted-1.webp`, original_image_url: "private/original.webp", moderation_status: "published",
    });

    const racedId = await f.report({ status: "pending", photo: "private/raced.webp", user: owner });
    mutateOnDownload = async () => { await f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(racedId); };
    await expect(async () => repo.approveReport(racedId, "Reviewed wording.", owner, [region])).rejects.toThrow("changed");
    expect(deletedPaths).toEqual([`reports/${owner}/redacted-2.webp`]);
    expect(await f.db.prepare("SELECT image_url,original_image_url,moderation_status FROM reports WHERE id=?").get(racedId)).toMatchObject({
      image_url: "private/raced.webp", original_image_url: null, moderation_status: "pending",
    });
  } finally { await f.close(); }
});
