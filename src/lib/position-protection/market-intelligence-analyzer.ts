/**
 * Phase 79 — Market Intelligence Analyzer
 *
 * Generates trader-facing, position-aware intelligence by combining:
 * - Live price data
 * - Technical signals from PriceObservationEngine
 * - Position context (entry, SL, TP, side)
 * - Thesis health from ProtectionEngine
 * - Evidence system
 * - Invalidation conditions
 *
 * Produces clear human-readable intelligence output.
 * Pure functions — no side effects, no network calls.
 */

import type { PositionSide, ThesisHealthState, AlertSeverity } from "./types";
import {
  type PriceObservationState,
  type MarketIntelligenceSummary,
  type TechnicalSignals,
  buildMarketIntelligence,
} from "./price-observation-engine";
import { getInstrumentInfo, formatInstrumentPrice } from "./instrument-registry";

// ═══════════════════════════════════════════════════════════════
// INTELLIGENCE TYPES
// ═══════════════════════════════════════════════════════════════

export type ConfidenceLevel = "STRONG_EVIDENCE" | "MODERATE_EVIDENCE" | "WEAK_EVIDENCE" | "INSUFFICIENT_EVIDENCE";

export type PullbackClassification =
  | "NORMAL_PULLBACK"
  | "EARLY_CORRECTION"
  | "MEANINGFUL_DETERIORATION"
  | "STRUCTURAL_REVERSAL"
  | "SHOCK_REVERSAL"
  | "INSUFFICIENT_DATA";

export interface EvidenceItem {
  category: string;
  description: string;
  direction: "supporting" | "conflicting" | "neutral";
  strength: "STRONG" | "MODERATE" | "WEAK";
}

export interface InvalidationCondition {
  description: string;
  /** Current price distance to invalidation level as %. */
  distancePct: number;
  /** Whether we are close to invalidation. */
  approaching: boolean;
}

export interface PositionIntelligence {
  /** Instrument. */
  instrument: string;
  /** Display name. */
  displayName: string;
  /** Position side. */
  side: PositionSide;
  /** Asset class. */
  assetClass: string;
  /** Current live price. */
  currentPrice: number;
  /** Entry price. */
  entryPrice: number;
  /** Stop loss. */
  stopLoss?: number;
  /** Take profit. */
  takeProfit?: number;

  // ─── Market Context ───
  /** Market state. */
  marketState: string;
  /** Short-term trend description. */
  shortTermContext: string;
  /** Medium-term context. */
  mediumTermContext: string;
  /** Volatility description. */
  volatilityContext: string;

  // ─── Position Metrics ───
  /** Current PnL %. */
  pnlPct: number;
  /** R-multiple if SL available. */
  rMultiple?: number;
  /** Distance to SL as %. */
  distanceToSL?: string;
  /** Distance to TP as %. */
  distanceToTP?: string;
  /** Giveback % if tracked. */
  givebackPct?: number;

  // ─── Thesis Health ───
  /** Thesis health state. */
  thesisHealth: ThesisHealthState;
  /** Thesis health score. */
  thesisHealthScore: number;

  // ─── Alert / Protection ───
  /** Current severity. */
  severity: AlertSeverity;
  /** Action recommendation. */
  actionRecommendation: string;

  // ─── Evidence ───
  /** Evidence items. */
  evidence: EvidenceItem[];
  /** Independent signal count. */
  independentSignalCount: number;
  /** Confidence level. */
  confidence: ConfidenceLevel;

  // ─── Pullback Classification ───
  /** How the current pullback is classified. */
  pullbackClassification: PullbackClassification;

  // ─── Invalidation ───
  /** Conditions that would invalidate the thesis. */
  invalidationConditions: InvalidationCondition[];

  // ─── What to Monitor ───
  /** What the trader should watch next. */
  nextMonitor: string[];

  // ─── Data Quality ───
  /** Data quality classification. */
  dataQuality: string;
  /** Number of price observations. */
  observationCount: number;

  // ─── Source ───
  /** Provider. */
  provider: string;
  /** Source mode. */
  sourceMode: string;
}

