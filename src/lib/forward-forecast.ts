/**
 * Phase 46 — STRUCTURAL FORWARD FORECAST CONTRACT.
 *
 * Emits explicit, conditional trader and investor horizons from observed
 * market data and already validated engine levels. This is a structural
 * scenario projection, NOT a statistically calibrated prediction model.
 *
 * No probabilities, synthetic levels, valuation estimates, or order authority.
 */

import type { AnalysisResult } from "@/types/analysis";

export type ForecastDirection = "bullish" | "bearish" | "neutral";
export type ForecastStatus = "CONDITIONAL" | "UNAVAILABLE" | "BLOCKED_DATA_QUALITY";

export interface ForecastHorizon {
  label: string;
  startsAt: number;
  endsAt: number;
  basis: string;
}

export interface ForecastLevel {
  price: number;
  source: string;
  meaning: string;
}

export interface TraderForwardForecast {
  status: ForecastStatus;
  direction: ForecastDirection;
  horizon: ForecastHorizon;
  entry?: ForecastLevel;
  objective?: ForecastLevel;
  invalidation?: ForecastLevel;
  rewardRisk?: number;
  calibration: "UNVALIDATED";
  dataAsOf?: number;
  evidence: string[];
  limitations: string[];
}

export interface InvestorForwardForecast {
  status: ForecastStatus;
  direction: ForecastDirection;
  horizon: ForecastHorizon;
  objective?: ForecastLevel;
  invalidation?: ForecastLevel;
  /** Structural distance ratio only; never a valuation or expected-return estimate. */
  structuralUpsideDownsideRatio?: number;
  valuationStatus: "NOT_AVAILABLE";
  calibration: "UNVALIDATED";
  dataAsOf?: number;
  evidence: string[];
  limitations: string[];
}

export interface ForwardForecastContext {
  generatedAt: number;
  trader: TraderForwardForecast;
  investor: InvestorForwardForecast;
}

const BAR_MS: Record<string, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
  W1: 604_800_000,
};

const DAY_MS = 86_400_000;

function positive(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().toUpperCase() === "N/A") return undefined;
  const normalized = value.replace(/,/g, "").replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function validLevel(value: unknown, spot: number, relation: "above" | "below"): number | undefined {
  const parsed = positive(value);
  if (parsed === undefined || parsed === spot) return undefined;
  if (relation === "above" && parsed <= spot) return undefined;
  if (relation === "below" && parsed >= spot) return undefined;
  return parsed;
}

function dataStatus(result: AnalysisResult): ForecastStatus | undefined {
  const status = result.dataQualityContext?.primaryData.status;
  if (status && status !== "GOOD") return "BLOCKED_DATA_QUALITY";
  if (result.dataCompleteness === "limited") return "BLOCKED_DATA_QUALITY";
  return undefined;
}

