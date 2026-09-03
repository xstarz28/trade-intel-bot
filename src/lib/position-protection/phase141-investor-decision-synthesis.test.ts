/**
 * Phase 141 — Investor Decision Synthesis Tests
 *
 * The synthesis is a pure, deterministic PRESENTATION layer over existing
 * evidence. These tests prove:
 * - conflict-aware outcomes (healthy thesis vs HIGH_RISK protection is never
 *   collapsed into "healthy")
 * - insufficient thesis dominates and macro never manufactures conviction
 * - protection risk is preserved when macro is unavailable/stale
 * - stale macro never yields a "fully confirmed" (ALIGNED) picture
 * - positionId isolation (incl. same-instrument positions)
 * - macro context stays global (never position-specific)
 * - determinism and purity (no analyzer/provider invocation)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InvestorIntelRow } from "./investor-intelligence-view";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { InvestorMacroContext, MacroQuoteView } from "./investor-macro-context";
import {
  buildInvestorDecisionSynthesis,
  type DecisionState,
} from "./investor-decision-synthesis";

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
    shortTermContext: "context",
    mediumTermContext: "context",
    volatilityContext: "context",
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

function baseMacro(overrides: Partial<InvestorMacroContext> = {}): InvestorMacroContext {
  return {
    quotes: UNAVAIL_QUOTES,
    rates: { available: false, freshness: null, observationDate: null, rows: [] },
    events: [],
    macroRisk: null,
    hasAnyData: false,
    liveQuoteCount: 0,
    ...overrides,
  };
}

/** Macro with one LIVE quote — status AVAILABLE. */
function macroAvailable(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 1,
    quotes: [
      { symbol: "VIX", value: 16.4, change24h: -0.2, status: "LIVE", provider: "YahooFinance" },
      ...UNAVAIL_QUOTES.slice(1),
    ],
  });
}

/** Macro with only a STALE quote — status STALE. */
function macroStale(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 0,
    quotes: [
      { symbol: "VIX", value: null, change24h: null, status: "UNAVAILABLE", provider: null },
      { symbol: "DXY", value: 104.2, change24h: null, status: "STALE", provider: "YahooFinance" },
      ...UNAVAIL_QUOTES.slice(2),
    ],
  });
}

/** Macro with only upcoming events — status LIMITED. */
function macroLimitedEvents(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 0,
    events: [
      { event: "FOMC Rate Decision", currency: "USD", country: "United States", datetime: Date.now() + 86_400_000, importance: 3 },
    ],
  });
}

/** No macro evidence at all — status UNAVAILABLE. */
function macroUnavailable(): InvestorMacroContext {
  return baseMacro({});
}

/** Available macro + calendar-derived global macro risk HIGH. */
function macroCaution(): InvestorMacroContext {
  return { ...macroAvailable(), macroRisk: "high" };
}

// ═══════════════════════════════════════════════════════════════
// DECISION TABLE OUTCOMES
// ═══════════════════════════════════════════════════════════════

