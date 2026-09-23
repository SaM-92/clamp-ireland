"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { formatDate } from "@/lib/dateFormat";
import { publicSummaryResponseSchema, type PublicSummaryResponse } from "../types";
import styles from "./AreaSummaries.module.css";

export function NearbySummary({ locationId, preview }: { locationId: string; preview: boolean }) {
  const [result, setResult] = useState<PublicSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const real = !preview && z.uuid().safeParse(locationId).success;
  useEffect(() => {
    if (!real) return;
    let disposed = false;
    let serial = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      const current = ++serial;
      controller?.abort(); clearTimeout(timer);
      setResult(null); setError(null);
      if (document.visibilityState === "hidden") { setLoading(false); return; }
      const request = new AbortController();
      controller = request;
      timer = setTimeout(() => request.abort(), 10_000);
      setLoading(true);
      try {
        const response = await fetch(`/api/locations/${locationId}/summary`, { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("Could not check the current nearby summary. Retry to check again.");
        const parsed = publicSummaryResponseSchema.parse(await response.json());
        if (!disposed && current === serial) setResult(parsed);
      } catch {
        if (!disposed && current === serial) {
          setResult(null);
          setError(request.signal.aborted ? "Nearby summary check timed out. Retry to check again."
            : "Could not check the current nearby summary. Retry to check again.");
        }
      } finally {
        if (!disposed && current === serial) { clearTimeout(timer); setLoading(false); }
      }
    }
    const refresh = () => { void load(); };
    refresh();
    const interval = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("area-summary-changed", refresh);
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("clamp-area-summaries") : null;
    if (channel) channel.onmessage = refresh;
    return () => {
      disposed = true; serial++; controller?.abort(); clearTimeout(timer); clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("area-summary-changed", refresh);
      channel?.close();
    };
  }, [locationId, real, revision]);

  return <section className={styles.nearby} aria-label="Nearby reports summary">
    <h3>Nearby summary</h3>
    {!real ? <p>Real area summaries require a configured backend. Browser-local preview notes never trigger generation.</p>
      : loading ? <p role="status">Checking the current reviewed summary...</p>
      : error ? <div role="alert"><p>{error}</p><button className="text-button" onClick={() => setRevision((value) => value + 1)}>Retry summary</button></div>
      : result?.state === "available" ? <>
        <p>{result.summary.sentence}</p>
        <p className="field-hint">{result.summary.sourceCount} notes · reviewed {formatDate(result.summary.reviewedAt)}</p>
      </> : <p>{result ? result.message : "No current reviewed summary to display."}</p>}
    <p className="field-hint">AI-assisted wording, human-reviewed before publishing.</p>
  </section>;
}
