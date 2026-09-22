import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { createAnonServerClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };
export async function GET(request: Request) {
  try {
    if (!await requireAdmin(request)) return NextResponse.json({ error: "Admin access required." }, { status: 403, headers });
    const { data, error } = await createAnonServerClient().from("locations_public")
      .select("id, lat, lng, report_count").gt("report_count", 0);
    if (error) throw new Error("Location read failed.");
    return NextResponse.json((data ?? []).map((row) => ({
      id: row.id, lat: row.lat, lng: row.lng, reportCount: row.report_count,
    })), { headers });
  } catch {
    console.error("[Admin] locations read failed");
    return NextResponse.json({ error: "Could not load reported locations." }, { status: 500, headers });
  }
}
