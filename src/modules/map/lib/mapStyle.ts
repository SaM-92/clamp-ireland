import { env } from "@/lib/env";

export const MAP_STYLE_URL = env.NEXT_PUBLIC_MAP_TILE_STYLE_URL;

/**
 * Default view: Dublin city centre at a street-level zoom, so individual
 * streets are visible on first load (the whole-of-Ireland view only shows
 * terrain/landcover fill until you zoom in — not useful for "is this
 * specific spot risky?"). Users can pan/zoom anywhere in Ireland, or use
 * the geolocate control to jump to their own location.
 */
export const IRELAND_CENTER: [number, number] = [-6.2603, 53.3498];
export const IRELAND_DEFAULT_ZOOM = 14;
