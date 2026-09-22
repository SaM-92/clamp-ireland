import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { calculateRiskScore, type ScorableReport } from "./calculateRiskScore";
import { riskLevelFromScore } from "./riskLevel";
import type { ReporterType } from "@/modules/reports/types";

/**
 * Recomputes and persists a location's cached risk_score/risk_level from its
 * currently published, non-removed reports. Call this after any report is
 * published or a moderation decision changes what counts — see
 * docs/02-data-model.md for why this is cached rather than computed on
 * every read.
 */
export async function recomputeLocationScore(locationId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("reports")
    .select("reporter_type, has_image, created_at")
    .eq("location_id", locationId)
    .eq("moderation_status", "published")
    .not("reviewed_at", "is", null)
    .eq("is_removed", false);

  if (error) throw error;

  const scorable: ScorableReport[] = (data ?? []).map((row) => ({
    reporterType: row.reporter_type as ReporterType,
    hasImage: row.has_image as boolean,
    createdAt: new Date(row.created_at as string),
  }));

  const riskScore = calculateRiskScore(scorable);
  const riskLevel = riskLevelFromScore(riskScore);

  const { error: updateError } = await supabase
    .from("locations")
    .update({
      risk_score: riskScore,
      risk_level: riskLevel,
      report_count: scorable.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", locationId);

  if (updateError) throw updateError;
}
