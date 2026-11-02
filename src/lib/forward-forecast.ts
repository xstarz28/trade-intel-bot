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
import type { TimeframeStructureContext } from "@/lib/data/market-types";
import { buildInvestorFundamentalOutlook, type InvestorFundamentalOutlook, type InvestorValuationStatus } from "@/lib/investor-fundamental-outlook";

export type ForecastDirection = "bullish" | "bearish" | "neutral";
export type ForecastStatus = "CONDITIONAL" | "UNAVAILABLE" | "BLOCKED_DATA_QUALITY";

/** Explicit investor planning horizon; independent of the chart timeframe. */
export type InvestorForecastHorizon =
  | "1-4_WEEKS"
  | "1-3_MONTHS"
  | "3-6_MONTHS"
  | "6-12_MONTHS"
  | "1-3_YEARS"
  | "3+_YEARS";

export interface ForecastHorizon {
  label: string;
  startsAt: number;
  endsAt: number;
  basis: string;
  /** MINIMUM marks an open-ended horizon such as 3+ years. */
  endBoundary?: "UPPER" | "MINIMUM";
}

export interface ForecastLevel {
  price: number;
  source: string;
  meaning: string;
}

export interface AlternateForecastScenario {
  direction: "bullish" | "bearish";
  status: "CONDITIONAL" | "UNAVAILABLE";
  objective?: ForecastLevel;
  invalidation?: ForecastLevel;
  condition: string;
}

export interface TraderForwardForecast {
  status: ForecastStatus;
  direction: ForecastDirection;
  horizon: ForecastHorizon;
  alternateScenarios?: AlternateForecastScenario[];
  entry?: ForecastLevel;
  objective?: ForecastLevel;
  invalidation?: ForecastLevel;
  rewardRisk?: number;
  calibration: "UNVALIDATED";
  dataAsOf?: number;
  evidence: string[];
  limitations: string[];
}

export interface InvestorAccumulationZone {
  lower: number;
  upper: number;
  timeframe: string;
  source: "validated_bullish_order_block";
  createdAt: number;
  evidence: string[];
}

