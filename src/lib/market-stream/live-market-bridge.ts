/**
 * Phase 63 — Live Market Data Bridge
 *
 * Bridges available provider market data (Twelve Data, CoinGecko, CoinGlass, OKX)
 * into the existing RealTimeEvent monitoring pipeline.
 *
 * Converts raw market data from Convex/provider infrastructure into typed
 * RealTimeEvents that the realtime-monitor can process.
 *
 * Does NOT create fake WebSocket functionality.
 * Falls back to POLLING mode when streaming is unavailable.
 *
 * Pure functions — no side effects in event creation.
 */

import type { RealTimeEvent, EventType, EventPriority, Timeframe } from "../position-protection/realtime-types";
import {
  createPriceEvent,
  createQuoteEvent,
  createCandleEvent,
  createVolatilityChangeEvent,
  createFundingChangeEvent,
  createOIChangeEvent,
  createLiquidationChangeEvent,
  createCrossAssetEvent,
  createMacroChangeEvent,
  createDataStaleEvent,
  createProviderDegradedEvent,
  createProviderRecoveredEvent,
} from "../position-protection/market-event-bridge";

// ═══════════════════════════════════════════════════════════════
// PROVIDER DATA TYPES
// ═══════════════════════════════════════════════════════════════

export type DataSourceMode = "POLLING" | "LIVE_STREAM" | "DEGRADED" | "UNAVAILABLE";

export interface ProviderQuoteData {
  instrument: string;
  provider: string;
  price: number;
  bid?: number;
  ask?: number;
  volume24h?: number;
  change24h?: number;
  timestamp: number;
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
}

