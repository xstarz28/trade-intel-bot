/**
 * Phase 143 — Investor Portfolio-Level Aggregation
 *
 * Verifies the deterministic portfolio aggregation layer that consumes the
 * ALREADY-CREATED per-position decision syntheses (Phase 141) and reduces
 * them to ONE categorical portfolio state + structural counts.
 *
 * Domain facts verified against the repository:
 * - Per-position states = ALIGNED | CONFLICT | CAUTION | INSUFFICIENT_DATA |
 *   UNAVAILABLE (Phase 141 decision table R1–R9)
 * - AlertSeverity = NONE | WATCH | CAUTION | HIGH_RISK | INVALIDATED
 * - INVALIDATED thesis/protection always synthesizes to per-position
 *   CONFLICT (Phase 141 R2), so portfolio rule P2 is a strict subset of P3
 * - No authoritative portfolio metric exists → no percentages are produced
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InvestorIntelRow } from "./investor-intelligence-view";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type {
  InvestorMacroContext,
  MacroQuoteView,
  TreasuryRatesView,
} from "./investor-macro-context";
import {
  buildInvestorDecisionSynthesis,
  type InvestorDecisionSynthesis,
} from "./investor-decision-synthesis";
import {
  buildInvestorPortfolioSummary,
  type InvestorPortfolioSummary,
  type PortfolioState,
} from "./investor-portfolio-summary";
import { mapCoverage, mapDecisionState } from "../i18n/enum-mapping";
import en from "../i18n/en";
import id from "../i18n/id";
import es from "../i18n/es";
import pt from "../i18n/pt";
import type { Translations } from "../i18n/types";

// ═══════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════

function makeIntel(instrument: string, overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument,
    displayName: instrument,
    side: "LONG",
    assetClass: "crypto",
    entryPrice: 100,
    currentPrice: 105,
    marketState: "TRENDING_UP",
    shortTermContext: "ctx",
    mediumTermContext: "ctx",
    volatilityContext: "ctx",
    pnlPct: 5,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    severity: "NONE",
    actionRecommendation: "Hold and monitor.",
    evidence: [],
    independentSignalCount: 0,
    confidence: "MODERATE_EVIDENCE",
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [],
    nextMonitor: [],
    dataQuality: "SUFFICIENT",
    observationCount: 25,
    provider: "live",
    sourceMode: "LIVE",
    ...overrides,
  } as PositionIntelligence;
}

function makeRow(overrides: Partial<InvestorIntelRow> = {}): InvestorIntelRow {
  return {
    positionId: "pos-a",
    instrument: "BTC/USD",
    side: "LONG",
    horizon: "SWING",
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    openedAt: 1_700_000_000_000,
    severity: "NONE",
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    intel: makeIntel("BTC/USD"),
    ...overrides,
  };
}

const UNAVAIL_QUOTES: MacroQuoteView[] = (["VIX", "DXY", "US10Y", "WTI"] as const).map(
  (symbol) => ({ symbol, value: null, change24h: null, status: "UNAVAILABLE" as const, provider: null }),
);

function makeQuote(symbol: MacroQuoteView["symbol"], overrides: Partial<MacroQuoteView> = {}): MacroQuoteView {
  return { ...UNAVAIL_QUOTES.find((q) => q.symbol === symbol)!, ...overrides };
}

function makeRates(overrides: Partial<TreasuryRatesView> = {}): TreasuryRatesView {
  return {
    available: false,
    freshness: null,
    observationDate: null,
    rows: [],
    ...overrides,
  };
}

function baseMacro(overrides: Partial<InvestorMacroContext> = {}): InvestorMacroContext {
  return {
    quotes: UNAVAIL_QUOTES,
    rates: makeRates(),
    events: [],
    macroRisk: null,
    hasAnyData: false,
    liveQuoteCount: 0,
    ...overrides,
  };
}

function macroAvailable(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 1,
    quotes: [makeQuote("VIX", { value: 16.4, change24h: -0.2, status: "LIVE", provider: "YahooFinance" }), ...UNAVAIL_QUOTES.slice(1)],
  });
}

function macroUnavailable(): InvestorMacroContext {
  return baseMacro({});
}

/** Builds one per-position synthesis from a row + shared macro context. */
function synth(row: InvestorIntelRow, macro: InvestorMacroContext): InvestorDecisionSynthesis {
  return buildInvestorDecisionSynthesis(row, macro);
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object") {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
    Object.freeze(obj);
  }
  return obj;
}

