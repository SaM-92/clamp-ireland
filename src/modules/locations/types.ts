export interface LocationSummary {
  id: string;
  lat: number;
  lng: number;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  reportCount: number;
}
