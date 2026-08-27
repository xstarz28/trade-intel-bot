/**
 * Phase 59 — Live Market Stream Types
 *
 * Provider-independent stream abstraction for real-time market data.
 * Every stream event carries provenance, freshness, and identity validation.
 *
 * INFORMATIONAL_ONLY — never modifies decision engine.
 */

// ═══════════════════════════════════════════════════════════════
// STREAM STATUS
// ═══════════════════════════════════════════════════════════════

export type StreamStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "LIVE"
  | "DEGRADED"
  | "RECONNECTING"
  | "STALE"
  | "FAILED"
  | "STREAM_UNAVAILABLE";

// ═══════════════════════════════════════════════════════════════
// STREAM EVENT
// ═══════════════════════════════════════════════════════════════

export interface StreamEvent {
  /** Unique event identifier. */
  eventId: string;
  /** Provider name. */
  provider: string;
  /** Canonical instrument identity. */
  instrument: string;
  /** Provider-specific symbol. */
  providerSymbol: string;
  /** Asset class. */
  assetClass: "crypto" | "forex" | "equity" | "commodity" | "indices" | "macro";
  /** Event type category. */
  eventType:
    | "QUOTE"
    | "OHLCV"
    | "ORDER_BOOK"
    | "FUNDING"
    | "OI"
    | "LIQUIDATION"
    | "NEWS"
    | "HEARTBEAT"
    | "STATUS"
    | "ERROR";
  /** Timestamp from provider (ms epoch). */
  timestamp: number;
  /** Local received timestamp (ms epoch). */
  receivedAt: number;
  /** Provider sequence number if available. */
  sequence?: number;
  /** Data freshness. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Dependency group for dedup. */
  dependencyGroup: string;
  /** Event payload. */
  payload: StreamPayload;
}

// ═══════════════════════════════════════════════════════════════
// STREAM PAYLOAD
// ═══════════════════════════════════════════════════════════════

export interface StreamPayload {
  /** Last price. */
  price?: number;
  /** Bid. */
  bid?: number;
  /** Ask. */
  ask?: number;
  /** Spread. */
  spread?: number;
  /** 24h volume. */
  volume24h?: number;
  /** 24h change %. */
  change24h?: number;
  /** OHLCV candle. */
  candle?: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timeframe: string;
  };
  /** Funding rate (crypto perp). */
  fundingRate?: number;
  /** Open interest. */
  openInterest?: number;
  /** OI change %. */
  oiChange?: number;
  /** Liquidation volume. */
  liquidationVolume?: number;
  /** Bid depth. */
  bidDepth?: number;
  /** Ask depth. */
  askDepth?: number;
  /** Raw data from provider. */
  raw?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// SYMBOL MAPPING
// ═══════════════════════════════════════════════════════════════

export interface SymbolMapping {
  /** Canonical instrument ID. */
  canonical: string;
  /** Provider-specific symbol. */
  providerSymbol: string;
  /** Provider name. */
  provider: string;
  /** Asset class. */
  assetClass: string;
  /** Quote currency. */
  quoteCurrency: string;
  /** Whether the mapping has been validated. */
  validated: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STREAM HEALTH
// ═══════════════════════════════════════════════════════════════

export type ProviderHealth =
  | "HEALTHY"
  | "DEGRADED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "AUTH_ERROR"
  | "MALFORMED_RESPONSE";

export interface StreamHealthState {
  provider: string;
  status: StreamStatus;
  health: ProviderHealth;
  /** Last message received timestamp. */
  lastMessageAt: number;
  /** Connection uptime in ms. */
  uptimeMs: number;
  /** Total events received. */
  eventsReceived: number;
  /** Total events dropped (duplicate/out-of-order). */
  eventsDropped: number;
  /** Total reconnection attempts. */
  reconnectAttempts: number;
  /** Last error message. */
  lastError?: string;
  /** Whether heartbeat is alive. */
  heartbeatAlive: boolean;
  /** Monitoring gap in ms (disconnect duration). */
  monitoringGapMs: number;
}

// ═══════════════════════════════════════════════════════════════
// STREAM CONFIG
// ═══════════════════════════════════════════════════════════════

export interface StreamConfig {
  /** Provider name. */
  provider: string;
  /** Instruments to subscribe to. */
  instruments: string[];
  /** Reconnect max attempts. */
  maxReconnectAttempts: number;
  /** Heartbeat interval (ms). */
  heartbeatIntervalMs: number;
  /** Stale threshold (ms). */
  staleThresholdMs: number;
  /** Request timeout (ms). */
  requestTimeoutMs: number;
  /** Max backoff (ms). */
  maxBackoffMs: number;
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  provider: "",
  instruments: [],
  maxReconnectAttempts: 10,
  heartbeatIntervalMs: 30_000,
  staleThresholdMs: 60_000,
  requestTimeoutMs: 15_000,
  maxBackoffMs: 30_000,
};

// ═══════════════════════════════════════════════════════════════
// POSITION REGISTRATION
// ═══════════════════════════════════════════════════════════════

export type PositionLifecycle =
  | "REGISTERED"
  | "MONITORING"
  | "PAUSED"
  | "CLOSED";

export interface RegisteredPosition {
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
  horizon: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
  openedAt: number;
  lifecycle: PositionLifecycle;
  /** Current monitoring state snapshot. */
  monitoringStateHash?: string;
}

// ═══════════════════════════════════════════════════════════════
// RECONCILIATION
// ═══════════════════════════════════════════════════════════════

export interface ReconciliationResult {
  /** Whether reconciliation succeeded. */
  success: boolean;
  /** Gap duration in ms. */
  gapDurationMs: number;
  /** Whether gap data was available. */
  gapDataAvailable: boolean;
  /** Events missed during gap. */
  eventsMissed: number;
  /** Current market price after reconnect. */
  currentPrice: number;
  /** Timestamp of current price. */
  currentTimestamp: number;
  /** Whether state was reconciled. */
  stateReconciled: boolean;
  /** Description. */
  description: string;
}
