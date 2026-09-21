"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { ReporterType } from "../types";

export interface ReportFormValues {
  reporterType: ReporterType;
  description: string;
  incidentDate: string;
  image: File | null;
}

interface ReportFormProps {
  onSubmit: (values: ReportFormValues) => Promise<void>;
  onCancel: () => void;
}

export function ReportForm({ onSubmit, onCancel }: ReportFormProps) {
  const [reporterType, setReporterType] = useState<ReporterType>("victim");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">Report this location</h2>
      <label className="flex flex-col gap-1 text-sm">
        I am reporting as
        <select
          value={reporterType}
          onChange={(e) => setReporterType(e.target.value as ReporterType)}
          className="rounded border p-2"
        >
          <option value="victim">Someone who was clamped here</option>
          <option value="neighbour">A local resident</option>
          <option value="witness">A witness</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        What happened (facts only — time, signage, etc.)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          required
          className="rounded border p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Date it happened (optional)
        <input
          type="date"
          value={incidentDate}
          onChange={(e) => setIncidentDate(e.target.value)}
          className="rounded border p-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Photo (optional — a moderator reviews and redacts it before it goes public)
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImage(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit report"}
        </button>
        <button type="button" onClick={onCancel} className="rounded border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
