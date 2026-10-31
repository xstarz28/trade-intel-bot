/**
 * Phase 47 — STRICT FORWARD FORECAST OUTCOME EVALUATION.
 *
 * Replays forecasts against candles strictly after the signal candle close.
 * The baseline direction must be generated from a training window ending
 * before dataAsOf. Overlapping forecast windows are excluded by default.
 *
 * This measures realized outcomes; it does not calibrate probabilities.
 */

import type { OhlcvCandle } from "@/lib/data/market-types";

export type EvaluationDirection = "bullish" | "bearish" | "neutral";
export type ForecastEvent = "TARGET" | "INVALIDATION" | "TIME_EXIT" | "DIRECTION_ONLY";
export type ForecastEvaluationStatus =
  | "INSUFFICIENT_SAMPLE"
  | "BELOW_BASELINE"
  | "NEGATIVE_NET_EXPECTANCY"
  | "INCONCLUSIVE"
  | "POSITIVE_OUTCOME_EVIDENCE";

export interface ForwardForecastObservation {
  id: string;
  instrument: string;
  /** Close timestamp of the last candle used to create this forecast. */
  dataAsOf: number;
  /** Exact forecast horizon end; must align to the candle interval. */
  horizonEndsAt: number;
  direction: EvaluationDirection;
  /** Naive comparator direction, computed from prior-only training data. */
  baselineDirection: EvaluationDirection;
  /** Latest timestamp included in the baseline's training window. */
  baselineTrainingEndTime: number;
  baselineMethod: string;
  /** Observed market-structure levels from the forecast snapshot; optional. */
  objectivePrice?: number;
  invalidationPrice?: number;
}

export interface ForwardForecastEvaluationOptions {
  /** Explicit venue cost assumption for each side, in basis points. */
  costBpsPerSide: number;
  /** Neutral deadband for realized directional outcomes; defaults to round-trip costs. */
  neutralBandBps?: number;
  /** Minimum independent non-overlapping observations for descriptive status. */
  minimumSampleCount?: number;
  /** Exclude overlapping forecast windows to reduce dependent samples. */
  enforceNonOverlapping?: boolean;
}

export interface ForwardForecastOutcome {
  id: string;
  dataAsOf: number;
  horizonEndsAt: number;
  entryPrice: number;
  exitPrice: number;
  actualDirection: EvaluationDirection;
  predictedDirection: EvaluationDirection;
  baselineDirection: EvaluationDirection;
  forecastCorrect: boolean;
  baselineCorrect: boolean;
  event: ForecastEvent;
  barsHeld: number;
  timeToEventBars?: number;
  grossReturnPct?: number;
  netReturnPct?: number;
  netR?: number;
  mfeR?: number;
  maeR?: number;
}

export interface ForwardForecastEvaluationReport {
  schemaVersion: 1;
  methodology: "strict-forward-non-overlapping-replay";
  instrument: string;
  generatedAt: number;
  costBpsPerSide: number;
  neutralBandBps: number;
  observationCount: number;
  evaluatedCount: number;
  excludedCount: number;
  excludedReasons: Record<string, number>;
  directionalAccuracyPct: number | null;
  baselineAccuracyPct: number | null;
  accuracyLiftPct: number | null;
  accuracyWilson95: { lowerPct: number; upperPct: number } | null;
  targetHitPct: number | null;
  invalidationHitPct: number | null;
  timeExitPct: number | null;
  rEvaluatedCount: number;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdownR: number;
  averageMfeR: number | null;
  averageMaeR: number | null;
  status: ForecastEvaluationStatus;
  outcomes: ForwardForecastOutcome[];
  limitations: string[];
}

interface ValidatedObservation {
  observation: ForwardForecastObservation;
  signalIndex: number;
  horizonIndex: number;
  futureCandles: OhlcvCandle[];
}

