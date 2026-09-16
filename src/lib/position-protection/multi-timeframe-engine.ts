/**
 * Phase 80 — Multi-Timeframe Confluence Engine
 *
 * Analyzes real OHLCV data across M5/M15/H1 timeframes to produce
 * a deterministic market structure assessment.
 *
 * Pure functions — no side effects, no network calls.
 * Higher timeframe must not be overridden by a single lower-timeframe signal.
 */

import {
  type Candle,
  normalizeCandles,
  sma,
  rsi,
  atr,
  detectSwings,
  analyzeStructure,
  type StructureState,
} from "./technical-indicators";

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME DATA
// ═══════════════════════════════════════════════════════════════

export type TimeframeKey = "M5" | "M15" | "H1" | "H4" | "D1";

export interface TimeframeData {
  timeframe: TimeframeKey;
  candles: Candle[];
  candleCount: number;
  dataQuality: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT";
}

export function createTimeframeData(
  timeframe: TimeframeKey,
  rawCandles: Candle[],
): TimeframeData {
  const candles = normalizeCandles(rawCandles);
  const count = candles.length;

  return {
    timeframe,
    candles,
    candleCount: count,
    dataQuality: count >= 30 ? "SUFFICIENT" : count >= 15 ? "LIMITED" : "INSUFFICIENT",
  };
}

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME ANALYSIS
// ═══════════════════════════════════════════════════════════════

export type TrendClassification = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";

export type MomentumClassification = "OVERBOUGHT" | "OVERSOLD" | "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNKNOWN";

export type VolatilityClassification = "EXPANDED" | "COMPRESSED" | "NORMAL" | "UNKNOWN";

export interface TimeframeAnalysis {
  timeframe: TimeframeKey;
  /** Primary trend direction. */
  trend: TrendClassification;
  /** Momentum state (RSI-based). */
  momentum: MomentumClassification;
  /** RSI value if available. */
  rsiValue: number | undefined;
  /** Volatility state. */
  volatility: VolatilityClassification;
  /** ATR value if available. */
  atrValue: number | undefined;
  /** Normalized ATR as % of price. */
  atrPct: number | undefined;
  /** Structure state from swing analysis. */
  structure: StructureState;
  /** Whether structure has broken. */
  structureBroken: boolean;
  /** Last swing high. */
  lastSwingHigh: number | undefined;
  /** Last swing low. */
  lastSwingLow: number | undefined;
  /** Price vs key moving average. */
  priceVsMA: "ABOVE" | "BELOW" | "NEAR" | "UNKNOWN";
  /** Data quality. */
  dataQuality: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT";
  /** Number of candles analyzed. */
  candleCount: number;
}

const SUFFICIENT_CANDLES = 30;

