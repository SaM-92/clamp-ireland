import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { database, writeTransaction } from "@/lib/db/server";
import { env, isDatabaseConfigured } from "@/lib/env";
import { parseAdminIds, parseAdminOrigin } from "../lib/adminPolicy";
import { z } from "zod";

export type SessionAudience = "public" | "admin";
export function authSettings(audience: SessionAudience) {
  const origin = parseAdminOrigin(audience === "admin" ? env.ADMIN_SITE_URL : env.AUTH_PUBLIC_ORIGIN);
  const secure = origin?.startsWith("https:") === true;
  return {
    origin, secure,
    cookieName: `${secure ? "__Host-" : ""}clamp-${audience}-session`,
    flowCookieName: `${secure ? "__Host-" : ""}clamp-${audience}-oauth`,
    maxAge: audience === "admin" ? 3600 : 86_400,
    configured: Boolean(origin && isDatabaseConfigured && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
}

export function sameOrigin(request: Request, audience: SessionAudience): boolean {
  const { origin } = authSettings(audience);
  return Boolean(origin && request.headers.get("origin") === origin && request.headers.get("sec-fetch-site") !== "cross-site");
}
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function requestCookie(request: Request, name: string): string | undefined {
  const token = new NextRequest(request.url, { headers: request.headers }).cookies.get(name)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export function eligibleAdmin(userId: string): boolean {
  const ids = parseAdminIds(env.ADMIN_ALLOWED_USER_IDS);
  return Boolean(ids?.includes(userId) && database().prepare("SELECT id FROM profiles WHERE id=? AND is_admin=1 AND is_banned=0").get(userId));
}
export async function getUserFromRequest(request: Request, signal?: AbortSignal, audience: SessionAudience = "public"): Promise<{ id: string } | null> {
  signal?.throwIfAborted();
  const settings = authSettings(audience);
  if (!isDatabaseConfigured || !settings.origin) return null;
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request, audience)) return null;
  const token = requestCookie(request, settings.cookieName);
  if (!token) return null;
  const row = database().prepare(`SELECT p.id FROM sessions s JOIN profiles p ON p.id=s.user_id
    WHERE s.token_hash=? AND s.audience=? AND s.expires_at>? AND p.is_banned=0`).get(tokenHash(token), audience, Date.now());
  if (!row) return null;
  return z.object({ id: z.uuid() }).parse(row);
}
export function createSession(userId: string, audience: SessionAudience, response: NextResponse) {
  const settings = authSettings(audience);
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  writeTransaction((db) => {
    if (!db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(userId) ||
        (audience === "admin" && !eligibleAdmin(userId))) throw new Error("Account not permitted.");
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
    db.prepare("INSERT INTO sessions(token_hash,user_id,audience,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run(tokenHash(token), userId, audience, now + settings.maxAge * 1000, now);
  });
  response.cookies.set(settings.cookieName, token, {
    httpOnly: true, secure: settings.secure, sameSite: "strict", path: "/", maxAge: settings.maxAge,
  });
}
export function signOut(request: Request, audience: SessionAudience): NextResponse {
  if (!sameOrigin(request, audience)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const settings = authSettings(audience);
  const token = requestCookie(request, settings.cookieName);
  if (token) database().prepare("DELETE FROM sessions WHERE token_hash=? AND audience=?").run(tokenHash(token), audience);
  const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(settings.cookieName, "", { httpOnly: true, secure: settings.secure, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
