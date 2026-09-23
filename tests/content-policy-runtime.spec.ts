import { expect, test } from "@playwright/test";
import { sqliteRuntime, owner, cofounder, locationId, publicOrigin } from "./helpers/sqlite-runtime";
import { POLICY_TEXT } from "../src/modules/content-policy/policy";
import { PHOTO_LIMITS } from "../src/modules/photos/policy";
import { transaction } from "../database/store.mjs";
import type { DatabaseSync } from "node:sqlite";

function fixture() {
  const state = {
    aiCalls: 0, uploads: 0, deletes: 0, offline: false, cleanupFailure: false, uncertain: false,
    decisions: { decision: "approve", code: "allowed" } as unknown,
    aiWait: Promise.resolve(), onAi: () => {},
  };
  const f = sqliteRuntime({
    "@/modules/ai/server/client": { requestStructuredOutput: async () => {
      state.aiCalls++; state.onAi(); await state.aiWait;
      if (state.offline) throw new Error("PRIVATE provider diagnostic");
      return state.decisions;
    } },
    "@/modules/photos/server/normalize": { normalizePhoto: async () => new Uint8Array([1]) },
    "@/modules/reports/server/imageStorage": {
      uploadReportImage: async () => { state.uploads++; return "private/image.webp"; },
      deleteReportImage: async () => { state.deletes++; if (state.cleanupFailure) throw new Error("PRIVATE storage diagnostic"); },
    },
    "@/lib/db/server": {
      database: () => f.db,
      writeTransaction: <T>(work: (db: DatabaseSync) => T) => {
        const result = transaction(f.db, work);
        if (state.uncertain && f.db.prepare("SELECT count(*) AS total FROM reports").get()?.total) {
          throw new AggregateError([new Error("Uncertain commit")], "Rollback unconfirmed");
        }
        return result;
      },
    },
  });
  const reports = f.load<typeof import("../src/app/api/reports/route")>("src/app/api/reports/route.ts");
  const usernames = f.load<typeof import("../src/app/api/profile/username/route")>("src/app/api/profile/username/route.ts");
  function report(text = "The signage was unclear and the fee was too high.", fields: Record<string, string> = {}, size = 10, type = "image/png") {
    const body = new FormData();
    body.set("locationId", locationId);
    body.set("reporterType", "witness");
    body.set("description", text);
    body.set("image", new File([new Uint8Array(size)], "fixture.png", { type }));
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return f.request("/api/reports", { method: "POST", body });
  }
  function username(value: unknown = { username: "new_walker" }) {
    return f.request("/api/profile/username", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  }
  return { ...f, state, reports, usernames, report, username };
}

test("cookie authentication and bounded input precede inference, upload and report creation", async () => {
  const f = fixture();
  try {
    expect((await f.reports.POST(new Request(publicOrigin, { method: "POST" }))).status).toBe(401);
    const invalidFields: Record<string, string>[] = [{ locationId: "invalid" }, { reporterType: "admin" }, { incidentDate: "2026-02-30" }];
    for (const fields of invalidFields) {
      expect((await f.reports.POST(f.report("A factual note.", fields))).status).toBe(400);
    }
    expect((await f.reports.POST(f.report("x".repeat(2001)))).status).toBe(400);
    for (const body of [{ username: "valid_name", userId: "injected" }, {}, null, { username: "a".repeat(25) }]) {
      expect((await f.usernames.PUT(f.username(body))).status).toBe(400);
    }
    expect(f.state.aiCalls).toBe(0);
    expect(f.state.uploads).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS total FROM content_policy_limits").get()?.total).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS total FROM reports").get()?.total).toBe(0);
  } finally { f.db.close(); }
});