describe("synthesis — conflict-aware decision states", () => {
  it("1. healthy thesis + low protection + available macro → ALIGNED", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroAvailable());
    expect(s.state).toBe("ALIGNED");
    expect(s.flags).toContain("THESIS_HEALTHY");
    expect(s.flags).toContain("PROTECTION_NONE");
    expect(s.flags).toContain("MACRO_AVAILABLE");
    expect(s.flags).not.toContain("GLOBAL_MACRO_CAUTION");
  });

  it("2. healthy thesis + HIGH_RISK protection → CONFLICT, never simply healthy", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ severity: "HIGH_RISK", thesisHealth: "HEALTHY" }),
      macroAvailable(),
    );
    expect(s.state).toBe("CONFLICT");
    expect(s.state).not.toBe("ALIGNED");
    expect(s.protection.severity).toBe("HIGH_RISK");
    expect(s.flags).toContain("PROTECTION_HIGH_RISK");
    // The conflict is explicit — the two domain chips still disagree.
    expect(s.thesis.health).toBe("HEALTHY");
  });

  it("3. healthy thesis + cautionary GLOBAL macro → CAUTION with global flag", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroCaution());
    expect(s.state).toBe("CAUTION");
    expect(s.flags).toContain("GLOBAL_MACRO_CAUTION");
    expect(s.macro.globalCaution).toBe(true);
    expect(s.macro.status).toBe("AVAILABLE");
  });

  it("4. insufficient thesis + supportive/available macro → INSUFFICIENT_DATA dominates", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ thesisHealth: "INSUFFICIENT_DATA", thesisHealthScore: 40, intel: makeIntel("BTC/USD", { dataQuality: "INSUFFICIENT" }) }),
      macroAvailable(),
    );
    expect(s.state).toBe("INSUFFICIENT_DATA");
    expect(s.state).not.toBe("ALIGNED");
    expect(s.thesis.limited).toBe(true);
    expect(s.flags).toContain("THESIS_INSUFFICIENT");
    // Macro presence must not fabricate conviction.
    expect(s.flags).toContain("MACRO_AVAILABLE");
  });

  it("5. HIGH_RISK protection + unavailable macro → protection risk preserved, macro unavailable", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ severity: "HIGH_RISK", thesisHealth: "STABLE" }),
      macroUnavailable(),
    );
    expect(s.state).toBe("CAUTION");
    expect(s.protection.severity).toBe("HIGH_RISK");
    expect(s.flags).toContain("PROTECTION_HIGH_RISK");
    expect(s.macro.status).toBe("UNAVAILABLE");
    expect(s.flags).toContain("MACRO_UNAVAILABLE");
  });

  it("6. stale macro + healthy thesis → CAUTION, never fully confirmed", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroStale());
    expect(s.state).toBe("CAUTION");
    expect(s.state).not.toBe("ALIGNED");
    expect(s.macro.status).toBe("STALE");
    expect(s.flags).toContain("MACRO_STALE");
  });

  it("7. unavailable PositionIntelligence → UNAVAILABLE result", () => {
    const s = buildInvestorDecisionSynthesis(makeRow({ intel: null }), macroAvailable());
    expect(s.state).toBe("UNAVAILABLE");
    expect(s.flags).toContain("INTEL_UNAVAILABLE");
    expect(s.dataQuality.intelQuality).toBeNull();
    // Protection state is still preserved independently.
    expect(s.protection.severity).toBe("NONE");
  });

  it("R2: invalidated thesis/protection → CONFLICT even with good macro", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ thesisHealth: "INVALIDATED", severity: "INVALIDATED" }),
      macroAvailable(),
    );
    expect(s.state).toBe("CONFLICT");
  });

  it("R4b/R6 precedence: HIGH_RISK beats macro staleness into CAUTION", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ severity: "HIGH_RISK", thesisHealth: "HEALTHY" }),
      macroStale(),
    );
    expect(s.state).toBe("CAUTION");
    expect(s.protection.severity).toBe("HIGH_RISK");
    expect(s.macro.status).toBe("STALE");
  });

  it("R5: deteriorating thesis with limited macro → CAUTION", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ thesisHealth: "DETERIORATING" }),
      macroLimitedEvents(),
    );
    expect(s.state).toBe("CAUTION");
    expect(s.macro.status).toBe("LIMITED");
  });

  it("R8: limited macro (events only) still allows ALIGNED when thesis/protection are clean", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroLimitedEvents());
    expect(s.state).toBe("ALIGNED");
    expect(s.macro.eventCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// POSITION ISOLATION + GLOBAL MACRO SCOPE
// ═══════════════════════════════════════════════════════════════

describe("synthesis — position isolation & global macro scope", () => {
  it("8. position A and B never exchange position-specific evidence", () => {
    const rowA = makeRow({
      positionId: "pos-a",
      instrument: "BTC/USD",
      thesisHealth: "HEALTHY",
      thesisHealthScore: 85,
      severity: "NONE",
    });
    const rowB = makeRow({
      positionId: "pos-b",
      instrument: "ETH/USD",
      thesisHealth: "DETERIORATING",
      thesisHealthScore: 45,
      severity: "HIGH_RISK",
    });
    const macro = macroAvailable();
    const sA = buildInvestorDecisionSynthesis(rowA, macro);
    const sB = buildInvestorDecisionSynthesis(rowB, macro);

    expect(sA.positionId).toBe("pos-a");
    expect(sB.positionId).toBe("pos-b");
    expect(sA.thesis.health).toBe("HEALTHY");
    expect(sB.thesis.health).toBe("DETERIORATING");
    expect(sB.protection.severity).toBe("HIGH_RISK");
    expect(sA.state).toBe("ALIGNED");
    expect(sB.state).toBe("CAUTION");
  });

  it("9. same instrument, different positionId → fully independent syntheses", () => {
    const sharedInstrument = "BTC/USD";
    const rowA = makeRow({
      positionId: "pos-1",
      instrument: sharedInstrument,
      thesisHealth: "HEALTHY",
      severity: "NONE",
    });
    const rowB = makeRow({
      positionId: "pos-2",
      instrument: sharedInstrument,
      thesisHealth: "INVALIDATED",
      severity: "INVALIDATED",
    });
    const macro = macroAvailable();
    const s1 = buildInvestorDecisionSynthesis(rowA, macro);
    const s2 = buildInvestorDecisionSynthesis(rowB, macro);
    expect(s1.positionId).toBe("pos-1");
    expect(s2.positionId).toBe("pos-2");
    expect(s1.instrument).toBe(s2.instrument);
    expect(s1.state).toBe("ALIGNED");
    expect(s2.state).toBe("CONFLICT");
    expect(s1.thesis.health).not.toBe(s2.thesis.health);
  });

  it("10. global macro context stays global — identical across positions, never per-position", () => {
    const macro = macroCaution();
    const rowA = makeRow({ positionId: "pos-a", instrument: "BTC/USD" });
    const rowB = makeRow({ positionId: "pos-b", instrument: "XAU/USD", side: "LONG" });

    const sA = buildInvestorDecisionSynthesis(rowA, macro);
    const sB = buildInvestorDecisionSynthesis(rowB, macro);

    // Both positions observe the SAME global macro context.
    expect(sA.macro).toEqual(sB.macro);
    // Global context never leaks into position-specific thesis fields.
    expect(sA.thesis.health).toBe("HEALTHY");
    expect(sB.thesis.health).toBe("HEALTHY");
    expect(sA.flags).toContain("GLOBAL_MACRO_CAUTION");
    expect(sB.flags).toContain("GLOBAL_MACRO_CAUTION");
  });

  it("11. deterministic: identical inputs → identical synthesis", () => {
    const row = makeRow({ severity: "HIGH_RISK", thesisHealth: "STABLE" });
    const macro = macroCaution();
    const a = buildInvestorDecisionSynthesis(row, macro);
    const b = buildInvestorDecisionSynthesis(row, macro);
    expect(a).toEqual(b);
    // And inputs are not mutated.
    expect(row.severity).toBe("HIGH_RISK");
    expect(macro.macroRisk).toBe("high");
  });
});

// ═══════════════════════════════════════════════════════════════
// PURITY — no analyzer / provider / fetch invocation
// ═══════════════════════════════════════════════════════════════

describe("synthesis — purity boundary", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/position-protection/investor-decision-synthesis.ts"),
    "utf8",
  );

  it("12. never invokes an intelligence analyzer (structural check)", () => {
    // Only type/view-model modules may be imported; engine modules must not
    // be loaded as runtime values.
    for (const engine of [
      "market-intelligence-analyzer",
      "multi-dimensional-intelligence",
      "fundamental-regime",
      "fundamental-intelligence",
      "fundamental-transmission",
      "price-observation-engine",
      "portfolio-intelligence",
      "market-context",
    ]) {
      // Allow only `import type { ... }` references.
      const lines = source.split("\n").filter((l) => l.includes(engine));
      for (const line of lines) {
        expect(line.trim().startsWith("import type")).toBe(true);
      }
    }
  });

  it("13. never fetches from providers (no convex/api/fetch imports)", () => {
    const imports = source
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("import"))
      .join("\n");
    expect(imports).not.toMatch(/convex/);
    expect(imports).not.toMatch(/api/);
    expect(imports).not.toMatch(/useAction/);
    expect(imports).not.toMatch(/useLiveProtectionPolling/);
  });

  it("no fabricated financial metrics are ever produced", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroAvailable());
    expect(s.state).toBe("ALIGNED");
    expect(s.state).toMatch(/^(ALIGNED|CONFLICT|CAUTION|INSUFFICIENT_DATA|UNAVAILABLE)$/);
    // The only numbers echoed are the position's own score and macro counts.
    expect(s.thesis.score).toBe(80);
    expect(s.macro.liveQuoteCount).toBe(1);
    const json = JSON.stringify(s);
    for (const fabricated of ["probability", "expectedReturn", "winRate", "priceTarget", "alphaScore", "forecast"]) {
      expect(json).not.toContain(fabricated);
    }
  });
});
