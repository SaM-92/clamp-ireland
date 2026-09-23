import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { removePublishedReport } from "@/modules/moderation/server/repository";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

/** Soft-removes an already-published report - see removePublishedReport for the audit-trail rationale. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403, headers });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "A valid report is required." }, { status: 400, headers });
  }
  try {
    const report = await removePublishedReport(id, admin.id);
    return NextResponse.json(report, { headers });
  } catch (error) {
    console.error("[Moderation] published removal failed", error);
    return NextResponse.json({ error: "Could not remove the report. Reload the list before trying again." }, { status: 500, headers });
  }
}
