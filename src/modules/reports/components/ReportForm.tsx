"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ReporterType } from "../types";
import { Icon } from "@/lib/components/Icon";
import type { MapFocus } from "@/modules/map/lib/mapStyle";

export interface ReportFormValues {
  reporterType: ReporterType;
  description: string;
  incidentDate: string;
  image: File | null;
}

interface ReportFormProps {
  onSubmit: (values: ReportFormValues) => Promise<void>;
  onCancel: () => void;
  preview?: boolean;
}

export function ReportDialog({ location, preview, onSubmit, onCancel }: ReportFormProps & { location: MapFocus }) {
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
      <ReportForm onSubmit={onSubmit} onCancel={onCancel} preview={preview} />
    </dialog>
  );
}

export function ReportForm({ onSubmit, onCancel, preview = false }: ReportFormProps) {
  const [reporterType, setReporterType] = useState<ReporterType>("victim");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) {
      setError("Please describe what happened before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ reporterType, description, incidentDate, image });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="report-form">
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
          maxLength={2000}
          placeholder="For example: my car was clamped here on a Saturday afternoon."
        />
        <span className="field-hint">Stick to the facts. Leave out names, number plates, and personal details.</span>
        <span className="field-hint">{preview ? "This test note will be saved only in this browser until Reset preview." : "A human moderator reviews every note before it appears on the map."}</span>
      </label>
      <label className="field">
        Date it happened (optional)
        <input
          type="date"
          value={incidentDate}
          onChange={(e) => setIncidentDate(e.target.value)}
        />
      </label>
      <label className="field photo-field">
        Add a photo <span className="field-hint">Optional</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setImage(e.target.files?.[0] ?? null)}
        />
        <span className="field-hint">{preview ? "Preview only. Photos are not uploaded or stored." : "Photos stay private until a moderator approves them. Avoid faces and number plates."}</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button
          type="submit"
          disabled={submitting}
          className="button button-primary"
        >
          {submitting ? "Submitting..." : preview ? "Save preview report" : "Submit report"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="button button-surface">
          Cancel
        </button>
      </div>
    </form>
  );
}
