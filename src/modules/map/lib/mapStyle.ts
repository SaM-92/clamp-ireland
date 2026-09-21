import { env } from "@/lib/env";

export const MAP_STYLE_URL = env.NEXT_PUBLIC_MAP_TILE_STYLE_URL;

/** Roughly the geographic centre of Ireland (Co. Roscommon). */
export const IRELAND_CENTER: [number, number] = [-8.2439, 53.4129];
export const IRELAND_DEFAULT_ZOOM = 6.3;
