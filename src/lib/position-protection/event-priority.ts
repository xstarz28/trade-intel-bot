/**
 * Phase 64 — Event Priority
 *
 * Deterministic event priority computation for the protection controller.
 * Priority determines whether an event should trigger immediate evaluation.
 *
 * Pure functions — no side effects.
 */

import type { RealTimeEvent, EventType } from "./realtime-types";

// ═══════════════════════════════════════════════════════════════
// PRIORITY LEVELS
// ═══════════════════════════════════════════════════════════════

export type EventPriorityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const EVENT_PRIORITY_RANK: Record<EventPriorityLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

// ═══════════════════════════════════════════════════════════════
// EVENT TYPE → PRIORITY MAPPING
// ═══════════════════════════════════════════════════════════════

const CRITICAL_EVENTS: Set<EventType> = new Set([
  "PROVIDER_DEGRADED",
]);

const HIGH_EVENTS: Set<EventType> = new Set([
  "MARKET_STRUCTURE_CHANGE",
  "LIQUIDATION_CHANGE",
  "MACRO_CHANGE",
  "FUNDING_CHANGE",
  "OPEN_INTEREST_CHANGE",
]);

const MEDIUM_EVENTS: Set<EventType> = new Set([
  "MOMENTUM_CHANGE",
  "VOLATILITY_CHANGE",
  "CROSS_ASSET_CHANGE",
  "NEWS_EVENT",
  "FUNDAMENTAL_CHANGE",
  "REGIME_CHANGE",
  "POSITION_UPDATE",
]);

const LOW_EVENTS: Set<EventType> = new Set([
  "PRICE_UPDATE",
  "QUOTE_UPDATE",
  "CANDLE_UPDATE",
  "DATA_STALE",
  "PROVIDER_RECOVERED",
]);

// ═══════════════════════════════════════════════════════════════
// PRIORITY COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute deterministic priority for a market event.
 * CRITICAL events bypass pause and cadence.
 */
export function computeEventPriority(event: RealTimeEvent): EventPriorityLevel {
  // Check payload-based overrides first
  if (event.payload.structureBroken === true) return "HIGH";
  if (event.payload.spike === true) return "HIGH";
  if (event.payload.regime === "risk_off" && event.payload.regimeChanged === true) return "CRITICAL";

  // Check event type
  if (CRITICAL_EVENTS.has(event.eventType)) return "CRITICAL";
  if (HIGH_EVENTS.has(event.eventType)) return "HIGH";
  if (MEDIUM_EVENTS.has(event.eventType)) return "MEDIUM";
  if (LOW_EVENTS.has(event.eventType)) return "LOW";

  // Default: use event's declared priority
  switch (event.priority) {
    case "CRITICAL": return "CRITICAL";
    case "HIGH": return "HIGH";
    case "MEDIUM": return "MEDIUM";
    case "LOW": return "LOW";
  }
}

/**
 * Compare two priority levels.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function comparePriority(a: EventPriorityLevel, b: EventPriorityLevel): number {
  return EVENT_PRIORITY_RANK[a] - EVENT_PRIORITY_RANK[b];
}

/**
 * Check if an event is critical enough to bypass pause.
 */
export function isCriticalEvent(event: RealTimeEvent): boolean {
  return computeEventPriority(event) === "CRITICAL";
}
