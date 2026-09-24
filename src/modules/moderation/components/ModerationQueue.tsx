"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatDateTime } from "@/lib/dateFormat";
import { CONTENT_LIMITS } from "@/modules/content-policy/policy";
import { pendingReportsSchema, type PendingReport, type RedactionRegion } from "../types";
import styles from "./ModerationQueue.module.css";

type Decision = { action: "reject" } | { action: "approve"; description: string; reviewed: true; redactions?: RedactionRegion[] };
type DraftRegion = { x: number; y: number; width: number; height: number };

function ReviewCard({ report, onDecision }: { report: PendingReport; onDecision: (id: string, decision: Decision) => Promise<void> }) {
  const [description, setDescription] = useState(report.description);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const [regions, setRegions] = useState<RedactionRegion[]>([]);
  const [drawMode, setDrawMode] = useState<"blur" | "blackout">("blur");
  const [draft, setDraft] = useState<DraftRegion | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
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
  function fractionFromEvent(event: ReactPointerEvent): { x: number; y: number } {
    const rect = imgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy || !imgRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = fractionFromEvent(event);
    setDraft({ ...dragStart.current, width: 0, height: 0 });
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const point = fractionFromEvent(event);
    setDraft({
      x: Math.min(dragStart.current.x, point.x), y: Math.min(dragStart.current.y, point.y),
      width: Math.abs(point.x - dragStart.current.x), height: Math.abs(point.y - dragStart.current.y),
    });
  }
  function onPointerUp() {
    if (draft && draft.width > 0.015 && draft.height > 0.015) {
      setRegions((current) => [...current, { ...draft, mode: drawMode }]);
      setReviewed(false);
    }
    dragStart.current = null;
    setDraft(null);
  }
  function removeRegion(index: number) {
    setRegions((current) => current.filter((_, position) => position !== index));
    setReviewed(false);
  }
  return (
    <li className={styles.card}>
      <p>{report.reporterType}{report.isAnonymous ? " · anonymous" : ""}{report.isFlagged ? " · AI-flagged for review" : ""} · {formatDateTime(report.createdAt)}</p>
      <label className="field">Public note after review
        <textarea rows={4} value={description} maxLength={CONTENT_LIMITS.report_note} disabled={busy} onChange={(event) => { setDescription(event.target.value); setReviewed(false); }} />
        <span className="field-hint">{description.length}/{CONTENT_LIMITS.report_note} characters</span>
        <span className="field-hint">Remove names, identifying details and accusations. Preserve the factual experience; reject if it cannot be published safely.</span>
      </label>
      {report.imageUrl && <figure className={styles.evidence}>
        <div className={styles.canvas}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private signed evidence must not pass through a public image optimizer */}
          <img ref={imgRef} src={report.imageUrl} alt="Private evidence awaiting review" referrerPolicy="no-referrer"
            onLoad={() => setImageState("loaded")} onError={() => { setImageState("error"); setReviewed(false); }} />
          {imageState === "loaded" && <div className={styles.overlay}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
            {regions.map((region, index) => (
              <div key={index} className={`${styles.region} ${region.mode === "blur" ? styles.regionBlur : styles.regionBlackout}`}
                style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}>
                <button type="button" className={styles.regionRemove} disabled={busy}
                  onClick={(event) => { event.stopPropagation(); removeRegion(index); }} aria-label={`Remove ${region.mode} region ${index + 1}`}>×</button>
              </div>
            ))}
            {draft && <div className={styles.regionDraft}
              style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}
          </div>}
        </div>
        <figcaption>
          <a className="text-button" href={report.imageUrl} target="_blank" rel="noopener noreferrer">Open private photo full size (new tab)</a>
          <p className="field-hint">Private link expires after 10 minutes. Do not share it.</p>
          {imageState === "loaded" && <div className={styles.redactionControls}>
            <span className="field-hint">Optional: drag a rectangle over any face, plate or identifying detail, then choose how to hide it.</span>
            <label><input type="radio" name={`redact-mode-${report.id}`} checked={drawMode === "blur"} disabled={busy} onChange={() => setDrawMode("blur")} /> Blur</label>
            <label><input type="radio" name={`redact-mode-${report.id}`} checked={drawMode === "blackout"} disabled={busy} onChange={() => setDrawMode("blackout")} /> Black box</label>
            {regions.length > 0 && <button type="button" className="text-button" disabled={busy}
              onClick={() => { setRegions([]); setReviewed(false); }}>Clear all redactions ({regions.length})</button>}
          </div>}
        </figcaption>
      </figure>}
      {imageError && <p className="form-error" role="alert">{imageError}</p>}
      {evidenceRequired && report.imageUrl && imageState === "loading" && !imageError && <p role="status">Loading private photo before review...</p>}
      {!evidenceRequired && <p className="field-hint">No photo attached.</p>}
      <label className={styles.confirmation}><input type="checkbox" checked={reviewed} disabled={busy || !evidenceReady} onChange={(event) => setReviewed(event.target.checked)} />
        I reviewed the note and any photo for identifying details. The content is suitable for publication{regions.length > 0 ? " with the drawn redactions applied" : ""}.
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.actions}>
        <button className="button button-primary" disabled={busy || !reviewed || !description.trim() || !evidenceReady}
          onClick={() => decide({ action: "approve", description, reviewed: true, redactions: regions.length > 0 ? regions : undefined })}>Approve &amp; publish</button>
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
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      try {
        const response = await fetch("/api/moderation/reports", {
          credentials: "same-origin", cache: "no-store",
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
    const response = await fetch(`/api/moderation/reports/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
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
