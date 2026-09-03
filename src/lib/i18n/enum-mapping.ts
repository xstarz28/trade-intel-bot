/**
 * Enum-to-translation mapping functions for intelligence UI display.
 *
 * These functions map raw internal enum values to translated user-facing labels.
 * The internal enum values remain unchanged — only the display representation changes.
 *
 * IMPORTANT: Unknown/future enum values always produce a safe fallback,
 * never undefined, blank, or crash.
 */

import type { Translations } from "./types";

// ─── Stance Mapping ─────────────────────────────────────────

/** Map news/fundamental stance enum to translated display label. */
export function mapStance(
  stance: string,
  t: Translations,
): string {
  switch (stance) {
    case "SUPPORTING": return t.intelligence.stanceSupporting;
    case "CONFLICTING": return t.intelligence.stanceConflicting;
    case "MIXED": return t.intelligence.stanceMixed;
    case "NEUTRAL": return t.intelligence.stanceNeutral;
    case "INSUFFICIENT": return t.intelligence.stanceInsufficient;
    default: return stance;
  }
}

// ─── Position Impact Mapping ────────────────────────────────

/** Map position impact enum to translated display label. */
export function mapPositionImpact(
  impact: string,
  t: Translations,
): string {
  switch (impact) {
    case "SUPPORTING": return t.intelligence.impactSupporting;
    case "CONFLICTING": return t.intelligence.impactConflicting;
    case "NEUTRAL": return t.intelligence.impactNeutral;
    case "INSUFFICIENT": return t.intelligence.impactInsufficient;
    default: return impact;
  }
}

// ─── Evidence Direction Mapping ──────────────────────────────

/** Map evidence direction enum to translated display label. */
export function mapDirection(
  direction: string,
  t: Translations,
): string {
  switch (direction) {
    case "SUPPORTING": return t.intelligence.impactSupporting;
    case "CONFLICTING": return t.intelligence.impactConflicting;
    case "NEUTRAL": return t.intelligence.impactNeutral;
    default: return direction;
  }
}

// ─── Relevance Mapping ──────────────────────────────────────

/** Map relevance level enum to translated display label. */
export function mapRelevance(
  relevance: string,
  t: Translations,
): string {
  switch (relevance) {
    case "DIRECT": return t.intelligence.relevanceDirect;
    case "HIGH": return t.intelligence.relevanceHigh;
    case "MODERATE": return t.intelligence.relevanceModerate;
    case "LOW": return t.intelligence.relevanceLow;
    case "IRRELEVANT": return t.intelligence.relevanceIrrelevant;
    case "UNKNOWN": return t.intelligence.relevanceUnknown;
    default: return relevance;
  }
}

// ─── Availability Mapping ───────────────────────────────────

/** Map data availability enum to translated display label. */
export function mapAvailability(
  availability: string,
  t: Translations,
): string {
  switch (availability) {
    case "AVAILABLE": return t.status.available;
    case "LIMITED": return t.status.limited;
    case "INSUFFICIENT": return t.status.insufficient;
    case "STALE": return t.status.dataStale;
    case "UNAVAILABLE": return t.status.unavailable;
    default: return availability;
  }
}

// ─── Portfolio Coverage Mapping (Phase 143) ──────────────────

/** Map portfolio intelligence coverage to a translated display label. */
export function mapCoverage(
  coverage: string,
  t: Translations,
): string {
  switch (coverage) {
    case "FULL": return t.status.available;
    case "PARTIAL": return t.status.limited;
    case "EMPTY": return t.status.unavailable;
    default: return coverage.replace(/_/g, " ");
  }
}

// ─── Short Count Display ────────────────────────────────────

/** Get a short localized count display for supporting/conflicting. */
export function mapSupportingCount(
  count: number,
  t: Translations,
): string {
  return `${count} ${t.intelligence.supporting}`;
}

/** Get a short localized count display for conflicting. */
export function mapConflictingCount(
  count: number,
  t: Translations,
): string {
  return `${count} ${t.intelligence.conflicting}`;
}

// ─── Thesis Health Mapping ──────────────────────────────────

/** Map thesis health enum to translated display label. */
export function mapThesisHealth(
  thesisHealth: string,
  t: Translations,
): string {
  switch (thesisHealth) {
    case "HEALTHY": return t.status.healthy;
    case "STABLE": return t.status.stable;
    case "CAUTION": return t.status.caution;
    case "DETERIORATING": return t.status.deteriorating;
    case "SEVERELY_DETERIORATING": return t.status.severelyDeteriorating;
    case "INVALIDATED": return t.status.invalidated;
    case "INSUFFICIENT_DATA": return t.status.insufficientData;
    case "UNKNOWN": return t.status.unknown;
    default: return thesisHealth.replace(/_/g, " ");
  }
}

