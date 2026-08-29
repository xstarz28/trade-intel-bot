/**
 * Phase 89 — Historical Intelligence Timeline
 *
 * Tracks how a position's intelligence state evolves over time.
 * Records meaningful transitions, not every polling cycle.
 * Provides historical summary and current-vs-previous comparison.
 *
 * Pure functions — no side effects, no network calls.
 * All data comes from existing intelligence pipeline.
 */

import type { PositionSide } from "./types";

// ═══════════════════════════════════════════════════════════════
// INTELLIGENCE SNAPSHOT
// ═══════════════════════════════════════════════════════════════

export interface IntelligenceSnapshot {
  /** Timestamp (ms epoch). */
  timestamp: number;
  /** Position ID. */
  positionId: string;
  /** Instrument. */
  instrument: string;
  /** Position side. */
  side: PositionSide;
  /** Thesis health state. */
  thesisState: string;
  /** Evidence quality. */
  evidenceQuality: string;
  /** Market regime. */
  marketRegime: string;
  /** H1 trend. */
  h1Trend: string;
  /** M15 trend. */
  m15Trend: string;
  /** M5 trend. */
  m5Trend: string;
  /** MTF alignment description. */
  mtfAlignment: string;
  /** Momentum state. */
  momentum: string;
  /** Volatility state. */
  volatility: string;
  /** Structure state. */
  structure: string;
  /** Number of supporting evidence items. */
  supportingCount: number;
  /** Number of conflicting evidence items. */
  conflictingCount: number;
  /** Key invalidation condition. */
  invalidationCondition: string;
  /** What to watch next. */
  watchNext: string;
  /** Data/source availability. */
  dataAvailability: string;
}

// ═══════════════════════════════════════════════════════════════
// HISTORICAL EVENT
// ═══════════════════════════════════════════════════════════════

export type HistoricalEventType =
  | "INITIAL_ANALYSIS"
  | "THESIS_CHANGE"
  | "REGIME_CHANGE"
  | "TIMEFRAME_CHANGE"
  | "STRUCTURE_CHANGE"
  | "MOMENTUM_CHANGE"
  | "VOLATILITY_CHANGE"
  | "EVIDENCE_CHANGE"
  | "NEWS_CHANGE"
  | "MACRO_CHANGE"
  | "DATA_QUALITY_CHANGE";

export interface HistoricalEvent {
  /** Timestamp. */
  timestamp: number;
  /** Event type. */
  eventType: HistoricalEventType;
  /** Concise description. */
  description: string;
  /** Previous state value. */
  previousState: string;
  /** Current state value. */
  currentState: string;
  /** Evidence/source category. */
  category: string;
  /** Strength of the change. */
  strength: "STRONG" | "MODERATE" | "WEAK";
}

// ═══════════════════════════════════════════════════════════════
// HISTORICAL TIMELINE
// ═══════════════════════════════════════════════════════════════

export interface HistoricalTimeline {
  /** Position ID. */
  positionId: string;
  /** All historical events, newest first. */
  events: HistoricalEvent[];
  /** Latest snapshot. */
  latestSnapshot: IntelligenceSnapshot | null;
  /** Previous snapshot (for comparison). */
  previousSnapshot: IntelligenceSnapshot | null;
  /** Historical summary. */
  summary: HistoricalSummary | null;
}

export interface HistoricalSummary {
  /** Current thesis state. */
  currentThesis: string;
  /** Previous thesis state. */
  previousThesis: string;
  /** Primary change description. */
  primaryChange: string;
  /** Secondary change description. */
  secondaryChange: string;
  /** Structure status. */
  structure: string;
  /** Supporting evidence count. */
  supportingCount: number;
  /** Conflicting evidence count. */
  conflictingCount: number;
  /** Overall interpretation. */
  interpretation: string;
}

// ═══════════════════════════════════════════════════════════════
// CHANGE DETECTION
// ═══════════════════════════════════════════════════════════════

/** Maximum historical events per position. */
export const MAX_HISTORY_EVENTS = 100;

/**
 * Compare two snapshots and detect meaningful changes.
 * Returns events only for actual transitions — not noise.
 */
