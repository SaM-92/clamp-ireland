import "server-only";
import * as oidc from "openid-client";
import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { database, writeTransaction } from "@/lib/db/server";
import { authSettings, createSession, eligibleAdmin, requestCookie, tokenHash, type SessionAudience } from "./session";

let configuration: oidc.Configuration | undefined;
async function googleConfiguration() {
  if (!configuration) {
    const config = await oidc.discovery(new URL("https://accounts.google.com"), env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET, undefined, { timeout: 10 });
    oidc.enableNonRepudiationChecks(config);
    configuration = config;
  }
  return configuration;
}

export async function beginGoogleSignIn(request: Request, audience: SessionAudience) {
  const settings = authSettings(audience);
  if (!settings.configured || !settings.origin) return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 503 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Start sign-in from this website." }, { status: 403 });
  const config = await googleConfiguration();
  const token = randomBytes(32).toString("base64url");
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  await writeTransaction(async (db) => {
    await db.prepare("DELETE FROM oauth_attempts WHERE expires_at<=?").run(Date.now());
    const prior = requestCookie(request, settings.flowCookieName);
    if (prior) await db.prepare("DELETE FROM oauth_attempts WHERE token_hash=? AND audience=?").run(tokenHash(prior), audience);
    await db.prepare("INSERT INTO oauth_attempts(token_hash,audience,state,nonce,verifier,expires_at) VALUES (?,?,?,?,?,?)")
      .run(tokenHash(token), audience, state, nonce, verifier, Date.now() + 600_000);
  });
  const target = oidc.buildAuthorizationUrl(config, {
    redirect_uri: `${settings.origin}/api/auth/callback`, scope: "openid email",
    code_challenge: challenge, code_challenge_method: "S256", state, nonce, prompt: "select_account",
  });
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(settings.flowCookieName, token, {
    httpOnly: true, secure: settings.secure, sameSite: "lax", path: "/", maxAge: 600,
  });
  return response;
}

export async function finishGoogleSignIn(request: Request, audience: SessionAudience) {
  const settings = authSettings(audience);
  if (!settings.configured || !settings.origin) return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 503 });
  let response: NextResponse;
  // Stage marker for diagnostics only - never assigned provider tokens, codes, emails or IDs.
  let stage = "flow-cookie";
  try {
    const token = requestCookie(request, settings.flowCookieName);
    if (!token) throw new Error("Missing sign-in transaction.");
    stage = "flow-lookup";
    const db0 = await database();
    const attempt = await db0.prepare(`DELETE FROM oauth_attempts OUTPUT deleted.state,deleted.nonce,deleted.verifier
      WHERE token_hash=? AND audience=? AND expires_at>?`).get(tokenHash(token), audience, Date.now());
    const flow = z.object({ state: z.string(), nonce: z.string(), verifier: z.string() }).parse(attempt);
    stage = "token-exchange";
    const callback = new URL(`${settings.origin}/api/auth/callback`);
    callback.search = new URL(request.url).search;
    const tokens = await oidc.authorizationCodeGrant(await googleConfiguration(), callback, {
      pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true,
    });
    stage = "identity-parse";
    const identity = z.object({
      sub: z.string().min(1).max(255), email: z.email().max(254), email_verified: z.literal(true),
    }).parse(tokens.claims());
    stage = "profile-upsert";
    const userId = await writeTransaction(async (db) => {
      const existing = await db.prepare("SELECT id,is_banned FROM profiles WHERE google_subject=?").get(identity.sub);
      if (existing) {
        // mssql returns `bit` columns as JS booleans, not 0/1 integers.
        if (existing.is_banned) throw new Error("Account restricted.");
        await db.prepare("UPDATE profiles SET email=? WHERE id=?").run(identity.email, existing.id);
        return z.uuid().parse(existing.id);
      }
      const invited = env.AUTH_ALLOWED_EMAILS.split(",").map((email) => email.trim().toLowerCase()).includes(identity.email.toLowerCase());
      if (audience === "admin" || (!env.ALLOW_PUBLIC_SIGNUP && !invited)) throw new Error("Registration is closed.");
      const id = randomUUID();
      await db.prepare("INSERT INTO profiles(id,google_subject,email,created_at) VALUES (?,?,?,?)")
        .run(id, identity.sub, identity.email, new Date().toISOString());
      return id;
    });
    stage = "admin-eligibility";
    if (audience === "admin" && !(await eligibleAdmin(userId))) throw new Error("Administrator access denied.");
    stage = "session-create";
    response = NextResponse.redirect(new URL(audience === "admin" ? "/admin" : "/auth/username", settings.origin), 303);
    await createSession(userId, audience, response);
  } catch (error) {
    // Never log provider tokens, authorization codes, email addresses or callback URLs -
    // only the stage reached and the error's own message (already PII-free by convention).
    console.error(`[Google sign-in] rejected at stage=${stage} audience=${audience}`,
      error instanceof Error ? error.message : error);
    response = NextResponse.redirect(new URL("/auth/sign-in?error=signin_failed", settings.origin), 303);
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(settings.flowCookieName, "", { httpOnly: true, secure: settings.secure, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
