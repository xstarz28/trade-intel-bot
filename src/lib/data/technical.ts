/**
 * Technical indicator calculations from OHLCV candle data.
 * All functions are pure and side-effect free.
 *
 * These run on the frontend but the same logic could be moved to a
 * Convex action if needed. Keeping them here for simplicity.
 */

import type { OhlcvCandle, TechnicalData } from "./market-types";

// ── Moving Averages ───────────────────────────────────────────────

/** Simple Moving Average of close prices. */
export function sma(closes: number[], period: number): number | undefined {
  if (closes.length < period) return undefined;
  const slice = closes.slice(closes.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential Moving Average of close prices. */
export function ema(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    result.push(closes[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// ── RSI ───────────────────────────────────────────────────────────

/**
 * Relative Strength Index using the standard Wilder smoothing method.
 * Returns the latest RSI value (0–100).
 */
export function rsi(closes: number[], period = 14): number | undefined {
  if (closes.length < period + 1) return undefined;

  let gainSum = 0;
  let lossSum = 0;

  // Initial average gain/loss over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change;
    else lossSum += Math.abs(change);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  // Wilder smoothing for remaining data
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Detect RSI divergence: compare price direction vs RSI direction
 * over the last N swings.
 */
export function detectRsiDivergence(
  candles: OhlcvCandle[],
  rsiPeriod = 14,
): "bullish" | "bearish" | "none" {
  if (candles.length < rsiPeriod + 20) return "none";

  const closes = candles.map((c) => c.close);
  const rsiValues: number[] = [];

  // Calculate RSI for each window
  for (let i = rsiPeriod + 1; i <= closes.length; i++) {
    const r = rsi(closes.slice(0, i), rsiPeriod);
    if (r !== undefined) rsiValues.push(r);
  }

  if (rsiValues.length < 10) return "none";

  // Compare last 2 price lows vs RSI lows (bullish divergence)
  const recentCloses = closes.slice(-20);
  const recentRsi = rsiValues.slice(-20);

  const priceMin1 = Math.min(...recentCloses.slice(0, 10));
  const priceMin2 = Math.min(...recentCloses.slice(10));
  const rsiMin1 = Math.min(...recentRsi.slice(0, 10));
  const rsiMin2 = Math.min(...recentRsi.slice(10));

  // Bullish divergence: price makes lower low, RSI makes higher low
  if (priceMin2 < priceMin1 && rsiMin2 > rsiMin1) return "bullish";

  // Bearish divergence: price makes higher high, RSI makes lower high
  const priceMax1 = Math.max(...recentCloses.slice(0, 10));
  const priceMax2 = Math.max(...recentCloses.slice(10));
  const rsiMax1 = Math.max(...recentRsi.slice(0, 10));
  const rsiMax2 = Math.max(...recentRsi.slice(10));

  if (priceMax2 > priceMax1 && rsiMax2 < rsiMax1) return "bearish";

  return "none";
}

// ── MACD ──────────────────────────────────────────────────────────

/**
 * MACD (12, 26, 9) — returns latest [macdLine, signalLine, histogram].
 */
export function macd(
  closes: number[],
): { line: number; signal: number; histogram: number } | undefined {
  if (closes.length < 35) return undefined; // Need 26 EMA + 9 signal

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine.slice(26), 9); // Signal is 9-period EMA of MACD line

  if (signalLine.length === 0) return undefined;

  const latestMacd = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];

  return {
    line: latestMacd,
    signal: latestSignal,
    histogram: latestMacd - latestSignal,
  };
}

// ── Swing Detection ───────────────────────────────────────────────

/**
 * Detect swing highs and lows from candles.
 * A swing high is a candle whose high is greater than both neighbors.
 * Uses a configurable lookback (default: 3 candles each side).
 */
export function detectSwings(
  candles: OhlcvCandle[],
  lookback = 3,
): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    const leftHighs = candles.slice(i - lookback, i).map((c) => c.high);
    const rightHighs = candles.slice(i + 1, i + lookback + 1).map((c) => c.high);
    const allLeftHighs = leftHighs.every((h) => current.high >= h);
    const allRightHighs = rightHighs.every((h) => current.high >= h);

    if (allLeftHighs && allRightHighs) {
      highs.push(current.high);
    }

    const leftLows = candles.slice(i - lookback, i).map((c) => c.low);
    const rightLows = candles.slice(i + 1, i + lookback + 1).map((c) => c.low);
    const allLeftLows = leftLows.every((l) => current.low <= l);
    const allRightLows = rightLows.every((l) => current.low <= l);

    if (allLeftLows && allRightLows) {
      lows.push(current.low);
    }
  }

  return { highs, lows };
}

/**
 * Determine market structure from swing points.
 * - "HH/HL": Higher Highs + Higher Lows → bullish
 * - "LH/LL": Lower Highs + Lower Lows → bearish
 * - "range": Mixed or insufficient swings
 */
export function analyzeStructure(
  swingHighs: number[],
  swingLows: number[],
): "HH/HL" | "LH/LL" | "range" | "unknown" {
  if (swingHighs.length < 2 || swingLows.length < 2) return "unknown";

  const recentHighs = swingHighs.slice(-3);
  const recentLows = swingLows.slice(-3);

  const highsRising = recentHighs[recentHighs.length - 1] > recentHighs[0];
  const lowsRising = recentLows[recentLows.length - 1] > recentLows[0];

  if (highsRising && lowsRising) return "HH/HL";
  if (!highsRising && !lowsRising) return "LH/LL";
  return "range";
}

/** Detect Break of Structure (BOS) — most recent direction. */
export function detectBos(
  swingHighs: number[],
  swingLows: number[],
  currentPrice: number,
): "bullish" | "bearish" | "none" {
  if (swingHighs.length < 2 || swingLows.length < 2) return "none";

  const lastHigh = swingHighs[swingHighs.length - 1];
  const lastLow = swingLows[swingLows.length - 1];

  if (currentPrice > lastHigh) return "bullish";
  if (currentPrice < lastLow) return "bearish";
  return "none";
}

/** Detect Change of Character (CHoCH) — reversal of structure. */
export function detectChoch(
  swingHighs: number[],
  swingLows: number[],
  structure: string,
  currentPrice: number,
): "bullish" | "bearish" | "none" {
  if (swingHighs.length < 2 || swingLows.length < 2) return "none";

  if (structure === "HH/HL") {
    // In bullish structure, bearish CHoCH = break below last swing low
    const lastLow = swingLows[swingLows.length - 1];
    if (currentPrice < lastLow) return "bearish";
  } else if (structure === "LH/LL") {
    // In bearish structure, bullish CHoCH = break above last swing high
    const lastHigh = swingHighs[swingHighs.length - 1];
    if (currentPrice > lastHigh) return "bullish";
  }

  return "none";
}

// ── Support / Resistance from Swing Points ────────────────────────

/** Find nearest support and resistance levels from swing points. */
export function findKeyLevels(
  swingHighs: number[],
  swingLows: number[],
  currentPrice: number,
): { support: number[]; resistance: number[] } {
  const allSwings = [
    ...swingHighs.map((h) => ({ level: h, type: "resistance" as const })),
    ...swingLows.map((l) => ({ level: l, type: "support" as const })),
  ].sort((a, b) => a.level - b.level);

  const support = allSwings
    .filter((s) => s.level < currentPrice)
    .map((s) => s.level)
    .slice(-3); // Nearest 3 below

  const resistance = allSwings
    .filter((s) => s.level > currentPrice)
    .map((s) => s.level)
    .slice(0, 3); // Nearest 3 above

  return { support, resistance };
}

// ── Fibonacci Retracement ─────────────────────────────────────────

/** Calculate Fibonacci retracement from a swing high and swing low. */
export function fibonacciLevels(
  swingHigh: number,
  swingLow: number,
): {
  level236: number;
  level382: number;
  level500: number;
  level618: number;
  level786: number;
} {
  const range = swingHigh - swingLow;
  return {
    level236: swingLow + range * 0.236,
    level382: swingLow + range * 0.382,
    level500: swingLow + range * 0.5,
    level618: swingLow + range * 0.618,
    level786: swingLow + range * 0.786,
  };
}

// ── ATR ───────────────────────────────────────────────────────────

/** Average True Range over `period` candles. */
export function atr(candles: OhlcvCandle[], period = 14): number | undefined {
  if (candles.length < period + 1) return undefined;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return undefined;
  const slice = trueRanges.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ── Volume Analysis ───────────────────────────────────────────────

/** Analyze volume trend over recent candles. */
export function analyzeVolume(
  candles: OhlcvCandle[],
): { avg20: number | undefined; trend: "increasing" | "decreasing" | "stable" | "unknown" } {
  if (candles.length < 20) return { avg20: undefined, trend: "unknown" };

  const volumes = candles.map((c) => c.volume);
  const avg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

  const recentAvg5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const olderAvg5 = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;

  const ratio = olderAvg5 > 0 ? recentAvg5 / olderAvg5 : 1;

  let trend: "increasing" | "decreasing" | "stable" | "unknown" = "stable";
  if (ratio > 1.3) trend = "increasing";
  else if (ratio < 0.7) trend = "decreasing";

  return { avg20, trend };
}

// ── Full Technical Analysis ───────────────────────────────────────

/** Run all technical calculations on OHLCV data and return normalized TechnicalData. */
export function calculateTechnical(
  candles: OhlcvCandle[],
  higherTimeframeCandles?: OhlcvCandle[],
): TechnicalData {
  if (candles.length === 0) {
    return {
      swingHighs: [],
      swingLows: [],
      structure: "unknown",
      supportLevels: [],
      resistanceLevels: [],
      volumeTrend: "unknown",
      dataPoints: 0,
    };
  }

  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  // Moving averages
  const sma50Val = sma(closes, 50);
  const sma100Val = sma(closes, 100);
  const sma200Val = sma(closes, 200);

  // RSI
  const rsi14Val = rsi(closes, 14);
  const rsiDiv = detectRsiDivergence(candles);

  // MACD
  const macdResult = macd(closes);

  // Use higher timeframe for structure if available, otherwise primary
  const structureCandles = higherTimeframeCandles && higherTimeframeCandles.length >= 20
    ? higherTimeframeCandles
    : candles;

  // Swing detection
  const lookback = structureCandles.length > 50 ? 5 : 3;
  const { highs: swingHighs, lows: swingLows } = detectSwings(structureCandles, lookback);

  // Market structure
  const structure = analyzeStructure(swingHighs, swingLows);
  const bosDirection = detectBos(swingHighs, swingLows, currentPrice);
  const chochDirection = detectChoch(swingHighs, swingLows, structure, currentPrice);

  // Key levels from swing points
  const { support, resistance } = findKeyLevels(swingHighs, swingLows, currentPrice);

  // Fibonacci from the most recent major swing
  let fibLevels: TechnicalData["fibLevels"];
  if (swingHighs.length >= 1 && swingLows.length >= 1) {
    const fibSwingHigh = Math.max(...swingHighs.slice(-2));
    const fibSwingLow = Math.min(...swingLows.slice(-2));
    if (fibSwingHigh > fibSwingLow) {
      fibLevels = fibonacciLevels(fibSwingHigh, fibSwingLow);
    }
  }

  // Volume
  const { avg20, trend: volumeTrend } = analyzeVolume(candles);

  // ATR
  const atr14 = atr(candles);

  // Daily range (latest candle)
  const latestCandle = candles[candles.length - 1];
  const dailyRange = latestCandle.high - latestCandle.low;

  return {
    sma50: sma50Val,
    sma100: sma100Val,
    sma200: sma200Val,
    rsi14: rsi14Val !== undefined ? Math.round(rsi14Val * 10) / 10 : undefined,
    rsiDivergence: rsiDiv,
    macdLine: macdResult?.line,
    macdSignal: macdResult?.signal,
    macdHistogram: macdResult?.histogram,
    swingHighs,
    swingLows,
    structure,
    bosDirection,
    chochDirection,
    supportLevels: support,
    resistanceLevels: resistance,
    fibLevels,
    avgVolume20: avg20,
    volumeTrend,
    atr14,
    dailyRange,
    dataPoints: candles.length,
  };
}