export function analyzeTimeframe(data: TimeframeData): TimeframeAnalysis {
  const { candles, timeframe, dataQuality, candleCount } = data;

  if (candles.length < 5) {
  return {
    timeframe,
    trend: "UNKNOWN",
    momentum: "UNKNOWN",
    rsiValue: undefined,
    volatility: "UNKNOWN",
    atrValue: undefined,
    atrPct: undefined,
    structure: "INSUFFICIENT_DATA",
    structureBroken: false,
    lastSwingHigh: undefined,
    lastSwingLow: undefined,
    priceVsMA: "UNKNOWN",
    dataQuality: "INSUFFICIENT",
    candleCount,
  };
}

  const closes = candles.map((c) => c.close);
  const latestPrice = closes[closes.length - 1];

  // ─── Trend (SMA crossover) ───
  const sma20 = sma(closes, Math.min(20, closes.length));
  const sma50 = sma(closes, Math.min(50, closes.length));

  let trend: TrendClassification = "NEUTRAL";
  if (sma20.length >= 1 && sma50.length >= 1) {
    const latestSMA20 = sma20[sma20.length - 1];
    const latestSMA50 = sma50[sma50.length - 1];
    if (latestPrice > latestSMA20 && latestSMA20 > latestSMA50) trend = "BULLISH";
    else if (latestPrice < latestSMA20 && latestSMA20 < latestSMA50) trend = "BEARISH";
  } else if (sma20.length >= 1) {
    const latestSMA20 = sma20[sma20.length - 1];
    if (latestPrice > latestSMA20 * 1.01) trend = "BULLISH";
    else if (latestPrice < latestSMA20 * 0.99) trend = "BEARISH";
  }

  // ─── Momentum (RSI) ───
  const rsiValues = rsi(closes, 14);
  const latestRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : undefined;

  let momentum: MomentumClassification = "NEUTRAL";
  if (latestRSI !== undefined) {
    if (latestRSI > 70) momentum = "OVERBOUGHT";
    else if (latestRSI < 30) momentum = "OVERSOLD";
    else if (latestRSI > 55) momentum = "POSITIVE";
    else if (latestRSI < 45) momentum = "NEGATIVE";
  }

  // ─── Volatility (ATR) ───
  const atrValues = atr(candles, 14);
  const latestATR = atrValues.length > 0 ? atrValues[atrValues.length - 1] : undefined;
  const atrPct = latestATR !== undefined && latestPrice > 0
    ? (latestATR / latestPrice) * 100
    : undefined;

  let volatility: VolatilityClassification = "UNKNOWN";
  if (atrValues.length >= 5) {
    const avgATR = atrValues.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, atrValues.length);
    if (latestATR !== undefined && avgATR > 0) {
      const ratio = latestATR / avgATR;
      if (ratio > 1.5) volatility = "EXPANDED";
      else if (ratio < 0.6) volatility = "COMPRESSED";
      else volatility = "NORMAL";
    }
  }

  // ─── Structure (swing analysis) ───
  const lookback = timeframe === "M5" ? 2 : timeframe === "M15" ? 2 : 3;
  const swings = detectSwings(candles, lookback);
  const structureResult = analyzeStructure(swings);

  // ─── Price vs MA ───
  let priceVsMA: "ABOVE" | "BELOW" | "NEAR" | "UNKNOWN" = "UNKNOWN";
  if (sma20.length >= 1) {
    const ma = sma20[sma20.length - 1];
    const distPct = Math.abs((latestPrice - ma) / ma) * 100;
    if (distPct < 0.5) priceVsMA = "NEAR";
    else if (latestPrice > ma) priceVsMA = "ABOVE";
    else priceVsMA = "BELOW";
  }

  return {
    timeframe,
    trend,
    momentum,
    rsiValue: latestRSI,
    volatility,
    atrValue: latestATR,
    atrPct,
    structure: structureResult.state,
    structureBroken: structureResult.structureBroken,
    lastSwingHigh: structureResult.lastSwingHigh,
    lastSwingLow: structureResult.lastSwingLow,
    priceVsMA,
    dataQuality,
    candleCount,
  };
}

// ═══════════════════════════════════════════════════════════════
// MARKET REGIME
// ═══════════════════════════════════════════════════════════════

export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "VOLATILE"
  | "BREAKOUT"
  | "BREAKDOWN"
  | "PULLBACK"
  | "RECOVERY"
  | "INSUFFICIENT_DATA";

export function classifyMarketRegime(
  analyses: TimeframeAnalysis[],
): MarketRegime {
  // Need at least one valid analysis
  const valid = analyses.filter((a) => a.dataQuality !== "INSUFFICIENT");
  if (valid.length === 0) return "INSUFFICIENT_DATA";

  // Use highest available timeframe as primary
  const h1 = valid.find((a) => a.timeframe === "H1");
  const m15 = valid.find((a) => a.timeframe === "M15");
  const m5 = valid.find((a) => a.timeframe === "M5");

  const primary = h1 ?? m15 ?? m5;
  if (!primary) return "INSUFFICIENT_DATA";

  // Volatility check
  if (primary.volatility === "EXPANDED") return "VOLATILE";

  // Breakout/breakdown detection
  if (primary.structureBroken) {
    // For LONG, structure broken downward = BREAKDOWN
    // For SHORT, structure broken upward = BREAKOUT
    // We'll let the caller determine direction — use generic
    if (primary.trend === "BEARISH") return "BREAKDOWN";
    if (primary.trend === "BULLISH") return "BREAKOUT";
  }

  // Pullback detection: primary trend one direction, lower TF pulling back
  const m15p = valid.find((a) => a.timeframe === "M15");
  if (h1 && m15p) {
    if (h1.trend === "BULLISH" && (m15p.trend === "BEARISH" || m15p.trend === "NEUTRAL")) {
      return "PULLBACK";
    }
    if (h1.trend === "BEARISH" && (m15p.trend === "BULLISH" || m15p.trend === "NEUTRAL")) {
      return "RECOVERY";
    }
  }

  // Trending
  if (primary.trend === "BULLISH") return "TRENDING_UP";
  if (primary.trend === "BEARISH") return "TRENDING_DOWN";

  return "RANGING";
}

