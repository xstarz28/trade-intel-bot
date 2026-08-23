/**
 * Phase 2 — Smart Money Concepts algorithms (pure functions, no I/O).
 *
 * Everything here is derived strictly from actual OHLCV candles.
 * No hardcoded levels, no synthetic data. When inputs are insufficient
 * (e.g. zero volume), results are explicitly marked unavailable.
 *
 * Documented tolerances & thresholds:
 * - EQUAL_LEVEL_TOLERANCE = 0.0015 → two swing highs (lows) are "equal"
 *   when |a − b| / b ≤ 0.15%. Tight enough to avoid noise, loose enough
 *   for realistic equal-level clusters on liquid instruments.
 * - SWEEP definition → wick pierces the level AND the candle CLOSES back
 *   on the original side. A close THROUGH the level is a breakout
 *   (pool "broken"), not a sweep.
 * - DISPLACEMENT_MIN_BODY_RATIO = 0.6 and DISPLACEMENT_MIN_ATR_MULT = 1.5
 *   → a candle is displacement when its body dominates its range AND the
 *   range is ≥1.5× ATR(14) (or ≥1.5× avg range of last 20 candles if ATR
 *   unavailable). Large wicks alone do not qualify.
 * - MIN_FVG_ATR_MULT = 0.15 → a three-candle gap smaller than 15% of ATR
 *   (or 0.05% of price without ATR) is noise, not a tradeable FVG.
 * - Order Block validation requires ALL of: preceding opposing candle,
 *   subsequent displacement, and a structural break (BOS) afterwards.
 */

import type {
  DisplacementEvent,
  FairValueGap,
  InternalExternalStructure,
  LiquidityPool,
  LiquiditySweepEvent,
  OhlcvCandle,
  OrderBlock,
  SmcContext,
  TimeframeStructureContext,
  VolumeProfileContext,
  VwapBand,
  VwapContext,
} from "./market-types";
import { atr as computeAtr } from "./technical";

// ── Documented constants ──────────────────────────────────────────

export const EQUAL_LEVEL_TOLERANCE = 0.0015; // 0.15% relative
export const DISPLACEMENT_MIN_BODY_RATIO = 0.6;
export const DISPLACEMENT_MIN_ATR_MULT = 1.5;
export const MIN_FVG_ATR_MULT = 0.15;
export const OB_BOS_WINDOW = 8; // candles allowed for BOS after the OB candle
const VOLUME_PROFILE_BINS = 24;
const VALUE_AREA_COVERAGE = 0.7; // 70% of volume inside Value Area

// ── Swing points with indices ─────────────────────────────────────

export interface SwingPoint {
  price: number;
  index: number;
}

/** Fractal swing detection that keeps the candle index of each swing. */
export function detectSwingPoints(
  candles: OhlcvCandle[],
  lookback: number,
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high > c.high) isHigh = false;
      if (candles[j].low < c.low) isLow = false;
    }
    if (isHigh) highs.push({ price: c.high, index: i });
    if (isLow) lows.push({ price: c.low, index: i });
  }

  return { highs, lows };
}

function structureFromPoints(
  highs: SwingPoint[],
  lows: SwingPoint[],
): "HH/HL" | "LH/LL" | "range" | "unknown" {
  if (highs.length < 2 || lows.length < 2) return "unknown";
  const rh = highs.slice(-3);
  const rl = lows.slice(-3);
  const highsRising = rh[rh.length - 1].price > rh[0].price;
  const lowsRising = rl[rl.length - 1].price > rl[0].price;
  if (highsRising && lowsRising) return "HH/HL";
  if (!highsRising && !lowsRising) return "LH/LL";
  return "range";
}

// ── Equal highs / lows ────────────────────────────────────────────

/** Group levels whose relative distance ≤ tolerance. Returns groups with ≥2 members. */
export function detectEqualLevels(
  points: SwingPoint[],
  tolerance: number = EQUAL_LEVEL_TOLERANCE,
): SwingPoint[][] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const groups: SwingPoint[][] = [];
  let current: SwingPoint[] = [];

  for (const p of sorted) {
    if (
      current.length === 0 ||
      Math.abs(p.price - current[current.length - 1].price) / p.price <= tolerance
    ) {
      current.push(p);
    } else {
      if (current.length >= 2) groups.push(current);
      current = [p];
    }
  }
  if (current.length >= 2) groups.push(current);

  return groups;
}