export function detectChanges(
  previous: IntelligenceSnapshot | null,
  current: IntelligenceSnapshot,
): HistoricalEvent[] {
  if (!previous) {
    return [{
      timestamp: current.timestamp,
      eventType: "INITIAL_ANALYSIS",
      description: `Initial analysis: ${current.instrument} ${current.side} — ${current.thesisState}`,
      previousState: "—",
      currentState: current.thesisState,
      category: "ANALYSIS",
      strength: "STRONG",
    }];
  }

  const events: HistoricalEvent[] = [];

  // Thesis state change
  if (previous.thesisState !== current.thesisState) {
    events.push({
      timestamp: current.timestamp,
      eventType: "THESIS_CHANGE",
      description: `Thesis: ${previous.thesisState} → ${current.thesisState}`,
      previousState: previous.thesisState,
      currentState: current.thesisState,
      category: "THESIS",
      strength: classifyChangeStrength(previous.thesisState, current.thesisState),
    });
  }

  // Market regime change
  if (previous.marketRegime !== current.marketRegime) {
    events.push({
      timestamp: current.timestamp,
      eventType: "REGIME_CHANGE",
      description: `Regime: ${previous.marketRegime} → ${current.marketRegime}`,
      previousState: previous.marketRegime,
      currentState: current.marketRegime,
      category: "REGIME",
      strength: "MODERATE",
    });
  }

  // H1 trend change
  if (previous.h1Trend !== current.h1Trend) {
    events.push({
      timestamp: current.timestamp,
      eventType: "TIMEFRAME_CHANGE",
      description: `H1: ${previous.h1Trend} → ${current.h1Trend}`,
      previousState: previous.h1Trend,
      currentState: current.h1Trend,
      category: "H1",
      strength: "STRONG",
    });
  }

  // M15 trend change
  if (previous.m15Trend !== current.m15Trend) {
    events.push({
      timestamp: current.timestamp,
      eventType: "TIMEFRAME_CHANGE",
      description: `M15: ${previous.m15Trend} → ${current.m15Trend}`,
      previousState: previous.m15Trend,
      currentState: current.m15Trend,
      category: "M15",
      strength: "MODERATE",
    });
  }

  // M5 trend change
  if (previous.m5Trend !== current.m5Trend) {
    events.push({
      timestamp: current.timestamp,
      eventType: "TIMEFRAME_CHANGE",
      description: `M5: ${previous.m5Trend} → ${current.m5Trend}`,
      previousState: previous.m5Trend,
      currentState: current.m5Trend,
      category: "M5",
      strength: "WEAK",
    });
  }

  // Momentum change
  if (previous.momentum !== current.momentum) {
    events.push({
      timestamp: current.timestamp,
      eventType: "MOMENTUM_CHANGE",
      description: `Momentum: ${previous.momentum} → ${current.momentum}`,
      previousState: previous.momentum,
      currentState: current.momentum,
      category: "MOMENTUM",
      strength: "MODERATE",
    });
  }

  // Volatility change
  if (previous.volatility !== current.volatility) {
    events.push({
      timestamp: current.timestamp,
      eventType: "VOLATILITY_CHANGE",
      description: `Volatility: ${previous.volatility} → ${current.volatility}`,
      previousState: previous.volatility,
      currentState: current.volatility,
      category: "VOLATILITY",
      strength: "MODERATE",
    });
  }

  // Structure break
  if (previous.structure !== current.structure) {
    events.push({
      timestamp: current.timestamp,
      eventType: "STRUCTURE_CHANGE",
      description: `Structure: ${previous.structure} → ${current.structure}`,
      previousState: previous.structure,
      currentState: current.structure,
      category: "STRUCTURE",
      strength: "STRONG",
    });
  }

  // Evidence quality change
  if (previous.evidenceQuality !== current.evidenceQuality) {
    events.push({
      timestamp: current.timestamp,
      eventType: "EVIDENCE_CHANGE",
      description: `Evidence: ${previous.evidenceQuality} → ${current.evidenceQuality}`,
      previousState: previous.evidenceQuality,
      currentState: current.evidenceQuality,
      category: "EVIDENCE",
      strength: "MODERATE",
    });
  }

  // Significant evidence count change (≥2 swing)
  const supportingDelta = current.supportingCount - previous.supportingCount;
  const conflictingDelta = current.conflictingCount - previous.conflictingCount;
  if (Math.abs(supportingDelta) >= 2 || Math.abs(conflictingDelta) >= 2) {
    events.push({
      timestamp: current.timestamp,
      eventType: "EVIDENCE_CHANGE",
      description: `Evidence shift: +${supportingDelta} supporting, +${conflictingDelta} conflicting`,
      previousState: `${previous.supportingCount}S/${previous.conflictingCount}C`,
      currentState: `${current.supportingCount}S/${current.conflictingCount}C`,
      category: "EVIDENCE",
      strength: Math.abs(supportingDelta) >= 3 || Math.abs(conflictingDelta) >= 3 ? "STRONG" : "MODERATE",
    });
  }

  // Data quality change
  if (previous.dataAvailability !== current.dataAvailability) {
    events.push({
      timestamp: current.timestamp,
      eventType: "DATA_QUALITY_CHANGE",
      description: `Data: ${previous.dataAvailability} → ${current.dataAvailability}`,
      previousState: previous.dataAvailability,
      currentState: current.dataAvailability,
      category: "DATA",
      strength: "WEAK",
    });
  }

  return events;
}