test("policy rejection, malformed AI output and failures never upload or bypass paid-request reservations", async () => {
  const f = fixture();
  try {
    const cheap = await f.reports.POST(f.report("fuck"));
    expect(cheap.status).toBe(422);
    expect(await cheap.json()).toMatchObject({ classification: { decision: "blocked", text: POLICY_TEXT.profanity } });
    expect(f.state.aiCalls).toBe(0);
    f.state.decisions = { decision: "blocked", code: "abuse" };
    expect((await f.reports.POST(f.report())).status).toBe(422);
    f.state.decisions = { decision: "approve", code: "allowed", injected: true };
    expect((await f.reports.POST(f.report())).status).toBe(503);
    f.state.offline = true;
    const failed = await f.reports.POST(f.report());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("PRIVATE");
    expect(f.db.prepare("SELECT attempts FROM content_policy_limits WHERE scope='global'").get()?.attempts).toBe(3);
    expect(f.state.uploads).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS total FROM reports").get()?.total).toBe(0);
  } finally { f.db.close(); }
});

test("approved normalized notes remain pending and forged approval objects cannot insert or rename", async () => {
  const f = fixture();
  try {
    const response = await f.reports.POST(f.report("  The fee was unfair.\nPoor service. "));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved).toMatchObject({ moderation_status: "pending", has_image: true });
    expect(saved).not.toHaveProperty("description_raw");
    expect(f.db.prepare("SELECT description_raw,moderation_status,reviewed_at FROM reports").get()).toEqual({
      description_raw: "The fee was unfair. Poor service.", moderation_status: "pending", reviewed_at: null,
    });
    const repo = f.load<typeof import("../src/modules/reports/server/repository")>("src/modules/reports/server/repository.ts");
    await expect(Promise.resolve(repo.createReport({
      locationId, userId: owner, reporterType: "witness", incidentDate: null, imagePath: null,
      approvedDescription: { kind: "report_note", text: "Forged pass" },
    }))).rejects.toThrow("temporarily unavailable");
    const profiles = f.load<typeof import("../src/modules/auth/server/profile")>("src/modules/auth/server/profile.ts");
    await expect(Promise.resolve(profiles.savePublicIdentity(owner, { kind: "username", text: "forged_name" }))).rejects.toThrow();
    expect(f.db.prepare("SELECT count(*) AS total FROM reports").get()?.total).toBe(1);
  } finally { f.db.close(); }
});

test("checked pseudonym onboarding is mandatory, unique and excludes Google metadata", async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE profiles SET display_name=NULL,username_policy_checked_at=NULL WHERE id=?").run(owner);
    expect(await (await f.usernames.GET(f.request("/api/profile/username"))).json()).toEqual({ username: null, needsOnboarding: true });
    expect((await f.reports.POST(f.report())).status).toBe(409);
    expect(f.state.aiCalls).toBe(0);
    expect(await (await f.usernames.PUT(f.username({ username: "River_Trail" }))).json()).toEqual({ username: "river_trail", needsOnboarding: false });
    expect((await f.usernames.PUT(f.username({ username: "park_walker" }))).status).toBe(409);
    expect((await f.usernames.PUT(f.username({ username: "admin" }))).status).toBe(422);
    expect(f.db.prepare("SELECT display_name FROM profiles WHERE id=?").get(cofounder)?.display_name).toBe("park_walker");
    const calls = f.state.aiCalls;
    f.db.prepare("UPDATE profiles SET is_banned=1 WHERE id=?").run(owner);
    expect((await f.reports.POST(f.report())).status).toBe(401);
    expect((await f.usernames.PUT(f.username())).status).toBe(401);
    expect(f.state.aiCalls).toBe(calls);
  } finally { f.db.close(); }
});

