import type { ReporterType } from "@/modules/reports/types";
import { HALF_LIFE_DAYS, REPORTER_WEIGHTS, SATURATION_K } from "./constants";

export interface ScorableReport {
  reporterType: ReporterType;
  hasImage: boolean;
  createdAt: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Computes a location's 0-100 risk score from its published reports.
 *
 * Each report contributes its base weight (see constants.ts) decayed
 * exponentially by age (half-life ~6 months), then the summed raw score is
 * passed through a saturating curve so a handful of reports move the needle
 * quickly but a huge pile of reports can't blow past 100 — see
 * docs/03-scoring-algorithm.md for the full write-up and worked examples.
 */
export function calculateRiskScore(
  reports: ScorableReport[],
  now: Date = new Date()
): number {
  const raw = reports.reduce((sum, report) => {
    const weight =
      REPORTER_WEIGHTS[report.reporterType][
        report.hasImage ? "withImage" : "withoutImage"
      ];
    const ageDays = Math.max(
      (now.getTime() - report.createdAt.getTime()) / MS_PER_DAY,
      0
    );
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    return sum + weight * decay;
  }, 0);

  const saturated = 100 * (1 - Math.exp(-raw / SATURATION_K));
  return Math.round(saturated * 100) / 100;
}
