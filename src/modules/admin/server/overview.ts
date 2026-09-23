import "server-only";
import { database } from "@/lib/db/server";
import { adminOverviewSchema, type AdminOverview } from "../types";

/** Only call after requireAdmin. No identities or report text leave this projection. */
export async function getAdminOverview(): Promise<AdminOverview> {
  const db = await database();
  return adminOverviewSchema.parse(await db.prepare(`SELECT
    (SELECT count(*) FROM reports WHERE moderation_status='pending' AND is_removed=0) AS pending,
    (SELECT count(*) FROM reports WHERE moderation_status='published' AND is_removed=0) AS published,
    (SELECT count(*) FROM reports WHERE moderation_status='rejected') AS rejected,
    (SELECT count(*) FROM reports) AS totalReports,
    (SELECT count(*) FROM profiles) AS totalUsers`).get());
}
