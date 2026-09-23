"use client";

import type { ReporterType, SubmittedReport } from "./types";

export interface SubmitReportArgs {
  /** Either an existing location id, or lat/lng to find-or-create one server-side. */
  locationId?: string;
  lat?: number;
  lng?: number;
  reporterType: ReporterType;
  description: string;
  incidentDate: string;
  image: File | null;
  /** Present only for the anonymous ("no account needed") submission path. */
  turnstileToken?: string;
  /** Required freeform display name for the anonymous path only. */
  nickname?: string;
}

export async function submitReport(args: SubmitReportArgs): Promise<SubmittedReport> {
  const formData = new FormData();
  if (args.locationId) formData.set("locationId", args.locationId);
  else if (args.lat !== undefined && args.lng !== undefined) {
    formData.set("lat", String(args.lat));
    formData.set("lng", String(args.lng));
  }
  formData.set("reporterType", args.reporterType);
  formData.set("description", args.description);
  if (args.incidentDate) formData.set("incidentDate", args.incidentDate);
  if (args.image) formData.set("image", args.image);
  if (args.turnstileToken) formData.set("turnstileToken", args.turnstileToken);
  if (args.nickname) formData.set("nickname", args.nickname);
  // Honeypot: a real visitor never sees or fills this field (see ReportForm.tsx).
  formData.set("website", "");

  const res = await fetch("/api/reports", {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to submit report");
  }
  return res.json();
}