test("quota exhaustion and unavailable quota storage stop both mutation paths", async () => {
  const f = fixture();
  try {
    const quota = f.load<typeof import("../src/modules/content-policy/server/rateLimit")>("src/modules/content-policy/server/rateLimit.ts");
    for (let n = 0; n < 10; n++) await quota.consumeContentPolicyAttempt(owner);
    expect((await f.reports.POST(f.report())).status).toBe(429);
    expect((await f.usernames.PUT(f.username())).status).toBe(429);
    f.db.exec("DROP TABLE content_policy_limits");
    expect((await f.reports.POST(f.report())).status).toBe(503);
    expect((await f.usernames.PUT(f.username())).status).toBe(503);
    expect(f.state.aiCalls).toBe(0);
    expect(f.state.uploads).toBe(0);
  } finally { f.db.close(); }
});

test("50 MiB image and streamed body boundaries apply even when content length lies", async () => {
  const f = fixture();
  try {
    const json = JSON.stringify({ username: "new_walker" });
    const name = (bytes: number) => f.usernames.PUT(f.request("/api/profile/username", { method: "PUT", body: json.padEnd(bytes) }));
    expect((await name(256)).status).toBe(200);
    expect((await name(257)).status).toBe(400);
    const oversized = f.request("/api/reports", {
      method: "POST", headers: { "Content-Length": "1" }, body: new Uint8Array(PHOTO_LIMITS.sourceBytes + 1024 * 1024 + 1),
    });
    expect((await f.reports.POST(oversized)).status).toBe(400);
    expect((await f.reports.POST(f.report("A factual note.", {}, PHOTO_LIMITS.sourceBytes))).status).toBe(200);
    expect((await f.reports.POST(f.report("A factual note.", {}, PHOTO_LIMITS.sourceBytes + 1))).status).toBe(413);
    expect((await f.reports.POST(f.report("A factual note.", {}, 10, "text/plain"))).status).toBe(400);
    expect(f.state.aiCalls).toBe(2);
    expect(f.state.uploads).toBe(1);
  } finally { f.db.close(); }
});

test("failed insert cleanup only deletes confirmed rollbacks and never uncertain committed evidence", async () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT,'fixture insert failure'); END");
    expect((await f.reports.POST(f.report())).status).toBe(503);
    expect(f.state.deletes).toBe(1);
    f.state.cleanupFailure = true;
    expect((await f.reports.POST(f.report())).status).toBe(503);
    expect(f.state.deletes).toBe(2);
    expect(JSON.stringify(f.logs)).toContain("cleanup failed");
    f.db.exec("DROP TRIGGER reject_insert");
    f.state.uncertain = true;
    expect((await f.reports.POST(f.report())).status).toBe(503);
    expect(f.state.deletes).toBe(2);
    expect(f.db.prepare("SELECT count(*) AS total FROM reports").get()?.total).toBe(1);
    expect(JSON.stringify(f.logs)).toContain("retained for reconciliation");
    expect(JSON.stringify(f.logs)).not.toContain("PRIVATE");
  } finally { f.db.close(); }
});

test("report admission serializes bodies and releases after a failed inference", async () => {
  const f = fixture();
  try {
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    f.state.aiWait = resume.promise; f.state.onAi = entered.resolve;
    const first = f.reports.POST(f.report());
    await entered.promise;
    const second = await f.reports.POST(f.report());
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("10");
    f.state.offline = true; resume.resolve();
    expect((await first).status).toBe(503);
    f.state.offline = false;
    expect((await f.reports.POST(f.report())).status).toBe(200);
  } finally { f.db.close(); }
});

test("duplicate images and empty images fail before quota and inference", async () => {
  const f = fixture();
  try {
    const body = await f.report().formData();
    body.append("image", new File(["another"], "second.png", { type: "image/png" }));
    expect((await f.reports.POST(f.request("/api/reports", { method: "POST", body }))).status).toBe(400);
    body.set("image", new File([], "empty.png", { type: "image/png" }));
    expect((await f.reports.POST(f.request("/api/reports", { method: "POST", body }))).status).toBe(413);
    expect(f.state.aiCalls).toBe(0);
    expect(f.state.uploads).toBe(0);
  } finally { f.db.close(); }
});
