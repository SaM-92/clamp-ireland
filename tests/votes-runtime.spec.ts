import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(path.resolve("package.json"));
const id = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const otherId = "20000000-0000-4000-8000-000000000002";
const writePath = path.join("src", "app", "api", "report-votes", "[id]", "route.ts");
const readPath = path.join("src", "app", "api", "report-votes", "route.ts");
const notesPath = path.join("src", "app", "api", "locations", "[id]", "reports", "route.ts");

function runtime() {
  const calls: { role: string; name: string; args: unknown }[] = [];
  const logs: unknown[] = [];
  const cache = new Map<string, unknown>();
  const result: { data: unknown; error: { code: string; message: string } | null } = { data: null, error: null };
  const selects: string[] = [];
  const client = (role: string) => ({
    auth: { getUser: async (token: string) => ({
      data: { user: token === "confirmed" || token === "unconfirmed" ? {
        id: userId, email: "private@fixture.invalid", email_confirmed_at: token === "confirmed" ? "2026-09-22" : null,
      } : null }, error: null,
    }) },
    rpc: async (name: string, args: unknown) => { calls.push({ role, name, args }); return result; },
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        return { eq: () => ({ order: () => ({ limit: async () => result }) }) };
      },
    }),
  });
  function load<T>(file: string): T {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute) as T;
    const commonJs = { exports: {} };
    cache.set(absolute, commonJs.exports);
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    runInNewContext(code, {
      module: commonJs, exports: commonJs.exports, Request, Response, Headers, URL, Error,
      console: { error: (...args: unknown[]) => logs.push(args) },
      fetch: () => { throw new Error("Live network forbidden in vote tests"); },
      require: (name: string) => {
        if (name === "server-only") return {};
        if (name === "@/lib/env") return { env: {
          NEXT_PUBLIC_SUPABASE_URL: "https://unused.fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
          SUPABASE_SERVICE_ROLE_KEY: "service_role",
        }, isSupabaseConfigured: true };
        if (name === "@supabase/supabase-js") return { createClient: (_url: string, key: string) => client(key) };
        if (name.startsWith("@/")) return load(path.resolve("src", ...name.slice(2).split("/")) + ".ts");
        if (name.startsWith(".")) return load(path.resolve(path.dirname(absolute), name) + ".ts");
        return nativeRequire(name);
      },
    });
    return commonJs.exports as T;
  }
  return {
    load, calls, logs, selects,
    respond(data: unknown, error: typeof result.error = null) { result.data = data; result.error = error; },
  };
}

