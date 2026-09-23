import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeTransaction } from "@/lib/db/server";
import { getTextSoftener } from "./textSoftening";
import { assertApprovedContent, type ApprovedContent } from "@/modules/content-policy/server/check";
import type { ReporterType, SubmittedReport } from "../types";

export interface CreateReportInput {
  locationId: string;
  userId: string;
  reporterType: ReporterType;
  approvedDescription: ApprovedContent;
  incidentDate: string | null;
  imagePath: string | null;
}

export class ReportInsertError extends Error {
  constructor(readonly rolledBack: boolean) {
    super("Report persistence could not be confirmed.");
    this.name = "ReportInsertError";
  }
}

/** The heuristic is an editing aid. Text and photos still require human review. */
export async function createReport(input: CreateReportInput): Promise<SubmittedReport> {
  assertApprovedContent(input.approvedDescription, "report_note");
  const description = await getTextSoftener().soften(input.approvedDescription.text);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  try {
    return writeTransaction((db) => {
      if (!db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0 AND username_policy_checked_at IS NOT NULL").get(input.userId)) {
        throw new Error("An active account with an approved username is required.");
      }
      db.prepare(`INSERT INTO reports
        (id,location_id,user_id,reporter_type,has_image,image_url,description,description_raw,incident_date,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, z.uuid().parse(input.locationId), input.userId,
        input.reporterType, Number(Boolean(input.imagePath)), input.imagePath, description,
        input.approvedDescription.text, input.incidentDate, createdAt);
      return {
        id, location_id: input.locationId, reporter_type: input.reporterType,
        has_image: Boolean(input.imagePath), description, incident_date: input.incidentDate,
        moderation_status: "pending", created_at: createdAt,
      };
    });
  } catch (error) {
    console.error("[Reports] SQLite insert failed", error instanceof AggregateError ? "rollback unconfirmed" : "rolled back");
    throw new ReportInsertError(!(error instanceof AggregateError));
  }
}
