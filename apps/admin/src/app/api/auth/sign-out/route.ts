import { NextResponse } from "next/server";
import { adminSessionSettings, isAdminSameOrigin } from "@/modules/auth/lib/adminSession";

export async function POST(request: Request) {
  if (!isAdminSameOrigin(request)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const settings = adminSessionSettings();
  const response = NextResponse.json({ signedOut: true });
  response.cookies.set(settings.cookieName, "", { httpOnly: true, secure: settings.secure, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
