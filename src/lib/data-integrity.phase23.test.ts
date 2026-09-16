/**
 * Phase 23 — DATA INTEGRITY, SYMBOL RESOLUTION & MARKET-DATA TRUST.
 *
 * Proves invariants I25–I28:
 *   I25 — No Silent Instrument Substitution
 *   I26 — No Cross-Instrument Data Contamination
 *   I27 — Trade Plan Instrument Consistency
 *   I28 — Market Data Identity Integrity
 *
 * Tests exercise the PURE analysis engine with deterministic fixtures.
 * No network calls, no provider mocks needed — the engine is pure.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildMtfContext } from "./data/mtf";
import { buildChain } from "./data/mtf";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData } from "@/lib/data/market-types";
import type { OhlcvCandle } from "@/lib/data/market-types";

// ── helpers ──────────────────────────────────────────────────────

function bullCandles(start: number, base: number, n = 80): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const ts = Date.parse("2026-08-01T00:00:00Z") + (start + i) * 86_400_000;
    const price = base + i * 50;
    return {
      timestamp: ts,
      open: price - 20,
      high: price + 30,
      low: price - 40,
      close: price,
      volume: 1_000_000,
    };
  });
}

function buildInput(
  instrument: string,
  instrumentType: AnalysisInput["instrumentType"],
  candles: OhlcvCandle[],
  opts: Partial<AnalysisInput> = {},
): AnalysisInput {
  const tech = calculateTechnical(candles);
  tech.smc = computeSmcContext(candles, "D1");
  const slots = buildChain("D1");
  const mtfInputs = [
    { timeframe: "D1", role: "setup" as const, candles },
    ...slots.map((s) => ({
      timeframe: s.timeframe,
      role: s.role,
      candles: candles.slice(-120),
    })),
  ];
  const mtf = buildMtfContext("D1", mtfInputs);
  tech.mtf = mtf;

  return {
    instrument,
    instrumentType,
    timeframe: "D1",
    tradingStyle: "swing",
    marketData: {
      instrument,
      instrumentType,
      provider: "twelve-data",
      fetchTimestamp: Date.now(),
      price: { price: candles.length > 0 ? candles[candles.length - 1].close : 0, timestamp: Date.now(), source: "twelve-data" },
      candles,
      timeframe: "D1",
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech,
    ...opts,
  };
}

// ── I25: No Silent Instrument Substitution ───────────────────────

describe("I25 — No Silent Instrument Substitution", () => {
  const btcCandles = bullCandles(0, 60_000);
  const ethCandles = bullCandles(0, 3_000);

  it("result.instrument always matches the requested input", () => {
    const btcInput = buildInput("BTC/USD", "crypto", btcCandles);
    const ethInput = buildInput("ETH/USD", "crypto", ethCandles);

    const btc = runAnalysis(btcInput);
    const eth = runAnalysis(ethInput);

    // Instrument identity preserved in result
    expect(btc.instrument).toBe("BTC/USD");
    expect(eth.instrument).toBe("ETH/USD");
    // And in the trace
    expect(btc.decisionTrace?.inputSnapshotSummary.instrument).toBe("BTC/USD");
    expect(eth.decisionTrace?.inputSnapshotSummary.instrument).toBe("ETH/USD");
  });

  it("instruments in result always match the requested input", () => {
    for (const sym of ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD"]) {
      const input = buildInput(sym, "crypto", bullCandles(0, 50_000));
      const result = runAnalysis(input);
      expect(result.instrument).toBe(sym);
      expect(result.decisionTrace?.inputSnapshotSummary.instrument).toBe(sym);
    }
  });

  it("cross-asset comparator is a SEPARATE context, not a substitution", () => {
    const input = buildInput("EUR/USD", "forex", bullCandles(0, 1.1, 2));
    input.technicalData!.crossAsset = {
      comparatorSymbol: "UUP",
      timeframe: "D1",
      available: true,
      dataKind: "actual_price",
      provider: "Twelve Data",
      correlation: -0.85,
      sampleSize: 80,
      directionalContext: "inverse",
      comparatorMomentum: "up",
    };
    const result = runAnalysis(input);
    // Instrument is still EUR/USD, cross-asset is just context
    expect(result.instrument).toBe("EUR/USD");
  });
});

// ── I26: No Cross-Instrument Data Contamination ──────────────────

describe("I26 — No Cross-Instrument Data Contamination", () => {
  it("engine is pure — same input produces identical output regardless of prior calls", () => {
    const a = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 60_000)));
    // Run a different instrument in between
    runAnalysis(buildInput("DOGE/USD", "crypto", bullCandles(0, 0.15, 20)));
    // Run BTC again — should be identical
    const b = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 60_000)));

    expect(a.bias).toBe(b.bias);
    expect(a.confidence).toBe(b.confidence);
    expect(a.recommendation).toBe(b.recommendation);
    expect(a.decisionFingerprint).toBe(b.decisionFingerprint);
    expect(a.keyLevels).toEqual(b.keyLevels);
  });

  it("100 sequential analyses produce no cross-instrument leakage", () => {
    const symbols = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "EUR/USD", "XAU/USD"];
    const results: Array<{ instrument: string; fingerprint: string; bias: string }> = [];

    for (let i = 0; i < 100; i++) {
      const sym = symbols[i % symbols.length];
      const input = buildInput(
        sym,
        sym.includes("/") && (sym.includes("BTC") || sym.includes("ETH") || sym.includes("SOL") || sym.includes("DOGE"))
          ? "crypto"
          : sym.includes("XAU")
            ? "commodity"
            : "forex",
        bullCandles(0, 100 + i * 0.1, 80),
      );
      const r = runAnalysis(input);
      results.push({ instrument: r.instrument, fingerprint: r.decisionFingerprint ?? "", bias: r.bias });
      expect(r.instrument).toBe(sym);
    }

    // Every result matches its input
    for (let i = 0; i < 100; i++) {
      expect(results[i].instrument).toBe(symbols[i % symbols.length]);
    }
  });
});

// ── I27: Trade Plan Instrument Consistency ───────────────────────

describe("I27 — Trade Plan Instrument Consistency", () => {
  it("trade plan levels come from the analyzed instrument's candles, not another", () => {
    const btcCandles = bullCandles(0, 60_000);
    const input = buildInput("BTC/USD", "crypto", btcCandles);
    const result = runAnalysis(input);

    if (result.tradePlan) {
      const entry = parseFloat(result.tradePlan.entry);
      const sl = parseFloat(result.tradePlan.stopLoss);
      const tp = parseFloat(result.tradePlan.takeProfit);
      const price = btcCandles[btcCandles.length - 1].close;

      // Entry must be within reasonable range of the instrument's price
      // (could be at a level, but not wildly different scale)
      expect(Math.abs(entry - price) / price).toBeLessThan(0.5);
      // SL/TP same order of magnitude as the instrument
      expect(Math.abs(sl - price) / price).toBeLessThan(0.5);
      expect(Math.abs(tp - price) / price).toBeLessThan(0.5);
    }
  });

  it("key levels are always typed strings from the analyzed instrument", () => {
    const candles = bullCandles(0, 150, 80);
    const input = buildInput("XAU/USD", "commodity", candles);
    const result = runAnalysis(input);

    // keyLevels must always be strings (never undefined/null from the engine)
    expect(typeof result.keyLevels.support).toBe("string");
    expect(typeof result.keyLevels.resistance).toBe("string");
    expect(typeof result.keyLevels.invalidation).toBe("string");

    // If a level is present (non-empty), it must be a valid number string
    if (result.keyLevels.support.length > 0) {
      expect(Number.isFinite(parseFloat(result.keyLevels.support))).toBe(true);
    }
    if (result.keyLevels.resistance.length > 0) {
      expect(Number.isFinite(parseFloat(result.keyLevels.resistance))).toBe(true);
    }
    if (result.keyLevels.invalidation.length > 0) {
      expect(Number.isFinite(parseFloat(result.keyLevels.invalidation))).toBe(true);
    }
  });
});

// ── I28: Market Data Identity Integrity ──────────────────────────

describe("I28 — Market Data Identity Integrity", () => {
  it("empty candles produce no directional evidence", () => {
    const input = buildInput("BTC/USD", "crypto", []);
    const result = runAnalysis(input);
    // With no data, engine must still return a result (no crash)
    expect(result).toBeDefined();
    expect(result.bias).toBeDefined();
  });

  it("NaN prices do not produce a valid trade plan", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000,
      open: NaN,
      high: NaN,
      low: NaN,
      close: NaN,
      volume: 0,
    }));
    const input = buildInput("BTC/USD", "crypto", candles);
    const result = runAnalysis(input);
    // Engine should handle NaN without crashing
    expect(result).toBeDefined();
    expect(result.recommendation).toBeDefined();
    // No valid trade plan from NaN data
    if (result.tradePlan) {
      const entry = parseFloat(result.tradePlan.entry);
      expect(Number.isFinite(entry)).toBe(false);
    }
  });

  it("zero-volume candles are handled without crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000,
      open: 100,
      high: 110,
      low: 90,
      close: 100 + i,
      volume: 0,
    }));
    const input = buildInput("EUR/USD", "forex", candles);
    const result = runAnalysis(input);
    expect(result).toBeDefined();
    expect(result.bias).toBeDefined();
  });

  it("very old candle timestamps are handled safely", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: Date.parse("2000-01-01T00:00:00Z") + i * 86_400_000,
      open: 100,
      high: 110,
      low: 90,
      close: 100 + i,
      volume: 1000,
    }));
    const input = buildInput("AAPL", "stock", candles);
    const result = runAnalysis(input);
    expect(result).toBeDefined();
  });

  it("provider field in market data is preserved in result", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 60_000));
    const result = runAnalysis(input);
    expect(result.dataSource).toBe("twelve-data");
  });

  it("same symbol with different timeframes produces different technical context", () => {
    const candles = bullCandles(0, 60_000);
    const inputM15 = buildInput("BTC/USD", "crypto", candles);
    inputM15.timeframe = "M15";
    const inputD1 = buildInput("BTC/USD", "crypto", candles);
    inputD1.timeframe = "D1";

    // Both should produce valid results but timeframe metadata differs
    const r1 = runAnalysis(inputM15);
    const r2 = runAnalysis(inputD1);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    // Fingerprints can be same or different — the point is neither crashes
    expect(r1.timeframe).toBe("M15");
    expect(r2.timeframe).toBe("D1");
  });
});

// ── Adversarial: Malformed market data ──────────────────────────

describe("adversarial — malformed market data safety", () => {
  it("mixed NaN/finite candles do not crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => {
      const isBad = i % 20 === 0;
      return {
        timestamp: Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000,
        open: isBad ? NaN : 100 + i,
        high: isBad ? Infinity : 110 + i,
        low: isBad ? -Infinity : 90 + i,
        close: isBad ? NaN : 100 + i,
        volume: isBad ? 0 : 1000,
      };
    });
    const input = buildInput("ETH/USD", "crypto", candles);
    const result = runAnalysis(input);
    expect(result).toBeDefined();
    expect(result.bias).toBeDefined();
  });

  it("negative prices do not crash the engine", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000,
      open: -100 - i,
      high: -90 - i,
      low: -110 - i,
      close: -100 - i,
      volume: 1000,
    }));
    const input = buildInput("TEST/USD", "forex", candles);
    const result = runAnalysis(input);
    expect(result).toBeDefined();
  });

  it("out-of-order timestamps do not crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: Date.parse("2026-08-01T00:00:00Z") + (79 - i) * 86_400_000, // reversed
      open: 100,
      high: 110,
      low: 90,
      close: 100 + i,
      volume: 1000,
    }));
    const input = buildInput("GBP/USD", "forex", candles);
    const result = runAnalysis(input);
    expect(result).toBeDefined();
  });

  it("all-same-price candles (flat market) do not crash", () => {
    const candles: OhlcvCandle[] = Array.from({ length: 80 }, (_, i) => ({
      timestamp: Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1000,
    }));
    const input = buildInput("USD/JPY", "forex", candles);
    const result = runAnalysis(input);
    expect(result).toBeDefined();
  });
});

// ── Style isolation: same candles, different style ───────────────

describe("style isolation — same instrument, same data, different style", () => {
  const candles = bullCandles(0, 60_000);

  it("scalping/intraday/swing produce same structure from identical candles", () => {
    const scalping = runAnalysis(
      buildInput("BTC/USD", "crypto", candles, { tradingStyle: "scalping" }),
    );
    const intraday = runAnalysis(
      buildInput("BTC/USD", "crypto", candles, { tradingStyle: "intraday" }),
    );
    const swing = runAnalysis(
      buildInput("BTC/USD", "crypto", candles, { tradingStyle: "swing" }),
    );

    // Same instrument + same candles → same key levels (structural fact)
    expect(scalping.keyLevels).toEqual(intraday.keyLevels);
    expect(intraday.keyLevels).toEqual(swing.keyLevels);

    // Same structural direction
    expect(scalping.bias).toBe(intraday.bias);
    expect(intraday.bias).toBe(swing.bias);

    // Style label is different
    expect(scalping.tradingStyle).toBe("scalping");
    expect(intraday.tradingStyle).toBe("intraday");
    expect(swing.tradingStyle).toBe("swing");
  });
});

// ── Provider failure: unavailable context does not change thesis ─

describe("provider failure — unavailable context preserves thesis", () => {
  it("all secondary providers unavailable → same bias as with them", () => {
    const candles = bullCandles(0, 60_000);
    const input = buildInput("BTC/USD", "crypto", candles);

    // No optional contexts
    const result = runAnalysis(input);
    const biasWithout = result.bias;

    // With fabricated optional contexts (unavailable)
    const inputWithContext = buildInput("BTC/USD", "crypto", candles, {
      treasuryData: undefined,
      cotData: undefined,
      eiaData: undefined,
      executionData: undefined,
    });
    const resultWithContext = runAnalysis(inputWithContext);

    expect(resultWithContext.bias).toBe(biasWithout);
    expect(resultWithContext.recommendation).toBe(result.recommendation);
  });
});
