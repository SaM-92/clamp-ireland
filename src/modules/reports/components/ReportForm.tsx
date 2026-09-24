"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
  image: File | null;
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

export function ReportForm({ onSubmit, onCancel, preview = false, signedIn = true }: ReportFormProps) {
  const [reporterType, setReporterType] = useState<ReporterType>("victim");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [nickname, setNickname] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const anonymous = !preview && !signedIn;
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

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
      if (image) validatePhoto(image);
      await onSubmit({ reporterType, description: checkedDescription, incidentDate, image,
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
      <label className="field photo-field">
        Add a photo <span className="field-hint">Optional</span>
        <input
          type="file"
          accept={PHOTO_ACCEPT}
          onChange={(e) => {
            const selected = e.target.files?.[0] ?? null;
            try {
              if (selected) validatePhoto(selected);
              setImage(selected);
              setError(null);
            } catch (cause) {
              setImage(null);
              e.target.value = "";
              setError(cause instanceof Error ? cause.message : "Choose a supported photo.");
            }
          }}
        />
        <span className="field-hint">{PHOTO_HINT}</span>
        <span className="field-hint">{preview ? "Preview only. Photos are not uploaded or stored." : "Photos remain private evidence for moderators, even after a report is approved. Avoid faces and number plates."}</span>
      </label>
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
