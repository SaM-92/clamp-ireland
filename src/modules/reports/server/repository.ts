import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeTransaction } from "@/lib/db/server";
import { getTextSoftener } from "./textSoftening";
import { assertApprovedContent, type ApprovedContent } from "@/modules/content-policy/server/check";
import { recomputeLocationScore } from "@/modules/scoring";
import { invalidateNearbyAreaSummaries } from "@/modules/area-summaries/server/repository";
import type { ReporterType, SubmittedReport } from "../types";

export interface CreateReportInput {
  locationId: string;
  userId: string;
  reporterType: ReporterType;
  approvedDescription: ApprovedContent;
  incidentDate: string | null;
  imagePath: string | null;
  isAnonymous?: boolean;
  /** Required, content-policy-checked display name for anonymous submitters only (see
   * assessReportRisk's sibling check, checkContentPolicy with kind "nickname"). Always null for
   * a signed-in user, who already has their own checked public username instead. */
  nickname?: string | null;
  /** Publish immediately without a moderator - only ever set for text-only reports the AI risk
   * check (assessReportRisk) actively cleared. A photo always keeps the report pending. */
  autoPublish?: boolean;
  /** Whether the AI risk check flagged this text for a human to look at. Purely informational
   * when autoPublish is false: the report is pending either way (because of the flag, a photo,
   * or both) - this only changes the "why" shown to the moderator and reporter. */
  isFlagged?: boolean;
}

export class ReportInsertError extends Error {
  constructor(readonly rolledBack: boolean) {
    super("Report persistence could not be confirmed.");
    this.name = "ReportInsertError";
  }
}

/** The heuristic is an editing aid. Text and photos still require human review unless autoPublish
 * was already cleared by the AI risk check (see assessReportRisk; never set for photo reports). */
export async function createReport(input: CreateReportInput): Promise<SubmittedReport> {
  assertApprovedContent(input.approvedDescription, "report_note");
  if (input.autoPublish && input.imagePath) throw new Error("A photo report can never auto-publish.");
  const description = await getTextSoftener().soften(input.approvedDescription.text);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const autoPublish = Boolean(input.autoPublish);
  try {
    return await writeTransaction(async (db) => {
      if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0 AND username_policy_checked_at IS NOT NULL").get(input.userId))) {
        throw new Error("An active account with an approved username is required.");
      }
      await db.prepare(`INSERT INTO reports
        (id,location_id,user_id,reporter_type,has_image,image_url,description,description_raw,incident_date,created_at,
         is_anonymous,nickname,is_flagged,moderation_status,reviewed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, z.uuid().parse(input.locationId), input.userId,
        input.reporterType, Number(Boolean(input.imagePath)), input.imagePath, description,
        input.approvedDescription.text, input.incidentDate, createdAt, Number(Boolean(input.isAnonymous)),
        input.nickname ?? null, Number(Boolean(input.isFlagged)), autoPublish ? "published" : "pending", autoPublish ? createdAt : null);
      if (autoPublish) {
        await recomputeLocationScore(input.locationId, db);
        const location = z.object({ latitude: z.number(), longitude: z.number() }).nullable()
          .parse(await db.prepare("SELECT lat AS latitude,lng AS longitude FROM locations WHERE id=?").get(input.locationId));
        if (location) await invalidateNearbyAreaSummaries(location, db);
      }
      return {
        id, location_id: input.locationId, reporter_type: input.reporterType,
        has_image: Boolean(input.imagePath), description, incident_date: input.incidentDate,
        moderation_status: autoPublish ? "published" : "pending", created_at: createdAt,
        is_anonymous: Boolean(input.isAnonymous), is_flagged: Boolean(input.isFlagged),
      };
    });
  } catch (error) {
    console.error("[Reports] insert failed", error instanceof AggregateError ? "rollback unconfirmed" : "rolled back");
    throw new ReportInsertError(!(error instanceof AggregateError));
  }
}
