"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatDateTime } from "@/lib/dateFormat";
import { CONTENT_LIMITS } from "@/modules/content-policy/policy";
import { PHOTO_ACCEPT, validatePhoto } from "@/modules/photos/policy";
import { pendingReportsSchema, type PendingReport, type PendingReportPhoto, type RedactionRegion } from "../types";
import styles from "./ModerationQueue.module.css";

type PhotoEdit = { redactions?: RedactionRegion[]; replacementPhoto?: File };
type Decision = { action: "reject" } | { action: "approve"; description: string; reviewed: true; photoEdits?: (PhotoEdit | undefined)[] };
type DraftRegion = { x: number; y: number; width: number; height: number };

/** One photo's own review UI (redact-in-browser or replace-with-your-own-upload) and loading
 * state, reported up to the parent card via onChange so "reviewed" can require every photo to
 * be ready before approval is allowed. */
function PhotoReview({ reportId, index, photo, busy, onChange }: {
  reportId: string; index: number; photo: PendingReportPhoto; busy: boolean;
  onChange: (index: number, ready: boolean, edit: PhotoEdit | undefined) => void;
}) {
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const [regions, setRegions] = useState<RedactionRegion[]>([]);
  const [drawMode, setDrawMode] = useState<"blur" | "blackout">("blur");
  const [draft, setDraft] = useState<DraftRegion | null>(null);
  const [replacementPhoto, setReplacementPhoto] = useState<File | null>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const replaceFileInput = useRef<HTMLInputElement>(null);
  const ready = !photo.imageError && (Boolean(replacementPhoto) || (Boolean(photo.imageUrl) && imageState === "loaded"));
  const displayError = photo.imageError || (imageState === "error" && !replacementPhoto
    ? "Private photo failed to load or expired. Reload the queue to get a new link, or replace the photo below." : null);

  // Derived, not stored: recomputed only when the selected replacement file itself changes.
  const replacementPreviewUrl = useMemo(() => (replacementPhoto ? URL.createObjectURL(replacementPhoto) : null), [replacementPhoto]);
  useEffect(() => {
    return () => { if (replacementPreviewUrl) URL.revokeObjectURL(replacementPreviewUrl); };
  }, [replacementPreviewUrl]);

  useEffect(() => {
    if (!photo.imageUrl || imageState !== "loading") return;
    const timer = window.setTimeout(() => setImageState("error"), 15_000);
    return () => window.clearTimeout(timer);
  }, [photo.imageUrl, imageState]);

  useEffect(() => {
    onChange(index, ready, replacementPhoto ? { replacementPhoto } : regions.length > 0 ? { redactions: regions } : undefined);
    // onChange is stabilized by the parent with useCallback; including it here would not change behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, ready, replacementPhoto, regions]);

  function pickReplacement(file: File | null) {
    if (!file) return;
    try {
      validatePhoto(file);
      setReplacementPhoto(file);
      setReplacementError(null);
      setRegions([]);
    } catch (cause) {
      if (replaceFileInput.current) replaceFileInput.current.value = "";
      setReplacementError(cause instanceof Error ? cause.message : "Choose a supported photo.");
    }
  }
  function clearReplacement() {
    setReplacementPhoto(null);
    setReplacementError(null);
    if (replaceFileInput.current) replaceFileInput.current.value = "";
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
    }
    dragStart.current = null;
    setDraft(null);
  }
  function removeRegion(position: number) {
    setRegions((current) => current.filter((_, i) => i !== position));
  }
  return (
    <figure className={styles.evidence}>
      <div className={styles.canvas}>
        {replacementPhoto && replacementPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview of the admin's own replacement photo
          <img src={replacementPreviewUrl} alt={`Replacement for photo ${index + 1}`} />
        ) : photo.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private signed evidence must not pass through a public image optimizer
          <img ref={imgRef} src={photo.imageUrl} alt={`Private evidence photo ${index + 1} awaiting review`} referrerPolicy="no-referrer"
            onLoad={() => setImageState("loaded")} onError={() => setImageState("error")} />
        ) : null}
        {!replacementPhoto && imageState === "loaded" && <div className={styles.overlay}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          {regions.map((region, position) => (
            <div key={position} className={`${styles.region} ${region.mode === "blur" ? styles.regionBlur : styles.regionBlackout}`}
              style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}>
              <button type="button" className={styles.regionRemove} disabled={busy}
                onClick={(event) => { event.stopPropagation(); removeRegion(position); }} aria-label={`Remove ${region.mode} region ${position + 1}`}>×</button>
            </div>
          ))}
          {draft && <div className={styles.regionDraft}
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />}
        </div>}
      </div>
      <figcaption>
        <p className="field-hint">Photo {index + 1}</p>
        {!replacementPhoto && photo.imageUrl && <>
          <a className="text-button" href={photo.imageUrl} target="_blank" rel="noopener noreferrer">Open private photo full size (new tab)</a>
          <p className="field-hint">Private link expires after 10 minutes. Do not share it.</p>
        </>}
        {replacementPhoto && <p className="field-hint">Publishing your replacement photo instead. The original evidence stays private for audit.</p>}
        <input ref={replaceFileInput} type="file" accept={PHOTO_ACCEPT} className="visually-hidden"
          aria-label={`Replace photo ${index + 1}`} disabled={busy} onChange={(event) => pickReplacement(event.target.files?.[0] ?? null)} />
        <div className={styles.replaceControls}>
          <button type="button" className="button button-surface" disabled={busy} onClick={() => replaceFileInput.current?.click()}>
            {replacementPhoto ? "Choose a different photo" : "Replace photo…"}
          </button>
          {replacementPhoto && <button type="button" className="text-button" disabled={busy} onClick={clearReplacement}>Use original photo instead</button>}
        </div>
        {replacementError && <p className="form-error" role="alert">{replacementError}</p>}
        {!replacementPhoto && imageState === "loaded" && <div className={styles.redactionControls}>
          <span className="field-hint">Optional: drag a rectangle over any face, plate or identifying detail, then choose how to hide it. Or edit the photo yourself and use Replace photo above.</span>
          <label><input type="radio" name={`redact-mode-${reportId}-${index}`} checked={drawMode === "blur"} disabled={busy} onChange={() => setDrawMode("blur")} /> Blur</label>
          <label><input type="radio" name={`redact-mode-${reportId}-${index}`} checked={drawMode === "blackout"} disabled={busy} onChange={() => setDrawMode("blackout")} /> Black box</label>
          {regions.length > 0 && <button type="button" className="text-button" disabled={busy}
            onClick={() => setRegions([])}>Clear all redactions ({regions.length})</button>}
        </div>}
      </figcaption>
      {displayError && <p className="form-error" role="alert">{displayError}</p>}
      {photo.imageUrl && imageState === "loading" && !displayError && !replacementPhoto && <p role="status">Loading private photo before review...</p>}
    </figure>
  );
}

