import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getSignedImageUrl } from "@/modules/reports/server/imageStorage";
import { recomputeLocationScore } from "@/modules/scoring";
import type { PendingReport } from "../types";

/** Text and photos awaiting human review. */
export async function listPendingReports(): Promise<PendingReport[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("reports")
    .select("id, location_id, reporter_type, description, image_url, created_at")
    .eq("moderation_status", "pending")
    .eq("is_removed", false)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return Promise.all(
    (data ?? []).map(async (row) => ({
      id: row.id as string,
      locationId: row.location_id as string,
      reporterType: row.reporter_type as string,
      description: row.description as string,
      createdAt: row.created_at as string,
      imageUrl: row.image_url ? await getSignedImageUrl(row.image_url as string) : null,
    }))
  );
}

/** Publish the reviewed wording without changing the private original. */
export async function approveReport(reportId: string, description: string, reviewerId: string) {
  const supabase = createServiceRoleClient();
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
    .select()
    .single();
  if (error) throw error;
  await recomputeLocationScore(data.location_id as string);
  return data;
}
