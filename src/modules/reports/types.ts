export type ReporterType = "victim" | "neighbour" | "witness";

export const REPORTER_TYPES: ReporterType[] = ["victim", "neighbour", "witness"];

export type ModerationStatus = "pending" | "published" | "rejected";

export interface PublicReport {
  id: string;
  reporterType: ReporterType;
  description: string;
  incidentDate: string | null;
  createdAt: string;
}

export interface SubmittedReport {
  id: string;
  location_id: string;
  reporter_type: ReporterType;
  has_image: boolean;
  description: string;
  incident_date: string | null;
  moderation_status: ModerationStatus;
  created_at: string;
}
