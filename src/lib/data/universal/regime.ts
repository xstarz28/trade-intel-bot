/**
 * Phase 55 — Deterministic Regime Detection
 *
 * Classifies market regime from available observations.
 * Every regime classification has explainable supporting evidence.
 * No LLM intuition — purely data-driven classification.
 *
 * CRITICAL:
 *   - Pure functions — no side effects, no network calls.
 *   - No regime data is invented.
 *   - UNKNOWN is a valid and common state.
 *   - Regime is informational — not a trading signal.
 */

import type { MarketRegime, VolatilityRegime, TrendRegime } from "./analytical-context";

// ═══════════════════════════════════════════════════════════════
// REGIME INPUTS
// ═══════════════════════════════════════════════════════════════

export interface RegimeObservation {
  /** Price change percentage over observation window. */
  priceChangePct?: number;
  /** Volatility measure (e.g. ATR or realized vol). */
  volatility?: number;
  /** Historical average volatility for comparison. */
  avgVolatility?: number;
  /** Whether a breakout/breakdown is occurring. */
  breakout?: boolean;
  /** Whether the market is making higher highs/lows. */
  higherHighsLows?: boolean;
  /** Whether the market is making lower highs/lows. */
  lowerHighsLows?: boolean;
  /** VIX or equivalent fear gauge value. */
  fearGauge?: number;
  /** Whether there are active risk-on assets moving up. */
  riskOnAssets?: boolean;
  /** Whether safe-haven assets are strengthening. */
  safeHavenBid?: boolean;
}

export interface RegimeClassification {
  regime: MarketRegime;
  volatilityRegime: VolatilityRegime;
  trendRegime: TrendRegime;
  /** Supporting evidence for this classification. */
  supportingEvidence: string[];
  /** Confidence in this classification (0-100). NOT probability of profit. */
  classificationConfidence: number;
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION ENGINE
// ═══════════════════════════════════════════════════════════════

export function classifyRegime(observation: RegimeObservation): RegimeClassification {
  const evidence: string[] = [];
  let confidence = 0;

  // Volatility regime
  const volRegime = classifyVolatility(observation, evidence);

  // Trend regime
  const trendRegime = classifyTrend(observation, evidence);

  // Composite regime
  const regime = classifyComposite(observation, volRegime, trendRegime, evidence);

  // Confidence assessment
  const dataPoints = [
    observation.priceChangePct !== undefined,
    observation.volatility !== undefined,
    observation.fearGauge !== undefined,
    observation.higherHighsLows !== undefined || observation.lowerHighsLows !== undefined,
    observation.riskOnAssets !== undefined,
    observation.safeHavenBid !== undefined,
  ].filter(Boolean).length;

  confidence = Math.min(100, dataPoints * 20);

  return {
    regime,
    volatilityRegime: volRegime,
    trendRegime,
    supportingEvidence: evidence,
    classificationConfidence: confidence,
  };
}

// ═══════════════════════════════════════════════════════════════
// VOLATILITY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyVolatility(obs: RegimeObservation, evidence: string[]): VolatilityRegime {
  // If we have both current and average volatility, compare
  if (obs.volatility !== undefined && obs.avgVolatility !== undefined && obs.avgVolatility > 0) {
    const ratio = obs.volatility / obs.avgVolatility;
    if (ratio > 1.5) {
      evidence.push(`Volatility ${ratio.toFixed(1)}x above average — HIGH volatility regime.`);
      return "HIGH";
    }
    if (ratio < 0.6) {
      evidence.push(`Volatility ${ratio.toFixed(1)}x below average — LOW volatility regime.`);
      return "LOW";
    }
    evidence.push(`Volatility near average (${ratio.toFixed(1)}x) — NORMAL regime.`);
    return "NORMAL";
  }

  // Fear gauge as proxy
  if (obs.fearGauge !== undefined) {
    if (obs.fearGauge > 30) {
      evidence.push(`Fear gauge elevated (${obs.fearGauge.toFixed(0)}) — HIGH volatility regime.`);
      return "HIGH";
    }
    if (obs.fearGauge < 15) {
      evidence.push(`Fear gauge suppressed (${obs.fearGauge.toFixed(0)}) — LOW volatility regime.`);
      return "LOW";
    }
    evidence.push(`Fear gauge moderate (${obs.fearGauge.toFixed(0)}) — NORMAL regime.`);
    return "NORMAL";
  }

  return "UNKNOWN";
}

