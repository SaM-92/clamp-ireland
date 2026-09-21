import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { approveReport, rejectReport } from "@/modules/moderation/server/repository";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { id } = await params;
  const { action } = await request.json();

  if (action === "approve") {
    return NextResponse.json(await approveReport(id));
  }
  if (action === "reject") {
    return NextResponse.json(await rejectReport(id));
  }
  return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
}
