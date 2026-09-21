import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { listPendingReports } from "@/modules/moderation/server/repository";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const pending = await listPendingReports();
  return NextResponse.json(pending);
}