// ─── Trend Mapping ───────────────────────────────────────────

/** Map MTF/timeframe trend classification to translated display label. */
export function mapTrendLabel(
  trend: string,
  t: Translations,
): string {
  switch (trend) {
    case "BULLISH": return t.analysis.bullish;
    case "BEARISH": return t.analysis.bearish;
    case "NEUTRAL": return t.intelligence.neutral;
    case "UNKNOWN": return t.status.unknown;
    default: return trend.replace(/_/g, " ");
  }
}

// ─── Protection Severity Mapping ─────────────────────────────

/** Map protection severity enum to translated display label. */
export function mapSeverity(
  severity: string,
  t: Translations,
): string {
  switch (severity) {
    case "NONE": return t.status.none;
    case "WATCH": return t.status.watch;
    case "CAUTION": return t.status.caution;
    case "HIGH_RISK": return t.status.highRisk;
    case "INVALIDATED": return t.status.invalidated;
    default: return severity.replace(/_/g, " ");
  }
}

// ─── Investor Risk Level Mapping ─────────────────────────────

/** Map portfolio risk-level label to translated display label. */
export function mapRiskLevel(
  level: string,
  t: Translations,
): string {
  switch (level) {
    case "LOW": return t.investor.low;
    case "MODERATE": return t.investor.moderate;
    case "ELEVATED": return t.investor.elevated;
    default: return level;
  }
}

// ─── Horizon Mapping ─────────────────────────────────────────

/** Map investment-horizon enum to translated display label. */
export function mapHorizon(
  horizon: string,
  t: Translations,
): string {
  switch (horizon) {
    case "SCALPING": return t.investor.horizonScalping;
    case "INTRADAY": return t.investor.horizonIntraday;
    case "SWING": return t.investor.horizonSwing;
    case "INVESTING": return t.investor.horizonInvesting;
    default: return horizon.replace(/_/g, " ");
  }
}

// ─── Confidence Mapping ─────────────────────────────────────

/** Map confidence level enum to translated display label. */
export function mapConfidence(
  confidence: string,
  t: Translations,
): string {
  switch (confidence) {
    case "STRONG_EVIDENCE": return t.intelligence.confidenceStrong;
    case "MODERATE_EVIDENCE": return t.intelligence.confidenceModerate;
    case "WEAK_EVIDENCE": return t.intelligence.confidenceWeak;
    case "INSUFFICIENT_EVIDENCE": return t.intelligence.confidenceInsufficient;
    default: return confidence.replace(/_/g, " ");
  }
}

// ─── Dimension Mapping ──────────────────────────────────────

/** Map dimension name enum to translated display label. */
export function mapDimension(
  dimension: string,
  t: Translations,
): string {
  switch (dimension) {
    case "TECHNICAL": return t.intelligence.technical;
    case "MACRO": return t.intelligence.macro;
    case "CROSS_ASSET": return t.intelligence.crossAsset;
    case "DERIVATIVES": return t.intelligence.derivatives;
    case "NEWS": return t.intelligence.news;
    case "FUNDAMENTALS": return t.intelligence.fundamentals;
    default: return dimension;
  }
}

// ─── Macro Regime Mapping ───────────────────────────────────

/** Map macro regime value to translated display label. */
export function mapRegimeValue(
  value: string,
  t: Translations,
): string {
  switch (value) {
    case "EASING": return t.fundamental.easing;
    case "NEUTRAL": return t.intelligence.neutral;
    case "TIGHTENING": return t.fundamental.tightening;
    case "RESTRICTIVE": return t.fundamental.restrictive;
    case "TRANSITIONING": return t.fundamental.transitioning;
    case "RISING": return t.fundamental.rising;
    case "FALLING": return t.fundamental.falling;
    case "STABLE": return t.fundamental.stable;
    case "STRENGTHENING": return t.fundamental.strengthening;
    case "WEAKENING": return t.fundamental.weakening;
    case "VOLATILE": return t.fundamental.volatile;
    case "EXPANDING": return t.fundamental.expanding;
    case "SLOWING": return t.fundamental.slowing;
    case "CONTRACTING": return t.fundamental.contracting;
    case "RECOVERING": return t.fundamental.recovering;
    case "BALANCED": return t.fundamental.balanced;
    case "SUPPLY_DISRUPTION": return t.fundamental.supplyDisruption;
    case "DEMAND_DRIVEN": return t.fundamental.demandDriven;
    case "OIL_SHOCK": return t.fundamental.oilShock;
    case "ESCALATING": return t.fundamental.escalating;
    case "DEESCALATING": return t.fundamental.deescalating;
    case "STRESSED": return t.macro.stressed;
    case "RISK_ON": return t.macro.riskOn;
    case "RISK_OFF": return t.macro.riskOff;
    case "MIXED": return t.macro.mixed;
    case "STAGFLATION": return t.macro.stagflation;
    case "REFLATION": return t.macro.reflation;
    case "DISINFLATION": return t.macro.disinflation;
    case "CONTRACTION": return t.macro.contraction;
    case "RECOVERY": return t.macro.recovery;
    default: return value.replace(/_/g, " ");
  }
}

