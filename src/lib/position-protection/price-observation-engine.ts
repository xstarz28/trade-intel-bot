/**
 * Phase 79 — Price Observation Engine
 *
 * Tracks price history over time and derives technical signals from real data:
 * - Trend (short/medium/long-term via moving averages)
 * - Momentum (rate of change, acceleration)
 * - Volatility (ATR-like measure)
 * - Structure (higher highs/lows, break of structure)
 *
 * Pure functions + lightweight state. No network calls.
 * Same inputs → same output (deterministic).
 */

import type { PositionSide } from "./types";

// ═══════════════════════════════════════════════════════════════
// PRICE OBSERVATION
// ═══════════════════════════════════════════════════════════════

export interface PriceObservation {
  price: number;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// OBSERVATION STATE (per instrument)
// ═══════════════════════════════════════════════════════════════

export interface PriceObservationState {
  instrument: string;
  observations: PriceObservation[];
  /** Maximum observations to retain (bounded memory). */
  maxObservations: number;
  /** Last update timestamp. */
  lastUpdateAt: number;
}

const DEFAULT_MAX_OBSERVATIONS = 500;

export function createObservationState(
  instrument: string,
  maxObservations = DEFAULT_MAX_OBSERVATIONS,
): PriceObservationState {
  return {
    instrument,
    observations: [],
    maxObservations,
    lastUpdateAt: 0,
  };
}

export function addObservation(
  state: PriceObservationState,
  price: number,
  timestamp: number,
): PriceObservationState {
  if (!Number.isFinite(price) || price <= 0) return state;

  const observations = [...state.observations, { price, timestamp }];

  // Trim to max size (bounded memory)
  if (observations.length > state.maxObservations) {
    observations.splice(0, observations.length - state.maxObservations);
  }

  return {
    ...state,
    observations,
    lastUpdateAt: timestamp,
  };
}

// ═══════════════════════════════════════════════════════════════
// TECHNICAL SIGNALS
// ═══════════════════════════════════════════════════════════════

export type TrendDirection = "bullish" | "bearish" | "neutral" | "unknown";

export interface TechnicalSignals {
  /** Short-term trend (last ~15 observations). */
  shortTermTrend: TrendDirection;
  /** Medium-term trend (last ~50 observations). */
  mediumTermTrend: TrendDirection;
  /** Long-term trend (all observations). */
  longTermTrend: TrendDirection;
  /** Momentum: rate of change per observation. Positive = up. */
  momentum: number;
  /** Momentum acceleration: is momentum increasing or decreasing. */
  momentumAcceleration: number;
  /** Volatility: standard deviation of recent returns. */
  volatility: number;
  /** Average volatility for comparison. */
  avgVolatility: number;
  /** Whether structure has broken (lower low for LONG, higher high for SHORT). */
  structureBroken: boolean;
  /** Number of observations available. */
  observationCount: number;
  /** Latest price. */
  latestPrice: number;
  /** Price change from earliest to latest. */
  totalChange: number;
  /** Total change as percentage. */
  totalChangePct: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function sma(prices: number[], period: number): number {
  if (prices.length < period) return prices.reduce((a, b) => a + b, 0) / prices.length;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function detectTrend(prices: number[]): TrendDirection {
  if (prices.length < 3) return "unknown";

  const shortSMA = sma(prices, Math.min(5, prices.length));
  const longSMA = sma(prices, Math.min(20, prices.length));
  const latest = prices[prices.length - 1];

  if (latest > longSMA && shortSMA > longSMA) return "bullish";
  if (latest < longSMA && shortSMA < longSMA) return "bearish";
  return "neutral";
}

function computeMomentum(prices: number[]): number {
  if (prices.length < 2) return 0;
  // Use exponential weighting — recent changes matter more
  const recent = prices.slice(-10);
  if (recent.length < 2) return 0;

  let totalWeight = 0;
  let weightedChange = 0;

  for (let i = 1; i < recent.length; i++) {
    const weight = i; // newer = higher weight
    const change = (recent[i] - recent[i - 1]) / recent[i - 1];
    weightedChange += change * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? (weightedChange / totalWeight) * 100 : 0;
}

function computeVolatility(prices: number[]): { current: number; average: number } {
  if (prices.length < 5) return { current: 0, average: 0 };

  // Compute returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }

  if (returns.length < 2) return { current: 0, average: 0 };

  const current = standardDeviation(returns.slice(-20)) * 100;
  const average = standardDeviation(returns) * 100;

  return { current, average };
}

function detectStructureBreak(
  prices: number[],
  side: PositionSide,
): boolean {
  if (prices.length < 10) return false;

  const lookback = Math.min(20, prices.length);
  const recent = prices.slice(-lookback);

  // Find swing lows and swing highs
  const swingLows: number[] = [];
  const swingHighs: number[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i] <= recent[i - 1] && recent[i] <= recent[i - 2] &&
        recent[i] <= recent[i + 1] && recent[i] <= recent[i + 2]) {
      swingLows.push(recent[i]);
    }
    if (recent[i] >= recent[i - 1] && recent[i] >= recent[i - 2] &&
        recent[i] >= recent[i + 1] && recent[i] >= recent[i + 2]) {
      swingHighs.push(recent[i]);
    }
  }

  const latestPrice = recent[recent.length - 1];

  if (side === "LONG") {
    // Structure break = price breaks below most recent swing low
    if (swingLows.length >= 1) {
      return latestPrice < swingLows[swingLows.length - 1];
    }
    return false;
  } else {
    // Structure break = price breaks above most recent swing high
    if (swingHighs.length >= 1) {
      return latestPrice > swingHighs[swingHighs.length - 1];
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN SIGNAL COMPUTATION
// ═══════════════════════════════════════════════════════════════

export function computeTechnicalSignals(
  state: PriceObservationState,
  side: PositionSide,
): TechnicalSignals {
  const prices = state.observations.map((o) => o.price);
  const latestPrice = prices.length > 0 ? prices[prices.length - 1] : 0;
  const firstPrice = prices.length > 0 ? prices[0] : 0;

  // Momentum
  const momentum = computeMomentum(prices);

  // Momentum acceleration: compare recent momentum to earlier
  let momentumAcceleration = 0;
  if (prices.length >= 20) {
    const recentMomentum = computeMomentum(prices.slice(-10));
    const earlierMomentum = computeMomentum(prices.slice(-20, -10));
    momentumAcceleration = recentMomentum - earlierMomentum;
  }

  // Volatility
  const vol = computeVolatility(prices);

  // Trend
  const shortTermTrend = detectTrend(prices.slice(-15));
  const mediumTermTrend = detectTrend(prices.slice(-50));
  const longTermTrend = detectTrend(prices);

  // Structure
  const structureBroken = detectStructureBreak(prices, side);

  return {
    shortTermTrend,
    mediumTermTrend,
    longTermTrend,
    momentum,
    momentumAcceleration,
    volatility: vol.current,
    avgVolatility: vol.average,
    structureBroken,
    observationCount: prices.length,
    latestPrice,
    totalChange: latestPrice - firstPrice,
    totalChangePct: firstPrice > 0 ? ((latestPrice - firstPrice) / firstPrice) * 100 : 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// MARKET INTELLIGENCE SUMMARY
// ═══════════════════════════════════════════════════════════════

export interface MarketIntelligenceSummary {
  instrument: string;
  side: PositionSide;
  latestPrice: number;
  signals: TechnicalSignals;
  /** Whether we have enough data for meaningful analysis. */
  sufficientData: boolean;
  /** Data quality classification. */
  dataQuality: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT";
  /** Overall market state for this instrument. */
  marketState: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "INSUFFICIENT_DATA";
}

export function buildMarketIntelligence(
  state: PriceObservationState,
  side: PositionSide,
): MarketIntelligenceSummary {
  const signals = computeTechnicalSignals(state, side);
  const observationCount = state.observations.length;

  const sufficientData = observationCount >= 10;
  const limitedData = observationCount >= 3;

  const dataQuality: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT" =
    sufficientData ? "SUFFICIENT" : limitedData ? "LIMITED" : "INSUFFICIENT";

  // Market state
  let marketState: MarketIntelligenceSummary["marketState"];
  if (!sufficientData) {
    marketState = "INSUFFICIENT_DATA";
  } else if (signals.volatility > signals.avgVolatility * 2 && signals.avgVolatility > 0) {
    marketState = "VOLATILE";
  } else if (signals.shortTermTrend === "bullish" || signals.mediumTermTrend === "bullish") {
    marketState = "TRENDING_UP";
  } else if (signals.shortTermTrend === "bearish" || signals.mediumTermTrend === "bearish") {
    marketState = "TRENDING_DOWN";
  } else {
    marketState = "RANGING";
  }

  return {
    instrument: state.instrument,
    side,
    latestPrice: signals.latestPrice,
    signals,
    sufficientData,
    dataQuality,
    marketState,
  };
}
