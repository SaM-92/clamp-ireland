import "server-only";
import { database, writeTransaction } from "@/lib/db/server";
import { ownVoteSchema, reportIdsSchema, voteInputSchema, voteSnapshotSchema, type OwnVote, type ReportVote, type VoteSnapshot } from "../types";
import { z } from "zod";

export class VoteAccessError extends Error {}
export class VoteUnavailableError extends Error {}

export async function setReportVote(reportId: string, userId: string, vote: ReportVote | null): Promise<VoteSnapshot> {
  z.uuid().parse(reportId);
  z.uuid().parse(userId);
  voteInputSchema.parse({ vote });
  return writeTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(userId))) throw new VoteAccessError("Sign in to vote.");
    if (!(await db.prepare("SELECT id FROM reports_public WHERE id=?").get(reportId))) {
      throw new VoteUnavailableError("This note is no longer available for voting. Reload notes.");
    }
    if (vote === null) await db.prepare("DELETE FROM report_votes WHERE report_id=? AND user_id=?").run(reportId, userId);
    else await db.prepare(`MERGE INTO report_votes WITH (HOLDLOCK) AS target
      USING (SELECT ? AS report_id,? AS user_id) AS source
      ON target.report_id=source.report_id AND target.user_id=source.user_id
      WHEN MATCHED THEN UPDATE SET vote=?
      WHEN NOT MATCHED THEN INSERT (report_id,user_id,vote) VALUES (source.report_id,source.user_id,?);`)
      .run(reportId, userId, vote, vote);
    const counts = await db.prepare("SELECT agree_count AS agreeCount,disagree_count AS disagreeCount FROM reports_public WHERE id=?").get(reportId);
    return voteSnapshotSchema.parse({ reportId, vote, ...counts });
  });
}

export async function getOwnReportVotes(reportIds: string[], userId: string): Promise<OwnVote[]> {
  reportIdsSchema.parse(reportIds);
  z.uuid().parse(userId);
  const db = await database();
  if (!(await db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(userId))) throw new VoteAccessError("Sign in to vote.");
  const rows = await db.prepare(`SELECT r.id AS reportId,v.vote FROM reports_public r
    LEFT JOIN report_votes v ON v.report_id=r.id AND v.user_id=?
    WHERE r.id IN (${reportIds.map(() => "?").join(",")})`).all(userId, ...reportIds);
  return z.array(ownVoteSchema).max(50).parse(rows);
}
