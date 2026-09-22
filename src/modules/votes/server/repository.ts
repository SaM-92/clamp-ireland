import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  ownVoteSchema, reportIdsSchema, voteInputSchema, voteSnapshotSchema,
  type OwnVote, type ReportVote, type VoteSnapshot,
} from "../types";
import { z } from "zod";

export class VoteAccessError extends Error {}
export class VoteUnavailableError extends Error {}

function checkDatabaseError(error: { code?: string; message: string } | null) {
  if (error?.code === "28000") throw new VoteAccessError("Sign in with a confirmed account to vote.");
  if (error) throw new Error(`Vote storage failed (${error.code ?? "unknown"}).`);
}

export async function setReportVote(reportId: string, userId: string, vote: ReportVote | null): Promise<VoteSnapshot> {
  z.uuid().parse(reportId);
  z.uuid().parse(userId);
  voteInputSchema.parse({ vote });
  const { data, error } = await createServiceRoleClient().rpc("set_report_vote", {
    p_report_id: reportId, p_user_id: userId, p_vote: vote,
  });
  checkDatabaseError(error);
  if (data === null) throw new VoteUnavailableError("This note is no longer available for voting. Reload notes.");
  const result = voteSnapshotSchema.parse(data);
  if (result.reportId !== reportId || result.vote !== vote) throw new Error("Vote storage returned an inconsistent result.");
  return result;
}

export async function getOwnReportVotes(reportIds: string[], userId: string): Promise<OwnVote[]> {
  reportIdsSchema.parse(reportIds);
  z.uuid().parse(userId);
  const { data, error } = await createServiceRoleClient().rpc("get_report_votes_for_user", {
    p_report_ids: reportIds, p_user_id: userId,
  });
  checkDatabaseError(error);
  const votes = z.array(ownVoteSchema).max(50).parse(data);
  if (votes.some((row) => !reportIds.includes(row.reportId)) || new Set(votes.map((row) => row.reportId)).size !== votes.length) {
    throw new Error("Vote storage returned an inconsistent batch.");
  }
  return votes;
}
