import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import geodesic from "geographiclib-geodesic";
import { sqliteRuntime, owner, outsider, locationId } from "./helpers/sqlite-runtime";

const spot = { latitude: 53.3, longitude: -6.2 };
const sentence = "Reports mention parking permits.";
test("WGS84 summaries include 499/500 metres, exclude 501 and do not chain neighbouring circles", async () => {
  const f = sqliteRuntime();
  try {
    f.report();
    for (const metres of [499, 500, 501, 999]) {
      const point = geodesic.Geodesic.WGS84.Direct(spot.latitude, spot.longitude, 90, metres);
      if (point.lat2 === undefined || point.lon2 === undefined) throw new Error("Missing geodesic endpoint.");
      const id = randomUUID();
      f.db.prepare("INSERT INTO locations(id,lat,lng) VALUES (?,?,?)").run(id, point.lat2, point.lon2);
      f.report({ location: id, text: `Parking ${metres}` });
    }
    const repo = f.load<typeof import("../src/modules/area-summaries/server/repository")>("src/modules/area-summaries/server/repository.ts");
    const sources = await repo.getAreaSummarySources(spot);
    expect(sources.sources.map((source) => source.description).sort()).toEqual(["Parking 499", "Parking 500", "Parking permits are mentioned."]);
    expect(sources.source_count).toBe(3);
    expect(sources.sources.map((source) => source.report_id)).toEqual(sources.sources.map((source) => source.report_id).sort());
  } finally { f.db.close(); }
});

test("approval is atomic, current and human-only; votes never invalidate summaries", async () => {
  const f = sqliteRuntime();
  try {
    const report = f.report();
    const repo = f.load<typeof import("../src/modules/area-summaries/server/repository")>("src/modules/area-summaries/server/repository.ts");
    const fingerprint = (await repo.getAreaSummarySources(spot)).source_fingerprint;
    const id = await repo.saveAreaSummaryDraft(spot, fingerprint, { sentence });
    expect(await repo.saveAreaSummaryDraft(spot, fingerprint, { sentence })).toBe(id);
    expect(await repo.getPublicAreaSummary(spot)).toBeNull();
    await expect(Promise.resolve(repo.approveAreaSummaryDraft(id, outsider, "Reports mention signs.", fingerprint))).rejects.toThrow("administrator");
    expect(f.db.prepare("SELECT sentence,status FROM area_summaries WHERE id=?").get(id)).toMatchObject({ sentence, status: "draft" });
    await repo.approveAreaSummaryDraft(id, owner, sentence, fingerprint);
    const published = await repo.getPublicAreaSummary(spot);
    expect(published).toMatchObject({ id, sentence, source_count: 1, radius_metres: 500 });
    for (const key of ["source_fingerprint", "reviewed_by", "sources", "description_raw"]) expect(published).not.toHaveProperty(key);
    const votes = f.load<typeof import("../src/modules/votes/server/repository")>("src/modules/votes/server/repository.ts");
    await votes.setReportVote(report, owner, "agree");
    expect((await repo.getPublicAreaSummary(spot))?.id).toBe(id);
    const regenerated = await repo.saveAreaSummaryDraft(spot, fingerprint, { sentence: "Reports mention visitor permits." }, true);
    expect(regenerated).not.toBe(id);
    expect((await repo.getPublicAreaSummary(spot))?.sentence).toBe(sentence);
    f.db.prepare("UPDATE reports SET description='Changed wording' WHERE id=?").run(report);
    f.db.prepare("UPDATE reports SET description='Parking permits are mentioned.' WHERE id=?").run(report);
    expect(await repo.getPublicAreaSummary(spot)).toBeNull();
    expect(f.db.prepare("SELECT status FROM area_summaries WHERE id=?").get(id)?.status).toBe("stale");
    await expect(Promise.resolve(repo.approveAreaSummaryDraft(regenerated, owner, sentence, fingerprint))).rejects.toThrow("existing draft");
  } finally { f.db.close(); }
});

test("source membership, timestamps, geometry and deletion permanently stale nearby summaries", async () => {
  for (const change of ["insert", "remove", "reviewed", "move", "delete"] as const) {
    const f = sqliteRuntime();
    try {
      const report = f.report();
      const repo = f.load<typeof import("../src/modules/area-summaries/server/repository")>("src/modules/area-summaries/server/repository.ts");
      const state = await repo.getAreaSummarySources(spot);
      const id = await repo.saveAreaSummaryDraft(spot, state.source_fingerprint, { sentence });
      await repo.reviewAreaSummary(id, owner, "approved");
      if (change === "insert") f.report();
      if (change === "remove") f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(report);
      if (change === "reviewed") f.db.prepare("UPDATE reports SET reviewed_at='2026-01-01T00:00:00Z' WHERE id=?").run(report);
      if (change === "move") f.db.prepare("UPDATE locations SET lat=53.4 WHERE id=?").run(locationId);
      if (change === "delete") f.db.prepare("DELETE FROM locations WHERE id=?").run(locationId);
      expect(f.db.prepare("SELECT status FROM area_summaries WHERE id=?").get(id)?.status).toBe("stale");
      expect(await repo.getPublicAreaSummary(spot)).toBeNull();
    } finally { f.db.close(); }
  }
});

test("complete source limits, validated wording, stale fingerprints and lease cooldown fail explicitly", async () => {
  const f = sqliteRuntime();
  try {
    const repo = f.load<typeof import("../src/modules/area-summaries/server/repository")>("src/modules/area-summaries/server/repository.ts");
    await expect(Promise.resolve(repo.getAreaSummarySources(spot))).rejects.toThrow("No human-approved");
    f.report();
    const fp = (await repo.getAreaSummarySources(spot)).source_fingerprint;
    await expect(Promise.resolve(repo.saveAreaSummaryDraft(spot, "0".repeat(64), { sentence }))).rejects.toThrow("sources changed");
    await expect(Promise.resolve(repo.saveAreaSummaryDraft(spot, fp, { sentence, approved: true }))).rejects.toThrow();
    await expect(Promise.resolve(repo.saveAreaSummaryDraft(spot, fp, { sentence: "Reports mention " + "parking ".repeat(21) + "." }))).rejects.toThrow();
    const lease = await repo.acquireAreaSummaryGeneration(spot);
    await expect(Promise.resolve(repo.acquireAreaSummaryGeneration(spot))).rejects.toMatchObject({ status: 429 });
    await repo.releaseAreaSummaryGeneration(lease);
    await expect(Promise.resolve(repo.acquireAreaSummaryGeneration(spot))).rejects.toMatchObject({ status: 429 });
    f.db.prepare("UPDATE area_summary_generation_leases SET expires_at=0").run();
    expect(await repo.acquireAreaSummaryGeneration(spot)).not.toBe(lease);
    for (let n = 0; n < 200; n++) f.report();
    expect((await repo.getAreaSummarySourceState(spot)).source_count).toBe(201);
    await expect(Promise.resolve(repo.getAreaSummarySources(spot))).rejects.toThrow("resource limit");
    f.db.prepare("DELETE FROM reports").run();
    for (let n = 0; n < 25; n++) f.report({ text: "é".repeat(1000) });
    expect((await repo.getAreaSummarySourceState(spot)).source_bytes).toBe(50_000);
    await expect(Promise.resolve(repo.getAreaSummarySources(spot))).rejects.toThrow("resource limit");
  } finally { f.db.close(); }
});
