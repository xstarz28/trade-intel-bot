/**
 * Phase 57 — Thesis Health Engine
 *
 * Deterministic thesis-health model that evaluates whether the original
 * trade thesis remains supported by current market evidence.
 *
 * Pure functions — no side effects, no network calls.
 * Provider availability NEVER becomes directional evidence.
 */

import type {
  PositionContext,
  ThesisHealthScore,
  ThesisHealthState,
  DeteriorationSignal,
} from "./types";

// ═══════════════════════════════════════════════════════════════
// MARKET EVIDENCE INPUT
// ═══════════════════════════════════════════════════════════════

export interface MarketEvidence {
  /** Current price. */
  price: number;
  /**
   * Phase 163 — when this evidence was actually observed (unix ms).
   *
   * Without it, every derived signal was stamped with Date.now() and
   * labelled FRESH, so hours-old evidence produced signals that claimed to
   * be live. Supply it whenever the observation time is known; when it is
   * omitted the signal freshness is reported as UNKNOWN rather than
   * asserted to be FRESH.
   */
  observedAt?: number;
  /** 24h price change %. */
  change24h?: number;
  /** Volatility (ATR or similar). */
  volatility?: number;
  /** Average volatility for comparison. */
  avgVolatility?: number;

  // Technical
  /** Short-term trend: bullish/bearish/neutral. */
  shortTermTrend?: "bullish" | "bearish" | "neutral" | "unknown";
  /** Medium-term trend. */
  mediumTermTrend?: "bullish" | "bearish" | "neutral" | "unknown";
  /** Long-term trend. */
  longTermTrend?: "bullish" | "bearish" | "neutral" | "unknown";
  /** Momentum change (positive = improving, negative = deteriorating). */
  momentumChange?: number;
  /** Whether structure has broken (BOS/CHoCH). */
  structureBroken?: boolean;

  // Derivatives (crypto)
  /** Funding rate. */
  fundingRate?: number;
  /** Funding rate change. */
  fundingChange?: number;
  /** Open interest change %. */
  oiChange?: number;
  /** Liquidation volume spike. */
  liquidationSpike?: boolean;
  /** Long/short ratio. */
  longShortRatio?: number;

  // Fundamentals (equity)
  /** Earnings surprise change. */
  earningsSurpriseChange?: number;
  /** Guidance change. */
  guidanceChange?: "positive" | "negative" | "unchanged";
  /** Valuation regime change. */
  valuationRegimeChange?: string;

  // Commodity
  /** Inventory surprise. */
  inventorySurprise?: number;
  /** Futures structure change. */
  futuresStructureChange?: string;

  // Forex
  /** Rate differential change. */
  rateDiffChange?: number;
  /** Yield differential change. */
  yieldDiffChange?: number;
  /** DXY trend. */
  dxyTrend?: "rising" | "falling" | "stable" | "unknown";

  // Macro / cross-asset
  /** VIX level. */
  vix?: number;
  /** VIX change. */
  vixChange?: number;
  /** Risk regime. */
  riskRegime?: "risk_on" | "risk_off" | "transition" | "unknown";
  /** Risk regime changed recently. */
  riskRegimeChanged?: boolean;
  /** Major event approaching within hours. */
  eventApproaching?: boolean;
  /** Event name. */
  eventName?: string;

