import "server-only";
import { z } from "zod";
import { database } from "@/lib/db/server";
import type { SqlConnection } from "../../../database/sql-store.d.mts";
import { calculateRiskScore } from "./calculateRiskScore";
import { riskLevelFromScore } from "./riskLevel";

/** Pass the caller's transaction so publication, invalidation and counts commit together. */
export async function recomputeLocationScore(locationId: string, db?: SqlConnection): Promise<void> {
  const connection = db ?? (await database());
  const rows = z.array(z.object({
    reporter_type: z.enum(["victim", "neighbour", "witness"]),
    // mssql returns `bit` columns as JS booleans; better-sqlite3 returned 0/1 integers.
    has_image: z.union([z.literal(0), z.literal(1), z.boolean()]), created_at: z.string(),
  })).parse(await connection.prepare(`SELECT reporter_type,has_image,created_at FROM reports
    WHERE location_id=? AND moderation_status='published' AND reviewed_at IS NOT NULL AND is_removed=0`).all(locationId));
  const score = calculateRiskScore(rows.map((row) => ({
    reporterType: row.reporter_type, hasImage: row.has_image === 1 || row.has_image === true, createdAt: new Date(row.created_at),
  })));
  await connection.prepare("UPDATE locations SET risk_score=?,risk_level=?,report_count=?,updated_at=? WHERE id=?")
    .run(score, riskLevelFromScore(score), rows.length, new Date().toISOString(), locationId);
}
