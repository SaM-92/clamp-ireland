"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createBrowserClient } from "@/lib/supabase/client";
import { getAccessToken } from "@/modules/auth/lib/supabaseAuth";
import { pendingReportsSchema, type PendingReport } from "../types";
import styles from "./ModerationQueue.module.css";

type Decision = { action: "reject" } | { action: "approve"; description: string; reviewed: true };

function ReviewCard({ report, onDecision }: { report: PendingReport; onDecision: (id: string, decision: Decision) => Promise<void> }) {
  const [description, setDescription] = useState(report.description);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const evidenceRequired = report.hasImage || Boolean(report.imageUrl);
  const evidenceReady = !report.imageError && (!evidenceRequired || (Boolean(report.imageUrl) && imageState === "loaded"));
  const imageError = report.imageError || (evidenceRequired && !report.imageUrl
    ? "Private photo URL is missing. Reload the queue to retry; approval is blocked."
    : imageState === "error" ? "Private photo failed to load or expired. Reload the queue to get a new link; approval is blocked." : null);
  useEffect(() => {
    if (!report.imageUrl || imageState !== "loading") return;
    const timer = window.setTimeout(() => setImageState("error"), 15_000);
    return () => window.clearTimeout(timer);
  }, [report.imageUrl, imageState]);
  async function decide(action: Decision) {
    setBusy(true);
    setError(null);
    try { await onDecision(report.id, action); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save review."); }
    finally { setBusy(false); }
  }
  return (
    <li className={styles.card}>
      <p>{report.reporterType} · {new Date(report.createdAt).toLocaleString()}</p>
      <label className="field">Public note after review
        <textarea rows={4} value={description} maxLength={2000} disabled={busy} onChange={(event) => { setDescription(event.target.value); setReviewed(false); }} />
        <span className="field-hint">Remove names, identifying details and accusations. Preserve the factual experience; reject if it cannot be published safely.</span>
      </label>
      {report.imageUrl && <figure className={styles.evidence}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private signed evidence must not pass through a public image optimizer */}
        <img src={report.imageUrl} alt="Private evidence awaiting review" referrerPolicy="no-referrer"
          onLoad={() => setImageState("loaded")} onError={() => { setImageState("error"); setReviewed(false); }} />
        <figcaption>
          <a className="text-button" href={report.imageUrl} target="_blank" rel="noopener noreferrer">Open private photo full size (new tab)</a>
          <p className="field-hint">Private link expires after 10 minutes. Do not share it.</p>
        </figcaption>
      </figure>}
      {imageError && <p className="form-error" role="alert">{imageError}</p>}
      {evidenceRequired && report.imageUrl && imageState === "loading" && !imageError && <p role="status">Loading private photo before review...</p>}
      {!evidenceRequired && <p className="field-hint">No photo attached.</p>}
      <label className={styles.confirmation}><input type="checkbox" checked={reviewed} disabled={busy || !evidenceReady} onChange={(event) => setReviewed(event.target.checked)} />
        I reviewed the note and any photo for identifying details. The content is suitable for publication.
      </label>
      <p className="field-hint">No image-blurring tool is implemented yet. Reject photos that need redaction rather than approving them unchanged.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.actions}>
        <button className="button button-primary" disabled={busy || !reviewed || !description.trim() || !evidenceReady}
          onClick={() => decide({ action: "approve", description, reviewed: true })}>Approve &amp; publish</button>
        <button className="button button-surface" disabled={busy} onClick={() => decide({ action: "reject" })}>Reject</button>
      </div>
    </li>
  );
}

export function ModerationQueue({ onDecisionSaved }: { onDecisionSaved?: () => void } = {}) {
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const { data } = createBrowserClient().auth.onAuthStateChange(() => {
      setReports([]);
      setMessage(null);
      setVersion((value) => value + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      try {
        const token = await getAccessToken();
        const response = await fetch("/api/moderation/reports", {
          headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store",
        });
        if (response.status === 401 || response.status === 403) {
          if (!cancelled) setAccessDenied(true);
          throw new Error("Sign in as an admin to view the moderation queue.");
        }
        if (!response.ok) throw new Error("Could not load the queue. Check your admin access and connection.");
        const reports = pendingReportsSchema.parse(await response.json());
        if (!cancelled) setReports(reports);
      } catch (cause) {
        if (!cancelled) {
          setReports([]);
          setError(cause instanceof Error ? cause.message : "Could not load the queue.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [version]);

  async function act(id: string, decision: Decision) {
    const token = await getAccessToken();
    const response = await fetch(`/api/moderation/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(decision),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setReports([]);
        setAccessDenied(true);
        setError("Your administrator session ended or access was revoked. Sign in again.");
        throw new Error("Administrator access required.");
      }
      throw new Error("Could not save moderation decision. Reload the queue before trying again.");
    }
    setReports((current) => current.filter((report) => report.id !== id));
    setMessage(decision.action === "approve" ? "Report approved and published." : "Report rejected.");
    onDecisionSaved?.();
  }
  return <div className={styles.queue}>
    <div className={styles.actions}>
      <button className="button button-surface" disabled={loading} onClick={() => { setMessage(null); setVersion((value) => value + 1); }}>Reload queue</button>
      <p className="field-hint">Reloading discards unsaved edits and refreshes private photo links.</p>
    </div>
    {message && <p role="status">{message}</p>}
    {loading ? <p role="status">Loading moderation queue...</p> : error ? <>
      <p className="form-error" role="alert">{error}</p>
      {accessDenied && <Link className="text-button" href="/auth/sign-in">Sign in as an administrator</Link>}
    </> : reports.length === 0 ? <p>No reports waiting for review.</p> :
      <ul className={styles.list}>{reports.map((report) => <ReviewCard key={`${report.id}:${report.imageUrl}:${report.imageError}`} report={report} onDecision={act} />)}</ul>}
  </div>;
}
