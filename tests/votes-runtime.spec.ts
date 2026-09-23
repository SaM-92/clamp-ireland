import { expect, test } from "@playwright/test";
import { sqliteRuntime, owner, outsider, publicOrigin } from "./helpers/sqlite-runtime";

test("cookie vote routes reject forged identities, invalid payloads and unavailable notes", async () => {
  const f = sqliteRuntime();
  try {
    const id = f.report();
    const writer = f.load<typeof import("../src/app/api/report-votes/[id]/route")>("src/app/api/report-votes/[id]/route.ts");
    const reader = f.load<typeof import("../src/app/api/report-votes/route")>("src/app/api/report-votes/route.ts");
    const put = (body: unknown) => writer.PUT(f.request(`/api/report-votes/${id}`, {
      method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
    }), { params: Promise.resolve({ id }) });
    expect((await writer.PUT(new Request(publicOrigin, { method: "PUT", headers: { Authorization: "Bearer forged" }, body: '{"vote":"agree"}' }),
      { params: Promise.resolve({ id }) })).status).toBe(401);
    for (const body of [{}, { vote: 1 }, { vote: "other" }, { vote: "agree", userId: outsider }]) expect((await put(body)).status).toBe(400);
    for (const vote of ["agree", "disagree", null]) {
      const response = await put({ vote });
      expect(response.status).toBe(200);
      expect(response.headers.get("vary")).toBe("Cookie");
      expect(await response.json()).toEqual({ reportId: id, vote, agreeCount: vote === "agree" ? 1 : 0, disagreeCount: vote === "disagree" ? 1 : 0 });
    }
    const read = await reader.GET(f.request(`/api/report-votes?reportIds=${id}&userId=${outsider}`));
    expect(await read.json()).toEqual({ votes: [{ reportId: id, vote: null }] });
    for (const query of ["", "reportIds=no", `reportIds=${id},${id}`, `reportIds=${Array(51).fill(id).join(",")}`]) {
      expect((await reader.GET(f.request(`/api/report-votes?${query}`))).status).toBe(400);
    }
    f.db.prepare("UPDATE reports SET is_removed=1 WHERE id=?").run(id);
    expect((await put({ vote: "agree" })).status).toBe(404);
    f.db.prepare("UPDATE profiles SET is_banned=1 WHERE id=?").run(owner);
    expect((await put({ vote: "agree" })).status).toBe(401);
  } finally { f.db.close(); }
});
