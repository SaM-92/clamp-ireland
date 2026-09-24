import { NextResponse } from "next/server";
import { IRELAND_BOUNDS } from "@/modules/map/lib/searchPlaces";
import { reverseGeocodeResilient } from "@/modules/map/lib/geocodeProviders";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < IRELAND_BOUNDS[1] || lat > IRELAND_BOUNDS[3] || lng < IRELAND_BOUNDS[0] || lng > IRELAND_BOUNDS[2]) {
    return NextResponse.json({ error: "Coordinates are out of range." }, { status: 400 });
  }
  // Round to ~11 m so nearby lookups for the same reported spot share one cache entry.
  const roundedLat = Math.round(lat * 10_000) / 10_000;
  const roundedLng = Math.round(lng * 10_000) / 10_000;
  const result = await reverseGeocodeResilient(roundedLat, roundedLng);
  // Fails soft (never throws): callers fall back to showing coordinates. Only
  // cache a resolved name - an unresolved miss must not be cached, otherwise a
  // transient provider outage would keep serving "unknown" for a month.
  const headers = result.name
    ? { "Cache-Control": "public, max-age=3600, s-maxage=2592000" }
    : { "Cache-Control": "no-store" };
  return NextResponse.json(result, { headers });
}
