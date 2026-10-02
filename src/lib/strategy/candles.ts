/**
 * Phase 312 — candle-formation recognition from REAL OHLCV.
 *
 * SOURCE BOUNDARY: the source document names the Bullish/Bearish Pin Bar and
 * the 3-candle sandwich without numeric geometry. The body/wick ratios below
 * are ENGINE-DEFINED, exported constants — exact, deterministic, and never
 * presented as source-verbatim numbers. Each formation reports its candle
 * indices/timestamps verbatim, its actual body/wick measurements, its
 * directional implication, and its confirmation/invalidation conditions.
 */

import type { OhlcvCandle } from "../data/market-types";

/** ENGINE-DEFINED formation geometry (documented in the header). */
export const PIN_WICK_BODY_RATIO = 2.0;
export const PIN_WICK_RANGE_SHARE = 0.6;
export const PIN_CLOSE_POSITION_SHARE = 0.4;

export type FormationDirection = "bullish" | "bearish";

export interface CandleFormation {
  kind: "pin_bar" | "sandwich";
  direction: FormationDirection;
  timeframe: string;
  /** Candle indices (verbatim positions in the input series). */
  indices: number[];
  /** Verbatim timestamps of `indices`. */
  timestamps: number[];
  /** Actual measurements from the OHLCV values. */
  measurements: {
    body: number;
    upperWick: number;
    lowerWick: number;
    range: number;
  };
  /** Where this formation sat relative to its own local range. */
  localContext: {
    /** Close's position within the formation's own high-low range (0..1). */
    closePosition: number;
  };
  /** Deterministic confirmation condition (human-readable, exact). */
  confirmation: string;
  /** Deterministic invalidation condition (human-readable, exact). */
  invalidation: string;
  /** The formation's completion candle (last of `indices`). */
  completedAtIndex: number;
  completedAtTime: number;
}

function bodyWicks(c: OhlcvCandle) {
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const range = c.high - c.low;
  return { body, upperWick, lowerWick, range };
}

function isBullish(c: OhlcvCandle) {
  return c.close > c.open;
}
function isBearish(c: OhlcvCandle) {
  return c.close < c.open;
}

function pinBar(
  candles: OhlcvCandle[],
  i: number,
  direction: FormationDirection,
  timeframe: string,
): CandleFormation | null {
  const c = candles[i];
  const { body, upperWick, lowerWick, range } = bodyWicks(c);
  if (!(range > 0) || !Number.isFinite(range)) return null;
  const wick = direction === "bullish" ? lowerWick : upperWick;
  const closePosition = (c.close - c.low) / range;

  if (direction === "bullish") {
    if (wick < body * PIN_WICK_BODY_RATIO) return null;
    if (wick < range * PIN_WICK_RANGE_SHARE) return null;
    if (closePosition < 1 - PIN_CLOSE_POSITION_SHARE) return null;
  } else {
    if (wick < body * PIN_WICK_BODY_RATIO) return null;
    if (wick < range * PIN_WICK_RANGE_SHARE) return null;
    if (closePosition > PIN_CLOSE_POSITION_SHARE) return null;
  }

  return {
    kind: "pin_bar",
    direction,
    timeframe,
    indices: [i],
    timestamps: [c.timestamp],
    measurements: { body, upperWick, lowerWick, range },
    localContext: { closePosition },
    confirmation:
      direction === "bullish"
        ? `close above the pin high ${c.high}`
        : `close below the pin low ${c.low}`,
    invalidation:
      direction === "bullish"
        ? `close below the pin low ${c.low}`
        : `close above the pin high ${c.high}`,
    completedAtIndex: i,
    completedAtTime: c.timestamp,
  };
}

/**
 * 3-candle sandwich (ENGINE-DEFINED geometry): a directional candle (c0), then
 * a counter-directional candle (c1) whose BODY engulfs c0's body, then a
 * resumption candle (c2) in c0's direction closing back through c1's body.
 * Bullish: c0 up, c1 down engulfing, c2 up closing above c1's open.
 */
