import "server-only";
import { z } from "zod";
import { database } from "@/lib/db/server";
import { isDatabaseConfigured } from "@/lib/env";
import type { TransparencyStats } from "../types";

export async function getTransparencyStats(): Promise<TransparencyStats> {
  if (!isDatabaseConfigured) return { totalReports: 0, reportsThisMonth: 0, highRiskLocations: 0, totalLocations: 0 };
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  const count = z.number().int().nonnegative();
  const db = await database();
  return z.object({
    totalReports: count, reportsThisMonth: count, highRiskLocations: count, totalLocations: count,
  }).parse(await db.prepare(`SELECT
    (SELECT count(*) FROM reports_public) AS totalReports,
    (SELECT count(*) FROM reports_public WHERE created_at>=?) AS reportsThisMonth,
    (SELECT count(*) FROM locations WHERE report_count>0 AND risk_level='high') AS highRiskLocations,
    (SELECT count(*) FROM locations WHERE report_count>0) AS totalLocations`).get(month.toISOString()));
}
