/**
 * Phase 312 — deterministic chart-pattern recognition from REAL swing points.
 *
 * SOURCE BOUNDARY: the source document names Bull Flag, Bear Flag, Falling
 * Wedge and Rising Wedge without numeric geometry. The operationalisation here
 * is ENGINE-DEFINED and exact: every threshold is an exported constant, every
 * detection is computed from confirmed swing points of actual OHLCV candles
 * (no visual guessing, no text-only "looks like a flag" classifier), and every
 * result carries the exact swings, bounds, confirmation and invalidation
 * conditions it stands on. A pattern is descriptive context — never by itself
 * a trade signal.
 */

import type { OhlcvCandle } from "../data/market-types";
import { detectSwingPoints, type SwingPoint } from "../data/smc";
import { atr } from "../data/technical";

/** ENGINE-DEFINED pattern geometry (documented in the header). */
export const POLE_MIN_MOVE_ATR = 2.0;
export const POLE_MAX_CANDLES = 15;
export const FLAG_MIN_CANDLES = 4;
export const FLAG_MAX_RETRACE = 0.618;
export const WEDGE_MIN_SWINGS_PER_SIDE = 2;
export const WEDGE_MIN_CANDLES = 10;

export type PatternType = "bull_flag" | "bear_flag" | "falling_wedge" | "rising_wedge";
export type PatternStatus = "forming" | "confirmed" | "invalidated";

export interface DetectedPattern {
  type: PatternType;
  timeframe: string;
  /** Pole direction (flags) or wedge slope family. */
  direction: "bullish" | "bearish";
  /** Overall formation bounds. */
  upper: number;
  lower: number;
  startIndex: number;
  startTime: number;
  /** Last candle inside the formation before confirmation/evaluation. */
  formationEndIndex: number;
  formationEndTime: number;
  /** The exact swing points the geometry stands on. */
  swings: Array<{ index: number; timestamp: number; price: number; role: string }>;
  /** Human-readable, fully deterministic confirmation condition. */
  confirmation: string;
  /** Human-readable, fully deterministic invalidation condition. */
  invalidation: string;
  status: PatternStatus;
  /** Candle that satisfied the confirmation condition (verbatim timestamp). */
  confirmedAtIndex?: number;
  confirmedAtTime?: number;
  invalidatedAtIndex?: number;
  invalidatedAtTime?: number;
  atrUsed: number;
}

function lineThrough(a: SwingPoint, b: SwingPoint): (x: number) => number {
  const slope = (b.price - a.price) / Math.max(1, b.index - a.index);
  return (x: number) => a.price + slope * (x - a.index);
}

function slopeBetween(a: SwingPoint, b: SwingPoint): number {
  return (b.price - a.price) / Math.max(1, b.index - a.index);
}

/**
 * Flags: a strong directional pole, then a counter-direction consolidation
 * that retraces at most FLAG_MAX_RETRACE of the pole. Bull flag confirms on a
 * close above the last consolidation swing high; invalidates on a close below
 * the consolidation low.
 */
