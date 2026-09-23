import { expect, test } from "@playwright/test";
import { sqliteRuntime, owner } from "./helpers/sqlite-runtime";

test("SQLite summary repository propagates storage failures instead of inventing absence", async () => {
  const f = sqliteRuntime();
  const repo = f.load<typeof import("../src/modules/area-summaries/server/repository")>("src/modules/area-summaries/server/repository.ts");
  const spot = { latitude: 53.3, longitude: -6.2 };
  f.report();
  const state = await repo.getAreaSummarySources(spot);
  const id = await repo.saveAreaSummaryDraft(spot, state.source_fingerprint, { sentence: "Reports mention parking permits." });
  await repo.reviewAreaSummary(id, owner, "rejected");
  expect(await repo.getPublicAreaSummary(spot)).toBeNull();
  await expect(Promise.resolve(repo.getAreaSummarySources({ latitude: 91, longitude: 0 }))).rejects.toThrow();
  f.db.close();
  await expect(Promise.resolve(repo.getPublicAreaSummary(spot))).rejects.toThrow();
  await expect(Promise.resolve(repo.getAreaSummarySources(spot))).rejects.toThrow();
});
