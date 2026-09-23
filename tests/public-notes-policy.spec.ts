import { expect, test } from "@playwright/test";
import { sqlRuntime, locationId, owner } from "./helpers/sql-runtime";

test("public notes exclude unreviewed, rejected, removed and every private field", async () => {
  // A human moderator approved this photo already, so a fixture signer stands in for the
  // real SAS-signing call (which needs a live Azure Storage account) - see imageStorage.ts.
  const f = await sqlRuntime({
    "@/modules/reports/server/imageStorage": {
      getSignedPublishedPhotoUrl: async (path: string) => `https://fixture.blob.invalid/signed?path=${encodeURIComponent(path)}&sas=fixture`,
    },
  });
  try {
    const published = await f.report();
    const publishedAnonymous = await f.report({ anonymous: true, nickname: "Dave" });
    const publishedWithPhoto = await f.report({ photo: "reports/10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002.webp" });
    await f.report({ status: "pending" });
    await f.report({ status: "rejected" });
    const removed = await f.report();
    await f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(removed);
    await expect(async () => f.db.prepare("UPDATE reports SET reviewed_at=NULL WHERE id=?").run(published)).rejects.toThrow();
    const rows = await f.db.prepare("SELECT * FROM reports_public").all();
    expect(rows).toHaveLength(3);
    // has_image/image_url/is_anonymous are now intentionally present on the view (needed to
    // sign published photos and label anonymous notes below); user_id, description_raw and
    // reviewed_by must still never be exposed.
    for (const row of rows) for (const name of ["user_id", "description_raw", "reviewed_by"]) expect(row).not.toHaveProperty(name);
    const route = f.load<typeof import("../src/app/api/locations/[id]/reports/route")>("src/app/api/locations/[id]/reports/route.ts");
    const response = await route.GET(new Request("https://public.fixture.invalid"), { params: Promise.resolve({ id: locationId }) });
    const data = await response.json();
    expect(data).toHaveLength(3);
    const withoutPhoto = data.find((note: { id: string }) => note.id === published);
    const anonymous = data.find((note: { id: string }) => note.id === publishedAnonymous);
    const withPhoto = data.find((note: { id: string }) => note.id === publishedWithPhoto);
    expect(withoutPhoto).toEqual({
      id: published, reporterType: "witness", description: "Parking permits are mentioned.", incidentDate: null,
      createdAt: expect.any(String), voteCounts: { agreeCount: 0, disagreeCount: 0 }, imageUrl: null, isAnonymous: false,
      nickname: null,
    });
    expect(anonymous.isAnonymous).toBe(true);
    expect(anonymous.nickname).toBe("Dave");
    expect(withPhoto.imageUrl).toBe("https://fixture.blob.invalid/signed?path=reports%2F10000000-0000-4000-8000-000000000001%2F20000000-0000-4000-8000-000000000002.webp&sas=fixture");
    expect(JSON.stringify(data)).not.toContain(owner);
    expect(JSON.stringify(data)).not.toContain("PRIVATE");
  } finally { await f.close(); }
});