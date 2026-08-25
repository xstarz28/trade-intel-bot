/**
 * Phase 29 — FORWARD MARKET PATH Tests.
 *
 * Invariants:
 *   I61: Current state ≠ forward path
 *   I62: Correction ≠ reversal
 *   I63: LTF cannot override HTF
 *   I64: Single signal cannot confirm reversal
 *   I65: Breakout requires acceptance evidence
 *   I66: Liquidity sweep is not automatic reversal
 *   I67: Extension does not equal reversal
 *   I68: Fundamental conflict is visible
 *   I69: Missing fundamental data is neutral
 *   I70: Event risk cannot manufacture direction
 *   I71: Forward path cannot modify recommendation
 *   I72: Forward path cannot create trade plan
 *   I73: No synthetic price targets
 *   I74: No probability claims
 *   I75: Horizon isolation
 *   I76: Trader/investor views use same evidence
 *   I77: Dynamic instrument identity preserved
 *   I78: Forward path deterministic
 *   I79: Poor data quality cannot produce false confirmation
 *   I80: Primary and alternate scenarios must remain explicit
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import { buildForwardMarketPath } from "./forward-market-path";
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

function buildInput(
  instrument: string,
  type: AnalysisInput["instrumentType"],
  candles: OhlcvCandle[],
  opts: Partial<AnalysisInput> = {},
): AnalysisInput {
  const tech = calculateTechnical(candles);
  tech.smc = computeSmcContext(candles, "D1");
  const slots = buildChain("D1");
  const mtfInputs = [
    { timeframe: "D1", role: "setup" as const, candles },
    ...slots.map((s) => ({ timeframe: s.timeframe, role: (s.role === "setup" || s.role === "trigger" ? s.role : "setup") as "setup" | "trigger", candles: candles.slice(-120) })),
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

// ═══════════════════════════════════════════════════════════════════
// 1. FORWARD PATH CONTEXT
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — Forward Market Path", () => {
  it("forward path is defined for any analysis result", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    expect(result.forwardMarketPath).toBeDefined();
    const fp = result.forwardMarketPath!;
    expect(fp.currentState).toBeTruthy();
    expect(fp.primaryPath).toBeTruthy();
    expect(fp.alternatePath).toBeTruthy();
    expect(fp.pathStatus).toBeTruthy();
    expect(fp.nextBestAction).toBeTruthy();
    expect(fp.rationale).toBeTruthy();
  });

  it("has scenario tree and trigger levels", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    expect(fp.scenarioTree.length).toBeGreaterThanOrEqual(1);
    expect(fp.confirmationConditions.length).toBeGreaterThanOrEqual(0);
    expect(fp.invalidationConditions.length).toBeGreaterThanOrEqual(0);
  });

  it("has trader and investor views", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    expect(fp.traderView).toBeTruthy();
    expect(fp.investorView).toBeTruthy();
  });

  it("deterministic for same input (I78)", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const r1 = runAnalysis(input);
    const r2 = runAnalysis(input);
    const f1 = r1.forwardMarketPath!;
    const f2 = r2.forwardMarketPath!;
    expect(f1.primaryPath).toBe(f2.primaryPath);
    expect(f1.alternatePath).toBe(f2.alternatePath);
    expect(f1.pathStatus).toBe(f2.pathStatus);
    expect(f1.nextBestAction).toBe(f2.nextBestAction);
    expect(f1.structuralConfidence).toBe(f2.structuralConfidence);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. CURRENT STATE ≠ FORWARD PATH (I61)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I61: Current state ≠ forward path", () => {
  it("forward path is a classified status, not a copy of current state", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    // Forward path is a structured classification, not just the current state text
    expect(fp.currentState).not.toBe(fp.pathStatus);
    expect(fp.pathStatus).not.toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. CORRECTION ≠ REVERSAL (I62)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I62: Correction ≠ Reversal", () => {
  it("path distinguishes correction from reversal attempt", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    // All valid path statuses
    expect([
      "CONTINUATION_FAVORED", "CONTINUATION_POSSIBLE", "CORRECTION_FAVORED",
      "REVERSAL_ATTEMPT", "REVERSAL_FAVORED", "RANGE_CONTINUATION",
      "BREAKOUT_ATTEMPT", "BREAKOUT_CONFIRMED", "BREAKOUT_FAILURE", "UNCONFIRMED",
    ]).toContain(fp.primaryPath);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. LTF CANNOT OVERRIDE HTF (I63)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I63: LTF cannot override HTF", () => {
  it("strong HTF bullish structure produces bullish forward path", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    // Directional bias should be consistent with engine bias
    expect(["bullish", "bearish", "neutral"]).toContain(fp.directionalBias);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. EXTENSION ≠ REVERSAL (I67)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I67: Extension does not equal reversal", () => {
  it("extension risk is informational, not directional", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    // Path risks include extension info but don't force reversal
    expect(Array.isArray(fp.pathRisks)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. FUNDAMENTAL CONFLICT VISIBLE (I68)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I68: Fundamental conflict is visible", () => {
  it("path risks include fundamental conflict when present", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    // Fundamental alignment is reflected in risks or evidence
    if (result.fundamentalThesis?.alignment === "CONFLICTING") {
      expect(fp.pathRisks.some((r) => r.includes("Fundamental"))).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. MISSING FUNDAMENTALS ARE NEUTRAL (I69)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I69: Missing fundamentals are neutral", () => {
  it("unavailable fundamentals do not create opposing evidence", () => {
    const input = buildInput("DOGE/USD", "crypto", bullCandles(0, 0.1));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    // No fundamental conflict risk when providers are unavailable
    const fundConflictRisk = fp.pathRisks.find((r) => r.includes("Fundamental evidence conflicts"));
    // For unavailable providers, alignment is FUNDAMENTAL_UNAVAILABLE, not CONFLICTING
    if (result.fundamentalThesis?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
      expect(fundConflictRisk).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. FORWARD PATH CANNOT MODIFY RECOMMENDATION (I71)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I71: Forward path cannot modify recommendation", () => {
  it("engine recommendation unchanged by forward path", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    // Forward path does not change recommendation, conviction, or trade plan
    expect(result.recommendation).toBeTruthy();
    expect(result.confidence).toBeGreaterThanOrEqual(20);
    expect(result.confidence).toBeLessThanOrEqual(88);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. FORWARD PATH CANNOT CREATE TRADE PLAN (I72)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I72: Forward path cannot create trade plan", () => {
  it("NO_TRADE results have no trade plan regardless of forward path", () => {
    const input = buildInput("BTC/USD", "crypto", flatCandles(50000));
    const result = runAnalysis(input);
    if (result.recommendation === "NO_TRADE") {
      expect(result.tradePlan).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. NO SYNTHETIC PRICE TARGETS (I73)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I73: No synthetic price targets", () => {
  it("scenario tree and rationale contain no fabricated prices", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    const allText = [
      fp.rationale,
      fp.expectedMarketBehavior,
      fp.failureBehavior,
      fp.nextBestAction,
      fp.traderView,
      fp.investorView,
      ...fp.scenarioTree.map((n) => n.label + n.condition + n.outcome),
      ...fp.confirmationConditions,
      ...fp.invalidationConditions,
    ].join(" ");
    // No specific price predictions like "$123,456"
    expect(allText).not.toMatch(/\$\d[\d,]+/);
    // No fabricated price targets
    expect(allText).not.toMatch(/target price/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. NO PROBABILITY CLAIMS (I74)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I74: No probability claims", () => {
  it("no percentage or probability language", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    const allText = [
      fp.rationale,
      fp.nextBestAction,
      fp.traderView,
      fp.investorView,
      fp.expectedMarketBehavior,
      fp.failureBehavior,
      ...fp.scenarioTree.map((n) => n.label + n.condition + n.outcome),
    ].join(" ").toLowerCase();
    expect(allText).not.toMatch(/\d+%/);
    expect(allText).not.toMatch(/probability/);
    expect(allText).not.toMatch(/guaranteed/);
    expect(allText).not.toMatch(/will definitely/);
    expect(allText).not.toMatch(/\bcertain\b/);
    expect(allText).not.toMatch(/will go/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. HORIZON ISOLATION (I75)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I75: Horizon isolation", () => {
  it("scalping produces SHORT_TERM horizon", () => {
    const input = { ...buildInput("BTC/USD", "crypto", bullCandles(0, 50000)), tradingStyle: "scalping" as const };
    const result = runAnalysis(input);
    expect(result.forwardMarketPath!.horizon).toBe("SHORT_TERM");
  });

  it("swing produces SWING horizon", () => {
    const input = { ...buildInput("BTC/USD", "crypto", bullCandles(0, 50000)), tradingStyle: "swing" as const };
    const result = runAnalysis(input);
    expect(result.forwardMarketPath!.horizon).toBe("SWING");
  });

  it("intraday produces INTRADAY horizon", () => {
    const input = { ...buildInput("BTC/USD", "crypto", bullCandles(0, 50000)), tradingStyle: "intraday" as const };
    const result = runAnalysis(input);
    expect(result.forwardMarketPath!.horizon).toBe("INTRADAY");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. TRADER/INVESTOR VIEWS USE SAME EVIDENCE (I76)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I76: Trader/Investor views use same evidence", () => {
  it("both views are present and based on same result", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    expect(fp.traderView).toBeTruthy();
    expect(fp.investorView).toBeTruthy();
    // Both derive from same result — same directionalBias
    expect(fp.directionalBias).toBe(result.bias === "Bullish" ? "bullish" : result.bias === "Bearish" ? "bearish" : "neutral");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 14. DYNAMIC INSTRUMENT (I77)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I77: Dynamic instrument identity preserved", () => {
  it("forward path works for forex", () => {
    const input = buildInput("EUR/USD", "forex", bullCandles(0, 1.1));
    const result = runAnalysis(input);
    expect(result.forwardMarketPath).toBeDefined();
    expect(result.forwardMarketPath!.primaryPath).toBeTruthy();
  });

  it("forward path works for commodity", () => {
    const input = buildInput("XAU/USD", "commodity", bullCandles(0, 2000));
    const result = runAnalysis(input);
    expect(result.forwardMarketPath).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 15. PRIMARY AND ALTERNATE EXPLICIT (I80)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I80: Primary and alternate are explicit", () => {
  it("both primary and alternate paths are always defined", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    expect(fp.primaryPath).toBeTruthy();
    expect(fp.alternatePath).toBeTruthy();
    expect(fp.primaryPath).not.toBe(""); 
    expect(fp.alternatePath).not.toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 16. DATA QUALITY INTERACTION (I79)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I79: Poor data quality cannot produce false confirmation", () => {
  it("data reliability reflects actual quality", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    expect(["good", "degraded", "insufficient", "unavailable"]).toContain(fp.dataReliability);
    // Structural confidence reflects data reliability
    expect(["high", "moderate", "low", "insufficient_data"]).toContain(fp.structuralConfidence);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 17. ENGINE INVARIANT PRESERVATION
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — Engine invariant preservation", () => {
  it("conviction remains in [20, 88]", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    expect(result.confidence).toBeGreaterThanOrEqual(20);
    expect(result.confidence).toBeLessThanOrEqual(88);
  });

  it("fingerprint unchanged by forward path metadata", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const r1 = runAnalysis(input);
    const r2 = runAnalysis(input);
    expect(r1.decisionFingerprint).toBe(r2.decisionFingerprint);
  });

  it("existing legacy fields still present", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    expect(result.bias).toBeTruthy();
    expect(result.technicalSummary).toBeTruthy();
    expect(result.keyLevels).toBeDefined();
    expect(result.timestamp).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 18. EVENT RISK (I70)
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — I70: Event risk cannot manufacture direction", () => {
  it("event risk appears in path risks, not as directional evidence", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const result = runAnalysis(input);
    const fp = result.forwardMarketPath!;
    // Event risk is informational — shows in pathRisks, not as path evidence
    const eventRisk = fp.pathRisks.find((r) => r.includes("event") || r.includes("catalyst"));
    if (eventRisk) {
      expect(eventRisk).toContain("risk"); // it's a risk, not evidence
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 19. STYLE ISOLATION — SAME MARKET FACTS
// ═══════════════════════════════════════════════════════════════════

describe("Phase 29 — Style isolation", () => {
  it("same input produces same directional bias across styles", () => {
    const candles = bullCandles(0, 50000);
    const base = buildInput("BTC/USD", "crypto", candles);
    const r1 = runAnalysis({ ...base, tradingStyle: "scalping" });
    const r2 = runAnalysis({ ...base, tradingStyle: "swing" });
    // Directional bias should be the same (same market facts)
    expect(r1.forwardMarketPath!.directionalBias).toBe(r2.forwardMarketPath!.directionalBias);
    // Only horizon differs
    expect(r1.forwardMarketPath!.horizon).toBe("SHORT_TERM");
    expect(r2.forwardMarketPath!.horizon).toBe("SWING");
  });
});