// ── Liquidity pools & sweeps ──────────────────────────────────────

/**
 * Build resting liquidity pools from major swings:
 * - equal highs → buy-side pool at the HIGHEST of the cluster
 * - equal lows → sell-side pool at the LOWEST of the cluster
 * - unclustered recent majors → single-touch pools
 *
 * Sweep vs breakout (per candle after formation):
 * - buy-side (above): high > level && close < level → swept
 * -                    close > level              → broken (breakout)
 * - sell-side mirrored.
 */
export function buildLiquidityPools(
  candles: OhlcvCandle[],
  majorHighs: SwingPoint[],
  majorLows: SwingPoint[],
): { pools: LiquidityPool[]; sweeps: LiquiditySweepEvent[] } {
  const pools: LiquidityPool[] = [];
  const sweeps: LiquiditySweepEvent[] = [];
  const timeframeRef = ""; // filled by caller context if needed

  const eqHighGroups = detectEqualLevels(majorHighs);
  const eqLowGroups = detectEqualLevels(majorLows);

  const clusteredHighIdx = new Set(eqHighGroups.flat().map((p) => p.index));
  const clusteredLowIdx = new Set(eqLowGroups.flat().map((p) => p.index));

  const candidates: Array<Omit<LiquidityPool, "swept" | "broken" | "sweptAtIndex" | "sweptAtTime"> & { formedIndex: number }> = [];

  for (const group of eqHighGroups) {
    const level = Math.max(...group.map((p) => p.price));
    const formedIndex = Math.max(...group.map((p) => p.index));
    candidates.push({ level, side: "buy_side", source: "equal_highs", touches: group.length, formedIndex });
  }
  for (const group of eqLowGroups) {
    const level = Math.min(...group.map((p) => p.price));
    const formedIndex = Math.max(...group.map((p) => p.index));
    candidates.push({ level, side: "sell_side", source: "equal_lows", touches: group.length, formedIndex });
  }
  // Recent unclustered majors — keep the last 3 of each side to limit noise
  const soloHighs = majorHighs.filter((p) => !clusteredHighIdx.has(p.index)).slice(-3);
  const soloLows = majorLows.filter((p) => !clusteredLowIdx.has(p.index)).slice(-3);
  for (const p of soloHighs) {
    candidates.push({ level: p.price, side: "buy_side", source: "swing_high", touches: 1, formedIndex: p.index });
  }
  for (const p of soloLows) {
    candidates.push({ level: p.price, side: "sell_side", source: "swing_low", touches: 1, formedIndex: p.index });
  }

  for (const cand of candidates) {
    const pool: LiquidityPool = {
      level: cand.level,
      side: cand.side,
      source: cand.source,
      touches: cand.touches,
      swept: false,
      broken: false,
    };
    for (let j = cand.formedIndex + 1; j < candles.length; j++) {
      const c = candles[j];
      if (cand.side === "buy_side") {
        if (c.close > cand.level) {
          pool.broken = true; // closed through → breakout, no longer liquidity
          break;
        }
        if (c.high > cand.level) {
          pool.swept = true; // wicked through, closed back below → sweep
          pool.sweptAtIndex = j;
          pool.sweptAtTime = c.timestamp;
          sweeps.push({
            level: cand.level,
            side: cand.side,
            source: cand.source,
            candleIndex: j,
            candleTime: c.timestamp,
            timeframe: timeframeRef || "primary",
          });
          break; // pool consumed by the sweep
        }
      } else {
        if (c.close < cand.level) {
          pool.broken = true;
          break;
        }
        if (c.low < cand.level) {
          pool.swept = true;
          pool.sweptAtIndex = j;
          pool.sweptAtTime = c.timestamp;
          sweeps.push({
            level: cand.level,
            side: cand.side,
            source: cand.source,
            candleIndex: j,
            candleTime: c.timestamp,
            timeframe: timeframeRef || "primary",
          });
          break;
        }
      }
    }
    pools.push(pool);
  }

  return { pools, sweeps };
}

// ── FVG / imbalance ───────────────────────────────────────────────