function ReviewCard({ report, onDecision }: { report: PendingReport; onDecision: (id: string, decision: Decision) => Promise<void> }) {
  const [description, setDescription] = useState(report.description);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoReady, setPhotoReady] = useState<boolean[]>(() => report.photos.map(() => false));
  const [photoEdits, setPhotoEdits] = useState<(PhotoEdit | undefined)[]>(() => report.photos.map(() => undefined));
  const evidenceReady = report.photos.length === 0 || photoReady.every(Boolean);
  const anyPhotoEdited = photoEdits.some(Boolean);

  const handlePhotoChange = useCallback((index: number, ready: boolean, edit: PhotoEdit | undefined) => {
    setPhotoReady((current) => {
      if (current[index] === ready) return current;
      const next = [...current];
      next[index] = ready;
      return next;
    });
    setPhotoEdits((current) => {
      const next = [...current];
      next[index] = edit;
      return next;
    });
    setReviewed(false);
  }, []);

  async function decide(action: Decision) {
    setBusy(true);
    setError(null);
    try { await onDecision(report.id, action); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save review."); }
    finally { setBusy(false); }
  }
  return (
    <li className={styles.card}>
      <p>{report.reporterType}{report.isAnonymous ? " · anonymous" : ""}{report.isFlagged ? " · AI-flagged for review" : ""} · {formatDateTime(report.createdAt)}</p>
      <label className="field">Public note after review
        <textarea rows={4} value={description} maxLength={CONTENT_LIMITS.report_note} disabled={busy} onChange={(event) => { setDescription(event.target.value); setReviewed(false); }} />
        <span className="field-hint">{description.length}/{CONTENT_LIMITS.report_note} characters</span>
        <span className="field-hint">Remove names, identifying details and accusations. Preserve the factual experience; reject if it cannot be published safely.</span>
      </label>
      {report.photos.map((photo, index) => (
        <PhotoReview key={index} reportId={report.id} index={index} photo={photo} busy={busy} onChange={handlePhotoChange} />
      ))}
      {report.photos.length === 0 && <p className="field-hint">No photo attached.</p>}
      <label className={styles.confirmation}><input type="checkbox" checked={reviewed} disabled={busy || !evidenceReady} onChange={(event) => setReviewed(event.target.checked)} />
        I reviewed the note and every photo for identifying details. The content is suitable for publication{anyPhotoEdited ? " with your photo edits applied" : ""}.
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.actions}>
        <button className="button button-primary" disabled={busy || !reviewed || !description.trim() || !evidenceReady}
          onClick={() => decide({ action: "approve", description, reviewed: true, photoEdits: anyPhotoEdited ? photoEdits : undefined })}>Approve &amp; publish</button>
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
    let body: BodyInit;
    let headers: Record<string, string> | undefined;
    if (decision.action === "approve" && decision.photoEdits?.some((edit) => edit?.replacementPhoto)) {
      const { photoEdits, ...rest } = decision;
      const jsonEdits = photoEdits?.map((edit) => (edit ? { redactions: edit.redactions } : null));
      const form = new FormData();
      form.set("decision", JSON.stringify({ ...rest, photoEdits: jsonEdits }));
      photoEdits?.forEach((edit, index) => { if (edit?.replacementPhoto) form.set(`photo-${index}`, edit.replacementPhoto); });
      body = form; // Content-Type is set automatically with the multipart boundary.
    } else {
      headers = { "Content-Type": "application/json" };
      body = JSON.stringify(decision);
    }
    const response = await fetch(`/api/moderation/reports/${id}`, {
      method: "PATCH", credentials: "same-origin", headers, body,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setReports([]);
        setAccessDenied(true);
        setError("Your administrator session ended or access was revoked. Sign in again.");
        throw new Error("Administrator access required.");
      }
      // Only trust payload.error for 4xx (client-actionable, e.g. photo validation): a 5xx
      // means something failed unexpectedly, so always show the safe generic message.
      const payload = response.status < 500 ? await response.json().catch(() => null) : null;
      throw new Error(payload?.error ?? "Could not save moderation decision. Reload the queue before trying again.");
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
      <ul className={styles.list}>{reports.map((report) => (
        <ReviewCard key={`${report.id}:${report.photos.map((photo) => `${photo.imageUrl}|${photo.imageError}`).join(",")}`} report={report} onDecision={act} />
      ))}</ul>}
  </div>;
}