function sandwich(
  candles: OhlcvCandle[],
  i: number,
  direction: FormationDirection,
  timeframe: string,
): CandleFormation | null {
  const c0 = candles[i];
  const c1 = candles[i + 1];
  const c2 = candles[i + 2];
  if (!c0 || !c1 || !c2) return null;

  const m0 = bodyWicks(c0);
  const m1 = bodyWicks(c1);
  const m2 = bodyWicks(c2);

  if (direction === "bullish") {
    if (!isBullish(c0) || !isBearish(c1) || !isBullish(c2)) return null;
    // c1's body engulfs c0's body.
    const c0BodyHigh = Math.max(c0.open, c0.close);
    const c0BodyLow = Math.min(c0.open, c0.close);
    const c1BodyHigh = Math.max(c1.open, c1.close);
    const c1BodyLow = Math.min(c1.open, c1.close);
    if (c1BodyHigh < c0BodyHigh || c1BodyLow > c0BodyLow) return null;
    // c2 reclaims through c1's body.
    if (c2.close <= c1.open) return null;
    const range = Math.max(c0.high, c1.high, c2.high) - Math.min(c0.low, c1.low, c2.low);
    return {
      kind: "sandwich",
      direction,
      timeframe,
      indices: [i, i + 1, i + 2],
      timestamps: [c0.timestamp, c1.timestamp, c2.timestamp],
      measurements: { body: m2.body, upperWick: m2.upperWick, lowerWick: m2.lowerWick, range },
      localContext: { closePosition: range > 0 ? (c2.close - Math.min(c0.low, c1.low, c2.low)) / range : 0 },
      confirmation: `close above the sandwich high ${Math.max(c0.high, c1.high, c2.high)}`,
      invalidation: `close below the counter-candle low ${c1.low}`,
      completedAtIndex: i + 2,
      completedAtTime: c2.timestamp,
    };
  }

  if (!isBearish(c0) || !isBullish(c1) || !isBearish(c2)) return null;
  const c0BodyHigh = Math.max(c0.open, c0.close);
  const c0BodyLow = Math.min(c0.open, c0.close);
  const c1BodyHigh = Math.max(c1.open, c1.close);
  const c1BodyLow = Math.min(c1.open, c1.close);
  if (c1BodyHigh < c0BodyHigh || c1BodyLow > c0BodyLow) return null;
  if (c2.close >= c1.open) return null;
  const range = Math.max(c0.high, c1.high, c2.high) - Math.min(c0.low, c1.low, c2.low);
  void m0;
  void m1;
  return {
    kind: "sandwich",
    direction,
    timeframe,
    indices: [i, i + 1, i + 2],
    timestamps: [c0.timestamp, c1.timestamp, c2.timestamp],
    measurements: { body: m2.body, upperWick: m2.upperWick, lowerWick: m2.lowerWick, range },
    localContext: { closePosition: range > 0 ? (c2.close - Math.min(c0.low, c1.low, c2.low)) / range : 0 },
    confirmation: `close below the sandwich low ${Math.min(c0.low, c1.low, c2.low)}`,
    invalidation: `close above the counter-candle high ${c1.high}`,
    completedAtIndex: i + 2,
    completedAtTime: c2.timestamp,
  };
}

/**
 * Recognise pin bars and 3-candle sandwiches over the candle series.
 * Returns the most recent formation per (kind, direction). Deterministic.
 */
export function detectCandleFormations(
  candles: OhlcvCandle[],
  timeframe: string,
): CandleFormation[] {
  if (candles.length < 3) return [];
  const out: CandleFormation[] = [];
  const best = new Map<string, CandleFormation>();
  const keep = (f: CandleFormation | null) => {
    if (!f) return;
    const key = `${f.kind}:${f.direction}`;
    const current = best.get(key);
    if (!current || f.completedAtIndex > current.completedAtIndex) best.set(key, f);
  };
  for (let i = 0; i < candles.length; i++) {
    keep(pinBar(candles, i, "bullish", timeframe));
    keep(pinBar(candles, i, "bearish", timeframe));
  }
  for (let i = 0; i + 2 < candles.length; i++) {
    keep(sandwich(candles, i, "bullish", timeframe));
    keep(sandwich(candles, i, "bearish", timeframe));
  }
  for (const f of best.values()) out.push(f);
  return out.sort((a, b) => b.completedAtIndex - a.completedAtIndex);
}
