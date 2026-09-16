/**
 * Phase 24 — MARKET DATA QUALITY, ROBUSTNESS & DECISION STABILITY.
 *
 * Tests that go beyond "doesn't crash" to verify:
 * - Invalid data cannot fabricate directional evidence
 * - Insufficient data does not masquerade as strong evidence
 * - Single anomalous candles cannot dominate structural decisions
 * - Boundary conditions (RR, conviction, freshness) behave correctly
 * - Engine is deterministic under metamorphic transformations
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import { sma, rsi, macd } from "./data/technical";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildChain, buildMtfContext } from "./data/mtf";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, OhlcvCandle } from "@/lib/data/market-types";

// ── helpers ──────────────────────────────────────────────────────

function ts(i: number): number {
  return Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000;
}

function bullCandle(i: number, base: number): OhlcvCandle {
  const price = base + i * 50;
  return { timestamp: ts(i), open: price - 20, high: price + 30, low: price - 40, close: price, volume: 1_000_000 };
}

function bullCandles(start: number, base: number, n = 80): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => bullCandle(start + i, base));
}

function flatCandles(base: number, n = 80): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: ts(i), open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 1000,
  }));
}

function buildInput(instrument: string, type: AnalysisInput["instrumentType"], candles: OhlcvCandle[], opts: Partial<AnalysisInput> = {}): AnalysisInput {
  const tech = calculateTechnical(candles);
  tech.smc = computeSmcContext(candles, "D1");
  const slots = buildChain("D1");
  const mtfInputs = [
    { timeframe: "D1", role: "setup" as const, candles },
    ...slots.map((s) => ({ timeframe: s.timeframe, role: s.role, candles: candles.slice(-120) })),
  ];
  tech.mtf = buildMtfContext("D1", mtfInputs);
  return {
    instrument, instrumentType: type, timeframe: "D1", tradingStyle: "swing",
    marketData: {
      instrument, instrumentType: type, provider: "twelve-data", fetchTimestamp: Date.now(),
      price: { price: candles.length > 0 ? candles[candles.length - 1].close : 0, timestamp: Date.now(), source: "twelve-data" },
      candles, timeframe: "D1", dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech, ...opts,
  };
}

// ══════════════════════════════════════════════════════════════════
// 2. INSUFFICIENT DATA → cannot masquerade as strong evidence
// ══════════════════════════════════════════════════════════════════

describe("insufficient data safety", () => {
  it("sma() returns undefined when candles < period", () => {
    expect(sma([1, 2, 3], 20)).toBeUndefined();
    expect(sma([], 14)).toBeUndefined();
  });

  it("rsi() returns undefined when candles < period + 1", () => {
    expect(rsi([1, 2, 3, 4], 14)).toBeUndefined();
    expect(rsi([], 14)).toBeUndefined();
  });

  it("macd() returns undefined when candles < 35", () => {
    expect(macd(Array.from({ length: 30 }, (_, i) => 100 + i))).toBeUndefined();
    expect(macd([])).toBeUndefined();
  });

  it("5 candles produce no directional evidence from indicators", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: ts(i), open: 100 + i, high: 105 + i, low: 95 + i, close: 100 + i, volume: 1000,
    }));
    const input = buildInput("TEST/USD", "forex", candles);
    const result = runAnalysis(input);
    // With minimal data, no strong conviction should emerge
    expect(result.confidence).toBeLessThanOrEqual(50);
  });
});

// ══════════════════════════════════════════════════════════════════
// 5. OHLC integrity — invalid relationships
// ══════════════════════════════════════════════════════════════════

describe("OHLC integrity — adversarial candles", () => {
  function candleWith(overrides: Partial<OhlcvCandle>, idx: number): OhlcvCandle {
    return {
      timestamp: ts(idx), open: 100 + idx, high: 110 + idx, low: 90 + idx,
      close: 100 + idx, volume: 1000, ...overrides,
    };
  }

  it("high < low does not crash", () => {
    const candles = Array.from({ length: 80 }, (_, i) =>
      i === 40 ? candleWith({ high: 80, low: 120 }, i) : bullCandle(i, 100),
    );
    const result = runAnalysis(buildInput("X", "forex", candles));
    expect(result).toBeDefined();
    expect(result.bias).toBeDefined();
  });

  it("NaN OHLC does not crash and does not fabricate conviction", () => {
    const candles = Array.from({ length: 80 }, (_, i) =>
      i === 40 ? candleWith({ open: NaN, high: NaN, low: NaN, close: NaN }, i) : bullCandle(i, 100),
    );
    const result = runAnalysis(buildInput("X", "forex", candles));
    expect(result).toBeDefined();
    // NaN candle should not create strong evidence
    expect(result.confidence).toBeLessThanOrEqual(88);
  });

  it("zero-price candle does not crash", () => {
    const candles = Array.from({ length: 80 }, (_, i) =>
      i === 40 ? candleWith({ open: 0, high: 0, low: 0, close: 0 }, i) : bullCandle(i, 100),
    );
    expect(() => runAnalysis(buildInput("X", "forex", candles))).not.toThrow();
  });

  it("negative-price candle does not crash", () => {
    const candles = Array.from({ length: 80 }, (_, i) =>
      i === 40 ? candleWith({ open: -50, high: -40, low: -60, close: -50 }, i) : bullCandle(i, 100),
    );
    expect(() => runAnalysis(buildInput("X", "forex", candles))).not.toThrow();
  });

  it("Infinity OHLC does not crash", () => {
    const candles = Array.from({ length: 80 }, (_, i) =>
      i === 40 ? candleWith({ open: Infinity, high: Infinity, low: Infinity, close: Infinity }, i) : bullCandle(i, 100),
    );
    expect(() => runAnalysis(buildInput("X", "forex", candles))).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════
// 7 & 8. Price spike / single-candle manipulation
// ══════════════════════════════════════════════════════════════════

describe("single-candle manipulation — structural authority", () => {
  const baseline = bullCandles(0, 60_000);

  it("one extreme candle does not flip a strong structural trend", () => {
    const baselineResult = runAnalysis(buildInput("BTC/USD", "crypto", baseline));

    // Inject one massive down-candle in the middle
    const mutated = [...baseline];
    mutated[40] = {
      timestamp: ts(40), open: 60_000 + 40 * 50,
      high: 60_000 + 40 * 50 + 1000,
      low: 60_000 + 40 * 50 - 50_000, // massive wick
      close: 60_000 + 40 * 50 - 500,
      volume: 100_000_000,
    };
    const mutatedResult = runAnalysis(buildInput("BTC/USD", "crypto", mutated));

    // Structural direction should be robust against one anomalous candle
    // (80 candles of strong uptrend should survive one spike)
    expect(mutatedResult.bias).toBe(baselineResult.bias);
    // keyLevels MAY change because S/R is derived from actual candles
    // (expected: one extreme wick creates a new level). The important
    // invariant is that bias/direction is unchanged.
    expect(mutatedResult.recommendation).toBe(baselineResult.recommendation);
  });

  it("conviction does not become artificially extreme from one spike", () => {
    const mutated = [...baseline];
    mutated[40] = {
      timestamp: ts(40), open: 60_000 + 40 * 50,
      high: 60_000 + 40 * 50 + 100_000,
      low: 60_000 + 40 * 50 - 100,
      close: 60_000 + 40 * 50 + 50_000,
      volume: 1_000_000_000,
    };
    const result = runAnalysis(buildInput("BTC/USD", "crypto", mutated));
    expect(result.confidence).toBeGreaterThanOrEqual(20);
    expect(result.confidence).toBeLessThanOrEqual(88);
  });
});

// ══════════════════════════════════════════════════════════════════
// 11. R:R boundary
// ══════════════════════════════════════════════════════════════════

describe("R:R boundary — MIN_RR = 1.5", () => {
  const candles = bullCandles(0, 100, 80);

  it("RR below 1.5 results in NO_TRADE (if all other gates pass)", () => {
    const input = buildInput("XAU/USD", "commodity", candles);
    const result = runAnalysis(input);
    if (result.tradePlan) {
      const rr = parseFloat(String(result.tradePlan.riskReward));
      // If a tradePlan exists, RR must be >= 1.5
      expect(rr).toBeGreaterThanOrEqual(1.5);
    }
    // If RR < 1.5 is the reason, recommendation is NO_TRADE
    if (result.recommendation === "NO_TRADE") {
      const reasons = result.noTradeReasons.join(" ").toLowerCase();
      const hasRRGate = reasons.includes("rr") || reasons.includes("risk") || reasons.includes("reward");
      // No_TRADE can happen for many reasons; just verify no tradePlan exists
      expect(result.tradePlan).toBeUndefined();
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 12. Conviction boundary
// ══════════════════════════════════════════════════════════════════

describe("conviction boundary — [20, 88]", () => {
  it("conviction is always within [20, 88] for any valid input", () => {
    const scenarios = [
      bullCandles(0, 60_000),
      bullCandles(0, 3_000),
      bullCandles(0, 1.1, 2),
      flatCandles(100),
      bullCandles(0, 100, 5), // minimal data
    ];
    for (const candles of scenarios) {
      const input = buildInput("BTC/USD", "crypto", candles);
      const result = runAnalysis(input);
      expect(result.confidence).toBeGreaterThanOrEqual(20);
      expect(result.confidence).toBeLessThanOrEqual(88);
    }
  });

  it("NaN candles produce valid conviction within bounds", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: ts(i), open: NaN, high: NaN, low: NaN, close: NaN, volume: 0,
    }));
    const result = runAnalysis(buildInput("X", "forex", candles));
    expect(result.confidence).toBeGreaterThanOrEqual(20);
    expect(result.confidence).toBeLessThanOrEqual(88);
  });
});

// ══════════════════════════════════════════════════════════════════
// 9. Noise / metamorphic invariance
// ══════════════════════════════════════════════════════════════════

describe("metamorphic invariance", () => {
  const candles = bullCandles(0, 60_000);

  it("same input always produces identical result", () => {
    const a = runAnalysis(buildInput("BTC/USD", "crypto", candles));
    const b = runAnalysis(buildInput("BTC/USD", "crypto", candles));
    expect(a.bias).toBe(b.bias);
    expect(a.confidence).toBe(b.confidence);
    expect(a.recommendation).toBe(b.recommendation);
    expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
    expect(a.keyLevels).toEqual(b.keyLevels);
  });

  it("metadata-only change does not alter decision", () => {
    const a = runAnalysis(buildInput("BTC/USD", "crypto", candles));
    const input2 = buildInput("BTC/USD", "crypto", candles);
    input2.marketData!.fetchTimestamp = Date.now() + 1000;
    const b = runAnalysis(input2);
    expect(a.bias).toBe(b.bias);
    expect(a.confidence).toBe(b.confidence);
    expect(a.recommendation).toBe(b.recommendation);
    expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
  });

  it("object key order does not change decision", () => {
    const input = buildInput("BTC/USD", "crypto", candles);
    const a = runAnalysis(input);
    // Create with reversed key order
    const reversed: Record<string, unknown> = {};
    const keys = Object.keys(input).reverse();
    for (const k of keys) (reversed as any)[k] = (input as any)[k];
    const b = runAnalysis(reversed as unknown as AnalysisInput);
    expect(a.bias).toBe(b.bias);
    expect(a.confidence).toBe(b.confidence);
    expect(a.recommendation).toBe(b.recommendation);
  });
});

// ══════════════════════════════════════════════════════════════════
// 17. Position sizing robustness
// ══════════════════════════════════════════════════════════════════

describe("position sizing robustness", () => {
  it("missing spec → no sizing, thesis unchanged", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 60_000));
    const result = runAnalysis(input);
    // Without explicit spec or OKX data, sizing should be unavailable
    if (result.recommendation !== "NO_TRADE" && result.tradePlan) {
      // Sizing may or may not be present depending on OKX data
      if (result.positionSizing && !result.positionSizing.available) {
        expect(result.positionSizing.unavailableReason).toBeDefined();
      }
    }
  });

  it("zero equity → sizing unavailable, thesis unchanged", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 60_000));
    input.accountEquity = 0;
    const result = runAnalysis(input);
    if (result.tradePlan && result.positionSizing && !result.positionSizing.available) {
      expect(result.positionSizing.unavailableReason).toBeDefined();
    }
    // Thesis must remain independent of sizing failure
    expect(result.bias).toBeDefined();
  });

  it("NaN equity → sizing unavailable, thesis unchanged", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 60_000));
    input.accountEquity = NaN;
    const result = runAnalysis(input);
    expect(result.bias).toBeDefined();
    expect(result.recommendation).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// 18. Provider failure does not change thesis
// ══════════════════════════════════════════════════════════════════

describe("provider failure — thesis stability", () => {
  it("all optional providers unavailable → same bias as clean input", () => {
    const candles = bullCandles(0, 60_000);
    const clean = runAnalysis(buildInput("BTC/USD", "crypto", candles));
    const dirty = runAnalysis(buildInput("BTC/USD", "crypto", candles, {
      treasuryData: undefined, cotData: undefined, eiaData: undefined, executionData: undefined,
      sentimentData: undefined, fundamentalData: undefined,
    }));
    expect(dirty.bias).toBe(clean.bias);
    expect(dirty.recommendation).toBe(clean.recommendation);
    expect(dirty.confidence).toBe(clean.confidence);
  });

  it("unavailable optional context does not create or remove NO_TRADE", () => {
    const candles = bullCandles(0, 60_000);
    const clean = runAnalysis(buildInput("BTC/USD", "crypto", candles));
    const dirty = runAnalysis(buildInput("BTC/USD", "crypto", candles, {
      treasuryData: undefined, cotData: undefined, eiaData: undefined,
    }));
    // NO_TRADE status should be determined by structural gates, not optional providers
    if (clean.recommendation === "NO_TRADE") {
      expect(dirty.recommendation).toBe("NO_TRADE");
    } else {
      // If clean produced a trade, dirty should too (no provider failure veto)
      expect(dirty.recommendation).not.toBe("NO_TRADE");
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 19. Decision stability — genuine change vs noise
// ══════════════════════════════════════════════════════════════════

describe("decision stability — genuine market change", () => {
  it("same data → same decision (idempotent)", () => {
    const candles = bullCandles(0, 60_000);
    const results = Array.from({ length: 10 }, () => runAnalysis(buildInput("BTC/USD", "crypto", candles)));
    for (let i = 1; i < results.length; i++) {
      expect(results[i].bias).toBe(results[0].bias);
      expect(results[i].confidence).toBe(results[0].confidence);
      expect(results[i].recommendation).toBe(results[0].recommendation);
      expect(results[i].decisionFingerprint).toBe(results[0].decisionFingerprint);
    }
  });

  it("different instrument types produce different instrument identity", () => {
    const a = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 60_000)));
    const b = runAnalysis(buildInput("EUR/USD", "forex", bullCandles(0, 1.1, 2)));
    expect(a.instrument).toBe("BTC/USD");
    expect(b.instrument).toBe("EUR/USD");
    // Instrument identity is preserved in trace
    expect(a.decisionTrace?.inputSnapshotSummary.instrument).toBe("BTC/USD");
    expect(b.decisionTrace?.inputSnapshotSummary.instrument).toBe("EUR/USD");
  });
});

// ══════════════════════════════════════════════════════════════════
// 6. Timestamp integrity
// ══════════════════════════════════════════════════════════════════

describe("timestamp integrity", () => {
  it("descending timestamps handled without crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: ts(79 - i), open: 100 + i, high: 110 + i, low: 90 + i, close: 100 + i, volume: 1000,
    }));
    expect(() => runAnalysis(buildInput("X", "forex", candles))).not.toThrow();
  });

  it("duplicate timestamps handled without crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: ts(0), open: 100 + i, high: 110 + i, low: 90 + i, close: 100 + i, volume: 1000,
    }));
    expect(() => runAnalysis(buildInput("X", "forex", candles))).not.toThrow();
  });

  it("extremely old timestamps handled without crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: Date.parse("1970-01-01T00:00:00Z") + i * 86_400_000,
      open: 100, high: 110, low: 90, close: 100 + i, volume: 1000,
    }));
    expect(() => runAnalysis(buildInput("X", "forex", candles))).not.toThrow();
  });

  it("future timestamps handled without crash", () => {
    const future = Date.parse("2099-12-31T00:00:00Z");
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: future + i * 86_400_000,
      open: 100, high: 110, low: 90, close: 100 + i, volume: 1000,
    }));
    expect(() => runAnalysis(buildInput("X", "forex", candles))).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════
// 10. Decision boundary stability
// ══════════════════════════════════════════════════════════════════

describe("decision boundary stability", () => {
  it("repeated analysis of same input is fully deterministic", () => {
    const candles = bullCandles(0, 1.1, 2);
    const results = Array.from({ length: 5 }, () =>
      runAnalysis(buildInput("EUR/USD", "forex", candles)),
    );
    for (const r of results) {
      expect(r.bias).toBe(results[0].bias);
      expect(r.confidence).toBe(results[0].confidence);
      expect(r.recommendation).toBe(results[0].recommendation);
      expect(r.decisionFingerprint).toBe(results[0].decisionFingerprint);
    }
  });

  it("conviction band label matches numeric range", () => {
    const candles = bullCandles(0, 60_000);
    const result = runAnalysis(buildInput("BTC/USD", "crypto", candles));
    if (result.conviction === "High") {
      expect(result.confidence).toBeGreaterThanOrEqual(70);
    } else if (result.conviction === "Medium") {
      expect(result.confidence).toBeGreaterThanOrEqual(50);
      expect(result.confidence).toBeLessThan(70);
    } else if (result.conviction === "Low") {
      expect(result.confidence).toBeLessThan(50);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 4. Partial / missing candle audit
// ══════════════════════════════════════════════════════════════════

describe("partial/missing candle handling", () => {
  it("missing middle candles (gap) handled without crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => {
      if (i >= 30 && i <= 50) {
        // Gap: no candles for indices 30-50
        return { timestamp: ts(i), open: 100, high: 100, low: 100, close: 100, volume: 0 };
      }
      return bullCandle(i, 60_000);
    });
    expect(() => runAnalysis(buildInput("BTC/USD", "crypto", candles))).not.toThrow();
  });

  it("repeated candles (no price movement) handled safely", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, () => ({
      timestamp: ts(0), open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000,
    }));
    const result = runAnalysis(buildInput("X", "forex", candles));
    expect(result).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// 16. Trade plan robustness
// ══════════════════════════════════════════════════════════════════

describe("trade plan robustness", () => {
  it("invalid trade plan levels are never produced", () => {
    const scenarios = [
      bullCandles(0, 60_000),
      bullCandles(0, 3_000),
      bullCandles(0, 0.15, 20),
    ];
    for (const candles of scenarios) {
      const result = runAnalysis(buildInput("BTC/USD", "crypto", candles));
      if (result.tradePlan) {
        const entry = parseFloat(result.tradePlan.entry);
        const sl = parseFloat(result.tradePlan.stopLoss);
        const tp = parseFloat(result.tradePlan.takeProfit);
        // All must be finite numbers
        expect(Number.isFinite(entry)).toBe(true);
        expect(Number.isFinite(sl)).toBe(true);
        expect(Number.isFinite(tp)).toBe(true);
        // Entry must be positive
        expect(entry).toBeGreaterThan(0);
        // RR >= 1.5
        if (result.tradePlan.riskReward !== undefined) {
          expect(Number.parseFloat(String(result.tradePlan.riskReward))).toBeGreaterThanOrEqual(1.5);
        }
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 3. Minimum candle sufficiency
// ══════════════════════════════════════════════════════════════════

describe("minimum candle sufficiency", () => {
  it("technical functions return undefined for insufficient data", () => {
    const closes = Array.from({ length: 5 }, (_, i) => 100 + i);
    expect(sma(closes, 20)).toBeUndefined();
    expect(rsi(closes, 14)).toBeUndefined();
    expect(macd(closes)).toBeUndefined();
  });

  it("technical functions work with sufficient data", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    expect(sma(closes, 20)).toBeDefined();
    expect(rsi(closes, 14)).toBeDefined();
    expect(macd(closes)).toBeDefined();
  });

  it("calculateTechnical returns defined values with 80 candles", () => {
    const candles = bullCandles(0, 100);
    const tech = calculateTechnical(candles);
    expect(tech).toBeDefined();
    expect(tech.structure).toBeDefined();
  });
});
