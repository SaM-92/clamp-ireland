import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupportCheckoutSession, isSupportConfigured } from "@/modules/donations/server/checkout";
import { NOINDEX_HEADER } from "@/modules/seo/policy";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": NOINDEX_HEADER };
const bodySchema = z.object({ amount: z.number() });

export async function POST(request: Request) {
  // Same-origin only: this endpoint needs no sign-in (anyone can support the
  // project), so cross-site abuse is stopped by origin checks instead of a
  // session cookie - matching the traffic-analytics endpoint's guard.
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== new URL(request.url).origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    return NextResponse.json({ error: "Same-origin requests only." }, { status: 403, headers });
  }
  if (!isSupportConfigured()) {
    return NextResponse.json({ error: "Support payments are not configured yet." }, { status: 503, headers });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid amount." }, { status: 400, headers });
  try {
    const url = await createSupportCheckoutSession(parsed.data.amount, new URL(request.url).origin);
    return NextResponse.json({ url }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start checkout." }, { status: 400, headers });
  }
}
