import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";

export async function GET(request: Request) {
  try {
    const allowed = Boolean(await requireAdmin(request));
    return NextResponse.json({ allowed }, {
      status: allowed ? 200 : 403,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" },
    });
  } catch {
    console.error("[Admin session] verification failed");
    return NextResponse.json({ error: "Could not verify administrator access." }, { status: 503 });
  }
}
