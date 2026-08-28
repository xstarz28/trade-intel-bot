/**
 * Phase 68 — Early-Warning Metrics
 *
 * Measures deterministic scenario metrics for alert quality.
 * All timestamps come from scenario/event inputs — no wall-clock dependence.
 */

export interface EarlyWarningTimestamps {
  alertTimestamp: number;
  firstDeteriorationTimestamp?: number;
  highRiskTimestamp?: number;
  invalidatedTimestamp?: number;
  slBreachTimestamp?: number;
  peakProfitTimestamp?: number;
  firstMeaningfulGivebackTimestamp?: number;
}

export interface EarlyWarningResult {
  /** Lead time from first alert to SL breach in ms. null if unavailable. */
  warningLeadTimeBeforeSL: number | null;
  /** Lead time from first alert to major profit deterioration in ms. null if unavailable. */
  warningLeadTimeBeforeMajorDeterioration: number | null;
  /** Time from peak profit to first meaningful giveback in ms. null if unavailable. */
  peakToGivebackTime: number | null;
  /** Time from first deterioration to HIGH_RISK in ms. null if unavailable. */
  deteriorationToHighRiskTime: number | null;
  /** Time from HIGH_RISK to INVALIDATED in ms. null if unavailable. */
  highRiskToInvalidatedTime: number | null;
}

/**
 * Compute early-warning metrics from scenario timestamps.
 * Returns null for any metric where required timestamps are unavailable.
 */
export function computeEarlyWarningMetrics(
  timestamps: EarlyWarningTimestamps
): EarlyWarningResult {
  const warningLeadTimeBeforeSL =
    timestamps.slBreachTimestamp !== undefined &&
    timestamps.alertTimestamp !== undefined
      ? timestamps.slBreachTimestamp - timestamps.alertTimestamp
      : null;

  // Guard: lead time should be positive if alert is before SL
  const validLeadTimeBeforeSL =
    warningLeadTimeBeforeSL !== null && warningLeadTimeBeforeSL > 0
      ? warningLeadTimeBeforeSL
      : null;

  const warningLeadTimeBeforeMajorDeterioration =
    timestamps.firstMeaningfulGivebackTimestamp !== undefined &&
    timestamps.alertTimestamp !== undefined
      ? timestamps.firstMeaningfulGivebackTimestamp - timestamps.alertTimestamp
      : null;

  const peakToGivebackTime =
    timestamps.firstMeaningfulGivebackTimestamp !== undefined &&
    timestamps.peakProfitTimestamp !== undefined
      ? timestamps.firstMeaningfulGivebackTimestamp -
        timestamps.peakProfitTimestamp
      : null;

  const deteriorationToHighRiskTime =
    timestamps.highRiskTimestamp !== undefined &&
    timestamps.firstDeteriorationTimestamp !== undefined
      ? timestamps.highRiskTimestamp - timestamps.firstDeteriorationTimestamp
      : null;

  const highRiskToInvalidatedTime =
    timestamps.invalidatedTimestamp !== undefined &&
    timestamps.highRiskTimestamp !== undefined
      ? timestamps.invalidatedTimestamp - timestamps.highRiskTimestamp
      : null;

  return {
    warningLeadTimeBeforeSL: validLeadTimeBeforeSL,
    warningLeadTimeBeforeMajorDeterioration,
    peakToGivebackTime,
    deteriorationToHighRiskTime,
    highRiskToInvalidatedTime,
  };
}
