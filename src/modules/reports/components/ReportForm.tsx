"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { FormEvent } from "react";
import type { ReporterType } from "../types";
import { Icon } from "@/lib/components/Icon";
import type { MapFocus } from "@/modules/map/lib/mapStyle";
import Link from "next/link";
import { validateContent, CONTENT_LIMITS } from "@/modules/content-policy/policy";
import { PHOTO_ACCEPT, PHOTO_HINT, validatePhoto } from "@/modules/photos/policy";
import { TurnstileWidget } from "@/modules/content-policy/components/TurnstileWidget";
import { env } from "@/lib/env";
import { todayInDublin } from "@/lib/dateFormat";

export interface ReportFormValues {
  reporterType: ReporterType;
  description: string;
  incidentDate: string;
  /** Up to 3 photos, in submission order. */
  images: File[];
  turnstileToken?: string;
  nickname?: string;
}

interface ReportFormProps {
  onSubmit: (values: ReportFormValues) => Promise<void>;
  onCancel: () => void;
  preview?: boolean;
  /** Signed-in users skip the bot-check widget; anonymous submitters need it. */
  signedIn?: boolean;
}

export function ReportDialog({ location, preview, signedIn, onSubmit, onCancel }: ReportFormProps & { location: MapFocus }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector("select")?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="report-dialog" aria-labelledby="report-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <div className="dialog-heading">
        <div><p className="eyebrow">{preview ? "Local preview report" : "A little local knowledge"}</p>
          <h2 id="report-title">Share what happened.</h2>
          <p><Icon name="pin" />{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</p>
        </div>
        <button className="icon-button" aria-label="Close report form" onClick={onCancel}><Icon name="close" /></button>
      </div>
      <ReportForm onSubmit={onSubmit} onCancel={onCancel} preview={preview} signedIn={signedIn} />
    </dialog>
  );
}

const MAX_PHOTOS = 3;

