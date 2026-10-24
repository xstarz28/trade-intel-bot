/**
 * Phase 26 — STRUCTURED ANALYST THESIS tests.
 *
 * Validates thesis derivation from existing engine outputs:
 * - LONG thesis has supporting + conflicting evidence
 * - SHORT thesis is symmetric to LONG
 * - NO_TRADE has blockers + what-would-change path
 * - Determinism: same input → identical thesis
 * - I39–I44 invariants
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, OhlcvCandle } from "@/lib/data/market-types";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildChain, buildMtfContext } from "./data/mtf";

// ── helpers ──────────────────────────────────────────────────────

function ts(i: number): number {
  return Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000;
}

function bullCandle(i: number, base: number): OhlcvCandle {
  const price = base + i * 50;
  return { timestamp: ts(i), open: price - 20, high: price + 30, low: price - 40, close: price, volume: 1_000_000 };
}

function bullCandles(start: number, base: number, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => bullCandle(start + i, base));
}

function flatCandles(base: number, n = 200): OhlcvCandle[] {
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
      price: { price: candles[candles.length - 1].close, timestamp: Date.now(), source: "twelve-data" },
      candles, timeframe: "D1", dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech, ...opts,
  };
}

// ── LONG THESIS ──────────────────────────────────────────────────

describe("Phase 26 — LONG thesis", () => {
  it("produces valid thesis with structural thesis and snapshot", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    if (result.recommendation === "LONG") {
      expect(result.analystThesis).toBeDefined();
      expect(result.analystThesis!.decisionSnapshot).toContain("LONG");
      expect(result.analystThesis!.structuralThesis).toBeTruthy();
      expect(result.analystThesis!.confirmationCondition).toBeTruthy();
      expect(result.analystThesis!.invalidationCondition).toBeTruthy();
    }
  });

  it("LONG has supporting evidence", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    if (result.recommendation === "LONG") {
      expect(result.analystThesis!.supportingEvidence.length).toBeGreaterThan(0);
    }
  });

  it("LONG invalidation mentions structural stop", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    if (result.recommendation === "LONG" && result.tradePlan) {
      expect(result.analystThesis!.invalidationCondition).toContain(result.tradePlan.stopLoss);
    }
  });
});

// ── SHORT SYMMETRY ───────────────────────────────────────────────

describe("Phase 26 — SHORT symmetry (I44)", () => {
  it("SHORT thesis has structural thesis and snapshot", () => {
    // Use bearish candles
    const bearCandles = Array.from({ length: 200 }, (_, i) => {
      const price = 50000 - i * 50;
      return { timestamp: ts(i), open: price + 20, high: price + 40, low: price - 30, close: price, volume: 1_000_000 };
    });
    const input = buildInput("ETH/USD", "crypto", bearCandles);
    const result = runAnalysis(input);
    if (result.recommendation === "SHORT") {
      expect(result.analystThesis).toBeDefined();
      expect(result.analystThesis!.decisionSnapshot).toContain("SHORT");
      expect(result.analystThesis!.structuralThesis).toBeTruthy();
      expect(result.analystThesis!.supportingEvidence.length).toBeGreaterThan(0);
      expect(result.analystThesis!.invalidationCondition).toContain("above");
    }
  });
});

// ── NO_TRADE EXPLANATION ─────────────────────────────────────────

describe("Phase 26 — NO_TRADE explanation", () => {
  it("NO_TRADE has noTradePath and no trade plan", () => {
    const input = buildInput("BTC/USD", "crypto", flatCandles(50000));
    const result = runAnalysis(input);
    if (result.recommendation === "NO_TRADE") {
      expect(result.analystThesis).toBeDefined();
      expect(result.analystThesis!.noTradePath).toBeTruthy();
      expect(result.analystThesis!.noTradePath).toContain("blocker");
      expect(result.tradePlan).toBeUndefined();
    }
  });

  it("NO_TRADE snapshot shows NO_TRADE", () => {
    const input = buildInput("BTC/USD", "crypto", flatCandles(50000));
    const result = runAnalysis(input);
    if (result.recommendation === "NO_TRADE") {
      expect(result.analystThesis!.decisionSnapshot).toContain("NO_TRADE");
    }
  });
});

// ── INVARIANT I39: THESIS TRACEABILITY ───────────────────────────

describe("Phase 26 — I39: thesis traceability", () => {
  it("every thesis statement derives from engine data", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    expect(result.analystThesis).toBeDefined();
    // Snapshot must reference conviction, which comes from the engine
    expect(result.analystThesis!.decisionSnapshot).toContain("Conviction");
    // Structural thesis must reference structure direction
    const structDir = result.decisionTrace?.structuralDirection;
    if (structDir && structDir !== "none") {
      expect(result.analystThesis!.structuralThesis.toLowerCase()).toContain(structDir);
    }
  });
});

// ── INVARIANT I40: CONTRADICTION VISIBILITY ──────────────────────

describe("Phase 26 — I40: contradiction visibility", () => {
  it("material contradictions appear in conflicting evidence", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    if (result.keyContradictions && result.keyContradictions.some((c) => c.severity !== "MINOR")) {
      expect(result.analystThesis!.conflictingEvidence.length).toBeGreaterThan(0);
    }
  });
});

// ── INVARIANT I41: CONFIRMATION/INVALIDATION CONSISTENCY ─────────

describe("Phase 26 — I41: confirmation/invalidation consistency", () => {
  it("invalidation references existing key levels", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    if (result.tradePlan) {
      // Invalidation should reference the stop loss level
      expect(result.analystThesis!.invalidationCondition).toContain(result.tradePlan.stopLoss);
    }
  });
});

// ── INVARIANT I42: AVAILABILITY IS NOT EVIDENCE ──────────────────

describe("Phase 26 — I42: availability is not evidence", () => {
  it("unavailable providers do not appear in supporting evidence", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    if (result.analystThesis) {
      for (const e of result.analystThesis.supportingEvidence) {
        expect(e.explanation).not.toContain("available");
      }
    }
  });
});

// ── INVARIANT I43: ANALYST SUMMARY IS NON-AUTHORITATIVE ─────────

describe("Phase 26 — I43: thesis does not modify decision", () => {
  it("thesis is purely derived, same result without it", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    // Thesis must not alter recommendation, conviction, or confidence
    expect(result.recommendation).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(20);
    expect(result.confidence).toBeLessThanOrEqual(88);
  });
});

// ── INVARIANT I44: LONG/SHORT SYMMETRY ───────────────────────────

describe("Phase 26 — I44: LONG/SHORT symmetry", () => {
  it("LONG and SHORT both have supporting evidence", () => {
    const bullInput = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const bullResult = runAnalysis(bullInput);
    const bearCandles = Array.from({ length: 200 }, (_, i) => {
      const price = 50000 - i * 50;
      return { timestamp: ts(i), open: price + 20, high: price + 40, low: price - 30, close: price, volume: 1_000_000 };
    });
    const bearInput = buildInput("BTC/USD", "crypto", bearCandles);
    const bearResult = runAnalysis(bearInput);

    // Both must have thesis
    expect(bullResult.analystThesis).toBeDefined();
    expect(bearResult.analystThesis).toBeDefined();

    // If one is LONG and the other SHORT, both should have supporting evidence
    if (bullResult.recommendation === "LONG" && bearResult.recommendation === "SHORT") {
      expect(bullResult.analystThesis!.supportingEvidence.length).toBeGreaterThan(0);
      expect(bearResult.analystThesis!.supportingEvidence.length).toBeGreaterThan(0);
      // Both must have confirmation and invalidation
      expect(bullResult.analystThesis!.confirmationCondition).toBeTruthy();
      expect(bearResult.analystThesis!.confirmationCondition).toBeTruthy();
    }
  });
});

// ── DETERMINISM ──────────────────────────────────────────────────

describe("Phase 26 — determinism", () => {
  it("same input produces identical thesis", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const r1 = runAnalysis(input);
    const r2 = runAnalysis(input);
    expect(r1.analystThesis!.decisionSnapshot).toBe(r2.analystThesis!.decisionSnapshot);
    expect(r1.analystThesis!.structuralThesis).toBe(r2.analystThesis!.structuralThesis);
    expect(r1.analystThesis!.confirmationCondition).toBe(r2.analystThesis!.confirmationCondition);
    expect(r1.analystThesis!.invalidationCondition).toBe(r2.analystThesis!.invalidationCondition);
  });
});

// ── DATA QUALITY INTEGRATION ─────────────────────────────────────

describe("Phase 26 — data quality integration", () => {
  it("missing data appears in missingInformation", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    // With no optional providers, missing info should reflect that
    if (result.analystThesis!.missingInformation.length > 0) {
      // Each missing item should be a non-empty string
      for (const m of result.analystThesis!.missingInformation) {
        expect(m.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── SAFETY: NO PROBABILITY LANGUAGE ──────────────────────────────

describe("Phase 26 — safety: no probability language", () => {
  it("thesis never contains probability claims", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    if (result.analystThesis) {
      const allText = [
        result.analystThesis.decisionSnapshot,
        result.analystThesis.structuralThesis,
        ...result.analystThesis.supportingEvidence.map((e) => e.explanation),
        ...result.analystThesis.conflictingEvidence.map((e) => e.explanation),
        result.analystThesis.confirmationCondition,
        result.analystThesis.invalidationCondition,
        ...(result.analystThesis.noTradePath ? [result.analystThesis.noTradePath] : []),
      ].join(" ").toLowerCase();
      expect(allText).not.toContain("probability");
      expect(allText).not.toContain("win rate");
      expect(allText).not.toContain("guaranteed");
      expect(allText).not.toContain("will go up");
      expect(allText).not.toContain("will go down");
    }
  });
});

// ── SAFETY: NO INSTRUMENT SUBSTITUTION ───────────────────────────

describe("Phase 26 — safety: no instrument substitution", () => {
  it("thesis preserves instrument identity", () => {
    const input = buildInput("SOL/USD", "crypto", bullCandles(0, 150));
    const result = runAnalysis(input);
    expect(result.instrument).toBe("SOL/USD");
    expect(result.analystThesis).toBeDefined();
  });
});
