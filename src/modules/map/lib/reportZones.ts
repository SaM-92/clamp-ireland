import type { FeatureCollection, Polygon } from "geojson";
import type { LocationSummary } from "@/modules/locations/types";

export const ZONE_RADIUS_METRES = 100;
export const ZONE_OPACITY = 0.5;
const EARTH_RADIUS_METRES = 6_371_008.8;

export function createReportZones(locations: LocationSummary[]): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: locations.filter((location) => location.reportCount > 0).map((location) => {
      const lat = location.lat * Math.PI / 180;
      const lng = location.lng * Math.PI / 180;
      const distance = ZONE_RADIUS_METRES / EARTH_RADIUS_METRES;
      const ring: number[][] = [];
      for (let index = 0; index < 64; index++) {
        const bearing = index * 2 * Math.PI / 64;
        const latitude = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
        const longitude = lng + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat),
          Math.cos(distance) - Math.sin(lat) * Math.sin(latitude));
        ring.push([longitude * 180 / Math.PI, latitude * 180 / Math.PI]);
      }
      ring.push([...ring[0]]);
      return {
        type: "Feature",
        properties: { locationId: location.id, riskLevel: location.riskLevel, reportCount: location.reportCount },
        geometry: { type: "Polygon", coordinates: [ring] },
      };
    }),
  };
}
