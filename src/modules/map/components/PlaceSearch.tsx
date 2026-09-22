"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/lib/components/Icon";
import type { PlaceResult } from "../lib/searchPlaces";

export function PlaceSearch({ onSelect }: { onSelect: (place: PlaceResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function search(event: FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(`/api/places?q=${encodeURIComponent(query.trim())}`, { signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Place search failed.");
      if (!request.signal.aborted) setResults(body);
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Place search failed.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  function dismiss() {
    controller.current?.abort();
    setBusy(false);
    setResults(null);
    setError(null);
    input.current?.focus();
  }

  return (
    <div className="place-search" onKeyDown={(event) => { if (event.key === "Escape") dismiss(); }}>
      <form onSubmit={search} className="search-form" role="search">
        <Icon name="search" />
        <input ref={input} type="search" required minLength={3} maxLength={120}
          aria-label="Search towns or streets in Ireland" placeholder="Town or street..."
          value={query} onChange={(event) => {
            controller.current?.abort(); setBusy(false); setQuery(event.target.value); setResults(null); setError(null);
          }} />
        <button className="button button-primary" disabled={busy} type="submit">{busy ? "Searching..." : "Search"}</button>
      </form>
      {(results !== null || error) && (
        <div className="search-results">
          <div className="search-results-heading">
            <span>{error ? "Search unavailable" : `${results?.length ?? 0} results in Ireland`}</span>
            <button className="icon-button" aria-label="Close search results" onClick={dismiss}><Icon name="close" /></button>
          </div>
          {error ? <p className="error-text" role="alert">{error}</p> : results?.length === 0 ?
            <p role="status">No matches. Try adding the town or county, for example &quot;Main Street, Naas&quot;.</p> :
            <ul aria-label="Place search results">{results?.map((place) => (
              <li key={place.id}><button onClick={() => { onSelect(place); setQuery(place.name); dismiss(); }}>
                <Icon name="pin" /><span><strong>{place.name}</strong><small>{place.address}</small></span><Icon name="arrow" />
              </button></li>
            ))}</ul>}
          <small className="search-credit">Search by Photon / OpenStreetMap. Searches are sent only when you press Search.</small>
        </div>
      )}
    </div>
  );
}
