/**
 * Phase 90 — Persistent History Engine
 *
 * Bridges Phase 89's IntelligenceSnapshot + change detection with Convex persistence.
 * Handles:
 * - Snapshot diffing against persisted state
 * - Meaningful event persistence (not every cycle)
 * - Timeline reconstruction from Convex
 * - Bounded retention
 * - Position cleanup
 *
 * Pure logic + Convex persistence operations.
 */

import type {
  IntelligenceSnapshot,
  HistoricalEvent,
  HistoricalTimeline,
} from "./historical-intelligence";
import { detectChanges, generateSummary, MAX_HISTORY_EVENTS } from "./historical-intelligence";

export { generateSummary };

// ═══════════════════════════════════════════════════════════════
// EVENT IDENTITY + DEDUP
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic event identity for deduplication.
 * Same timestamp + eventType + description = same event.
 * Used by both Convex server-side and client-side merge.
 */
export function eventIdentity(e: HistoricalEvent): string {
  return `${e.timestamp}|${e.eventType}|${e.description}`;
}

// ═══════════════════════════════════════════════════════════════
// LOCAL + PERSISTED MERGE
// ═══════════════════════════════════════════════════════════════

/**
 * Merge local timeline events with persisted timeline events.
 * Deduplicates by eventIdentity to prevent double-counting.
 * Preserves chronological ordering (newest first).
 */
export function mergeTimelineEvents(
  localEvents: HistoricalEvent[],
  persistedEvents: HistoricalEvent[],
): HistoricalEvent[] {
  const seen = new Set<string>();
  const merged: HistoricalEvent[] = [];

  // Add persisted events first (authoritative source)
  for (const event of persistedEvents) {
    const id = eventIdentity(event);
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(event);
    }
  }

  // Add local events that don't exist in persisted
  for (const event of localEvents) {
    const id = eventIdentity(event);
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(event);
    }
  }

  // Sort newest first, bound to MAX_HISTORY_EVENTS
  return merged
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_HISTORY_EVENTS);
}

/**
 * Merge two IntelligenceSnapshots to produce the best available version.
 * Prefers the newer timestamp.
 */
