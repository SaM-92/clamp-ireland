import { RISK_LEVEL_THRESHOLDS } from "./constants";

export type RiskLevel = "low" | "medium" | "high";

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= RISK_LEVEL_THRESHOLDS.high) return "high";
  if (score >= RISK_LEVEL_THRESHOLDS.medium) return "medium";
  return "low";
}
