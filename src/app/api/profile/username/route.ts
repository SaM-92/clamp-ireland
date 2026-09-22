import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabase/server";
import { getPublicIdentity, ProfileError, savePublicIdentity } from "@/modules/auth/server/profile";
import { ContentPolicyError, POLICY_UNAVAILABLE_MESSAGE, validateContent } from "@/modules/content-policy/policy";
import { checkContentPolicy } from "@/modules/content-policy/server/check";
import { consumeContentPolicyAttempt } from "@/modules/content-policy/server/rateLimit";
import { readBoundedJson } from "@/lib/server/readBoundedJson";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

function failure(error: unknown) {
  if (error instanceof ContentPolicyError || error instanceof ProfileError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
  }
  console.error("[Username] request failed");
  return NextResponse.json({ error: POLICY_UNAVAILABLE_MESSAGE, code: "content_policy_unavailable" }, { status: 503, headers });
}

export async function GET(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in with a confirmed account to choose a username." }, { status: 401, headers });
    return NextResponse.json(await getPublicIdentity(user.id), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in with a confirmed account to choose a username." }, { status: 401, headers });
    let body: unknown;
    try {
      body = await readBoundedJson(request, 256, new Error("Invalid username JSON"));
    } catch {
      return NextResponse.json({ error: "Supply a username as JSON.", code: "invalid_content" }, { status: 400, headers });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("username" in body)) {
      return NextResponse.json({ error: "Supply only a username.", code: "invalid_content" }, { status: 400, headers });
    }
    const text = validateContent("username", body.username);
    await getPublicIdentity(user.id);
    await consumeContentPolicyAttempt(user.id);
    const approval = await checkContentPolicy({ kind: "username", text });
    return NextResponse.json(await savePublicIdentity(user.id, approval), { headers });
  } catch (error) {
    return failure(error);
  }
}