// ─── Runtime Health Component Mapping ───────────────────────

/** Map runtime health component name to translated display label. */
export function mapComponentName(
  component: string,
  t: Translations,
): string {
  switch (component) {
    case "MARKET_DATA": return t.system.componentsMarketData;
    case "OHLCV": return t.system.componentsOhlcv;
    case "NEWS": return t.system.componentsNews;
    case "MACRO": return t.system.componentsMacro;
    case "CROSS_ASSET": return t.system.componentsCrossAsset;
    case "INTELLIGENCE": return t.system.componentsIntelligence;
    case "PORTFOLIO": return t.system.componentsPortfolio;
    case "ALERT_RULES": return t.system.componentsAlertRules;
    case "NOTIFICATIONS": return t.system.componentsNotifications;
    case "HISTORICAL": return t.system.componentsHistorical;
    default: return component.replace(/_/g, " ");
  }
}

// ─── Intelligence Cycle Status Mapping ──────────────────────

/** Map intelligence cycle status to translated display label. */
export function mapIntelligenceStatus(
  status: string,
  t: Translations,
): string {
  switch (status) {
    case "HEALTHY": return t.status.healthy;
    case "DEGRADED": return t.system.degraded;
    case "UNAVAILABLE": return t.status.unavailable;
    case "UNKNOWN": return t.status.unknown;
    default: return status.replace(/_/g, " ");
  }
}

// ─── Sensitivity Mapping ────────────────────────────────────

/** Map position sensitivity enum to translated display label. */
export function mapSensitivity(
  sensitivity: string,
  t: Translations,
): string {
  switch (sensitivity) {
    case "HIGH": return t.investor.elevated;
    case "MODERATE": return t.investor.moderate;
    case "LOW": return t.investor.low;
    case "UNKNOWN": return t.status.unknown;
    default: return sensitivity;
  }
}

// ─── Investor Monitor-State Mapping (Phase 144) ──────────────

/** Map investor portfolio monitor state to a translated display label. */
export function mapMonitorState(
  state: string,
  t: Translations,
): string {
  switch (state) {
    case "IDLE": return t.investor.monitorIdle;
    case "STABLE": return t.investor.monitorStable;
    case "WATCH": return t.investor.monitorWatch;
    case "ELEVATED": return t.investor.monitorElevated;
    case "SEVERE": return t.investor.monitorSevere;
    default: return state.replace(/_/g, " ");
  }
}

// ─── Investor Decision-State Mapping (Phase 141) ─────────────

/** Map investor decision-synthesis state to a translated display label. */
export function mapDecisionState(
  state: string,
  t: Translations,
): string {
  switch (state) {
    case "ALIGNED": return t.investor.decisionStateAligned;
    case "CONFLICT": return t.investor.decisionStateConflict;
    case "CAUTION": return t.status.caution;
    case "INSUFFICIENT_DATA": return t.status.insufficientData;
    case "UNAVAILABLE": return t.status.unavailable;
    default: return state.replace(/_/g, " ");
  }
}

// ─── Market State Mapping ───────────────────────────────────

/** Map market state enum (with underscores) to translated display label. */
export function mapMarketState(
  marketState: string,
  t: Translations,
): string {
  switch (marketState) {
    // MarketIntelligenceSummary domain (price-observation-engine)
    case "TRENDING_UP": return t.analysis.bullish;
    case "TRENDING_DOWN": return t.analysis.bearish;
    case "VOLATILE": return t.intelligence.volatilityLabel;
    case "RANGING": return t.intelligence.ranging;
    case "INSUFFICIENT_DATA": return t.intelligence.insufficientData;
    // Legacy/other-surface values
    case "TRENDING_BULLISH": return t.analysis.bullish;
    case "TRENDING_BEARISH": return t.analysis.bearish;
    case "VOLATILE_EXPANSION": return t.fundamental.volatile;
    case "VOLATILE_CONTRACTION": return t.fundamental.contracting;
    case "UNKNOWN": return t.status.unknown;
    default: return marketState.replace(/_/g, " ");
  }
}
