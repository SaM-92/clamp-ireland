"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "@/modules/auth/lib/supabaseAuth";
import type { PendingReport } from "../types";

type Decision = { action: "reject" } | { action: "approve"; description: string; reviewed: true };

function ReviewCard({ report, onDecision }: { report: PendingReport; onDecision: (id: string, decision: Decision) => Promise<void> }) {
  const [description, setDescription] = useState(report.description);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(action: Decision) {
    setBusy(true);
    setError(null);
    try { await onDecision(report.id, action); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save review."); }
    finally { setBusy(false); }
  }
  return (
    <li className="review-card">
      <p>{report.reporterType} · {new Date(report.createdAt).toLocaleString()}</p>
      <label className="field">Public note after review
        <textarea rows={4} value={description} maxLength={2000} onChange={(event) => { setDescription(event.target.value); setReviewed(false); }} />
        <span className="field-hint">Remove names, identifying details and accusations. Preserve the factual experience; reject if it cannot be published safely.</span>
      </label>
      {report.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- private moderator evidence preview
        <img src={report.imageUrl} alt="Private evidence awaiting review" className="max-h-64 rounded" />
      )}
      <label className="review-confirmation"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        I reviewed the note and any photo for identifying details. The content is suitable for publication.
      </label>
      <p className="field-hint">No image-blurring tool is implemented yet. Reject photos that need redaction rather than approving them unchanged.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="button-row">
        <button className="button button-primary" disabled={busy || !reviewed || !description.trim()}
          onClick={() => decide({ action: "approve", description, reviewed: true })}>Approve &amp; publish</button>
        <button className="button button-surface" disabled={busy} onClick={() => decide({ action: "reject" })}>Reject</button>
      </div>
    </li>
  );
}

export function ModerationQueue() {
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Sign in as an admin to view the moderation queue.");
        const response = await fetch("/api/moderation/reports", { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error("Could not load the queue. Check your admin access and connection.");
        const reports = await response.json();
        if (!cancelled) setReports(reports);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the queue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [version]);

  async function act(id: string, decision: Decision) {
    const token = await getAccessToken();
    if (!token) throw new Error("Your session ended. Sign in again.");
    const response = await fetch(`/api/moderation/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(decision),
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error ?? "Could not save moderation decision.");
    }
    setVersion((value) => value + 1);
  }
  if (loading) return <p role="status">Loading moderation queue...</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (reports.length === 0) return <p>No reports waiting for review.</p>;
  return <ul className="review-list">{reports.map((report) => <ReviewCard key={report.id} report={report} onDecision={act} />)}</ul>;
}
