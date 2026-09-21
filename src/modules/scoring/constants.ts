import type { ReporterType } from "@/modules/reports/types";

/**
 * Base points awarded per report, before time-decay. Two axes drive the
 * weight: who is reporting, and whether they backed it with a photo — see
 * docs/03-scoring-algorithm.md for the full rationale.
 */
export const REPORTER_WEIGHTS: Record<
  ReporterType,
  { withImage: number; withoutImage: number }
> = {
  victim: { withImage: 10, withoutImage: 6 },
  neighbour: { withImage: 5, withoutImage: 3 },
  witness: { withImage: 4, withoutImage: 2 },
};

/** Reports lose half their weight every this many days (recency matters, but old reports never fully vanish). */
export const HALF_LIFE_DAYS = 180;

/** Saturation constant for the diminishing-returns curve — see calculateRiskScore. */
export const SATURATION_K = 25;

/** risk_score (0-100) thresholds that map to a human-readable risk level. */
export const RISK_LEVEL_THRESHOLDS = {
  medium: 20,
  high: 50,
} as const;