export interface InvestorForwardForecast {
  status: ForecastStatus;
  direction: ForecastDirection;
  horizon: ForecastHorizon;
  alternateScenarios?: AlternateForecastScenario[];
  /** Current spot used as a transparent investment comparison reference, not an order. */
  entry?: ForecastLevel;
  /** Nearest observed support reference; not a guaranteed fill or accumulation zone. */
  accumulationReference?: ForecastLevel;
  /** Higher-timeframe bullish order block with validated displacement and structure break. */
  accumulationZone?: InvestorAccumulationZone;
  objective?: ForecastLevel;
  invalidation?: ForecastLevel;
  /** Price-distance ratio from the spot reference to objective versus invalidation. */
  structuralUpsideDownsideRatio?: number;
  potentialUpsidePct?: number;
  potentialDownsidePct?: number;
  potentialUpsideDownsideRatio?: number;
  valuationStatus: InvestorValuationStatus;
  fundamentalOutlook: InvestorFundamentalOutlook;
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
  const snapshotPrice = positive(result.priceSnapshot?.price);
  const price = snapshotPrice ?? positive(candle?.close);
  const timestamp = snapshotPrice !== undefined ? result.priceSnapshot?.timestamp : candle?.timestamp;
  if (price === undefined || typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  if (Number.isFinite(result.timestamp) && timestamp > result.timestamp) return undefined;
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

const TIMEFRAME_RANK: Record<string, number> = {
  M1: 1, M5: 2, M15: 3, H1: 4, H4: 5, D1: 6, W1: 7,
};

/**
 * Resolve the actual higher-timeframe external structure. Adaptive MTF is
 * authoritative when present; legacy HTF context is accepted only when it
 * is strictly above the analyzed timeframe. Primary-timeframe SMC is never
 * relabeled as long-term investment structure.
 */
function investorStructureContext(result: AnalysisResult): TimeframeStructureContext | undefined {
  const technical = result.technicalData;
  const primaryRank = TIMEFRAME_RANK[result.timeframe] ?? 0;

  if (technical?.mtf) {
    const htfTimeframe = technical.mtf.htfTimeframe;
    if (!htfTimeframe || (TIMEFRAME_RANK[htfTimeframe] ?? 0) <= primaryRank) return undefined;
    const slot = technical.mtf.timeframes.find((item) =>
      item.timeframe === htfTimeframe &&
      item.available &&
      (item.role === "macro" || item.role === "structure"),
    );
    const external = slot?.smc?.internalExternal?.external;
    if (
      !external ||
      external.timeframe !== htfTimeframe ||
      !Number.isFinite(external.dataPoints) ||
      external.dataPoints < 20
    ) return undefined;
    return external;
  }

  const legacy = technical?.htfContext;
  if (
    !legacy ||
    (TIMEFRAME_RANK[legacy.timeframe] ?? 0) <= primaryRank ||
    !Number.isFinite(legacy.dataPoints) ||
    legacy.dataPoints < 20
  ) return undefined;
  return legacy;
}


function investorHorizon(asOf: number, requested: InvestorForecastHorizon = "1-3_YEARS"): ForecastHorizon {
  const windows: Record<InvestorForecastHorizon, {
    label: string;
    duration: number;
    endBoundary: "UPPER" | "MINIMUM";
    basis: string;
  }> = {
    "1-4_WEEKS": {
      label: "1–4 weeks · short-term investment thesis",
      duration: 28 * DAY_MS,
      endBoundary: "UPPER",
      basis: "Four-week upper boundary of the selected 1–4 week planning window; not a calibrated time-to-target estimate.",
    },
    "1-3_MONTHS": {
      label: "1–3 months · tactical investment thesis",
      duration: 90 * DAY_MS,
      endBoundary: "UPPER",
      basis: "Approximate three-month upper boundary of the selected 1–3 month planning window; not a calibrated time-to-target estimate.",
    },
    "3-6_MONTHS": {
      label: "3–6 months · medium-term investment thesis",
      duration: 183 * DAY_MS,
      endBoundary: "UPPER",
      basis: "Approximate six-month upper boundary of the selected 3–6 month planning window; not a calibrated time-to-target estimate.",
    },
    "6-12_MONTHS": {
      label: "6–12 months · annual investment thesis",
      duration: 365 * DAY_MS,
      endBoundary: "UPPER",
      basis: "One-year upper boundary of the selected 6–12 month planning window; not a calibrated time-to-target estimate.",
    },
    "1-3_YEARS": {
      label: "1–3 years · long-term investment thesis",
      duration: 3 * 365 * DAY_MS,
      endBoundary: "UPPER",
      basis: "Three-year upper boundary of the selected 1–3 year planning window; not a calibrated price forecast.",
    },
    "3+_YEARS": {
      label: "3+ years · strategic investment thesis",
      duration: 3 * 365 * DAY_MS,
      endBoundary: "MINIMUM",
      basis: "Three-year minimum boundary of an open-ended 3+ year planning horizon; the thesis has no fixed upper date and is not a calibrated price forecast.",
    },
  };
  const window = windows[requested];
  return {
    label: window.label,
    startsAt: asOf,
    endsAt: asOf + window.duration,
    endBoundary: window.endBoundary,
    basis: window.basis,
  };
}

function investorAccumulationZone(result: AnalysisResult, spot: number): InvestorAccumulationZone | undefined {
  const primaryRank = TIMEFRAME_RANK[result.timeframe] ?? 0;
  const candidates = (result.technicalData?.mtf?.timeframes ?? [])
    .filter((item) =>
      item.available &&
      (item.role === "macro" || item.role === "structure") &&
      (TIMEFRAME_RANK[item.timeframe] ?? 0) > primaryRank &&
      item.smc,
    )
    .flatMap((item) => (item.smc?.orderBlocks ?? []).flatMap((block) => {
      if (
        block.direction !== "bullish" ||
        block.status !== "fresh" ||
        !block.evidence.precedingOpposingCandle ||
        !block.evidence.displacementAfter ||
        !block.evidence.structuralBreakAfter ||
        !Number.isFinite(block.lower) ||
        !Number.isFinite(block.upper) ||
        block.lower <= 0 ||
        block.upper <= block.lower ||
        block.lower >= spot
      ) return [];
      return [{
        lower: block.lower,
        upper: block.upper,
        timeframe: item.timeframe,
        source: "validated_bullish_order_block" as const,
        createdAt: block.createdAt,
        evidence: [
          "Fresh bullish order block from an available higher timeframe.",
          "Preceding opposing candle, subsequent displacement, and structural break are all verified.",
        ],
      }];
    }));
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) =>
    (TIMEFRAME_RANK[b.timeframe] ?? 0) - (TIMEFRAME_RANK[a.timeframe] ?? 0) ||
    Math.max(0, spot - a.upper) - Math.max(0, spot - b.upper),
  )[0];
}