// ═══════════════════════════════════════════════════════════════
// TREND CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyTrend(obs: RegimeObservation, evidence: string[]): TrendRegime {
  let bullishSignals = 0;
  let bearishSignals = 0;

  if (obs.higherHighsLows) {
    bullishSignals++;
    evidence.push("Higher highs/lows structure — bullish trend signal.");
  }
  if (obs.lowerHighsLows) {
    bearishSignals++;
    evidence.push("Lower highs/lows structure — bearish trend signal.");
  }
  if (obs.priceChangePct !== undefined) {
    if (obs.priceChangePct > 2) {
      bullishSignals++;
      evidence.push(`Strong positive price change (+${obs.priceChangePct.toFixed(1)}%) — bullish momentum.`);
    } else if (obs.priceChangePct < -2) {
      bearishSignals++;
      evidence.push(`Strong negative price change (${obs.priceChangePct.toFixed(1)}%) — bearish momentum.`);
    } else {
      evidence.push(`Price change ${obs.priceChangePct.toFixed(1)}% — neutral.`);
    }
  }

  if (bullishSignals > bearishSignals) return "BULLISH";
  if (bearishSignals > bullishSignals) return "BEARISH";
  return "NEUTRAL";
}

// ═══════════════════════════════════════════════════════════════
// COMPOSITE REGIME
// ═══════════════════════════════════════════════════════════════

function classifyComposite(
  obs: RegimeObservation,
  vol: VolatilityRegime,
  trend: TrendRegime,
  evidence: string[],
): MarketRegime {
  // Risk-on / risk-off from asset behavior
  if (obs.riskOnAssets && obs.safeHavenBid === false) {
    evidence.push("Risk-on assets rallying, safe havens weak — RISK_ON regime.");
    return "RISK_ON";
  }
  if (obs.safeHavenBid && obs.riskOnAssets === false) {
    evidence.push("Safe havens bid, risk assets weak — RISK_OFF regime.");
    return "RISK_OFF";
  }

  // Breakout regime
  if (obs.breakout) {
    evidence.push("Breakout detected — TRENDING regime.");
    return "TRENDING";
  }

  // High volatility
  if (vol === "HIGH") {
    if (obs.priceChangePct !== undefined && Math.abs(obs.priceChangePct) > 5) {
      evidence.push("High volatility with large price move — HIGH_VOLATILITY regime.");
      return "HIGH_VOLATILITY";
    }
    // Transitioning
    evidence.push("High volatility without clear direction — TRANSITION regime.");
    return "TRANSITION";
  }

  // Low volatility
  if (vol === "LOW") {
    evidence.push("Low volatility — RANGING regime.");
    return "RANGING";
  }

  // Trend-based
  if (trend === "BULLISH" || trend === "BEARISH") {
    evidence.push(`${trend.toLowerCase()} trend with normal volatility — TRENDING regime.`);
    return "TRENDING";
  }

  // Insufficient data
  if (vol === "UNKNOWN" && trend === "UNKNOWN") {
    evidence.push("Insufficient data for regime classification — UNKNOWN.");
    return "UNKNOWN";
  }

  evidence.push("No clear regime signal — RANGING (default for neutral trend + normal vol).");
  return "RANGING";
}

// ═══════════════════════════════════════════════════════════════
// CROSS-ASSET REGIME AGGREGATION
// ═══════════════════════════════════════════════════════════════

export function aggregateRegimes(regimes: RegimeClassification[]): {
  aggregateRegime: MarketRegime;
  aggregateVolatility: VolatilityRegime;
  confidence: number;
  evidence: string[];
} {
  if (regimes.length === 0) {
    return {
      aggregateRegime: "UNKNOWN",
      aggregateVolatility: "UNKNOWN",
      confidence: 0,
      evidence: ["No regime observations available."],
    };
  }

  // Count regime votes
  const regimeCounts = new Map<MarketRegime, number>();
  const volCounts = new Map<VolatilityRegime, number>();
  const allEvidence: string[] = [];

  for (const r of regimes) {
    regimeCounts.set(r.regime, (regimeCounts.get(r.regime) ?? 0) + 1);
    volCounts.set(r.volatilityRegime, (volCounts.get(r.volatilityRegime) ?? 0) + 1);
    allEvidence.push(...r.supportingEvidence);
  }

  // Most common regime
  let aggregateRegime: MarketRegime = "UNKNOWN";
  let maxCount = 0;
  for (const [regime, count] of regimeCounts) {
    if (count > maxCount) {
      maxCount = count;
      aggregateRegime = regime;
    }
  }

  // Most common volatility
  let aggregateVolatility: VolatilityRegime = "UNKNOWN";
  let maxVolCount = 0;
  for (const [vol, count] of volCounts) {
    if (count > maxVolCount) {
      maxVolCount = count;
      aggregateVolatility = vol;
    }
  }

  // Confidence from average
  const avgConfidence = regimes.reduce((s, r) => s + r.classificationConfidence, 0) / regimes.length;

  // Agreement bonus
  const agreement = maxCount / regimes.length;
  const confidence = Math.min(100, Math.round(avgConfidence * (0.5 + 0.5 * agreement)));

  return {
    aggregateRegime,
    aggregateVolatility,
    confidence,
    evidence: allEvidence.slice(0, 10), // Limit to prevent explosion
  };
}
