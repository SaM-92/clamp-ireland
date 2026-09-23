"use client";

import { useEffect, useState } from "react";
import { trafficSummarySchema, type TrafficSummary } from "@/modules/analytics/types";
import styles from "./TrafficPanel.module.css";

export function TrafficPanel() {
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setSummary(null);
      setError(null);
      try {
        const response = await fetch("/api/admin/traffic", {
          credentials: "same-origin",
          cache: "no-store", signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) throw new Error("Administrator access is required to read traffic totals. Sign in again.");
        if (!response.ok) throw new Error("Could not load traffic totals. Check the analytics migration and server configuration, then retry.");
        const data = trafficSummarySchema.parse(await response.json());
        if (!controller.signal.aborted) setSummary(data);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load traffic totals.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [version]);
  const disabled = summary?.enabled === false;
  return (
    <section className={styles.panel} aria-labelledby="traffic-heading">
      <div className={styles.heading}>
        <h2 id="traffic-heading">Pageviews (approximate)</h2>
        <button className="button button-surface" disabled={loading} onClick={() => setVersion((value) => value + 1)}>Refresh traffic</button>
      </div>
      {loading && <p role="status">Loading traffic totals...</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {disabled && <>
        <p><strong>Analytics not enabled</strong></p>
        <p className={styles.hint}>Traffic collection is off in local development and preview deployments. To opt in on production, configure Azure SQL and enable the server-side analytics flag.</p>
      </>}
      {summary?.enabled && <>
        <p className={styles.hint}>{summary.from} to {summary.through}, UTC. Map and appeal pages only.</p>
        <dl className={styles.totals}>
          <div><dt>Pageviews (approximate)</dt><dd>{summary.totalPageviews}</dd></div>
          <div><dt>Mobile-sized pageviews</dt><dd>{summary.mobilePageviews}</dd></div>
        </dl>
        {summary.days.length === 0 ? <p>No pageviews recorded in this 30-day window.</p> :
          <div className={styles.tableRegion} tabIndex={0} role="region" aria-label="Daily traffic table">
            <table className={styles.table}>
              <caption>Recorded days only. These are views, not unique people or devices.</caption>
              <thead><tr><th scope="col">Day (UTC)</th><th scope="col">Pageviews</th><th scope="col">Mobile-sized</th></tr></thead>
              <tbody>{summary.days.map((day) => <tr key={day.day}><th scope="row">{day.day}</th><td>{day.pageviews}</td><td>{day.mobilePageviews}</td></tr>)}</tbody>
            </table>
          </div>}
      </>}
      <p className={styles.hint}>Reloads and bots can inflate counts; JavaScript blockers can undercount. Viewport classes are not device identities. These totals are not billing-grade.</p>
      <p className={styles.hint}>Optional and off by default. The owner must review privacy notices, consent requirements and host logging before enabling. Cookie-free is not a compliance guarantee.</p>
    </section>
  );
}
