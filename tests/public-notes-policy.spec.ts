import { expect, test } from "@playwright/test";
import { sqlRuntime, locationId, owner } from "./helpers/sql-runtime";

test("public notes exclude unreviewed, rejected, removed and every private field", async () => {
  const f = await sqlRuntime();
  try {
    const published = await f.report();
    await f.report({ status: "pending" });
    await f.report({ status: "rejected" });
    const removed = await f.report();
    await f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(removed);
    await expect(async () => f.db.prepare("UPDATE reports SET reviewed_at=NULL WHERE id=?").run(published)).rejects.toThrow();
    const rows = await f.db.prepare("SELECT * FROM reports_public").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(published);
    for (const name of ["user_id", "description_raw", "image_url", "reviewed_by", "has_image"]) expect(rows[0]).not.toHaveProperty(name);
    const route = f.load<typeof import("../src/app/api/locations/[id]/reports/route")>("src/app/api/locations/[id]/reports/route.ts");
    const response = await route.GET(new Request("https://public.fixture.invalid"), { params: Promise.resolve({ id: locationId }) });
    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({
      id: published, reporterType: "witness", description: "Parking permits are mentioned.", incidentDate: null,
      createdAt: expect.any(String), voteCounts: { agreeCount: 0, disagreeCount: 0 },
    });
    expect(JSON.stringify(data)).not.toContain(owner);
    expect(JSON.stringify(data)).not.toContain("PRIVATE");
  } finally { await f.close(); }
});