function alternateScenarios(
  primary: ForecastDirection,
  spot: number,
  upsideLevel: number | undefined,
  downsideLevel: number | undefined,
  source: string,
  context: "trader" | "investor",
): AlternateForecastScenario[] {
  const directions: Array<"bullish" | "bearish"> = primary === "bullish"
    ? ["bearish"]
    : primary === "bearish"
      ? ["bullish"]
      : ["bullish", "bearish"];
  return directions.flatMap((direction) => {
    const objective = direction === "bullish" ? upsideLevel : downsideLevel;
    const invalidation = direction === "bullish" ? downsideLevel : upsideLevel;
    if (objective === undefined) return [];
    return [{
      direction,
      status: "CONDITIONAL" as const,
      objective: { price: objective, source, meaning: "Observed opposing structural objective" },
      invalidation: invalidation === undefined ? undefined : { price: invalidation, source, meaning: "Observed opposing structural invalidation" },
      condition: context === "trader"
        ? direction === "bullish" ? "Bullish breakout and retest scenario if the primary path fails." : "Bearish breakdown and retest scenario if the primary path fails."
        : direction === "bullish" ? "Bullish higher-timeframe recovery scenario." : "Bearish higher-timeframe deterioration scenario.",
    }];
  });
}

function traderForecast(result: AnalysisResult, snapshot: { price: number; timestamp: number } | undefined): TraderForwardForecast {
  const horizon = traderHorizon(result, snapshot?.timestamp ?? result.timestamp);
  const blocked = dataStatus(result);
  const plan = result.tradePlan ?? result.projectedTradePlan;
  const direction: ForecastDirection = plan
    ? plan.direction === "long" ? "bullish" : "bearish"
    : result.bias === "Bullish" ? "bullish" : result.bias === "Bearish" ? "bearish" : "neutral";
  const evidence: string[] = [];
  const limitations = [
    "Structural scenario only; predictive accuracy and profitability have not been calibrated.",
    "A conditional or projected setup is not an order. Re-run all execution, freshness, and risk gates before any trade.",
  ];

  if (blocked) return { status: blocked, direction, horizon, calibration: "UNVALIDATED", dataAsOf: snapshot?.timestamp, evidence, limitations: [...limitations, "Primary data quality is not GOOD; numeric forecast levels are suppressed."] };
  if (!snapshot) return { status: "UNAVAILABLE", direction: "neutral", horizon, calibration: "UNVALIDATED", evidence, limitations: [...limitations, "A valid spot price and source timestamp are required."] };

  const traderUp = snapshot ? validLevel(result.keyLevels?.resistance, snapshot.price, "above") : undefined;
  const traderDown = snapshot ? validLevel(result.keyLevels?.support, snapshot.price, "below") : undefined;
  const alternate = snapshot ? alternateScenarios(direction, snapshot.price, traderUp, traderDown, "keyLevels", "trader") : [];

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
          alternateScenarios: alternate,
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
  const invalidationPrice = direction === "neutral" ? undefined : (
    validLevel(result.keyLevels?.invalidation, snapshot.price, invalidationRelation) ??
    validLevel(direction === "bullish" ? result.keyLevels?.support : result.keyLevels?.resistance, snapshot.price, invalidationRelation)
  );
  if (direction !== "neutral" && objectivePrice !== undefined) evidence.push("Objective is an observed structural key level, not a guaranteed target.");
  if (direction !== "neutral" && invalidationPrice !== undefined) evidence.push("Invalidation is an observed structural key level.");
  return {
    status: direction !== "neutral" && objectivePrice !== undefined ? "CONDITIONAL" : "UNAVAILABLE",
    direction,
    horizon,
    alternateScenarios: alternate,
    objective: objectivePrice === undefined ? undefined : { price: objectivePrice, source: "keyLevels", meaning: "Nearest observed structural objective" },
    invalidation: invalidationPrice === undefined ? undefined : { price: invalidationPrice, source: "keyLevels", meaning: "Observed structural invalidation" },
    calibration: "UNVALIDATED",
    dataAsOf: snapshot.timestamp,
    evidence,
    limitations: [...limitations, ...(objectivePrice === undefined ? ["No directionally valid objective level is available."] : [])],
  };
}

