/**
 * Phase 61 — Market Event Bridge
 *
 * Connects available market data sources (Convex providers, API responses)
 * into the existing RealTimeEvent monitoring architecture.
 *
 * Converts raw market data into typed RealTimeEvents that the
 * realtime-monitor can process for profit protection evaluation.
 *
 * Pure functions — no side effects.
 */

import type {
  RealTimeEvent,
  Timeframe,
} from "./realtime-types";

// ═══════════════════════════════════════════════════════════════
// EVENT ID GENERATION
// ═══════════════════════════════════════════════════════════════

let eventCounter = 0;

function generateEventId(prefix: string, instrument: string): string {
  eventCounter++;
  return `${prefix}-${instrument}-${Date.now()}-${eventCounter}`;
}

// ═══════════════════════════════════════════════════════════════
// PRICE / QUOTE EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a PRICE_UPDATE event from a quote response.
 */
export function createPriceEvent(
  instrument: string,
  price: number,
  source: string,
  options?: {
    bid?: number;
    ask?: number;
    spread?: number;
    volume24h?: number;
    change24h?: number;
    timestamp?: number;
  },
): RealTimeEvent {
  const now = Date.now();
  return {
    eventId: generateEventId("price", instrument),
    instrument,
    timestamp: options?.timestamp ?? now,
    source,
    freshness: "FRESH",
    eventType: "PRICE_UPDATE",
    priority: "LOW",
    dependencyGroup: `PRICE:${instrument}`,
    payload: {
      price,
      bid: options?.bid,
      ask: options?.ask,
      spread: options?.spread,
      volume24h: options?.volume24h,
      change24h: options?.change24h,
    },
  };
}

/**
 * Create a QUOTE_UPDATE event.
 */
export function createQuoteEvent(
  instrument: string,
  price: number,
  bid: number,
  ask: number,
  source: string,
  timestamp?: number,
): RealTimeEvent {
  return {
    eventId: generateEventId("quote", instrument),
    instrument,
    timestamp: timestamp ?? Date.now(),
    source,
    freshness: "FRESH",
    eventType: "QUOTE_UPDATE",
    priority: "LOW",
    dependencyGroup: `QUOTE:${instrument}`,
    payload: { price, bid, ask, spread: ask - bid },
  };
}

// ═══════════════════════════════════════════════════════════════
// CANDLE / OHLCV EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a CANDLE_UPDATE event from OHLCV data.
 */
