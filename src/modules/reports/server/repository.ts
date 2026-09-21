import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { recomputeLocationScore } from "@/modules/scoring";
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
 * Inserts a report and applies the two moderation gates agreed for this
 * project (docs/00-product-plan.md):
 * - Text is rewritten by the (AI or heuristic) softener before it's ever
 *   public, and publishes immediately if there's no image.
 * - Any report with a photo stays `pending` until a human moderator
 *   approves it via the moderation queue — see
 *   src/modules/moderation/server/repository.ts.
 */
export async function createReport(input: CreateReportInput): Promise<SubmittedReport> {
  const supabase = createServiceRoleClient();
  const softener = getTextSoftener();
  const softenedDescription = input.description ? await softener.soften(input.description) : "";
  const hasImage = Boolean(input.imagePath);
  const moderationStatus = hasImage ? "pending" : "published";

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
      moderation_status: moderationStatus,
    })
    .select()
    .single();

  if (error) throw error;

  if (moderationStatus === "published") {
    await recomputeLocationScore(input.locationId);
  }

  return data as SubmittedReport;
}