// ═══════════════════════════════════════════════════════════════
// MTF CONFLUENCE
// ═══════════════════════════════════════════════════════════════

export interface MTFConfluence {
  /** Overall regime. */
  regime: MarketRegime;
  /** MTF description. */
  description: string;
  /** Each timeframe analysis. */
  timeframes: TimeframeAnalysis[];
  /** Overall data quality (weakest critical timeframe). */
  overallQuality: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT";
  /** Whether all timeframes agree on direction. */
  allAligned: boolean;
  /** Whether higher timeframe conflicts with lower. */
  timeframeConflict: boolean;
}

export function analyzeMTFConfluence(
  timeframeData: TimeframeData[],
): MTFConfluence {
  const analyses = timeframeData.map((d) => analyzeTimeframe(d));
  const regime = classifyMarketRegime(analyses);

  // Overall quality: SUFFICIENT only if H1 is available and sufficient
  const h1 = analyses.find((a) => a.timeframe === "H1");
  const overallQuality = h1?.dataQuality === "SUFFICIENT"
    ? "SUFFICIENT"
    : analyses.some((a) => a.dataQuality === "SUFFICIENT")
      ? "LIMITED"
      : analyses.some((a) => a.dataQuality === "LIMITED")
        ? "LIMITED"
        : "INSUFFICIENT";

  // Alignment check
  const trends = analyses
    .filter((a) => a.trend !== "UNKNOWN")
    .map((a) => a.trend);
  const allAligned = trends.length >= 2 && trends.every((t) => t === trends[0]);

  // Conflict: higher timeframe bullish but lower bearish or vice versa
  const m15c = analyses.find((a) => a.timeframe === "M15");
  let timeframeConflict = false;
  if (h1 && m15c) {
    if (h1.trend !== "UNKNOWN" && m15c.trend !== "UNKNOWN" && h1.trend !== m15c.trend) {
      timeframeConflict = true;
    }
  }

  // Build description
  const tfParts = analyses
    .filter((a) => a.dataQuality !== "INSUFFICIENT")
    .map((a) => `${a.timeframe}: ${a.trend}${a.momentum !== "UNKNOWN" ? ` / ${a.momentum}` : ""}`);
  const description = tfParts.length > 0
    ? `${regime.replace(/_/g, " ")} — ${tfParts.join("; ")}`
    : "Insufficient data for MTF analysis";

  return {
    regime,
    description,
    timeframes: analyses,
    overallQuality,
    allAligned,
    timeframeConflict,
  };
}

// ═══════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY EXPORTS
// Phase 62-66 modules depend on these interfaces
// ═══════════════════════════════════════════════════════════════

/** Legacy timeframe evidence (used by continuous-protection-controller, phase62-66 tests) */
export interface TimeframeEvidence {
  timeframe: string;
  adverseTrend: boolean;
  structureBroken: boolean;
  adverseMomentum: boolean;
  confirmationConfidence: number;
  observedAt: number;
  source: string;
}

/** Legacy aggregation result */
export interface TimeframeAggregationResult {
  level: "NO_SIGNAL" | "NOISE" | "EMERGING" | "STRUCTURAL" | "CONFIRMED";
  adverseCount: number;
  htfConfirmation: boolean;
  totalEvidence?: number;
  totalEvaluated: number;
  highestAdverseTimeframe: string | null;
  htfAdverseCount?: number;
  ltfAdverseCount?: number;
  avgConfidence?: number;
  aggregatedConfidence: number;
  description: string;
  timeframeResults: TimeframeEvidence[];
}

const TF_ORDER = ["M5", "M15", "H1", "H4", "D1"];

function tfRank(tf: string): number {
  const idx = TF_ORDER.indexOf(tf.toUpperCase());
  return idx >= 0 ? idx : 0;
}

