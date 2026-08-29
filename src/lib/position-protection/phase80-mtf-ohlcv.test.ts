/**
 * Phase 80 — Multi-Timeframe OHLCV Technical Intelligence Tests
 */

import { describe, it, expect } from "vitest";
import {
  validateCandle,
  normalizeCandles,
  sma,
  ema,
  rsi,
  atr,
  detectSwings,
  analyzeStructure,
  extractLevels,
  type Candle,
} from "./technical-indicators";
import {
  createTimeframeData,
  analyzeTimeframe,
  classifyMarketRegime,
  analyzeMTFConfluence,
  type TimeframeData,
} from "./multi-timeframe-engine";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeCandles(
  count: number,
  startPrice: number,
  direction: "up" | "down" | "flat" = "up",
  volatility = 0.01,
): Candle[] {
  const now = Date.now();
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const change =
      direction === "up"
        ? volatility
        : direction === "down"
          ? -volatility
          : (Math.sin(i) * volatility) / 2;

    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + volatility * 0.3);
    const low = Math.min(open, close) * (1 - volatility * 0.3);

    candles.push({
      timestamp: now + i * 300_000,
      open,
      high,
      low,
      close,
      volume: 1000 + Math.random() * 500,
    });
    price = close;
  }
  return candles;
}

function makeTFData(
  tf: "M5" | "M15" | "H1",
  count: number,
  startPrice: number,
  direction: "up" | "down" | "flat" = "up",
): TimeframeData {
  return createTimeframeData(tf, makeCandles(count, startPrice, direction));
}

