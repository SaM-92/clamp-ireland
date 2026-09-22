import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getSignedImageUrl } from "@/modules/reports/server/imageStorage";
import { recomputeLocationScore } from "@/modules/scoring";
import { pendingReportsSchema, type PendingReport } from "../types";

/** Text and photos awaiting human review. */
export async function listPendingReports(): Promise<PendingReport[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("reports")
    .select("id, location_id, reporter_type, description, has_image, image_url, created_at")
    .eq("moderation_status", "pending")
    .eq("is_removed", false)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const reports = await Promise.all(
    (data ?? []).map(async (row) => {
      const hasImage = Boolean(row.has_image || row.image_url);
      let imageUrl: string | null = null;
      let imageError: string | null = null;
      if (hasImage) {
        try {
          if (!row.image_url) throw new Error("Report has photo evidence but no storage path.");
          imageUrl = await getSignedImageUrl(row.image_url as string, 600);
        } catch (error) {
          console.error("[Moderation] private image unavailable", row.id, error);
          imageError = "Private photo could not be signed or found. Approval is blocked. Reload the queue to retry, or reject the report.";
        }
      }
      return {
        id: row.id,
        locationId: row.location_id,
        reporterType: row.reporter_type,
        description: row.description ?? "",
        createdAt: row.created_at,
        hasImage, imageUrl, imageError,
      };
    })
  );
  return pendingReportsSchema.parse(reports);
}

/** Publish the reviewed wording without changing the private original. */
export async function approveReport(reportId: string, description: string, reviewerId: string) {
  const supabase = createServiceRoleClient();
  const { data: evidence, error: evidenceError } = await supabase
    .from("reports").select("has_image, image_url")
    .eq("id", reportId).eq("moderation_status", "pending").eq("is_removed", false).single();
  if (evidenceError) throw evidenceError;
  if (evidence.has_image || evidence.image_url) {
    if (!evidence.image_url) throw new Error("Cannot approve a report with missing photo evidence.");
    await getSignedImageUrl(evidence.image_url as string, 600);
  }
  const { data, error } = await supabase
    .from("reports")
    .update({
      moderation_status: "published", description,
      reviewed_at: new Date().toISOString(), reviewed_by: reviewerId,
    })
    .eq("id", reportId)
    .eq("moderation_status", "pending")
    .eq("is_removed", false)
    .select()
    .single();
  if (error) throw error;
  await recomputeLocationScore(data.location_id as string);
  return data;
}

/** Rejects and soft-removes a report that shouldn't be public. */
export async function rejectReport(reportId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("reports")
    .update({ moderation_status: "rejected", is_removed: true })
    .eq("id", reportId)
    .eq("moderation_status", "pending")
    .eq("is_removed", false)
    .select()
    .single();
  if (error) throw error;
  await recomputeLocationScore(data.location_id as string);
  return data;
}
