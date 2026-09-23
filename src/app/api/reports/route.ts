import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/modules/auth/server/session";
import { createReport, ReportInsertError } from "@/modules/reports/server/repository";
import { uploadReportImage, deleteReportImage } from "@/modules/reports/server/imageStorage";
import { REPORTER_TYPES, type ReporterType } from "@/modules/reports/types";
import { checkContentPolicy } from "@/modules/content-policy/server/check";
import { ContentPolicyError, validateContent } from "@/modules/content-policy/policy";
import { consumeContentPolicyAttempt } from "@/modules/content-policy/server/rateLimit";
import { readReportForm } from "@/modules/content-policy/server/readReportForm";
import { ProfileError, requirePublicIdentity } from "@/modules/auth/server/profile";
import { PhotoError, validatePhoto } from "@/modules/photos/policy";
import { NOINDEX_HEADER } from "@/modules/seo/policy";
import { normalizePhoto } from "@/modules/photos/server/normalize";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": NOINDEX_HEADER };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let submissionActive = false;

export async function POST(request: Request) {
  let admitted = false;
  let imagePath: string | null = null;
  try {
    const user = await getUserFromRequest(request, AbortSignal.timeout(15_000));
    if (!user) return NextResponse.json({ error: "Sign in with Google to submit a report." }, { status: 401, headers });
    if (submissionActive) {
      return NextResponse.json({ error: "Another report is processing. Please try again shortly.", code: "submission_busy" },
        { status: 429, headers: { ...headers, "Retry-After": "10" } });
    }
    submissionActive = true;
    admitted = true;
    let formData: FormData;
    try {
      formData = await readReportForm(request);
    } catch {
      return NextResponse.json({ error: "Invalid, oversized or timed-out upload. Choose one photo up to 50 MiB.", code: "invalid_report_form" }, { status: 400, headers });
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
    if (image !== null && !(image instanceof File)) throw new PhotoError("invalid_photo", "Choose one supported photo file.", 400);
    if (formData.getAll("image").length > 1) throw new PhotoError("invalid_photo", "Choose one photo per report.", 400);
    if (image instanceof File) validatePhoto(image);
    const description = validateContent("report_note", formData.get("description"));
    const admissionSignal = AbortSignal.timeout(15_000);
    await requirePublicIdentity(user.id, admissionSignal);
    await consumeContentPolicyAttempt(user.id, admissionSignal);
    const approvedDescription = await checkContentPolicy({ kind: "report_note", text: description });
    // Policy and capacity failures must happen before any evidence upload or report insert.
    imagePath = image instanceof File ? await uploadReportImage(await normalizePhoto(image), user.id) : null;
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
    if (imagePath) {
      if (err instanceof ReportInsertError && err.rolledBack) {
        try {
          await deleteReportImage(imagePath);
        } catch {
          console.error("[Reports] orphan cleanup failed; private evidence needs reconciliation");
        }
      } else {
        console.error("[Reports] uncertain save outcome; private evidence retained for reconciliation");
      }
    }
    if (err instanceof ContentPolicyError || err instanceof ProfileError || err instanceof PhotoError) {
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
  } finally {
    if (admitted) submissionActive = false;
  }
}
