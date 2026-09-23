import { NextResponse } from "next/server";
import { VoteAccessError, VoteUnavailableError } from "./repository";

export const voteResponseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export function voteError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: voteResponseHeaders });
}

export function voteFailure(error: unknown) {
  if (error instanceof VoteAccessError) return voteError(error.message, 401);
  if (error instanceof VoteUnavailableError) return voteError(error.message, 404);
  console.error("[ReportVotes] request failed", error);
  return voteError("Could not load or save feedback. Please try again.", 500);
}
