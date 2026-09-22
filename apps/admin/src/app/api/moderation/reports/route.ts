import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { listPendingReports } from "@/modules/moderation/server/repository";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

export async function GET(request: Request) {
  try {
    if (!await requireAdmin(request)) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403, headers });
    }
    return NextResponse.json(await listPendingReports(), { headers });
  } catch {
    console.error("[Moderation] queue read failed");
    return NextResponse.json({ error: "Could not load the moderation queue." }, { status: 500, headers });
  }
}
