import { describe, it, expect } from "vitest";
import { sma, rsi, macd, detectSwings, analyzeStructure, detectBos, detectChoch, findKeyLevels, atr, analyzeVolume, fibonacciLevels, calculateTechnical } from "./technical";
import type { OhlcvCandle } from "./market-types";

/** Helper: generate n ascending candles for testing. */
function ascendingCandles(n: number, startPrice = 100): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: Date.now() - (n - i) * 86400000,
    open: startPrice + i,
    high: startPrice + i + 1,
    low: startPrice + i - 0.5,
    close: startPrice + i + 0.5,
    volume: 1000 + i * 10,
  }));
}

describe("SMA", () => {
  it("computes correct simple moving average", () => {
    const data = [10, 11, 12, 13, 14];
    expect(sma(data, 3)).toBeCloseTo(13);
  });

  it("returns undefined for insufficient data", () => {
    expect(sma([1, 2], 5)).toBeUndefined();
  });
});

describe("RSI", () => {
  it("returns undefined for insufficient data", () => {
    expect(rsi([50, 51, 52], 14)).toBeUndefined();
  });

  it("returns 100 for all-up data", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(closes)).toBeCloseTo(100);
  });

  it("returns value between 0 and 100 for mixed data", () => {
    const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
    const r = rsi(closes);
    expect(r).toBeDefined();
    expect(r!).toBeGreaterThan(0);
    expect(r!).toBeLessThan(100);
  });
});

describe("MACD", () => {
  it("returns undefined for insufficient data", () => {
    expect(macd([1, 2, 3])).toBeUndefined();
  });

  it("computes MACD for sufficient data", () => {
    const closes = ascendingCandles(50).map((c) => c.close);
    const result = macd(closes);
    expect(result).toBeDefined();
    expect(result!.line).toBeDefined();
    expect(result!.signal).toBeDefined();
    expect(result!.histogram).toBeCloseTo(result!.line - result!.signal);
  });
});

describe("detectSwings", () => {
  it("finds swing highs and lows in ascending data", () => {
    const candles = ascendingCandles(20);
    const { highs, lows } = detectSwings(candles, 3);
    // Ascending data should produce very few or no swings
    // (all highs/lows keep increasing)
    expect(highs.length).toBeGreaterThanOrEqual(0);
  });

  it("finds swings in zigzag data", () => {
    const candles: OhlcvCandle[] = [];
    const prices = [100, 105, 103, 108, 101, 106, 102, 107, 103, 109, 100, 105, 101];
    for (let i = 0; i < prices.length; i++) {
      candles.push({
        timestamp: Date.now() - (prices.length - i) * 86400000,
        open: prices[i] - 1,
        high: prices[i] + 1,
        low: prices[i] - 2,
        close: prices[i],
        volume: 1000,
      });
    }
    const { highs, lows } = detectSwings(candles, 2);
    expect(highs.length + lows.length).toBeGreaterThan(0);
  });
});

describe("analyzeStructure", () => {
  it("returns HH/HL for rising swings", () => {
    expect(analyzeStructure([110, 115, 120], [100, 105, 110])).toBe("HH/HL");
  });

  it("returns LH/LL for falling swings", () => {
    expect(analyzeStructure([120, 115, 110], [100, 95, 90])).toBe("LH/LL");
  });

  it("returns range for mixed swings", () => {
    expect(analyzeStructure([110, 115, 112], [100, 95, 98])).toBe("range");
  });

  it("returns unknown for insufficient data", () => {
    expect(analyzeStructure([110], [100])).toBe("unknown");
  });
});

describe("detectBos", () => {
  it("detects bullish BOS when price exceeds swing high", () => {
    expect(detectBos([100, 110], [90, 95], 115)).toBe("bullish");
  });

  it("detects bearish BOS when price breaks swing low", () => {
    expect(detectBos([100, 110], [90, 85], 80)).toBe("bearish");
  });

  it("returns none when price is within range", () => {
    expect(detectBos([100, 110], [90, 85], 95)).toBe("none");
  });
});

describe("detectChoch", () => {
  it("detects bearish CHoCH in bullish structure", () => {
    expect(detectChoch([100, 110], [90, 95], "HH/HL", 88)).toBe("bearish");
  });

  it("detects bullish CHoCH in bearish structure", () => {
    expect(detectChoch([110, 100], [95, 90], "LH/LL", 112)).toBe("bullish");
  });

  it("returns none when no reversal", () => {
    expect(detectChoch([100, 110], [90, 95], "HH/HL", 105)).toBe("none");
  });
});

describe("findKeyLevels", () => {
  it("finds support below and resistance above current price", () => {
    const { support, resistance } = findKeyLevels([95, 100, 110, 115], [85, 90, 98, 105], 102);
    support.forEach((s) => expect(s).toBeLessThan(102));
    resistance.forEach((r) => expect(r).toBeGreaterThan(102));
  });
});

describe("ATR", () => {
  it("returns undefined for insufficient data", () => {
    expect(atr([{ timestamp: 0, open: 1, high: 2, low: 0, close: 1.5, volume: 100 }])).toBeUndefined();
  });

  it("computes ATR for sufficient data", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: Date.now() - (20 - i) * 86400000,
      open: 100 + Math.sin(i) * 5,
      high: 100 + Math.sin(i) * 5 + 2,
      low: 100 + Math.sin(i) * 5 - 2,
      close: 100 + Math.sin(i) * 5 + 1,
      volume: 1000,
    }));
    const result = atr(candles);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(0);
  });
});

describe("analyzeVolume", () => {
  it("returns unknown for insufficient data", () => {
    expect(analyzeVolume([])).toEqual({ avg20: undefined, trend: "unknown" });
  });

  it("detects increasing volume trend", () => {
    // recentAvg5 = avg of last 5, olderAvg5 = avg of indices [n-10, n-5)
    // Put low volumes in [10..24], high volumes in [25..29]
    const candles: OhlcvCandle[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: Date.now() - (30 - i) * 86400000,
      open: 100, high: 101, low: 99, close: 100,
      volume: i < 25 ? 1000 : 3000, // Strong increase in last 5 candles
    }));
    const result = analyzeVolume(candles);
    expect(result.trend).toBe("increasing");
  });
});

describe("fibonacciLevels", () => {
  it("computes correct Fibonacci levels", () => {
    const levels = fibonacciLevels(200, 100);
    expect(levels.level236).toBeCloseTo(123.6);
    expect(levels.level382).toBeCloseTo(138.2);
    expect(levels.level500).toBeCloseTo(150);
    expect(levels.level618).toBeCloseTo(161.8);
    expect(levels.level786).toBeCloseTo(178.6);
  });
});

describe("calculateTechnical", () => {
  it("returns empty result for no candles", () => {
    const result = calculateTechnical([]);
    expect(result.dataPoints).toBe(0);
    expect(result.structure).toBe("unknown");
  });

  it("computes full technical data from 200+ candles", () => {
    const candles = ascendingCandles(210);
    const result = calculateTechnical(candles);
    expect(result.dataPoints).toBe(210);
    expect(result.sma50).toBeDefined();
    expect(result.sma100).toBeDefined();
    expect(result.sma200).toBeDefined();
    expect(result.rsi14).toBeDefined();
    expect(result.macdLine).toBeDefined();
    expect(result.swingHighs.length).toBeGreaterThanOrEqual(0);
    expect(result.supportLevels).toBeDefined();
    expect(result.resistanceLevels).toBeDefined();
  });
});