// ═══════════════════════════════════════════════════════════════
// PRECEDENCE — P1..P7 (STEP 3 of Phase 143)
// ═══════════════════════════════════════════════════════════════

describe("portfolio precedence — P1..P7", () => {
  it("P1 — zero monitored positions → UNAVAILABLE / EMPTY coverage", () => {
    const s = buildInvestorPortfolioSummary([]);
    expect(s.state).toBe("UNAVAILABLE");
    expect(s.totalMonitored).toBe(0);
    expect(s.coverage).toBe("EMPTY");
    expect(s.usableIntelCount).toBe(0);
    expect(s.flags).toContain("EMPTY");
    expect(s.flags).toContain("COVERAGE_EMPTY");
    expect(s.concentration.entries).toEqual([]);
  });

  it("P2 — invalidated thesis is portfolio-relevant → CONFLICT with explicit invalidated count", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "Y", thesisHealth: "INVALIDATED", severity: "INVALIDATED" }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    expect(s.state).toBe("CONFLICT");
    expect(s.invalidatedCount).toBe(1);
    expect(s.protectionCounts.invalidated).toBe(1);
    expect(s.stateCounts.conflict).toBe(1);
    expect(s.flags).toContain("HAS_CONFLICT");
  });

  it("P2 — thesis INVALIDATED alone (normal protection) still counts as invalidated", () => {
    const row = makeRow({ positionId: "p1", instrument: "X", thesisHealth: "INVALIDATED", severity: "NONE" });
    const s = buildInvestorPortfolioSummary([synth(row, macroAvailable())]);
    expect(s.state).toBe("CONFLICT");
    expect(s.invalidatedCount).toBe(1);
    expect(s.protectionCounts.invalidated).toBe(0);
    expect(s.protectionCounts.none).toBe(1);
  });

  it("P3 — healthy-vs-HIGH_RISK per-position CONFLICT drives portfolio CONFLICT", () => {
    const row = makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "HIGH_RISK" });
    const s = buildInvestorPortfolioSummary([synth(row, macroAvailable())]);
    expect(s.state).toBe("CONFLICT");
    expect(s.protectionCounts.highRisk).toBe(1);
  });

  it("P4 — one CAUTION position prevents portfolio ALIGNED", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "Y", thesisHealth: "HEALTHY", severity: "CAUTION" }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    expect(s.state).toBe("CAUTION");
    expect(s.stateCounts.aligned).toBe(1);
    expect(s.stateCounts.caution).toBe(1);
  });

  it("P5 — every monitored position ALIGNED → portfolio ALIGNED with FULL coverage", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "Y", thesisHealth: "STABLE", severity: "WATCH" }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    expect(s.state).toBe("ALIGNED");
    expect(s.coverage).toBe("FULL");
    expect(s.usableIntelCount).toBe(2);
    expect(s.flags).toContain("COVERAGE_FULL");
  });

  it("P5 — all-ALIGNED requires FULL coverage: one UNAVAILABLE breaks it", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "Y", intel: null }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    // P7 fallback — never ALIGNED with partial coverage.
    expect(s.state).toBe("CAUTION");
    expect(s.coverage).toBe("PARTIAL");
    expect(s.stateCounts.aligned).toBe(1);
    expect(s.stateCounts.unavailable).toBe(1);
    expect(s.flags).toContain("COVERAGE_PARTIAL");
  });

  it("P6 — no usable intelligence anywhere → INSUFFICIENT_DATA (macro never manufactures conviction)", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "INSUFFICIENT_DATA", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "Y", intel: null }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    expect(s.state).toBe("INSUFFICIENT_DATA");
    expect(s.usableIntelCount).toBe(0);
    expect(s.coverage).toBe("EMPTY");
  });

  it("P7 — conservative fallback stays CAUTION for mixed partial-coverage portfolios", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "Y", thesisHealth: "INSUFFICIENT_DATA", severity: "NONE" }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    expect(s.state).toBe("CAUTION");
    expect(s.state).not.toBe("ALIGNED");
    expect(s.state).not.toBe("INSUFFICIENT_DATA"); // usable intel exists
  });

  it("P1 dominates macro caution for the empty portfolio; flag still surfaces global caution", () => {
    const s = buildInvestorPortfolioSummary([], baseMacro({ macroRisk: "high", hasAnyData: true }));
    expect(s.state).toBe("UNAVAILABLE"); // P1 wins — nothing to aggregate
    expect(s.globalMacroCaution).toBe(true); // global context echoed, not erased
    expect(s.flags).toContain("GLOBAL_MACRO_CAUTION");
  });

  it("inconsistent input (ALIGNED syntheses + high macro risk) fails conservatively to CAUTION", () => {
    // Syntheses were built with a calm macro context, but the aggregator
    // receives a macro context carrying HIGH global risk. The OR rule must
    // pick the caution up — deterministic, never ALIGNED.
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
    ];
    const syntheses = rows.map((r) => synth(r, macroAvailable()));
    const s = buildInvestorPortfolioSummary(syntheses, baseMacro({ macroRisk: "high", hasAnyData: true }));
    expect(s.state).toBe("CAUTION");
    expect(s.globalMacroCaution).toBe(true);
    expect(s.flags).toContain("GLOBAL_MACRO_CAUTION");
  });
});

