/**
 * Phase 85 — Fundamental Intelligence Engine
 *
 * Deterministic fundamental/macro data interpretation:
 * - Economic event classification
 * - Fundamental metric interpretation
 * - Catalyst detection
 * - Economic calendar context
 *
 * Pure functions — no side effects, no network calls.
 * All data must be supplied from real providers; this module never fabricates values.
 */

import type { PositionSide } from "./types";

// ═══════════════════════════════════════════════════════════════
// FUNDAMENTAL DATA POINT
// ═══════════════════════════════════════════════════════════════

export type FundamentalCategory =
  | "INFLATION"
  | "INTEREST_RATE"
  | "EMPLOYMENT"
  | "GDP"
  | "MONETARY_POLICY"
  | "TRADE_BALANCE"
  | "CONSUMER_SENTIMENT"
  | "INDUSTRIAL_PRODUCTION"
  | "HOUSING"
  | "CRYPTO_FUNDAMENTAL"
  | "COMMODITY_FUNDAMENTAL"
  | "OTHER";

export interface FundamentalDataPoint {
  /** Metric name (e.g., "CPI YoY", "Fed Funds Rate"). */
  metric: string;
  /** Current/actual value. */
  value: number | string;
  /** Previous value (if available). */
  previous: number | string | null;
  /** Expected/consensus value (if available — do NOT fabricate). */
  expected: number | string | null;
  /** Timestamp (ms epoch). */
  timestamp: number;
  /** Source/provider. */
  source: string;
  /** Freshness. */
  freshness: "FRESH" | "RECENT" | "STALE" | "UNAVAILABLE";
  /** Category. */
  category: FundamentalCategory;
  /** Related instruments. */
  relatedInstruments: string[];
  /** Source mode. */
  sourceMode: "LIVE" | "STALE" | "UNAVAILABLE";
}

// ═══════════════════════════════════════════════════════════════
// FUNDAMENTAL INTERPRETATION
// ═══════════════════════════════════════════════════════════════

export interface FundamentalInterpretation {
  /** Data point. */
  dataPoint: FundamentalDataPoint;
  /** Position impact. */
  positionImpact: "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "INSUFFICIENT";
  /** Human-readable interpretation. */
  interpretation: string;
  /** Whether actual vs expected comparison is available. */
  hasComparison: boolean;
  /** Surprise direction if expected data exists: POSITIVE / NEGATIVE / NONE / UNKNOWN. */
  surpriseDirection: "POSITIVE" | "NEGATIVE" | "NONE" | "UNKNOWN";
}

/**
 * Interpret a fundamental data point in the context of a position.
 * Does NOT fabricate interpretation when data is insufficient.
 */
export function interpretFundamental(
  dp: FundamentalDataPoint,
  side: PositionSide,
  instrument: string,
): FundamentalInterpretation {
  const hasComparison = dp.expected !== null && dp.previous !== null;
  let surpriseDirection: FundamentalInterpretation["surpriseDirection"] = "UNKNOWN";
  let positionImpact: FundamentalInterpretation["positionImpact"] = "INSUFFICIENT";

  if (!hasComparison) {
    return {
      dataPoint: dp,
      positionImpact: "INSUFFICIENT",
      interpretation: `${dp.metric}: ${dp.value} (no expected value available for comparison).`,
      hasComparison: false,
      surpriseDirection: "UNKNOWN",
    };
  }

  // Determine surprise direction (only for numeric values)
  if (typeof dp.value === "number" && typeof dp.expected === "number") {
    const diff = dp.value - dp.expected;
    const threshold = Math.abs(dp.expected) * 0.005; // 0.5% threshold
    if (diff > threshold) {
      surpriseDirection = "POSITIVE";
    } else if (diff < -threshold) {
      surpriseDirection = "NEGATIVE";
    } else {
      surpriseDirection = "NONE";
    }
  }

  // Determine position impact based on category and surprise
  const impact = classifyFundamentalImpact(dp.category, surpriseDirection, side, instrument);

  return {
    dataPoint: dp,
    positionImpact: impact.position,
    interpretation: impact.description,
    hasComparison: true,
    surpriseDirection,
  };
}

interface ImpactResult {
  position: "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "INSUFFICIENT";
  description: string;
}

