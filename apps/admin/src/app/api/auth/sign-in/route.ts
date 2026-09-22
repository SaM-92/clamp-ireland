import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnonServerClient } from "@/lib/supabase/server";
import { readBoundedJson } from "@/lib/server/readBoundedJson";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { adminSessionSettings, isAdminSameOrigin } from "@/modules/auth/lib/adminSession";

const inputSchema = z.strictObject({ email: z.email().max(320), password: z.string().min(1).max(256) });
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Origin" };

export async function POST(request: Request) {
  const settings = adminSessionSettings();
  if (!settings.configured) return NextResponse.json({ error: "Administrator sign-in is not configured." }, { status: 503, headers });
  if (!isAdminSameOrigin(request)) return NextResponse.json({ error: "Request not allowed." }, { status: 403, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "Use a JSON sign-in request." }, { status: 415, headers });
  }
  let input: z.infer<typeof inputSchema>;
  try {
    input = inputSchema.parse(await readBoundedJson(request, 4096, new Error("Invalid sign-in request.")));
  } catch {
    return NextResponse.json({ error: "Invalid sign-in request." }, { status: 400, headers });
  }
  try {
    const { data, error } = await createAnonServerClient().auth.signInWithPassword(input);
    const session = data.session;
    const lifetime = z.number().int().positive().safeParse(session?.expires_in);
    const admin = !error && session && lifetime.success
      ? await requireAdmin(new Request(request.url, { headers: { Authorization: `Bearer ${session.access_token}` } }))
      : null;
    if (!admin || !session || !lifetime.success) {
      return NextResponse.json({ error: "Access denied. Only approved administrator accounts may sign in." }, { status: 403, headers });
    }
    const response = NextResponse.json({ signedIn: true }, { headers });
    response.cookies.set(settings.cookieName, session.access_token, {
      httpOnly: true, secure: settings.secure, sameSite: "strict", path: "/",
      maxAge: Math.min(lifetime.data, 3600),
    });
    return response;
  } catch {
    console.error("[Admin sign-in] identity service request failed");
    return NextResponse.json({ error: "Could not verify administrator access. Please retry." }, { status: 503, headers });
  }
}