export interface ProviderCandleData {
  instrument: string;
  provider: string;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface ProviderDerivativesData {
  instrument: string;
  provider: string;
  fundingRate?: number;
  openInterestChange?: number;
  liquidationSpike?: boolean;
  timestamp: number;
}

export interface ProviderMacroData {
  instrument: string;
  provider: string;
  vix?: number;
  riskRegime?: "risk_on" | "risk_off" | "transition" | "unknown";
  riskRegimeChanged?: boolean;
  timestamp: number;
}

export interface ProviderCrossAssetData {
  instrument: string;
  correlatedAsset: string;
  divergence: boolean;
  provider: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// BRIDGE STATE
// ═══════════════════════════════════════════════════════════════

export interface LiveMarketBridgeState {
  /** Per-instrument data mode. */
  instrumentModes: Map<string, DataSourceMode>;
  /** Per-instrument last event timestamp. */
  lastEventAt: Map<string, number>;
  /** Per-provider status. */
  providerStatus: Map<string, DataSourceMode>;
  /** Total events bridged. */
  eventsBridged: number;
  /** Total events dropped. */
  eventsDropped: number;
}

export function createBridgeState(): LiveMarketBridgeState {
  return {
    instrumentModes: new Map(),
    lastEventAt: new Map(),
    providerStatus: new Map(),
    eventsBridged: 0,
    eventsDropped: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// QUOTE → EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert provider quote data into RealTimeEvents.
 * Returns a price update event and optionally a quote update event.
 */
export function bridgeQuoteToEvents(
  state: LiveMarketBridgeState,
  quote: ProviderQuoteData,
): { events: RealTimeEvent[]; state: LiveMarketBridgeState } {
  const events: RealTimeEvent[] = [];
  const updatedState = { ...state };

  // Validate data integrity
  if (!quote.instrument || quote.instrument.trim().length === 0) {
    return { events, state: { ...updatedState, eventsDropped: updatedState.eventsDropped + 1 } };
  }
  if (!Number.isFinite(quote.price) || quote.price <= 0) {
    return { events, state: { ...updatedState, eventsDropped: updatedState.eventsDropped + 1 } };
  }

  // Check freshness — if stale, emit DATA_STALE event
  if (quote.freshness === "STALE" || quote.freshness === "UNAVAILABLE") {
    events.push(createDataStaleEvent(quote.instrument, quote.provider, Date.now() - quote.timestamp));
    updatedState.eventsDropped++;
    updatedState.instrumentModes.set(quote.instrument, "DEGRADED");
    return { events, state: updatedState };
  }

  // Emit price update
  events.push(createPriceEvent(
    quote.instrument,
    quote.price,
    quote.provider,
    {
      bid: quote.bid,
      ask: quote.ask,
      volume24h: quote.volume24h,
      change24h: quote.change24h,
      timestamp: quote.timestamp,
    },
  ));

  // Emit quote update if bid/ask available
  if (quote.bid !== undefined && quote.ask !== undefined) {
    events.push(createQuoteEvent(
      quote.instrument,
      quote.price,
      quote.bid,
      quote.ask,
      quote.provider,
      quote.timestamp,
    ));
  }

  // Update state
  updatedState.eventsBridged += events.length;
  updatedState.lastEventAt.set(quote.instrument, quote.timestamp);
  updatedState.instrumentModes.set(quote.instrument, "POLLING");
  updatedState.providerStatus.set(quote.provider, "POLLING");

  return { events, state: updatedState };
}

// ═══════════════════════════════════════════════════════════════
// CANDLE → EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert provider candle data into RealTimeEvents.
 */
export function bridgeCandleToEvents(
  state: LiveMarketBridgeState,
  candle: ProviderCandleData,
): { events: RealTimeEvent[]; state: LiveMarketBridgeState } {
  const updatedState = { ...state };
  const events: RealTimeEvent[] = [];

  if (!candle.instrument || candle.instrument.trim().length === 0) {
    return { events, state: { ...updatedState, eventsDropped: updatedState.eventsDropped + 1 } };
  }

  events.push(createCandleEvent(
    candle.instrument,
    {
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    },
    candle.timeframe,
    candle.provider,
    candle.timestamp,
  ));

  // Also emit price update from candle close
  events.push(createPriceEvent(
    candle.instrument,
    candle.close,
    candle.provider,
    { timestamp: candle.timestamp },
  ));

  updatedState.eventsBridged += events.length;
  updatedState.lastEventAt.set(candle.instrument, candle.timestamp);

  return { events, state: updatedState };
}

// ═══════════════════════════════════════════════════════════════
// DERIVATIVES → EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert provider derivatives data into RealTimeEvents.
 */
export function bridgeDerivativesToEvents(
  state: LiveMarketBridgeState,
  data: ProviderDerivativesData,
): { events: RealTimeEvent[]; state: LiveMarketBridgeState } {
  const updatedState = { ...state };
  const events: RealTimeEvent[] = [];

  if (!data.instrument || data.instrument.trim().length === 0) {
    return { events, state: { ...updatedState, eventsDropped: updatedState.eventsDropped + 1 } };
  }

  if (data.fundingRate !== undefined) {
    events.push(createFundingChangeEvent(data.instrument, data.fundingRate, data.provider));
  }

  if (data.openInterestChange !== undefined) {
    events.push(createOIChangeEvent(data.instrument, data.openInterestChange, data.provider));
  }

  if (data.liquidationSpike !== undefined) {
    events.push(createLiquidationChangeEvent(
      data.instrument,
      data.liquidationSpike,
      0, // volume unknown from bridge
      data.provider,
    ));
  }

  updatedState.eventsBridged += events.length;
  updatedState.lastEventAt.set(data.instrument, data.timestamp);

  return { events, state: updatedState };
}

// ═══════════════════════════════════════════════════════════════
// MACRO → EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert provider macro data into RealTimeEvents.
 */
export function bridgeMacroToEvents(
  state: LiveMarketBridgeState,
  data: ProviderMacroData,
): { events: RealTimeEvent[]; state: LiveMarketBridgeState } {
  const updatedState = { ...state };
  const events: RealTimeEvent[] = [];

  if (!data.instrument || data.instrument.trim().length === 0) {
    return { events, state: { ...updatedState, eventsDropped: updatedState.eventsDropped + 1 } };
  }

  if (data.riskRegime !== undefined && data.riskRegimeChanged) {
    events.push(createMacroChangeEvent(data.instrument, data.riskRegime, data.provider));
  }

  updatedState.eventsBridged += events.length;
  updatedState.lastEventAt.set(data.instrument, data.timestamp);

  return { events, state: updatedState };
}

// ═══════════════════════════════════════════════════════════════
// CROSS-ASSET → EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert provider cross-asset data into RealTimeEvents.
 */
export function bridgeCrossAssetToEvents(
  state: LiveMarketBridgeState,
  data: ProviderCrossAssetData,
): { events: RealTimeEvent[]; state: LiveMarketBridgeState } {
  const updatedState = { ...state };
  const events: RealTimeEvent[] = [];

  if (!data.instrument || data.instrument.trim().length === 0) {
    return { events, state: { ...updatedState, eventsDropped: updatedState.eventsDropped + 1 } };
  }

  events.push(createCrossAssetEvent(
    data.instrument,
    data.correlatedAsset,
    data.divergence,
    data.provider,
  ));

  updatedState.eventsBridged += events.length;
  updatedState.lastEventAt.set(data.instrument, data.timestamp);

  return { events, state: updatedState };
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER LIFECYCLE
// ═══════════════════════════════════════════════════════════════

/**
 * Handle provider connection/disconnection/degradation.
 * Returns appropriate RealTimeEvents for affected instruments.
 */
export function bridgeProviderStatusChange(
  state: LiveMarketBridgeState,
  provider: string,
  instruments: string[],
  status: "connected" | "disconnected" | "degraded" | "recovered",
  reason?: string,
): { events: RealTimeEvent[]; state: LiveMarketBridgeState } {
  const updatedState = { ...state };
  const events: RealTimeEvent[] = [];

  if (status === "disconnected" || status === "degraded") {
    for (const instrument of instruments) {
      events.push(createProviderDegradedEvent(
        instrument,
        provider,
        reason ?? `Provider ${provider} ${status}`,
      ));
      updatedState.instrumentModes.set(instrument, "DEGRADED");
    }
    updatedState.providerStatus.set(provider, "DEGRADED");
  } else if (status === "recovered" || status === "connected") {
    for (const instrument of instruments) {
      events.push(createProviderRecoveredEvent(instrument, provider));
      updatedState.instrumentModes.set(instrument, "POLLING");
    }
    updatedState.providerStatus.set(provider, "POLLING");
  }

  updatedState.eventsBridged += events.length;
  return { events, state: updatedState };
}

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT IDENTITY VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate that an instrument symbol is properly formatted.
 * Returns null if valid, or a sanitized version.
 */
export function validateInstrumentIdentity(instrument: string): {
  valid: boolean;
  canonical: string;
  reason?: string;
} {
  if (!instrument || instrument.trim().length === 0) {
    return { valid: false, canonical: "", reason: "Empty instrument symbol." };
  }

  const trimmed = instrument.trim().toUpperCase();

  // Must contain only valid characters
  if (!/^[A-Z0-9/\._-]+$/.test(trimmed)) {
    return { valid: false, canonical: trimmed, reason: "Invalid characters in instrument symbol." };
  }

  return { valid: true, canonical: trimmed };
}

/**
 * Check if two instrument symbols refer to the same instrument.
 * Handles common equivalences without fabricating identity.
 */
export function instrumentsMatch(a: string, b: string): boolean {
  const normA = a.toUpperCase().replace(/[\s_-]/g, "");
  const normB = b.toUpperCase().replace(/[\s_-]/g, "");
  return normA === normB;
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Check if instrument data is still fresh enough for evaluation.
 */
export function checkInstrumentFreshness(
  state: LiveMarketBridgeState,
  instrument: string,
  now: number,
  staleThresholdMs: number = 300_000, // 5 min
): DataSourceMode {
  const lastEvent = state.lastEventAt.get(instrument);
  if (lastEvent === undefined) return "UNAVAILABLE";

  const age = now - lastEvent;
  if (age > staleThresholdMs) return "DEGRADED";
  if (age > staleThresholdMs / 5) return "POLLING";

  return "POLLING";
}

// ═══════════════════════════════════════════════════════════════
// BRIDGE COMPLETE PROVIDER DATA
// ═══════════════════════════════════════════════════════════════

/**
 * Process a complete set of provider data for an instrument.
 * This is the main entry point for converting provider responses into events.
 */
export function bridgeProviderData(
  state: LiveMarketBridgeState,
  data: {
    quote?: ProviderQuoteData;
    candle?: ProviderCandleData;
    derivatives?: ProviderDerivativesData;
    macro?: ProviderMacroData;
    crossAsset?: ProviderCrossAssetData;
  },
): { events: RealTimeEvent[]; state: LiveMarketBridgeState } {
  let currentState = state;
  const allEvents: RealTimeEvent[] = [];

  if (data.quote) {
    const result = bridgeQuoteToEvents(currentState, data.quote);
    allEvents.push(...result.events);
    currentState = result.state;
  }

  if (data.candle) {
    const result = bridgeCandleToEvents(currentState, data.candle);
    allEvents.push(...result.events);
    currentState = result.state;
  }

  if (data.derivatives) {
    const result = bridgeDerivativesToEvents(currentState, data.derivatives);
    allEvents.push(...result.events);
    currentState = result.state;
  }

  if (data.macro) {
    const result = bridgeMacroToEvents(currentState, data.macro);
    allEvents.push(...result.events);
    currentState = result.state;
  }

  if (data.crossAsset) {
    const result = bridgeCrossAssetToEvents(currentState, data.crossAsset);
    allEvents.push(...result.events);
    currentState = result.state;
  }

  return { events: allEvents, state: currentState };
}
