import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabase/server";
import { createReport } from "@/modules/reports/server/repository";
import { uploadReportImage } from "@/modules/reports/server/imageStorage";
import { REPORTER_TYPES, type ReporterType } from "@/modules/reports/types";
import { checkContentPolicy } from "@/modules/content-policy/server/check";
import { ContentPolicyError, validateContent } from "@/modules/content-policy/policy";
import { consumeContentPolicyAttempt } from "@/modules/content-policy/server/rateLimit";
import { readReportForm } from "@/modules/content-policy/server/readReportForm";
import { ProfileError, requirePublicIdentity } from "@/modules/auth/server/profile";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in with a confirmed account to submit a report." }, { status: 401, headers });
    let formData: FormData;
    try {
      formData = await readReportForm(request);
    } catch {
      return NextResponse.json({ error: "Invalid report form or oversized upload." }, { status: 400, headers });
    }
    const locationId = formData.get("locationId");
    const reporterType = formData.get("reporterType");
    const incidentDate = formData.get("incidentDate");
    const image = formData.get("image");
    if (typeof locationId !== "string" || !uuid.test(locationId)
      || typeof reporterType !== "string" || !REPORTER_TYPES.includes(reporterType as ReporterType)) {
      return NextResponse.json({ error: "Supply a valid location and reporter type." }, { status: 400, headers });
    }
    if (incidentDate !== null && (typeof incidentDate !== "string"
      || (incidentDate !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)
        || Number.isNaN(Date.parse(incidentDate)) || new Date(incidentDate).toISOString().slice(0, 10) !== incidentDate)))) {
      return NextResponse.json({ error: "Supply a valid incident date." }, { status: 400, headers });
    }
    if (image !== null && (!(image instanceof File)
      || image.size > 8 * 1024 * 1024 || (image.size > 0 && !["image/jpeg", "image/png", "image/webp"].includes(image.type)))) {
      return NextResponse.json({ error: "Choose a JPEG, PNG or WebP image up to 8 MB." }, { status: 400, headers });
    }
    const description = validateContent("report_note", formData.get("description"));
    await requirePublicIdentity(user.id);
    await consumeContentPolicyAttempt(user.id);
    const approvedDescription = await checkContentPolicy({ kind: "report_note", text: description });
    // Policy and capacity failures must happen before any evidence upload or report insert.
    const imagePath = image instanceof File && image.size > 0
      ? await uploadReportImage(image, `${user.id}-${Date.now()}`) : null;
    const report = await createReport({
      locationId,
      userId: user.id,
      reporterType: reporterType as ReporterType,
      approvedDescription,
      incidentDate: typeof incidentDate === "string" && incidentDate ? incidentDate : null,
      imagePath,
    });
    return NextResponse.json(report, { headers });
  } catch (err) {
    if (err instanceof ContentPolicyError || err instanceof ProfileError) {
      return NextResponse.json({
        error: err.message, code: err.code,
        ...(err instanceof ContentPolicyError && err.classification ? { classification: err.classification } : {}),
      }, { status: err.status, headers });
    }
    console.error("[Reports] submission failed");
    return NextResponse.json(
      { error: "We could not confirm your report was saved. Please try again later.", code: "submission_unavailable" },
      { status: 503, headers }
    );
  }
}
