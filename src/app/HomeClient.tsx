"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/components/Icon";
import { MapView } from "@/modules/map/components/MapView";
import { CITIES, type MapFocus } from "@/modules/map/lib/mapStyle";
import { ReportDialog, type ReportFormValues } from "@/modules/reports/components/ReportForm";
import { TransparencySignal } from "@/modules/dashboard/components/TransparencySignal";
import { fetchLocations, ensureLocation } from "@/modules/locations/api";
import { submitReport } from "@/modules/reports/api";
import { getAccessToken } from "@/modules/auth/lib/supabaseAuth";
import { getPreviewNotes, loadPreviewReports, savePreviewReports, summarizePreviewReports, type PreviewReport } from "@/modules/reports/lib/previewReports";
import type { LocationSummary } from "@/modules/locations/types";
import type { TransparencyStats } from "@/modules/dashboard/types";
import { PlaceSearch } from "@/modules/map/components/PlaceSearch";
import { LocationNotes } from "@/modules/reports/components/LocationNotes";
import { clearPreviewVotes } from "@/modules/votes/preview";
import { validateContent } from "@/modules/content-policy/policy";

export function HomeClient({ initialStats, preview, aiDemo = false }: { initialStats: TransparencyStats; preview: boolean; aiDemo?: boolean }) {
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [stats, setStats] = useState(initialStats);
  const [previewReports, setPreviewReports] = useState<PreviewReport[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus>(CITIES[0]);
  const [city, setCity] = useState("Dublin");
  const [selecting, setSelecting] = useState(false);
  const [pendingPin, setPendingPin] = useState<MapFocus | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<LocationSummary | null>(null);
  const [showZones, setShowZones] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (preview) {
          const reports = loadPreviewReports();
          if (active) setPreviewReports(reports);
        } else {
          const items = await fetchLocations();
          if (active) setLocations(items);
        }
      } catch (cause) {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Could not load reports.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void load();
    return () => { active = false; };
  }, [preview]);

  const previewSummary = useMemo(
    () => preview ? summarizePreviewReports(previewReports) : null,
    [preview, previewReports],
  );
  const visibleLocations = previewSummary?.locations ?? locations;
  const visibleStats = previewSummary?.stats ?? stats;

  function startReport() {
    setMessage(null);
    setSelecting(true);
    const panel = mapPanelRef.current;
    const bounds = panel?.getBoundingClientRect();
    if (bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
      panel?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    }
  }

  function handleMapClick(lat: number, lng: number) {
    setMessage(null);
    setPendingPin({ lat, lng });
    setSelecting(false);
  }

  function resetPreview() {
    try {
      clearPreviewVotes();
      savePreviewReports([]);
      setPreviewReports([]);
      setSelectedLocation(null);
      setLoadError(null);
      setMessage("Local preview cleared.");
    } catch {
      setMessage("Could not completely clear preview storage. Check your browser storage permissions.");
    }
  }

  async function handleReportSubmit(values: ReportFormValues) {
    if (!pendingPin) throw new Error("Choose a location on the map first.");
    if (preview) {
      if (!loaded || loadError) throw new Error("Reset preview before adding reports; saved data could not be loaded.");
      const description = validateContent("report_note", values.description);
      const report: PreviewReport = {
        id: crypto.randomUUID(), ...pendingPin, reporterType: values.reporterType,
        hasImage: Boolean(values.image), createdAt: new Date().toISOString(),
        description, incidentDate: values.incidentDate || null,
      };
      const next = [...previewReports, report];
      savePreviewReports(next);
      setPreviewReports(next);
      setPendingPin(null);
      setMessage("Preview report saved on this browser only, with simulated approval. Notes stay local; photos are not stored or uploaded.");
      return;
    }
    const accessToken = await getAccessToken();
    if (!accessToken) throw new Error("Sign in to publish a report. Browsing the map is always free and open.");
    const location = await ensureLocation(pendingPin.lat, pendingPin.lng, accessToken);
    const report = await submitReport({ locationId: location.id, accessToken, ...values });
    setPendingPin(null);
    setMessage(report.moderation_status === "pending"
      ? "Thank you. Your note and any photo are private until a human moderator approves them."
      : "Thank you. Your report has been added to the community map.");
    try {
      const [items, response] = await Promise.all([fetchLocations(), fetch("/api/dashboard/stats")]);
      if (!response.ok) throw new Error("Could not refresh counts.");
      setLocations(items);
      setStats(await response.json());
    } catch {
      setMessage("Your report was saved, but the map counts could not refresh. Reload to see the latest data.");
    }
  }

  return (
    <main id="main-content" className="home-shell">
      <section className="page-intro" aria-labelledby="page-title">
        <div>
          <p className="eyebrow"><span className="community-dot" /> Ireland, community-powered</p>
          <h1 id="page-title">Park with a little <span>local knowledge.</span></h1>
          <p className="intro-description">See where clamping has been reported. Share what happened. Help the next person park informed.</p>
        </div>
        <button className="button button-primary intro-action" onClick={startReport}>
          <Icon name="plus" /> Add a report
        </button>
      </section>

      {preview && (
        <div className="preview-banner">
          <span><strong>Local preview</strong> No sign-in needed. Test reports stay in this browser, not on the public map.</span>
          <div className="preview-actions">
            {aiDemo && <a className="text-button" href="/dev/ai-demo">Try the AI demo</a>}
            <button className="text-button" onClick={resetPreview}>Reset preview</button>
          </div>
        </div>
      )}
      <TransparencySignal stats={visibleStats} />
      {message && <p className="notice" role="status"><Icon name="info" />{message}</p>}

      <PlaceSearch onSelect={(place) => { setFocus(place); setCity(""); }} />
      <section className="map-workspace" aria-label="Community reporting map">
        <aside className="map-sidebar">
          <div className="sidebar-heading">
            <span className="eyebrow">The community signal</span>
            <h2>Reported locations <span className="count-badge">{visibleLocations.length}</span></h2>
            <p>Real experiences. A clearer picture.</p>
          </div>
          <div className="location-list">
            {!loaded ? <p className="sidebar-message" role="status">Loading reports...</p>
              : loadError ? <p className="sidebar-message error-text" role="alert">{loadError}</p>
              : visibleLocations.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon"><Icon name="map" width="30" height="30" /></span>
                  <h3>A new map starts with you.</h3>
                  <p>{preview ? "Try adding a report to see a pin and the community signal in action." : "No community reports yet. Share an experience to help build the picture."}</p>
                  <button className="text-button" onClick={startReport}>Add the first report <Icon name="arrow" /></button>
                </div>
              ) : visibleLocations.map((location) => (
                <button key={location.id} className="location-card"
                  onClick={() => { setFocus({ lat: location.lat, lng: location.lng, zoom: 16 }); setCity(""); setSelectedLocation(location); }}>
                  <span className={`risk-symbol risk-${location.riskLevel}`}><Icon name="pin" /></span>
                  <span className="location-card-copy">
                    <strong>{preview ? "Preview location" : "Community-reported location"}</strong>
                    <span>{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</span>
                    <small>{location.reportCount} report{location.reportCount === 1 ? "" : "s"} · {location.riskLevel} signal</small>
                  </span>
                  <Icon name="arrow" />
                </button>
              ))}
          </div>
          <div className="signal-guide">
            <h3>Reading the map</h3>
            <div className="map-legend">
              <span><i className="legend-dot risk-low" />Low</span>
              <span><i className="legend-dot risk-medium" />Medium</span>
              <span><i className="legend-dot risk-high" />High</span>
            </div>
            <p>100 m circles at 50% opacity show the signal around reported spots. More or stronger recent reports can turn an area amber or red. No reports doesn&apos;t mean no risk.</p>
          </div>
        </aside>
        <div className="map-panel" ref={mapPanelRef}>
          <div className="map-toolbar">
            <label className="city-picker"><Icon name="pin" /><span className="sr-only">Jump to city</span>
              <select value={city} onChange={(event) => {
                const next = CITIES.find((item) => item.name === event.target.value);
                if (next) { setCity(next.name); setFocus({ lat: next.lat, lng: next.lng }); }
              }}>
                {city === "" && <option value="">Selected location</option>}
                {CITIES.map((item) => <option key={item.name}>{item.name}</option>)}
              </select>
            </label>
            <label className="zones-toggle"><input type="checkbox" checked={showZones} onChange={(event) => setShowZones(event.target.checked)} /> Show zones</label>
          </div>
          <MapView locations={visibleLocations} focus={focus} selecting={selecting} preview={preview}
            onMapClick={handleMapClick} onCancelSelection={() => setSelecting(false)}
            showZones={showZones} onLocationSelect={setSelectedLocation} />
          <div className="map-caption"><Icon name="info" /> Tap a pin or coloured zone to read notes. Use Add a report to share an experience.</div>
        </div>
      </section>

      <section className="appeal-resource" aria-labelledby="appeal-resource-title">
        <div>
          <h2 id="appeal-resource-title">Been clamped? Know your appeal options.</h2>
          <p>Our community reports do not submit an appeal. See the official two-stage process for the Republic of Ireland and keep an eye on the deadlines.</p>
        </div>
        <a href="https://www.nationaltransport.ie/vehicle-clamping-regulation/" className="button button-surface">How to appeal <Icon name="arrow" /></a>
      </section>

      <section id="how-it-works" className="how-it-works" aria-label="How it works">
        <div><span className="step-number">01</span><div><h2>Check the street</h2><p>Explore reports before you park. Always read the signs too.</p></div></div>
        <div><span className="step-number">02</span><div><h2>Share an experience</h2><p>Clamped here, live nearby, or witnessed it? Add a factual report.</p></div></div>
        <div><span className="step-number">03</span><div><h2>Look out for each other</h2><p>Location-only reporting. All notes and photos stay private until reviewed.</p></div></div>
      </section>
      {pendingPin && <ReportDialog location={pendingPin} preview={preview} onSubmit={handleReportSubmit} onCancel={() => setPendingPin(null)} />}
      {selectedLocation && <LocationNotes key={selectedLocation.id} location={selectedLocation}
        previewNotes={preview ? getPreviewNotes(previewReports, selectedLocation.id) : null}
        onClose={() => setSelectedLocation(null)}
        onReport={() => { setPendingPin({ lat: selectedLocation.lat, lng: selectedLocation.lng }); setSelectedLocation(null); }} />}
    </main>
  );
}
