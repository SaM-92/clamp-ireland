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
    expect(rows[0]).toMatchObject({ hasImage: true, photos: [{ imageUrl: null, imageError: expect.stringContaining("Approval is blocked") }] });
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
    await repo.approveReport(id, "Reviewed wording.", owner, [{ redactions: [region] }]);
    expect(uploads).toEqual([{ bytes: new Uint8Array([9, 9, 9]), ownerId: owner }]);
    expect(await f.db.prepare("SELECT image_url,original_image_url,moderation_status FROM reports WHERE id=?").get(id)).toEqual({
      image_url: `reports/${owner}/redacted-1.webp`, original_image_url: "private/original.webp", moderation_status: "published",
    });

    const racedId = await f.report({ status: "pending", photo: "private/raced.webp", user: owner });
    mutateOnDownload = async () => { await f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(racedId); };
    await expect(async () => repo.approveReport(racedId, "Reviewed wording.", owner, [{ redactions: [region] }])).rejects.toThrow("changed");
    expect(deletedPaths).toEqual([`reports/${owner}/redacted-2.webp`]);
    expect(await f.db.prepare("SELECT image_url,original_image_url,moderation_status FROM reports WHERE id=?").get(racedId)).toMatchObject({
      image_url: "private/raced.webp", original_image_url: null, moderation_status: "pending",
    });
  } finally { await f.close(); }
});

test("a replacement photo publishes as-is (no redaction pass) and keeps the original evidence private for audit", async () => {
  const uploads: { bytes: Uint8Array; ownerId: string }[] = [];
  let downloadCalled = false;
  let redactCalled = false;
  const f = await sqlRuntime({
    "@/modules/reports/server/imageStorage": {
      getSignedImageUrl: async () => "https://private.fixture.invalid/synthetic-signed-photo",
      downloadReportImage: async () => { downloadCalled = true; return new Uint8Array([1, 2, 3, 4]); },
      uploadReportImage: async (bytes: Uint8Array, ownerId: string) => {
        uploads.push({ bytes, ownerId });
        return `reports/${ownerId}/replacement-${uploads.length}.webp`;
      },
      deleteReportImage: async () => {},
    },
    "./redact": { redactImage: async () => { redactCalled = true; return new Uint8Array([9, 9, 9]); } },
  });
  try {
    const repo = f.load<typeof import("../src/modules/moderation/server/repository")>("src/modules/moderation/server/repository.ts");
    const replacement = new Uint8Array([5, 5, 5]);
    const id = await f.report({ status: "pending", photo: "private/original.webp", user: owner });
    await repo.approveReport(id, "Reviewed wording.", owner, [{ replacementPhoto: replacement }]);
    expect(downloadCalled).toBe(false);
    expect(redactCalled).toBe(false);
    expect(uploads).toEqual([{ bytes: replacement, ownerId: owner }]);
    expect(await f.db.prepare("SELECT image_url,original_image_url,moderation_status FROM reports WHERE id=?").get(id)).toEqual({
      image_url: `reports/${owner}/replacement-1.webp`, original_image_url: "private/original.webp", moderation_status: "published",
    });
  } finally { await f.close(); }
});

test("up to 3 photos per report: each is reviewed and edited independently, and only sort_order 0 mirrors onto reports.image_url", async () => {
  const uploads: { bytes: Uint8Array; ownerId: string }[] = [];
  const f = await sqlRuntime({
    "@/modules/reports/server/imageStorage": {
      getSignedImageUrl: async (path: string) => `https://private.fixture.invalid/${path}`,
      downloadReportImage: async () => new Uint8Array([1, 2, 3, 4]),
      uploadReportImage: async (bytes: Uint8Array, ownerId: string) => {
        uploads.push({ bytes, ownerId });
        return `reports/${ownerId}/edited-${uploads.length}.webp`;
      },
      deleteReportImage: async () => {},
    },
    "./redact": { redactImage: async () => new Uint8Array([7, 7, 7]) },
  });
  try {
    const repo = f.load<typeof import("../src/modules/moderation/server/repository")>("src/modules/moderation/server/repository.ts");
    const id = await f.report({ status: "pending", photo: "private/photo-0.webp", user: owner });
    await f.db.prepare("INSERT INTO report_photos(id,report_id,sort_order,image_url) VALUES ('photo-1',?,1,'private/photo-1.webp')").run(id);
    await f.db.prepare("INSERT INTO report_photos(id,report_id,sort_order,image_url) VALUES ('photo-2',?,2,'private/photo-2.webp')").run(id);

    const rows = await repo.listPendingReports();
    expect(rows[0].photos).toEqual([
      { imageUrl: "https://private.fixture.invalid/private/photo-0.webp", imageError: null },
      { imageUrl: "https://private.fixture.invalid/private/photo-1.webp", imageError: null },
      { imageUrl: "https://private.fixture.invalid/private/photo-2.webp", imageError: null },
    ]);

    const region = { x: 0, y: 0, width: 0.2, height: 0.2, mode: "blur" as const };
    const replacement = new Uint8Array([9, 9, 9]);
    // Photo 0 (sort_order 0) is left unchanged; photo 1 is redacted; photo 2 is replaced outright.
    await repo.approveReport(id, "Reviewed wording.", owner, [undefined, { redactions: [region] }, { replacementPhoto: replacement }]);

    expect(await f.db.prepare("SELECT image_url,original_image_url FROM reports WHERE id=?").get(id)).toEqual({
      image_url: "private/photo-0.webp", original_image_url: null,
    });
    const photoRows = await f.db.prepare("SELECT sort_order,image_url,original_image_url FROM report_photos WHERE report_id=? ORDER BY sort_order").all(id);
    expect(photoRows).toEqual([
      { sort_order: 0, image_url: "private/photo-0.webp", original_image_url: null },
      { sort_order: 1, image_url: `reports/${owner}/edited-1.webp`, original_image_url: "private/photo-1.webp" },
      { sort_order: 2, image_url: `reports/${owner}/edited-2.webp`, original_image_url: "private/photo-2.webp" },
    ]);
  } finally { await f.close(); }
});
