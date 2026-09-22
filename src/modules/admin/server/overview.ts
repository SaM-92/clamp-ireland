import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { adminOverviewSchema, type AdminOverview } from "../types";

/** Only call after requireAdmin. Counts include no report text or user identities. */
export async function getAdminOverview(): Promise<AdminOverview> {
  const supabase = createServiceRoleClient();
  const results = await Promise.all([
    supabase.from("reports").select("id", { count: "exact", head: true })
      .eq("moderation_status", "pending").eq("is_removed", false),
    supabase.from("reports").select("id", { count: "exact", head: true })
      .eq("moderation_status", "published").eq("is_removed", false),
    supabase.from("reports").select("id", { count: "exact", head: true })
      .eq("moderation_status", "rejected"),
    supabase.from("reports").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);
  for (const result of results) {
    if (result.error) throw result.error;
    if (result.count === null) throw new Error("Admin overview count was not returned.");
  }
  return adminOverviewSchema.parse({
    pending: results[0].count,
    published: results[1].count,
    rejected: results[2].count,
    totalReports: results[3].count,
    totalUsers: results[4].count,
  });
}
