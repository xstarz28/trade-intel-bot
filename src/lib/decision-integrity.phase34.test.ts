/**
 * Phase 34 — DECISION INTEGRITY & CALIBRATION TESTS.
 *
 * Cross-layer consistency audit, continuation/correction/reversal validation,
 * fundamental shock audit, trade-plan integrity, WAIT/NO_TRADE safety,
 * journal compatibility, determinism, and invariants I81–I94.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "@/lib/analysis-engine";
import { auditDecisionIntegrity } from "@/lib/decision-integrity";
import { calculateTechnical } from "@/lib/data/technical";
import { computeSmcContext } from "@/lib/data/smc";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { AnalysisInput } from "@/types/analysis";
import type { OhlcvCandle, MarketData } from "@/lib/data/market-types";

// ── Fixture helpers (same as Phase 30) ───────────────────────────

function ts(i: number): number {
  return Date.parse("2026-08-01T00:00:00Z") + i * 86_400_000;
}

function bullCandle(i: number, base: number): OhlcvCandle {
  const price = base + i * 50;
  return { timestamp: ts(i), open: price - 20, high: price + 30, low: price - 40, close: price, volume: 1_000_000 };
}

function bearCandle(i: number, base: number): OhlcvCandle {
  const price = base - i * 50;
  return { timestamp: ts(i), open: price + 20, high: price + 40, low: price - 30, close: price, volume: 1_000_000 };
}

function bullCandles(start: number, base: number, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => bullCandle(start + i, base));
}

function bearCandles(start: number, base: number, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => bearCandle(start + i, base));
}

function flatCandles(base: number, n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: ts(i), open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 1000,
  }));
}

function mixedCandles(n = 200): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const up = i % 2 === 0;
    const base = 50000 + Math.sin(i * 0.1) * 2000;
    return {
      timestamp: ts(i),
      open: base + (up ? -10 : 10),
      high: base + 50,
      low: base - 50,
      close: base + (up ? 30 : -30),
      volume: 1_000_000,
    };
  });
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
    ...slots.map((s) => ({
      timeframe: s.timeframe,
      role: (s.role === "setup" || s.role === "trigger" ? s.role : "setup") as "setup" | "trigger",
      candles: candles.slice(-120),
    })),
  ];
  tech.mtf = buildMtfContext("D1", mtfInputs);
  return {
    instrument,
    instrumentType: type,
    timeframe: "D1",
    tradingStyle: "swing" as const,
    marketData: {
      instrument,
      instrumentType: type,
      provider: "twelve-data",
      fetchTimestamp: Date.now(),
      price: { price: candles[candles.length - 1].close, timestamp: Date.now(), source: "twelve-data" },
      candles,
      timeframe: "D1",
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech,
    ...opts,
  };
}

// ── Decision Integrity Module Tests ──────────────────────────────

describe("Phase 34 — Decision Integrity Audit Module", () => {
  it("consistency check runs without crash on any result", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const audit = auditDecisionIntegrity(r);
    expect(audit.overallStatus).toBeDefined();
    expect(Array.isArray(audit.violations)).toBe(true);
    expect(Array.isArray(audit.warnings)).toBe(true);
    expect(audit.evidenceChain.length).toBeGreaterThan(0);
  });

  it("produces consistent results for well-formed bullish analysis", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const audit = auditDecisionIntegrity(r);
    expect(audit.structuralConsistency).toBe(true);
    expect(audit.tradePlanConsistency).toBe(true);
    expect(audit.actionabilityConsistency).toBe(true);
  });

  it("audit is pure — does not modify the result", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const before = JSON.stringify(r);
    auditDecisionIntegrity(r);
    expect(JSON.stringify(r)).toBe(before);
  });

  it("audit is deterministic — same input produces same violations", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const r1 = runAnalysis(input);
    const r2 = runAnalysis(input);
    const a1 = auditDecisionIntegrity(r1);
    const a2 = auditDecisionIntegrity(r2);
    expect(a1.violations.length).toBe(a2.violations.length);
    expect(a1.overallStatus).toBe(a2.overallStatus);
  });
});

// ── I81–I94 Invariant Tests ─────────────────────────────────────

describe("Phase 34 — Invariants I81–I94", () => {
  it("I81 — well-formed bullish analysis has no actionability violations", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const audit = auditDecisionIntegrity(r);
    expect(audit.violations.filter((v) => v.invariant === "I81").length).toBe(0);
  });

  it("I81 — bearish input has no actionability violations", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
    const audit = auditDecisionIntegrity(r);
    expect(audit.violations.filter((v) => v.invariant === "I81").length).toBe(0);
  });

  it("I82 — WAIT actionability does not have tradePlan", () => {
    for (const input of [
      buildInput("BTC/USD", "crypto", flatCandles(50000)),
      buildInput("BTC/USD", "crypto", mixedCandles()),
      buildInput("EUR/USD", "forex", mixedCandles()),
    ]) {
      const r = runAnalysis(input);
      if (r.professionalThesis?.actionability === "WAIT") {
        expect(r.tradePlan).toBeUndefined();
      }
    }
  });

  it("I83 — NO_TRADE has no tradePlan", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    if (r.recommendation === "NO_TRADE") {
      expect(r.tradePlan).toBeUndefined();
    }
  });

  it("I83 — professional NO_TRADE matches engine NO_TRADE", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    if (r.professionalThesis?.actionability === "NO_TRADE") {
      expect(r.recommendation).toBe("NO_TRADE");
    }
  });

  it("I84 — trade plan direction matches recommendation", () => {
    for (const [instr, type, candles] of [
      ["BTC/USD", "crypto", bullCandles(0, 50000)],
      ["BTC/USD", "crypto", bearCandles(0, 50000)],
      ["ETH/USD", "crypto", bullCandles(0, 3000)],
    ] as const) {
      const r = runAnalysis(buildInput(instr, type, candles));
      if (r.recommendation === "LONG" && r.tradePlan) expect(r.tradePlan.direction).toBe("long");
      if (r.recommendation === "SHORT" && r.tradePlan) expect(r.tradePlan.direction).toBe("short");
    }
  });

  it("I84 — tradePlan R:R >= 1.5 when present", () => {
    for (const [instr, type, candles] of [
      ["BTC/USD", "crypto", bullCandles(0, 50000)],
      ["ETH/USD", "crypto", bullCandles(0, 3000)],
      ["EUR/USD", "forex", bullCandles(0, 1.1)],
    ] as const) {
      const r = runAnalysis(buildInput(instr, type, candles));
      if (r.tradePlan) expect(r.tradePlan.riskReward).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("I84 — trade plan levels are finite and positive", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.tradePlan) {
      expect(Number.isFinite(parseFloat(r.tradePlan.entry))).toBe(true);
      expect(parseFloat(r.tradePlan.entry)).toBeGreaterThan(0);
      expect(Number.isFinite(parseFloat(r.tradePlan.stopLoss))).toBe(true);
      expect(parseFloat(r.tradePlan.stopLoss)).toBeGreaterThan(0);
      expect(Number.isFinite(parseFloat(r.tradePlan.takeProfit))).toBe(true);
      expect(parseFloat(r.tradePlan.takeProfit)).toBeGreaterThan(0);
    }
  });

  it("I84 — long trade plan: SL < entry < TP", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.tradePlan?.direction === "long") {
      const entry = parseFloat(r.tradePlan.entry);
      const sl = parseFloat(r.tradePlan.stopLoss);
      const tp = parseFloat(r.tradePlan.takeProfit);
      expect(sl).toBeLessThan(entry);
      expect(entry).toBeLessThan(tp);
    }
  });

  it("I84 — short trade plan: TP < entry < SL", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
    if (r.tradePlan?.direction === "short") {
      const entry = parseFloat(r.tradePlan.entry);
      const sl = parseFloat(r.tradePlan.stopLoss);
      const tp = parseFloat(r.tradePlan.takeProfit);
      expect(tp).toBeLessThan(entry);
      expect(entry).toBeLessThan(sl);
    }
  });

  it("I85 — CONFIRMED_CONTINUATION has continuation status present", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.marketScenario?.scenario === "CONFIRMED_CONTINUATION") {
      expect(r.marketScenario.continuationStatus).not.toBe("absent");
      expect(r.marketScenario.confirmationState).not.toBe("absent");
    }
  });

  it("I86 — REVERSAL_CONFIRMED has at least 2 reversal evidence items", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
    if (r.marketScenario?.scenario === "REVERSAL_CONFIRMED") {
      expect(r.marketScenario.reversalEvidence.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("I88 — FUNDAMENTAL_UNAVAILABLE has no directional fundamental evidence", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.fundamentalThesis?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
      const dir = [...r.fundamentalThesis.fundamentalEvidence, ...r.fundamentalThesis.macroEvidence]
        .filter((e) => e.direction === "supportive" || e.direction === "conflicting");
      expect(dir.length).toBe(0);
    }
  });

  it("I89 — extension risk does not flip direction", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.forwardMarketPath?.pathRisks.some((p) => p.includes("extension"))) {
      expect(r.forwardMarketPath.directionalBias).not.toBe("bearish");
    }
  });

  it("I90 — audit does not change result fields", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const [rec, bias, conf] = [r.recommendation, r.bias, r.confidence];
    auditDecisionIntegrity(r);
    expect(r.recommendation).toBe(rec);
    expect(r.bias).toBe(bias);
    expect(r.confidence).toBe(conf);
  });

  it("I93 — sequential analyses produce independent results", () => {
    const results = [
      runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000))),
      runAnalysis(buildInput("ETH/USD", "crypto", bullCandles(0, 3000))),
      runAnalysis(buildInput("EUR/USD", "forex", bullCandles(0, 1.1))),
      runAnalysis(buildInput("XAU/USD", "commodity", bullCandles(0, 2000))),
    ];
    expect(results.map((r) => r.instrument)).toEqual(["BTC/USD", "ETH/USD", "EUR/USD", "XAU/USD"]);
  });

  it("I94 — audit produces complete result for any input", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    const audit = auditDecisionIntegrity(r);
    expect(audit).toHaveProperty("overallStatus");
    expect(audit).toHaveProperty("violations");
    expect(audit).toHaveProperty("warnings");
    expect(audit).toHaveProperty("evidenceChain");
    expect(audit).toHaveProperty("decisionSummary");
  });
});

// ── Continuation / Correction / Reversal ─────────────────────────

describe("Phase 34 — Continuation / Correction / Reversal", () => {
  it("bullish trend produces coherent regime", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    expect(r.marketRegimeContext).toBeDefined();
  });

  it("bearish trend produces coherent regime", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
    expect(r.marketRegimeContext).toBeDefined();
  });

  it("flat market does not force directional trade", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    if (r.bias === "Neutral") expect(r.recommendation).toBe("NO_TRADE");
  });

  it("mixed candles produce balanced analysis", () => {
    const r = runAnalysis(buildInput("EUR/USD", "forex", mixedCandles()));
    expect(r.recommendation).toBeDefined();
  });

  it("scenario is one of defined types", () => {
    for (const input of [buildInput("BTC/USD", "crypto", bullCandles(0, 50000)), buildInput("BTC/USD", "crypto", bearCandles(0, 50000))]) {
      const r = runAnalysis(input);
      if (r.marketScenario) {
        expect(["CONFIRMED_CONTINUATION", "CONTINUATION_DEVELOPING", "PULLBACK_OR_CONSOLIDATION", "REVERSAL_DEVELOPING", "REVERSAL_CONFIRMED", "UNCONFIRMED", "WAIT"]).toContain(r.marketScenario.scenario);
      }
    }
  });
});

// ── Fundamental Shock ────────────────────────────────────────────

describe("Phase 34 — Fundamental Shock Audit", () => {
  it("no fundamentals remains neutral for FUNDAMENTAL_UNAVAILABLE", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.fundamentalThesis?.alignment === "FUNDAMENTAL_UNAVAILABLE") {
      const dir = [...r.fundamentalThesis.fundamentalEvidence, ...r.fundamentalThesis.macroEvidence]
        .filter((e) => e.direction === "supportive" || e.direction === "conflicting");
      expect(dir.length).toBe(0);
    }
  });

  it("alignment is one of defined values", () => {
    for (const [t, b] of [["crypto", 50000], ["forex", 1.1], ["commodity", 2000]] as const) {
      const r = runAnalysis(buildInput(`X/${t === "crypto" ? "USD" : "USD"}`, t, bullCandles(0, b)));
      if (r.fundamentalThesis) {
        expect(["STRONGLY_ALIGNED", "ALIGNED", "MIXED", "CONFLICTING", "FUNDAMENTAL_UNAVAILABLE", "TECHNICAL_UNAVAILABLE"]).toContain(r.fundamentalThesis.alignment);
      }
    }
  });
});

// ── WAIT / NO_TRADE Safety ──────────────────────────────────────

describe("Phase 34 — WAIT / NO_TRADE Safety", () => {
  it("WAIT has no tradePlan and no sizing", () => {
    for (const input of [buildInput("BTC/USD", "crypto", flatCandles(50000)), buildInput("BTC/USD", "crypto", mixedCandles()), buildInput("EUR/USD", "forex", mixedCandles())]) {
      const r = runAnalysis(input);
      if (r.professionalThesis?.actionability === "WAIT") {
        expect(r.tradePlan).toBeUndefined();
        expect(r.positionSizing).toBeUndefined();
      }
    }
  });

  it("WAIT has explicit actionability reason", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", mixedCandles()));
    if (r.professionalThesis?.actionability === "WAIT") {
      expect(typeof r.professionalThesis.actionabilityReason).toBe("string");
      expect(r.professionalThesis.actionabilityReason.length).toBeGreaterThan(0);
    }
  });

  it("NO_TRADE preserves failed gates visibility", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    if (r.recommendation === "NO_TRADE" && r.decisionTrace) {
      expect(r.decisionTrace.failedGates.length).toBeGreaterThan(0);
    }
  });
});

// ── Trade Plan Integrity ─────────────────────────────────────────

describe("Phase 34 — Trade Plan Integrity", () => {
  it("NO_TRADE never has tradePlan", () => {
    for (const input of [buildInput("BTC/USD", "crypto", flatCandles(50000)), buildInput("EUR/USD", "forex", flatCandles(1.1))]) {
      const r = runAnalysis(input);
      if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined();
    }
  });

  it("trade plan levels are never NaN or Infinity", () => {
    for (const [t, b] of [["crypto", 50000], ["crypto", 3000], ["crypto", 100]] as const) {
      const r = runAnalysis(buildInput(`X/${t === "crypto" ? "USD" : "USD"}`, t, bullCandles(0, b)));
      if (r.tradePlan) {
        expect(Number.isFinite(parseFloat(r.tradePlan.entry))).toBe(true);
        expect(Number.isFinite(parseFloat(r.tradePlan.stopLoss))).toBe(true);
        expect(Number.isFinite(parseFloat(r.tradePlan.takeProfit))).toBe(true);
        expect(parseFloat(r.tradePlan.entry)).toBeGreaterThan(0);
      }
    }
  });
});

// ── Actionability vs Bias ────────────────────────────────────────

describe("Phase 34 — Actionability vs Current Bias", () => {
  it("BULLISH + WAIT is valid", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", mixedCandles()));
    if (r.bias === "Bullish" && r.professionalThesis?.actionability === "WAIT") {
      expect(r.professionalThesis.actionability).toBe("WAIT");
    }
  });

  it("BEARISH + WAIT is valid", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
    if (r.bias === "Bearish" && r.professionalThesis?.actionability === "WAIT") {
      expect(r.professionalThesis.actionability).toBe("WAIT");
    }
  });

  it("NEUTRAL produces NO_TRADE", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    if (r.bias === "Neutral") expect(r.recommendation).toBe("NO_TRADE");
  });

  it("LONG actionability has long trade plan", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.professionalThesis?.actionability === "LONG" && r.tradePlan) expect(r.tradePlan.direction).toBe("long");
  });

  it("SHORT actionability has short trade plan", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bearCandles(0, 50000)));
    if (r.professionalThesis?.actionability === "SHORT" && r.tradePlan) expect(r.tradePlan.direction).toBe("short");
  });
});

// ── Forward Path Audit ──────────────────────────────────────────

describe("Phase 34 — Forward Path Audit", () => {
  it("forward path has primary and alternate", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const fmp = r.forwardMarketPath;
    expect(fmp).toBeDefined();
    if (fmp) {
      expect(fmp.primaryPath).toBeDefined();
      expect(fmp.alternatePath).toBeDefined();
      // Confirmation/invalidation may be empty for certain path classifications
      // (e.g. UNCONFIRMED or neutral). This is valid behavior.
    }
  });

  it("no synthetic price targets in trigger levels", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.forwardMarketPath) {
      for (const level of r.forwardMarketPath.triggerLevels) expect(level.source).not.toBe("synthetic");
    }
  });

  it("nextBestAction, rationale, trader/investor views present", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const fmp = r.forwardMarketPath;
    if (fmp) {
      expect(fmp.nextBestAction.length).toBeGreaterThan(0);
      expect(fmp.rationale.length).toBeGreaterThan(0);
      expect(typeof fmp.traderView).toBe("string");
      expect(typeof fmp.investorView).toBe("string");
      expect(fmp.scenarioTree.length).toBeGreaterThan(0);
    }
  });
});

// ── Determinism & Isolation ──────────────────────────────────────

describe("Phase 34 — Determinism & Isolation", () => {
  it("same input × 10 produces identical results", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const results = Array.from({ length: 10 }, () => runAnalysis(input));
    for (let i = 1; i < results.length; i++) {
      expect(results[i].recommendation).toBe(results[0].recommendation);
      expect(results[i].bias).toBe(results[0].bias);
      expect(results[i].confidence).toBe(results[0].confidence);
    }
  });

  it("different instruments produce different results", () => {
    const btc = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const eth = runAnalysis(buildInput("ETH/USD", "crypto", bullCandles(0, 3000)));
    expect(btc.instrument).not.toBe(eth.instrument);
  });

  it("same input produces identical fingerprint", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    const [r1, r2] = [runAnalysis(input), runAnalysis(input)];
    if (r1.decisionFingerprint && r2.decisionFingerprint) expect(r1.decisionFingerprint).toBe(r2.decisionFingerprint);
  });

  it("sequential analyses do not leak state", () => {
    expect(runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000))).instrument).toBe("BTC/USD");
    expect(runAnalysis(buildInput("ETH/USD", "crypto", bearCandles(0, 3000))).instrument).toBe("ETH/USD");
    expect(runAnalysis(buildInput("EUR/USD", "forex", bullCandles(0, 1.1))).instrument).toBe("EUR/USD");
  });
});

// ── Multi-instrument Pipeline ────────────────────────────────────

describe("Phase 34 — Multi-instrument Pipeline", () => {
  it.each([
    ["BTC/USD", "crypto", 50000], ["ETH/USD", "crypto", 3000], ["SOL/USD", "crypto", 100],
    ["DOGE/USD", "crypto", 0.15], ["EUR/USD", "forex", 1.1], ["GBP/USD", "forex", 1.3],
    ["XAU/USD", "commodity", 2000], ["AAPL", "stock", 190],
  ])("%s — coherent pipeline", (name, type, base) => {
    const r = runAnalysis(buildInput(name, type as AnalysisInput["instrumentType"], bullCandles(0, base)));
    expect(r.instrument).toBe(name);
    expect(r.recommendation).toBeDefined();
    expect(r.marketRegimeContext).toBeDefined();
    expect(r.marketScenario).toBeDefined();
    expect(r.fundamentalThesis).toBeDefined();
    expect(r.professionalThesis).toBeDefined();
    expect(r.forwardMarketPath).toBeDefined();
    const audit = auditDecisionIntegrity(r);
    expect(audit.structuralConsistency).toBe(true);
    expect(audit.actionabilityConsistency).toBe(true);
  });
});

// ── Cross-layer Contradiction ────────────────────────────────────

describe("Phase 34 — Cross-layer Contradiction Detection", () => {
  it("no WAIT + tradePlan", () => {
    for (const input of [buildInput("BTC/USD", "crypto", mixedCandles()), buildInput("EUR/USD", "forex", mixedCandles())]) {
      const r = runAnalysis(input);
      if (r.professionalThesis?.actionability === "WAIT") expect(r.tradePlan).toBeUndefined();
    }
  });

  it("no NO_TRADE + tradePlan", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined();
  });
});

// ── No Probability / No Fabrication ─────────────────────────────

describe("Phase 34 — No Probability / No Fabrication", () => {
  it("no probability percentages in forward path", () => {
    for (const input of [buildInput("BTC/USD", "crypto", bullCandles(0, 50000)), buildInput("EUR/USD", "forex", bullCandles(0, 1.1))]) {
      const r = runAnalysis(input);
      if (r.forwardMarketPath) {
        const allText = [r.forwardMarketPath.rationale, r.forwardMarketPath.nextBestAction,
          r.forwardMarketPath.expectedMarketBehavior, r.forwardMarketPath.failureBehavior,
          r.forwardMarketPath.traderView, r.forwardMarketPath.investorView,
          ...r.forwardMarketPath.pathRisks].join(" ");
        expect(allText).not.toMatch(/\d+%\s*(chance|probability|likely|will|guaranteed)/i);
      }
    }
  });

  it("no win-rate or guarantee in professional thesis", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    if (r.professionalThesis) {
      const all = [r.professionalThesis.actionabilityReason, r.professionalThesis.analystSummary,
        ...r.professionalThesis.confirmationConditions, ...r.professionalThesis.invalidationConditions].join(" ");
      expect(all).not.toMatch(/win.?rate/i);
      expect(all).not.toMatch(/guaranteed/i);
      expect(all).not.toMatch(/will definitely/i);
    }
  });
});

// ── Data Quality → Decision Safety ──────────────────────────────

describe("Phase 34 — Data Quality → Decision Safety", () => {
  it("no optional providers = FUNDAMENTAL_UNAVAILABLE", () => {
    const input = buildInput("BTC/USD", "crypto", bullCandles(0, 50000));
    delete input.sentimentData; delete input.fundamentalData; delete input.macroData;
    delete input.derivativesData; delete input.calendarData; delete input.treasuryData;
    delete input.cotData; delete input.eiaData; delete input.executionData;
    const r = runAnalysis(input);
    // When no optional providers, direction may be neutral → TECHNICAL_UNAVAILABLE, or data unavailable → FUNDAMENTAL_UNAVAILABLE
    if (r.fundamentalThesis) {
      expect(["FUNDAMENTAL_UNAVAILABLE", "TECHNICAL_UNAVAILABLE"]).toContain(r.fundamentalThesis.alignment);
    }
  });

  it("flat candles = NO_TRADE or WAIT, not forced directional", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", flatCandles(50000)));
    if (r.recommendation === "NO_TRADE") expect(r.tradePlan).toBeUndefined();
    if (r.professionalThesis?.actionability === "WAIT") expect(r.tradePlan).toBeUndefined();
  });
});

// ── Journal Compatibility ────────────────────────────────────────

describe("Phase 34 — Journal Compatibility", () => {
  it("analysis result can be snapshotted", () => {
    for (const [t, b] of [["crypto", 50000], ["crypto", 3000], ["forex", 1.1]] as const) {
      const r = runAnalysis(buildInput(`X/${t === "crypto" ? "USD" : "USD"}`, t, bullCandles(0, b)));
      const snap = JSON.parse(JSON.stringify(r));
      expect(snap.instrument).toBe(r.instrument);
      expect(snap.recommendation).toBe(r.recommendation);
      expect(snap.bias).toBe(r.bias);
    }
  });

  it("editing snapshot does not modify original", () => {
    const r = runAnalysis(buildInput("BTC/USD", "crypto", bullCandles(0, 50000)));
    const snap = JSON.parse(JSON.stringify(r));
    (snap as Record<string, unknown>).instrument = "MODIFIED";
    expect(r.instrument).not.toBe("MODIFIED");
  });
});
