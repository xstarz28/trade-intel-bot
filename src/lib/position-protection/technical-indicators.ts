/**
 * Phase 80 — Technical Indicators
 *
 * Pure deterministic functions that compute technical indicators
 * from real OHLCV candle data. No side effects, no network calls.
 * Same inputs → same output.
 *
 * Every indicator has a clear use in the intelligence layer.
 */

// ═══════════════════════════════════════════════════════════════
// CANDLE DATA MODEL
// ═══════════════════════════════════════════════════════════════

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Validate and normalize a raw candle. Returns null if invalid. */
export function validateCandle(raw: {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): Candle | null {
  if (!Number.isFinite(raw.open) || !Number.isFinite(raw.high) ||
      !Number.isFinite(raw.low) || !Number.isFinite(raw.close)) return null;
  if (raw.open <= 0 || raw.high <= 0 || raw.low <= 0 || raw.close <= 0) return null;
  if (raw.high < Math.max(raw.open, raw.close)) return null;
  if (raw.low > Math.min(raw.open, raw.close)) return null;
  if (raw.timestamp <= 0) return null;
  return {
    timestamp: raw.timestamp,
    open: raw.open,
    high: raw.high,
    low: raw.low,
    close: raw.close,
    volume: Math.max(0, raw.volume || 0),
  };
}

/** Normalize a candle list: validate, deduplicate by timestamp, sort ascending. */
export function normalizeCandles(candles: Candle[]): Candle[] {
  const seen = new Map<number, Candle>();
  for (const c of candles) {
    const validated = validateCandle(c);
    if (!validated) continue;
    // Keep the latest candle for each timestamp
    const existing = seen.get(validated.timestamp);
    if (!existing || validated.timestamp > existing.timestamp) {
      seen.set(validated.timestamp, validated);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// ═══════════════════════════════════════════════════════════════
// TREND INDICATORS
// ═══════════════════════════════════════════════════════════════

/** Simple Moving Average */
export function sma(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result.push(sum / period);
  }
  return result;
}

/** Exponential Moving Average */
export function ema(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result.push(sum / period);

  for (let i = period; i < closes.length; i++) {
    result.push(closes[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MOMENTUM INDICATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Relative Strength Index (RSI).
 * Returns array of RSI values (0-100).
 */
export function rsi(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Initial average gain/loss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const result: number[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const r = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push(r);
  }

  return result;
}

/**
 * Rate of Change over N periods.
 * Returns percentage change.
 */
export function rateOfChange(closes: number[], period: number): number[] {
  if (closes.length <= period) return [];
  const result: number[] = [];
  for (let i = period; i < closes.length; i++) {
    const change = ((closes[i] - closes[i - period]) / closes[i - period]) * 100;
    result.push(change);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// VOLATILITY INDICATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Average True Range (ATR).
 * Returns array of ATR values.
 */
export function atr(candles: Candle[], period = 14): number[] {
  if (candles.length < period + 1) return [];

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return [];

  // First ATR = SMA of true ranges
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trueRanges[i];
  const result: number[] = [sum / period];

  // Subsequent ATR = smoothed
  for (let i = period; i < trueRanges.length; i++) {
    result.push((result[result.length - 1] * (period - 1) + trueRanges[i]) / period);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURE ANALYSIS
// ═══════════════════════════════════════════════════════════════

export interface SwingPoint {
  index: number;
  timestamp: number;
  price: number;
  type: "HIGH" | "LOW";
}

/**
 * Detect swing highs and lows.
 * A swing high requires `lookback` candles on each side to be lower.
 * A swing low requires `lookback` candles on each side to be higher.
 */
export function detectSwings(candles: Candle[], lookback = 2): SwingPoint[] {
  if (candles.length < lookback * 2 + 1) return [];
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    // Swing High
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      swings.push({ index: i, timestamp: candles[i].timestamp, price: candles[i].high, type: "HIGH" });
    }

    // Swing Low
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      swings.push({ index: i, timestamp: candles[i].timestamp, price: candles[i].low, type: "LOW" });
    }
  }

  return swings;
}

export type StructureState =
  | "HIGHER_HIGHS_HIGHER_LOWS"  // bullish
  | "LOWER_HIGHS_LOWER_LOWS"    // bearish
  | "HIGHER_HIGH_LOWER_LOW"     // mixed/expanding
  | "LOWER_HIGH_HIGHER_LOW"     // mixed/contracting
  | "INSUFFICIENT_DATA";

/**
 * Analyze market structure from swing points.
 * Returns the structural state and whether a break has occurred.
 */
export function analyzeStructure(swings: SwingPoint[]): {
  state: StructureState;
  structureBroken: boolean;
  lastSwingHigh?: number;
  lastSwingLow?: number;
  previousSwingHigh?: number;
  previousSwingLow?: number;
} {
  const highs = swings.filter((s) => s.type === "HIGH");
  const lows = swings.filter((s) => s.type === "LOW");

  if (highs.length < 2 || lows.length < 2) {
    return { state: "INSUFFICIENT_DATA", structureBroken: false };
  }

  const lastHigh = highs[highs.length - 1].price;
  const prevHigh = highs[highs.length - 2].price;
  const lastLow = lows[lows.length - 1].price;
  const prevLow = lows[lows.length - 2].price;

  const higherHigh = lastHigh > prevHigh;
  const higherLow = lastLow > prevLow;
  const lowerHigh = lastHigh < prevHigh;
  const lowerLow = lastLow < prevLow;

  let state: StructureState;
  let structureBroken = false;

  if (higherHigh && higherLow) {
    state = "HIGHER_HIGHS_HIGHER_LOWS";
  } else if (lowerHigh && lowerLow) {
    state = "LOWER_HIGHS_LOWER_LOWS";
  } else if (higherHigh && lowerLow) {
    state = "HIGHER_HIGH_LOWER_LOW";
  } else {
    state = "LOWER_HIGH_HIGHER_LOW";
  }

  // Structure break: for LONG, price breaks below the last swing low
  // For SHORT, price breaks above the last swing high
  // We check both — caller decides which is relevant
  structureBroken = lowerLow; // structure broken downward
  // Note: caller uses `side` to determine if this is a break against position

  return {
    state,
    structureBroken,
    lastSwingHigh: lastHigh,
    lastSwingLow: lastLow,
    previousSwingHigh: prevHigh,
    previousSwingLow: prevLow,
  };
}

// ═══════════════════════════════════════════════════════════════
// SUPPORT / RESISTANCE
// ═══════════════════════════════════════════════════════════════

export interface SupportResistance {
  resistance: number[];
  support: number[];
}

/**
 * Extract support/resistance levels from swing points.
 */
export function extractLevels(swings: SwingPoint[], currentPrice: number): SupportResistance {
  const highs = swings.filter((s) => s.type === "HIGH").map((s) => s.price);
  const lows = swings.filter((s) => s.type === "LOW").map((s) => s.price);

  const resistance = highs.filter((h) => h > currentPrice).sort((a, b) => a - b);
  const support = lows.filter((l) => l < currentPrice).sort((a, b) => b - a);

  return { resistance: resistance.slice(0, 3), support: support.slice(0, 3) };
}
