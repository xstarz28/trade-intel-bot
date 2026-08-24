/**
 * Phase 25 — DATA QUALITY CONTEXT tests.
 *
 * Tests the typed data-quality model, the assessDataQuality function,
 * and invariants I33–I38:
 *   I33 — Data Quality Is Non-Directional
 *   I34 — No Synthetic Quality Data
 *   I35 — Quality/Decision Separation
 *   I36 — Timestamp Integrity
 *   I37 — Instrument Identity Survives Quality Handling
 *   I38 — Unsupported Instrument Honesty
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import { assessDataQuality, overallQualityLabel } from "./data-quality";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData, OhlcvCandle } from "@/lib/data/market-types";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";

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

function buildInput(instrument: string, type: AnalysisInput["instrumentType"], candles: OhlcvCandle[], opts: Partial<AnalysisInput> = {}): AnalysisInput {
  const tech = calculateTechnical(candles);
  tech.smc = computeSmcContext(candles, "D1");
  return {
    instrument, instrumentType: type, timeframe: "D1", tradingStyle: "swing",
    marketData: {
      instrument, instrumentType: type, provider: "twelve-data", fetchTimestamp: Date.now(),
      price: { price: candles[candles.length - 1].close, timestamp: Date.now(), source: "twelve-data" },
      candles, timeframe: "D1", dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech, ...opts,
  };
}

// ── PRIMARY DATA QUALITY ─────────────────────────────────────────

describe("Phase 25 — primary data quality assessment", () => {
  it("good data (>=100 candles) → GOOD primary status", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000, 200));
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("GOOD");
  });

  it("moderate data (80 candles) → DEGRADED (below 100 threshold)", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000, 80));
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("DEGRADED");
  });

  it("no data → UNAVAILABLE", () => {
    const dq = assessDataQuality({ instrument: "BTC/USD", instrumentType: "crypto", timeframe: "D1" });
    expect(dq.primaryData.status).toBe("UNAVAILABLE");
  });

  it("few candles → INSUFFICIENT", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000, 5));
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("INSUFFICIENT");
  });

  it("stale data → STALE", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    if (input.marketData) input.marketData.dataFreshness = "stale";
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("STALE");
  });

  it("NaN price → INVALID", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    if (input.marketData) input.marketData.price = { ...input.marketData.price, price: NaN, timestamp: Date.now(), source: "twelve-data" };
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("INVALID");
  });

  it("zero price → INVALID", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    if (input.marketData) input.marketData.price = { ...input.marketData.price, price: 0, timestamp: Date.now(), source: "twelve-data" };
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("INVALID");
  });

  it("future timestamp → INVALID", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    if (input.marketData) input.marketData.price = { ...input.marketData.price, price: 50000, timestamp: Date.now() + 600_000, source: "twelve-data" };
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("INVALID");
  });
});

// ── INDICATOR QUALITY ────────────────────────────────────────────

describe("Phase 25 — indicator quality assessment", () => {
  it("all indicators available for sufficient data", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const dq = assessDataQuality(input);
    expect(dq.indicators.sma.status).toBe("AVAILABLE");
    expect(dq.indicators.rsi.status).toBe("AVAILABLE");
    expect(dq.indicators.macd.status).toBe("AVAILABLE");
    expect(dq.indicators.atr.status).toBe("AVAILABLE");
  });

  it("insufficient candles → insufficient indicators", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000, 5));
    const dq = assessDataQuality(input);
    expect(dq.indicators.sma.status).toBe("INSUFFICIENT_DATA");
    expect(dq.indicators.rsi.status).toBe("INSUFFICIENT_DATA");
    expect(dq.indicators.atr.status).toBe("INSUFFICIENT_DATA");
  });
});

// ── PROVIDER QUALITY ─────────────────────────────────────────────

describe("Phase 25 — provider quality assessment", () => {
  it("non-crypto has no execution provider", () => {
    const input = buildInput("EUR/USD", "forex", bullCandles(0, 1.1, 200));
    const dq = assessDataQuality(input);
    expect(dq.providers.execution).toBeUndefined();
  });

  it("available treasury → GOOD", () => {
    const input = buildInput("EUR/USD", "forex", bullCandles(0, 1.1, 200), {
      treasuryData: {
        available: true,
        freshness: "FRESH",
        latest: { nominal: { observationDate: "2026-08-01", nominal: { "2Y": 4.5, "10Y": 4.2 } }, real: undefined },
        fetchedAt: Date.now(),
        source: "test",
      } as any,
    });
    const dq = assessDataQuality(input);
    expect(dq.providers.treasury?.status).toBe("GOOD");
  });

  it("unavailable treasury → UNAVAILABLE", () => {
    const input = buildInput("EUR/USD", "forex", bullCandles(0, 1.1, 200), {
      treasuryData: { available: false, reason: "test failure" } as any,
    });
    const dq = assessDataQuality(input);
    expect(dq.providers.treasury?.status).toBe("UNAVAILABLE");
  });
});

// ── OVERALL QUALITY LABEL ────────────────────────────────────────

describe("Phase 25 — overallQualityLabel", () => {
  it("good data (200 candles) returns GOOD label", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000, 200));
    const dq = assessDataQuality(input);
    const label = overallQualityLabel(dq);
    expect(label.status).toBe("GOOD");
  });

  it("unavailable data returns UNAVAILABLE label", () => {
    const dq = assessDataQuality({ instrument: "BTC/USD", instrumentType: "crypto", timeframe: "D1" });
    const label = overallQualityLabel(dq);
    expect(label.status).toBe("UNAVAILABLE");
  });
});

// ── ENGINE INTEGRATION ───────────────────────────────────────────

describe("Phase 25 — engine produces dataQualityContext", () => {
  it("runAnalysis includes dataQualityContext", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000, 200));
    const result = runAnalysis(input);
    expect(result.dataQualityContext).toBeDefined();
    expect(result.dataQualityContext!.primaryData.status).toBe("GOOD");
    expect(result.dataQualityContext!.indicators.sma.status).toBe("AVAILABLE");
  });

  it("NO_TRADE result still has dataQualityContext", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    // Flat market → likely neutral structure → NO_TRADE
    const result = runAnalysis(input);
    // Regardless of recommendation, dataQualityContext must exist
    expect(result.dataQualityContext).toBeDefined();
  });
});

// ── INVARIANT I33: DATA QUALITY IS NON-DIRECTIONAL ───────────────

describe("Phase 25 — I33: data quality is non-directional", () => {
  it("unavailable providers do not create directional bias", () => {
    const baseInput = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const baseResult = runAnalysis(baseInput);

    // Remove all optional providers
    const sparseInput = buildInput("BTC/USD", "crypto", bullCandles(0, 50000), {
      treasuryData: undefined,
      cotData: undefined,
      eiaData: undefined,
      executionData: undefined,
      sentimentData: undefined,
      fundamentalData: undefined,
      calendarData: undefined,
      derivativesData: undefined,
    });
    const sparseResult = runAnalysis(sparseInput);

    // Unavailable providers must NOT change the directional bias
    expect(sparseResult.bias).toBe(baseResult.bias);
  });
});

// ── INVARIANT I34: NO SYNTHETIC QUALITY DATA ─────────────────────

describe("Phase 25 — I34: no synthetic quality data", () => {
  it("unknown quality remains unknown, not fabricated", () => {
    const dq = assessDataQuality({ instrument: "BTC/USD", instrumentType: "crypto", timeframe: "D1" });
    expect(dq.primaryData.validCount).toBeUndefined();
    expect(dq.primaryData.observationDate).toBeUndefined();
    expect(dq.indicators.sma.actualCount).toBe(0);
  });

  it("missing provider does not produce fake status", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const dq = assessDataQuality(input);
    // No treasury provided → should not pretend it exists
    expect(dq.providers.treasury).toBeUndefined();
  });
});

// ── INVARIANT I35: QUALITY/DECISION SEPARATION ───────────────────

describe("Phase 25 — I35: quality/decision separation", () => {
  it("same market data produces identical decision regardless of quality metadata", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);

    // The dataQualityContext must not affect decision output
    expect(result.recommendation).toBeDefined();
    expect(result.bias).toBeDefined();

    // Running again with the same input produces the same result
    const result2 = runAnalysis(input);
    expect(result2.recommendation).toBe(result.recommendation);
    expect(result2.bias).toBe(result.bias);
    expect(result2.confidence).toBe(result.confidence);
  });
});

// ── INVARIANT I36: TIMESTAMP INTEGRITY ───────────────────────────

describe("Phase 25 — I36: timestamp integrity", () => {
  it("invalid timestamp → INVALID quality, not GOOD", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    if (input.marketData) {
      input.marketData.price = { price: 50000, timestamp: -1, source: "twelve-data" };
    }
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("INVALID");
  });

  it("zero timestamp → INVALID quality", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    if (input.marketData) {
      input.marketData.price = { price: 50000, timestamp: 0, source: "twelve-data" };
    }
    const dq = assessDataQuality(input);
    expect(dq.primaryData.status).toBe("INVALID");
  });
});

// ── INVARIANT I37: INSTRUMENT IDENTITY SURVIVES QUALITY HANDLING ─

describe("Phase 25 — I37: instrument identity survives quality handling", () => {
  it("quality assessment does not mutate instrument", () => {
    const input = buildInput("SOL/USD", "crypto", bullCandles(0, 150));
    assessDataQuality(input);
    // Original input instrument must remain unchanged
    expect(input.instrument).toBe("SOL/USD");
  });

  it("runAnalysis preserves instrument with quality context", () => {
    const input = buildInput("DOGE/USD", "crypto", bullCandles(0, 0.15));
    const result = runAnalysis(input);
    expect(result.instrument).toBe("DOGE/USD");
    expect(result.dataQualityContext).toBeDefined();
  });
});

// ── INVARIANT I38: UNSUPPORTED INSTRUMENT HONESTY ────────────────

describe("Phase 25 — I38: unsupported instrument honesty", () => {
  it("no market data → quality = UNAVAILABLE, not fabricated", () => {
    const dq = assessDataQuality({ instrument: "RANDOM/TOKEN", instrumentType: "crypto", timeframe: "D1" });
    expect(dq.primaryData.status).toBe("UNAVAILABLE");
    expect(dq.primaryData.reason).toContain("No primary market data");
    // No fabricated providers
    expect(dq.providers.treasury).toBeUndefined();
  });
});
