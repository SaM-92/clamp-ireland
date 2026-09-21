import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabase/server";
import { createReport } from "@/modules/reports/server/repository";
import { uploadReportImage } from "@/modules/reports/server/imageStorage";
import { REPORTER_TYPES, type ReporterType } from "@/modules/reports/types";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in required to submit a report." }, { status: 401 });
  }

  const formData = await request.formData();
  const locationId = formData.get("locationId");
  const reporterType = formData.get("reporterType");
  const description = formData.get("description");
  const incidentDate = formData.get("incidentDate");
  const image = formData.get("image");

  if (
    typeof locationId !== "string" ||
    typeof reporterType !== "string" ||
    typeof description !== "string"
  ) {
    return NextResponse.json(
      { error: "locationId, reporterType and description are required." },
      { status: 400 }
    );
  }
  if (!REPORTER_TYPES.includes(reporterType as ReporterType)) {
    return NextResponse.json({ error: "Invalid reporterType." }, { status: 400 });
  }

  let imagePath: string | null = null;
  if (image instanceof File && image.size > 0) {
    // The report row doesn't exist yet at upload time, so images are staged
    // under a per-user/time-bucketed prefix rather than the (not yet known)
    // report id.
    imagePath = await uploadReportImage(image, `${user.id}-${Date.now()}`);
  }

  try {
    const report = await createReport({
      locationId,
      userId: user.id,
      reporterType: reporterType as ReporterType,
      description,
      incidentDate: typeof incidentDate === "string" && incidentDate ? incidentDate : null,
      imagePath,
    });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to submit report." },
      { status: 500 }
    );
  }
}
