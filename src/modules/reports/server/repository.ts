import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getTextSoftener } from "./textSoftening";
import { assertApprovedContent, type ApprovedContent } from "@/modules/content-policy/server/check";
import type { ReporterType, SubmittedReport } from "../types";

export interface CreateReportInput {
  locationId: string;
  userId: string;
  reporterType: ReporterType;
  approvedDescription: ApprovedContent;
  incidentDate: string | null;
  imagePath: string | null;
}

/**
 * The heuristic is only an editing aid, not an anonymization gate.
 * All text and photos remain pending until a human approves publication.
 */
export async function createReport(input: CreateReportInput): Promise<SubmittedReport> {
  assertApprovedContent(input.approvedDescription, "report_note");
  const supabase = createServiceRoleClient();
  const softener = getTextSoftener();
  const description = input.approvedDescription.text;
  const softenedDescription = await softener.soften(description);
  const hasImage = Boolean(input.imagePath);

  const { data, error } = await supabase
    .from("reports")
    .insert({
      location_id: input.locationId,
      user_id: input.userId,
      reporter_type: input.reporterType,
      has_image: hasImage,
      image_url: input.imagePath,
      description: softenedDescription,
      description_raw: description,
      incident_date: input.incidentDate,
      moderation_status: "pending",
    })
    .select()
    .single();

  if (error) throw error;

  return data as SubmittedReport;
}
