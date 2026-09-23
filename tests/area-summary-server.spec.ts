import { expect, test } from "@playwright/test";
import { sqlRuntime, owner } from "./helpers/sql-runtime";

test("Azure SQL summary repository propagates storage failures instead of inventing absence", async () => {
  const f = await sqlRuntime();
  try {
    const repo = f.load<typeof import("../src/modules/area-summaries/server/repository")>("src/modules/area-summaries/server/repository.ts");
    const spot = { latitude: 53.3, longitude: -6.2 };
    await f.report();
    const state = await repo.getAreaSummarySources(spot);
    const id = await repo.saveAreaSummaryDraft(spot, state.source_fingerprint, { sentence: "Reports mention parking permits." });
    await repo.reviewAreaSummary(id, owner, "rejected");
    expect(await repo.getPublicAreaSummary(spot)).toBeNull();
    await expect(async () => repo.getAreaSummarySources({ latitude: 91, longitude: 0 })).rejects.toThrow();
    await f.pool.close();
    await expect(async () => repo.getPublicAreaSummary(spot)).rejects.toThrow();
    await expect(async () => repo.getAreaSummarySources(spot)).rejects.toThrow();
  } finally { await f.close(); }
});
