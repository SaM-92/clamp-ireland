import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/server";
import { setReportVote } from "@/modules/votes/server/repository";
import { voteError, voteFailure, voteResponseHeaders } from "@/modules/votes/server/http";
import { voteInputSchema } from "@/modules/votes/types";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return voteError("Sign in with a confirmed account to vote.", 401);
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return voteError("Invalid report ID.", 400);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return voteError("Send a valid JSON vote.", 400);
    }
    const input = voteInputSchema.safeParse(body);
    if (!input.success) return voteError("Vote must be agree, disagree or null (remove).", 400);
    const snapshot = await setReportVote(id, user.id, input.data.vote);
    return NextResponse.json(snapshot, { headers: voteResponseHeaders });
  } catch (error) {
    return voteFailure(error);
  }
}