export function detectFvgs(
  candles: OhlcvCandle[],
  timeframe: string,
  atrValue?: number,
): FairValueGap[] {
  const fvgs: FairValueGap[] = [];
  const scanFrom = Math.max(2, candles.length - 120);

  for (let i = Math.max(scanFrom, 2); i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c2 = candles[i];
    const minGap =
      atrValue !== undefined && atrValue > 0
        ? MIN_FVG_ATR_MULT * atrValue
        : c2.close * 0.0005;

    // Bullish FVG: gap between candle[i-2].high and candle[i].low
    if (c2.low > c0.high && c2.low - c0.high >= minGap) {
      const gap: FairValueGap = {
        direction: "bullish",
        upper: c2.low,
        lower: c0.high,
        timeframe,
        createdAtIndex: i,
        createdAt: c2.timestamp,
        status: "fresh",
      };
      // Status from subsequent candles
      for (let j = i + 1; j < candles.length; j++) {
        const cj = candles[j];
        if (cj.close < gap.lower) {
          gap.status = "invalidated"; // closed through the far side
          break;
        }
        if (cj.low <= gap.upper) {
          gap.status = "mitigated"; // price traded back into the zone
          break;
        }
      }
      fvgs.push(gap);
    }

    // Bearish FVG: gap between candle[i].high and candle[i-2].low
    if (c2.high < c0.low && c0.low - c2.high >= minGap) {
      const gap: FairValueGap = {
        direction: "bearish",
        upper: c0.low,
        lower: c2.high,
        timeframe,
        createdAtIndex: i,
        createdAt: c2.timestamp,
        status: "fresh",
      };
      for (let j = i + 1; j < candles.length; j++) {
        const cj = candles[j];
        if (cj.close > gap.upper) {
          gap.status = "invalidated";
          break;
        }
        if (cj.high >= gap.lower) {
          gap.status = "mitigated";
          break;
        }
      }
      fvgs.push(gap);
    }
  }

  return fvgs.reverse().slice(0, 12); // most recent first
}

// ── Displacement ──────────────────────────────────────────────────

export function detectDisplacement(
  candles: OhlcvCandle[],
  atrValue?: number,
): DisplacementEvent | undefined {
  const window = Math.min(candles.length, 30);
  const start = candles.length - window;
  if (start < 0) return undefined;

  // Reference volatility: ATR(14), fallback to average range of prior candles
  let refRange = atrValue;
  if (!refRange || refRange <= 0) {
    const ranges = candles.map((c) => c.high - c.low).slice(-21, -1);
    refRange = ranges.length > 0 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
  }
  if (!refRange || refRange <= 0) return undefined;

  for (let i = candles.length - 1; i >= start; i--) {
    const c = candles[i];
    const range = c.high - c.low;
    if (range <= 0) continue;
    const bodyRatio = Math.abs(c.close - c.open) / range;
    const rangeAtrMultiple = range / refRange;
    if (bodyRatio >= DISPLACEMENT_MIN_BODY_RATIO && rangeAtrMultiple >= DISPLACEMENT_MIN_ATR_MULT) {
      return {
        direction: c.close > c.open ? "bullish" : "bearish",
        candleIndex: i,
        candleTime: c.timestamp,
        bodyRatio: Math.round(bodyRatio * 100) / 100,
        rangeAtrMultiple: Math.round(rangeAtrMultiple * 100) / 100,
      };
    }
  }
  return undefined;
}

// ── Order Blocks (validated only) ─────────────────────────────────

/**
 * A candle qualifies as an Order Block ONLY when ALL hold:
 * 1. It is an opposing-color candle before a directional move.
 * 2. Within the next 3 candles there is displacement in the move direction.
 * 3. Within OB_BOS_WINDOW candles price closes beyond the extreme of the
 *    preceding 5 candles (structural break / BOS).
 */
