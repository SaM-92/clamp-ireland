"use client";

import type { ReporterType, SubmittedReport } from "./types";

export interface SubmitReportArgs {
  locationId: string;
  reporterType: ReporterType;
  description: string;
  incidentDate: string;
  image: File | null;
  accessToken: string;
}

export async function submitReport(args: SubmitReportArgs): Promise<SubmittedReport> {
  const formData = new FormData();
  formData.set("locationId", args.locationId);
  formData.set("reporterType", args.reporterType);
  formData.set("description", args.description);
  if (args.incidentDate) formData.set("incidentDate", args.incidentDate);
  if (args.image) formData.set("image", args.image);

  const res = await fetch("/api/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.accessToken}` },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to submit report");
  }
  return res.json();
}
