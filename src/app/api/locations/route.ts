import { NextResponse } from "next/server";
import { createAnonServerClient, createServiceRoleClient, getUserFromRequest } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { LocationSummary } from "@/modules/locations/types";

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json([]);

  const supabase = createAnonServerClient();
  const { data, error } = await supabase.from("locations_public").select("*");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const locations: LocationSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    reportCount: row.report_count,
  }));
  return NextResponse.json(locations);
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Sign in required to add a location." }, { status: 401 });
  }

  const body = await request.json();
  const { lat, lng } = body as { lat: unknown; lng: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "lat/lng must be numbers" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  // find_or_create_location (see supabase/migrations/0001_init.sql) dedupes
  // pins within ~30m so repeated reports at the same spot share one marker.
  const { data, error } = await supabase.rpc("find_or_create_location", {
    p_lat: lat,
    p_lng: lng,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const location = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    id: location.id,
    lat,
    lng,
    riskScore: location.risk_score,
    riskLevel: location.risk_level,
    reportCount: location.report_count,
  } satisfies LocationSummary);
}
