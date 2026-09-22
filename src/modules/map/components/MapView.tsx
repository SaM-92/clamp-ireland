"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, GeolocateControl, GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Icon } from "@/lib/components/Icon";
import { IRELAND_CENTER, IRELAND_DEFAULT_ZOOM, MAP_STYLE_URL, type MapFocus } from "../lib/mapStyle";
import type { LocationSummary } from "@/modules/locations/types";
import { createReportZones, ZONE_OPACITY } from "../lib/reportZones";

interface MapViewProps {
  locations: LocationSummary[];
  focus: MapFocus;
  selecting: boolean;
  preview: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onCancelSelection: () => void;
  onLocationSelect: (location: LocationSummary) => void;
  showZones: boolean;
}

export function MapView({ locations, focus, selecting, preview, onMapClick, onCancelSelection, onLocationSelect, showZones }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const geolocateRef = useRef<GeolocateControl | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const onMapClickRef = useRef(onMapClick);
  const onLocationSelectRef = useRef(onLocationSelect);
  const locationsRef = useRef(locations);
  const selectingRef = useRef(selecting);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onLocationSelectRef.current = onLocationSelect; }, [onLocationSelect]);
  useEffect(() => { locationsRef.current = locations; }, [locations]);
  useEffect(() => { selectingRef.current = selecting; }, [selecting]);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function initialize() {
      try {
        const maplibre = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;
        // Next cannot preserve MapLibre 6's import.meta.url worker lookup.
        maplibre.setWorkerUrl(`/vendor/maplibre/${maplibre.getVersion()}/maplibre-gl-worker.mjs`);
        map = new maplibre.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: IRELAND_CENTER,
          zoom: IRELAND_DEFAULT_ZOOM,
          maxZoom: 19,
          cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.getCanvas().setAttribute("aria-label", "Street map. Use arrow keys to pan and plus or minus to zoom.");
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");
        const geolocate = new maplibre.GeolocateControl({
          positionOptions: { enableHighAccuracy: true, timeout: 10_000 },
          trackUserLocation: false,
          fitBoundsOptions: { maxZoom: 16 },
        });
        geolocateRef.current = geolocate;
        map.addControl(geolocate, "top-right");
        geolocate.on("error", () => setLocationError("Location unavailable. Allow browser location access, or choose a city."));
        geolocate.on("geolocate", () => setLocationError(null));
        map.on("click", (event) => {
          const target = event.originalEvent.target;
          if (target instanceof Element && target.closest(".report-marker, .maplibregl-popup")) return;
          if (!selectingRef.current && map?.getLayer("report-zones-fill")) {
            const zone = map.queryRenderedFeatures(event.point, { layers: ["report-zones-fill"] })[0];
            const location = locationsRef.current.find((item) => item.id === zone?.properties.locationId);
            if (location) { onLocationSelectRef.current(location); return; }
          }
          onMapClickRef.current(event.lngLat.lat, event.lngLat.lng);
        });
        map.on("error", (event) => {
          console.error("[MapView]", event.error);
          setError("Some map data could not load. Check your connection and retry.");
          setStatus("error");
        });
        map.once("load", () => {
          clearTimeout(timeout);
          if (!map) return;
          map.addSource("report-zones", { type: "geojson", data: createReportZones([]) });
          const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
          const color: ExpressionSpecification = ["match", ["get", "riskLevel"], "high", "#e24b4b", "medium", "#f4bc43", "#38a875"];
          map.addLayer({
            id: "report-zones-fill", type: "fill", source: "report-zones",
            paint: { "fill-color": color, "fill-opacity": ZONE_OPACITY },
          }, firstLabel);
          map.addLayer({
            id: "report-zones-outline", type: "line", source: "report-zones",
            paint: { "line-color": color, "line-width": 1.5 },
          }, firstLabel);
          setStatus("ready");
          setError(null);
        });
        timeout = setTimeout(() => {
          setStatus("error");
          setError("The street map is taking too long to load. Check your connection and retry.");
        }, 15_000);
        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(containerRef.current);
      } catch (cause) {
        console.error("[MapView] initialization failed", cause);
        if (!disposed) {
          setStatus("error");
          setError("The map could not start. Your browser needs WebGL enabled to display streets.");
        }
      }
    }
    void initialize();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      resizeObserver?.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
      geolocateRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (status !== "ready") return;
    mapRef.current?.flyTo({
      center: [focus.lng, focus.lat],
      zoom: focus.zoom ?? IRELAND_DEFAULT_ZOOM,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650,
    });
  }, [focus, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    map.getSource<GeoJSONSource>("report-zones")?.setData(createReportZones(locations));
    for (const layer of ["report-zones-fill", "report-zones-outline"]) {
      map.setLayoutProperty(layer, "visibility", showZones ? "visible" : "none");
    }
  }, [locations, status, showZones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    let cancelled = false;
    async function updateMarkers() {
      const { Marker, Popup } = await import("maplibre-gl");
      if (cancelled || !map) return;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = locations.map((location) => {
        const element = document.createElement("button");
        element.type = "button";
        element.className = `report-marker risk-${location.riskLevel}`;
        element.textContent = String(location.reportCount);
        element.setAttribute("aria-label", `${preview ? "Preview: " : ""}${location.reportCount} reports, ${location.riskLevel} signal`);
        // Avoid a second popup toggle from MapLibre's keypress handler on native buttons.
        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            element.click();
          }
        });
        const content = document.createElement("div");
        content.className = "map-popup";
        const title = document.createElement("strong");
        title.textContent = `${preview ? "Preview: " : ""}${location.reportCount} community report${location.reportCount === 1 ? "" : "s"}`;
        const detail = document.createElement("p");
        detail.textContent = `${location.riskLevel} signal · ${location.riskScore}/100`;
        const note = document.createElement("small");
        note.textContent = "A community signal, not a prediction or guarantee.";
        content.append(title, detail, note);
        const action = document.createElement("button");
        action.type = "button";
        action.className = "text-button";
        action.textContent = "View notes";
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          onLocationSelectRef.current(location);
        });
        content.append(action);
        const marker = new Marker({ element })
          .setLngLat([location.lng, location.lat])
          .setPopup(new Popup({ offset: 24 }).setDOMContent(content))
          .addTo(map);
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          marker.togglePopup();
        });
        return marker;
      });
    }
    void updateMarkers();
    return () => { cancelled = true; };
  }, [locations, status, preview]);

  function retry() {
    setError(null);
    setStatus("loading");
    setAttempt((value) => value + 1);
  }

  function reportAtCenter() {
    const center = mapRef.current?.getCenter();
    if (center) onMapClick(center.lat, center.lng);
  }

  return (
    <div className={`map-view ${selecting ? "is-selecting" : ""}`} data-map-state={status}>
      <div ref={containerRef} className="map-canvas" aria-busy={status === "loading"} />
      <div className="map-location-button">
        <button className="button button-surface" disabled={status !== "ready"}
          onClick={() => { setLocationError(null); geolocateRef.current?.trigger(); }}>
          <Icon name="locate" /> <span>My location</span>
        </button>
      </div>
      {status !== "ready" && (
        <div className="map-feedback" role={status === "error" ? "alert" : "status"}>
          <Icon name={status === "error" ? "info" : "map"} />
          <strong>{status === "loading" ? "Loading streets..." : "Map unavailable"}</strong>
          <p>{error ?? "Getting the street map ready for you."}</p>
          {status === "error" && <button className="button button-primary" onClick={retry}>Retry map</button>}
        </div>
      )}
      {locationError && <p className="map-location-error" role="alert">{locationError}</p>}
      {selecting && status === "ready" && (
        <>
          <span className="map-crosshair" aria-hidden="true"><Icon name="plus" width="28" height="28" /></span>
          <div className="map-selection">
            <span>Tap a street, or move the map under the cross.</span>
            <div className="button-row">
              <button className="button button-primary" onClick={reportAtCenter}>Use map centre</button>
              <button className="button button-surface" onClick={onCancelSelection}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
