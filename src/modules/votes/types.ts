import { z } from "zod";

export const reportVoteSchema = z.enum(["agree", "disagree"]);
export type ReportVote = z.infer<typeof reportVoteSchema>;
export const voteCountsSchema = z.strictObject({
  agreeCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  disagreeCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type VoteCounts = z.infer<typeof voteCountsSchema>;
export const ownVoteSchema = z.strictObject({ reportId: z.uuid(), vote: reportVoteSchema.nullable() });
export type OwnVote = z.infer<typeof ownVoteSchema>;
export const voteSnapshotSchema = ownVoteSchema.extend(voteCountsSchema.shape);
export type VoteSnapshot = z.infer<typeof voteSnapshotSchema>;
export const reportIdsSchema = z.array(z.uuid()).min(1).max(50)
  .refine((ids) => new Set(ids).size === ids.length, "Report IDs must be unique.");
export const voteInputSchema = z.strictObject({ vote: reportVoteSchema.nullable() });
export const ownVotesResponseSchema = z.strictObject({ votes: z.array(ownVoteSchema).max(50) });

export type VoteViewer =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; vote: ReportVote | null };
