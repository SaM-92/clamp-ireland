import { expect, test } from "@playwright/test";
import { policyRuntime } from "./helpers/content-policy-runtime";
import { POLICY_TEXT } from "../src/modules/content-policy/policy";

const userId = "20000000-0000-4000-8000-000000000001";
const locationId = "30000000-0000-4000-8000-000000000001";

function fixture() {
  const state = {
    aiCalls: 0, uploads: 0, decisions: { decision: "approve", code: "allowed" } as unknown,
    offline: false, rateError: false, capacity: true, banned: false, onboarding: false,
    writes: [] as Record<string, unknown>[], rpc: [] as { name: string; args: Record<string, unknown> }[],
    usernameWrites: [] as string[], profileFailure: false,
    usernameConflict: false,
  };
  const client = {
    auth: { getUser: async (token: string) => ({
      data: { user: ["confirmed", "unconfirmed"].includes(token) ? {
        id: userId, email: "PRIVATE@fixture.invalid",
        email_confirmed_at: token === "confirmed" ? "2026-09-22" : null,
        user_metadata: { full_name: "PRIVATE REAL NAME", username: "unapproved" },
      } : null }, error: null,
    }) },
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        insert: (record: Record<string, unknown>) => { state.writes.push(record); return query; },
        single: async () => table === "profiles"
          ? { data: state.profileFailure ? null : { display_name: state.onboarding ? "Anonymous Person" : "river_walker",
            username_policy_checked_at: state.onboarding ? null : "2026-09-22", is_banned: state.banned }, error: null }
          : { data: { id: locationId, ...state.writes.at(-1) }, error: null },
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpc.push({ name, args });
      if (name === "consume_content_policy_attempt") return {
        data: state.capacity, error: state.rateError ? { message: "PRIVATE missing migration" } : null,
      };
      if (name === "set_approved_username") {
        if (state.usernameConflict) return { data: null, error: { code: "23505", message: "PRIVATE unique index details" } };
        state.usernameWrites.push(args.p_username as string);
        return { data: args.p_username, error: null };
      }
      throw new Error("Unexpected RPC");
    },
  };
  const runtime = policyRuntime({
    "@/lib/env": { env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://unused.fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service_role", OPENAI_API_KEY: "",
    } },
    "@supabase/supabase-js": { createClient: () => client },
    "@/modules/ai/server/client": { requestStructuredOutput: async () => {
      state.aiCalls++;
      if (state.offline) throw new Error("PRIVATE provider body / access token");
      return state.decisions;
    } },
    "@/modules/reports/server/imageStorage": { uploadReportImage: async () => { state.uploads++; return "private/image.png"; } },
  });
  return { ...runtime, state,
    reports: runtime.load<typeof import("../src/app/api/reports/route")>("src/app/api/reports/route.ts"),
    usernames: runtime.load<typeof import("../src/app/api/profile/username/route")>("src/app/api/profile/username/route.ts"),
  };
}