function assertCandle(candle: OhlcvCandle, index: number): void {
  const values = [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume];
  if (!values.every(Number.isFinite) ||
      !Number.isSafeInteger(candle.timestamp) ||
      candle.timestamp <= 0 ||
      candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
      candle.volume < 0 ||
      candle.high < Math.max(candle.open, candle.close, candle.low) ||
      candle.low > Math.min(candle.open, candle.close, candle.high)) {
    throw new Error(`Invalid OHLCV candle at index ${index}.`);
  }
}

function wilson95(successes: number, total: number): { lowerPct: number; upperPct: number } | null {
  if (total <= 0) return null;
  const z = 1.96;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) / total) + (z2 / (4 * total * total)))) / denominator;
  return {
    lowerPct: Math.max(0, center - margin) * 100,
    upperPct: Math.min(1, center + margin) * 100,
  };
}

function classifyDirection(returnBps: number, neutralBandBps: number): EvaluationDirection {
  if (returnBps > neutralBandBps) return "bullish";
  if (returnBps < -neutralBandBps) return "bearish";
  return "neutral";
}

function directionMatches(actual: EvaluationDirection, predicted: EvaluationDirection): boolean {
  return actual === predicted;
}

function positiveLevel(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function evaluateR(
  observation: ForwardForecastObservation,
  futureCandles: OhlcvCandle[],
  entryPrice: number,
  costBpsPerSide: number,
): Pick<ForwardForecastOutcome, "event" | "exitPrice" | "barsHeld" | "timeToEventBars" | "grossReturnPct" | "netReturnPct" | "netR" | "mfeR" | "maeR"> {
  const objective = positiveLevel(observation.objectivePrice);
  const invalidation = positiveLevel(observation.invalidationPrice);
  const long = observation.direction === "bullish";
  const validGeometry = observation.direction !== "neutral" && objective !== undefined && invalidation !== undefined &&
    (long ? objective > entryPrice && invalidation < entryPrice : objective < entryPrice && invalidation > entryPrice);
  const side = long ? 1 : -1;
  let event: ForecastEvent = "DIRECTION_ONLY";
  let exitPrice = futureCandles[futureCandles.length - 1].close;
  let barsHeld = futureCandles.length;
  let timeToEventBars: number | undefined;
  let mfeR: number | undefined;
  let maeR: number | undefined;
  let netR: number | undefined;

  if (validGeometry) {
    event = "TIME_EXIT";
    const riskPrice = Math.abs(entryPrice - invalidation);
    const riskPct = riskPrice / entryPrice * 100;
    let maxFavorable = 0;
    let maxAdverse = 0;
    for (let index = 0; index < futureCandles.length; index += 1) {
      const candle = futureCandles[index];
      const favorable = long ? candle.high - entryPrice : entryPrice - candle.low;
      const adverse = long ? entryPrice - candle.low : candle.high - entryPrice;
      const stopHit = long ? candle.low <= invalidation : candle.high >= invalidation;
      const targetHit = long ? candle.high >= objective : candle.low <= objective;
      // Conservative path: if both levels print in one candle, invalidation wins.
      if (stopHit) {
        const adverseGap = long ? candle.open < invalidation : candle.open > invalidation;
        exitPrice = adverseGap ? candle.open : invalidation;
        maxAdverse = Math.max(maxAdverse, Math.abs(entryPrice - exitPrice));
        // Intrabar ordering is unknown on a stop candle; do not credit its favorable extreme.
        event = "INVALIDATION";
        barsHeld = index + 1;
        timeToEventBars = barsHeld;
        break;
      }
      maxFavorable = Math.max(maxFavorable, favorable);
      maxAdverse = Math.max(maxAdverse, adverse);
      if (targetHit) {
        exitPrice = objective;
        event = "TARGET";
        barsHeld = index + 1;
        timeToEventBars = barsHeld;
        break;
      }
    }
    mfeR = maxFavorable / riskPrice;
    maeR = maxAdverse / riskPrice;
    const grossReturnPct = side * (exitPrice / entryPrice - 1) * 100;
    const netReturnPct = grossReturnPct - (2 * costBpsPerSide) / 100;
    netR = riskPct > 0 ? netReturnPct / riskPct : undefined;
    return { event, exitPrice, barsHeld, timeToEventBars, grossReturnPct, netReturnPct, netR, mfeR, maeR };
  }

  const grossReturnPct = observation.direction === "neutral" ? undefined : side * (exitPrice / entryPrice - 1) * 100;
  const netReturnPct = grossReturnPct === undefined ? undefined : grossReturnPct - (2 * costBpsPerSide) / 100;
  return { event, exitPrice, barsHeld, ...(grossReturnPct === undefined ? {} : { grossReturnPct }), ...(netReturnPct === undefined ? {} : { netReturnPct }) };
}

function recordExcluded(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

export function evaluateForwardForecastOutcomes(
  observations: ForwardForecastObservation[],
  candles: OhlcvCandle[],
  options: ForwardForecastEvaluationOptions,
  now: () => number = Date.now,
): ForwardForecastEvaluationReport {
  if (!Number.isFinite(options.costBpsPerSide) || options.costBpsPerSide < 0) {
    throw new Error("costBpsPerSide must be an explicit non-negative number.");
  }
  const neutralBandBps = options.neutralBandBps ?? options.costBpsPerSide * 2;
  const minimumSampleCount = options.minimumSampleCount ?? 100;
  const enforceNonOverlapping = options.enforceNonOverlapping ?? true;
  if (!Number.isFinite(neutralBandBps) || neutralBandBps < 0) throw new Error("neutralBandBps must be non-negative.");
  if (!Number.isInteger(minimumSampleCount) || minimumSampleCount < 1) throw new Error("minimumSampleCount must be a positive integer.");
  if (candles.length < 3) throw new Error("At least three completed candles are required.");

  candles.forEach(assertCandle);
  const intervalMs = candles[1].timestamp - candles[0].timestamp;
  if (intervalMs <= 0) throw new Error("Candle timestamps must be strictly ascending.");
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].timestamp - candles[index - 1].timestamp !== intervalMs) {
      throw new Error("Forecast evaluation requires a gap-free, fixed-interval candle series; missing bars are never synthesized.");
    }
  }

  const instrument = observations[0]?.instrument?.trim();
  if (!instrument) throw new Error("At least one observation with an instrument is required.");
  const ids = new Set<string>();
  const ordered = [...observations].sort((a, b) => a.dataAsOf - b.dataAsOf);
  if (ordered.some((item, index) => index > 0 && item.dataAsOf === ordered[index - 1].dataAsOf)) {
    throw new Error("Duplicate forecast observation timestamps are not allowed.");
  }
  for (const item of ordered) {
    if (!item.id.trim() || ids.has(item.id)) throw new Error("Forecast observation IDs must be non-empty and unique.");
    ids.add(item.id);
    if (item.instrument !== instrument) throw new Error("Evaluate one instrument per report.");
    if (!["bullish", "bearish", "neutral"].includes(item.direction) ||
        !["bullish", "bearish", "neutral"].includes(item.baselineDirection)) {
      throw new Error(`Invalid forecast or baseline direction for ${item.id}.`);
    }
    if (!Number.isSafeInteger(item.baselineTrainingEndTime) || item.baselineTrainingEndTime >= item.dataAsOf) {
      throw new Error(`Baseline leakage detected for observation ${item.id}: training must end before forecast dataAsOf.`);
    }
    if (typeof item.baselineMethod !== "string" || !item.baselineMethod.trim()) {
      throw new Error(`A documented prior-only baseline method is required for ${item.id}.`);
    }
    if (!Number.isSafeInteger(item.dataAsOf) || !Number.isSafeInteger(item.horizonEndsAt) ||
        item.horizonEndsAt <= item.dataAsOf || (item.horizonEndsAt - item.dataAsOf) % intervalMs !== 0) {
      throw new Error(`Invalid or misaligned forecast horizon for ${item.id}.`);
    }
  }

  const indexByCloseTime = new Map<number, number>();
  candles.forEach((candle, index) => indexByCloseTime.set(candle.timestamp + intervalMs, index));
  const excludedReasons: Record<string, number> = {};
  const validated: ValidatedObservation[] = [];
  let previousHorizonEnd = -Infinity;

  for (const observation of ordered) {
    const signalIndex = indexByCloseTime.get(observation.dataAsOf);
    if (signalIndex === undefined) {
      recordExcluded(excludedReasons, "signal_snapshot_not_in_candle_history");
      continue;
    }
    if (enforceNonOverlapping && observation.dataAsOf < previousHorizonEnd) {
      recordExcluded(excludedReasons, "overlapping_horizon");
      continue;
    }
    const horizonIndex = candles.findIndex((candle) => candle.timestamp === observation.horizonEndsAt);
    if (horizonIndex < 0 || horizonIndex <= signalIndex) {
      recordExcluded(excludedReasons, "right_censored_or_incomplete_horizon");
      continue;
    }
    const futureCandles = candles.slice(signalIndex + 1, horizonIndex);
    const expectedBars = (observation.horizonEndsAt - observation.dataAsOf) / intervalMs;
    if (futureCandles.length !== expectedBars) {
      recordExcluded(excludedReasons, "right_censored_or_incomplete_horizon");
      continue;
    }
    if (futureCandles.length === 0) {
      recordExcluded(excludedReasons, "empty_future_window");
      continue;
    }
    validated.push({ observation, signalIndex, horizonIndex, futureCandles });
    previousHorizonEnd = observation.horizonEndsAt;
  }

  const outcomes: ForwardForecastOutcome[] = [];
  for (const item of validated) {
    const observation = item.observation;
    const entryPrice = item.futureCandles[0].open;
    const exit = evaluateR(observation, item.futureCandles, entryPrice, options.costBpsPerSide);
    const grossMarketReturnBps = (exit.exitPrice / entryPrice - 1) * 10_000;
    const actualDirection = classifyDirection(grossMarketReturnBps, neutralBandBps);
    outcomes.push({
      id: observation.id,
      dataAsOf: observation.dataAsOf,
      horizonEndsAt: observation.horizonEndsAt,
      entryPrice,
      exitPrice: exit.exitPrice,
      actualDirection,
      predictedDirection: observation.direction,
      baselineDirection: observation.baselineDirection,
      forecastCorrect: directionMatches(actualDirection, observation.direction),
      baselineCorrect: directionMatches(actualDirection, observation.baselineDirection),
      event: exit.event,
      barsHeld: exit.barsHeld,
      ...(exit.timeToEventBars === undefined ? {} : { timeToEventBars: exit.timeToEventBars }),
      grossReturnPct: exit.grossReturnPct,
      netReturnPct: exit.netReturnPct,
      ...(exit.netR === undefined ? {} : { netR: exit.netR }),
      ...(exit.mfeR === undefined ? {} : { mfeR: exit.mfeR }),
      ...(exit.maeR === undefined ? {} : { maeR: exit.maeR }),
    });
  }

  const directionalCorrect = outcomes.filter((outcome) => outcome.forecastCorrect).length;
  const baselineCorrect = outcomes.filter((outcome) => outcome.baselineCorrect).length;
  const directionalAccuracy = outcomes.length ? directionalCorrect / outcomes.length * 100 : null;
  const baselineAccuracy = outcomes.length ? baselineCorrect / outcomes.length * 100 : null;
  const accuracyLift = directionalAccuracy === null || baselineAccuracy === null ? null : directionalAccuracy - baselineAccuracy;
  const interval = wilson95(directionalCorrect, outcomes.length);
  const rOutcomes = outcomes.filter((outcome): outcome is ForwardForecastOutcome & { netR: number; mfeR: number; maeR: number } =>
    outcome.netR !== undefined && outcome.mfeR !== undefined && outcome.maeR !== undefined
  );
  const netWins = rOutcomes.reduce((sum, outcome) => sum + Math.max(0, outcome.netR), 0);
  const netLosses = rOutcomes.reduce((sum, outcome) => sum + Math.max(0, -outcome.netR), 0);
  let cumulativeR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  for (const outcome of rOutcomes) {
    cumulativeR += outcome.netR;
    peakR = Math.max(peakR, cumulativeR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - cumulativeR);
  }
  const targetCount = rOutcomes.filter((outcome) => outcome.event === "TARGET").length;
  const invalidationCount = rOutcomes.filter((outcome) => outcome.event === "INVALIDATION").length;
  const timeExitCount = rOutcomes.filter((outcome) => outcome.event === "TIME_EXIT").length;
  const expectancyR = rOutcomes.length ? rOutcomes.reduce((sum, outcome) => sum + outcome.netR, 0) / rOutcomes.length : null;
  let status: ForecastEvaluationStatus = "INSUFFICIENT_SAMPLE";
  if (outcomes.length >= minimumSampleCount) {
    if ((accuracyLift ?? 0) <= 0) status = "BELOW_BASELINE";
    else if (rOutcomes.length < minimumSampleCount) status = "INCONCLUSIVE";
    else if (expectancyR === null || expectancyR <= 0) status = "NEGATIVE_NET_EXPECTANCY";
    else if (netLosses <= 0 || netWins / netLosses <= 1) status = "INCONCLUSIVE";
    else if (interval === null || baselineAccuracy === null || interval.lowerPct <= baselineAccuracy) status = "INCONCLUSIVE";
    else status = "POSITIVE_OUTCOME_EVIDENCE";
  }

  return {
    schemaVersion: 1,
    methodology: "strict-forward-non-overlapping-replay",
    instrument,
    generatedAt: now(),
    costBpsPerSide: options.costBpsPerSide,
    neutralBandBps,
    observationCount: observations.length,
    evaluatedCount: outcomes.length,
    excludedCount: observations.length - outcomes.length,
    excludedReasons,
    directionalAccuracyPct: directionalAccuracy,
    baselineAccuracyPct: baselineAccuracy,
    accuracyLiftPct: accuracyLift,
    accuracyWilson95: interval,
    targetHitPct: rOutcomes.length ? targetCount / rOutcomes.length * 100 : null,
    invalidationHitPct: rOutcomes.length ? invalidationCount / rOutcomes.length * 100 : null,
    timeExitPct: rOutcomes.length ? timeExitCount / rOutcomes.length * 100 : null,
    rEvaluatedCount: rOutcomes.length,
    expectancyR,
    profitFactor: netLosses > 0 ? netWins / netLosses : null,
    maxDrawdownR,
    averageMfeR: rOutcomes.length ? rOutcomes.reduce((sum, outcome) => sum + outcome.mfeR, 0) / rOutcomes.length : null,
    averageMaeR: rOutcomes.length ? rOutcomes.reduce((sum, outcome) => sum + outcome.maeR, 0) / rOutcomes.length : null,
    status,
    outcomes,
    limitations: [
      "This is outcome replay, not probability calibration; no probability or confidence-of-profit is produced.",
      "The baseline direction must be computed only from the prior training window recorded on each observation.",
      "Overlapping forecast horizons are excluded by default to reduce dependence between observations.",
      "If target and invalidation are both touched in one candle, invalidation is assumed first; adverse stop gaps fill at the candle open.",
      "R metrics are reported only when both observed objective and invalidation form valid geometry from the next candle open.",
      "Costs include the supplied per-side bps assumption only; funding, borrow, liquidation, market impact, and corporate actions are not modeled.",
    ],
  };
}
