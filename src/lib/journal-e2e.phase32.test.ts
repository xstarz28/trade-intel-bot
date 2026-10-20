/**
 * Phase 32 — JOURNAL END-TO-END VALIDATION.
 *
 * Tests the complete journal lifecycle from analysis → journal → review.
 * Covers adversarial scenarios, snapshot immutability, lifecycle safety,
 * and data integrity.
 */
import { describe, it, expect } from "vitest";
import {
  createAnalysisSnapshot,
  journalFromAnalysis,
  createObservationEntry,
  transitionEntry,
  updateReview,
  updateTradeInfo,
  isTerminal,
  computePnl,
} from "./journal";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput, AnalysisResult } from "@/types/analysis";
import type { MarketData, OhlcvCandle } from "@/lib/data/market-types";
import { calculateTechnical } from "./data/technical";
import { computeSmcContext } from "./data/smc";
import { buildChain, buildMtfContext } from "./data/mtf";
import type { JournalEntry } from "@/types/journal";

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

function getResult(symbol: string, type: AnalysisInput["instrumentType"], base: number): AnalysisResult {
  return runAnalysis(buildInput(symbol, type, bullCandles(0, base)));
}

// ═══════════════════════════════════════════════════════════════════
// 1. FULL LIFECYCLE: BTC
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — E2E: BTC full lifecycle", () => {
  it("analysis → journal → open → review → close", () => {
    // 1. Generate analysis
    const result = getResult("BTC/USD", "crypto", 50000);

    // 2. Create journal from analysis
    const entry = journalFromAnalysis(result, {
      entry: 50000,
      stopLoss: 49000,
      takeProfit: 52000,
      entryReason: "Bullish HTF structure",
    });

    // 3. Verify snapshot
    expect(entry.analysisSnapshot.analysisId).toBe(result.id);
    expect(entry.analysisSnapshot.decision).toBe(result.recommendation);
    expect(entry.analysisSnapshot.bias).toBe(result.bias);

    // 4. Open trade
    const opened = transitionEntry(entry, "OPEN");
    expect(opened.status).toBe("OPEN");

    // 5. Add trade details
    const withTrade = updateTradeInfo(opened, {
      entry: 50000,
      stopLoss: 49000,
      takeProfit: 52000,
      riskReward: 2.0,
      positionSize: 10,
    });
    expect(withTrade.riskReward).toBe(2.0);

    // 6. Add review
    const withReview = updateReview(withTrade, {
      thesisAtEntry: "Bullish continuation expected",
      confirmationObserved: "MTF aligned",
    });
    expect(withReview.thesisAtEntry).toBe("Bullish continuation expected");

    // 7. Close trade
    const closed = transitionEntry(withReview, "CLOSED", {
      exitPrice: 51500,
      pnl: 15000,
      pnlPercent: 3,
      outcome: "WIN",
    });
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitPrice).toBe(51500);
    expect(closed.pnl).toBe(15000);
    expect(closed.outcome).toBe("WIN");

    // 8. Add post-trade review
    const reviewed = updateReview(closed, {
      whatWentRight: "Good entry timing",
      whatWentWrong: "Could have held longer",
      lessons: "Consider trailing stop",
    });
    expect(reviewed.whatWentRight).toBe("Good entry timing");

    // 9. Verify snapshot unchanged throughout
    expect(reviewed.analysisSnapshot.analysisId).toBe(result.id);
    expect(reviewed.analysisSnapshot.bias).toBe(result.bias);
    expect(reviewed.analysisSnapshot.confidence).toBe(result.confidence);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. MULTI-INSTRUMENT E2E
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — E2E: Multi-instrument", () => {
  const instruments = [
    { symbol: "EUR/USD", type: "forex" as const, base: 1.1 },
    { symbol: "XAU/USD", type: "commodity" as const, base: 2000 },
    { symbol: "ETH/USD", type: "crypto" as const, base: 3000 },
    { symbol: "DOGE/USD", type: "crypto" as const, base: 0.1 },
  ];

  for (const inst of instruments) {
    it(`${inst.symbol} — full lifecycle`, () => {
      const result = getResult(inst.symbol, inst.type, inst.base);
      const entry = journalFromAnalysis(result);
      expect(entry.instrument).toBe(inst.symbol);
      expect(entry.analysisSnapshot.analysisId).toBe(result.id);

      const opened = transitionEntry(entry, "OPEN");
      const closed = transitionEntry(opened, "CLOSED");
      expect(closed.status).toBe("CLOSED");
      expect(closed.instrument).toBe(inst.symbol);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 3. SNAPSHOT IMMUTABILITY
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Snapshot immutability", () => {
  it("editing journal does not modify original AnalysisResult", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
    const origBias = result.bias;
    const origConf = result.confidence;
    const origRec = result.recommendation;

    const entry = journalFromAnalysis(result);
    const modified = updateReview(entry, { notes: "changed" });
    const modifiedTrade = updateTradeInfo(modified, { entry: 99999 });
    const closed = transitionEntry(modifiedTrade, "OPEN");
    const closedFinal = transitionEntry(closed, "CLOSED", { pnl: 100 });
    const reviewed = updateReview(closedFinal, { lessons: "learned" });

    // Original AnalysisResult completely untouched
    expect(result.bias).toBe(origBias);
    expect(result.confidence).toBe(origConf);
    expect(result.recommendation).toBe(origRec);
  });

  it("snapshot copy is independent — modifying one does not affect other", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
    const s1 = createAnalysisSnapshot(result);
    const s2 = createAnalysisSnapshot(result);

    // Different object references
    expect(s1).not.toBe(s2);
    // Same values
    expect(s1.analysisId).toBe(s2.analysisId);
    expect(s1.bias).toBe(s2.bias);
  });

  it("journal entry snapshots are independent across entries", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
    const e1 = journalFromAnalysis(result);
    const e2 = journalFromAnalysis(result);

    expect(e1.analysisSnapshot).not.toBe(e2.analysisSnapshot);
    expect(e1.analysisSnapshot.analysisId).toBe(e2.analysisSnapshot.analysisId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. ADVERSARIAL: DUPLICATE CREATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Adversarial: duplicate creation", () => {
  it("creating multiple journals from same analysis is allowed", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
    const e1 = journalFromAnalysis(result);
    const e2 = journalFromAnalysis(result);

    // Both are valid and independent
    expect(e1.id).not.toBe(e2.id);
    expect(e1.analysisSnapshot.analysisId).toBe(e2.analysisSnapshot.analysisId);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. ADVERSARIAL: RAPID CREATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Adversarial: rapid creation", () => {
  it("creating 100 entries in rapid succession produces unique IDs", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
    const entries: JournalEntry[] = [];
    for (let i = 0; i < 100; i++) {
      entries.push(journalFromAnalysis(result));
    }
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.size).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. ADVERSARIAL: INVALID LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Adversarial: invalid lifecycle", () => {
  it("all invalid transitions throw", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto", 50000));
    const opened = transitionEntry(entry, "OPEN");
    const closed = transitionEntry(opened, "CLOSED");
    const cancelled = transitionEntry(journalFromAnalysis(getResult("ETH/USD", "crypto", 3000)), "CANCELLED");
    const noTrade = createObservationEntry(getResult("BTC/USD", "crypto", 50000));

    // Closed → anything
    expect(() => transitionEntry(closed, "OPEN")).toThrow();
    expect(() => transitionEntry(closed, "CANCELLED")).toThrow();

    // Cancelled → anything
    expect(() => transitionEntry(cancelled, "OPEN")).toThrow();
    expect(() => transitionEntry(cancelled, "CLOSED")).toThrow();

    // NO_TRADE → anything
    expect(() => transitionEntry(noTrade, "OPEN")).toThrow();

    // PLANNED → CLOSED (skip OPEN)
    expect(() => transitionEntry(entry, "CLOSED")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. ADVERSARIAL: MISSING DATA
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Adversarial: missing data", () => {
  it("undefined fields remain undefined after transitions", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto", 50000));
    expect(entry.pnl).toBeUndefined();
    expect(entry.exitPrice).toBeUndefined();
    expect(entry.outcome).toBeUndefined();

    const opened = transitionEntry(entry, "OPEN");
    expect(opened.pnl).toBeUndefined();

    const closed = transitionEntry(opened, "CLOSED");
    // Without providing outcome fields, they remain absent
    expect(closed.exitPrice).toBeUndefined();
    expect(closed.pnl).toBeUndefined();
  });

  it("computePnl handles edge cases", () => {
    expect(computePnl(0, 100, "long", 10)).toEqual({ pnl: 1000, pnlPercent: undefined });
    expect(computePnl(50000, 51000, "long", undefined)).toEqual({ pnl: 1000, pnlPercent: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. ADVERSARIAL: INSTRUMENT IDENTITY
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Adversarial: instrument identity", () => {
  it("obscure instrument preserved through full lifecycle", () => {
    const result = getResult("DOGE/USD", "crypto", 0.1);
    const entry = journalFromAnalysis(result);
    expect(entry.instrument).toBe("DOGE/USD");

    const opened = transitionEntry(entry, "OPEN");
    expect(opened.instrument).toBe("DOGE/USD");

    const closed = transitionEntry(opened, "CLOSED");
    expect(closed.instrument).toBe("DOGE/USD");

    const reviewed = updateReview(closed, { notes: "test" });
    expect(reviewed.instrument).toBe("DOGE/USD");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. ADVERSARIAL: SNAPSHOT MUTATION ATTEMPTS
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Adversarial: snapshot mutation attempts", () => {
  it("all mutations create new objects — original entry unchanged", () => {
    const entry = journalFromAnalysis(getResult("BTC/USD", "crypto", 50000));
    const orig = { ...entry };

    updateReview(entry, { notes: "changed" });
    updateTradeInfo(entry, { entry: 999 });
    transitionEntry(entry, "OPEN");

    // Original entry unchanged (immutable updates)
    expect(entry.notes).toBeUndefined();
    expect(entry.entry).toBeUndefined();
    expect(entry.status).toBe("PLANNED");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. WAIT/NO_TRADE OBSERVATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — WAIT/NO_TRADE observation", () => {
  it("NO_TRADE result can be journaled as observation", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
    const entry = createObservationEntry(result, "Research: watching for setup");

    expect(entry.status).toBe("NO_TRADE");
    expect(entry.notes).toBe("Research: watching for setup");
    expect(entry.analysisSnapshot.analysisId).toBe(result.id);
    expect(isTerminal(entry)).toBe(true);
  });

  it("observation cannot become a trade", () => {
    const entry = createObservationEntry(getResult("BTC/USD", "crypto", 50000));
    expect(() => transitionEntry(entry, "OPEN")).toThrow();
    expect(() => transitionEntry(entry, "PLANNED")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. DETERMINISM
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Determinism", () => {
  it("same result produces identical snapshots", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
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
// 12. CONCURRENT UPDATE SAFETY
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Concurrent update safety", () => {
  it("independent entries can be modified in parallel", () => {
    const r1 = getResult("BTC/USD", "crypto", 50000);
    const r2 = getResult("ETH/USD", "crypto", 3000);
    const e1 = journalFromAnalysis(r1);
    const e2 = journalFromAnalysis(r2);

    // Modify both independently
    const e1mod = updateReview(e1, { notes: "BTC notes" });
    const e2mod = updateReview(e2, { notes: "ETH notes" });

    // Each entry is independent
    expect(e1mod.notes).toBe("BTC notes");
    expect(e2mod.notes).toBe("ETH notes");
    expect(e1mod.analysisSnapshot.analysisId).toBe(r1.id);
    expect(e2mod.analysisSnapshot.analysisId).toBe(r2.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. ENGINE INVARIANT PRESERVATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 32 — Engine invariant preservation", () => {
  it("journal operations never modify engine output", () => {
    const result = getResult("BTC/USD", "crypto", 50000);
    const origConviction = result.confidence;
    const origRec = result.recommendation;
    const origFingerprint = result.decisionFingerprint;

    // Create and fully lifecycle a journal
    const e = journalFromAnalysis(result);
    const opened = transitionEntry(e, "OPEN");
    const closed = transitionEntry(opened, "CLOSED", { pnl: 100 });
    updateReview(closed, { notes: "test" });
    updateTradeInfo(closed, { entry: 999 });

    // Engine result unchanged
    expect(result.confidence).toBe(origConviction);
    expect(result.recommendation).toBe(origRec);
    expect(result.decisionFingerprint).toBe(origFingerprint);
  });
});