  // Cross-asset
  /** Correlated asset divergence detected. */
  correlatedDivergence?: boolean;
  /** Correlated asset name. */
  correlatedAsset?: string;
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE FRESHNESS (Phase 163)
// ═══════════════════════════════════════════════════════════════

/**
 * Observation time of the evidence a signal was derived from.
 *
 * Falls back to "now" only when the caller supplied no observation time —
 * in that case `evidenceFreshness` reports UNKNOWN so the uncertainty is
 * visible rather than hidden behind a FRESH label.
 */
function evidenceObservedAt(evidence: MarketEvidence, now: number): number {
  return evidence.observedAt ?? now;
}

/**
 * Derive a signal's freshness from when its evidence was actually observed.
 *
 * A monitoring alert must never claim to be based on live data when the
 * underlying observation is hours old.
 */
function evidenceFreshness(
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal["freshness"] {
  if (evidence.observedAt === undefined) return "UNAVAILABLE";

  const ageMs = now - evidence.observedAt;
  // Future-dated evidence cannot be verified as live.
  if (ageMs < -60_000) return "UNAVAILABLE";
  if (ageMs < 5 * 60_000) return "FRESH";
  if (ageMs < 60 * 60_000) return "DELAYED";
  if (ageMs < 24 * 60 * 60_000) return "STALE";
  return "UNAVAILABLE";
}

/**
 * Freshness for inherently periodic evidence (earnings, inventories, COT).
 *
 * This data is published on a schedule and is never "live" in the tick
 * sense, so it is capped at STALE — but it still degrades to UNAVAILABLE
 * once genuinely too old to rely on.
 */
function periodicEvidenceFreshness(
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal["freshness"] {
  const derived = evidenceFreshness(evidence, now);
  return derived === "UNAVAILABLE" ? "UNAVAILABLE" : "STALE";
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL GENERATORS
// ═══════════════════════════════════════════════════════════════

function assessTechnicalDeterioration(
  position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];
  const isLong = position.side === "LONG";

  // Structure break
  if (evidence.structureBroken === true) {
    signals.push({
      category: "TECHNICAL",
      name: "structure_break",
      description: "Market structure has broken against position direction.",
      severity: 80,
      source: "price_action",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "TECHNICAL_STRUCTURE",
    });
  }

  // Short-term trend reversal
  const shortTrend = evidence.shortTermTrend ?? "unknown";
  const opposingShortTrend = isLong ? "bearish" : "bullish";
  if (shortTrend === opposingShortTrend) {
    signals.push({
      category: "TECHNICAL",
      name: "short_term_trend_reversal",
      description: `Short-term trend is ${shortTrend}, opposing ${position.side} position.`,
      severity: 50,
      source: "price_action",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "TECHNICAL_TREND",
    });
  }

  // Medium-term trend weakening
  const medTrend = evidence.mediumTermTrend ?? "unknown";
  if (medTrend === opposingShortTrend) {
    signals.push({
      category: "TECHNICAL",
      name: "medium_term_trend_reversal",
      description: `Medium-term trend is ${medTrend}, opposing ${position.side} position.`,
      severity: 70,
      source: "price_action",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "TECHNICAL_TREND",
    });
  }

  // Multi-timeframe disagreement (short bearish but medium still bullish = mild)
  if (shortTrend === opposingShortTrend && medTrend !== opposingShortTrend) {
    signals.push({
      category: "TECHNICAL",
      name: "timeframe_disagreement",
      description: "Short-term opposing medium-term — likely correction, not reversal.",
      severity: 25,
      source: "price_action",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "TECHNICAL_STRUCTURE",
    });
  }

  return signals;
}

function assessMomentumDeterioration(
  position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];
  const isLong = position.side === "LONG";

  // Momentum change
  if (evidence.momentumChange !== undefined) {
    const opposing = isLong ? evidence.momentumChange < -15 : evidence.momentumChange > 15;
    if (opposing) {
      signals.push({
        category: "MOMENTUM",
        name: "momentum_deterioration",
        description: `Momentum changed ${evidence.momentumChange > 0 ? "+" : ""}${evidence.momentumChange.toFixed(1)} — against position direction.`,
        severity: 60,
        source: "momentum",
        observedAt: evidenceObservedAt(evidence, now),
        freshness: evidenceFreshness(evidence, now),
        dependencyGroup: "MOMENTUM",
      });
    }
  }

  return signals;
}

function assessVolatilityShock(
  _position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];

  if (evidence.volatility !== undefined && evidence.avgVolatility !== undefined && evidence.avgVolatility > 0) {
    const ratio = evidence.volatility / evidence.avgVolatility;
    if (ratio > 2.0) {
      signals.push({
        category: "VOLATILITY",
        name: "volatility_expansion",
        description: `Volatility ${ratio.toFixed(1)}x above average — elevated risk.`,
        severity: 55,
        source: "volatility",
        observedAt: evidenceObservedAt(evidence, now),
        freshness: evidenceFreshness(evidence, now),
        dependencyGroup: "VOLATILITY",
      });
    }
  }

  return signals;
}

function assessDerivativesDeterioration(
  position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];
  if (position.assetClass !== "crypto") return signals;

  const isLong = position.side === "LONG";

