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
    default: return stance.replace(/_/g, " ");
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
    default: return impact.replace(/_/g, " ");
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
    default: return direction.replace(/_/g, " ");
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
    default: return relevance.replace(/_/g, " ");
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
    case "LIVE": return t.status.live;
    case "SIMULATED": return t.status.simulated;
    default: return availability.replace(/_/g, " ");
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
  // Normalized so title-case and lowercase domain values (e.g. "Bullish")
  // map identically to the canonical uppercase enum values.
  switch (trend.toUpperCase()) {
    case "BULLISH": return t.analysis.bullish;
    case "BEARISH": return t.analysis.bearish;
    case "NEUTRAL": return t.intelligence.neutral;
    case "MIXED": return t.intelligence.stanceMixed;
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
    default: return level.replace(/_/g, " ");
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
    case "1-4_WEEKS": return t.marketPanel.horizon1_4Weeks;
    case "1-3_MONTHS": return t.marketPanel.horizon1_3Months;
    case "3-6_MONTHS": return t.marketPanel.horizon3_6Months;
    case "6-12_MONTHS": return t.marketPanel.horizon6_12Months;
    case "1-3_YEARS": return t.marketPanel.horizon1_3Years;
    case "3+_YEARS": return t.marketPanel.horizon3PlusYears;
    default: return horizon.replace(/_/g, " ");
  }
}

// ─── Confidence Mapping ─────────────────────────────────────

/** Map confidence level enum to translated display label. */
export function mapConfidence(
  confidence: string,
  t: Translations,
): string {
  // Normalized so lowercase provider values (e.g. "high") and uppercase
  // engine values (e.g. "STRONG_EVIDENCE") map identically.
  switch (confidence.toUpperCase()) {
    case "STRONG_EVIDENCE": return t.intelligence.confidenceStrong;
    case "MODERATE_EVIDENCE": return t.intelligence.confidenceModerate;
    case "WEAK_EVIDENCE": return t.intelligence.confidenceWeak;
    case "INSUFFICIENT_EVIDENCE": return t.intelligence.confidenceInsufficient;
    case "HIGH": return t.intelligence.confidenceHigh;
    case "MEDIUM": return t.intelligence.confidenceMedium;
    case "LOW": return t.intelligence.confidenceLow;
    case "UNAVAILABLE": return t.status.unavailable;
    default: return confidence.replace(/_/g, " ");
  }
}

// ─── Dimension Mapping ──────────────────────────────────────