function investorForecast(
  result: AnalysisResult,
  snapshot: { price: number; timestamp: number } | undefined,
  requestedHorizon: InvestorForecastHorizon = "1-3_YEARS",
): InvestorForwardForecast {
  const horizon = investorHorizon(snapshot?.timestamp ?? result.timestamp, requestedHorizon);
  const blocked = dataStatus(result);
  const fundamentalOutlook = buildInvestorFundamentalOutlook(result, blocked ? undefined : snapshot?.price);
  const structure = investorStructureContext(result);
  const direction: ForecastDirection = structure?.structure === "HH/HL"
    ? "bullish"
    : structure?.structure === "LH/LL"
      ? "bearish"
      : "neutral";
  const evidence: string[] = [];
  const limitations = [
    "This is a higher-timeframe structural thesis, not a calibrated long-term price prediction.",
    "Spot structural levels do not model leverage, funding, borrow, liquidation, dividends, or corporate actions.",
  ];
  if (blocked) return { status: blocked, direction, horizon, valuationStatus: fundamentalOutlook.valuationStatus, fundamentalOutlook, calibration: "UNVALIDATED", dataAsOf: snapshot?.timestamp, evidence, limitations: [...limitations, "Primary data quality is not GOOD; numeric forecast levels are suppressed."] };
  if (!snapshot) return { status: "UNAVAILABLE", direction: "neutral", horizon, valuationStatus: fundamentalOutlook.valuationStatus, fundamentalOutlook, calibration: "UNVALIDATED", evidence, limitations: [...limitations, "A valid spot price and source timestamp are required."] };

  const htfUp = validLevel(structure?.lastSwingHigh, snapshot.price, "above");
  const htfDown = validLevel(structure?.lastSwingLow, snapshot.price, "below");
  const alternate = alternateScenarios(direction, snapshot.price, htfUp, htfDown, "higher-timeframe external swing", "investor");
  const high = direction === "bullish" ? htfUp : undefined;
  const low = direction === "bearish" ? validLevel(structure?.lastSwingLow, snapshot.price, "below") : undefined;
  const downside = direction === "bullish" ? validLevel(structure?.lastSwingLow, snapshot.price, "below") : undefined;
  const upside = direction === "bearish" ? validLevel(structure?.lastSwingHigh, snapshot.price, "above") : undefined;
  const structuralObjective = high ?? low;
  const valuationPrice = fundamentalOutlook.valuationReference?.price;
  const valuationObjective = direction === "bullish"
    ? validLevel(valuationPrice, snapshot.price, "above")
    : direction === "bearish"
      ? validLevel(valuationPrice, snapshot.price, "below")
      : undefined;
  const objective = valuationObjective ?? structuralObjective;
  const invalidation = downside ?? upside;
  // Signed objective return preserves bearish downside as a negative value.
  // The invalidation distance remains an absolute adverse-move measure.
  const potentialUpsidePct = objective === undefined ? undefined : (objective / snapshot.price - 1) * 100;
  const potentialDownsidePct = invalidation === undefined ? undefined : Math.abs((invalidation / snapshot.price - 1) * 100);
  let structuralRatio: number | undefined;
  if (structuralObjective !== undefined && invalidation !== undefined) {
    const structuralReward = Math.abs(structuralObjective - snapshot.price);
    const structuralRisk = Math.abs(snapshot.price - invalidation);
    if (structuralReward > 0 && structuralRisk > 0) structuralRatio = structuralReward / structuralRisk;
  }
  const potentialRatio = potentialUpsidePct !== undefined && potentialDownsidePct !== undefined && potentialDownsidePct > 0
    ? Math.abs(potentialUpsidePct) / potentialDownsidePct
    : undefined;
  if (valuationObjective !== undefined) evidence.push("Directional objective uses a fresh, exact-instrument provider valuation reference; its source type remains explicit.");
  else if (structuralObjective !== undefined) evidence.push("Objective comes from the actual higher-timeframe external swing structure.");
  if (invalidation !== undefined) evidence.push("Downside/invalidation comes from the actual opposing higher-timeframe swing structure.");
  if (direction === "neutral") limitations.push("Higher-timeframe structure is neutral or unavailable; no directional investment thesis is issued.");
  if (objective === undefined) limitations.push("No valid higher-timeframe swing objective beyond current price is available.");
  return {
    status: direction !== "neutral" && objective !== undefined ? "CONDITIONAL" : "UNAVAILABLE",
    direction,
    horizon,
    alternateScenarios: alternate,
    entry: direction === "bullish" ? { price: snapshot.price, source: "verified spot snapshot", meaning: "Current-price comparison reference only; not an instruction to buy" } : undefined,
    accumulationReference: direction === "bullish" && downside !== undefined
      ? { price: downside, source: "higher-timeframe external swing low", meaning: "Observed support reference; not a guaranteed accumulation fill" }
      : undefined,
    accumulationZone: direction === "bullish" ? investorAccumulationZone(result, snapshot.price) : undefined,
    objective: objective === undefined ? undefined : {
      price: objective,
      source: valuationObjective !== undefined ? fundamentalOutlook.valuationReference!.kind : "higher-timeframe external swing",
      meaning: valuationObjective !== undefined ? fundamentalOutlook.valuationReference!.description : "Observed structural objective; not fair value",
    },
    invalidation: invalidation === undefined ? undefined : { price: invalidation, source: "higher-timeframe external swing", meaning: "Observed structural downside/invalidation" },
    structuralUpsideDownsideRatio: structuralRatio,
    potentialUpsidePct,
    potentialDownsidePct,
    potentialUpsideDownsideRatio: potentialRatio,
    valuationStatus: fundamentalOutlook.valuationStatus,
    fundamentalOutlook,
    calibration: "UNVALIDATED",
    dataAsOf: snapshot.timestamp,
    evidence,
    limitations,
  };
}

export function buildForwardForecast(
  result: AnalysisResult,
  options: { investorHorizon?: InvestorForecastHorizon } = {},
): ForwardForecastContext {
  const snapshot = marketSnapshot(result);
  return {
    generatedAt: result.timestamp,
    trader: traderForecast(result, snapshot),
    investor: investorForecast(result, snapshot, options.investorHorizon),
  };
}
