/**
 * Phase 58 — Real-Time Event Model
 *
 * Event types for the real-time position monitoring system.
 * Every event carries provenance, freshness, and dependency group.
 */

import type { AlertSeverity } from "./types";

// ═══════════════════════════════════════════════════════════════
// EVENT TYPES
// ═══════════════════════════════════════════════════════════════

export type EventType =
  | "PRICE_UPDATE"
  | "QUOTE_UPDATE"
  | "CANDLE_UPDATE"
  | "MARKET_STRUCTURE_CHANGE"
  | "MOMENTUM_CHANGE"
  | "VOLATILITY_CHANGE"
  | "DERIVATIVES_CHANGE"
  | "FUNDING_CHANGE"
  | "OPEN_INTEREST_CHANGE"
  | "LIQUIDATION_CHANGE"
  | "CROSS_ASSET_CHANGE"
  | "MACRO_CHANGE"
  | "NEWS_EVENT"
  | "FUNDAMENTAL_CHANGE"
  | "REGIME_CHANGE"
  | "POSITION_UPDATE"
  | "DATA_STALE"
  | "PROVIDER_DEGRADED"
  | "PROVIDER_RECOVERED";

// ═══════════════════════════════════════════════════════════════
// PRIORITY
// ═══════════════════════════════════════════════════════════════

export type EventPriority =
  | "CRITICAL"    // thesis invalidation, extreme shock
  | "HIGH"        // multi-signal reversal, major event
  | "MEDIUM"      // profit giveback, single deterioration
  | "LOW";        // normal market update

export const EVENT_PRIORITY_ORDER: EventPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME
// ═══════════════════════════════════════════════════════════════

export type Timeframe = "TICK" | "M1" | "M5" | "M15" | "H1" | "H4" | "D1";

export const TIMEFRAME_ORDER: Timeframe[] = ["TICK", "M1", "M5", "M15", "H1", "H4", "D1"];

// ═══════════════════════════════════════════════════════════════
// MONITORING STATUS
// ═══════════════════════════════════════════════════════════════

export type MonitoringStatus = "LIVE" | "RECONNECTING" | "DATA_STALE" | "PAUSED";

// ═══════════════════════════════════════════════════════════════
// REAL-TIME EVENT
// ═══════════════════════════════════════════════════════════════

export interface RealTimeEvent {
  /** Unique event ID (deterministic fingerprint). */
  eventId: string;
  /** Instrument this event pertains to. */
  instrument: string;
  /** Position ID this event pertains to (if position-specific). */
  positionId?: string;
  /** Event timestamp. */
  timestamp: number;
  /** Source provider/adapter. */
  source: string;
  /** Data freshness. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Event type. */
  eventType: EventType;
  /** Priority. */
  priority: EventPriority;
  /** Timeframe of the data (if applicable). */
  timeframe?: Timeframe;
  /** Dependency group for deduplication. */
  dependencyGroup: string;
  /** Event payload — key-value data specific to event type. */
  payload: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// POSITION SNAPSHOT (for monitoring)
// ═══════════════════════════════════════════════════════════════

export interface PositionSnapshot {
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
  horizon: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
  openedAt: number;
  /** Peak favorable price observed. */
  peakPrice?: number;
  /** Last update timestamp. */
  lastUpdateAt: number;
  /** Monitoring status. */
  monitoringStatus: MonitoringStatus;
}

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT STATE
// ═══════════════════════════════════════════════════════════════

export interface InstrumentState {
  instrument: string;
  /** Last known price. */
  lastPrice: number;
  /** Last update timestamp. */
  lastUpdateAt: number;
  /** Recent price changes for momentum detection. */
  recentChanges: number[];
  /** Current volatility estimate. */
  volatility?: number;
  /** Average volatility. */
  avgVolatility?: number;
  /** Last known funding rate (crypto). */
  fundingRate?: number;
  /** Last known OI change (crypto). */
  oiChange?: number;
  /** Last known VIX. */
  vix?: number;
  /** Risk regime. */
  riskRegime?: "risk_on" | "risk_off" | "transition" | "unknown";
  /** Provider status. */
  providerStatus: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  /** Events processed count. */
  eventsProcessed: number;
}

// ═══════════════════════════════════════════════════════════════
// PROTECTION EVENT (output)
// ═══════════════════════════════════════════════════════════════

export type NotificationPriority = "INFO" | "WARNING" | "URGENT" | "CRITICAL";

export interface ProtectionEvent {
  /** Unique event ID. */
  eventId: string;
  /** Position ID. */
  positionId: string;
  /** Instrument. */
  instrument: string;
  /** Notification priority. */
  notificationPriority: NotificationPriority;
  /** Alert severity from Phase 57. */
  severity: AlertSeverity;
  /** Action recommendation. */
  action: string;
  /** Concise reason. */
  reason: string;
  /** Current profit info. */
  currentProfit?: { rMultiple?: number; givebackPct?: number; distanceFromEntryPct: number };
  /** Timestamp. */
  timestamp: number;
  /** Whether this is a state transition. */
  stateTransition: boolean;
  /** Previous severity. */
  previousSeverity?: AlertSeverity;
  /** Whether this has been acknowledged. */
  acknowledged: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ALERT HISTORY ENTRY
// ═══════════════════════════════════════════════════════════════

export interface AlertHistoryEntry {
  positionId: string;
  instrument: string;
  severity: AlertSeverity;
  notificationPriority: NotificationPriority;
  reason: string;
  action: string;
  timestamp: number;
  acknowledged: boolean;
}
