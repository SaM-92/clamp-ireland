import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { isTrafficEnabled } from "@/modules/analytics/server/config";
import { getTrafficSummary } from "@/modules/analytics/server/repository";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

export async function GET(request: Request) {
  try {
    if (!await requireAdmin(request)) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403, headers });
    }
    if (!isTrafficEnabled()) {
      return NextResponse.json({ enabled: false, reason: "Analytics not enabled" }, { headers });
    }
    return NextResponse.json(await getTrafficSummary(), { headers });
  } catch {
    console.error("[Traffic] admin aggregate read failed");
    return NextResponse.json({ error: "Could not load traffic totals." }, { status: 500, headers });
  }
}
