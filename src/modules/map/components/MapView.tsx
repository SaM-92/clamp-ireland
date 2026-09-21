"use client";

import { useEffect, useRef } from "react";
import { GeolocateControl, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { IRELAND_CENTER, IRELAND_DEFAULT_ZOOM, MAP_STYLE_URL } from "../lib/mapStyle";
import type { LocationSummary } from "@/modules/locations/types";

const RISK_COLORS: Record<LocationSummary["riskLevel"], string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
};

interface MapViewProps {
  locations: LocationSummary[];
  onMapClick: (lat: number, lng: number) => void;
}

/**
 * Thin MapLibre GL wrapper — deliberately not using a React wrapper library
 * to keep dependencies minimal (see docs/01-architecture.md). Renders one
 * colour-coded marker per location, and reports clicks back to the parent
 * so it can open the report form at that spot.
 */
export function MapView({ locations, onMapClick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: IRELAND_CENTER,
      zoom: IRELAND_DEFAULT_ZOOM,
    });
    map.addControl(new NavigationControl(), "top-right");
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true,
      }),
      "top-right"
    );
    map.on("click", (event) => {
      onMapClickRef.current(event.lngLat.lat, event.lngLat.lng);
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = locations.map((location) =>
      new Marker({ color: RISK_COLORS[location.riskLevel] })
        .setLngLat([location.lng, location.lat])
        .setPopup(
          new Popup({ offset: 16 }).setHTML(
            `<strong>${location.reportCount} report(s)</strong><br/>Risk: ${location.riskLevel}`
          )
        )
        .addTo(map)
    );
  }, [locations]);

  return <div ref={containerRef} className="h-full w-full" />;
}