/** Classify individual timeframe severity (legacy) */
export function classifyTimeframeSeverity(
  evidence: TimeframeEvidence,
): "LOW" | "MEDIUM" | "HIGH" {
  let severity = 0;
  if (evidence.adverseTrend) severity += 30;
  if (evidence.structureBroken) severity += 40;
  if (evidence.adverseMomentum) severity += 20;
  severity += evidence.confirmationConfidence * 0.1;
  if (severity >= 70) return "HIGH";
  if (severity >= 40) return "MEDIUM";
  return "LOW";
}

/** Aggregate timeframe evidence (legacy) */
export function aggregateTimeframeEvidence(
  evidences: TimeframeEvidence[],
): TimeframeAggregationResult {
  if (evidences.length === 0) {
    return {
      level: "NO_SIGNAL",
      adverseCount: 0,
      htfConfirmation: false,
      totalEvidence: 0,
      totalEvaluated: 0,
      highestAdverseTimeframe: null,
      htfAdverseCount: 0,
      ltfAdverseCount: 0,
      avgConfidence: 0,
      aggregatedConfidence: 0,
      description: "No evidence available",
      timeframeResults: [],
    };
  }

  let htfCount = 0;
  let ltfCount = 0;
  let htfAdverse = 0;
  let ltfAdverse = 0;
  let totalConf = 0;
  let hasHTFBroken = false;
  let hasLTFBroken = false;

  for (const e of evidences) {
    const rank = tfRank(e.timeframe);
    totalConf += e.confirmationConfidence;
    if (rank >= 2) {
      // H1, H4, D1
      htfCount++;
      if (e.adverseTrend || e.structureBroken) htfAdverse++;
      if (e.structureBroken) hasHTFBroken = true;
    } else {
      ltfCount++;
      if (e.adverseTrend || e.structureBroken) ltfAdverse++;
      if (e.structureBroken) hasLTFBroken = true;
    }
  }

  const adverseCount = evidences.filter((e) => e.adverseTrend || e.structureBroken || e.adverseMomentum).length;
  const htfConfirmation = htfAdverse >= 1 && ltfAdverse >= 1;
  const avgConfidence = totalConf / evidences.length;

  let level: TimeframeAggregationResult["level"];
  if (hasHTFBroken && htfAdverse >= 1) {
    level = "STRUCTURAL";
  } else if (adverseCount >= 3) {
    level = "STRUCTURAL";
  } else if (htfConfirmation || adverseCount >= 2) {
    level = "EMERGING";
  } else if (adverseCount === 1) {
    level = "NOISE";
  } else {
    level = "NO_SIGNAL";
  }

  // CONFIRMED requires structural with strong multi-TF confirmation (3+ adverse)
  if (level === "STRUCTURAL" && adverseCount >= 3 && htfAdverse >= 2) {
    level = "CONFIRMED";
  }

  // Find highest adverse timeframe
  let highestAdverse: string | null = null;
  let highestRank = -1;
  for (const e of evidences) {
    if ((e.adverseTrend || e.structureBroken) && tfRank(e.timeframe) > highestRank) {
      highestRank = tfRank(e.timeframe);
      highestAdverse = e.timeframe;
    }
  }

  return {
    level,
    adverseCount,
    htfConfirmation,
    totalEvidence: evidences.length,
    totalEvaluated: evidences.length,
    highestAdverseTimeframe: highestAdverse,
    htfAdverseCount: htfAdverse,
    ltfAdverseCount: ltfAdverse,
    avgConfidence,
    aggregatedConfidence: avgConfidence,
    description: `${level} — ${adverseCount} adverse signals across ${evidences.length} timeframes`,
    timeframeResults: evidences,
  };
}

/** Convert an event to TimeframeEvidence (legacy) */
export function eventToTimeframeEvidence(
  eventType: string,
  timeframe: string | undefined,
  payload: Record<string, any> | undefined,
  source: string,
  observedAt: number,
): TimeframeEvidence | null {
  const tf = timeframe ?? "M15";

  // Only convert events that carry timeframe-specific evidence
  if (eventType === "MARKET_STRUCTURE_CHANGE" && timeframe) {
    return {
      timeframe: tf,
      adverseTrend: payload?.adverseTrend ?? false,
      structureBroken: payload?.broken ?? false,
      adverseMomentum: false,
      confirmationConfidence: payload?.confirmationConfidence ?? 50,
      observedAt,
      source,
    };
  }

  // Non-timeframe events or events without explicit timeframe return null
  return null;
}