export function ReportForm({ onSubmit, onCancel, preview = false, signedIn = true }: ReportFormProps) {
  const [reporterType, setReporterType] = useState<ReporterType>("victim");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [nickname, setNickname] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [previewErrors, setPreviewErrors] = useState<Set<number>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  // Which photo slot the next file picker selection replaces; null means "append a new photo".
  const replaceIndexRef = useRef<number | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const anonymous = !preview && !signedIn;
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  // Derived, not stored: recomputed only when the selected files themselves change.
  const previewUrls = useMemo(() => images.map((file) => URL.createObjectURL(file)), [images]);

  // Object URLs must be revoked when the files change or the form unmounts, otherwise
  // each selected photo leaks memory for the life of the page.
  useEffect(() => {
    return () => { for (const url of previewUrls) URL.revokeObjectURL(url); };
  }, [previewUrls]);

  function openPicker(replaceIndex: number | null) {
    replaceIndexRef.current = replaceIndex;
    fileInput.current?.click();
  }

  function handleFileSelected(selected: File | null) {
    if (fileInput.current) fileInput.current.value = "";
    if (!selected) return;
    try {
      validatePhoto(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Choose a supported photo.");
      return;
    }
    setError(null);
    const replaceIndex = replaceIndexRef.current;
    setImages((current) => {
      if (replaceIndex !== null && replaceIndex < current.length) {
        const next = [...current];
        next[replaceIndex] = selected;
        return next;
      }
      if (current.length >= MAX_PHOTOS) return current;
      return [...current, selected];
    });
    if (replaceIndex !== null) {
      setPreviewErrors((current) => {
        if (!current.has(replaceIndex)) return current;
        const next = new Set(current);
        next.delete(replaceIndex);
        return next;
      });
    }
  }

  function removePhoto(index: number) {
    setImages((current) => current.filter((_, i) => i !== index));
    setPreviewErrors((current) => {
      const next = new Set<number>();
      for (const i of current) { if (i < index) next.add(i); else if (i > index) next.add(i - 1); }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) {
      setError("Please describe what happened before submitting.");
      return;
    }
    if (anonymous && !nickname.trim()) {
      setError("Enter a name or nickname before submitting.");
      return;
    }
    if (honeypot.trim() !== "") return; // Silently drop bot submissions that fill the decoy field.
    if (incidentDate && incidentDate > todayInDublin()) {
      setError("Incident date cannot be in the future.");
      return;
    }
    if (anonymous && env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken) {
      setError("Complete the bot check before submitting.");
      return;
    }
    setSubmitting(true);
    setSubmitStatus("Running a safety check and saving your report…");
    setError(null);
    try {
      const checkedDescription = validateContent("report_note", description);
      const checkedNickname = anonymous ? validateContent("nickname", nickname) : undefined;
      for (const file of images) validatePhoto(file);
      await onSubmit({ reporterType, description: checkedDescription, incidentDate, images,
        turnstileToken: anonymous ? turnstileToken : undefined, nickname: checkedNickname });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
      setSubmitStatus("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="report-form">
      {anonymous && (
        <div className="report-mode-choice" role="group" aria-label="How are you reporting?">
          <div className="report-mode-card report-mode-card-active">
            <Icon name="check" width="16" height="16" />
            <div>
              <strong>Reporting anonymously</strong>
              <p>No account needed - add a nickname below.</p>
            </div>
          </div>
          <Link href="/auth/username" className="report-mode-card report-mode-card-link">
            <Icon name="shield" width="16" height="16" />
            <div>
              <strong>Sign in instead</strong>
              <p>Still posts under your own username, not your real name - just carries more trust weighting.</p>
            </div>
            <Icon name="arrow" width="16" height="16" className="report-mode-arrow" />
          </Link>
        </div>
      )}
      {anonymous && (
        <label className="field">
          Your name or nickname
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            maxLength={CONTENT_LIMITS.nickname}
            placeholder="e.g. Dave, or any nickname you like"
          />
          <span className="field-hint">Shown next to your report with an &quot;Anonymous&quot; tag - it doesn&apos;t need to be your real name.</span>
        </label>
      )}
      <label className="field">
        I am reporting as
        <select
          value={reporterType}
          onChange={(e) => setReporterType(e.target.value as ReporterType)}
        >
          <option value="victim">Someone who was clamped here</option>
          <option value="neighbour">A local resident</option>
          <option value="witness">A witness</option>
        </select>
      </label>
      <label className="field">
        What happened?
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          required
          maxLength={CONTENT_LIMITS.report_note}
          placeholder="For example: my car was clamped here on a Saturday afternoon."
        />
        <span className="field-hint">{description.length}/{CONTENT_LIMITS.report_note} characters</span>
        <span className="field-hint">Factual criticism is welcome. Profanity, abuse and threats are not. Leave out names, number plates, and personal details.</span>
        <span className="field-hint">{preview ? "Local rules only: this note stays in your browser until Reset preview and is never sent to Azure. Contextual AI is shown separately in the synthetic demo." : "A human moderator reviews every note before it appears on the map."}</span>
        {!preview && !anonymous && <span className="field-hint">Before posting, <Link href="/auth/username">choose your checked public username</Link>.</span>}
      </label>
      <label className="field">
        Date it happened (optional)
        <input
          type="date"
          value={incidentDate}
          max={todayInDublin()}
          onChange={(e) => setIncidentDate(e.target.value)}
        />
      </label>
      <div className="field photo-field">
        <span id="report-photo-label">Add up to 3 photos <span className="field-hint">Optional</span></span>
        <input
          ref={fileInput}
          type="file"
          accept={PHOTO_ACCEPT}
          className="visually-hidden"
          aria-labelledby="report-photo-label"
          onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
        />
        <div className="photo-slots">
          {images.map((file, index) => {
            const failed = previewErrors.has(index);
            return (
              <div className="photo-preview" key={index}>
                {!failed ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not an optimizable remote image
                  <img src={previewUrls[index]} alt={`Selected photo ${index + 1} preview`}
                    onError={() => setPreviewErrors((current) => new Set(current).add(index))} />
                ) : (
                  <div className="photo-preview-fallback" aria-hidden="true"><Icon name="camera" width="22" height="22" /></div>
                )}
                <div className="photo-preview-info">
                  <span className="photo-preview-name">{file.name}</span>
                  <div className="photo-preview-actions">
                    <button type="button" className="button button-surface" onClick={() => openPicker(index)}>Replace photo</button>
                    <button type="button" className="button button-surface" onClick={() => removePhoto(index)}>Remove</button>
                  </div>
                </div>
              </div>
            );
          })}
          {images.length < MAX_PHOTOS && (
            <button type="button" className="button button-surface photo-pick-button" onClick={() => openPicker(null)}>
              <Icon name="camera" width="18" height="18" /> {images.length === 0 ? "Choose a photo" : "Add another photo"}
            </button>
          )}
        </div>
        <span className="field-hint">{PHOTO_HINT}</span>
        <span className="field-hint">{preview ? "Preview only. Photos are not uploaded or stored." : "Photos remain private evidence for moderators, even after a report is approved. Avoid faces and number plates."}</span>
      </div>
      {/* Honeypot: hidden from real visitors (off-screen, not display:none, since some
          bots skip display:none fields), left blank by them, and never rendered for
          preview or signed-in submissions where it isn't needed. */}
      {anonymous && (
        <label className="visually-hidden" aria-hidden="true">
          Leave this field blank
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </label>
      )}
      {anonymous && env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
        <TurnstileWidget siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} onToken={handleTurnstileToken} />
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {submitting && (
        <div className="submit-overlay">
          <div className="submit-overlay-box" role="status">
            <span className="spinner spinner-lg" aria-hidden="true" />
            <strong>{submitStatus}</strong>
            <span>This can take a few seconds - please don&apos;t close this window.</span>
          </div>
        </div>
      )}
      <div className="dialog-actions">
        <button
          type="submit"
          disabled={submitting}
          className="button button-primary"
        >
          {submitting ? "Checking…" : preview ? "Save preview report" : "Submit report"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="button button-surface">
          Cancel
        </button>
      </div>
    </form>
  );
}
