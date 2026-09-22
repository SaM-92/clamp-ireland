import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getTextSoftener } from "./textSoftening";
import type { ReporterType, SubmittedReport } from "../types";

export interface CreateReportInput {
  locationId: string;
  userId: string;
  reporterType: ReporterType;
  description: string;
  incidentDate: string | null;
  imagePath: string | null;
}

/**
 * The heuristic is only an editing aid, not an anonymization gate.
 * All text and photos remain pending until a human approves publication.
 */
export async function createReport(input: CreateReportInput): Promise<SubmittedReport> {
  const supabase = createServiceRoleClient();
  const softener = getTextSoftener();
  const softenedDescription = input.description ? await softener.soften(input.description) : "";
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
      description_raw: input.description,
      incident_date: input.incidentDate,
      moderation_status: "pending",
    })
    .select()
    .single();

  if (error) throw error;

  return data as SubmittedReport;
}
