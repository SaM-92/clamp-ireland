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
  return writeTransaction((db) => {
    if (!db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(userId)) throw new VoteAccessError("Sign in to vote.");
    if (!db.prepare("SELECT id FROM reports_public WHERE id=?").get(reportId)) {
      throw new VoteUnavailableError("This note is no longer available for voting. Reload notes.");
    }
    if (vote === null) db.prepare("DELETE FROM report_votes WHERE report_id=? AND user_id=?").run(reportId, userId);
    else db.prepare(`INSERT INTO report_votes(report_id,user_id,vote) VALUES (?,?,?)
      ON CONFLICT(report_id,user_id) DO UPDATE SET vote=excluded.vote`).run(reportId, userId, vote);
    const counts = db.prepare("SELECT agree_count AS agreeCount,disagree_count AS disagreeCount FROM reports_public WHERE id=?").get(reportId);
    return voteSnapshotSchema.parse({ reportId, vote, ...counts });
  });
}

export async function getOwnReportVotes(reportIds: string[], userId: string): Promise<OwnVote[]> {
  reportIdsSchema.parse(reportIds);
  z.uuid().parse(userId);
  const db = database();
  if (!db.prepare("SELECT id FROM profiles WHERE id=? AND is_banned=0").get(userId)) throw new VoteAccessError("Sign in to vote.");
  const rows = db.prepare(`SELECT r.id AS reportId,v.vote FROM reports_public r
    LEFT JOIN report_votes v ON v.report_id=r.id AND v.user_id=?
    WHERE r.id IN (${reportIds.map(() => "?").join(",")})`).all(userId, ...reportIds);
  return z.array(ownVoteSchema).max(50).parse(rows);
}
