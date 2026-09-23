import { NextResponse } from "next/server";
import { createSession } from "@/modules/auth/server/session";

// Dev-only convenience: mints a fresh admin session for an existing admin
// profile and redirects straight into the dashboard - no Google OAuth, no
// manual cookie editing. This exists only because a real admin sign-in
// normally goes through Google (see /api/auth/callback), and the local Google
// OAuth client secret is not recoverable once lost, which otherwise makes the
// admin UI untestable locally. Always 404s once NODE_ENV=production (see
// Dockerfile), so this never ships in a deployed build.
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return new Response("Missing ?userId=<admin profile UUID> (see scripts/dev/local-admin-session.mjs output)", { status: 400 });
  const response = NextResponse.redirect(new URL("/", request.url));
  try {
    await createSession(userId, "admin", response);
  } catch (error) {
    return new Response(`Could not create session: ${(error as Error).message}`, { status: 400 });
  }
  return response;
}