/** Map dimension name enum to translated display label. */
export function mapDimension(
  dimension: string,
  t: Translations,
): string {
  // Normalized so lowercase data-availability keys (e.g. "technical")
  // map identically to the canonical uppercase enum values.
  switch (dimension.toUpperCase()) {
    case "TECHNICAL": return t.intelligence.technical;
    case "MACRO": return t.intelligence.macro;
    case "CROSS_ASSET": return t.intelligence.crossAsset;
    case "DERIVATIVES": return t.intelligence.derivatives;
    case "NEWS": return t.intelligence.news;
    case "FUNDAMENTALS": return t.intelligence.fundamentals;
    default: return dimension.replace(/_/g, " ");
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
    case "DISINFLATIONARY": return t.macro.disinflation;
    case "CONTRACTION": return t.macro.contraction;
    case "RECOVERY": return t.macro.recovery;
    case "INSUFFICIENT_DATA": return t.status.insufficientData;
    case "UNAVAILABLE": return t.status.unavailable;
    case "HIGH": return t.fundamental.elevated;
    case "ACCELERATING": return t.fundamental.accelerating;
    case "SUPPLY_DRIVEN": return t.fundamental.supplyDriven;
    case "REAL_YIELD_RISING": return t.fundamental.rising;
    case "REAL_YIELD_FALLING": return t.fundamental.falling;
    case "REAL_YIELD_STABLE": return t.fundamental.stable;
    case "EASY": return t.fundamental.easing;
    case "STRESS": return t.macro.stressed;
    case "DE_ESCALATING": return t.fundamental.deescalating;
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
    default: return sensitivity.replace(/_/g, " ");
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
    case "PULLBACK": return t.intelligence.pullbackLabel;
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

// ─── Market Data Freshness Mapping (Phase 146) ───────────────

/** Map market-data freshness enum to translated display label. */
export function mapFreshness(
  freshness: string,
  t: Translations,
): string {
  switch (freshness) {
    case "FRESH": return t.marketPanel.freshness.fresh;
    case "RECENT": return t.marketPanel.freshness.recent;
    case "DELAYED": return t.marketPanel.freshness.delayed;
    case "STALE": return t.marketPanel.freshness.stale;
    case "UNAVAILABLE": return t.marketPanel.freshness.unavailable;
    default: return freshness.replace(/_/g, " ");
  }
}

// ─── Recommendation Suitability Mapping (Phase 146) ──────────

/** Map recommendation suitability enum to translated display label. */
export function mapSuitability(
  suitability: string,
  t: Translations,
): string {
  switch (suitability) {
    case "TOP_OPPORTUNITY": return t.marketPanel.suitability.topOpportunity;
    case "WATCHLIST": return t.marketPanel.suitability.watchlist;
    case "NEUTRAL": return t.marketPanel.suitability.neutral;
    case "EXCLUDED": return t.marketPanel.suitability.excluded;
    case "INSUFFICIENT_DATA": return t.marketPanel.suitability.insufficientData;
    default: return suitability.replace(/_/g, " ");
  }
}

// ─── Data Completeness Mapping (Phase 146) ───────────────────

/** Map data-completeness enum to translated display label. */
export function mapCompleteness(
  completeness: string,
  t: Translations,
): string {
  switch (completeness) {
    case "FULL": return t.marketPanel.completeness.full;
    case "PARTIAL": return t.marketPanel.completeness.partial;
    case "MINIMAL": return t.marketPanel.completeness.minimal;
    case "NONE": return t.marketPanel.completeness.none;
    default: return completeness.replace(/_/g, " ");
  }
}

// ─── Decision Assessment Mapping (Phase 147) ──────────────────

/** Map decision-support overall assessment to a translated display label. */
export function mapAssessment(
  assessment: string,
  t: Translations,
): string {
  switch (assessment) {
    case "COUNT_SUPPORTING": return t.intelligence.supporting;
    case "COUNT_CONFLICTING": return t.intelligence.conflicting;
    case "MIXED_EVIDENCE": return t.intelligence.stanceMixed;
    case "INSUFFICIENT_DATA": return t.status.insufficientData;
    case "SUPPORTING": return t.intelligence.supporting;
    case "CONFLICTING": return t.intelligence.conflicting;
    case "NEUTRAL": return t.intelligence.neutral;
    case "UNAVAILABLE": return t.status.unavailable;
    default: return assessment.replace(/_/g, " ");
  }
}

// ─── Invalidation Status Mapping (Phase 147) ──────────────────

/** Map invalidation-condition status to a translated display label. */
export function mapInvalidationStatus(
  status: string,
  t: Translations,
): string {
  switch (status) {
    case "NOT_APPROACHING": return t.decision.invalidationStatusNotApproaching;
    case "APPROACHING": return t.decision.invalidationStatusApproaching;
    case "TRIGGERED": return t.decision.invalidationStatusTriggered;
    case "UNAVAILABLE": return t.status.unavailable;
    default: return status.replace(/_/g, " ");
  }
}

// ─── Priority Mapping (Phase 147) ─────────────────────────────

/** Map watch/alert priority enum to a translated display label. */
export function mapPriority(
  priority: string,
  t: Translations,
): string {
  switch (priority) {
    case "CRITICAL": return t.alerts.critical;
    case "HIGH": return t.alerts.high;
    case "MEDIUM": return t.alerts.medium;
    case "LOW": return t.alerts.low;
    default: return priority.replace(/_/g, " ");
  }
}

// ─── Portfolio Risk Context Mapping (Phase 147) ───────────────

/** Map portfolio risk-context enum to a translated display label. */
export function mapPortfolioRisk(
  risk: string,
  t: Translations,
): string {
  switch (risk) {
    case "LOW_CONCERN": return t.investor.low;
    case "MIXED": return t.intelligence.stanceMixed;
    case "ELEVATED_CONCERN": return t.investor.elevated;
    case "INSUFFICIENT_DATA": return t.status.insufficientData;
    default: return risk.replace(/_/g, " ");
  }
}

// ─── Position Side Mapping (Phase 147) ─────────────────────────

/** Map position side enum to a translated display label. */
export function mapSide(
  side: string,
  t: Translations,
): string {
  switch (side.toUpperCase()) {
    case "LONG": return t.analysis.long;
    case "SHORT": return t.analysis.short;
    default: return side.replace(/_/g, " ");
  }
}

// ─── Pullback Classification Mapping (Phase 147) ───────────────

/** Map pullback classification enum to a translated display label. */
export function mapPullbackClassification(
  classification: string,
  t: Translations,
): string {
  switch (classification) {
    case "NORMAL_PULLBACK": return t.intelligence.pullbackNormal;
    case "EARLY_CORRECTION": return t.intelligence.pullbackEarlyCorrection;
    case "MEANINGFUL_DETERIORATION": return t.intelligence.pullbackDeterioration;
    case "STRUCTURAL_REVERSAL": return t.intelligence.pullbackStructuralReversal;
    case "SHOCK_REVERSAL": return t.intelligence.pullbackShockReversal;
    case "INSUFFICIENT_DATA": return t.intelligence.pullbackInsufficientData;
    default: return classification.replace(/_/g, " ");
  }
}

// ─── Change Strength Mapping (Phase 147) ───────────────────────

/** Map timeline change-strength enum to a translated display label. */
export function mapStrength(
  strength: string,
  t: Translations,
): string {
  switch (strength.toUpperCase()) {
    case "STRONG": return t.alerts.high;
    case "MODERATE": return t.alerts.medium;
    case "WEAK": return t.alerts.low;
    default: return strength.replace(/_/g, " ");
  }
}

// ─── Timeline Event Type Mapping (Phase 147) ───────────────────

/** Map historical timeline event type to a translated display label. */
export function mapTimelineEventType(
  eventType: string,
  t: Translations,
): string {
  switch (eventType) {
    case "INITIAL_ANALYSIS": return t.timeline.initialAnalysis;
    case "THESIS_CHANGE": return t.timeline.thesisChange;
    case "REGIME_CHANGE": return t.timeline.regimeChange;
    case "TIMEFRAME_CHANGE": return t.timeline.timeframeChange;
    case "STRUCTURE_CHANGE": return t.timeline.structureChange;
    case "MOMENTUM_CHANGE": return t.timeline.momentumChange;
    case "VOLATILITY_CHANGE": return t.timeline.volatilityChange;
    case "EVIDENCE_CHANGE": return t.timeline.evidenceChange;
    case "NEWS_CHANGE": return t.timeline.newsChange;
    case "MACRO_CHANGE": return t.timeline.macroChange;
    case "DATA_QUALITY_CHANGE": return t.timeline.dataQualityChange;
    default: return eventType.replace(/_/g, " ");
  }
}

// ─── Portfolio Alignment Type Mapping (Phase 147) ──────────────

/** Map portfolio alignment type to a translated display label. */
export function mapAlignmentType(
  alignmentType: string,
  t: Translations,
): string {
  switch (alignmentType) {
    case "REGIME_MATCH": return t.portfolio.alignmentRegimeMatch;
    case "HTF_ALIGNMENT": return t.portfolio.alignmentHtfAlignment;
    case "CONCENTRATION": return t.portfolio.alignmentConcentration;
    case "DIRECTIONAL_CONCENTRATION": return t.portfolio.alignmentDirectionalConcentration;
    default: return alignmentType.replace(/_/g, " ");
  }
}

// ─── Portfolio Conflict Type Mapping (Phase 147) ───────────────

/** Map portfolio conflict type to a translated display label. */
export function mapConflictType(
  conflictType: string,
  t: Translations,
): string {
  switch (conflictType) {
    case "DIRECT_DIRECTIONAL": return t.portfolio.conflictDirectDirectional;
    case "EVIDENCE_CONFLICT": return t.portfolio.conflictEvidenceConflict;
    case "REGIME": return t.portfolio.conflictRegime;
    default: return conflictType.replace(/_/g, " ");
  }
}
