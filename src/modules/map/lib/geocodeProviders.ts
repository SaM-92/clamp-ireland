import { z } from "zod";
import { IRELAND_BOUNDS, parsePlaces, type PlaceResult } from "./searchPlaces";

/** Nominatim's usage policy requires an app-identifying User-Agent (no default
 * library UA) and caps free use at ~1 req/s - it is only used as a last-resort
 * fallback here, never retried itself, so this app stays well under that. */
const NOMINATIM_USER_AGENT = "ClampTrackerIE/1.0 (community clamping reports; +https://clamptracker.ie)";
const [minLng, minLat, maxLng, maxLat] = IRELAND_BOUNDS;

async function fetchJson(url: URL, timeoutMs: number, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
  return response.json();
}

/** Most Photon 503s are momentary (shared free instance under load) - one
 * quick retry clears the large majority of them before falling back. */
async function withOneRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return attempt();
  }
}

const nominatimAddressSchema = z.object({
  road: z.string().optional(), pedestrian: z.string().optional(), footway: z.string().optional(),
  suburb: z.string().optional(), city: z.string().optional(), town: z.string().optional(), village: z.string().optional(),
  county: z.string().optional(), state: z.string().optional(), country_code: z.string().optional(),
});
const nominatimItemSchema = z.object({
  place_id: z.union([z.string(), z.number()]),
  osm_type: z.string().optional(), osm_id: z.union([z.string(), z.number()]).optional(),
  lat: z.string(), lon: z.string(), category: z.string().optional(), type: z.string().optional(),
  address: nominatimAddressSchema.optional(), display_name: z.string(),
});

function fromNominatimItem(item: z.infer<typeof nominatimItemSchema>): PlaceResult | null {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  const addr = item.address ?? {};
  const onIsland = addr.country_code?.toUpperCase() === "IE" || addr.country_code?.toUpperCase() === "GB";
  if (!onIsland || lng < minLng || lat < minLat || lng > maxLng || lat > maxLat) return null;
  const name = addr.road ?? addr.pedestrian ?? addr.footway ?? addr.suburb ?? addr.city ?? addr.town ?? addr.village
    ?? item.display_name.split(",")[0]?.trim();
  if (!name) return null;
  const parts = [addr.suburb, addr.city ?? addr.town ?? addr.village, addr.county, addr.state]
    .filter((part): part is string => Boolean(part) && part !== name);
  return {
    id: item.osm_type && item.osm_id ? `${item.osm_type[0]?.toUpperCase()}-${item.osm_id}` : `nominatim-${item.place_id}`,
    name, address: [...new Set(parts)].join(", "), lat, lng,
    zoom: item.type === "residential" || item.category === "highway" ? 16 : 14,
  };
}

async function searchPhoton(query: string): Promise<PlaceResult[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("bbox", IRELAND_BOUNDS.join(","));
  url.searchParams.set("lang", "en");
  url.searchParams.append("countrycode", "IE");
  url.searchParams.append("countrycode", "GB");
  return parsePlaces(await fetchJson(url, 8_000));
}

async function searchNominatim(query: string): Promise<PlaceResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "ie,gb");
  url.searchParams.set("viewbox", `${minLng},${maxLat},${maxLng},${minLat}`);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("accept-language", "en");
  const items = z.array(nominatimItemSchema).parse(await fetchJson(url, 8_000, { "User-Agent": NOMINATIM_USER_AGENT }));
  return items.map(fromNominatimItem).filter((place): place is PlaceResult => place !== null);
}

async function reversePhoton(lat: number, lng: number): Promise<PlaceResult | null> {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lang", "en");
  const [place] = parsePlaces(await fetchJson(url, 8_000));
  return place ?? null;
}

async function reverseNominatim(lat: number, lng: number): Promise<PlaceResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");
  url.searchParams.set("zoom", "17");
  const parsed = z.union([nominatimItemSchema, z.object({ error: z.string() }).loose()])
    .parse(await fetchJson(url, 8_000, { "User-Agent": NOMINATIM_USER_AGENT }));
  return "error" in parsed ? null : fromNominatimItem(parsed);
}

/** Search used when adding/finding a report location. Photon is tried first
 * (with one retry), then Nominatim as a fallback - only fails if both
 * providers are unavailable, so a Photon blip never blocks report submission. */
export async function searchPlacesResilient(query: string): Promise<PlaceResult[]> {
  try {
    return await withOneRetry(() => searchPhoton(query));
  } catch (photonError) {
    console.error("[PlaceSearch] Photon failed, trying Nominatim fallback", photonError instanceof Error ? photonError.message : photonError);
    return searchNominatim(query);
  }
}

/** Reverse lookup used for the display-only street-name label. Same
 * retry-then-fallback strategy, but fails soft (never throws) since callers
 * fall back to showing raw coordinates. */
export async function reverseGeocodeResilient(lat: number, lng: number): Promise<{ name: string | null; address: string | null }> {
  try {
    const place = await withOneRetry(() => reversePhoton(lat, lng));
    return { name: place?.name ?? null, address: place?.address ?? null };
  } catch (photonError) {
    console.error("[ReverseGeocode] Photon failed, trying Nominatim fallback", photonError instanceof Error ? photonError.message : photonError);
    try {
      const place = await reverseNominatim(lat, lng);
      return { name: place?.name ?? null, address: place?.address ?? null };
    } catch (nominatimError) {
      console.error("[ReverseGeocode] Nominatim fallback also failed", nominatimError instanceof Error ? nominatimError.message : nominatimError);
      return { name: null, address: null };
    }
  }
}