// ═══════════════════════════════════════════════════════════════
// POSITION CONTEXT INPUT
// ═══════════════════════════════════════════════════════════════

export interface PositionContext {
  instrument: string;
  side: PositionSide;
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
  horizon?: string;
  originalThesis?: string;
  originalContext?: {
    bias?: string;
    confidence?: string;
    keyLevels?: { support?: string; resistance?: string; invalidation?: string };
  };
}

// ═══════════════════════════════════════════════════════════════
// INTELLIGENCE GENERATION
// ═══════════════════════════════════════════════════════════════

export interface IntelligenceInput {
  position: PositionContext;
  observationState: PriceObservationState;
  thesisHealth: ThesisHealthState;
  thesisHealthScore: number;
  severity: AlertSeverity;
  actionRecommendation: string;
  givebackPct?: number;
  /** Live data source info. */
  sourceMode: string;
  provider: string;
}

export function generatePositionIntelligence(
  input: IntelligenceInput,
): PositionIntelligence {
  const { position, observationState, thesisHealth, thesisHealthScore, severity, actionRecommendation, givebackPct, sourceMode, provider } = input;

  const marketSummary = buildMarketIntelligence(observationState, position.side);
  const signals = marketSummary.signals;
  const instrumentInfo = getInstrumentInfo(position.instrument);

  // ─── PnL ───
  const isLong = position.side === "LONG";
  const pnlPct = position.entryPrice > 0
    ? ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100 * (isLong ? 1 : -1)
    : 0;

  let rMultiple: number | undefined;
  if (position.stopLoss !== undefined && position.stopLoss !== position.entryPrice) {
    const risk = Math.abs(position.entryPrice - position.stopLoss);
    const reward = isLong
      ? position.currentPrice - position.entryPrice
      : position.entryPrice - position.currentPrice;
    rMultiple = reward / risk;
  }

  const distanceToSL = position.stopLoss !== undefined
    ? `${Math.abs(((position.currentPrice - position.stopLoss) / position.entryPrice) * 100).toFixed(2)}%`
    : undefined;

  const distanceToTP = position.takeProfit !== undefined
    ? `${Math.abs(((position.takeProfit - position.currentPrice) / position.entryPrice) * 100).toFixed(2)}%`
    : undefined;

  // ─── Market Context ───
  const shortTermContext = describeTrend(signals.shortTermTrend, "short-term", position.side);
  const mediumTermContext = describeTrend(signals.mediumTermTrend, "medium-term", position.side);
  const volatilityContext = describeVolatility(signals.volatility, signals.avgVolatility);

  // ─── Evidence ───
  const evidence = buildEvidence(signals, position.side);

  // ─── Pullback Classification ───
  const pullbackClass = classifyPullback(signals, pnlPct, givebackPct);

  // ─── Invalidation Conditions ───
  const invalidation = buildInvalidationConditions(position, signals);

  // ─── Next Monitor ───
  const nextMonitor = buildNextMonitor(signals, position.side, severity, pullbackClass);

  // ─── Confidence ───
  const confidence = classifyConfidence(evidence, signals.observationCount);

  // ─── Independent Signal Count ───
  const independentSignals = new Set(
    evidence.filter((e) => e.direction === "conflicting").map((e) => e.category),
  ).size;

  return {
    instrument: position.instrument,
    displayName: instrumentInfo?.displayName ?? position.instrument,
    side: position.side,
    assetClass: instrumentInfo?.assetClass ?? "crypto",
    currentPrice: position.currentPrice,
    entryPrice: position.entryPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    marketState: marketSummary.marketState,
    shortTermContext,
    mediumTermContext,
    volatilityContext,
    pnlPct,
    rMultiple,
    distanceToSL,
    distanceToTP,
    givebackPct,
    thesisHealth,
    thesisHealthScore,
    severity,
    actionRecommendation,
    evidence,
    independentSignalCount: independentSignals,
    confidence,
    pullbackClassification: pullbackClass,
    invalidationConditions: invalidation,
    nextMonitor,
    dataQuality: marketSummary.dataQuality,
    observationCount: signals.observationCount,
    provider,
    sourceMode,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function describeTrend(
  trend: "bullish" | "bearish" | "neutral" | "unknown",
  timeframe: string,
  side: PositionSide,
): string {
  const isAligned =
    (side === "LONG" && trend === "bullish") ||
    (side === "SHORT" && trend === "bearish");
  const isOpposing =
    (side === "LONG" && trend === "bearish") ||
    (side === "SHORT" && trend === "bullish");

  if (trend === "unknown") return `${timeframe} trend: insufficient data`;
  if (isAligned) return `${timeframe} trend aligned with ${side} position`;
  if (isOpposing) return `${timeframe} trend opposing ${side} position — watch closely`;
  return `${timeframe} trend neutral`;
}

function describeVolatility(current: number, average: number): string {
  if (average <= 0) return "Volatility data insufficient";
  const ratio = current / average;
  if (ratio > 2.0) return `Volatility elevated (${ratio.toFixed(1)}x above average)`;
  if (ratio > 1.3) return `Volatility slightly above average (${ratio.toFixed(1)}x)`;
  if (ratio < 0.5) return `Volatility below average (${ratio.toFixed(1)}x)`;
  return "Volatility normal";
}

function buildEvidence(
  signals: TechnicalSignals,
  side: PositionSide,
): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const isLong = side === "LONG";

  // Trend
  if (signals.shortTermTrend !== "unknown") {
    const aligned = isLong ? signals.shortTermTrend === "bullish" : signals.shortTermTrend === "bearish";
    evidence.push({
      category: "TECHNICAL",
      description: `Short-term trend: ${signals.shortTermTrend}`,
      direction: aligned ? "supporting" : signals.shortTermTrend === "neutral" ? "neutral" : "conflicting",
      strength: "MODERATE",
    });
  }

  if (signals.mediumTermTrend !== "unknown") {
    const aligned = isLong ? signals.mediumTermTrend === "bullish" : signals.mediumTermTrend === "bearish";
    evidence.push({
      category: "TECHNICAL",
      description: `Medium-term trend: ${signals.mediumTermTrend}`,
      direction: aligned ? "supporting" : signals.mediumTermTrend === "neutral" ? "neutral" : "conflicting",
      strength: "STRONG",
    });
  }

  // Momentum
  if (signals.momentum !== 0) {
    const opposing = isLong ? signals.momentum < -0.5 : signals.momentum > 0.5;
    evidence.push({
      category: "MOMENTUM",
      description: `Momentum: ${signals.momentum > 0 ? "+" : ""}${signals.momentum.toFixed(3)}% per observation`,
      direction: opposing ? "conflicting" : "supporting",
      strength: Math.abs(signals.momentum) > 1 ? "STRONG" : "MODERATE",
    });
  }

  // Volatility
  if (signals.avgVolatility > 0) {
    const ratio = signals.volatility / signals.avgVolatility;
    if (ratio > 2.0) {
      evidence.push({
        category: "VOLATILITY",
        description: `Volatility expansion: ${ratio.toFixed(1)}x above average`,
        direction: "conflicting",
        strength: "STRONG",
      });
    } else if (ratio < 0.5) {
      evidence.push({
        category: "VOLATILITY",
        description: `Volatility compressed: ${ratio.toFixed(1)}x below average`,
        direction: "neutral",
        strength: "WEAK",
      });
    }
  }

  // Structure
  if (signals.structureBroken) {
    evidence.push({
      category: "STRUCTURE",
      description: "Market structure broken against position direction",
      direction: "conflicting",
      strength: "STRONG",
    });
  } else if (signals.observationCount >= 10) {
    evidence.push({
      category: "STRUCTURE",
      description: "Market structure intact",
      direction: "supporting",
      strength: "MODERATE",
    });
  }

  return evidence;
}

function classifyPullback(
  signals: TechnicalSignals,
  pnlPct: number,
  givebackPct?: number,
): PullbackClassification {
  if (signals.observationCount < 5) return "INSUFFICIENT_DATA";

  const hasStructureBreak = signals.structureBroken;
  const severeVolatility = signals.avgVolatility > 0 && signals.volatility / signals.avgVolatility > 2.5;
  const momentumReversal = Math.abs(signals.momentumAcceleration) > 2;

  if (hasStructureBreak && severeVolatility) return "SHOCK_REVERSAL";
  if (hasStructureBreak) return "STRUCTURAL_REVERSAL";

  if (givebackPct !== undefined) {
    if (givebackPct > 50 && signals.shortTermTrend !== "unknown") {
      const opposing = signals.shortTermTrend === "bearish";
      if (opposing) return "MEANINGFUL_DETERIORATION";
    }
  }

  if (pnlPct < -2 && momentumReversal) return "MEANINGFUL_DETERIORATION";
  if (pnlPct < 0 && signals.shortTermTrend === "neutral") return "EARLY_CORRECTION";

  return "NORMAL_PULLBACK";
}

function buildInvalidationConditions(
  position: PositionContext,
  signals: TechnicalSignals,
): InvalidationCondition[] {
  const conditions: InvalidationCondition[] = [];

  // SL hit
  if (position.stopLoss !== undefined) {
    const dist = Math.abs(((position.currentPrice - position.stopLoss) / position.entryPrice) * 100);
    conditions.push({
      description: `Stop loss at ${formatInstrumentPrice(position.instrument, position.stopLoss)}`,
      distancePct: dist,
      approaching: dist < 2,
    });
  }

  // Structure break already occurred
  if (signals.structureBroken) {
    conditions.push({
      description: "Market structure broken — reversal likely",
      distancePct: 0,
      approaching: true,
    });
  }

  // Medium-term trend opposition
  if (signals.mediumTermTrend !== "unknown") {
    const opposing = (position.side === "LONG" && signals.mediumTermTrend === "bearish") ||
                     (position.side === "SHORT" && signals.mediumTermTrend === "bullish");
    if (opposing) {
      conditions.push({
        description: "Medium-term trend has reversed against position",
        distancePct: 0,
        approaching: true,
      });
    }
  }

  return conditions;
}

function buildNextMonitor(
  signals: TechnicalSignals,
  side: PositionSide,
  severity: AlertSeverity,
  pullbackClass: PullbackClassification,
): string[] {
  const next: string[] = [];

  if (signals.observationCount < 10) {
    next.push("Collect more price observations for reliable analysis");
  }

  if (pullbackClass === "NORMAL_PULLBACK") {
    next.push("Monitor for trend continuation or further pullback");
  } else if (pullbackClass === "EARLY_CORRECTION") {
    next.push("Watch for bounce or continuation lower");
  } else if (pullbackClass === "MEANINGFUL_DETERIORATION") {
    next.push("Monitor closely — multiple signals suggest deterioration");
  } else if (pullbackClass === "STRUCTURAL_REVERSAL") {
    next.push("Thesis may need reassessment — structure has broken");
  }

  if (signals.structureBroken) {
    next.push("Wait for structure reclaim before considering thesis intact");
  }

  if (signals.volatility > signals.avgVolatility * 2 && signals.avgVolatility > 0) {
    next.push("Elevated volatility — wider stops may be needed");
  }

  if (severity === "NONE" || severity === "WATCH") {
    next.push("Continue monitoring thesis conditions");
  }

  return next;
}

function classifyConfidence(
  evidence: EvidenceItem[],
  observationCount: number,
): ConfidenceLevel {
  if (observationCount < 5) return "INSUFFICIENT_EVIDENCE";

  const strongCount = evidence.filter((e) => e.strength === "STRONG").length;
  const totalConflicting = evidence.filter((e) => e.direction === "conflicting").length;
  const totalSupporting = evidence.filter((e) => e.direction === "supporting").length;

  if (strongCount >= 2 || (strongCount >= 1 && totalConflicting >= 2)) {
    return "STRONG_EVIDENCE";
  }
  if (totalSupporting + totalConflicting >= 3) {
    return "MODERATE_EVIDENCE";
  }
  if (evidence.length >= 1) {
    return "WEAK_EVIDENCE";
  }
  return "INSUFFICIENT_EVIDENCE";
}
