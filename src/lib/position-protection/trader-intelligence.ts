/**
 * Phase 83 — Trader Intelligence Engine
 *
 * Translates technical analysis into concise, trader-facing intelligence:
 * - Market Context (what is the market doing and why)
 * - Position Thesis (does this support my position)
 * - Change Detection (what changed since last analysis)
 * - Evidence Timeline (bounded intelligence log)
 * - Key Levels (support/resistance from swing data)
 * - Analytical Summary (concise final output)
 *
 * Pure functions — no side effects, no network calls.
 * Deterministic: same inputs → same outputs.
 */

import type { PositionSide } from "./types";
import {
  type TimeframeAnalysis,
  type MTFConfluence,
  type MarketRegime,
} from "./multi-timeframe-engine";

// ═══════════════════════════════════════════════════════════════
// MARKET CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface MarketContext {
  /** Human-readable market context. */
  narrative: string;
  /** Current regime. */
  regime: MarketRegime;
  /** H1 analysis summary. */
  h1Summary: string;
  /** M15 analysis summary. */
  m15Summary: string;
  /** M5 analysis summary. */
  m5Summary: string;
  /** MTF alignment description. */
  alignment: string;
  /** Momentum description. */
  momentum: string;
  /** Volatility description. */
  volatility: string;
  /** Structure description. */
  structure: string;
}

