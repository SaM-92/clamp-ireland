import { NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/requireAdmin";
import { approveReport, rejectReport, type PhotoEdit } from "@/modules/moderation/server/repository";
import { redactionRegionsSchema } from "@/modules/moderation/types";
import { CONTENT_LIMITS } from "@/modules/content-policy/policy";
import { PhotoError, validatePhoto } from "@/modules/photos/policy";
import { normalizePhoto } from "@/modules/photos/server/normalize";
import { readReportForm } from "@/modules/content-policy/server/readReportForm";
import { z } from "zod";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
const MAX_PHOTOS = 3;
const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    description: z.string().trim().min(1).max(CONTENT_LIMITS.report_note),
    reviewed: z.literal(true),
    // Index i applies to the photo at sort_order i; a null/missing entry publishes that photo
    // unchanged. Any replacement photo files arrive separately as multipart fields "photo-0".."photo-2".
    photoEdits: z.array(z.object({ redactions: redactionRegionsSchema.optional() }).nullable()).max(MAX_PHOTOS).optional(),
  }),
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
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "A valid report, reviewed note, and review confirmation are required." }, { status: 400, headers });
  }

  // Replacement photos arrive as multipart (decision JSON + up to 3 "photo-N" files); everything
  // else keeps sending plain JSON.
  const contentType = request.headers.get("content-type") ?? "";
  let decisionInput: unknown = null;
  const replacementPhotos: (File | undefined)[] = [];
  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await readReportForm(request);
      const raw = formData.get("decision");
      decisionInput = typeof raw === "string" ? JSON.parse(raw) : null;
      for (let index = 0; index < MAX_PHOTOS; index++) {
        const photo = formData.get(`photo-${index}`);
        if (photo === null) continue;
        if (!(photo instanceof File)) throw new PhotoError("invalid_photo", "Choose one supported photo file.", 400);
        validatePhoto(photo);
        replacementPhotos[index] = photo;
      }
    } else {
      decisionInput = await request.json().catch(() => null);
    }
  } catch (error) {
    if (error instanceof PhotoError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
    }
    return NextResponse.json({ error: "A valid report, reviewed note, and review confirmation are required." }, { status: 400, headers });
  }

  const result = decisionSchema.safeParse(decisionInput);
  if (!result.success) {
    return NextResponse.json({ error: "A valid report, reviewed note, and review confirmation are required." }, { status: 400, headers });
  }
  try {
    let report;
    if (result.data.action === "approve") {
      const photoEdits: (PhotoEdit | undefined)[] = [];
      for (let index = 0; index < MAX_PHOTOS; index++) {
        const redactions = result.data.photoEdits?.[index]?.redactions;
        const replacementFile = replacementPhotos[index];
        const replacementPhoto = replacementFile ? await normalizePhoto(replacementFile) : undefined;
        if (redactions || replacementPhoto) photoEdits[index] = { redactions, replacementPhoto };
      }
      report = await approveReport(id, result.data.description, admin.id, photoEdits);
    } else {
      report = await rejectReport(id);
    }
    return NextResponse.json(report, { headers });
  } catch (error) {
    if (error instanceof PhotoError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
    }
    console.error("[Moderation] decision failed", error);
    return NextResponse.json({ error: "Could not complete the decision. Reload the queue before trying again." }, { status: 500, headers });
  }
}