// ═══════════════════════════════════════════════════════════════
// MULTI-POSITION ADVERSARIAL SCENARIO (STEP 4 of Phase 143 spec)
// ═══════════════════════════════════════════════════════════════

describe("multi-position portfolio scenario", () => {
  const sharedMacro = macroAvailable();

  function scenarioRows() {
    return [
      makeRow({ positionId: "pos-a", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "pos-b", instrument: "X", thesisHealth: "INSUFFICIENT_DATA", thesisHealthScore: 30, severity: "HIGH_RISK" }),
      makeRow({ positionId: "pos-c", instrument: "Y", thesisHealth: "HEALTHY", severity: "CAUTION" }),
    ];
  }

  function scenarioSummary(rows = scenarioRows()) {
    return buildInvestorPortfolioSummary(rows.map((r) => synth(r, sharedMacro)));
  }

  it("A, B and C derive independent per-position states; portfolio aggregates them", () => {
    const rows = scenarioRows();
    const sA = synth(rows[0], sharedMacro);
    const sB = synth(rows[1], sharedMacro);
    const sC = synth(rows[2], sharedMacro);
    expect(sA.state).toBe("ALIGNED");
    expect(sB.state).toBe("INSUFFICIENT_DATA");
    expect(sC.state).toBe("CAUTION");
    expect(sA.state).not.toBe(sB.state);
    expect(sB.state).not.toBe(sC.state);

    const summary = scenarioSummary();
    expect(summary.totalMonitored).toBe(3);
    expect(summary.stateCounts).toEqual({ aligned: 1, conflict: 0, caution: 1, insufficientData: 1, unavailable: 0 });
    expect(summary.protectionCounts.highRisk).toBe(1);
    expect(summary.state).toBe("CAUTION"); // P4 — C's caution dominates
    expect(summary.coverage).toBe("PARTIAL");
  });

  it("changing B never changes A or C syntheses, and the summary recomputes deterministically", () => {
    const rows = scenarioRows();
    const baselineA = synth(rows[0], sharedMacro);
    const baselineC = synth(rows[2], sharedMacro);
    const baselineSummary = scenarioSummary(rows);

    // B's thesis collapses — protection HIGH_RISK stays (R3 echoes it).
    const mutatedB = { ...rows[1], thesisHealth: "UNKNOWN", thesisHealthScore: 20 };
    const summaryAfter = buildInvestorPortfolioSummary([
      synth(rows[0], sharedMacro),
      synth(mutatedB, sharedMacro),
      synth(rows[2], sharedMacro),
    ]);

    expect(synth(rows[0], sharedMacro)).toEqual(baselineA);
    expect(synth(rows[2], sharedMacro)).toEqual(baselineC);
    expect(summaryAfter.stateCounts.insufficientData).toBe(1);
    expect(summaryAfter.state).toBe("CAUTION");
    // Baseline summary remains intact (pure function — no mutation).
    expect(buildInvestorPortfolioSummary(rows.map((r) => synth(r, sharedMacro)))).toEqual(baselineSummary);
  });

  it("changing GLOBAL macro affects the macro pillar of all positions but never position-specific fields", () => {
    const rows = scenarioRows();
    const good = rows.map((r) => synth(r, macroAvailable()));
    const bad = rows.map((r) => synth(r, macroUnavailable()));

    for (let i = 0; i < 3; i++) {
      expect(bad[i].thesis).toEqual(good[i].thesis);
      expect(bad[i].protection).toEqual(good[i].protection);
      expect(bad[i].macro.status).toBe("UNAVAILABLE");
      expect(good[i].macro.status).toBe("AVAILABLE");
      expect(bad[i].state).not.toBe("ALIGNED");
    }

    const summaryGood = buildInvestorPortfolioSummary(good);
    const summaryBad = buildInvestorPortfolioSummary(bad);
    // Portfolio state may change (A falls from ALIGNED to CAUTION via R6)
    // but the global macro never mutates thesis/protection counts.
    expect(summaryBad.protectionCounts).toEqual(summaryGood.protectionCounts);
    expect(summaryBad.invalidatedCount).toBe(summaryGood.invalidatedCount);
    expect(summaryBad.state).toBe("CAUTION");
  });
});