export function detectOrderBlocks(
  candles: OhlcvCandle[],
  timeframe: string,
  atrValue?: number,
): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  let refRange = atrValue;
  if (!refRange || refRange <= 0) {
    const ranges = candles.map((c) => c.high - c.low).slice(-21, -1);
    refRange = ranges.length > 0 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
  }
  if (!refRange || refRange <= 0) return blocks;

  const start = Math.max(5, candles.length - 80);

  for (let i = candles.length - 4; i >= start; i--) {
    const ob = candles[i];

    // 1. Opposing candle
    const bullishCandidate = ob.close < ob.open; // down candle before an up-move
    const bearishCandidate = ob.close > ob.open; // up candle before a down-move
    if (!bullishCandidate && !bearishCandidate) continue;

    const direction: "bullish" | "bearish" = bullishCandidate ? "bullish" : "bearish";

    // 2. Displacement within next 3 candles in the move direction
    let displacementAfter = false;
    let displacementRangeAtr = 0;
    for (let j = i + 1; j <= Math.min(i + 3, candles.length - 1); j++) {
      const c = candles[j];
      const range = c.high - c.low;
      const bodyRatio = range > 0 ? Math.abs(c.close - c.open) / range : 0;
      const isDisp =
        bodyRatio >= DISPLACEMENT_MIN_BODY_RATIO &&
        range >= DISPLACEMENT_MIN_ATR_MULT * refRange &&
        ((direction === "bullish" && c.close > c.open) ||
          (direction === "bearish" && c.close < c.open));
      if (isDisp) {
        displacementAfter = true;
        displacementRangeAtr = Math.round((range / refRange) * 100) / 100;
        break;
      }
    }
    if (!displacementAfter) continue;

    // 3. Structural break within OB_BOS_WINDOW
    const preWindow = candles.slice(Math.max(0, i - 5), i);
    if (preWindow.length === 0) continue;
    const structuralBreakAfter =
      direction === "bullish"
        ? candles
            .slice(i + 1, Math.min(i + OB_BOS_WINDOW + 1, candles.length))
            .some((c) => c.close > Math.max(...preWindow.map((p) => p.high)))
        : candles
            .slice(i + 1, Math.min(i + OB_BOS_WINDOW + 1, candles.length))
            .some((c) => c.close < Math.min(...preWindow.map((p) => p.low)));
    if (!structuralBreakAfter) continue;

    // Validated Order Block — determine status from later price action
    const zoneUpper = ob.high;
    const zoneLower = ob.low;
    let status: OrderBlock["status"] = "fresh";
    for (let j = i + 4; j < candles.length; j++) {
      const cj = candles[j];
      if (direction === "bullish") {
        if (cj.close < zoneLower) {
          status = "invalidated";
          break;
        }
        if (cj.low <= zoneUpper) {
          status = "mitigated";
          break;
        }
      } else {
        if (cj.close > zoneUpper) {
          status = "invalidated";
          break;
        }
        if (cj.high >= zoneLower) {
          status = "mitigated";
          break;
        }
      }
    }

    blocks.push({
      direction,
      upper: zoneUpper,
      lower: zoneLower,
      timeframe,
      createdAt: ob.timestamp,
      status,
      evidence: {
        precedingOpposingCandle: true,
        displacementAfter: true,
        structuralBreakAfter: true,
        displacementRangeAtr,
      },
    });

    if (blocks.length >= 3) break; // most recent validated blocks only
  }

  return blocks; // most recent first (loop runs backwards)
}

// ── VWAP ──────────────────────────────────────────────────────────

export function computeVwap(candles: OhlcvCandle[]): VwapContext {
  if (candles.length === 0) {
    return { available: false, unavailableReason: "No candle data.", priceLocation: "unavailable" };
  }

  const totalVol = candles.reduce((s, c) => s + c.volume, 0);
  if (!(totalVol > 0)) {
    return {
      available: false,
      unavailableReason:
        "Volume data is zero/not representative — session VWAP cannot be computed honestly.",
      priceLocation: "unavailable",
    };
  }

  // Session VWAP: cumulative from the start of the latest UTC day
  let cumPV = 0;
  let cumV = 0;
  let cumP2V = 0;
  const lastDay = new Date(candles[candles.length - 1].timestamp).getUTCDate();
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (new Date(c.timestamp).getUTCDate() !== lastDay) break; // previous session started
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumP2V += typical * typical * c.volume;
    cumV += c.volume;
  }

  if (!(cumV > 0)) {
    return {
      available: false,
      unavailableReason: "Current session has no volume yet.",
      priceLocation: "unavailable",
    };
  }

  const sessionVwap = cumPV / cumV;
  const variance = Math.max(0, cumP2V / cumV - sessionVwap * sessionVwap);
  const sigma = Math.sqrt(variance);
  const bands: VwapBand | undefined =
    sigma > 0
      ? {
          minus2: sessionVwap - 2 * sigma,
          minus1: sessionVwap - sigma,
          vwap: sessionVwap,
          plus1: sessionVwap + sigma,
          plus2: sessionVwap + 2 * sigma,
        }
      : undefined;

  // Anchored VWAP from the most recent major swing point (either type)
  const majorLookback = candles.length > 100 ? 7 : 5;
  const { highs, lows } = detectSwingPoints(candles, majorLookback);
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const anchor =
    lastHigh && lastLow ? (lastHigh.index > lastLow.index ? lastHigh : lastLow) : lastHigh ?? lastLow;

  let anchored: VwapContext["anchoredVwap"] | undefined;
  if (anchor) {
    let aPV = 0;
    let aV = 0;
    for (let i = anchor.index; i < candles.length; i++) {
      const c = candles[i];
      const typical = (c.high + c.low + c.close) / 3;
      aPV += typical * c.volume;
      aV += c.volume;
    }
    if (aV > 0) anchored = { anchorTime: candles[anchor.index].timestamp, value: aPV / aV };
  }

  const price = candles[candles.length - 1].close;
  const atThreshold = bands ? bands.plus1 * 0.1 : sessionVwap * 0.0005;
  const priceLocation: VwapContext["priceLocation"] =
    Math.abs(price - sessionVwap) <= atThreshold
      ? "at_vwap"
      : price > sessionVwap
        ? "above_vwap"
        : "below_vwap";

  return { available: true, sessionVwap, anchoredVwap: anchored, bands, priceLocation };
}