  // Funding rate shock
  if (evidence.fundingRate !== undefined) {
    const extremeFunding = isLong
      ? evidence.fundingRate < -0.001 // extreme negative = shorts paying longs = bearish pressure
      : evidence.fundingRate > 0.001;
    if (extremeFunding) {
      signals.push({
        category: "DERIVATIVES",
        name: "funding_shock",
        description: `Funding rate at ${(evidence.fundingRate * 100).toFixed(3)}% — unusual.`,
        severity: 55,
        source: "CoinGlass",
        observedAt: evidenceObservedAt(evidence, now),
        freshness: evidenceFreshness(evidence, now),
        dependencyGroup: "DERIVATIVES_FUNDING",
      });
    }
  }

  // OI shock
  if (evidence.oiChange !== undefined && Math.abs(evidence.oiChange) > 15) {
    signals.push({
      category: "DERIVATIVES",
      name: "oi_shock",
      description: `Open interest changed ${evidence.oiChange > 0 ? "+" : ""}${evidence.oiChange.toFixed(1)}%.`,
      severity: 50,
      source: "CoinGlass",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "DERIVATIVES_OI",
    });
  }

  // Liquidation spike
  if (evidence.liquidationSpike === true) {
    signals.push({
      category: "DERIVATIVES",
      name: "liquidation_spike",
      description: "Abnormal liquidation volume detected.",
      severity: 65,
      source: "CoinGlass",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "DERIVATIVES_LIQUIDATION",
    });
  }

  return signals;
}

function assessFundamentalDeterioration(
  _position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];

  if (evidence.earningsSurpriseChange !== undefined && evidence.earningsSurpriseChange < -5) {
    signals.push({
      category: "FUNDAMENTAL",
      name: "earnings_deterioration",
      description: `Earnings surprise deteriorated by ${evidence.earningsSurpriseChange.toFixed(1)}%.`,
      severity: 70,
      source: "fundamentals",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: periodicEvidenceFreshness(evidence, now),
      dependencyGroup: "EQUITY_EARNINGS",
    });
  }

  if (evidence.guidanceChange === "negative") {
    signals.push({
      category: "FUNDAMENTAL",
      name: "guidance_negative",
      description: "Company issued negative guidance update.",
      severity: 75,
      source: "fundamentals",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: periodicEvidenceFreshness(evidence, now),
      dependencyGroup: "EQUITY_EARNINGS",
    });
  }

  return signals;
}

function assessMacroDeterioration(
  position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];
  const isLong = position.side === "LONG";

  // Risk regime shift
  if (evidence.riskRegimeChanged === true && evidence.riskRegime === "risk_off" && isLong) {
    signals.push({
      category: "MACRO",
      name: "risk_regime_shift",
      description: "Risk regime shifted to RISK_OFF — opposing long positions.",
      severity: 65,
      source: "macro",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "MACRO_RISK_REGIME",
    });
  }

  // VIX spike
  if (evidence.vix !== undefined && evidence.vix > 30) {
    signals.push({
      category: "MACRO",
      name: "vix_elevated",
      description: `VIX at ${evidence.vix.toFixed(1)} — elevated fear.`,
      severity: 50,
      source: "VIX",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "MACRO_VOLATILITY",
    });
  }

  return signals;
}

function assessCrossAssetDeterioration(
  _position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];

  if (evidence.correlatedDivergence === true) {
    signals.push({
      category: "CROSS_ASSET",
      name: "correlated_divergence",
      description: `Correlated asset ${evidence.correlatedAsset ?? "unknown"} diverging.`,
      severity: 45,
      source: "cross_asset",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "CROSS_ASSET_CORRELATION",
    });
  }

  return signals;
}

function assessEventRisk(
  _position: PositionContext,
  evidence: MarketEvidence,
  now: number,
): DeteriorationSignal[] {
  const signals: DeteriorationSignal[] = [];

  if (evidence.eventApproaching === true) {
    signals.push({
      category: "EVENT_RISK",
      name: "event_approaching",
      description: `High-impact event approaching: ${evidence.eventName ?? "unknown"}.`,
      severity: 35,
      source: "calendar",
      observedAt: evidenceObservedAt(evidence, now),
      freshness: evidenceFreshness(evidence, now),
      dependencyGroup: "MACRO_EVENT",
    });
  }

  return signals;
}

// ═══════════════════════════════════════════════════════════════
// CONFIRMING SIGNALS
// ═══════════════════════════════════════════════════════════════

