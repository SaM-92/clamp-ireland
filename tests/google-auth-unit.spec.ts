import { expect, test } from "@playwright/test";
import * as oidc from "openid-client";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { sqliteRuntime, owner, outsider, publicOrigin, adminOrigin } from "./helpers/sqlite-runtime";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuer = "https://accounts.google.com";

function fixture() {
  const state = {
    calls: [] as string[], nonce: "", challenge: "", code: "synthetic-code", badSignature: false,
    claims: { sub: `google-${owner}`, email: "river_walker@fixture.invalid", email_verified: true } as Record<string, unknown>,
  };
  const transport: oidc.CustomFetch = async (input, options) => {
    const url = String(input);
    state.calls.push(url);
    if (url === `${issuer}/.well-known/openid-configuration`) return Response.json({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    });
    if (url === `${issuer}/jwks`) return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256", use: "sig" }] });
    if (url === `${issuer}/token`) {
      const body = new URLSearchParams(String(options?.body));
      if (body.get("code") !== state.code || createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") !== state.challenge) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const payload = `${encode({ alg: "RS256", kid: "fixture", typ: "JWT" })}.${encode({
        iss: issuer, aud: "fixture-client", iat: now, exp: now + 600, nonce: state.nonce, ...state.claims,
      })}`;
      const signature = sign("RSA-SHA256", Buffer.from(payload), privateKey);
      if (state.badSignature) signature[0] ^= 1;
      return Response.json({ access_token: "fixture-access-token", token_type: "Bearer", expires_in: 600, id_token: `${payload}.${signature.toString("base64url")}` });
    }
    throw new Error("Unexpected network request; real Google traffic is forbidden.");
  };
  const f = sqliteRuntime({
    "openid-client": {
      ...oidc,
      discovery: (url: URL, id: string, secret: string, _auth: unknown, options: { timeout?: number }) =>
        oidc.discovery(url, id, secret, undefined, { ...options, [oidc.customFetch]: transport }),
    },
  });
  const google = f.load<typeof import("../src/modules/auth/server/google")>("src/modules/auth/server/google.ts");
  async function begin(audience: "public" | "admin" = "public") {
    const origin = audience === "public" ? publicOrigin : adminOrigin;
    const response = await google.beginGoogleSignIn(new Request(`${origin}/api/auth/sign-in`, { headers: { "sec-fetch-site": "same-origin" } }), audience);
    const target = new URL(response.headers.get("location")!);
    state.nonce = target.searchParams.get("nonce")!;
    state.challenge = target.searchParams.get("code_challenge")!;
    const cookie = response.cookies.get(`__Host-clamp-${audience}-oauth`)!;
    const callback = new URL(`${origin}/api/auth/callback`);
    callback.searchParams.set("code", state.code);
    callback.searchParams.set("state", target.searchParams.get("state")!);
    const request = () => new Request(callback, { headers: { Cookie: `${cookie.name}=${cookie.value}`, "sec-fetch-site": "cross-site" } });
    return { response, target, callback, request };
  }
  return { ...f, state, google, begin };
}

test("real OIDC library validates PKCE, nonce and signature, consumes state once and issues only an opaque session", async () => {
  const f = fixture();
  try {
    const flow = await f.begin();
    expect(flow.target.origin).toBe(issuer);
    expect(flow.target.searchParams.get("scope")).toBe("openid email");
    expect(flow.target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(flow.response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(flow.response.headers.get("set-cookie")).toContain("HttpOnly");
    const response = await f.google.finishGoogleSignIn(flow.request(), "public");
    expect(response.headers.get("location")).toBe(`${publicOrigin}/auth/username`);
    expect(response.cookies.get("__Host-clamp-public-session")?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.state.calls).toContain(`${issuer}/jwks`);
    expect(f.db.prepare("SELECT count(*) AS total FROM oauth_attempts").get()?.total).toBe(0);
    expect(response.headers.get("set-cookie")).not.toContain("fixture-access-token");
    const replay = await f.google.finishGoogleSignIn(flow.request(), "public");
    expect(replay.headers.get("location")).toContain("signin_failed");
    expect(f.state.calls.filter((url) => url.endsWith("/token"))).toHaveLength(1);
  } finally { f.db.close(); }
});

test("wrong state, nonce, issuer, audience, signature, expired tokens and unverified email never create sessions", async () => {
  for (const fault of ["state", "nonce", "issuer", "audience", "signature", "expired", "email", "flow-expired", "pkce"] as const) {
    const f = fixture();
    try {
      const flow = await f.begin();
      if (fault === "state") flow.callback.searchParams.set("state", "forged");
      if (fault === "nonce") f.state.nonce = "forged";
      if (fault === "issuer") f.state.claims.iss = "https://attacker.invalid";
      if (fault === "audience") f.state.claims.aud = "wrong-client";
      if (fault === "signature") f.state.badSignature = true;
      if (fault === "expired") f.state.claims.exp = 1;
      if (fault === "email") f.state.claims.email_verified = false;
      if (fault === "flow-expired") f.db.prepare("UPDATE oauth_attempts SET expires_at=0").run();
      if (fault === "pkce") f.state.challenge = "forged";
      const result = await f.google.finishGoogleSignIn(flow.request(), "public");
      expect(result.headers.get("location"), fault).toContain("signin_failed");
      expect(result.cookies.has("__Host-clamp-public-session"), fault).toBe(false);
      expect(f.db.prepare("SELECT count(*) AS total FROM sessions").get()?.total, fault).toBe(0);
    } finally { f.db.close(); }
  }
});

test("closed registration uses verified invitations; Google metadata cannot assign a username or admin role", async () => {
  const f = fixture();
  try {
    f.state.claims = { sub: "new-google-subject", email: "invited@fixture.invalid", email_verified: true, name: "PRIVATE REAL NAME", is_admin: true, display_name: "forged_name" };
    let flow = await f.begin();
    expect((await f.google.finishGoogleSignIn(flow.request(), "public")).headers.get("location")).toContain("signin_failed");
    expect(f.db.prepare("SELECT count(*) AS total FROM profiles").get()?.total).toBe(3);
    f.env.AUTH_ALLOWED_EMAILS = "invited@fixture.invalid";
    flow = await f.begin();
    expect((await f.google.finishGoogleSignIn(flow.request(), "public")).headers.get("location")).toContain("/auth/username");
    expect(f.db.prepare("SELECT is_admin,display_name,username_policy_checked_at FROM profiles WHERE google_subject=?").get("new-google-subject"))
      .toEqual({ is_admin: 0, display_name: null, username_policy_checked_at: null });
    f.state.claims.sub = "different-subject-same-email";
    f.env.AUTH_ALLOWED_EMAILS = "";
    flow = await f.begin();
    expect((await f.google.finishGoogleSignIn(flow.request(), "public")).headers.get("location")).toContain("signin_failed");
    expect(f.db.prepare("SELECT count(*) AS total FROM profiles").get()?.total).toBe(4);
  } finally { f.db.close(); }
});

test("admin OAuth does not register accounts or accept a public flow and still checks the two-account role gate", async () => {
  const f = fixture();
  try {
    const wrongAudience = await f.begin("public");
    expect((await f.google.finishGoogleSignIn(wrongAudience.request(), "admin")).headers.get("location")).toContain("signin_failed");
    f.state.claims.sub = `google-${outsider}`;
    let flow = await f.begin("admin");
    expect((await f.google.finishGoogleSignIn(flow.request(), "admin")).headers.get("location")).toContain("signin_failed");
    f.state.claims.sub = `google-${owner}`;
    flow = await f.begin("admin");
    const response = await f.google.finishGoogleSignIn(flow.request(), "admin");
    expect(response.headers.get("location")).toBe(`${adminOrigin}/admin`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=3600");
    f.env.GOOGLE_CLIENT_SECRET = "";
    expect((await f.google.beginGoogleSignIn(new Request(adminOrigin), "admin")).status).toBe(503);
  } finally { f.db.close(); }
});