// ── Volume Profile ────────────────────────────────────────────────

export function computeVolumeProfile(candles: OhlcvCandle[]): VolumeProfileContext {
  if (candles.length === 0) {
    return { available: false, unavailableReason: "No candle data." };
  }

  const totalVolume = candles.reduce((s, c) => s + c.volume, 0);
  if (!(totalVolume > 0)) {
    return {
      available: false,
      unavailableReason:
        "Volume data is zero/not representative (typical for spot forex feeds) — Volume Profile omitted rather than fabricated.",
    };
  }

  const low = Math.min(...candles.map((c) => c.low));
  const high = Math.max(...candles.map((c) => c.high));
  if (!(high > low)) {
    return { available: false, unavailableReason: "Price range too narrow." };
  }

  const binSize = (high - low) / VOLUME_PROFILE_BINS;
  const bins = new Array<number>(VOLUME_PROFILE_BINS).fill(0);

  for (const c of candles) {
    // Spread each candle's volume across every bin its range touches
    const startBin = Math.min(
      VOLUME_PROFILE_BINS - 1,
      Math.max(0, Math.floor((c.low - low) / binSize)),
    );
    const endBin = Math.min(
      VOLUME_PROFILE_BINS - 1,
      Math.max(0, Math.floor((c.high - low) / binSize)),
    );
    const span = endBin - startBin + 1;
    for (let b = startBin; b <= endBin; b++) bins[b] += c.volume / span;
  }

  const centers = bins.map((_, i) => low + binSize * (i + 0.5));

  // POC
  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) {
    if (bins[i] > bins[pocIdx]) pocIdx = i;
  }

  // Value Area: expand from POC until VALUE_AREA_COVERAGE of volume contained
  let vaLo = pocIdx;
  let vaHi = pocIdx;
  let vaVolume = bins[pocIdx];
  while (vaVolume / totalVolume < VALUE_AREA_COVERAGE && (vaLo > 0 || vaHi < bins.length - 1)) {
    const below = vaLo > 0 ? bins[vaLo - 1] : -1;
    const above = vaHi < bins.length - 1 ? bins[vaHi + 1] : -1;
    if (above >= below) {
      vaHi++;
      vaVolume += bins[vaHi];
    } else {
      vaLo--;
      vaVolume += bins[vaLo];
    }
  }

  const meanVol = totalVolume / bins.length;
  const hvn = centers.filter((_, i) => bins[i] >= 1.5 * meanVol).slice(0, 5);
  const lvn = centers.filter((_, i) => bins[i] <= 0.35 * meanVol).slice(0, 5);

  return {
    available: true,
    poc: centers[pocIdx],
    vah: centers[vaHi],
    val: centers[vaLo],
    hvn,
    lvn,
  };
}

// ── Assembler ─────────────────────────────────────────────────────

