import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import path from "node:path";
import ts from "typescript";
import { parseAdminIds, parseAdminOrigin } from "../src/modules/auth/lib/adminPolicy";

const owner = "10000000-0000-4000-8000-000000000001";
const cofounder = "10000000-0000-4000-8000-000000000002";
const outsider = "10000000-0000-4000-8000-000000000003";
const origin = "https://admin.fixture.invalid";
const nativeRequire = createRequire(path.resolve("package.json"));

function runtime() {
  const env = {
    ADMIN_ALLOWED_USER_IDS: `${owner},${cofounder}`, ADMIN_SITE_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: "https://identity.fixture.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  };
  const state = { admin: true, banned: false, confirmed: true, profileFailure: false, profileReads: 0 };
  const cache = new Map<string, unknown>();
  const tokens: Record<string, string> = { owner, cofounder, outsider };
  function load<T>(file: string): T {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute) as T;
    const commonJs = { exports: {} };
    const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    runInNewContext(code, {
      module: commonJs, exports: commonJs.exports, Request, Response, Headers, URL, Error, TextDecoder,
      console: { error: () => {} }, fetch: () => { throw new Error("Live network is forbidden."); },
      require: (name: string) => {
        if (name === "server-only") return {};
        if (name === "@/lib/env") return { env, isSupabaseConfigured: true };
        if (name === "@supabase/supabase-js") return { createClient: () => ({
          auth: {
            getUser: async (token: string) => ({ data: { user: tokens[token] ? {
              id: tokens[token], email: "private@fixture.invalid", email_confirmed_at: state.confirmed ? "2026-09-22" : null,
            } : null }, error: null }),
            signInWithPassword: async ({ email }: { email: string }) => ({
              data: { session: { access_token: email.split("@")[0], expires_in: 7200 } }, error: null,
            }),
          },
          from: () => ({ select: () => ({ eq: () => ({ single: async () => {
            state.profileReads++;
            return { data: { is_admin: state.admin, is_banned: state.banned }, error: state.profileFailure ? { code: "failure" } : null };
          } }) }) }),
        }) };
        if (name.startsWith("@/")) return load(path.resolve("src", ...name.slice(2).split("/")) + ".ts");
        if (name.startsWith(".")) return load(path.resolve(path.dirname(absolute), name) + ".ts");
        return nativeRequire(name);
      },
    });
    cache.set(absolute, commonJs.exports);
    return commonJs.exports as T;
  }
  const gate = load<typeof import("../src/modules/auth/lib/requireAdmin")>("src/modules/auth/lib/requireAdmin.ts");
  return { env, state, load, gate };
}

test("admin configuration requires exactly two distinct UUIDs and a trusted HTTPS or loopback origin", () => {
  for (const value of [undefined, "", owner, `${owner},${owner}`, `${owner},${cofounder},${outsider}`, "owner@example.invalid,cofounder@example.invalid"]) {
    expect(parseAdminIds(value)).toBeNull();
  }
  expect(parseAdminIds(`${owner}, ${cofounder}`)).toEqual([owner, cofounder]);
  for (const value of [undefined, "", "http://admin.fixture.invalid", "https://u:p@admin.fixture.invalid", `${origin}/path`, `${origin}?next=other`]) {
    expect(parseAdminOrigin(value)).toBeNull();
  }
  expect(parseAdminOrigin(origin)).toBe(origin);
  expect(parseAdminOrigin("http://localhost:3003")).toBe("http://localhost:3003");
});

test("real admin gate rejects missing, outsider, unconfirmed, banned and revoked accounts", async () => {
  const rt = runtime();
  const request = (token: string) => new Request(origin, { headers: { Authorization: `Bearer ${token}` } });
  expect(await rt.gate.requireAdmin(new Request(origin))).toBeNull();
  expect(await rt.gate.requireAdmin(request("invalid"))).toBeNull();
  expect(await rt.gate.requireAdmin(request("outsider"))).toBeNull();
  expect(rt.state.profileReads).toBe(0);
  for (const token of ["owner", "cofounder"]) expect(await rt.gate.requireAdmin(request(token))).toEqual({ id: token === "owner" ? owner : cofounder, email: "private@fixture.invalid" });
  rt.state.confirmed = false;
  expect(await rt.gate.requireAdmin(request("owner"))).toBeNull();
  rt.state.confirmed = true; rt.state.banned = true;
  expect(await rt.gate.requireAdmin(request("owner"))).toBeNull();
  rt.state.banned = false; rt.state.admin = false;
  expect(await rt.gate.requireAdmin(request("owner"))).toBeNull();
  rt.state.admin = true; rt.state.profileFailure = true;
  expect(await rt.gate.requireAdmin(request("owner"))).toBeNull();
  rt.state.profileFailure = false; rt.env.ADMIN_ALLOWED_USER_IDS = "";
  expect(await rt.gate.requireAdmin(request("owner"))).toBeNull();
  rt.env.ADMIN_ALLOWED_USER_IDS = `${owner},${cofounder}`; rt.env.SUPABASE_SERVICE_ROLE_KEY = "";
  expect(await rt.gate.requireAdmin(request("owner"))).toBeNull();
});

test("cookie writes need the exact trusted Origin; forged identity headers and parameters never authorize", async () => {
  const rt = runtime();
  const request = (method: string, extra: Record<string, string> = {}) => new Request(`${origin}/api/moderation/reports?userId=${owner}`, {
    method, headers: { Cookie: "__Host-clamp-admin-session=owner", ...extra },
  });
  expect(await rt.gate.requireAdmin(request("GET"))).not.toBeNull();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    expect(await rt.gate.requireAdmin(request(method))).toBeNull();
    expect(await rt.gate.requireAdmin(request(method, { Origin: "https://public.fixture.invalid" }))).toBeNull();
    expect(await rt.gate.requireAdmin(request(method, { Origin: origin, "Sec-Fetch-Site": "cross-site" }))).toBeNull();
    expect(await rt.gate.requireAdmin(request(method, { Origin: origin }))).not.toBeNull();
  }
  expect(await rt.gate.requireAdmin(new Request(origin, { headers: { "X-User-ID": owner, "X-MS-CLIENT-PRINCIPAL-ID": owner } }))).toBeNull();
});

test("sign-in returns only an HttpOnly host-only bounded session cookie for an approved account", async () => {
  const rt = runtime();
  const route = rt.load<typeof import("../apps/admin/src/app/api/auth/sign-in/route")>("apps/admin/src/app/api/auth/sign-in/route.ts");
  const post = (email: string, requestOrigin = origin) => route.POST(new Request(`${origin}/api/auth/sign-in`, {
    method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "fixture-password" }),
  }));
  const denied = await post("outsider@fixture.invalid");
  expect(denied.status).toBe(403);
  expect(denied.headers.get("set-cookie")).toBeNull();
  expect((await post("owner@fixture.invalid", "https://other.fixture.invalid")).status).toBe(403);
  const response = await post("owner@fixture.invalid");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ signedIn: true });
  const cookie = response.headers.get("set-cookie")!;
  for (const part of ["__Host-clamp-admin-session=owner", "HttpOnly", "Secure", "SameSite=strict", "Max-Age=3600", "Path=/"]) {
    expect(cookie).toContain(part);
  }
  expect(cookie).not.toContain("Domain=");
  expect(response.headers.get("cache-control")).toContain("no-store");
  rt.env.ADMIN_ALLOWED_USER_IDS = "";
  expect((await post("owner@fixture.invalid")).status).toBe(503);
});
