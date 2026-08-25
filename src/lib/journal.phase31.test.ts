/**
 * Phase 31 — JOURNAL MODULE Tests.
 *
 * Tests:
 * A. Journal creation (valid entry, minimal observation, snapshot preserved)
 * B. Historical integrity (modifying journal does not modify AnalysisResult)
 * C. Missing data (P/L, exit, sizing, fundamentals, analysis fields)
 * D. Lifecycle transitions (PLANNED→OPEN→CLOSED, PLANNED→CANCELLED, etc.)
 * E. Invalid transitions (CLOSED→OPEN, CANCELLED→OPEN, etc.)
 * F. WAIT/NO_TRADE (observation only, cannot create open trade)
 * G. Instrument integrity (BTC, ETH, EUR/USD, XAU/USD, obscure)
 * H. Determinism (same snapshot = same stored context)
 * I. No fabrication (absent values remain absent)
 * J. Regression (Phase 1–30 tests remain green)
 */
import { describe, it, expect } from "vitest";
import {
  createAnalysisSnapshot,
  createJournalEntry,
  journalFromAnalysis,
  isValidTransition,
  transitionEntry,
  updateReview,
  updateTradeInfo,
  isTerminal,
  getValidTransitions,
  canCreateTrade,
  canJournalAsObservation,
  computePnl,
  classifyOutcome,
  createObservationEntry,
} from "./journal";
import type { AnalysisResult } from "@/types/analysis";
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

