import { NextResponse } from "next/server";
import { getUserFromRequest, requestCookie, authSettings } from "@/modules/auth/server/session";
import { createReport, ReportInsertError } from "@/modules/reports/server/repository";
import { findOrCreateLocation } from "@/modules/locations/server/repository";
import { uploadReportImage, deleteReportImage } from "@/modules/reports/server/imageStorage";
import { REPORTER_TYPES, type ReporterType } from "@/modules/reports/types";
import { ANONYMOUS_PROFILE_ID } from "@/modules/reports/anonymous";
import { checkContentPolicy } from "@/modules/content-policy/server/check";
import { assessReportRisk } from "@/modules/content-policy/server/riskFlag";
import { ContentPolicyError, validateContent } from "@/modules/content-policy/policy";
import { consumeContentPolicyAttempt, consumeAnonymousReportAttempt } from "@/modules/content-policy/server/rateLimit";
import { readReportForm } from "@/modules/content-policy/server/readReportForm";
import { ProfileError, requirePublicIdentity } from "@/modules/auth/server/profile";
import { PhotoError, validatePhoto } from "@/modules/photos/policy";
import { NOINDEX_HEADER } from "@/modules/seo/policy";
import { normalizePhoto } from "@/modules/photos/server/normalize";
import { getClientIp, getClientIpHash } from "@/modules/content-policy/server/clientIp";
import { verifyTurnstileToken } from "@/modules/content-policy/server/turnstile";
import { todayInDublin } from "@/lib/dateFormat";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": NOINDEX_HEADER };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let submissionActive = false;

export async function POST(request: Request) {
  let admitted = false;
  let imagePath: string | null = null;
  try {
    const user = await getUserFromRequest(request, AbortSignal.timeout(15_000));
    // A cookie that failed to resolve to a live user (expired, forged, banned,
    // or cross-origin) must be rejected outright - it must never silently fall
    // through to the anonymous tier, which would let a banned account launder
    // itself back in as "anonymous".
    if (!user && requestCookie(request, authSettings("public").cookieName)) {
      return NextResponse.json({ error: "Sign in with Google to continue, or reload to report anonymously." }, { status: 401, headers });
    }
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
    const locationIdField = formData.get("locationId");
    const latField = formData.get("lat");
    const lngField = formData.get("lng");
    const reporterType = formData.get("reporterType");
    const incidentDate = formData.get("incidentDate");
    const image = formData.get("image");
    const hasLocationId = typeof locationIdField === "string" && uuid.test(locationIdField);
    const lat = typeof latField === "string" ? Number(latField) : NaN;
    const lng = typeof lngField === "string" ? Number(lngField) : NaN;
    const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    if ((!hasLocationId && !hasCoordinates)
      || typeof reporterType !== "string" || !REPORTER_TYPES.includes(reporterType as ReporterType)) {
      return NextResponse.json({ error: "Supply a valid location and reporter type." }, { status: 400, headers });
    }
    if (incidentDate !== null && (typeof incidentDate !== "string"
      || (incidentDate !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)
        || Number.isNaN(Date.parse(incidentDate)) || new Date(incidentDate).toISOString().slice(0, 10) !== incidentDate)))) {
      return NextResponse.json({ error: "Supply a valid incident date." }, { status: 400, headers });
    }
    // Reject a date after "today" in Ireland - a clamping cannot have
    // happened yet. Compared against Dublin local time, not the server's UTC
    // clock, so a report entered late evening during Irish Summer Time isn't
    // wrongly rejected as "tomorrow".
    if (typeof incidentDate === "string" && incidentDate !== "" && incidentDate > todayInDublin()) {
      return NextResponse.json({ error: "Incident date cannot be in the future." }, { status: 400, headers });
    }
    if (image !== null && !(image instanceof File)) throw new PhotoError("invalid_photo", "Choose one supported photo file.", 400);
    if (formData.getAll("image").length > 1) throw new PhotoError("invalid_photo", "Choose one photo per report.", 400);
    if (image instanceof File) validatePhoto(image);
    const description = validateContent("report_note", formData.get("description"));
    const admissionSignal = AbortSignal.timeout(15_000);
    const isAnonymous = !user;
    let submitterId: string;
    let nickname: string | null = null;
    if (user) {
      await requirePublicIdentity(user.id, admissionSignal);
      await consumeContentPolicyAttempt(user.id, admissionSignal);
      submitterId = user.id;
    } else {
      // A signed-in user already has their own checked public username; an
      // anonymous submitter has none, so a display nickname is required here
      // instead - freeform (spaces/mixed case are fine), but never blank.
      const nicknameField = formData.get("nickname");
      if (typeof nicknameField !== "string" || !nicknameField.trim()) {
        return NextResponse.json({ error: "Enter a name or nickname before submitting." }, { status: 400, headers });
      }
      nickname = validateContent("nickname", nicknameField);
      // Anonymous ("no account needed") path: no session, no username. A
      // filled-in honeypot field or a failed Turnstile check are both treated
      // as a generic rejection so a bot can't tell which defence caught it.
      const honeypot = formData.get("website");
      const turnstileToken = formData.get("turnstileToken");
      if (typeof honeypot === "string" && honeypot.trim() !== "") {
        return NextResponse.json({ error: "We could not verify this submission." }, { status: 400, headers });
      }
      if (typeof turnstileToken !== "string" || !turnstileToken
        || !(await verifyTurnstileToken(turnstileToken, getClientIp(request), admissionSignal))) {
        return NextResponse.json({ error: "We could not verify you're not a bot. Please try again.", code: "turnstile_failed" }, { status: 400, headers });
      }
      await consumeAnonymousReportAttempt(getClientIpHash(request), admissionSignal);
      submitterId = ANONYMOUS_PROFILE_ID;
    }
    // Resolved only after the bot-check/rate-limit gate passes, so a bot can't
    // spam-create map pins by failing later stages of the same request.
    const locationId = hasLocationId ? (locationIdField as string) : (await findOrCreateLocation(lat, lng)).id;
    const approvedDescription = await checkContentPolicy({ kind: "report_note", text: description });
    // Same profanity/impersonation/prompt-injection check as the description, so a nickname
    // can't be used to smuggle abuse or staff impersonation onto the public map.
    const approvedNickname = nickname ? await checkContentPolicy({ kind: "nickname", text: nickname }) : null;
    // Policy and capacity failures must happen before any evidence upload or report insert.
    imagePath = image instanceof File ? await uploadReportImage(await normalizePhoto(image), submitterId) : null;
    // A photo always needs a human to check it for identifying details (no redaction tool
    // exists yet) - only a text-only report is ever eligible for the AI risk check below.
    const isFlagged = imagePath ? false : await assessReportRisk(approvedDescription.text);
    const report = await createReport({
      locationId,
      userId: submitterId,
      reporterType: reporterType as ReporterType,
      approvedDescription,
      incidentDate: typeof incidentDate === "string" && incidentDate ? incidentDate : null,
      imagePath,
      isAnonymous,
      nickname: approvedNickname?.text ?? null,
      isFlagged,
      autoPublish: !imagePath && !isFlagged,
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
