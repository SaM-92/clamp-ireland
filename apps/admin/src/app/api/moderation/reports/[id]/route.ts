import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { approveReport, rejectReport } from "@/modules/moderation/server/repository";
import { z } from "zod";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), description: z.string().trim().min(1).max(2000), reviewed: z.literal(true) }),
  z.object({ action: z.literal("reject") }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403, headers });
  }

  const { id } = await params;
  const result = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !result.success) {
    return NextResponse.json({ error: "A valid report, reviewed note, and review confirmation are required." }, { status: 400, headers });
  }
  try {
    const report = result.data.action === "approve"
      ? await approveReport(id, result.data.description, admin.id)
      : await rejectReport(id);
    return NextResponse.json(report, { headers });
  } catch (error) {
    console.error("[Moderation] decision failed", error);
    return NextResponse.json({ error: "Could not complete the decision. Reload the queue before trying again." }, { status: 500, headers });
  }
}
