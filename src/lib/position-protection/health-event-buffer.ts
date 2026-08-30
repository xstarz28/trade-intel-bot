/**
 * Phase 100 — Health Event Buffer
 *
 * Bounded in-memory buffer for runtime health events.
 * Records actual provider/pipeline execution outcomes.
 * Oldest events evicted first when buffer is full.
 *
 * No fabrication, no probability, no auto-execution.
 */

import type {
  RuntimeHealthEvent,
  RuntimeComponent,
  RuntimeHealthStatus,
  RuntimeHealthSnapshot,
  RuntimeHealthInput,
} from "./runtime-health";
import {
  MAX_RUNTIME_HEALTH_EVENTS,
  normalizeRuntimeHealthEvent,
  aggregateRuntimeHealth,
  shouldPersistRuntimeHealth,
  buildRuntimeHealthSnapshot,
  calculateOverallHealth,
} from "./runtime-health";

// ═══════════════════════════════════════════════════════════════
// BUFFER STATE
// ═══════════════════════════════════════════════════════════════

export interface HealthEventBuffer {
  /** Bounded array of events, newest last */
  events: RuntimeHealthEvent[];
  /** Last persisted snapshot for change detection */
  lastPersistedSnapshot: RuntimeHealthSnapshot | null;
}

/** Create a fresh empty buffer */
export function createHealthEventBuffer(): HealthEventBuffer {
  return { events: [], lastPersistedSnapshot: null };
}

// ═══════════════════════════════════════════════════════════════
// RECORD EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Record a health event into the buffer.
 * Bounded — oldest events evicted when full.
 * Returns new buffer (immutable update).
 */
export function recordHealthEvent(
  buffer: HealthEventBuffer,
  event: RuntimeHealthEvent,
): HealthEventBuffer {
  const events = [...buffer.events, event];

  // Evict oldest if over bound
  const trimmed =
    events.length > MAX_RUNTIME_HEALTH_EVENTS
      ? events.slice(events.length - MAX_RUNTIME_HEALTH_EVENTS)
      : events;

  return {
    ...buffer,
    events: trimmed,
  };
}

/**
 * Record a provider execution result as a health event.
 * Convenience wrapper around normalizeRuntimeHealthEvent.
 */
export function recordProviderResult(
  buffer: HealthEventBuffer,
  params: {
    component: RuntimeComponent;
    source?: string;
    operation?: string;
    success: boolean;
    durationMs?: number;
    error?: unknown;
    message?: string;
  },
): HealthEventBuffer {
  const event = normalizeRuntimeHealthEvent({ ...params, timestamp: Date.now() });
  return recordHealthEvent(buffer, event);
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATE + PERSIST DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Build a health snapshot from the current buffer state.
 * Pure function.
 */
export function buildSnapshotFromBuffer(
  buffer: HealthEventBuffer,
  now: number,
  inputOverrides?: Partial<RuntimeHealthInput>,
): RuntimeHealthSnapshot {
  // Aggregate from events
  const components = aggregateRuntimeHealth(buffer.events, now);

  // Recalculate overall health from event-aggregated components
  const overallStatus = calculateOverallHealth(components);

  // Build snapshot using existing builder with event-aggregated components
  const baseSnapshot = buildRuntimeHealthSnapshot(inputOverrides ?? {}, now);

  // Override with event-aggregated data
  const staleComponents = components
    .filter((c) => c.freshness === "STALE" || c.freshness === "AGING")
    .map((c) => c.component);
  const unavailableComponents = components
    .filter((c) => c.status === "UNAVAILABLE")
    .map((c) => c.component);

  // Provider availability from events
  const providerAvailability: Record<string, RuntimeHealthStatus> = {};
  for (const c of components) {
    if (c.source) {
      providerAvailability[c.source] = c.status;
    }
  }

  return {
    ...baseSnapshot,
    timestamp: now,
    overallStatus,
    components,
    staleComponents,
    unavailableComponents,
    providerAvailability,
  };
}

/**
 * Decide whether to persist based on buffer state.
 * Returns the new snapshot if persistence is warranted, null otherwise.
 */
export function shouldPersistFromBuffer(
  buffer: HealthEventBuffer,
  now: number,
): RuntimeHealthSnapshot | null {
  const snapshot = buildSnapshotFromBuffer(buffer, now);

  if (shouldPersistRuntimeHealth(buffer.lastPersistedSnapshot, snapshot)) {
    return snapshot;
  }

  return null;
}

/**
 * Mark that a snapshot was persisted.
 * Returns updated buffer.
 */
export function markPersisted(
  buffer: HealthEventBuffer,
  snapshot: RuntimeHealthSnapshot,
): HealthEventBuffer {
  return {
    ...buffer,
    lastPersistedSnapshot: snapshot,
  };
}

// ═══════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════

/** Get the most recent event for a specific component */
export function getLatestEventForComponent(
  buffer: HealthEventBuffer,
  component: RuntimeComponent,
): RuntimeHealthEvent | null {
  for (let i = buffer.events.length - 1; i >= 0; i--) {
    if (buffer.events[i].component === component) return buffer.events[i];
  }
  return null;
}

/** Get all events for a specific component */
export function getEventsForComponent(
  buffer: HealthEventBuffer,
  component: RuntimeComponent,
): RuntimeHealthEvent[] {
  return buffer.events.filter((e) => e.component === component);
}

/** Get total event count */
export function getEventCount(buffer: HealthEventBuffer): number {
  return buffer.events.length;
}
