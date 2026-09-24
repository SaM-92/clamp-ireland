import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import { parseAdminIds, parseAdminOrigin } from "../src/modules/auth/lib/adminPolicy";
import { sqlRuntime, owner, cofounder, outsider, adminOrigin, publicOrigin } from "./helpers/sql-runtime";

test("admin configuration accepts one or two distinct UUIDs and a trusted origin", () => {
  for (const value of [undefined, "", `${owner},${owner}`, `${owner},${cofounder},${outsider}`, "email@fixture.invalid"]) expect(parseAdminIds(value)).toBeNull();
  expect(parseAdminIds(owner)).toEqual([owner]);
  expect(parseAdminIds(`${owner}, ${cofounder}`)).toEqual([owner, cofounder]);
  for (const value of ["", "http://admin.fixture.invalid", `${adminOrigin}/path`, `${adminOrigin}?next=other`]) expect(parseAdminOrigin(value)).toBeNull();
  expect(parseAdminOrigin(adminOrigin)).toBe(adminOrigin);
  expect(parseAdminOrigin("http://localhost:3003")).toBe("http://localhost:3003");
});

test("real Azure SQL gate rejects forged, wrong-audience, expired, banned, revoked and unlisted sessions", async () => {
  const f = await sqlRuntime();
  try {
    const gate = f.load<typeof import("../src/modules/auth/lib/requireAdmin")>("src/modules/auth/lib/requireAdmin.ts");
    const request = (cookie: string) => new Request(adminOrigin, { headers: { Cookie: cookie } });
    expect(await gate.requireAdmin(new Request(adminOrigin))).toBeNull();
    expect(await gate.requireAdmin(new Request(adminOrigin, { headers: { Authorization: "******", "X-User-ID": owner } }))).toBeNull();
    expect(await gate.requireAdmin(request((await f.cookie(owner, "public")).replace("public-session", "admin-session")))).toBeNull();
    expect(await gate.requireAdmin(request(await f.cookie(owner, "admin", Date.now() - 1)))).toBeNull();
    await f.db.prepare("UPDATE profiles SET is_admin=1 WHERE id=?").run(outsider);
    expect(await gate.requireAdmin(request(await f.cookie(outsider, "admin")))).toBeNull();
    for (const id of [owner, cofounder]) expect(await gate.requireAdmin(request(await f.cookie(id, "admin")))).toEqual({ id });
    const cookie = await f.cookie(owner, "admin");
    for (const field of ["is_banned", "is_admin"] as const) {
      await f.db.prepare(`UPDATE profiles SET ${field}=? WHERE id=?`).run(field === "is_banned" ? 1 : 0, owner);
      expect(await gate.requireAdmin(request(cookie))).toBeNull();
      await f.db.prepare(`UPDATE profiles SET ${field}=? WHERE id=?`).run(field === "is_banned" ? 0 : 1, owner);
    }
    f.env.ADMIN_ALLOWED_USER_IDS = "";
    expect(await gate.requireAdmin(request(cookie))).toBeNull();
  } finally { await f.close(); }
});

test("both session audiences require exact Origin on every mutation; logout revokes the database token", async () => {
  const f = await sqlRuntime();
  try {
    const auth = f.load<typeof import("../src/modules/auth/server/session")>("src/modules/auth/server/session.ts");
    for (const audience of ["public", "admin"] as const) {
      const origin = audience === "admin" ? adminOrigin : publicOrigin;
      const cookie = await f.cookie(owner, audience);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const invalidOrigins: Record<string, string>[] = [{}, { Origin: "https://other.fixture.invalid" }, { Origin: origin, "Sec-Fetch-Site": "cross-site" }];
        for (const headers of invalidOrigins) {
          expect(await auth.getUserFromRequest(new Request(origin, { method, headers: { ...headers, Cookie: cookie } }), undefined, audience)).toBeNull();
        }
        expect(await auth.getUserFromRequest(new Request(origin, { method, headers: { Origin: origin, Cookie: cookie } }), undefined, audience)).toEqual({ id: owner });
      }
      expect((await auth.signOut(new Request(origin, { method: "POST", headers: { Cookie: cookie } }), audience)).status).toBe(403);
      const response = await auth.signOut(new Request(origin, { method: "POST", headers: { Origin: origin, Cookie: cookie } }), audience);
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(await auth.getUserFromRequest(new Request(origin, { headers: { Cookie: cookie } }), undefined, audience)).toBeNull();
    }
  } finally { await f.close(); }
});

test("session cookies are opaque, hashed, host-only, HttpOnly, Strict and audience-bounded", async () => {
  const f = await sqlRuntime();
  try {
    const auth = f.load<typeof import("../src/modules/auth/server/session")>("src/modules/auth/server/session.ts");
    for (const audience of ["public", "admin"] as const) {
      const response = NextResponse.json({});
      await auth.createSession(owner, audience, response);
      const cookie = response.headers.get("set-cookie")!;
      for (const part of ["HttpOnly", "Secure", "SameSite=strict", "Path=/", `Max-Age=${audience === "admin" ? 3600 : 86400}`]) expect(cookie).toContain(part);
      expect(cookie).not.toContain("Domain=");
      const raw = response.cookies.get(`__Host-clamp-${audience}-session`)!.value;
      expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const row = (await f.db.prepare("SELECT token_hash,expires_at,created_at FROM sessions WHERE audience=?").get(audience))!;
      expect(row.token_hash).not.toBe(raw);
      expect(Number(row.expires_at) - Number(row.created_at)).toBe((audience === "admin" ? 3600 : 86400) * 1000);
    }
    await expect(async () => auth.createSession(outsider, "admin", NextResponse.json({}))).rejects.toThrow();
  } finally { await f.close(); }
});
