import { z } from "zod";
import { reportVoteSchema, voteInputSchema, type ReportVote, type VoteSnapshot } from "./types";

export const PREVIEW_VOTES_KEY = "clamp-local-preview-votes-v1";
export const PREVIEW_VOTES_EVENT = "clamp-preview-votes-changed";
const savedVotesSchema = z.record(z.uuid(), reportVoteSchema);

function readVotes(): Record<string, ReportVote> {
  const value = localStorage.getItem(PREVIEW_VOTES_KEY);
  if (value === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Saved preview votes are invalid. Use Reset preview to clear them.");
  }
  const result = savedVotesSchema.safeParse(parsed);
  if (!result.success) throw new Error("Saved preview votes are invalid. Use Reset preview to clear them.");
  return result.data;
}

export function loadPreviewVote(reportId: string): VoteSnapshot {
  z.uuid().parse(reportId);
  const vote = readVotes()[reportId] ?? null;
  return { reportId, vote, agreeCount: vote === "agree" ? 1 : 0, disagreeCount: vote === "disagree" ? 1 : 0 };
}

export function savePreviewVote(reportId: string, vote: ReportVote | null): VoteSnapshot {
  z.uuid().parse(reportId);
  voteInputSchema.parse({ vote });
  const votes = readVotes();
  if (vote === null) delete votes[reportId];
  else votes[reportId] = vote;
  localStorage.setItem(PREVIEW_VOTES_KEY, JSON.stringify(votes));
  window.dispatchEvent(new Event(PREVIEW_VOTES_EVENT));
  return loadPreviewVote(reportId);
}

export function clearPreviewVotes() {
  localStorage.removeItem(PREVIEW_VOTES_KEY);
  window.dispatchEvent(new Event(PREVIEW_VOTES_EVENT));
}
