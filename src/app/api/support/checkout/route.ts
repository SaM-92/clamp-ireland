import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupportCheckoutSession, isSupportConfigured } from "@/modules/donations/server/checkout";
import { NOINDEX_HEADER } from "@/modules/seo/policy";
import { authSettings } from "@/modules/auth/server/session";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": NOINDEX_HEADER };
const bodySchema = z.object({ amount: z.number() });

export async function POST(request: Request) {
  // Same-origin only: this endpoint needs no sign-in (anyone can support the
  // project), so cross-site abuse is stopped by origin checks instead of a
  // session cookie - matching the traffic-analytics endpoint's guard.
  // Compares against the configured public origin (AUTH_PUBLIC_ORIGIN), not
  // request.url's own origin: behind the Container Apps ingress, TLS is
  // terminated upstream, so request.url reflects the internal http
  // connection and never matches the browser's https Origin header.
  const trustedOrigin = authSettings("public").origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!trustedOrigin || origin !== trustedOrigin || (fetchSite !== null && fetchSite !== "same-origin")) {
    return NextResponse.json({ error: "Same-origin requests only." }, { status: 403, headers });
  }
  if (!isSupportConfigured()) {
    return NextResponse.json({ error: "Support payments are not configured yet." }, { status: 503, headers });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid amount." }, { status: 400, headers });
  try {
    const url = await createSupportCheckoutSession(parsed.data.amount, trustedOrigin);
    return NextResponse.json({ url }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start checkout." }, { status: 400, headers });
  }
}