function reportRequest(text = "The signage was unclear and the fee was too high.", token = "confirmed", fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set("locationId", locationId);
  form.set("reporterType", "witness");
  form.set("description", text);
  form.set("image", new File(["test fixture"], "evidence.png", { type: "image/png" }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/reports", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
}
function usernameRequest(body: unknown = { username: "River_Walker" }, token = "confirmed") {
  return new Request("http://localhost/api/profile/username", {
    method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("confirmed authentication and valid bounded input precede inference and every write", async () => {
  const f = fixture();
  for (const token of ["", "invalid", "unconfirmed"]) {
    expect((await f.reports.POST(reportRequest("A factual note.", token))).status).toBe(401);
    expect((await f.usernames.PUT(usernameRequest({ username: "river_walker" }, token))).status).toBe(401);
  }
  const invalidFields: Record<string, string>[] = [{ locationId: "invalid" }, { reporterType: "admin" }, { incidentDate: "2026-02-30" }];
  for (const fields of invalidFields) {
    expect((await f.reports.POST(reportRequest("A factual note.", "confirmed", fields))).status).toBe(400);
  }
  expect((await f.reports.POST(reportRequest("x".repeat(2001)))).status).toBe(400);
  for (const body of [{ username: "valid_name", userId: "injected" }, {}, null, { username: "a".repeat(25) }]) {
    expect((await f.usernames.PUT(usernameRequest(body))).status).toBe(400);
  }
  expect(f.state.aiCalls).toBe(0);
  expect(f.state.rpc).toEqual([]);
  expect(f.state.uploads).toBe(0);
  expect(f.state.writes).toEqual([]);
});

test("rejection and AI failure return safe distinct errors before upload or report insert", async () => {
  const f = fixture();
  const cheap = await f.reports.POST(reportRequest("fuck"));
  expect(cheap.status).toBe(422);
  expect(await cheap.json()).toEqual({
    code: "content_policy_rejected", error: POLICY_TEXT.profanity,
    classification: { decision: "blocked", text: POLICY_TEXT.profanity },
  });
  expect(f.state.aiCalls).toBe(0);
  expect(f.state.rpc).toEqual([]);
  f.state.decisions = { decision: "blocked", code: "abuse" };
  const blocked = await f.reports.POST(reportRequest("The attendant is a worthless person."));
  expect(blocked.status).toBe(422);
  expect(await blocked.json()).toMatchObject({ classification: { decision: "blocked", text: POLICY_TEXT.abuse } });
  f.state.offline = true;
  const failed = await f.reports.POST(reportRequest());
  expect(failed.status).toBe(503);
  expect(failed.headers.get("cache-control")).toBe("private, no-store");
  const unavailable = await failed.json();
  expect(unavailable).toMatchObject({ code: "content_policy_unavailable", error: expect.stringContaining("try again") });
  expect(unavailable).not.toHaveProperty("classification");
  expect(f.state.uploads).toBe(0);
  expect(f.state.writes).toEqual([]);
  expect(f.logs).toEqual([]);
});

test("unconfigured rate limiting and exhausted capacity cannot bypass the AI budget", async () => {
  const f = fixture();
  f.state.rateError = true;
  expect((await f.reports.POST(reportRequest())).status).toBe(503);
  expect((await f.usernames.PUT(usernameRequest())).status).toBe(503);
  f.state.rateError = false;
  f.state.capacity = false;
  expect((await f.reports.POST(reportRequest())).status).toBe(429);
  expect((await f.usernames.PUT(usernameRequest())).status).toBe(429);
  expect(f.state.aiCalls).toBe(0);
  expect(f.state.uploads).toBe(0);
  expect(f.state.writes).toEqual([]);
  expect(f.state.usernameWrites).toEqual([]);
});

test("approved normalized notes remain pending and the repository rejects forged approvals", async () => {
  const f = fixture();
  const response = await f.reports.POST(reportRequest("  The fee was unfair.\nPoor service. "));
  expect(response.status).toBe(200);
  expect(f.state.aiCalls).toBe(1);
  expect(f.state.uploads).toBe(1);
  expect(f.state.rpc).toEqual([{ name: "consume_content_policy_attempt", args: { p_user_id: userId } }]);
  expect(f.state.writes).toHaveLength(1);
  expect(f.state.writes[0]).toMatchObject({
    user_id: userId, description_raw: "The fee was unfair. Poor service.",
    moderation_status: "pending", image_url: "private/image.png",
  });
  expect(f.state.writes[0]).not.toHaveProperty("reviewed_at");
  const repository = f.load<typeof import("../src/modules/reports/server/repository")>("src/modules/reports/server/repository.ts");
  await expect(Promise.resolve(repository.createReport({
    locationId, userId, reporterType: "witness", incidentDate: null, imagePath: null,
    approvedDescription: { kind: "report_note", text: "Forged pass" },
  }))).rejects.toThrow("temporarily unavailable");
  expect(f.state.writes).toHaveLength(1);
});

test("legacy anonymous identities require real onboarding and never expose auth metadata", async () => {
  const f = fixture();
  f.state.onboarding = true;
  const get = await f.usernames.GET(new Request("http://localhost/api/profile/username", { headers: { Authorization: "Bearer confirmed" } }));
  expect(await get.json()).toEqual({ username: null, needsOnboarding: true });
  const response = await f.reports.POST(reportRequest());
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "username_required" });
  expect(f.state.aiCalls).toBe(0);
  expect(f.state.uploads).toBe(0);
  const saved = await f.usernames.PUT(usernameRequest());
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ username: "river_walker", needsOnboarding: false });
  expect(f.state.usernameWrites).toEqual(["river_walker"]);
  expect(f.state.rpc.at(-1)).toEqual({ name: "set_approved_username", args: { p_user_id: userId, p_username: "river_walker" } });
});

test("username abuse, provider malformation and banned accounts never write names", async () => {
  const f = fixture();
  expect((await f.usernames.PUT(usernameRequest({ username: "admin" }))).status).toBe(422);
  f.state.decisions = { decision: "blocked", code: "unsafe_username" };
  const rejected = await f.usernames.PUT(usernameRequest({ username: "john_smith" }));
  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toMatchObject({ classification: { decision: "blocked", text: POLICY_TEXT.unsafe_username } });
  f.state.decisions = { decision: "approve", code: "allowed", injected: true };
  expect((await f.usernames.PUT(usernameRequest())).status).toBe(503);
  const calls = f.state.aiCalls;
  f.state.banned = true;
  expect((await f.usernames.PUT(usernameRequest())).status).toBe(403);
  expect((await f.reports.POST(reportRequest())).status).toBe(403);
  expect(f.state.aiCalls).toBe(calls);
  expect(f.state.usernameWrites).toEqual([]);
  expect(f.state.uploads).toBe(0);
  expect(JSON.stringify(f.logs)).not.toContain("PRIVATE");
});

test("request byte and photo boundaries are enforced even when content length lies", async () => {
  const f = fixture();
  const usernameJson = JSON.stringify({ username: "river_walker" });
  const request = (text: string) => new Request("http://localhost/api/profile/username", {
    method: "PUT", headers: { Authorization: "Bearer confirmed" }, body: text,
  });
  expect((await f.usernames.PUT(request(usernameJson.padEnd(256)))).status).toBe(200);
  expect((await f.usernames.PUT(request(usernameJson.padEnd(257)))).status).toBe(400);
  expect(f.state.aiCalls).toBe(1);
  const oversized = new Request("http://localhost/api/reports", {
    method: "POST", headers: { Authorization: "Bearer confirmed", "Content-Length": "1" },
    body: new Uint8Array(9 * 1024 * 1024 + 1),
  });
  expect((await f.reports.POST(oversized)).status).toBe(400);
  expect(f.state.aiCalls).toBe(1);
  async function photo(size: number, type = "image/png") {
    const form = new FormData();
    form.set("locationId", locationId);
    form.set("reporterType", "witness");
    form.set("description", "A factual note.");
    form.set("image", new File([new Uint8Array(size)], "fixture.png", { type }));
    return f.reports.POST(new Request("http://localhost/api/reports", {
      method: "POST", headers: { Authorization: "Bearer confirmed" }, body: form,
    }));
  }
  expect((await photo(8 * 1024 * 1024)).status).toBe(200);
  expect((await photo(8 * 1024 * 1024 + 1)).status).toBe(400);
  expect((await photo(10, "text/plain")).status).toBe(400);
  expect(f.state.aiCalls).toBe(2);
  expect(f.state.uploads).toBe(1);
  expect(f.state.writes).toHaveLength(1);
});

test("missing profile schema and username conflicts are explicit without leaking storage details", async () => {
  const f = fixture();
  f.state.profileFailure = true;
  expect((await f.reports.POST(reportRequest())).status).toBe(503);
  expect((await f.usernames.PUT(usernameRequest())).status).toBe(503);
  expect(f.state.aiCalls).toBe(0);
  f.state.profileFailure = false;
  f.state.usernameConflict = true;
  const response = await f.usernames.PUT(usernameRequest());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "username_unavailable", error: "That username is already in use. Please choose another." });
  expect(f.state.usernameWrites).toEqual([]);
  expect(f.state.writes).toEqual([]);
  expect(f.logs).toEqual([]);
});