function classifyChangeStrength(from: string, to: string): "STRONG" | "MODERATE" | "WEAK" {
  const severity: Record<string, number> = {
    HEALTHY: 1,
    STABLE: 2,
    WATCH: 3,
    CAUTION: 3,
    DETERIORATING: 4,
    SEVERELY_DETERIORATING: 5,
    INVALIDATED: 6,
    UNKNOWN: 0,
  };
  const fromSev = severity[from] ?? 0;
  const toSev = severity[to] ?? 0;
  const delta = Math.abs(toSev - fromSev);
  if (delta >= 3) return "STRONG";
  if (delta >= 2) return "MODERATE";
  return "WEAK";
}

// ═══════════════════════════════════════════════════════════════
// BUILD TIMELINE
// ═══════════════════════════════════════════════════════════════

/**
 * Build or update a historical timeline from new snapshot data.
 * Detects changes, records events, generates summary.
 */
export function buildTimeline(
  existing: HistoricalTimeline | null,
  currentSnapshot: IntelligenceSnapshot,
): HistoricalTimeline {
  const positionId = currentSnapshot.positionId;
  const previousSnapshot = existing?.latestSnapshot ?? null;

  // Detect changes
  const newEvents = detectChanges(previousSnapshot, currentSnapshot);

  // Merge with existing events
  const allEvents = [...newEvents, ...(existing?.events ?? [])];

  // Bound to MAX_HISTORY_EVENTS
  const boundedEvents = allEvents.slice(0, MAX_HISTORY_EVENTS);

  // Build summary
  const summary = generateSummary(previousSnapshot, currentSnapshot, boundedEvents);

  return {
    positionId,
    events: boundedEvents,
    latestSnapshot: currentSnapshot,
    previousSnapshot,
    summary,
  };
}

// ═══════════════════════════════════════════════════════════════
// HISTORICAL SUMMARY
// ═══════════════════════════════════════════════════════════════

