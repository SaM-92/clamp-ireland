import { NextResponse } from "next/server";
import { authSettings, getUserFromRequest } from "@/modules/auth/server/session";
export async function GET(request: Request) {
  try {
    return NextResponse.json({ configured: authSettings("public").configured, signedIn: Boolean(await getUserFromRequest(request)) },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch {
    console.error("[Auth] session lookup failed");
    return NextResponse.json({ error: "Could not verify your session." }, { status: 503 });
  }
}
