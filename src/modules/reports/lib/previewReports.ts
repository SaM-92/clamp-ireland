import { z } from "zod";
import type { LocationSummary } from "@/modules/locations/types";
import type { TransparencyStats } from "@/modules/dashboard/types";
import { calculateRiskScore } from "@/modules/scoring/calculateRiskScore";
import { riskLevelFromScore } from "@/modules/scoring/riskLevel";
import { CONTENT_LIMITS } from "@/modules/content-policy/policy";
import type { PublicReport } from "../types";

const STORAGE_KEY = "clamp-local-preview-v1";
const previewReportSchema = z.object({
  id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  reporterType: z.enum(["victim", "neighbour", "witness"]),
  hasImage: z.boolean(),
  createdAt: z.iso.datetime(),
  description: z.string().max(CONTENT_LIMITS.report_note).default("Preview report from before notes were added."),
  incidentDate: z.iso.date().nullable().default(null),
});
export type PreviewReport = z.infer<typeof previewReportSchema>;

export function loadPreviewReports(): PreviewReport[] {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];
  const result = z.array(previewReportSchema).safeParse(JSON.parse(saved));
  if (!result.success) throw new Error("Saved preview data is invalid. Use Reset preview to start again.");
  return result.data;
}

export function savePreviewReports(reports: PreviewReport[]) {
  // Preview notes stay in this browser; never store files or identity data.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export function previewLocationKey(report: { lat: number; lng: number }) {
  return `${report.lat.toFixed(4)},${report.lng.toFixed(4)}`;
}

export function getPreviewNotes(reports: PreviewReport[], locationId: string): PublicReport[] {
  return reports.filter((report) => previewLocationKey(report) === locationId)
    .slice(-50).reverse().map((report) => ({
      id: report.id, reporterType: report.reporterType, description: report.description,
      incidentDate: report.incidentDate, createdAt: report.createdAt,
    }));
}

export function summarizePreviewReports(reports: PreviewReport[], now = new Date()) {
  const groups = new Map<string, PreviewReport[]>();
  for (const report of reports) {
    const key = previewLocationKey(report);
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  const locations: LocationSummary[] = [...groups.entries()].map(([id, group]) => {
    const riskScore = calculateRiskScore(group.map((report) => ({
      reporterType: report.reporterType,
      hasImage: report.hasImage,
      createdAt: new Date(report.createdAt),
    })), now);
    return {
      id, lat: group[0].lat, lng: group[0].lng,
      riskScore, riskLevel: riskLevelFromScore(riskScore), reportCount: group.length,
    };
  });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const stats: TransparencyStats = {
    totalReports: reports.length,
    reportsThisMonth: reports.filter((report) => new Date(report.createdAt).getTime() >= monthStart).length,
    totalLocations: locations.length,
    highRiskLocations: locations.filter((location) => location.riskLevel === "high").length,
  };
  return { locations, stats };
}