export function computeSmcContext(
  candles: OhlcvCandle[],
  timeframe: string,
): SmcContext {
  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const atrValue = computeAtr(candles, 14);

  const majorLookback = candles.length > 100 ? 7 : 5;
  const minorLookback = 3;
  const majorPts = detectSwingPoints(candles, majorLookback);
  const minorPts = detectSwingPoints(candles, minorLookback);

  // External (major) structure — the primary trend context
  const externalStructure = structureFromPoints(majorPts.highs, majorPts.lows);
  const extLastHigh = majorPts.highs[majorPts.highs.length - 1]?.price;
  const extLastLow = majorPts.lows[majorPts.lows.length - 1]?.price;
  let externalBos: "bullish" | "bearish" | "none" = "none";
  if (extLastHigh !== undefined && currentPrice > extLastHigh) externalBos = "bullish";
  else if (extLastLow !== undefined && currentPrice < extLastLow) externalBos = "bearish";

  let externalChoch: "bullish" | "bearish" | "none" = "none";
  if (externalStructure === "HH/HL" && extLastLow !== undefined && currentPrice < extLastLow)
    externalChoch = "bearish";
  else if (externalStructure === "LH/LL" && extLastHigh !== undefined && currentPrice > extLastHigh)
    externalChoch = "bullish";

  // Internal (minor) structure — trigger context, NOT the macro trend
  const internalStructure = structureFromPoints(minorPts.highs, minorPts.lows);
  const intLastHigh = minorPts.highs[minorPts.highs.length - 1]?.price;
  const intLastLow = minorPts.lows[minorPts.lows.length - 1]?.price;
  let internalBos: "bullish" | "bearish" | "none" = "none";
  if (intLastHigh !== undefined && currentPrice > intLastHigh) internalBos = "bullish";
  else if (intLastLow !== undefined && currentPrice < intLastLow) internalBos = "bearish";
  let internalChoch: "bullish" | "bearish" | "none" = "none";
  if (internalStructure === "HH/HL" && intLastLow !== undefined && currentPrice < intLastLow)
    internalChoch = "bearish";
  else if (internalStructure === "LH/LL" && intLastHigh !== undefined && currentPrice > intLastHigh)
    internalChoch = "bullish";

  const dirOf = (
    s: "HH/HL" | "LH/LL" | "range" | "unknown",
    ch: "bullish" | "bearish" | "none",
  ): "long" | "short" | "none" =>
    ch === "bullish" ? "long" : ch === "bearish" ? "short" : s === "HH/HL" ? "long" : s === "LH/LL" ? "short" : "none";

  const extDir = dirOf(externalStructure, externalChoch);
  const intDir = dirOf(internalStructure, internalChoch);
  const internalConflict =
    extDir !== "none" && intDir !== "none" && extDir !== intDir;

  const mkCtx = (
    label: string,
    structure: "HH/HL" | "LH/LL" | "range" | "unknown",
    bos: "bullish" | "bearish" | "none",
    choch: "bullish" | "bearish" | "none",
    lh?: number,
    ll?: number,
  ): TimeframeStructureContext => ({
    timeframe: label,
    structure,
    bosDirection: bos,
    chochDirection: choch,
    lastSwingHigh: lh,
    lastSwingLow: ll,
    dataPoints: candles.length,
  });

  const internalExternal: InternalExternalStructure = {
    external: mkCtx(timeframe, externalStructure, externalBos, externalChoch, extLastHigh, extLastLow),
    internal: mkCtx(timeframe + ":internal", internalStructure, internalBos, internalChoch, intLastHigh, intLastLow),
    internalConflict,
  };

  // Liquidity
  const { pools, sweeps } = buildLiquidityPools(candles, majorPts.highs, majorPts.lows);
  const sortedSweeps = [...sweeps].sort((a, b) => b.candleIndex - a.candleIndex);
  const recentSweep = sortedSweeps[0] ? { ...sortedSweeps[0], timeframe } : undefined;

  return {
    timeframe,
    liquidityPools: pools.sort((a, b) => b.touches - a.touches),
    recentSweep,
    internalExternal,
    fvgs: detectFvgs(candles, timeframe, atrValue),
    displacement: detectDisplacement(candles, atrValue),
    orderBlocks: detectOrderBlocks(candles, timeframe, atrValue),
    vwap: computeVwap(candles),
    volumeProfile: computeVolumeProfile(candles),
  };
}