function marketSnapshot(result: AnalysisResult): { price: number; timestamp: number } | undefined {
  const candle = result.candles?.[result.candles.length - 1];
  const price = positive(result.priceSnapshot?.price) ?? positive(candle?.close);
  const timestamp = result.priceSnapshot?.timestamp ?? candle?.timestamp;
  if (price === undefined || typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return { price, timestamp };
}

function traderHorizon(result: AnalysisResult, asOf: number): ForecastHorizon {
  const barMs = BAR_MS[result.timeframe] ?? BAR_MS.H1;
  const bars = result.tradingStyle === "scalping" ? 12 : result.tradingStyle === "swing" ? 20 : 24;
  return {
    label: `${bars} bars · ${result.timeframe}`,
    startsAt: asOf,
    endsAt: asOf + barMs * bars,
    basis: "Fixed bar-count convention for the selected trading style; not a calibrated time-to-target estimate.",
  };
}

function investorHorizon(result: AnalysisResult, asOf: number): ForecastHorizon {
  const weekly = result.technicalData?.htfContext?.timeframe === "W1" || result.timeframe === "W1";
  const duration = weekly ? 26 * 7 * DAY_MS : 90 * DAY_MS;
  const label = weekly ? "26 weeks · structural cycle" : "3 months · structural thesis";
  return {
    label,
    startsAt: asOf,
    endsAt: asOf + duration,
    basis: "Explicit research horizon convention; not an empirically calibrated forecast window.",
  };
}

function traderForecast(result: AnalysisResult, snapshot: { price: number; timestamp: number } | undefined): TraderForwardForecast {
  const horizon = traderHorizon(result, snapshot?.timestamp ?? result.timestamp);
  const blocked = dataStatus(result);
  const plan = result.tradePlan ?? result.projectedTradePlan;
  const direction: ForecastDirection = plan?.direction ?? (result.bias === "Bullish" ? "bullish" : result.bias === "Bearish" ? "bearish" : "neutral");
  const evidence: string[] = [];
  const limitations = [
    "Structural scenario only; predictive accuracy and profitability have not been calibrated.",
    "A conditional or projected setup is not an order. Re-run all execution, freshness, and risk gates before any trade.",
  ];

  if (blocked) return { status: blocked, direction, horizon, calibration: "UNVALIDATED", dataAsOf: snapshot?.timestamp, evidence, limitations: [...limitations, "Primary data quality is not GOOD; numeric forecast levels are suppressed."] };
  if (!snapshot) return { status: "UNAVAILABLE", direction: "neutral", horizon, calibration: "UNVALIDATED", evidence, limitations: [...limitations, "A valid spot price and source timestamp are required."] };

  if (plan) {
    const entry = positive(plan.entry);
    const stop = positive(plan.stopLoss);
    const target = positive(plan.takeProfit);
    if (entry !== undefined && stop !== undefined && target !== undefined &&
      (plan.direction === "long" ? stop < entry && target > entry : target < entry && stop > entry)) {
      const risk = plan.direction === "long" ? entry - stop : stop - entry;
      const reward = plan.direction === "long" ? target - entry : entry - target;
      const rewardRisk = reward / risk;
      if (Number.isFinite(rewardRisk) && rewardRisk > 0) {
        evidence.push("Entry, stop, and objective are copied from the engine's existing market-derived plan.");
        return {
          status: "CONDITIONAL",
          direction,
          horizon,
          entry: { price: entry, source: result.tradePlan ? "tradePlan" : "projectedTradePlan", meaning: result.tradePlan ? "Engine-approved entry level" : "Watch-only candidate entry; not executable" },
          objective: { price: target, source: result.tradePlan ? "tradePlan.tpBasis" : "projectedTradePlan.tpBasis", meaning: plan.tpBasis },
          invalidation: { price: stop, source: result.tradePlan ? "tradePlan.slBasis" : "projectedTradePlan.slBasis", meaning: plan.slBasis },
          rewardRisk,
          calibration: "UNVALIDATED",
          dataAsOf: snapshot.timestamp,
          evidence,
          limitations,
        };
      }
    }
    limitations.push("The supplied plan geometry is malformed or directionally inconsistent; no numeric trade levels are published.");
  }

  const targetRelation = direction === "bullish" ? "above" : "below";
  const invalidationRelation = direction === "bullish" ? "below" : "above";
  const objectivePrice = direction === "neutral" ? undefined : validLevel(
    direction === "bullish" ? result.keyLevels?.resistance : result.keyLevels?.support,
    snapshot.price,
    targetRelation,
  );
  const invalidationPrice = direction === "neutral" ? undefined : validLevel(
    result.keyLevels?.invalidation ?? (direction === "bullish" ? result.keyLevels?.support : result.keyLevels?.resistance),
    snapshot.price,
    invalidationRelation,
  );
  if (direction !== "neutral" && objectivePrice !== undefined) evidence.push("Objective is an observed structural key level, not a guaranteed target.");
  if (direction !== "neutral" && invalidationPrice !== undefined) evidence.push("Invalidation is an observed structural key level.");
  return {
    status: direction !== "neutral" && objectivePrice !== undefined ? "CONDITIONAL" : "UNAVAILABLE",
    direction,
    horizon,
    objective: objectivePrice === undefined ? undefined : { price: objectivePrice, source: "keyLevels", meaning: "Nearest observed structural objective" },
    invalidation: invalidationPrice === undefined ? undefined : { price: invalidationPrice, source: "keyLevels", meaning: "Observed structural invalidation" },
    calibration: "UNVALIDATED",
    dataAsOf: snapshot.timestamp,
    evidence,
    limitations: [...limitations, ...(objectivePrice === undefined ? ["No directionally valid objective level is available."] : [])],
  };
}

function investorForecast(result: AnalysisResult, snapshot: { price: number; timestamp: number } | undefined): InvestorForwardForecast {
  const horizon = investorHorizon(result, snapshot?.timestamp ?? result.timestamp);
  const blocked = dataStatus(result);
  const structure = result.technicalData?.htfContext ?? result.technicalData?.smc?.internalExternal.external;
  const direction: ForecastDirection = result.htfAlignment?.htfStructure === "HH/HL" || structure?.structure === "HH/HL"
    ? "bullish"
    : result.htfAlignment?.htfStructure === "LH/LL" || structure?.structure === "LH/LL"
      ? "bearish"
      : "neutral";
  const evidence: string[] = [];
  const limitations = [
    "This is a higher-timeframe structural thesis, not a calibrated long-term price prediction.",
    "No fair value, discounted-cash-flow estimate, or fundamental price target is available from this contract.",
    "Spot structural levels do not model leverage, funding, borrow, liquidation, dividends, or corporate actions.",
  ];
  if (blocked) return { status: blocked, direction, horizon, valuationStatus: "NOT_AVAILABLE", calibration: "UNVALIDATED", dataAsOf: snapshot?.timestamp, evidence, limitations: [...limitations, "Primary data quality is not GOOD; numeric forecast levels are suppressed."] };
  if (!snapshot) return { status: "UNAVAILABLE", direction: "neutral", horizon, valuationStatus: "NOT_AVAILABLE", calibration: "UNVALIDATED", evidence, limitations: [...limitations, "A valid spot price and source timestamp are required."] };

  const high = direction === "bullish" ? validLevel(structure?.lastSwingHigh, snapshot.price, "above") : undefined;
  const low = direction === "bearish" ? validLevel(structure?.lastSwingLow, snapshot.price, "below") : undefined;
  const downside = direction === "bullish" ? validLevel(structure?.lastSwingLow, snapshot.price, "below") : undefined;
  const upside = direction === "bearish" ? validLevel(structure?.lastSwingHigh, snapshot.price, "above") : undefined;
  const objective = high ?? low;
  const invalidation = downside ?? upside;
  let ratio: number | undefined;
  if (objective !== undefined && invalidation !== undefined) {
    const reward = Math.abs(objective - snapshot.price);
    const risk = Math.abs(snapshot.price - invalidation);
    if (reward > 0 && risk > 0) ratio = reward / risk;
  }
  if (objective !== undefined) evidence.push("Objective comes from the actual higher-timeframe external swing structure.");
  if (invalidation !== undefined) evidence.push("Downside/invalidation comes from the actual opposing higher-timeframe swing structure.");
  if (direction === "neutral") limitations.push("Higher-timeframe structure is neutral or unavailable; no directional investment thesis is issued.");
  if (objective === undefined) limitations.push("No valid higher-timeframe swing objective beyond current price is available.");
  return {
    status: direction !== "neutral" && objective !== undefined ? "CONDITIONAL" : "UNAVAILABLE",
    direction,
    horizon,
    objective: objective === undefined ? undefined : { price: objective, source: "higher-timeframe external swing", meaning: "Observed structural objective; not fair value" },
    invalidation: invalidation === undefined ? undefined : { price: invalidation, source: "higher-timeframe external swing", meaning: "Observed structural downside/invalidation" },
    structuralUpsideDownsideRatio: ratio,
    valuationStatus: "NOT_AVAILABLE",
    calibration: "UNVALIDATED",
    dataAsOf: snapshot.timestamp,
    evidence,
    limitations,
  };
}

export function buildForwardForecast(result: AnalysisResult): ForwardForecastContext {
  const snapshot = marketSnapshot(result);
  return {
    generatedAt: result.timestamp,
    trader: traderForecast(result, snapshot),
    investor: investorForecast(result, snapshot),
  };
}