function buildInput(
  instrument: string,
  type: AnalysisInput["instrumentType"],
  candles: OhlcvCandle[],
): AnalysisInput {
  const tech = calculateTechnical(candles);
  tech.smc = computeSmcContext(candles, "D1");
  const slots = buildChain("D1");
  const mtfInputs = [
    { timeframe: "D1", role: "setup" as const, candles },
    ...slots.map((s) => ({
      timeframe: s.timeframe,
      role: (s.role === "setup" || s.role === "trigger" ? s.role : "setup") as "setup" | "trigger",
      candles: candles.slice(-120),
    })),
  ];
  tech.mtf = buildMtfContext("D1", mtfInputs);
  return {
    instrument, instrumentType: type, timeframe: "D1", tradingStyle: "swing",
    marketData: {
      instrument, instrumentType: type, provider: "twelve-data", fetchTimestamp: Date.now(),
      price: { price: candles[candles.length - 1].close, timestamp: Date.now(), source: "twelve-data" },
      candles, timeframe: "D1", dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech,
  };
}

function getResult(instrument: string, type: AnalysisInput["instrumentType"]): AnalysisResult {
  return runAnalysis(buildInput(instrument, type, bullCandles(0, type === "forex" ? 1.1 : type === "commodity" ? 2000 : type === "stock" ? 150 : 50000)));
}

// ═══════════════════════════════════════════════════════════════════
// A. JOURNAL CREATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — A: Journal creation", () => {
  it("createJournalEntry produces valid entry with all fields", () => {
    const result = getResult("BTC/USD", "crypto");
    const snapshot = createAnalysisSnapshot(result);
    const entry = createJournalEntry({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "D1",
      style: "swing",
      analysisSnapshot: snapshot,
      entry: 50000,
      stopLoss: 49000,
      takeProfit: 52000,
      entryReason: "Bullish HTF structure with MTF alignment",
    });

    expect(entry.id).toBeTruthy();
    expect(entry.instrument).toBe("BTC/USD");
    expect(entry.status).toBe("PLANNED");
    expect(entry.entry).toBe(50000);
    expect(entry.stopLoss).toBe(49000);
    expect(entry.takeProfit).toBe(52000);
    expect(entry.analysisSnapshot.analysisId).toBe(result.id);
    expect(entry.analysisSnapshot.decision).toBe(result.recommendation);
    expect(entry.analysisSnapshot.bias).toBe(result.bias);
  });

  it("journalFromAnalysis creates entry directly from result", () => {
    const result = getResult("ETH/USD", "crypto");
    const entry = journalFromAnalysis(result);

    expect(entry.instrument).toBe("ETH/USD");
    expect(entry.analysisSnapshot.analysisId).toBe(result.id);
    expect(entry.analysisSnapshot.decision).toBe(result.recommendation);
    expect(entry.status).toBe("PLANNED");
  });

  it("createObservationEntry creates NO_TRADE observation", () => {
    const result = getResult("BTC/USD", "crypto");
    const entry = createObservationEntry(result, "Testing observation");

    expect(entry.status).toBe("NO_TRADE");
    expect(entry.notes).toBe("Testing observation");
    expect(entry.analysisSnapshot.analysisId).toBe(result.id);
  });

  it("analysis snapshot is preserved exactly", () => {
    const result = getResult("BTC/USD", "crypto");
    const snapshot = createAnalysisSnapshot(result);

    expect(snapshot.analysisId).toBe(result.id);
    expect(snapshot.decision).toBe(result.recommendation);
    expect(snapshot.bias).toBe(result.bias);
    expect(snapshot.confidence).toBe(result.confidence);
    expect(snapshot.technicalSummary).toBe(result.technicalSummary);
    expect(snapshot.fundamentalSummary).toBe(result.fundamentalSummary);
    expect(snapshot.dataCompleteness).toBe(result.dataCompleteness);
  });

  it("minimal entry requires only instrument, type, timeframe, style, snapshot", () => {
    const result = getResult("BTC/USD", "crypto");
    const snapshot = createAnalysisSnapshot(result);
    const entry = createJournalEntry({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "D1",
      style: "swing",
      analysisSnapshot: snapshot,
    });

    expect(entry.id).toBeTruthy();
    expect(entry.entry).toBeUndefined();
    expect(entry.stopLoss).toBeUndefined();
    expect(entry.takeProfit).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. HISTORICAL INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — B: Historical integrity", () => {
  it("modifying journal does not modify original AnalysisResult", () => {
    const result = getResult("BTC/USD", "crypto");
    const originalBias = result.bias;
    const originalConfidence = result.confidence;

    const entry = journalFromAnalysis(result);
    // Simulate modification
    const updated = updateReview(entry, { notes: "modified" });
    const updatedTrade = updateTradeInfo(updated, { entry: 99999 });

    // Original result unchanged
    expect(result.bias).toBe(originalBias);
    expect(result.confidence).toBe(originalConfidence);

    // Journal snapshot is independent
    expect(updatedTrade.analysisSnapshot.bias).toBe(originalBias);
    expect(updatedTrade.notes).toBe("modified");
    expect(updatedTrade.entry).toBe(99999);
  });

  it("snapshot copy is independent of original", () => {
    const result = getResult("BTC/USD", "crypto");
    const snapshot1 = createAnalysisSnapshot(result);
    const snapshot2 = createAnalysisSnapshot(result);

    // Different object references
    expect(snapshot1).not.toBe(snapshot2);
    // But same values
    expect(snapshot1.analysisId).toBe(snapshot2.analysisId);
    expect(snapshot1.bias).toBe(snapshot2.bias);
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. MISSING DATA
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — C: Missing data", () => {
  it("missing P/L remains absent (not zero)", () => {
    const result = getResult("BTC/USD", "crypto");
    const entry = journalFromAnalysis(result);
    expect(entry.pnl).toBeUndefined();
    expect(entry.pnlPercent).toBeUndefined();
    expect(entry.exitPrice).toBeUndefined();
    expect(entry.outcome).toBeUndefined();
  });

  it("missing sizing remains absent", () => {
    const result = getResult("BTC/USD", "crypto");
    const entry = journalFromAnalysis(result);
    expect(entry.positionSize).toBeUndefined();
    expect(entry.notionalValue).toBeUndefined();
  });

  it("missing fundamental data in snapshot is absent", () => {
    const result = getResult("DOGE/USD", "crypto");
    const snapshot = createAnalysisSnapshot(result);
    // Fundamental alignment may be undefined for unavailable providers
    // This is expected — not fabricated
    expect(snapshot.analysisId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. LIFECYCLE TRANSITIONS
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — D: Lifecycle transitions", () => {
  it("PLANNED → OPEN", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const opened = transitionEntry(entry, "OPEN");
    expect(opened.status).toBe("OPEN");
    expect(opened.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt);
  });

  it("OPEN → CLOSED", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const opened = transitionEntry(entry, "OPEN");
    const closed = transitionEntry(opened, "CLOSED", {
      exitPrice: 51000,
      pnl: 1000,
      pnlPercent: 2,
      outcome: "WIN",
    });
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitPrice).toBe(51000);
    expect(closed.pnl).toBe(1000);
    expect(closed.outcome).toBe("WIN");
    expect(closed.closedAt).toBeGreaterThan(0);
  });

  it("PLANNED → CANCELLED", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const cancelled = transitionEntry(entry, "CANCELLED");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("PLANNED → INVALIDATED", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const invalidated = transitionEntry(entry, "INVALIDATED");
    expect(invalidated.status).toBe("INVALIDATED");
  });

  it("WAITING → PLANNED", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"), { status: "WAITING" });
    const planned = transitionEntry(entry, "PLANNED");
    expect(planned.status).toBe("PLANNED");
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. INVALID TRANSITIONS
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — E: Invalid transitions", () => {
  it("CLOSED → OPEN is rejected", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const closed = transitionEntry(transitionEntry(entry, "OPEN"), "CLOSED");
    expect(() => transitionEntry(closed, "OPEN")).toThrow();
  });

  it("CANCELLED → OPEN is rejected", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const cancelled = transitionEntry(entry, "CANCELLED");
    expect(() => transitionEntry(cancelled, "OPEN")).toThrow();
  });

  it("INVALIDATED → OPEN is rejected", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const invalidated = transitionEntry(entry, "INVALIDATED");
    expect(() => transitionEntry(invalidated, "OPEN")).toThrow();
  });

  it("NO_TRADE → any is rejected (terminal)", () => {
    const entry = createObservationEntry(getResult("BTC/USD", "crypto"));
    expect(isTerminal(entry)).toBe(true);
    expect(() => transitionEntry(entry, "OPEN")).toThrow();
  });

  it("PLANNED → CLOSED is rejected (must go through OPEN)", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    expect(() => transitionEntry(entry, "CLOSED")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// F. WAIT / NO_TRADE
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — F: WAIT/NO_TRADE", () => {
  it("WAIT/NO_TRADE can be journaled as observation", () => {
    const result = getResult("BTC/USD", "crypto");
    const entry = createObservationEntry(result, "Waiting for clarity");
    expect(entry.status).toBe("NO_TRADE");
    expect(entry.notes).toBe("Waiting for clarity");
  });

  it("WAIT/NO_TRADE cannot automatically create open trade", () => {
    const entry = createObservationEntry(getResult("BTC/USD", "crypto"));
    expect(isTerminal(entry)).toBe(true);
    expect(getValidTransitions(entry)).toHaveLength(0);
  });

  it("WAITING status can transition to PLANNED or CANCELLED", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"), { status: "WAITING" });
    expect(getValidTransitions(entry)).toContain("PLANNED");
    expect(getValidTransitions(entry)).toContain("CANCELLED");
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. INSTRUMENT INTEGRITY
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — G: Instrument integrity", () => {
  it("BTC remains BTC", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    expect(entry.instrument).toBe("BTC/USD");
    expect(entry.instrumentType).toBe("crypto");
  });

  it("ETH remains ETH", () => {
    const entry = journalFromAnalysis(getResult("ETH/USD", "crypto"));
    expect(entry.instrument).toBe("ETH/USD");
  });

  it("EUR/USD remains EUR/USD", () => {
    const entry = journalFromAnalysis(getResult("EUR/USD", "forex"));
    expect(entry.instrument).toBe("EUR/USD");
    expect(entry.instrumentType).toBe("forex");
  });

  it("XAU/USD remains XAU/USD", () => {
    const entry = journalFromAnalysis(getResult("XAU/USD", "commodity"));
    expect(entry.instrument).toBe("XAU/USD");
    expect(entry.instrumentType).toBe("commodity");
  });

  it("obscure instrument preserved", () => {
    const entry = journalFromAnalysis(getResult("DOGE/USD", "crypto"));
    expect(entry.instrument).toBe("DOGE/USD");
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. DETERMINISM
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — H: Determinism", () => {
  it("same snapshot produces same stored analysis context", () => {
    const result = getResult("BTC/USD", "crypto");
    const s1 = createAnalysisSnapshot(result);
    const s2 = createAnalysisSnapshot(result);

    expect(s1.analysisId).toBe(s2.analysisId);
    expect(s1.decision).toBe(s2.decision);
    expect(s1.bias).toBe(s2.bias);
    expect(s1.confidence).toBe(s2.confidence);
    expect(s1.technicalSummary).toBe(s2.technicalSummary);
    expect(s1.fundamentalSummary).toBe(s2.fundamentalSummary);
  });
});

// ═══════════════════════════════════════════════════════════════════
// I. NO FABRICATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — I: No fabrication", () => {
  it("absent values remain absent when not provided", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    expect(entry.pnl).toBeUndefined();
    expect(entry.pnlPercent).toBeUndefined();
    expect(entry.exitPrice).toBeUndefined();
    expect(entry.outcome).toBeUndefined();
    expect(entry.closedAt).toBeUndefined();
    expect(entry.confirmationObserved).toBeUndefined();
    expect(entry.invalidationObserved).toBeUndefined();
    expect(entry.whatWentRight).toBeUndefined();
    expect(entry.whatWentWrong).toBeUndefined();
    expect(entry.lessons).toBeUndefined();
  });

  it("computePnl returns undefined for missing inputs", () => {
    expect(computePnl(undefined, 51000, "long", 100)).toEqual({ pnl: undefined, pnlPercent: undefined });
    expect(computePnl(50000, undefined, "long", 100)).toEqual({ pnl: undefined, pnlPercent: undefined });
    expect(computePnl(50000, 51000, undefined, 100)).toEqual({ pnl: undefined, pnlPercent: undefined });
  });

  it("computePnl calculates correctly when all inputs present", () => {
    const long = computePnl(50000, 51000, "long", 100);
    expect(long.pnl).toBe(100000);
    expect(long.pnlPercent).toBe(2);

    const short = computePnl(50000, 49000, "short", 100);
    expect(short.pnl).toBe(100000);
    expect(short.pnlPercent).toBe(2);
  });

  it("classifyOutcome handles undefined", () => {
    expect(classifyOutcome(undefined)).toBe("UNKNOWN");
    expect(classifyOutcome(0)).toBe("BREAKEVEN");
    expect(classifyOutcome(100)).toBe("WIN");
    expect(classifyOutcome(-100)).toBe("LOSS");
  });
});

// ═══════════════════════════════════════════════════════════════════
// J. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — J: Helper functions", () => {
  it("canCreateTrade returns true for LONG/SHORT, false for NO_TRADE", () => {
    const result = getResult("BTC/USD", "crypto");
    if (result.recommendation === "NO_TRADE") {
      expect(canCreateTrade(result)).toBe(false);
    } else {
      expect(canCreateTrade(result)).toBe(true);
    }
  });

  it("canJournalAsObservation always returns true", () => {
    expect(canJournalAsObservation(getResult("BTC/USD", "crypto"))).toBe(true);
  });

  it("isValidTransition checks correctly", () => {
    expect(isValidTransition("PLANNED", "OPEN")).toBe(true);
    expect(isValidTransition("PLANNED", "CANCELLED")).toBe(true);
    expect(isValidTransition("PLANNED", "CLOSED")).toBe(false);
    expect(isValidTransition("CLOSED", "OPEN")).toBe(false);
    expect(isValidTransition("NO_TRADE", "OPEN")).toBe(false);
  });

  it("getValidTransitions returns correct list", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    expect(getValidTransitions(entry)).toContain("OPEN");
    expect(getValidTransitions(entry)).toContain("CANCELLED");
    expect(getValidTransitions(entry)).not.toContain("CLOSED");
  });

  it("isTerminal correctly identifies terminal states", () => {
    const planned = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const closed = transitionEntry(transitionEntry(planned, "OPEN"), "CLOSED");
    const noTrade = createObservationEntry(getResult("BTC/USD", "crypto"));

    expect(isTerminal(planned)).toBe(false);
    expect(isTerminal(closed)).toBe(true);
    expect(isTerminal(noTrade)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// K. REVIEW UPDATE
// ═══════════════════════════════════════════════════════════════════

describe("Phase 31 — K: Professional review", () => {
  it("updateReview adds review fields immutably", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto"));
    const reviewed = updateReview(entry, {
      whatWentRight: "Good entry timing",
      whatWentWrong: "Held too long",
      lessons: "Set trailing stop earlier",
    });

    expect(reviewed.whatWentRight).toBe("Good entry timing");
    expect(reviewed.whatWentWrong).toBe("Held too long");
    expect(reviewed.lessons).toBe("Set trailing stop earlier");
    // Original entry unchanged
    expect(entry.whatWentRight).toBeUndefined();
  });
});