function assessConfirmingSignals(
  position: PositionContext,
  evidence: MarketEvidence,
): string[] {
  const confirming: string[] = [];
  const isLong = position.side === "LONG";
  const desiredTrend = isLong ? "bullish" : "bearish";

  if (evidence.shortTermTrend === desiredTrend) {
    confirming.push("Short-term trend aligned");
  }
  if (evidence.mediumTermTrend === desiredTrend) {
    confirming.push("Medium-term trend aligned");
  }
  if (evidence.longTermTrend === desiredTrend) {
    confirming.push("Long-term trend aligned");
  }
  if (evidence.structureBroken === false || evidence.structureBroken === undefined) {
    confirming.push("Market structure intact");
  }
  if (evidence.riskRegime === "risk_on" && isLong) {
    confirming.push("Risk regime supportive");
  }
  if (evidence.riskRegime === "risk_off" && !isLong) {
    confirming.push("Risk regime supportive for short");
  }

  return confirming;
}

// ═══════════════════════════════════════════════════════════════
// MAIN THESIS HEALTH EVALUATOR
// ═══════════════════════════════════════════════════════════════

export function evaluateThesisHealth(
  position: PositionContext,
  evidence: MarketEvidence,
  now: number = Date.now(),
): ThesisHealthScore {
  // Gather all deterioration signals. Each signal's freshness is derived
  // from when its evidence was actually observed, never assumed live.
  const allSignals: DeteriorationSignal[] = [
    ...assessTechnicalDeterioration(position, evidence, now),
    ...assessMomentumDeterioration(position, evidence, now),
    ...assessVolatilityShock(position, evidence, now),
    ...assessDerivativesDeterioration(position, evidence, now),
    ...assessFundamentalDeterioration(position, evidence, now),
    ...assessMacroDeterioration(position, evidence, now),
    ...assessCrossAssetDeterioration(position, evidence, now),
    ...assessEventRisk(position, evidence, now),
  ];

  // Gather confirming signals
  const confirming = assessConfirmingSignals(position, evidence);

  // Missing data points
  const missing: string[] = [];
  if (evidence.shortTermTrend === undefined) missing.push("short-term trend");
  if (evidence.mediumTermTrend === undefined) missing.push("medium-term trend");
  if (evidence.volatility === undefined) missing.push("volatility data");
  if (evidence.momentumChange === undefined) missing.push("momentum data");
  if (evidence.riskRegime === undefined) missing.push("risk regime");

  // Score: start at 100, subtract for deterioration, add for confirmation
  let score = 100;
  for (const sig of allSignals) {
    score -= sig.severity * 0.5; // each signal reduces health
  }
  for (const _c of confirming) {
    score += 5; // each confirming signal adds health
  }
  score = Math.max(0, Math.min(100, score));

  // Classify state
  let state: ThesisHealthState;
  const hasInvalidation = allSignals.some(s => s.severity >= 80);
  const severeCount = allSignals.filter(s => s.severity >= 60).length;

  if (hasInvalidation && confirming.length === 0) {
    state = "INVALIDATED";
  } else if (severeCount >= 2 || score < 30) {
    state = "SEVERELY_DETERIORATING";
  } else if (allSignals.length >= 2 || score < 60) {
    state = "DETERIORATING";
  } else if (allSignals.length === 0 && confirming.length >= 2) {
    state = "HEALTHY";
  } else if (allSignals.length <= 1) {
    state = "STABLE";
  } else {
    state = "UNKNOWN";
  }

  return {
    state,
    score,
    deteriorationCount: allSignals.length,
    confirmingCount: confirming.length,
    missingDataPoints: missing,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXTRACT ALL SIGNALS (for alert building)
// ═══════════════════════════════════════════════════════════════

export function extractAllSignals(
  position: PositionContext,
  evidence: MarketEvidence,
  now: number = Date.now(),
): { deterioration: DeteriorationSignal[]; confirming: string[] } {
  return {
    deterioration: [
      ...assessTechnicalDeterioration(position, evidence, now),
      ...assessMomentumDeterioration(position, evidence, now),
      ...assessVolatilityShock(position, evidence, now),
      ...assessDerivativesDeterioration(position, evidence, now),
      ...assessFundamentalDeterioration(position, evidence, now),
      ...assessMacroDeterioration(position, evidence, now),
      ...assessCrossAssetDeterioration(position, evidence, now),
      ...assessEventRisk(position, evidence, now),
    ],
    confirming: assessConfirmingSignals(position, evidence),
  };
}
