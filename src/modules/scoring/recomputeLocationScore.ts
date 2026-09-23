import "server-only";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { database } from "@/lib/db/server";
import { calculateRiskScore } from "./calculateRiskScore";
import { riskLevelFromScore } from "./riskLevel";

/** Pass the caller's transaction so publication, invalidation and counts commit together. */
export function recomputeLocationScore(locationId: string, db: DatabaseSync = database()): void {
  const rows = z.array(z.object({
    reporter_type: z.enum(["victim", "neighbour", "witness"]),
    has_image: z.union([z.literal(0), z.literal(1)]), created_at: z.string(),
  })).parse(db.prepare(`SELECT reporter_type,has_image,created_at FROM reports
    WHERE location_id=? AND moderation_status='published' AND reviewed_at IS NOT NULL AND is_removed=0`).all(locationId));
  const score = calculateRiskScore(rows.map((row) => ({
    reporterType: row.reporter_type, hasImage: row.has_image === 1, createdAt: new Date(row.created_at),
  })));
  db.prepare("UPDATE locations SET risk_score=?,risk_level=?,report_count=?,updated_at=? WHERE id=?")
    .run(score, riskLevelFromScore(score), rows.length, new Date().toISOString(), locationId);
}