// ═══════════════════════════════════════════════════════════════
// SAME-INSTRUMENT STRESS (STEP 5 of Phase 143 spec)
// ═══════════════════════════════════════════════════════════════

describe("same-instrument stress — concentration metadata only", () => {
  const macro = macroAvailable();

  it("positions on the same instrument are counted, states stay position-specific", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "BTC/USD", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "BTC/USD", thesisHealth: "DETERIORATING", severity: "CAUTION" }),
      makeRow({ positionId: "p3", instrument: "ETH/USD", thesisHealth: "HEALTHY", severity: "NONE" }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macro)));
    expect(s.concentration.entries).toEqual([{ instrument: "BTC/USD", positionCount: 2 }]);
    expect(s.concentration.distinctInstruments).toBe(2);
    expect(s.state).toBe("CAUTION"); // p2 keeps the portfolio cautious
    expect(s.stateCounts.aligned).toBe(2);
    expect(s.stateCounts.caution).toBe(1);
  });

  it("single positions produce no concentration entries", () => {
    const s = buildInvestorPortfolioSummary([
      synth(makeRow({ positionId: "p1", instrument: "BTC/USD" }), macro),
      synth(makeRow({ positionId: "p2", instrument: "ETH/USD" }), macro),
    ]);
    expect(s.concentration.entries).toEqual([]);
    expect(s.concentration.distinctInstruments).toBe(2);
  });

  it("concentration ordering is deterministic (count desc, then symbol asc)", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "Z" }),
      makeRow({ positionId: "p2", instrument: "A" }),
      makeRow({ positionId: "p3", instrument: "A" }),
      makeRow({ positionId: "p4", instrument: "A" }),
      makeRow({ positionId: "p5", instrument: "Z" }),
    ];
    const s1 = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macro)));
    const s2 = buildInvestorPortfolioSummary([...rows].reverse().map((r) => synth(r, macro)));
    expect(s1.concentration.entries).toEqual(s2.concentration.entries);
    expect(s1.concentration.entries).toEqual([
      { instrument: "A", positionCount: 3 },
      { instrument: "Z", positionCount: 2 },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// IMMUTABILITY & DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("immutability & determinism", () => {
  it("deep-frozen syntheses survive aggregation without mutation", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "HIGH_RISK" }),
      makeRow({ positionId: "p2", instrument: "Y", thesisHealth: "STABLE", severity: "NONE" }),
    ];
    const syntheses = deepFreeze(rows.map((r) => synth(r, macroAvailable())));

    let first: InvestorPortfolioSummary;
    expect(() => {
      first = buildInvestorPortfolioSummary(syntheses);
    }).not.toThrow();

    expect(first!).toEqual(buildInvestorPortfolioSummary(syntheses));
    // p1 = healthy vs HIGH_RISK with AVAILABLE macro → CONFLICT (R4a).
    expect(first!.state).toBe("CONFLICT");
  });

  it("identical inputs → identical output (determinism)", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" }),
      makeRow({ positionId: "p2", instrument: "Y", thesisHealth: "CAUTION", severity: "WATCH" }),
    ];
    const a = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    const b = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════
