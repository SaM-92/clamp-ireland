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

export class ReportInsertError extends Error {
  readonly rolledBack: boolean;
  constructor(code: string | undefined) {
    super("Report persistence could not be confirmed.");
    this.name = "ReportInsertError";
    // Only explicit SQL rollback classes permit deletion; transport errors may follow a commit.
    this.rolledBack = typeof code === "string" && /^(22|23|40|42)[0-9A-Z]{3}$/.test(code);
  }
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
    .abortSignal(AbortSignal.timeout(15_000))
    .single();

  if (error) throw new ReportInsertError(error.code);

  return data as SubmittedReport;
}
