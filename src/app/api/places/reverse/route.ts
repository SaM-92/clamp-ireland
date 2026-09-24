import { NextResponse } from "next/server";
import { IRELAND_BOUNDS, parsePlaces } from "@/modules/map/lib/searchPlaces";

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
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lon", String(roundedLng));
  url.searchParams.set("lat", String(roundedLat));
  url.searchParams.set("lang", "en");
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      // Street layout barely changes; cache generously to keep third-party calls low.
      next: { revalidate: 2_592_000 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const [place] = parsePlaces(await response.json());
    return NextResponse.json(
      { name: place?.name ?? null, address: place?.address ?? null },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=2592000" } },
    );
  } catch (error) {
    console.error("[ReverseGeocode] provider failed", error instanceof Error ? error.message : error);
    // Fail soft: callers fall back to showing coordinates, not an error state.
    return NextResponse.json({ name: null, address: null });
  }
}