// ADVERSARIAL — NO FALSE CERTAINTY
// ═══════════════════════════════════════════════════════════════

describe("no false certainty", () => {
  it("no combination fabricates a numerical confidence/probability/percentage", () => {
    const syntheses = [
      synth(makeRow({ positionId: "p1", instrument: "X" }), macroAvailable()),
      synth(makeRow({ positionId: "p2", instrument: "Y", thesisHealth: "DETERIORATING", severity: "HIGH_RISK" }), macroStaleLike()),
      synth(makeRow({ positionId: "p3", instrument: "Z", intel: null }), macroUnavailable()),
    ];
    const summary = buildInvestorPortfolioSummary(syntheses);
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/probability|expectedReturn|winRate|priceTarget|alphaScore|riskReward|%/);
    expect(summary.state).not.toBeUndefined();
    // Counts are counts — they must sum exactly to the monitored total.
    const countTotal =
      summary.stateCounts.aligned +
      summary.stateCounts.conflict +
      summary.stateCounts.caution +
      summary.stateCounts.insufficientData +
      summary.stateCounts.unavailable;
    expect(countTotal).toBe(summary.totalMonitored);
  });

  function macroStaleLike(): InvestorMacroContext {
    return baseMacro({
      hasAnyData: true,
      liveQuoteCount: 0,
      quotes: [makeQuote("DXY", { value: 104.2, status: "STALE", provider: "YahooFinance" }), ...UNAVAIL_QUOTES.filter((q) => q.symbol !== "DXY")],
    });
  }

  it("unknown-but-type-valid per-position states never crash and never produce ALIGNED", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X" }),
      makeRow({ positionId: "p2", instrument: "Y" }),
    ];
    // Type-valid cast simulating a future decision-state token leaking in.
    const syntheses = rows.map((r) => synth(r, macroAvailable()));
    const weird = {
      ...syntheses[0],
      state: "SOME_FUTURE_STATE" as PortfolioState,
    };
    const s = buildInvestorPortfolioSummary([weird, syntheses[1]]);
    expect(["CONFLICT", "CAUTION", "INSUFFICIENT_DATA", "UNAVAILABLE"]).toContain(s.state);
    expect(s.state).not.toBe("ALIGNED");
    expect(s.totalMonitored).toBe(2);
  });

  it("the summary never reinterprets market data — protection severities echo verbatim", () => {
    const rows = [
      makeRow({ positionId: "p1", instrument: "X", severity: "HIGH_RISK", thesisHealth: "STABLE" }),
      makeRow({ positionId: "p2", instrument: "Y", severity: "WATCH", thesisHealth: "HEALTHY" }),
    ];
    const s = buildInvestorPortfolioSummary(rows.map((r) => synth(r, macroAvailable())));
    expect(s.protectionCounts).toEqual({ none: 0, watch: 1, caution: 0, highRisk: 1, invalidated: 0 });
    expect(s.state).toBe("CONFLICT"); // R4a — healthy/stable + HIGH_RISK + fresh macro
  });
});

// ═══════════════════════════════════════════════════════════════
// UI SEMANTIC AUDIT — InvestorWorkspace renders the summary via mappings
// ═══════════════════════════════════════════════════════════════

