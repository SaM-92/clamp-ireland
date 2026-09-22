import { z } from "zod";
import type { MapFocus } from "./mapStyle";

export interface PlaceResult extends MapFocus {
  id: string;
  name: string;
  address: string;
}

export const IRELAND_BOUNDS = [-10.8, 51.3, -5.3, 55.5] as const;
const photonSchema = z.object({
  features: z.array(z.object({
    geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }),
    properties: z.object({
      osm_type: z.string(), osm_id: z.union([z.string(), z.number()]),
      countrycode: z.string(), name: z.string().optional(),
      street: z.string().optional(), city: z.string().optional(),
      county: z.string().optional(), state: z.string().optional(),
      type: z.string().optional(),
    }),
  })),
});

export function parsePlaces(response: unknown): PlaceResult[] {
  const data = photonSchema.parse(response);
  return data.features.flatMap(({ geometry, properties: p }) => {
    const [lng, lat] = geometry.coordinates;
    const code = p.countrycode.toUpperCase();
    const onIsland = code === "IE" || (code === "GB" && /northern ireland/i.test(p.state ?? ""));
    if (!onIsland || lng < IRELAND_BOUNDS[0] || lat < IRELAND_BOUNDS[1] ||
      lng > IRELAND_BOUNDS[2] || lat > IRELAND_BOUNDS[3]) return [];
    const name = p.name ?? p.street ?? p.city;
    if (!name) return [];
    const parts = [p.street, p.city, p.county, p.state].filter((part): part is string => Boolean(part) && part !== name);
    return [{
      id: `${p.osm_type}-${p.osm_id}`, name, address: [...new Set(parts)].join(", "),
      lat, lng, zoom: p.type === "street" || p.type === "house" ? 16 : 14,
    }];
  });
}