function classifyFundamentalImpact(
  category: FundamentalCategory,
  surprise: "POSITIVE" | "NEGATIVE" | "NONE" | "UNKNOWN",
  side: PositionSide,
  instrument: string,
): ImpactResult {
  if (surprise === "UNKNOWN") {
    return { position: "INSUFFICIENT", description: "Unable to classify surprise direction." };
  }

  const isLong = side === "LONG";

  switch (category) {
    case "INFLATION": {
      // Higher-than-expected inflation → bearish for risk assets, supports USD
      // Lower-than-expected → bullish for risk assets
      if (surprise === "POSITIVE") {
        // Hotter inflation
        const isUSD = instrument.includes("USD") && !instrument.includes("XAU");
        return {
          position: isLong ? (isUSD ? "CONFLICTING" : "CONFLICTING") : (isUSD ? "SUPPORTING" : "SUPPORTING"),
          description: `Inflation higher than expected — ${isLong ? "negative" : "positive"} for ${side} ${instrument}.`,
        };
      }
      if (surprise === "NEGATIVE") {
        const isUSD = instrument.includes("USD") && !instrument.includes("XAU");
        return {
          position: isLong ? "SUPPORTING" : "CONFLICTING",
          description: `Inflation lower than expected — ${isLong ? "positive" : "negative"} for ${side} ${instrument}.`,
        };
      }
      return { position: "NEUTRAL", description: "Inflation data in line with expectations." };
    }

    case "INTEREST_RATE": {
      // Higher rates → USD strength
      if (surprise === "POSITIVE") {
        const isUSD = instrument.includes("USD");
        return {
          position: isLong ? "CONFLICTING" : "SUPPORTING",
          description: `Rate higher than expected — USD strength context, ${isLong ? "negative" : "positive"} for ${side} ${instrument}.`,
        };
      }
      if (surprise === "NEGATIVE") {
        return {
          position: isLong ? "SUPPORTING" : "CONFLICTING",
          description: `Rate lower than expected — ${isLong ? "positive" : "negative"} for ${side} ${instrument}.`,
        };
      }
      return { position: "NEUTRAL", description: "Rate decision in line with expectations." };
    }

    case "EMPLOYMENT": {
      // Strong employment → USD strength → bearish for risk assets
      if (surprise === "POSITIVE") {
        return {
          position: isLong ? "CONFLICTING" : "SUPPORTING",
          description: `Employment stronger than expected — ${isLong ? "negative" : "positive"} context for ${side} ${instrument}.`,
        };
      }
      if (surprise === "NEGATIVE") {
        return {
          position: isLong ? "SUPPORTING" : "CONFLICTING",
          description: `Employment weaker than expected — ${isLong ? "positive" : "negative"} context for ${side} ${instrument}.`,
        };
      }
      return { position: "NEUTRAL", description: "Employment data in line with expectations." };
    }

    case "GDP": {
      if (surprise === "POSITIVE") {
        return {
          position: isLong ? "SUPPORTING" : "CONFLICTING",
          description: `GDP stronger than expected — ${isLong ? "positive" : "negative"} for ${side} ${instrument}.`,
        };
      }
      if (surprise === "NEGATIVE") {
        return {
          position: isLong ? "CONFLICTING" : "SUPPORTING",
          description: `GDP weaker than expected — ${isLong ? "negative" : "positive"} for ${side} ${instrument}.`,
        };
      }
      return { position: "NEUTRAL", description: "GDP in line with expectations." };
    }

    default:
      return { position: "NEUTRAL", description: `${category} data available but position impact is context-dependent.` };
  }
}

// ═══════════════════════════════════════════════════════════════
// ECONOMIC EVENT
// ═══════════════════════════════════════════════════════════════

export type EventImportance = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";

export interface EconomicEvent {
  /** Event name (e.g., "FOMC Rate Decision", "US CPI"). */
  name: string;
  /** Event timestamp (ms epoch). */
  timestamp: number;
  /** Currency/region affected. */
  currency: string;
  /** Importance level. */
  importance: EventImportance;
  /** Related instruments. */
  relatedInstruments: string[];
  /** Previous value (if available). */
  previous: number | string | null;
  /** Expected/consensus (if available). */
  expected: number | string | null;
  /** Source. */
  source: string;
  /** Source mode. */
  sourceMode: "LIVE" | "STALE" | "UNAVAILABLE";
}

// ═══════════════════════════════════════════════════════════════
// CATALYST ENGINE
// ═══════════════════════════════════════════════════════════════

