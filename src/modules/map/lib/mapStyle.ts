import { env } from "@/lib/env";

export const MAP_STYLE_URL = env.NEXT_PUBLIC_MAP_TILE_STYLE_URL;

/** Dublin street-level default; the map remains pannable across Ireland. */
export const IRELAND_CENTER: [number, number] = [-6.2603, 53.3498];
export const IRELAND_DEFAULT_ZOOM = 14;

export const CITIES = [
  { name: "Dublin", lat: 53.3498, lng: -6.2603 },
  { name: "Naas", lat: 53.2158, lng: -6.6669 },
  { name: "Cork", lat: 51.8985, lng: -8.4756 },
  { name: "Galway", lat: 53.2707, lng: -9.0568 },
  { name: "Limerick", lat: 52.6638, lng: -8.6267 },
  { name: "Waterford", lat: 52.2593, lng: -7.1101 },
  { name: "Belfast", lat: 54.5973, lng: -5.9301 },
  { name: "Derry", lat: 54.997, lng: -7.309 },
  { name: "Kilkenny", lat: 52.6541, lng: -7.2448 },
  { name: "Sligo", lat: 54.2766, lng: -8.4761 },
  { name: "Drogheda", lat: 53.7179, lng: -6.3561 },
  { name: "Dundalk", lat: 54.0037, lng: -6.4033 },
  { name: "Athlone", lat: 53.4239, lng: -7.9407 },
  { name: "Wexford", lat: 52.3369, lng: -6.4633 },
  { name: "Tralee", lat: 52.2713, lng: -9.7026 },
  { name: "Letterkenny", lat: 54.95, lng: -7.734 },
] as const;

export interface MapFocus {
  lat: number;
  lng: number;
  zoom?: number;
}
