import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { sourceFingerprintSchema, summarySentenceSchema } from "@/modules/area-summaries/types";
import { requireAreaSummarySetup } from "@/modules/area-summaries/server/config";
import { AreaSummaryError } from "@/modules/area-summaries/server/errors";
import { readSummaryRequest, summaryErrorResponse, summaryPrivateHeaders } from "@/modules/area-summaries/server/http";
import { approveAreaSummaryDraft, reviewAreaSummary } from "@/modules/area-summaries/server/repository";

export const dynamic = "force-dynamic";
const decisionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("approve"), sentence: summarySentenceSchema,
    sourceFingerprint: sourceFingerprintSchema, reviewed: z.literal(true),
  }),
  z.strictObject({ action: z.literal("reject") }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) throw new AreaSummaryError("access", "Administrator access is required to review a summary.", 403);
    requireAreaSummarySetup();
    const { id } = await params;
    const parsed = decisionSchema.safeParse(await readSummaryRequest(request));
    if (!z.uuid().safeParse(id).success || !parsed.success) {
      throw new AreaSummaryError("invalid_review", "A valid one-sentence draft and explicit human-review confirmation are required.", 400);
    }
    if (parsed.data.action === "approve") {
      await approveAreaSummaryDraft(id, admin.id, parsed.data.sentence, parsed.data.sourceFingerprint);
    } else {
      await reviewAreaSummary(id, admin.id, "rejected");
    }
    return NextResponse.json({ saved: true }, { headers: summaryPrivateHeaders });
  } catch (error) { return summaryErrorResponse(error); }
}
