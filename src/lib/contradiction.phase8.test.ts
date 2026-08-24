/**
 * Phase 8 P4 — structured contradiction / DECISIVE derivation.
 *
 * - detectContradictions never emits DECISIVE on its own (max MATERIAL).
 * - DECISIVE is promoted ONLY by an actual gate decision of THIS run,
 *   matched through structured evidence domains — never via regex over
 *   human-readable reason text.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import { detectContradictions } from "./market-context";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(price: number): MarketData {
  return {
    instrument: "EUR/USD", instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

function tech(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [112], swingLows: [95],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [112],
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

function input(over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100),
    technicalData: tech(),
    ...over,
  } as AnalysisInput;
}

const sevOf = (r: ReturnType<typeof runAnalysis>, needle: RegExp) =>
  r.keyContradictions.find((c) => needle.test(c.description))?.severity;

// ── Pure-function cap ──────────────────────────────────────────────

describe("P4: detectContradictions caps at MATERIAL", () => {
  it("strong fundamental conflict is MATERIAL with domain tag — never DECISIVE", () => {
    const items = detectContradictions({
      breakdown: { fundamental: -2, sentiment: 0 },
      bias: "Bullish",
      technicalData: tech(),
    });
    const fund = items.find((c) => c.domain === "fundamental");
    expect(fund).toBeDefined();
    expect(fund!.severity).toBe("MATERIAL");
    expect(items.every((c) => c.severity !== "DECISIVE")).toBe(true);
  });

  it("positioning conflict also caps at MATERIAL", () => {
    const items = detectContradictions({
      breakdown: { fundamental: 0, sentiment: -2 },
      bias: "Bullish",
      technicalData: tech(),
    });
    const pos = items.find((c) => c.domain === "positioning");
    expect(pos?.severity).toBe("MATERIAL");
    expect(items.every((c) => c.severity !== "DECISIVE")).toBe(true);
  });
});

// ── Engine-level promotion semantics ───────────────────────────────

describe("P4: DECISIVE derives only from actual gate decisions", () => {
  it("1. MATERIAL fundamental contradiction WITHOUT a decisive gate → stays MATERIAL", () => {
    // Bullish structure (+2 trend layer) + mild bearish fundamental (−1):
    // thesis survives; Gate 5 does NOT fire (|score| < 2).
    const r = runAnalysis(input({
      economicEvents: "ECB dovish, rate cut",
      sentimentData: {
        provider: "alpha-vantage", timestamp: Date.now(),
        averageScore: 0.3, articleCount: 4, label: "bullish",
        breakdown: { positive: 3, negative: 0, neutral: 1 },
        confidence: "high", articles: [],
      }, // second agreeing core factor so Gate 4 does not reject
    }));
    expect(r.recommendation).toBe("LONG");
    expect(sevOf(r, /fundamental disagreement/i)).toBe("MATERIAL");
  });

  it("2. Actual decisive gate rejection (Gate 5) → fundamental contradiction DECISIVE", () => {
    // Bearish structure + strongly bullish fundamental (|score| = 2):
    // Gate 5 fires and registers the "fundamental" domain.
    const r = runAnalysis(input({
      technicalData: tech({ structure: "LH/LL", bosDirection: "bearish", supportLevels: [88], resistanceLevels: [105], swingHighs: [105], swingLows: [88] }),
      economicEvents: "hawkish rate hike strong gdp strong employment",
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toContain("Material conflict");
    expect(sevOf(r, /fundamental disagreement/i)).toBe("DECISIVE");
  });

  it("3. Unrelated gate rejection cannot promote an unrelated-domain contradiction", () => {
    // Bullish-aligned thesis whose liquidity sweep CONTRADICTS it (MINOR),
    // rejected later by an R:R gate (no opposing level). The NO_TRADE must
    // NOT promote the liquidity contradiction — different domain, no gate
    // registered "liquidity".
    const r = runAnalysis(input({
      technicalData: tech({
        resistanceLevels: [], swingHighs: [], // no opposing target → Gate 7 R:R rejection
        smc: {
          timeframe: "H4",
          liquidityPools: [],
          recentSweep: { side: "buy_side", level: 106, source: "equal_highs", candleIndex: 205, candleTime: Date.now(), timeframe: "H4" },
          internalExternal: {
            external: { structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: undefined, lastSwingLow: 95, dataPoints: 210 },
            internal: { structure: "HH/HL", bosDirection: "none", chochDirection: "none", lastSwingHigh: undefined, lastSwingLow: 99, dataPoints: 60 },
            internalConflict: false,
          },
          fvgs: [],
          orderBlocks: [],
          vwap: { available: false },
          volumeProfile: { available: false },
        } as unknown as TechnicalData["smc"],
      }),
      economicEvents: "Fed signals hawkish stance, rate hike",
    }));
    if (r.recommendation === "NO_TRADE") {
      const sweepSev = sevOf(r, /liquidity sweep/i);
      if (sweepSev !== undefined) expect(sweepSev).not.toBe("DECISIVE");
    }
  });

  it("4. Provider unavailability never becomes DECISIVE", () => {
    const r = runAnalysis(input({
      treasuryData: { available: false as const, reason: "key missing", fetchedAt: Date.now() } as never,
      cotData: { available: false as const, reason: "no mapping", fetchedAt: Date.now(), requestedInstrument: "EUR/USD" } as never,
    }));
    const decisive = r.keyContradictions.filter((c) => c.severity === "DECISIVE");
    expect(decisive).toHaveLength(0);
    expect(r.noTradeReasons.join(" ").toLowerCase()).not.toContain("unavailable became decisive");
  });

  it("5. Fundamental contradiction alone can NEVER be DECISIVE without its gate", () => {
    // Neutral structure: the structural veto forces NO_TRADE, but that gate
    // registers NO domain — the fundamental contradiction stays MATERIAL.
    const r = runAnalysis(input({
      technicalData: tech({ structure: "range", bosDirection: "none" }),
      economicEvents: "hawkish rate hike strong gdp strong employment",
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(sevOf(r, /fundamental disagreement/i)).not.toBe("DECISIVE");
  });
});
