"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "@/lib/components/Icon";
import type { PlaceResult } from "../lib/searchPlaces";

// Suggestions refresh shortly after each keystroke, mirroring familiar map
// autocomplete (type "Cherry" and see "Cherrywood" appear) rather than
// requiring a full word and a manual Search click.
const TYPEAHEAD_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export function PlaceSearch({ onSelect }: { onSelect: (place: PlaceResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const controller = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { controller.current?.abort(); if (debounce.current) clearTimeout(debounce.current); }, []);

  async function runSearch(term: string) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/places?q=${encodeURIComponent(term)}`, { signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Place search failed.");
      if (!request.signal.aborted) { setResults(body); setHighlighted(-1); }
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Place search failed.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  function queueSearch(term: string) {
    if (debounce.current) clearTimeout(debounce.current);
    controller.current?.abort();
    if (term.length < MIN_QUERY_LENGTH) { setBusy(false); setResults(null); setError(null); return; }
    debounce.current = setTimeout(() => runSearch(term), TYPEAHEAD_DEBOUNCE_MS);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    if (debounce.current) clearTimeout(debounce.current);
    const term = query.trim();
    if (term.length < MIN_QUERY_LENGTH) return;
    void runSearch(term);
  }

  function dismiss() {
    if (debounce.current) clearTimeout(debounce.current);
    controller.current?.abort();
    setBusy(false);
    setResults(null);
    setError(null);
    setHighlighted(-1);
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") { dismiss(); return; }
    if (!results?.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      const place = results[highlighted];
      onSelect(place);
      setQuery(place.name);
      dismiss();
    }
  }

  return (
    <div className="place-search" onKeyDown={onKeyDown}>
      <form onSubmit={search} className="search-form" role="search">
        <Icon name="search" />
        <input ref={input} type="search" required minLength={MIN_QUERY_LENGTH} maxLength={120}
          aria-label="Search towns or streets in Ireland" placeholder="Town or street..."
          role="combobox" aria-expanded={results !== null} aria-controls="place-search-results" aria-autocomplete="list"
          value={query} onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setError(null);
            queueSearch(next.trim());
          }} />
        <button className="button button-primary" disabled={busy} type="submit">{busy ? "Searching..." : "Search"}</button>
      </form>
      {(results !== null || error || busy) && (
        <div className="search-results" id="place-search-results">
          <div className="search-results-heading">
            <span>{error ? "Search unavailable" : busy ? "Searching..." : `${results?.length ?? 0} results in Ireland`}</span>
            <button className="icon-button" aria-label="Close search results" onClick={dismiss}><Icon name="close" /></button>
          </div>
          {error ? <p className="error-text" role="alert">{error}</p> :
            results === null ? <p role="status" aria-live="polite">Looking for matches...</p> :
            results.length === 0 ?
            <p role="status">No matches. Try adding the town or county, for example &quot;Main Street, Naas&quot;.</p> :
            <ul aria-label="Place search results">{results.map((place, index) => (
              <li key={place.id}><button className={index === highlighted ? "is-highlighted" : undefined}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => { onSelect(place); setQuery(place.name); dismiss(); }}>
                <Icon name="pin" /><span><strong>{place.name}</strong><small>{place.address}</small></span><Icon name="arrow" />
              </button></li>
            ))}</ul>}
          <small className="search-credit">Search by Photon / OpenStreetMap.</small>
        </div>
      )}
    </div>
  );
}
