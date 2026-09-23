"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/dateFormat";
import { publishedReportsSchema, type PublishedReport } from "../types";
import styles from "./ModerationQueue.module.css";

function PublishedCard({ report, onRemove }: { report: PublishedReport; onRemove: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  async function remove() {
    setBusy(true);
    setError(null);
    try { await onRemove(report.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove report."); }
    finally { setBusy(false); }
  }
  return (
    <li className={styles.card}>
      <p>
        {report.reporterType}
        {report.isAnonymous ? " · anonymous" : " · verified"}
        {report.autoPublished ? " · auto-published" : ""} · published {formatDateTime(report.reviewedAt)}
        {report.hasImage ? " · has photo" : ""}
      </p>
      <p>{report.description}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.actions}>
        {confirming ? <>
          <span className="field-hint">Remove this live report from the map? It stays in the database for audit.</span>
          <button className="button button-primary" disabled={busy} onClick={remove}>Confirm remove</button>
          <button className="button button-surface" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </> : (
          <button className="button button-surface" disabled={busy} onClick={() => setConfirming(true)}>Remove from map</button>
        )}
      </div>
    </li>
  );
}

export function PublishedReports() {
  const [reports, setReports] = useState<PublishedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      try {
        const response = await fetch("/api/moderation/published", { credentials: "same-origin", cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          if (!cancelled) setAccessDenied(true);
          throw new Error("Sign in as an admin to view published reports.");
        }
        if (!response.ok) throw new Error("Could not load published reports. Check your admin access and connection.");
        const reports = publishedReportsSchema.parse(await response.json());
        if (!cancelled) setReports(reports);
      } catch (cause) {
        if (!cancelled) {
          setReports([]);
          setError(cause instanceof Error ? cause.message : "Could not load published reports.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [version]);

  async function remove(id: string) {
    const response = await fetch(`/api/moderation/published/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setReports([]);
        setAccessDenied(true);
        setError("Your administrator session ended or access was revoked. Sign in again.");
        throw new Error("Administrator access required.");
      }
      throw new Error("Could not remove the report. Reload the list before trying again.");
    }
    setReports((current) => current.filter((report) => report.id !== id));
    setMessage("Report removed from the map.");
  }
  return <div className={styles.queue}>
    <div className={styles.actions}>
      <button className="button button-surface" disabled={loading} onClick={() => { setMessage(null); setVersion((value) => value + 1); }}>Reload list</button>
    </div>
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading published reports...</p> : error ? <>
      <p className="form-error" role="alert">{error}</p>
      {accessDenied && <Link className="text-button" href="/auth/sign-in">Sign in as an administrator</Link>}
    </> : reports.length === 0 ? <p>No published reports yet.</p> :
      <ul className={styles.list}>{reports.map((report) => <PublishedCard key={report.id} report={report} onRemove={remove} />)}</ul>}
  </div>;
}