export type CatalystStatus =
  | "NO_MATERIAL_CATALYST"
  | "POTENTIAL_CATALYST"
  | "ACTIVE_CATALYST"
  | "RECENT_CATALYST"
  | "HIGH_IMPACT_EVENT_APPROACHING"
  | "UNKNOWN";

export interface CatalystAnalysis {
  /** Current catalyst status. */
  status: CatalystStatus;
  /** Description. */
  description: string;
  /** Time until event (ms) if approaching. */
  timeUntilEventMs: number | null;
  /** Affected instruments. */
  affectedInstruments: string[];
  /** Event details. */
  event: EconomicEvent | null;
  /** Position sensitivity. */
  positionSensitivity: "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
}

/**
 * Classify the catalyst environment for a given instrument and position.
 * Uses real event data — does NOT fabricate event existence.
 */
export function classifyCatalyst(
  events: EconomicEvent[],
  instrument: string,
  now: number,
): CatalystAnalysis {
  const relevantEvents = events.filter(e =>
    e.relatedInstruments.some(ri => ri.toUpperCase() === instrument.toUpperCase())
    || e.currency.toUpperCase() === getCurrencyCode(instrument)
  );

  if (relevantEvents.length === 0) {
    return {
      status: "NO_MATERIAL_CATALYST",
      description: "No scheduled high-impact economic events for this instrument.",
      timeUntilEventMs: null,
      affectedInstruments: [],
      event: null,
      positionSensitivity: "UNKNOWN",
    };
  }

  // Sort by proximity (closest first)
  relevantEvents.sort((a, b) => Math.abs(a.timestamp - now) - Math.abs(b.timestamp - now));

  const closestEvent = relevantEvents[0];
  const timeUntil = closestEvent.timestamp - now;
  const minutesUntil = timeUntil / 60_000;

  let status: CatalystStatus;
  let description: string;
  let positionSensitivity: CatalystAnalysis["positionSensitivity"];

  if (closestEvent.importance === "CRITICAL" || closestEvent.importance === "HIGH") {
    positionSensitivity = "HIGH";
  } else if (closestEvent.importance === "MODERATE") {
    positionSensitivity = "MODERATE";
  } else {
    positionSensitivity = "LOW";
  }

  if (timeUntil > 0 && minutesUntil < 60) {
    status = "HIGH_IMPACT_EVENT_APPROACHING";
    description = `${closestEvent.name} in ${Math.round(minutesUntil)} minutes. ${positionSensitivity}-impact event.`;
  } else if (timeUntil > 0 && minutesUntil < 1440) {
    status = "POTENTIAL_CATALYST";
    description = `${closestEvent.name} scheduled within ${Math.round(minutesUntil / 60)} hours.`;
  } else if (timeUntil <= 0 && minutesUntil > -60) {
    status = "ACTIVE_CATALYST";
    description = `${closestEvent.name} is currently active/occurring.`;
  } else if (timeUntil <= 0 && minutesUntil > -1440) {
    status = "RECENT_CATALYST";
    description = `${closestEvent.name} occurred ${Math.round(Math.abs(minutesUntil) / 60)} hours ago. Market may still be digesting.`;
  } else {
    status = "NO_MATERIAL_CATALYST";
    description = `${closestEvent.name} is ${Math.round(Math.abs(minutesUntil) / 60)} hours away — distant event.`;
  }

  return {
    status,
    description,
    timeUntilEventMs: timeUntil > 0 ? timeUntil : null,
    affectedInstruments: closestEvent.relatedInstruments,
    event: closestEvent,
    positionSensitivity,
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENT IMPORTANCE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

const CRITICAL_EVENTS = ["fomc", "rate decision", "ecb decision", "boe decision", "boj decision", "rba decision", "boc decision"];
const HIGH_EVENTS = ["cpi", "nfp", "non-farm payrolls", "employment", "gdp", "ppi", "ism", "pmi"];
const MODERATE_EVENTS = ["consumer sentiment", "retail sales", "housing starts", "industrial production", "trade balance", "jolts", "adp"];

export function classifyEventImportance(eventName: string): EventImportance {
  const lower = eventName.toLowerCase();
  if (CRITICAL_EVENTS.some(e => lower.includes(e))) return "CRITICAL";
  if (HIGH_EVENTS.some(e => lower.includes(e))) return "HIGH";
  if (MODERATE_EVENTS.some(e => lower.includes(e))) return "MODERATE";
  return "LOW";
}

// ═══════════════════════════════════════════════════════════════
// FUNDAMENTAL SYNTHESIS
// ═══════════════════════════════════════════════════════════════

export interface FundamentalSynthesis {
  /** All interpreted fundamentals for this instrument. */
  interpretations: FundamentalInterpretation[];
  /** Count by impact. */
  supportingCount: number;
  conflictingCount: number;
  neutralCount: number;
  /** Overall fundamental stance. */
  fundamentalStance: "SUPPORTING" | "CONFLICTING" | "MIXED" | "NEUTRAL" | "INSUFFICIENT";
  /** Description. */
  description: string;
  /** Catalyst analysis. */
  catalyst: CatalystAnalysis;
  /** Availability. */
  availability: "AVAILABLE" | "LIMITED" | "UNAVAILABLE";
}

/**
 * Synthesize fundamental data for a given instrument and position.
 */
export function synthesizeFundamentals(
  dataPoints: FundamentalDataPoint[],
  events: EconomicEvent[],
  instrument: string,
  side: PositionSide,
  now: number,
): FundamentalSynthesis {
  const catalyst = classifyCatalyst(events, instrument, now);

  if (dataPoints.length === 0 && events.length === 0) {
    return {
      interpretations: [],
      supportingCount: 0,
      conflictingCount: 0,
      neutralCount: 0,
      fundamentalStance: "INSUFFICIENT",
      description: "No fundamental data or economic events available.",
      catalyst,
      availability: "UNAVAILABLE",
    };
  }

  const interpretations = dataPoints.map(dp => interpretFundamental(dp, side, instrument));

  const supportingCount = interpretations.filter(i => i.positionImpact === "SUPPORTING").length;
  const conflictingCount = interpretations.filter(i => i.positionImpact === "CONFLICTING").length;
  const neutralCount = interpretations.filter(i => i.positionImpact === "NEUTRAL").length;

  let fundamentalStance: FundamentalSynthesis["fundamentalStance"];
  let description: string;

  if (supportingCount > 0 && conflictingCount > 0) {
    fundamentalStance = "MIXED";
    description = `Mixed fundamental signals: ${supportingCount} supporting, ${conflictingCount} conflicting for ${side} ${instrument}.`;
  } else if (supportingCount > 0) {
    fundamentalStance = "SUPPORTING";
    description = `Fundamental context supports ${side} ${instrument}.`;
  } else if (conflictingCount > 0) {
    fundamentalStance = "CONFLICTING";
    description = `Fundamental context conflicts with ${side} ${instrument}.`;
  } else {
    fundamentalStance = "NEUTRAL";
    description = "Fundamental data is neutral or insufficient for directional assessment.";
  }

  // Add catalyst info
  if (catalyst.status !== "NO_MATERIAL_CATALYST") {
    description += ` ${catalyst.description}`;
  }

  const availability = dataPoints.length > 0 ? "AVAILABLE" : (events.length > 0 ? "LIMITED" : "UNAVAILABLE");

  return {
    interpretations,
    supportingCount,
    conflictingCount,
    neutralCount,
    fundamentalStance,
    description,
    catalyst,
    availability,
  };
}

// ═══════════════════════════════════════════════════════════════
// CURRENCY CODE HELPER
// ═══════════════════════════════════════════════════════════════

function getCurrencyCode(instrument: string): string {
  const i = instrument.toUpperCase();
  if (i.includes("BTC") || i.includes("ETH") || i.includes("SOL") || i.includes("DOGE")) return "USD";
  if (i.includes("XAU") || i.includes("XAG")) return "USD";
  if (i.includes("VIX")) return "USD";
  if (i.includes("EUR")) return "EUR";
  if (i.includes("GBP")) return "GBP";
  if (i.includes("JPY")) return "JPY";
  if (i.includes("AUD")) return "AUD";
  if (i.includes("CAD")) return "CAD";
  return "USD";
}

// ═══════════════════════════════════════════════════════════════
// BOUNDS
// ═══════════════════════════════════════════════════════════════

/** Maximum fundamental data points to retain per synthesis. */
export const MAX_FUNDAMENTAL_ITEMS = 30;

/** Maximum economic events to retain. */
export const MAX_EVENTS = 20;

/** Bound fundamental data. */
export function boundFundamentals(items: FundamentalDataPoint[]): FundamentalDataPoint[] {
  return items.slice(0, MAX_FUNDAMENTAL_ITEMS);
}

/** Bound economic events. */
export function boundEvents(items: EconomicEvent[]): EconomicEvent[] {
  return items.slice(0, MAX_EVENTS);
}
