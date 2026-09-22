import "server-only";
import { createAnonServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { TransparencyStats } from "../types";

const EMPTY_STATS: TransparencyStats = {
  totalReports: 0,
  reportsThisMonth: 0,
  highRiskLocations: 0,
  totalLocations: 0,
};

/**
 * Aggregate counters behind the "Clamp Transparency Signal" — the
 * headline feature that keeps this app framed as public-interest
 * reporting rather than an accusation tool (docs/00-product-plan.md §0).
 * Falls back to zeros when Supabase hasn't been configured yet, so local
 * scaffolding and `next build` work before a real project is wired up.
 */
export async function getTransparencyStats(): Promise<TransparencyStats> {
  if (!isSupabaseConfigured) return EMPTY_STATS;

  try {
    const supabase = createAnonServerClient();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalReports, reportsThisMonth, highRiskLocations, totalLocations] = await Promise.all([
      supabase
        .from("reports_public")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("reports_public")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfMonth.toISOString()),
      supabase.from("locations").select("*", { count: "exact", head: true }).eq("risk_level", "high"),
      supabase.from("locations").select("*", { count: "exact", head: true }).gt("report_count", 0),
    ]);
    const failure = [totalReports, reportsThisMonth, highRiskLocations, totalLocations].find((result) => result.error);
    if (failure?.error) throw failure.error;

    return {
      totalReports: totalReports.count ?? 0,
      reportsThisMonth: reportsThisMonth.count ?? 0,
      highRiskLocations: highRiskLocations.count ?? 0,
      totalLocations: totalLocations.count ?? 0,
    };
  } catch (error) {
    console.error("[Dashboard] counts failed", error);
    throw new Error("Community counts could not load. Please try again later.");
  }
}