export function mergeSnapshots(
  local: IntelligenceSnapshot | null,
  persisted: IntelligenceSnapshot | null,
): IntelligenceSnapshot | null {
  if (!local) return persisted;
  if (!persisted) return local;
  return local.timestamp >= persisted.timestamp ? local : persisted;
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE RACE CONDITION GUARD
// ═══════════════════════════════════════════════════════════════

/**
 * Snapshot identity for deduplication against in-flight mutations.
 * A snapshot with the same timestamp+positionId+thesisState should not
 * be persisted twice even if two intelligence cycles fire before the
 * first mutation completes.
 */
export function snapshotIdentity(s: IntelligenceSnapshot): string {
  return `${s.timestamp}|${s.positionId}|${s.thesisState}|${s.marketRegime}|${s.h1Trend}|${s.structure}`;
}

/**
 * Check whether a new snapshot is meaningfully different from the
 * last-persisted snapshot identity, preventing redundant saves.
 */
export function isSnapshotStale(
  newSnapshot: IntelligenceSnapshot,
  lastPersistedIdentity: string | null,
): boolean {
  if (!lastPersistedIdentity) return false;
  return snapshotIdentity(newSnapshot) === lastPersistedIdentity;
}

// ═══════════════════════════════════════════════════════════════
// PERSISTED DATA MODELS
// ═══════════════════════════════════════════════════════════════

/** Shape of a Convex-persisted historical snapshot row. */
export interface PersistedSnapshot {
  _id: string;
  _creationTime: number;
  userId: string;
  positionId: string;
  instrument: string;
  side: string;
  timestamp: number;
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
}

/** Shape of a Convex-persisted historical event row. */
export interface PersistedEvent {
  _id: string;
  _creationTime: number;
  userId: string;
  positionId: string;
  instrument: string;
  side: string;
  timestamp: number;
  eventType: string;
  description: string;
  previousState: string;
  currentState: string;
  category: string;
  strength: string;
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT ↔ PERSISTED CONVERSION
// ═══════════════════════════════════════════════════════════════

/** Convert a persisted snapshot row into an IntelligenceSnapshot. */
export function persistedToSnapshot(row: PersistedSnapshot): IntelligenceSnapshot {
  return {
    timestamp: row.timestamp,
    positionId: row.positionId,
    instrument: row.instrument,
    side: row.side as IntelligenceSnapshot["side"],
    thesisState: row.thesisState,
    evidenceQuality: row.evidenceQuality,
    marketRegime: row.marketRegime,
    h1Trend: row.h1Trend,
    m15Trend: row.m15Trend,
    m5Trend: row.m5Trend,
    mtfAlignment: row.mtfAlignment,
    momentum: row.momentum,
    volatility: row.volatility,
    structure: row.structure,
    supportingCount: row.supportingCount,
    conflictingCount: row.conflictingCount,
    invalidationCondition: row.invalidationCondition,
    watchNext: row.watchNext,
    dataAvailability: row.dataAvailability,
  };
}

/** Convert a persisted event row into a HistoricalEvent. */
export function persistedToEvent(row: PersistedEvent): HistoricalEvent {
  return {
    timestamp: row.timestamp,
    eventType: row.eventType as HistoricalEvent["eventType"],
    description: row.description,
    previousState: row.previousState,
    currentState: row.currentState,
    category: row.category,
    strength: row.strength as HistoricalEvent["strength"],
  };
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT ARGS FOR CONVEX
// ═══════════════════════════════════════════════════════════════

/** Shape of args needed by Convex saveSnapshot mutation. */
export function snapshotToArgs(snapshot: IntelligenceSnapshot) {
  return {
    positionId: snapshot.positionId,
    instrument: snapshot.instrument,
    side: snapshot.side,
    timestamp: snapshot.timestamp,
    thesisState: snapshot.thesisState,
    evidenceQuality: snapshot.evidenceQuality,
    marketRegime: snapshot.marketRegime,
    h1Trend: snapshot.h1Trend,
    m15Trend: snapshot.m15Trend,
    m5Trend: snapshot.m5Trend,
    mtfAlignment: snapshot.mtfAlignment,
    momentum: snapshot.momentum,
    volatility: snapshot.volatility,
    structure: snapshot.structure,
    supportingCount: snapshot.supportingCount,
    conflictingCount: snapshot.conflictingCount,
    invalidationCondition: snapshot.invalidationCondition,
    watchNext: snapshot.watchNext,
    dataAvailability: snapshot.dataAvailability,
  };
}

/** Shape of args needed by Convex saveEvents mutation. */
export function eventsToArgs(
  positionId: string,
  instrument: string,
  side: string,
  events: HistoricalEvent[],
) {
  return {
    positionId,
    instrument,
    side,
    events: events.map((e) => ({
      timestamp: e.timestamp,
      eventType: e.eventType,
      description: e.description,
      previousState: e.previousState,
      currentState: e.currentState,
      category: e.category,
      strength: e.strength,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE DECISION
// ═══════════════════════════════════════════════════════════════

export interface PersistenceDecision {
  /** Whether to persist the new snapshot. */
  shouldPersistSnapshot: boolean;
  /** Whether there are meaningful new events. */
  shouldPersistEvents: boolean;
  /** The detected events (empty if none). */
  newEvents: HistoricalEvent[];
  /** Whether this is the initial snapshot (no previous). */
  isInitial: boolean;
}

/**
 * Decide whether to persist based on change detection.
 * - Initial snapshot: always persist
 * - Meaningful changes: persist snapshot + events
 * - No meaningful changes: do NOT persist (avoid spam)
 */
export function decidePersistence(
  previousSnapshot: IntelligenceSnapshot | null,
  currentSnapshot: IntelligenceSnapshot,
): PersistenceDecision {
  const newEvents = detectChanges(previousSnapshot, currentSnapshot);
  const isInitial = !previousSnapshot;

  // Initial: always persist
  if (isInitial) {
    return {
      shouldPersistSnapshot: true,
      shouldPersistEvents: true,
      newEvents,
      isInitial: true,
    };
  }

  // Has meaningful events: persist
  if (newEvents.length > 0) {
    return {
      shouldPersistSnapshot: true,
      shouldPersistEvents: true,
      newEvents,
      isInitial: false,
    };
  }

  // No changes: skip persistence
  return {
    shouldPersistSnapshot: false,
    shouldPersistEvents: false,
    newEvents: [],
    isInitial: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// TIMELINE RECONSTRUCTION FROM CONVEX
// ═══════════════════════════════════════════════════════════════

/**
 * Reconstruct a HistoricalTimeline from persisted Convex data.
 * This replaces the local-only Phase 89 timeline with one backed by Convex.
 */
export function reconstructTimeline(
  persistedSnapshots: PersistedSnapshot[],
  persistedEvents: PersistedEvent[],
): HistoricalTimeline {
  // Sort snapshots descending by timestamp
  const sorted = [...persistedSnapshots].sort((a, b) => b.timestamp - a.timestamp);
  const latestSnapshot = sorted[0] ? persistedToSnapshot(sorted[0]) : null;
  const previousSnapshot = sorted[1] ? persistedToSnapshot(sorted[1]) : null;

  // Sort events descending by timestamp, bounded
  const sortedEvents = [...persistedEvents]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_HISTORY_EVENTS);

  const events = sortedEvents.map(persistedToEvent);

  // Rebuild summary from persisted data
  const summary = latestSnapshot
    ? generateSummary(previousSnapshot, latestSnapshot, events)
    : null;

  return {
    positionId: latestSnapshot?.positionId ?? persistedSnapshots[0]?.positionId ?? "",
    events,
    latestSnapshot,
    previousSnapshot,
    summary,
  };
}