describe("InvestorWorkspace UI semantic audit (Phase 143)", () => {
  const ui = readFileSync(
    join(process.cwd(), "src/components/InvestorWorkspace.tsx"),
    "utf8",
  );

  it("consumes the portfolio aggregation module", () => {
    expect(ui).toContain("buildInvestorPortfolioSummary");
    expect(ui).toContain("PortfolioSummarySection");
  });

  it("never renders raw portfolio-summary enums directly", () => {
    expect(ui).not.toMatch(/\{summary\.state\}/);
    expect(ui).not.toMatch(/\{summary\.coverage\}/);
    expect(ui).not.toMatch(/\{summary\.protectionCounts/);
    expect(ui).not.toMatch(/\{summary\.stateCounts/);
  });

  it("portfolio displays route through the mapping layer", () => {
    expect(ui).toContain("mapDecisionState(summary.state, t)");
    expect(ui).toContain("mapCoverage(summary.coverage, t)");
    expect(ui).toContain("mapSeverity(");
  });

  it("new labels are i18n keys, not hardcoded English", () => {
    expect(ui).toContain("t.investor.portfolioSummary");
    expect(ui).toContain("t.investor.portfolioState");
    expect(ui).toContain("t.investor.portfolioInfo");
    expect(ui).toContain("t.investor.multiplePositions");
  });

  it("no percentages are rendered (counts only)", () => {
    expect(ui).not.toMatch(/portfolioSummary.*%|%.*portfolioSummary/);
    expect(ui).not.toMatch(/summary\.stateCounts.*\* 100|toFixed.*100/);
  });
});

// ═══════════════════════════════════════════════════════════════
// SOURCE BOUNDARY — aggregation stays pure
// ═══════════════════════════════════════════════════════════════

describe("source boundary — aggregation stays pure", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/position-protection/investor-portfolio-summary.ts"),
    "utf8",
  );

  it("imports only view-model types (no engines/providers/convex)", () => {
    const imports = source
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("import"));
    const modules = imports.map((l) => (l.match(/from\s+"([^"]+)"/) ?? [])[1]).filter(Boolean);
    expect(modules.length).toBeGreaterThan(0);
    for (const m of modules) {
      expect(["./investor-decision-synthesis", "./investor-macro-context"]).toContain(m);
    }
    expect(source).not.toMatch(/convex|useAction|fetchCandles|fetchLiveQuotes|generatePortfolioIntelligence/);
  });

  it("contains no numerical fabrication tokens (code only, comments excluded)", () => {
    const code = source
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/") && !t.startsWith("//");
      })
      .join("\n");
    expect(code).not.toMatch(/%|probability|expectedReturn|priceTarget|winRate|alphaScore|riskReward/);
  });
});

// ═══════════════════════════════════════════════════════════════
// I18N PARITY — new keys + mapCoverage across EN/ID/ES/PT
// ═══════════════════════════════════════════════════════════════

describe("i18n parity — Phase 143 investor portfolio keys", () => {
  const LOCALES: Record<string, Translations> = { en, id, es, pt };
  const KEYS = [
    "portfolioSummary",
    "portfolioState",
    "usableIntel",
    "insufficientIntel",
    "unavailableIntel",
    "concentration",
    "multiplePositions",
    "portfolioInfo",
    "globalMacroCaution",
  ] as const;

  it("every new key exists and is non-empty in all four locales", () => {
    for (const locale of Object.values(LOCALES)) {
      for (const key of KEYS) {
        const value = (locale.investor as Record<string, string>)[key];
        expect(typeof value).toBe("string");
        expect((value ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("mapCoverage resolves FULL/PARTIAL/EMPTY in every locale (never blank)", () => {
    for (const locale of Object.values(LOCALES)) {
      for (const value of ["FULL", "PARTIAL", "EMPTY"]) {
        const label = mapCoverage(value, locale);
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toContain("{");
      }
    }
  });

  it("mapCoverage semantics are stable", () => {
    expect(mapCoverage("FULL", en)).toBe(en.status.available);
    expect(mapCoverage("PARTIAL", id)).toBe(id.status.limited);
    expect(mapCoverage("EMPTY", es)).toBe(es.status.unavailable);
    expect(mapCoverage("EMPTY", pt)).toBe(pt.status.unavailable);
  });

  it("mapCoverage handles unknown values safely (no blank, no crash)", () => {
    for (const locale of Object.values(LOCALES)) {
      const label = mapCoverage("SOME_FUTURE_COVERAGE", locale);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("decision-state labels used by the summary stay resolvable in all locales", () => {
    for (const locale of Object.values(LOCALES)) {
      for (const state of ["ALIGNED", "CONFLICT", "CAUTION", "INSUFFICIENT_DATA", "UNAVAILABLE"]) {
        const label = mapDecisionState(state, locale);
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});