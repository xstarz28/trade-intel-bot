import type { OhlcvCandle } from "./market-types";

export type ClassicDirection = "bullish" | "bearish" | "neutral";

export interface ClassicPattern {
  name: string;
  direction: ClassicDirection;
  confidence: "high" | "medium" | "low";
  index: number;
  description: string;
}

export interface SupplyDemandZone {
  type: "RBR" | "RBD" | "DBR" | "DBD";
  direction: "demand" | "supply";
  upper: number;
  lower: number;
  index: number;
  fresh: boolean;
  description: string;
}

export interface TrendlineContext {
  highs: "rising" | "falling" | "flat" | "insufficient";
  lows: "rising" | "falling" | "flat" | "insufficient";
}

export interface ClassicPriceActionContext {
  patterns: ClassicPattern[];
  supplyDemand: SupplyDemandZone[];
  trendlines: TrendlineContext;
  chartPattern?: { name: "double_top" | "double_bottom" | "flag" | "wedge"; direction: ClassicDirection; confidence: "medium" | "low" };
  ictUnicorn?: { direction: "bullish" | "bearish"; upper: number; lower: number; timeframe: string; description: string };
  supportingEvidence: string[];
  conflictingEvidence: string[];
}

/** Classic price-action layer. It is descriptive/secondary and never creates bias. */
export function analyzeClassicPriceAction(candles: OhlcvCandle[], timeframe = "SETUP"): ClassicPriceActionContext {
  const patterns: ClassicPattern[] = [];
  const supplyDemand: SupplyDemandZone[] = [];
  const supportingEvidence: string[] = [];
  const conflictingEvidence: string[] = [];

  if (candles.length < 10) {
    return {
      patterns, supplyDemand,
      trendlines: { highs: "insufficient", lows: "insufficient" },
      supportingEvidence, conflictingEvidence,
    };
  }

  const last = candles.length - 1;
  const recent = candles.slice(Math.max(0, candles.length - 30));
  const rangeOf = (c: OhlcvCandle) => Math.max(c.high - c.low, Number.EPSILON);
  const bodyOf = (c: OhlcvCandle) => Math.abs(c.close - c.open);

  // Candlestick patterns — use closed candles only (the latest provider candle
  // is still treated as the latest observation, never extrapolated).
  for (let i = Math.max(1, candles.length - 8); i <= last; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const body = bodyOf(c);
    const range = rangeOf(c);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    if (body / range <= 0.35 && lowerWick >= Math.max(body * 2, range * 0.45) && lowerWick > upperWick * 1.25) {
      patterns.push({ name: "bullish_pin_bar", direction: "bullish", confidence: "medium", index: i, description: "Long lower rejection wick with compact body." });
    }
    if (body / range <= 0.35 && upperWick >= Math.max(body * 2, range * 0.45) && upperWick > lowerWick * 1.25) {
      patterns.push({ name: "bearish_pin_bar", direction: "bearish", confidence: "medium", index: i, description: "Long upper rejection wick with compact body." });
    }

    const prevBodyHigh = Math.max(p.open, p.close);
    const prevBodyLow = Math.min(p.open, p.close);
    const curBodyHigh = Math.max(c.open, c.close);
    const curBodyLow = Math.min(c.open, c.close);
    if (c.close > c.open && p.close < p.open && curBodyHigh >= prevBodyHigh && curBodyLow <= prevBodyLow) {
      patterns.push({ name: "bullish_engulfing", direction: "bullish", confidence: "high", index: i, description: "Bullish body fully engulfs the prior bearish body." });
    }
    if (c.close < c.open && p.close > p.open && curBodyHigh >= prevBodyHigh && curBodyLow <= prevBodyLow) {
      patterns.push({ name: "bearish_engulfing", direction: "bearish", confidence: "high", index: i, description: "Bearish body fully engulfs the prior bullish body." });
    }

    if (c.high <= p.high && c.low >= p.low) {
      const direction = p.close > p.open ? "bullish" : p.close < p.open ? "bearish" : "neutral";
      patterns.push({ name: "inside_bar", direction, confidence: "low", index: i, description: "Current range is contained inside the prior candle." });
    }
  }

  // Three-candle classic formations.
  for (let i = Math.max(2, candles.length - 20); i <= last; i++) {
    const a = candles[i - 2], b = candles[i - 1], c = candles[i];
    const ar = rangeOf(a), br = rangeOf(b), cr = rangeOf(c);
    if (br < ar * 0.65 && br < cr * 0.65) {
      if (a.close > a.open && c.close > c.open && c.close > a.high) {
        patterns.push({ name: "three_candle_bullish_continuation", direction: "bullish", confidence: "medium", index: i, description: "Impulse-base-impulse continuation sequence." });
      }
      if (a.close < a.open && c.close < c.open && c.close < a.low) {
        patterns.push({ name: "three_candle_bearish_continuation", direction: "bearish", confidence: "medium", index: i, description: "Bearish impulse-base-impulse continuation sequence." });
      }
    }
  }

  // Supply/demand formations: impulse → compact base → impulse.
  for (let i = 1; i < candles.length - 2; i++) {
    const a = candles[i - 1], base = candles[i], d = candles[i + 1];
    const ar = rangeOf(a), br = rangeOf(base), dr = rangeOf(d);
    if (br > ar * 0.65 || br > dr * 0.65) continue;
    const aBull = a.close > a.open, dBull = d.close > d.open;
    if (aBull && dBull && d.close > a.high) {
      supplyDemand.push({ type: "RBR", direction: "demand", upper: base.high, lower: base.low, index: i, fresh: i >= candles.length - 12, description: "Rally-base-rally demand formation." });
    } else if (aBull && !dBull && d.close < base.low) {
      supplyDemand.push({ type: "RBD", direction: "supply", upper: base.high, lower: base.low, index: i, fresh: i >= candles.length - 12, description: "Rally-base-drop supply formation." });
    } else if (!aBull && dBull && d.close > base.high) {
      supplyDemand.push({ type: "DBR", direction: "demand", upper: base.high, lower: base.low, index: i, fresh: i >= candles.length - 12, description: "Drop-base-rally demand formation." });
    } else if (!aBull && !dBull && d.close < a.low) {
      supplyDemand.push({ type: "DBD", direction: "supply", upper: base.high, lower: base.low, index: i, fresh: i >= candles.length - 12, description: "Drop-base-drop supply formation." });
    }
  }

  // Trendline context from recent swing-like extrema. This is context only;
  // no arbitrary line is used as an execution level.
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const slope = (xs: number[]) => xs.length >= 3 ? (xs[xs.length - 1] - xs[0]) / Math.max(xs.length - 1, 1) : 0;
  const hs = slope(highs), ls = slope(lows);
  const eps = Math.max((Math.max(...highs) - Math.min(...lows)) * 0.002, Number.EPSILON);
  const trendlines: TrendlineContext = {
    highs: Math.abs(hs) <= eps ? "flat" : hs > 0 ? "rising" : "falling",
    lows: Math.abs(ls) <= eps ? "flat" : ls > 0 ? "rising" : "falling",
  };

  // Classical chart-pattern context from converging / repeated extremes.
  const h1 = highs[highs.length - 1], h2 = highs[Math.max(0, highs.length - 6)];
  const l1 = lows[lows.length - 1], l2 = lows[Math.max(0, lows.length - 6)];
  const highSpan = Math.max(...highs) - Math.min(...highs);
  const lowSpan = Math.max(...lows) - Math.min(...lows);
  let chartPattern: ClassicPriceActionContext["chartPattern"];
  if (Math.abs(h1 - h2) <= Math.max(highSpan * 0.12, eps) && Math.abs(l1 - l2) <= Math.max(lowSpan * 0.12, eps)) {
    chartPattern = h1 >= h2 ? { name: "double_top", direction: "bearish", confidence: "low" } : { name: "double_bottom", direction: "bullish", confidence: "low" };
  } else if ((trendlines.highs === "falling" && trendlines.lows === "rising")) {
    chartPattern = { name: "wedge", direction: "neutral", confidence: "medium" };
  } else if ((trendlines.highs === "rising" && trendlines.lows === "rising") || (trendlines.highs === "falling" && trendlines.lows === "falling")) {
    chartPattern = { name: "flag", direction: trendlines.highs === "rising" ? "bullish" : "bearish", confidence: "low" };
  }

  // ICT Unicorn = validated OB overlapping a fresh FVG in the same direction.
  const smcAny = (undefined as never);
  void smcAny; // kept out of this pure classic layer; engine composes the overlap.

  for (const p of patterns.slice(-4)) {
    if (p.direction === "bullish") supportingEvidence.push(p.name);
    if (p.direction === "bearish") conflictingEvidence.push(p.name);
  }
  for (const z of supplyDemand.slice(-4)) {
    (z.direction === "demand" ? supportingEvidence : conflictingEvidence).push(z.type);
  }

  return {
    patterns: patterns.slice(-12),
    supplyDemand: supplyDemand.slice(-12),
    trendlines,
    chartPattern,
    supportingEvidence,
    conflictingEvidence,
  };
}

/** Detect the ICT Unicorn overlap from the already validated SMC objects. */
export function detectIctUnicorn(
  orderBlocks: Array<{ direction: "bullish" | "bearish"; upper: number; lower: number; status: string }>,
  fvgs: Array<{ direction: "bullish" | "bearish"; upper: number; lower: number; status: string }>,
  timeframe: string,
): ClassicPriceActionContext["ictUnicorn"] | undefined {
  for (const ob of orderBlocks) {
    if (ob.status === "invalidated") continue;
    for (const fvg of fvgs) {
      if (fvg.status !== "fresh" || fvg.direction !== ob.direction) continue;
      const lower = Math.max(ob.lower, fvg.lower);
      const upper = Math.min(ob.upper, fvg.upper);
      if (lower < upper) {
        return {
          direction: ob.direction,
          lower,
          upper,
          timeframe,
          description: `Validated ${ob.direction} order block overlaps a fresh ${ob.direction} FVG.`,
        };
      }
    }
  }
  return undefined;
}