// ═══════════════════════════════════════════════════════════════
// A. OHLCV NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("A. OHLCV Normalization", () => {
  it("validates correct candle", () => {
    const candle = validateCandle({
      timestamp: 1000,
      open: 100,
      high: 105,
      low: 98,
      close: 103,
      volume: 1000,
    });
    expect(candle).not.toBeNull();
    expect(candle!.open).toBe(100);
    expect(candle!.high).toBe(105);
  });

  it("rejects high < open", () => {
    expect(validateCandle({ timestamp: 1, open: 100, high: 90, low: 80, close: 95, volume: 100 })).toBeNull();
  });

  it("rejects low > close", () => {
    expect(validateCandle({ timestamp: 1, open: 100, high: 110, low: 105, close: 95, volume: 100 })).toBeNull();
  });

  it("rejects NaN prices", () => {
    expect(validateCandle({ timestamp: 1, open: NaN, high: 100, low: 90, close: 95, volume: 100 })).toBeNull();
  });

  it("rejects zero/negative prices", () => {
    expect(validateCandle({ timestamp: 1, open: 0, high: 100, low: 0, close: 50, volume: 100 })).toBeNull();
  });

  it("normalizes and deduplicates candles", () => {
    const candles = [
      { timestamp: 1000, open: 100, high: 105, low: 95, close: 102, volume: 100 },
      { timestamp: 1000, open: 101, high: 106, low: 96, close: 103, volume: 150 },
      { timestamp: 2000, open: 103, high: 108, low: 98, close: 105, volume: 200 },
    ] as Candle[];
    const normalized = normalizeCandles(candles);
    expect(normalized.length).toBe(2);
    // Keeps the last one for duplicate timestamp
    expect(normalized[0].timestamp).toBe(1000);
    expect(normalized[1].timestamp).toBe(2000);
  });

  it("sorts ascending by timestamp", () => {
    const candles = [
      { timestamp: 3000, open: 100, high: 105, low: 95, close: 102, volume: 100 },
      { timestamp: 1000, open: 98, high: 103, low: 93, close: 100, volume: 100 },
    ] as Candle[];
    const normalized = normalizeCandles(candles);
    expect(normalized[0].timestamp).toBe(1000);
    expect(normalized[1].timestamp).toBe(3000);
  });

  it("rejects invalid candles in normalization", () => {
    const candles = [
      { timestamp: 1000, open: 100, high: 105, low: 95, close: 102, volume: 100 },
      { timestamp: 2000, open: -1, high: 100, low: 0, close: 50, volume: 100 },
      { timestamp: 3000, open: 102, high: 107, low: 97, close: 104, volume: 100 },
    ] as any[];
    const normalized = normalizeCandles(candles);
    expect(normalized.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. SMA / EMA
// ═══════════════════════════════════════════════════════════════

describe("B. SMA / EMA", () => {
  it("SMA of known values", () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(2);  // (1+2+3)/3
    expect(result[1]).toBeCloseTo(3);  // (2+3+4)/3
    expect(result[2]).toBeCloseTo(4);  // (3+4+5)/3
  });

  it("SMA returns empty if insufficient data", () => {
    expect(sma([1, 2], 5)).toHaveLength(0);
  });

  it("EMA of known values", () => {
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result.length).toBeGreaterThan(0);
    // EMA should track the trend
    expect(result[result.length - 1]).toBeGreaterThan(result[0]);
  });

  it("EMA returns empty if insufficient data", () => {
    expect(ema([1, 2], 5)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. RSI
// ═══════════════════════════════════════════════════════════════

describe("C. RSI", () => {
  it("RSI of strongly rising prices approaches 100", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const result = rsi(closes, 14);
    expect(result.length).toBeGreaterThan(0);
    expect(result[result.length - 1]).toBeGreaterThan(70);
  });

  it("RSI of strongly falling prices approaches 0", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
    const result = rsi(closes, 14);
    expect(result.length).toBeGreaterThan(0);
    expect(result[result.length - 1]).toBeLessThan(30);
  });

  it("RSI returns empty if insufficient data", () => {
    expect(rsi([1, 2, 3], 14)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. ATR
// ═══════════════════════════════════════════════════════════════

describe("D. ATR", () => {
  it("ATR returns positive values", () => {
    const candles = makeCandles(30, 100, "up", 0.02);
    const result = atr(candles, 14);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBeGreaterThan(0);
  });

  it("ATR returns empty if insufficient data", () => {
    const candles = makeCandles(5, 100, "flat");
    expect(atr(candles, 14)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. SWING DETECTION & STRUCTURE
// ═══════════════════════════════════════════════════════════════

describe("E. Swing Detection & Structure", () => {
  it("detects swing highs and lows", () => {
    // Create a pattern: up-down-up-down with clear pivots
    // Create pattern with clear swing points requiring 2-bar confirmation
    const prices = [95, 96, 98, 100, 99, 97, 95, 93, 92, 93, 95, 97, 98, 100, 102, 101, 99, 97, 96, 98];
    const candles: Candle[] = prices.map((p, i) => ({
      timestamp: i + 1,
      open: p - 0.5,
      high: p + 1,
      low: p - 1,
      close: p,
      volume: 100,
    }));
    const swings = detectSwings(candles, 2);
    // Should find at least one swing high and one swing low
    const highs = swings.filter((s) => s.type === "HIGH");
    const lows = swings.filter((s) => s.type === "LOW");
    expect(highs.length).toBeGreaterThan(0);
    expect(lows.length).toBeGreaterThan(0);
  });

  it("returns empty swings for insufficient data", () => {
    const candles = makeCandles(3, 100, "flat");
    expect(detectSwings(candles, 2)).toHaveLength(0);
  });

  it("analyzeStructure returns INSUFFICIENT_DATA for few swings", () => {
    const result = analyzeStructure([]);
    expect(result.state).toBe("INSUFFICIENT_DATA");
    expect(result.structureBroken).toBe(false);
  });

  it("extracts support and resistance levels", () => {
    const swings = [
      { index: 0, timestamp: 1, price: 100, type: "LOW" as const },
      { index: 1, timestamp: 2, price: 110, type: "HIGH" as const },
      { index: 2, timestamp: 3, price: 95, type: "LOW" as const },
      { index: 3, timestamp: 4, price: 115, type: "HIGH" as const },
    ];
    const levels = extractLevels(swings, 105);
    expect(levels.support.length).toBe(2);
    expect(levels.resistance.length).toBe(2);
    expect(levels.support[0]).toBeGreaterThan(95); // sorted desc
    expect(levels.resistance[0]).toBeLessThanOrEqual(110); // sorted asc
  });
});

// ═══════════════════════════════════════════════════════════════
// F. TIMEFRAME ANALYSIS
// ═══════════════════════════════════════════════════════════════

describe("F. Timeframe Analysis", () => {
  it("analyzes uptrend correctly", () => {
    const data = makeTFData("H1", 50, 100, "up");
    const analysis = analyzeTimeframe(data);
    expect(analysis.trend).toBe("BULLISH");
    expect(analysis.dataQuality).toBe("SUFFICIENT");
    expect(analysis.candleCount).toBe(50);
  });

  it("analyzes downtrend correctly", () => {
    const data = makeTFData("H1", 50, 200, "down");
    const analysis = analyzeTimeframe(data);
    expect(analysis.trend).toBe("BEARISH");
  });

  it("returns UNKNOWN for insufficient data", () => {
    const data = createTimeframeData("M5", makeCandles(2, 100, "flat"));
    const analysis = analyzeTimeframe(data);
    expect(analysis.trend).toBe("UNKNOWN");
    expect(analysis.dataQuality).toBe("INSUFFICIENT");
  });

  it("detects RSI overbought/oversold", () => {
    const rising = makeTFData("H1", 30, 100, "up");
    const analysis = analyzeTimeframe(rising);
    // Strong uptrend should push RSI above neutral
    if (analysis.rsiValue !== undefined) {
      expect(analysis.rsiValue).toBeGreaterThan(50);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// G. MARKET REGIME
// ═══════════════════════════════════════════════════════════════

describe("G. Market Regime", () => {
  it("classifies TRENDING_UP for aligned bullish", () => {
    const analyses = [
      analyzeTimeframe(makeTFData("H1", 50, 100, "up")),
      analyzeTimeframe(makeTFData("M15", 50, 100, "up")),
    ];
    const regime = classifyMarketRegime(analyses);
    expect(["TRENDING_UP", "PULLBACK"]).toContain(regime);
  });

  it("classifies TRENDING_DOWN for aligned bearish", () => {
    const analyses = [
      analyzeTimeframe(makeTFData("H1", 50, 200, "down")),
      analyzeTimeframe(makeTFData("M15", 50, 200, "down")),
    ];
    const regime = classifyMarketRegime(analyses);
    expect(["TRENDING_DOWN", "RECOVERY"]).toContain(regime);
  });

  it("returns INSUFFICIENT_DATA for empty analysis", () => {
    expect(classifyMarketRegime([])).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. MTF CONFLUENCE
// ═══════════════════════════════════════════════════════════════

describe("H. MTF Confluence", () => {
  it("produces confluence for bullish alignment", () => {
    const tfData = [
      makeTFData("H1", 50, 100, "up"),
      makeTFData("M15", 50, 100, "up"),
      makeTFData("M5", 50, 100, "up"),
    ];
    const result = analyzeMTFConfluence(tfData);
    expect(result.timeframes.length).toBe(3);
    expect(result.allAligned).toBe(true);
    expect(result.overallQuality).toBe("SUFFICIENT");
    expect(result.description).toBeTruthy();
  });

  it("detects timeframe conflict", () => {
    const tfData = [
      makeTFData("H1", 50, 100, "up"),
      makeTFData("M15", 50, 200, "down"),
    ];
    const result = analyzeMTFConfluence(tfData);
    expect(result.timeframeConflict).toBe(true);
    expect(result.allAligned).toBe(false);
  });

  it("handles empty data", () => {
    const result = analyzeMTFConfluence([]);
    expect(result.regime).toBe("INSUFFICIENT_DATA");
    expect(result.overallQuality).toBe("INSUFFICIENT");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("I. Determinism", () => {
  it("same inputs produce same output", () => {
    const tfData = [
      makeTFData("H1", 50, 100, "up"),
      makeTFData("M15", 50, 100, "up"),
    ];
    const result1 = analyzeMTFConfluence(tfData);
    const result2 = analyzeMTFConfluence(tfData);
    expect(result1.regime).toBe(result2.regime);
    expect(result1.allAligned).toBe(result2.allAligned);
    expect(result1.overallQuality).toBe(result2.overallQuality);
  });

  it("SMA is deterministic", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r1 = sma(data, 3);
    const r2 = sma(data, 3);
    expect(r1).toEqual(r2);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("J. Safety Invariants", () => {
  it("no fabricated candle data", () => {
    const empty = createTimeframeData("M5", []);
    expect(empty.candleCount).toBe(0);
    expect(empty.dataQuality).toBe("INSUFFICIENT");
    const analysis = analyzeTimeframe(empty);
    expect(analysis.trend).toBe("UNKNOWN");
    expect(analysis.rsiValue).toBeUndefined();
  });

  it("missing timeframe is handled honestly", () => {
    const tfData = [makeTFData("H1", 50, 100, "up")];
    const result = analyzeMTFConfluence(tfData);
    // M5 and M15 are missing — that's fine
    expect(result.timeframes.length).toBe(1);
    expect(result.timeframes[0].timeframe).toBe("H1");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. PERFORMANCE
// ═══════════════════════════════════════════════════════════════

describe("K. Performance", () => {
  it("analyzes 50 instruments × 3 timeframes in < 1 second", () => {
    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      const tfData = [
        makeTFData("H1", 100, 100 + i, "up"),
        makeTFData("M15", 100, 100 + i, "up"),
        makeTFData("M5", 100, 100 + i, "up"),
      ];
      analyzeMTFConfluence(tfData);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