export function createCandleEvent(
  instrument: string,
  candle: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  },
  timeframe: Timeframe,
  source: string,
  timestamp?: number,
): RealTimeEvent {
  const volatility = candle.high - candle.low;
  return {
    eventId: generateEventId("candle", instrument),
    instrument,
    timestamp: timestamp ?? Date.now(),
    source,
    freshness: "FRESH",
    eventType: "CANDLE_UPDATE",
    priority: "LOW",
    timeframe,
    dependencyGroup: `CANDLE:${instrument}:${timeframe}`,
    payload: {
      price: candle.close,
      candle: { ...candle, timeframe },
      volatility,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURE / TREND EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a MARKET_STRUCTURE_CHANGE event.
 */
export function createStructureChangeEvent(
  instrument: string,
  broken: boolean,
  timeframe: Timeframe,
  source: string,
  details?: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("structure", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "MARKET_STRUCTURE_CHANGE",
    priority: broken ? "HIGH" : "LOW",
    timeframe,
    dependencyGroup: `STRUCTURE:${instrument}:${timeframe}`,
    payload: {
      broken,
      details: details ?? (broken ? "Structure broken against position" : "Structure intact"),
      adverseTrend: broken,
    },
  };
}

/**
 * Create a MOMENTUM_CHANGE event.
 */
export function createMomentumChangeEvent(
  instrument: string,
  change: number,
  timeframe: Timeframe,
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("momentum", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "MOMENTUM_CHANGE",
    priority: Math.abs(change) > 15 ? "HIGH" : Math.abs(change) > 5 ? "MEDIUM" : "LOW",
    timeframe,
    dependencyGroup: `MOMENTUM:${instrument}:${timeframe}`,
    payload: { change, adverseMomentum: change < -10 },
  };
}

// ═══════════════════════════════════════════════════════════════
// VOLATILITY EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a VOLATILITY_CHANGE event.
 */
export function createVolatilityChangeEvent(
  instrument: string,
  currentVol: number,
  avgVol: number,
  source: string,
): RealTimeEvent {
  const ratio = avgVol > 0 ? currentVol / avgVol : 1;
  return {
    eventId: generateEventId("volatility", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "VOLATILITY_CHANGE",
    priority: ratio > 3 ? "HIGH" : ratio > 2 ? "MEDIUM" : "LOW",
    dependencyGroup: `VOLATILITY:${instrument}`,
    payload: {
      volatility: currentVol,
      avgVolatility: avgVol,
      ratio,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// DERIVATIVES EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a FUNDING_CHANGE event.
 */
export function createFundingChangeEvent(
  instrument: string,
  fundingRate: number,
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("funding", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "FUNDING_CHANGE",
    priority: Math.abs(fundingRate) > 0.003 ? "HIGH" : Math.abs(fundingRate) > 0.001 ? "MEDIUM" : "LOW",
    dependencyGroup: `FUNDING:${instrument}`,
    payload: { fundingRate },
  };
}

/**
 * Create an OPEN_INTEREST_CHANGE event.
 */
export function createOIChangeEvent(
  instrument: string,
  oiChange: number,
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("oi", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "OPEN_INTEREST_CHANGE",
    priority: Math.abs(oiChange) > 20 ? "HIGH" : Math.abs(oiChange) > 10 ? "MEDIUM" : "LOW",
    dependencyGroup: `OI:${instrument}`,
    payload: { oiChange },
  };
}

/**
 * Create a LIQUIDATION_CHANGE event.
 */
export function createLiquidationChangeEvent(
  instrument: string,
  spike: boolean,
  volume: number,
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("liquidation", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "LIQUIDATION_CHANGE",
    priority: spike ? "HIGH" : "LOW",
    dependencyGroup: `LIQUIDATION:${instrument}`,
    payload: { spike, liquidationVolume: volume },
  };
}

// ═══════════════════════════════════════════════════════════════
// MACRO / CROSS-ASSET / NEWS EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a CROSS_ASSET_CHANGE event.
 */
export function createCrossAssetEvent(
  instrument: string,
  correlatedAsset: string,
  divergence: boolean,
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("cross-asset", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "CROSS_ASSET_CHANGE",
    priority: divergence ? "MEDIUM" : "LOW",
    dependencyGroup: `CROSS_ASSET:${instrument}:${correlatedAsset}`,
    payload: { asset: correlatedAsset, divergence },
  };
}

/**
 * Create a MACRO_CHANGE event.
 */
export function createMacroChangeEvent(
  instrument: string,
  regime: "risk_on" | "risk_off" | "transition" | "unknown",
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("macro", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "MACRO_CHANGE",
    priority: regime === "risk_off" ? "HIGH" : "MEDIUM",
    dependencyGroup: `MACRO:${instrument}`,
    payload: { regime, regimeChanged: regime === "risk_off" || regime === "transition" },
  };
}

/**
 * Create a NEWS_EVENT.
 */
export function createNewsEvent(
  instrument: string,
  eventName: string,
  impact: "LOW" | "MEDIUM" | "HIGH",
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("news", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "NEWS_EVENT",
    priority: impact === "HIGH" ? "HIGH" : impact === "MEDIUM" ? "MEDIUM" : "LOW",
    dependencyGroup: `NEWS:${instrument}:${eventName}`,
    payload: { name: eventName, impact },
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA INTEGRITY EVENTS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a DATA_STALE event.
 */
export function createDataStaleEvent(
  instrument: string,
  source: string,
  staleMs: number,
): RealTimeEvent {
  return {
    eventId: generateEventId("stale", instrument),
    instrument,
    timestamp: Date.now(),
    source,
    freshness: "STALE",
    eventType: "DATA_STALE",
    priority: "MEDIUM",
    dependencyGroup: `STALE:${instrument}:${source}`,
    payload: { staleMs },
  };
}

/**
 * Create a PROVIDER_DEGRADED event.
 */
export function createProviderDegradedEvent(
  instrument: string,
  provider: string,
  reason: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("degraded", instrument),
    instrument,
    timestamp: Date.now(),
    source: provider,
    freshness: "UNAVAILABLE",
    eventType: "PROVIDER_DEGRADED",
    priority: "MEDIUM",
    dependencyGroup: `PROVIDER:${provider}:${instrument}`,
    payload: { reason },
  };
}

/**
 * Create a PROVIDER_RECOVERED event.
 */
export function createProviderRecoveredEvent(
  instrument: string,
  provider: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("recovered", instrument),
    instrument,
    timestamp: Date.now(),
    source: provider,
    freshness: "FRESH",
    eventType: "PROVIDER_RECOVERED",
    priority: "LOW",
    dependencyGroup: `PROVIDER:${provider}:${instrument}`,
    payload: {},
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION UPDATE EVENT
// ═══════════════════════════════════════════════════════════════

/**
 * Create a POSITION_UPDATE event when position details change.
 */
export function createPositionUpdateEvent(
  instrument: string,
  positionId: string,
  updates: Record<string, unknown>,
  source: string,
): RealTimeEvent {
  return {
    eventId: generateEventId("pos-update", instrument),
    instrument,
    positionId,
    timestamp: Date.now(),
    source,
    freshness: "FRESH",
    eventType: "POSITION_UPDATE",
    priority: "MEDIUM",
    dependencyGroup: `POSITION:${positionId}`,
    payload: updates,
  };
}