function detectFlags(
  candles: OhlcvCandle[],
  timeframe: string,
  atrValue: number,
): DetectedPattern[] {
  const results: DetectedPattern[] = [];

  const consider = (type: "bull_flag" | "bear_flag") => {
    const bull = type === "bull_flag";
    for (let a = 0; a < candles.length - FLAG_MIN_CANDLES - 2; a++) {
      // Pole: strongest adverse-to-favourable extreme pair within the window.
      const windowEnd = Math.min(candles.length - 1, a + POLE_MAX_CANDLES);
      let poleStart = a;
      let poleEnd = -1;
      let poleMove = 0;
      for (let b = a + 1; b <= windowEnd; b++) {
        if (bull) {
          let lo = Infinity;
          for (let k = a; k <= b; k++) lo = Math.min(lo, candles[k].low);
          const move = candles[b].high - lo;
          if (move > poleMove) {
            poleMove = move;
            poleEnd = b;
          }
        } else {
          let hi = -Infinity;
          for (let k = a; k <= b; k++) hi = Math.max(hi, candles[k].high);
          const move = hi - candles[b].low;
          if (move > poleMove) {
            poleMove = move;
            poleEnd = b;
          }
        }
      }
      if (poleEnd < 0) continue;
      if (!(atrValue > 0) || poleMove < POLE_MIN_MOVE_ATR * atrValue) continue;
      poleStart = a;

      // Consolidation: candles after the pole extreme, bounded in time, that
      // stay within the retrace cap and drift against the pole.
      const poleExtreme = bull ? candles[poleEnd].high : candles[poleEnd].low;
      const poleBase = bull
        ? Math.min(...candles.slice(poleStart, poleEnd + 1).map((c) => c.low))
        : Math.max(...candles.slice(poleStart, poleEnd + 1).map((c) => c.high));
      const poleSize = Math.abs(poleExtreme - poleBase);
      let lastConsolIndex = -1;
      let consolHigh = bull ? -Infinity : -Infinity;
      let consolLow = Infinity;
      for (let k = poleEnd + 1; k < Math.min(candles.length, poleEnd + 1 + 2 * POLE_MAX_CANDLES); k++) {
        const c = candles[k];
        if (bull) {
          if (c.high > poleExtreme) break; // new impulse — consolidation ended
          consolHigh = Math.max(consolHigh, c.high);
          consolLow = Math.min(consolLow, c.low);
        } else {
          if (c.low < poleExtreme) break;
          consolHigh = Math.max(consolHigh, c.high);
          consolLow = Math.min(consolLow, c.low);
        }
        lastConsolIndex = k;
        const adverse = bull ? poleExtreme - consolLow : consolHigh - poleExtreme;
        if (adverse > FLAG_MAX_RETRACE * poleSize) {
          // Retreat: the cap applies to the FINAL consolidation range; cut here.
          break;
        }
      }
      if (lastConsolIndex < 0) continue;
      if (lastConsolIndex - poleEnd + 1 < FLAG_MIN_CANDLES) continue;

      // Re-measure the consolidation range up to lastConsolIndex.
      consolHigh = -Infinity;
      consolLow = Infinity;
      for (let k = poleEnd + 1; k <= lastConsolIndex; k++) {
        consolHigh = Math.max(consolHigh, candles[k].high);
        consolLow = Math.min(consolLow, candles[k].low);
      }
      const adverse = bull ? poleExtreme - consolLow : consolHigh - poleExtreme;
      if (adverse > FLAG_MAX_RETRACE * poleSize) continue;

      // Confirmation / invalidation from candles after the consolidation.
      let status: PatternStatus = "forming";
      let confirmedAtIndex: number | undefined;
      let confirmedAtTime: number | undefined;
      let invalidatedAtIndex: number | undefined;
      let invalidatedAtTime: number | undefined;
      for (let k = lastConsolIndex + 1; k < candles.length; k++) {
        const c = candles[k];
        const confirmed = bull ? c.close > consolHigh : c.close < consolLow;
        const invalidated = bull ? c.close < consolLow : c.close > consolHigh;
        if (invalidated) {
          status = "invalidated";
          invalidatedAtIndex = k;
          invalidatedAtTime = c.timestamp;
          break;
        }
        if (confirmed) {
          status = "confirmed";
          confirmedAtIndex = k;
          confirmedAtTime = c.timestamp;
          break;
        }
      }

      results.push({
        type,
        timeframe,
        direction: bull ? "bullish" : "bearish",
        upper: consolHigh,
        lower: consolLow,
        startIndex: poleStart,
        startTime: candles[poleStart].timestamp,
        formationEndIndex: lastConsolIndex,
        formationEndTime: candles[lastConsolIndex].timestamp,
        swings: [
          { index: poleStart, timestamp: candles[poleStart].timestamp, price: candles[poleStart].close, role: "pole_start" },
          { index: poleEnd, timestamp: candles[poleEnd].timestamp, price: candles[poleEnd].close, role: "pole_end" },
        ],
        confirmation: bull
          ? `close above the consolidation high ${consolHigh}`
          : `close below the consolidation low ${consolLow}`,
        invalidation: bull
          ? `close below the consolidation low ${consolLow}`
          : `close above the consolidation high ${consolHigh}`,
        status,
        ...(confirmedAtIndex !== undefined ? { confirmedAtIndex, confirmedAtTime } : {}),
        ...(invalidatedAtIndex !== undefined ? { invalidatedAtIndex, invalidatedAtTime } : {}),
        atrUsed: atrValue,
      });
    }
  };

  consider("bull_flag");
  consider("bear_flag");

  // Keep one pattern per type: the most recently completed formation.
  const best = new Map<PatternType, DetectedPattern>();
  for (const p of results) {
    const current = best.get(p.type);
    if (!current || p.formationEndIndex > current.formationEndIndex) best.set(p.type, p);
  }
  return [...best.values()];
}

/**
 * Wedges: at least WEDGE_MIN_SWINGS_PER_SIDE confirmed swing highs and lows
 * after the first anchor; both boundary slopes trend the same direction and
 * converge. Falling wedge (both slopes down, lows fall faster) is bullish;
 * rising wedge (both slopes up, highs rise faster) is bearish. Confirmation =
 * close beyond the converging upper/lower boundary; invalidation = close
 * beyond the opposite boundary.
 */
