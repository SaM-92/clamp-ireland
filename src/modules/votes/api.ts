"use client";

import {
  ownVotesResponseSchema, reportIdsSchema, voteInputSchema, voteSnapshotSchema,
  type OwnVote, type ReportVote, type VoteSnapshot,
} from "./types";
import { z } from "zod";

export class VoteHttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function readResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VoteHttpError("Feedback service returned an unreadable response. Please try again.", response.status);
  }
  if (!response.ok) {
    const error = z.object({ error: z.string().min(1).max(500) }).safeParse(body);
    throw new VoteHttpError(error.success ? error.data.error : "Could not load or save feedback. Please try again.", response.status);
  }
  return body;
}

export async function fetchOwnReportVotes(reportIds: string[], signal?: AbortSignal): Promise<OwnVote[]> {
  reportIdsSchema.parse(reportIds);
  const response = await fetch(`/api/report-votes?${new URLSearchParams({ reportIds: reportIds.join(",") })}`, {
    credentials: "same-origin", cache: "no-store", signal,
  });
  const { votes } = ownVotesResponseSchema.parse(await readResponse(response));
  if (votes.some((row) => !reportIds.includes(row.reportId)) || new Set(votes.map((row) => row.reportId)).size !== votes.length) {
    throw new Error("Feedback service returned an invalid batch.");
  }
  return votes;
}

export async function saveReportVote(reportId: string, vote: ReportVote | null): Promise<VoteSnapshot> {
  z.uuid().parse(reportId);
  voteInputSchema.parse({ vote });
  const response = await fetch(`/api/report-votes/${reportId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
    cache: "no-store", body: JSON.stringify({ vote }),
  });
  const result = voteSnapshotSchema.parse(await readResponse(response));
  if (result.reportId !== reportId || result.vote !== vote) throw new Error("Feedback service returned an inconsistent vote.");
  return result;
}
