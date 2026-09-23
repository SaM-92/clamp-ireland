import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { listPublicLocations } from "@/modules/locations/server/repository";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
export async function GET(request: Request) {
  try {
    if (!await requireAdmin(request)) return NextResponse.json({ error: "Admin access required." }, { status: 403, headers });
    return NextResponse.json((await listPublicLocations()).map((row) => ({
      id: row.id, lat: row.lat, lng: row.lng, reportCount: row.reportCount,
    })), { headers });
  } catch {
    console.error("[Admin] locations read failed");
    return NextResponse.json({ error: "Could not load reported locations." }, { status: 500, headers });
  }
}