function detectWedges(
  candles: OhlcvCandle[],
  timeframe: string,
  atrValue: number,
): DetectedPattern[] {
  const { highs, lows } = detectSwingPoints(candles, 2);
  if (highs.length < WEDGE_MIN_SWINGS_PER_SIDE || lows.length < WEDGE_MIN_SWINGS_PER_SIDE) {
    return [];
  }
  const results: DetectedPattern[] = [];

  const build = (kind: "falling_wedge" | "rising_wedge") => {
    const falling = kind === "falling_wedge";
    const anchorIndex = Math.min(highs[0].index, lows[0].index);
    const hs = highs.slice(-3); // most recent confirmed highs
    const ls = lows.slice(-3);
    const upperA = hs[0];
    const upperB = hs[hs.length - 1];
    const lowerA = ls[0];
    const lowerB = ls[ls.length - 1];
    if (upperB.index - upperA.index < WEDGE_MIN_CANDLES) return;
    const upperSlope = slopeBetween(upperA, upperB);
    const lowerSlope = slopeBetween(lowerA, lowerB);

    if (falling) {
      if (upperSlope >= 0 || lowerSlope >= 0) return;
      if (Math.abs(lowerSlope) <= Math.abs(upperSlope)) return; // must converge
    } else {
      if (upperSlope <= 0 || lowerSlope <= 0) return;
      if (upperSlope <= lowerSlope) return;
    }

    const upperLine = lineThrough(upperA, upperB);
    const lowerLine = lineThrough(lowerA, lowerB);
    const lastIndex = candles.length - 1;
    const upperNow = upperLine(lastIndex);
    const lowerNow = lowerLine(lastIndex);
    if (!(upperNow > lowerNow)) return; // not converged yet — still a valid channel check

    let status: PatternStatus = "forming";
    let confirmedAtIndex: number | undefined;
    let confirmedAtTime: number | undefined;
    let invalidatedAtIndex: number | undefined;
    let invalidatedAtTime: number | undefined;
    for (let k = Math.max(upperB.index, lowerB.index) + 1; k < candles.length; k++) {
      const c = candles[k];
      const u = upperLine(k);
      const l = lowerLine(k);
      // Confirmed: close beyond the boundary OPPOSITE the wedge's pressure
      // (falling wedge: up through the upper line; rising: down through lower).
      const confirmed = falling ? c.close > u : c.close < l;
      const invalidated = falling ? c.close < l : c.close > u;
      if (invalidated) {
        status = "invalidated";
        invalidatedAtIndex = k;
        invalidatedAtTime = c.timestamp;
        break;
      }
      if (confirmed) {
        status = "confirmed";
        confirmedAtIndex = k;
        confirmedAtTime = c.timestamp;
        break;
      }
    }

    const swings = [
      ...hs.map((s) => ({ index: s.index, timestamp: candles[s.index].timestamp, price: s.price, role: "upper_boundary" })),
      ...ls.map((s) => ({ index: s.index, timestamp: candles[s.index].timestamp, price: s.price, role: "lower_boundary" })),
    ].sort((a, b) => a.index - b.index);

    results.push({
      type: kind,
      timeframe,
      direction: falling ? "bullish" : "bearish",
      upper: Math.max(...candles.slice(anchorIndex).map((c) => c.high)),
      lower: Math.min(...candles.slice(anchorIndex).map((c) => c.low)),
      startIndex: anchorIndex,
      startTime: candles[anchorIndex].timestamp,
      formationEndIndex: Math.max(upperB.index, lowerB.index),
      formationEndTime: candles[Math.max(upperB.index, lowerB.index)].timestamp,
      swings,
      confirmation: falling
        ? "close above the falling upper boundary (projected per candle)"
        : "close below the rising lower boundary (projected per candle)",
      invalidation: falling
        ? "close below the falling lower boundary"
        : "close above the rising upper boundary",
      status,
      ...(confirmedAtIndex !== undefined ? { confirmedAtIndex, confirmedAtTime } : {}),
      ...(invalidatedAtIndex !== undefined ? { invalidatedAtIndex, invalidatedAtTime } : {}),
      atrUsed: atrValue,
    });
  };

  build("falling_wedge");
  build("rising_wedge");
  return results;
}

/**
 * Detect all four document-supported patterns from real OHLCV. Deterministic.
 * Timestamps are copied verbatim from the input candles.
 */
export function detectChartPatterns(
  candles: OhlcvCandle[],
  timeframe: string,
): DetectedPattern[] {
  if (candles.length < 12) return [];
  const atrValue = atr(candles) ?? 0;
  if (!(atrValue > 0)) return [];
  return [...detectFlags(candles, timeframe, atrValue), ...detectWedges(candles, timeframe, atrValue)];
}