export function generateSummary(
  previous: IntelligenceSnapshot | null,
  current: IntelligenceSnapshot,
  events: HistoricalEvent[],
): HistoricalSummary {
  if (!previous) {
    return {
      currentThesis: current.thesisState,
      previousThesis: "—",
      primaryChange: "Initial analysis recorded.",
      secondaryChange: "—",
      structure: current.structure,
      supportingCount: current.supportingCount,
      conflictingCount: current.conflictingCount,
      interpretation: `First analysis for ${current.instrument} ${current.side}. Thesis: ${current.thesisState}.`,
    };
  }

  // Find primary change (most recent strong/moderate event)
  const primaryEvent = events.find(e => e.strength === "STRONG" || e.strength === "MODERATE");
  const secondaryEvent = events.find(e => e !== primaryEvent && (e.strength === "MODERATE" || e.strength === "WEAK"));

  // Build interpretation
  const parts: string[] = [];

  if (previous.h1Trend !== current.h1Trend) {
    parts.push(`H1 shifted from ${previous.h1Trend} to ${current.h1Trend}`);
  }
  if (previous.m15Trend !== current.m15Trend) {
    parts.push(`M15 shifted from ${previous.m15Trend} to ${current.m15Trend}`);
  }
  if (previous.m5Trend !== current.m5Trend) {
    parts.push(`M5 shifted from ${previous.m5Trend} to ${current.m5Trend}`);
  }
  if (previous.marketRegime !== current.marketRegime) {
    parts.push(`Market regime changed from ${previous.marketRegime} to ${current.marketRegime}`);
  }

  const interpretation = parts.length > 0
    ? parts.join(". ") + ". " + (current.supportingCount > current.conflictingCount
      ? "Supporting evidence still outweighs conflicting."
      : current.conflictingCount > current.supportingCount
        ? "Conflicting evidence now outweighs supporting."
        : "Evidence is balanced.")
    : `Thesis remains ${current.thesisState}. No significant structural changes detected.`;

  return {
    currentThesis: current.thesisState,
    previousThesis: previous.thesisState,
    primaryChange: primaryEvent?.description ?? "No significant change.",
    secondaryChange: secondaryEvent?.description ?? "—",
    structure: current.structure,
    supportingCount: current.supportingCount,
    conflictingCount: current.conflictingCount,
    interpretation,
  };
}

// ═══════════════════════════════════════════════════════════════
// CURRENT VS PREVIOUS COMPARISON
// ═══════════════════════════════════════════════════════════════

export interface ComparisonField {
  label: string;
  previous: string;
  current: string;
  changed: boolean;
}

/**
 * Generate current-vs-previous comparison.
 * Only includes fields that changed or are contextually important.
 */
export function compareSnapshots(
  previous: IntelligenceSnapshot | null,
  current: IntelligenceSnapshot,
): ComparisonField[] {
  if (!previous) {
    return [{
      label: "Thesis",
      previous: "—",
      current: current.thesisState,
      changed: true,
    }];
  }

  const fields: ComparisonField[] = [];

  const pairs: [string, string, string][] = [
    ["Thesis", previous.thesisState, current.thesisState],
    ["H1 Trend", previous.h1Trend, current.h1Trend],
    ["M15 Trend", previous.m15Trend, current.m15Trend],
    ["M5 Trend", previous.m5Trend, current.m5Trend],
    ["Regime", previous.marketRegime, current.marketRegime],
    ["Momentum", previous.momentum, current.momentum],
    ["Volatility", previous.volatility, current.volatility],
    ["Structure", previous.structure, current.structure],
    ["Evidence", previous.evidenceQuality, current.evidenceQuality],
  ];

  for (const [label, prev, curr] of pairs) {
    fields.push({
      label,
      previous: prev,
      current: curr,
      changed: prev !== curr,
    });
  }

  return fields;
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT CREATION HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Create a snapshot from available intelligence state.
 * All fields must come from real intelligence pipeline data.
 */
export function createSnapshot(input: {
  positionId: string;
  instrument: string;
  side: PositionSide;
  thesisState: string;
  evidenceQuality: string;
  marketRegime: string;
  h1Trend: string;
  m15Trend: string;
  m5Trend: string;
  mtfAlignment: string;
  momentum: string;
  volatility: string;
  structure: string;
  supportingCount: number;
  conflictingCount: number;
  invalidationCondition: string;
  watchNext: string;
  dataAvailability: string;
  timestamp?: number;
}): IntelligenceSnapshot {
  return {
    timestamp: input.timestamp ?? Date.now(),
    positionId: input.positionId,
    instrument: input.instrument,
    side: input.side,
    thesisState: input.thesisState,
    evidenceQuality: input.evidenceQuality,
    marketRegime: input.marketRegime,
    h1Trend: input.h1Trend,
    m15Trend: input.m15Trend,
    m5Trend: input.m5Trend,
    mtfAlignment: input.mtfAlignment,
    momentum: input.momentum,
    volatility: input.volatility,
    structure: input.structure,
    supportingCount: input.supportingCount,
    conflictingCount: input.conflictingCount,
    invalidationCondition: input.invalidationCondition,
    watchNext: input.watchNext,
    dataAvailability: input.dataAvailability,
  };
}