function request(body: unknown, token = "confirmed") {
  return new Request(`http://localhost/api/report-votes/${id}`, {
    method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
}

test("real auth helper rejects missing, invalid and unconfirmed sessions before any vote RPC", async () => {
  const rt = runtime();
  const writer = rt.load<typeof import("../src/app/api/report-votes/[id]/route")>(writePath);
  const reader = rt.load<typeof import("../src/app/api/report-votes/route")>(readPath);
  for (const token of ["", "invalid", "unconfirmed"]) {
    const response = await writer.PUT(request({ vote: "agree" }, token), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(401);
    privateHeaders(response);
    const read = await reader.GET(new Request(`http://localhost/api/report-votes?reportIds=${id}`, { headers: { Authorization: `Bearer ${token}` } }));
    expect(read.status).toBe(401);
    privateHeaders(read);
  }
  expect(rt.calls).toEqual([]);
});

test("vote API rejects invalid IDs/values/JSON and user ID injection without writing", async () => {
  const rt = runtime();
  const writer = rt.load<typeof import("../src/app/api/report-votes/[id]/route")>(writePath);
  expect((await writer.PUT(request({ vote: "agree" }), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
  for (const body of [{}, { vote: "other" }, { vote: 1 }, { vote: "agree", userId: otherId }, { vote: "agree", reportId: otherId }]) {
    const response = await writer.PUT(request(body), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
    privateHeaders(response);
  }
  const malformed = new Request("http://localhost/api/report-votes", { method: "PUT", body: "{", headers: { Authorization: "Bearer confirmed" } });
  expect((await writer.PUT(malformed, { params: Promise.resolve({ id }) })).status).toBe(400);
  expect(rt.calls).toEqual([]);
});

test("writes use verified user identity, explicit desired values and strict private projections", async () => {
  const rt = runtime();
  const writer = rt.load<typeof import("../src/app/api/report-votes/[id]/route")>(writePath);
  for (const vote of ["agree", "disagree", null]) {
    const snapshot = { reportId: id, vote, agreeCount: vote === "agree" ? 1 : 0, disagreeCount: vote === "disagree" ? 1 : 0 };
    rt.respond(snapshot);
    const response = await writer.PUT(request({ vote }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    privateHeaders(response);
    expect(await response.json()).toEqual(snapshot);
    expect(rt.calls.at(-1)).toEqual({ role: "service_role", name: "set_report_vote", args: { p_report_id: id, p_user_id: userId, p_vote: vote } });
  }
  rt.respond({ reportId: id, vote: "agree", agreeCount: 1, disagreeCount: 0, user_id: otherId });
  const response = await writer.PUT(request({ vote: "agree" }), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain(otherId);
});

test("unavailable records and storage/auth failures are explicit, never success-shaped", async () => {
  const rt = runtime();
  const writer = rt.load<typeof import("../src/app/api/report-votes/[id]/route")>(writePath);
  const put = () => writer.PUT(request({ vote: "agree" }), { params: Promise.resolve({ id }) });
  rt.respond(null);
  expect((await put()).status).toBe(404);
  rt.respond(null, { code: "28000", message: "Account no longer confirmed" });
  expect((await put()).status).toBe(401);
  rt.respond(null, { code: "XX000", message: "PRIVATE database details" });
  const failed = await put();
  expect(failed.status).toBe(500);
  privateHeaders(failed);
  expect(await failed.text()).not.toContain("PRIVATE");
});

test("current votes are read in one bounded batch and never contain other identities", async () => {
  const rt = runtime();
  const reader = rt.load<typeof import("../src/app/api/report-votes/route")>(readPath);
  const ids = Array.from({ length: 50 }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const rows = ids.map((reportId) => ({ reportId, vote: null }));
  rt.respond(rows);
  const response = await reader.GET(new Request(`http://localhost/api/report-votes?reportIds=${ids.join(",")}&userId=${otherId}`, { headers: { Authorization: "Bearer confirmed" } }));
  expect(response.status).toBe(200);
  privateHeaders(response);
  expect(await response.json()).toEqual({ votes: rows });
  expect(rt.calls).toEqual([{ role: "service_role", name: "get_report_votes_for_user", args: { p_report_ids: ids, p_user_id: userId } }]);
  for (const query of ["", "reportIds=no", `reportIds=${id},${id}`, `reportIds=${id}&reportIds=${otherId}`, `reportIds=${[...ids, otherId].join(",")}`]) {
    expect((await reader.GET(new Request(`http://localhost/api/report-votes?${query}`, { headers: { Authorization: "Bearer confirmed" } }))).status).toBe(400);
  }
  expect(rt.calls).toHaveLength(1);
  rt.respond([{ reportId: id, vote: "agree", user_id: otherId }]);
  expect((await reader.GET(new Request(`http://localhost/api/report-votes?reportIds=${id}`, { headers: { Authorization: "Bearer confirmed" } }))).status).toBe(500);
});

test("public notes retain original fields and append only validated counts in the same query", async () => {
  const rt = runtime();
  const route = rt.load<typeof import("../src/app/api/locations/[id]/reports/route")>(notesPath);
  const row = {
    id, reporter_type: "victim", description: "Approved note", incident_date: null, created_at: "2026-09-22T10:00:00Z",
    agree_count: 2, disagree_count: 1, user_id: userId, description_raw: "PRIVATE",
  };
  rt.respond([row]);
  const response = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
  expect(await response.json()).toEqual([{
    id, reporterType: "victim", description: "Approved note", incidentDate: null, createdAt: row.created_at,
    voteCounts: { agreeCount: 2, disagreeCount: 1 },
  }]);
  expect(rt.selects).toEqual(["id, reporter_type, description, incident_date, created_at, agree_count, disagree_count"]);
  expect(rt.calls).toEqual([]);
  rt.respond([{ ...row, agree_count: -1 }]);
  expect((await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) })).status).toBe(500);
});
