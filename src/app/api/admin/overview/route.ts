import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { getAdminOverview } from "@/modules/admin/server/overview";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) {
      return NextResponse.json({ error: "Admin access required. Sign in with an administrator account." }, { status: 403, headers });
    }
    return NextResponse.json(await getAdminOverview(), { headers });
  } catch (error) {
    console.error("[Admin] overview failed", error);
    return NextResponse.json({ error: "Could not load the admin overview. Check configuration and try again." }, { status: 500, headers });
  }
}