export function generateMarketContext(
  confluence: MTFConfluence,
): MarketContext {
  const h1 = confluence.timeframes.find((a) => a.timeframe === "H1");
  const m15 = confluence.timeframes.find((a) => a.timeframe === "M15");
  const m5 = confluence.timeframes.find((a) => a.timeframe === "M5");

  const h1Summary = describeTimeframe(h1, "H1");
  const m15Summary = describeTimeframe(m15, "M15");
  const m5Summary = describeTimeframe(m5, "M5");

  // Alignment
  const alignment = confluence.allAligned
    ? "All timeframes aligned — strong directional conviction"
    : confluence.timeframeConflict
      ? "Timeframes conflict — lower TF may be correcting against higher TF trend"
      : "Partial alignment — mixed signals across timeframes";

  // Momentum narrative
  const momentum = describeMomentum(h1, m15, m5);

  // Volatility narrative
  const volatility = describeVolatility(h1, m15, m5);

  // Structure narrative
  const structure = describeStructure(h1, m15, m5);

  // Main narrative
  const narrative = buildRegimeNarrative(confluence.regime, h1, m15, m5, confluence.allAligned);

  return {
    narrative,
    regime: confluence.regime,
    h1Summary,
    m15Summary,
    m5Summary,
    alignment,
    momentum,
    volatility,
    structure,
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION THESIS
// ═══════════════════════════════════════════════════════════════

export type ThesisVerdict = "HEALTHY" | "CAUTION" | "DETERIORATING" | "INVALIDATED";

export interface EvidenceItem {
  category: string;
  description: string;
  direction: "SUPPORTING" | "CONFLICTING";
  strength: "STRONG" | "MODERATE" | "WEAK";
}

export interface PositionThesis {
  /** Thesis verdict. */
  verdict: ThesisVerdict;
  /** Supporting evidence. */
  supporting: EvidenceItem[];
  /** Conflicting evidence. */
  conflicting: EvidenceItem[];
  /** Invalidation conditions. */
  invalidationConditions: string[];
  /** What to watch next. */
  watchNext: string[];
  /** Confidence in evidence quality. */
  evidenceQuality: "STRONG_EVIDENCE" | "MODERATE_EVIDENCE" | "WEAK_EVIDENCE" | "INSUFFICIENT_EVIDENCE";
}

export function generatePositionThesis(
  side: PositionSide,
  confluence: MTFConfluence,
): PositionThesis {
  const h1 = confluence.timeframes.find((a) => a.timeframe === "H1");
  const m15 = confluence.timeframes.find((a) => a.timeframe === "M15");
  const m5 = confluence.timeframes.find((a) => a.timeframe === "M5");
  const isLong = side === "LONG";

  const supporting: EvidenceItem[] = [];
  const conflicting: EvidenceItem[] = [];
  const invalidationConditions: string[] = [];
  const watchNext: string[] = [];

  // H1 trend
  if (h1 && h1.trend !== "UNKNOWN") {
    const aligned = (isLong && h1.trend === "BULLISH") || (!isLong && h1.trend === "BEARISH");
    const item: EvidenceItem = {
      category: "TECHNICAL",
      description: `H1 trend is ${h1.trend} ${aligned ? "(aligned with position)" : "(opposing position)"}`,
      direction: aligned ? "SUPPORTING" : "CONFLICTING",
      strength: "STRONG",
    };
    aligned ? supporting.push(item) : conflicting.push(item);
  }

  // M15 trend
  if (m15 && m15.trend !== "UNKNOWN") {
    const aligned = (isLong && m15.trend === "BULLISH") || (!isLong && m15.trend === "BEARISH");
    const opposing = (isLong && m15.trend === "BEARISH") || (!isLong && m15.trend === "BULLISH");
    const item: EvidenceItem = {
      category: "TECHNICAL",
      description: `M15 trend is ${m15.trend}`,
      direction: aligned ? "SUPPORTING" : opposing ? "CONFLICTING" : "SUPPORTING",
      strength: "MODERATE",
    };
    aligned ? supporting.push(item) : conflicting.push(item);
  }

  // M5 momentum
  if (m5 && m5.momentum !== "UNKNOWN") {
    const aligned = (isLong && (m5.momentum === "POSITIVE" || m5.momentum === "OVERSOLD")) ||
                    (!isLong && (m5.momentum === "NEGATIVE" || m5.momentum === "OVERBOUGHT"));
    const opposing = (isLong && (m5.momentum === "NEGATIVE" || m5.momentum === "OVERBOUGHT")) ||
                     (!isLong && (m5.momentum === "POSITIVE" || m5.momentum === "OVERSOLD"));
    if (opposing) {
      conflicting.push({
        category: "MOMENTUM",
        description: `M5 momentum ${m5.momentum.toLowerCase()} against position`,
        direction: "CONFLICTING",
        strength: "MODERATE",
      });
    } else if (aligned) {
      supporting.push({
        category: "MOMENTUM",
        description: `M5 momentum ${m5.momentum.toLowerCase()} supporting position`,
        direction: "SUPPORTING",
        strength: "WEAK",
      });
    }
  }

  // Structure
  if (h1 && h1.structureBroken) {
    conflicting.push({
      category: "STRUCTURE",
      description: "Higher-timeframe structure broken against position",
      direction: "CONFLICTING",
      strength: "STRONG",
    });
  }

  // Volatility
  if (h1 && h1.volatility === "EXPANDED") {
    conflicting.push({
      category: "VOLATILITY",
      description: "Volatility expansion — wider price swings expected",
      direction: "CONFLICTING",
      strength: "MODERATE",
    });
  }

  // Invalidation conditions
  if (h1) {
    if (isLong) {
      invalidationConditions.push("H1 structure breaks lower");
      if (h1.lastSwingLow !== undefined) {
        invalidationConditions.push(`Price breaks below identified support level`);
      }
    } else {
      invalidationConditions.push("H1 structure breaks higher");
      if (h1.lastSwingHigh !== undefined) {
        invalidationConditions.push(`Price breaks above identified resistance level`);
      }
    }
  }

  // Watch next
  if (m5 && m5.trend !== "UNKNOWN") {
    const opposing = (isLong && m5.trend === "BEARISH") || (!isLong && m5.trend === "BULLISH");
    if (opposing) {
      watchNext.push("M5 momentum direction change");
    }
  }
  if (m15 && m15.trend !== "UNKNOWN") {
    const opposing = (isLong && m15.trend === "BEARISH") || (!isLong && m15.trend === "BULLISH");
    if (opposing) {
      watchNext.push("M15 trend recovery or confirmation");
    }
  }
  if (h1 && h1.structureBroken) {
    watchNext.push("Higher-timeframe structure reclaim");
  }
  watchNext.push("Continued MTF alignment or divergence");

  // Verdict
  const strongConflicts = conflicting.filter((e) => e.strength === "STRONG").length;
  const totalConflicts = conflicting.length;
  const totalSupporting = supporting.length;

  let verdict: ThesisVerdict;
  if (strongConflicts >= 1 && totalSupporting === 0) {
    verdict = "INVALIDATED";
  } else if (totalConflicts >= 3 || strongConflicts >= 1) {
    verdict = "DETERIORATING";
  } else if (totalConflicts >= 1) {
    verdict = "CAUTION";
  } else {
    verdict = "HEALTHY";
  }

  // Evidence quality
  const strongSupport = supporting.filter((e) => e.strength === "STRONG").length;
  let evidenceQuality: PositionThesis["evidenceQuality"];
  if (strongSupport >= 1 && totalSupporting >= 3) evidenceQuality = "STRONG_EVIDENCE";
  else if (totalSupporting >= 2) evidenceQuality = "MODERATE_EVIDENCE";
  else if (totalSupporting >= 1) evidenceQuality = "WEAK_EVIDENCE";
  else evidenceQuality = "INSUFFICIENT_EVIDENCE";

  return {
    verdict,
    supporting,
    conflicting,
    invalidationConditions,
    watchNext,
    evidenceQuality,
  };
}

// ═══════════════════════════════════════════════════════════════
// CHANGE DETECTION
// ═══════════════════════════════════════════════════════════════

export interface ChangeDetection {
  /** Whether a meaningful change was detected. */
  changed: boolean;
  /** Change descriptions. */
  changes: string[];
}

export function detectChanges(
  previous: MTFConfluence | undefined,
  current: MTFConfluence,
): ChangeDetection {
  if (!previous) {
    return { changed: false, changes: ["Initial analysis — no previous state to compare"] };
  }

  const changes: string[] = [];

  // Regime change
  if (previous.regime !== current.regime) {
    changes.push(`Market regime shifted from ${previous.regime.replace(/_/g, " ")} to ${current.regime.replace(/_/g, " ")}`);
  }

  // Timeframe trend changes
  for (const tf of ["H1", "M15", "M5"] as const) {
    const prev = previous.timeframes.find((a) => a.timeframe === tf);
    const curr = current.timeframes.find((a) => a.timeframe === tf);
    if (prev && curr && prev.trend !== curr.trend && prev.trend !== "UNKNOWN" && curr.trend !== "UNKNOWN") {
      changes.push(`${tf} shifted from ${prev.trend} to ${curr.trend}`);
    }
  }

  // Alignment change
  if (previous.allAligned !== current.allAligned) {
    changes.push(`Timeframe alignment changed: ${previous.allAligned ? "aligned → conflicting" : "conflicting → aligned"}`);
  }

  // Volatility change
  for (const tf of ["H1", "M15", "M5"] as const) {
    const prev = previous.timeframes.find((a) => a.timeframe === tf);
    const curr = current.timeframes.find((a) => a.timeframe === tf);
    if (prev && curr && prev.volatility !== curr.volatility) {
      changes.push(`${tf} volatility changed: ${prev.volatility} → ${curr.volatility}`);
    }
  }

  // Structure break
  for (const tf of ["H1", "M15", "M5"] as const) {
    const prev = previous.timeframes.find((a) => a.timeframe === tf);
    const curr = current.timeframes.find((a) => a.timeframe === tf);
    if (prev && curr && !prev.structureBroken && curr.structureBroken) {
      changes.push(`${tf} structure broken`);
    }
  }

  return {
    changed: changes.length > 0,
    changes,
  };
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE TIMELINE
// ═══════════════════════════════════════════════════════════════

export interface TimelineEntry {
  timestamp: number;
  instrument: string;
  side: PositionSide;
  observation: string;
  category: string;
  direction: "SUPPORTING" | "CONFLICTING" | "NEUTRAL";
  strength: "STRONG" | "MODERATE" | "WEAK";
}

const MAX_TIMELINE_ENTRIES = 50;

export function addToTimeline(
  existing: TimelineEntry[],
  newEntry: TimelineEntry,
): TimelineEntry[] {
  const timeline = [...existing, newEntry];
  if (timeline.length > MAX_TIMELINE_ENTRIES) {
    return timeline.slice(timeline.length - MAX_TIMELINE_ENTRIES);
  }
  return timeline;
}

export function buildTimelineEntry(
  instrument: string,
  side: PositionSide,
  changes: ChangeDetection,
  confluence: MTFConfluence,
): TimelineEntry | null {
  if (!changes.changed || changes.changes.length === 0) return null;

  return {
    timestamp: Date.now(),
    instrument,
    side,
    observation: changes.changes[0],
    category: "REGIME",
    direction: "CONFLICTING",
    strength: "MODERATE",
  };
}

// ═══════════════════════════════════════════════════════════════
// KEY LEVELS
// ═══════════════════════════════════════════════════════════════

export interface KeyLevels {
  nearestSupport: number | null;
  nearestResistance: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  distanceToSupportPct: number | null;
  distanceToResistancePct: number | null;
}

export function extractKeyLevels(
  h1: TimeframeAnalysis | undefined,
  currentPrice: number,
): KeyLevels {
  if (!h1 || currentPrice <= 0) {
    return {
      nearestSupport: null,
      nearestResistance: null,
      swingHigh: null,
      swingLow: null,
      distanceToSupportPct: null,
      distanceToResistancePct: null,
    };
  }

  const swingHigh = h1.lastSwingHigh ?? null;
  const swingLow = h1.lastSwingLow ?? null;

  const nearestSupport = swingLow;
  const nearestResistance = swingHigh;

  const distanceToSupportPct = nearestSupport !== null && nearestSupport > 0
    ? ((currentPrice - nearestSupport) / currentPrice) * 100
    : null;

  const distanceToResistancePct = nearestResistance !== null && nearestResistance > 0
    ? ((nearestResistance - currentPrice) / currentPrice) * 100
    : null;

  return {
    nearestSupport,
    nearestResistance,
    swingHigh,
    swingLow,
    distanceToSupportPct,
    distanceToResistancePct,
  };
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICAL SUMMARY
// ═══════════════════════════════════════════════════════════════

export interface AnalyticalSummary {
  market: string;
  position: string;
  thesis: string;
  why: string[];
  conflict: string[];
  invalidation: string[];
  watchNext: string[];
}

export function generateAnalyticalSummary(
  side: PositionSide,
  confluence: MTFConfluence,
  thesis: PositionThesis,
): AnalyticalSummary {
  return {
    market: confluence.regime.replace(/_/g, " "),
    position: side,
    thesis: thesis.verdict,
    why: thesis.supporting.slice(0, 3).map((e) => e.description),
    conflict: thesis.conflicting.slice(0, 3).map((e) => e.description),
    invalidation: thesis.invalidationConditions.slice(0, 2),
    watchNext: thesis.watchNext.slice(0, 3),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function describeTimeframe(
  a: TimeframeAnalysis | undefined,
  tf: string,
): string {
  if (!a || a.dataQuality === "INSUFFICIENT") {
    return `${tf}: Insufficient data for analysis`;
  }
  if (a.trend === "UNKNOWN" && a.momentum === "UNKNOWN") {
    return `${tf}: Limited data — no clear directional signal`;
  }

  const parts: string[] = [];
  parts.push(`trend ${a.trend.toLowerCase()}`);

  if (a.momentum !== "UNKNOWN") {
    parts.push(`momentum ${a.momentum.toLowerCase()}`);
  }

  if (a.rsiValue !== undefined) {
    parts.push(`RSI ${a.rsiValue.toFixed(0)}`);
  }

  if (a.volatility !== "UNKNOWN") {
    parts.push(`volatility ${a.volatility.toLowerCase()}`);
  }

  if (a.structureBroken) {
    parts.push("structure broken");
  }

  return `${tf}: ${parts.join(", ")}`;
}

function describeMomentum(
  h1: TimeframeAnalysis | undefined,
  m15: TimeframeAnalysis | undefined,
  m5: TimeframeAnalysis | undefined,
): string {
  const rsis = [h1, m15, m5]
    .filter((a) => a?.rsiValue !== undefined)
    .map((a) => ({ tf: a!.timeframe, rsi: a!.rsiValue! }));

  if (rsis.length === 0) return "Momentum data unavailable";

  const oversold = rsis.filter((r) => r.rsi < 30);
  const overbought = rsis.filter((r) => r.rsi > 70);

  if (oversold.length > 0) {
    return `Momentum oversold on ${oversold.map((r) => r.tf).join("/")}`;
  }
  if (overbought.length > 0) {
    return `Momentum overbought on ${overbought.map((r) => r.tf).join("/")}`;
  }

  return "Momentum within normal range";
}

function describeVolatility(
  h1: TimeframeAnalysis | undefined,
  m15: TimeframeAnalysis | undefined,
  m5: TimeframeAnalysis | undefined,
): string {
  const expanded = [h1, m15, m5].filter((a) => a?.volatility === "EXPANDED");
  const compressed = [h1, m15, m5].filter((a) => a?.volatility === "COMPRESSED");

  if (expanded.length > 0) {
    return `Volatility elevated on ${expanded.map((a) => a!.timeframe).join("/")}`;
  }
  if (compressed.length > 0) {
    return `Volatility compressed on ${compressed.map((a) => a!.timeframe).join("/")}`;
  }
  return "Volatility normal across timeframes";
}

function describeStructure(
  h1: TimeframeAnalysis | undefined,
  m15: TimeframeAnalysis | undefined,
  m5: TimeframeAnalysis | undefined,
): string {
  const broken = [h1, m15, m5].filter((a) => a?.structureBroken);
  if (broken.length > 0) {
    return `Structure broken on ${broken.map((a) => a!.timeframe).join("/")}`;
  }
  const states = [h1, m15, m5]
    .filter((a) => a !== undefined && a.dataQuality !== "INSUFFICIENT" && a.structure !== "INSUFFICIENT_DATA")
    .map((a) => `${a!.timeframe}:${a!.structure.replace(/_/g, " ").toLowerCase()}`);

  if (states.length === 0) return "Structure data insufficient";
  return `Structure: ${states.join(", ")}`;
}

function buildRegimeNarrative(
  regime: MarketRegime,
  h1: TimeframeAnalysis | undefined,
  m15: TimeframeAnalysis | undefined,
  m5: TimeframeAnalysis | undefined,
  allAligned: boolean,
): string {
  const h1Trend = h1?.trend ?? "UNKNOWN";
  const m15Trend = m15?.trend ?? "UNKNOWN";
  const m5Trend = m5?.trend ?? "UNKNOWN";

  switch (regime) {
    case "TRENDING_UP":
      return allAligned
        ? "Strong bullish alignment across timeframes — trend continuation in progress."
        : "Higher timeframe bullish while some lower timeframes show mixed signals.";
    case "TRENDING_DOWN":
      return allAligned
        ? "Bearish alignment across timeframes — downtrend in progress."
        : "Higher timeframe bearish while some lower timeframes show mixed signals.";
    case "PULLBACK":
      return `H1 ${h1Trend.toLowerCase()} while M15 ${m15Trend.toLowerCase()} — likely a pullback within the higher-timeframe trend. Not a confirmed reversal until structure breaks.`;
    case "RECOVERY":
      return `H1 ${h1Trend.toLowerCase()} while lower timeframes showing early signs of recovery. Watch for M15 confirmation before interpreting as trend change.`;
    case "VOLATILE":
      return "Elevated volatility across timeframes — wider price swings expected. Reduce position sizing or wait for stabilization.";
    case "BREAKOUT":
      return "Structural breakout detected — price has broken through a key level. Watch for follow-through or false breakout.";
    case "BREAKDOWN":
      return "Structural breakdown detected — price has broken below a key level. Watch for continuation or bounce.";
    case "RANGING":
      return "No clear directional trend — market is ranging. Consider range-trading strategies or wait for breakout.";
    default:
      return "Insufficient data for market regime classification.";
  }
}
