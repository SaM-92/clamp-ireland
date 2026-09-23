import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/modules/auth/server/session";
import { getOwnReportVotes } from "@/modules/votes/server/repository";
import { voteError, voteFailure, voteResponseHeaders } from "@/modules/votes/server/http";
import { reportIdsSchema } from "@/modules/votes/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return voteError("Sign in with Google to see your votes.", 401);
    const query = new URL(request.url).searchParams;
    const ids = reportIdsSchema.safeParse(query.get("reportIds")?.split(","));
    if (!ids.success || query.getAll("reportIds").length !== 1) return voteError("Supply 1 to 50 unique valid report IDs.", 400);
    const votes = await getOwnReportVotes(ids.data, user.id);
    return NextResponse.json({ votes }, { headers: voteResponseHeaders });
  } catch (error) {
    return voteFailure(error);
  }
}
