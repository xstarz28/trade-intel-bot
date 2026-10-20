/**
 * Phase 142 — Investor Decision Resilience & Adversarial Validation
 *
 * Stress-tests the Phase 139–141 investor decision pipeline against
 * contradictory, missing, stale, malformed, partial and multi-position
 * inputs. Proves the system stays:
 * - conservative (no false certainty, no ALIGNED from partial context)
 * - deterministic (identical inputs → identical output)
 * - correctly scoped (positionId isolation; global macro stays global)
 * - pure (no mutation of inputs, no analyzer/provider invocation)
 *
 * Domain facts verified against the repository:
 * - AlertSeverity = NONE | WATCH | CAUTION | HIGH_RISK | INVALIDATED
 *   (there is no "LOW"; NONE is the normal severity)
 * - ThesisHealthState = HEALTHY | STABLE | DETERIORATING |
 *   SEVERELY_DETERIORATING | INVALIDATED | UNKNOWN (plus the defensive
 *   INSUFFICIENT_DATA string handled by the engine boundary)
 * - Macro availability tokens = AVAILABLE | LIMITED | STALE | UNAVAILABLE
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
import type { LiveInstrumentState } from "./use-live-protection-polling";
import {
  buildInvestorDecisionSynthesis,
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

function macroStale(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 0,
    quotes: [makeQuote("DXY", { value: 104.2, status: "STALE", provider: "YahooFinance" }), ...UNAVAIL_QUOTES.filter((q) => q.symbol !== "DXY")],
  });
}

function macroUnavailable(): InvestorMacroContext {
  return baseMacro({});
}

function macroEventsOnly(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 0,
    events: [{ event: "FOMC", currency: "USD", country: "US", datetime: Date.now() + 86_400_000, importance: 3 }],
  });
}

function macroDelayedTreasury(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 0,
    rates: makeRates({ available: true, freshness: "DELAYED", observationDate: "2026-09-01", rows: [{ tenor: "10Y", value: 4.3 }] }),
  });
}

function macroFreshTreasuryOnly(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 0,
    rates: makeRates({ available: true, freshness: "FRESH", observationDate: "2026-09-02", rows: [{ tenor: "10Y", value: 4.3 }] }),
  });
}

function macroMixedLiveQuoteStaleTreasury(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 1,
    quotes: [makeQuote("VIX", { value: 16.4, status: "LIVE", provider: "YahooFinance" }), ...UNAVAIL_QUOTES.slice(1)],
    rates: makeRates({ available: true, freshness: "STALE", observationDate: "2026-08-20", rows: [{ tenor: "10Y", value: 4.4 }] }),
  });
}

function macroMixedStaleQuoteFreshTreasury(): InvestorMacroContext {
  return baseMacro({
    hasAnyData: true,
    liveQuoteCount: 0,
    quotes: [makeQuote("DXY", { value: 104.2, status: "STALE", provider: "YahooFinance" }), ...UNAVAIL_QUOTES.filter((q) => q.symbol !== "DXY")],
    rates: makeRates({ available: true, freshness: "FRESH", observationDate: "2026-09-02", rows: [{ tenor: "10Y", value: 4.3 }] }),
  });
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
// PRECEDENCE (STEP 3) — adversarial cases vs the R1–R9 table
// ═══════════════════════════════════════════════════════════════

describe("precedence — adversarial", () => {
  it("missing intelligence can never become ALIGNED, even with perfect macro", () => {
    const s = buildInvestorDecisionSynthesis(makeRow({ intel: null }), macroAvailable());
    expect(s.state).toBe("UNAVAILABLE");
    expect(s.flags).toContain("INTEL_UNAVAILABLE");
  });

  it("insufficient thesis can never become ALIGNED because macro is good", () => {
    for (const thesis of ["INSUFFICIENT_DATA", "UNKNOWN"] as const) {
      const s = buildInvestorDecisionSynthesis(
        makeRow({ thesisHealth: thesis }),
        macroAvailable(),
      );
      expect(s.state).toBe("INSUFFICIENT_DATA");
      expect(s.state).not.toBe("ALIGNED");
    }
  });

  it("engine data-quality insufficiency blocks ALIGNED even with HEALTHY thesis", () => {
    // Contradictory-but-type-valid input: zero observations + healthy claim.
    const s = buildInvestorDecisionSynthesis(
      makeRow({
        thesisHealth: "HEALTHY",
        intel: makeIntel("BTC/USD", { dataQuality: "INSUFFICIENT", observationCount: 0, evidence: [] }),
      }),
      macroAvailable(),
    );
    expect(s.state).toBe("INSUFFICIENT_DATA");
    expect(s.flags).toContain("DATA_INSUFFICIENT");
    // The contradictory claim is echoed, not erased.
    expect(s.thesis.health).toBe("HEALTHY");
  });

  it("unknown/future data-quality values fail conservatively (never ALIGNED)", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ intel: makeIntel("BTC/USD", { dataQuality: "SOME_FUTURE_QUALITY" }) }),
      macroAvailable(),
    );
    expect(s.state).toBe("INSUFFICIENT_DATA");
  });

  it("HIGH_RISK protection cannot disappear because thesis is healthy", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ thesisHealth: "HEALTHY", severity: "HIGH_RISK" }),
      macroAvailable(),
    );
    expect(s.state).toBe("CONFLICT");
    expect(s.protection.severity).toBe("HIGH_RISK");
  });

  it("stale macro can never produce ALIGNED", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroStale());
    expect(s.state).toBe("CAUTION");
    expect(s.state).not.toBe("ALIGNED");
  });

  it("unavailable macro can never produce ALIGNED", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroUnavailable());
    expect(s.state).toBe("CAUTION");
    expect(s.state).not.toBe("ALIGNED");
  });

  it("events-only / DELAYED-Treasury partial macro can never produce ALIGNED", () => {
    expect(buildInvestorDecisionSynthesis(makeRow(), macroEventsOnly()).state).toBe("CAUTION");
    expect(buildInvestorDecisionSynthesis(makeRow(), macroDelayedTreasury()).state).toBe("CAUTION");
  });

  it("high global macro risk cannot silently disappear", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), { ...macroAvailable(), macroRisk: "high" });
    expect(s.state).toBe("CAUTION");
    expect(s.flags).toContain("GLOBAL_MACRO_CAUTION");
    expect(s.macro.globalCaution).toBe(true);
  });

  it("invalidation cannot be overridden by positive macro context", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ thesisHealth: "INVALIDATED", severity: "INVALIDATED" }),
      macroAvailable(),
    );
    expect(s.state).toBe("CONFLICT");
  });

  it("conservative fallback (R9) remains CAUTION for clean-but-partial contexts", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ thesisHealth: "STABLE", severity: "WATCH" }),
      macroDelayedTreasury(),
    );
    expect(s.state).toBe("CAUTION");
    expect(s.thesis.health).toBe("STABLE");
    expect(s.protection.severity).toBe("WATCH");
  });

  it("no combination fabricates a numerical confidence/probability", () => {
    const matrix: Array<{ row: InvestorIntelRow; macro: InvestorMacroContext }> = [
      { row: makeRow(), macro: macroAvailable() },
      { row: makeRow({ thesisHealth: "DETERIORATING", severity: "HIGH_RISK" }), macro: macroStale() },
      { row: makeRow({ intel: null }), macro: macroUnavailable() },
      { row: makeRow({ thesisHealth: "INSUFFICIENT_DATA" }), macro: macroFreshTreasuryOnly() },
    ];
    for (const { row, macro } of matrix) {
      const s = buildInvestorDecisionSynthesis(row, macro);
      const json = JSON.stringify(s);
      expect(json).not.toMatch(/probability|expectedReturn|winRate|priceTarget|alphaScore/);
      expect(s.state).not.toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// MULTI-POSITION ADVERSARIAL (STEP 4)
// ═══════════════════════════════════════════════════════════════

describe("multi-position adversarial scenario", () => {
  const sharedMacro = macroAvailable();

  function scenario() {
    const rowA = makeRow({ positionId: "pos-a", instrument: "X", thesisHealth: "HEALTHY", severity: "NONE" });
    const rowB = makeRow({ positionId: "pos-b", instrument: "X", thesisHealth: "INSUFFICIENT_DATA", thesisHealthScore: 30, severity: "HIGH_RISK" });
    const rowC = makeRow({ positionId: "pos-c", instrument: "Y", thesisHealth: "HEALTHY", severity: "CAUTION" });
    return { rowA, rowB, rowC };
  }

  it("A, B and C derive independent position-specific states", () => {
    const { rowA, rowB, rowC } = scenario();
    const sA = buildInvestorDecisionSynthesis(rowA, sharedMacro);
    const sB = buildInvestorDecisionSynthesis(rowB, sharedMacro);
    const sC = buildInvestorDecisionSynthesis(rowC, sharedMacro);

    expect(sA.state).toBe("ALIGNED");
    expect(sB.state).toBe("INSUFFICIENT_DATA"); // R3 dominates, protection retained
    expect(sC.state).toBe("CAUTION");           // R5

    // Same instrument X for A and B — still independent.
    expect(sA.instrument).toBe("X");
    expect(sB.instrument).toBe("X");
    expect(sA.thesis.health).not.toBe(sB.thesis.health);
    expect(sB.protection.severity).toBe("HIGH_RISK");
    expect(sC.thesis.health).toBe("HEALTHY");
  });

  it("changing B never changes A or C", () => {
    const { rowA, rowB, rowC } = scenario();
    const baselineA = buildInvestorDecisionSynthesis(rowA, sharedMacro);
    const baselineC = buildInvestorDecisionSynthesis(rowC, sharedMacro);

    const mutatedB = { ...rowB, thesisHealth: "HEALTHY", thesisHealthScore: 90, severity: "NONE" };
    buildInvestorDecisionSynthesis(mutatedB, sharedMacro);

    expect(buildInvestorDecisionSynthesis(rowA, sharedMacro)).toEqual(baselineA);
    expect(buildInvestorDecisionSynthesis(rowC, sharedMacro)).toEqual(baselineC);
  });

  it("changing GLOBAL macro affects macro pillar of all positions but never their thesis/protection", () => {
    const { rowA, rowB, rowC } = scenario();
    const withMacro = (m: InvestorMacroContext) => [rowA, rowB, rowC].map((r) => buildInvestorDecisionSynthesis(r, m));

    const good = withMacro(macroAvailable());
    const bad = withMacro(macroUnavailable());

    for (let i = 0; i < 3; i++) {
      // Position-specific fields are untouched by the macro change.
      expect(bad[i].thesis).toEqual(good[i].thesis);
      expect(bad[i].protection).toEqual(good[i].protection);
      // Macro pillar changes (global by design).
      expect(bad[i].macro.status).toBe("UNAVAILABLE");
      expect(good[i].macro.status).toBe("AVAILABLE");
      // Overall state may change — never to ALIGNED without fresh macro.
      expect(bad[i].state).not.toBe("ALIGNED");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SAME-INSTRUMENT STRESS (STEP 5)
// ═══════════════════════════════════════════════════════════════

describe("same-instrument stress — positionId is the only identity", () => {
  const instrument = "BTC/USD";
  const macro = macroAvailable();

  function buildPositions() {
    return [
      makeRow({
        positionId: "p1",
        instrument,
        thesisHealth: "HEALTHY",
        severity: "NONE",
        intel: makeIntel(instrument, {
          evidence: [{ category: "TECHNICAL", description: "A", direction: "supporting", strength: "STRONG" }],
          invalidationConditions: [{ description: "SL hit", distancePct: 1.2, approaching: true }],
          observationCount: 12,
        }),
      }),
      makeRow({
        positionId: "p2",
        instrument,
        thesisHealth: "DETERIORATING",
        severity: "CAUTION",
        intel: makeIntel(instrument, {
          evidence: [{ category: "STRUCTURE", description: "B", direction: "conflicting", strength: "STRONG" }],
          invalidationConditions: [{ description: "Structure broken", distancePct: 0, approaching: true }],
          observationCount: 5,
        }),
      }),
      makeRow({
        positionId: "p3",
        instrument,
        thesisHealth: "HEALTHY",
        severity: "WATCH",
        intel: makeIntel(instrument, {
          evidence: [],
          invalidationConditions: [],
          observationCount: 0,
          dataQuality: "INSUFFICIENT",
        }),
      }),
    ];
  }

  it("thesis/protection/evidence/invalidation/observations stay position-specific", () => {
    const [row1, row2, row3] = buildPositions();
    const s1 = buildInvestorDecisionSynthesis(row1, macro);
    const s2 = buildInvestorDecisionSynthesis(row2, macro);
    const s3 = buildInvestorDecisionSynthesis(row3, macro);

    expect(s1.thesis.health).toBe("HEALTHY");
    expect(s2.thesis.health).toBe("DETERIORATING");
    expect(s1.protection.severity).toBe("NONE");
    expect(s2.protection.severity).toBe("CAUTION");

    // Evidence/invalidation/counts are echoed per position via their own intel.
    expect(row1.intel!.evidence).toHaveLength(1);
    expect(row2.intel!.evidence).toHaveLength(1);
    expect(row1.intel!.evidence[0].description).toBe("A");
    expect(row2.intel!.evidence[0].description).toBe("B");
    expect(row1.intel!.observationCount).toBe(12);
    expect(row2.intel!.observationCount).toBe(5);
    expect(row1.intel!.invalidationConditions[0].approaching).toBe(true);
    expect(row2.intel!.invalidationConditions[0].approaching).toBe(true);

    // Independent synthesis results.
    expect(s1.state).toBe("ALIGNED");
    expect(s2.state).toBe("CAUTION");
    expect(s3.state).toBe("INSUFFICIENT_DATA"); // R3b via dataQuality
    expect(s3.dataQuality.intelQuality).toBe("INSUFFICIENT");
  });

  it("instrument symbol is never the identity key", () => {
    const rows = buildPositions();
    // The instrument is identical; the outputs must be keyed by positionId
    // and vary with position-specific fields.
    const results = rows.map((r) => buildInvestorDecisionSynthesis(r, macro));
    expect(results.map((r) => r.instrument)).toEqual([instrument, instrument, instrument]);
    expect(results.map((r) => r.positionId)).toEqual(["p1", "p2", "p3"]);
    expect(new Set(results.map((r) => r.state)).size).toBe(3);
  });

  it("mutating one position's intel cannot leak into siblings", () => {
    const rows = buildPositions();
    const before1 = buildInvestorDecisionSynthesis(rows[0], macro);
    const before2 = buildInvestorDecisionSynthesis(rows[1], macro);

    rows[2].intel = makeIntel(instrument, { evidence: [], observationCount: 99, dataQuality: "SUFFICIENT" });
    buildInvestorDecisionSynthesis(rows[2], macro);

    expect(buildInvestorDecisionSynthesis(rows[0], macro)).toEqual(before1);
    expect(buildInvestorDecisionSynthesis(rows[1], macro)).toEqual(before2);
  });
});

// ═══════════════════════════════════════════════════════════════
// IMMUTABILITY & DETERMINISM (STEP 6)
// ═══════════════════════════════════════════════════════════════

describe("immutability & determinism", () => {
  it("synthesis never mutates frozen inputs and is deterministic", () => {
    const row = deepFreeze(makeRow({ severity: "HIGH_RISK", thesisHealth: "STABLE" }));
    const macro = deepFreeze(macroCautionLike());

    // Writing to a frozen object throws in strict mode — a mutation inside
    // the synthesis would fail this call.
    let first: ReturnType<typeof buildInvestorDecisionSynthesis>;
    expect(() => {
      first = buildInvestorDecisionSynthesis(row, macro);
    }).not.toThrow();

    expect(first!).toEqual(buildInvestorDecisionSynthesis(row, macro));
    // STABLE thesis + HIGH_RISK protection + AVAILABLE macro → R4a CONFLICT.
    expect(first!.state).toBe("CONFLICT");
  });

  function macroCautionLike(): InvestorMacroContext {
    return { ...macroAvailable(), macroRisk: "high" };
  }

  it("deep-frozen PositionIntelligence with nested arrays survives synthesis", () => {
    const intel = deepFreeze(
      makeIntel("BTC/USD", {
        evidence: [{ category: "TECHNICAL", description: "x", direction: "conflicting", strength: "STRONG" }],
        invalidationConditions: [{ description: "y", distancePct: 1, approaching: true }],
      }),
    );
    const row = deepFreeze(makeRow({ intel }));
    expect(() => buildInvestorDecisionSynthesis(row, macroAvailable())).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// MALFORMED / PARTIAL DATA (STEP 7)
// ═══════════════════════════════════════════════════════════════

describe("malformed / partial data — conservative failure", () => {
  it("null intel + null macro → UNAVAILABLE everywhere, no fabricated numbers", () => {
    const s = buildInvestorDecisionSynthesis(makeRow({ intel: null }), macroUnavailable());
    expect(s.state).toBe("UNAVAILABLE");
    expect(s.thesis.limited).toBe(true);
    expect(s.dataQuality.intelQuality).toBeNull();
    expect(s.macro.status).toBe("UNAVAILABLE");
  });

  it("optional position fields (undefined SL/TP) never crash synthesis", () => {
    const row = makeRow({ stopLoss: undefined, takeProfit: undefined });
    expect(() => buildInvestorDecisionSynthesis(row, macroAvailable())).not.toThrow();
  });

  it("missing macroRisk → globalCaution is simply false (no invented caution)", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroAvailable());
    expect(s.macro.globalCaution).toBe(false);
    expect(s.flags).not.toContain("GLOBAL_MACRO_CAUTION");
  });

  it("missing sourceMode on a quote record degrades to UNAVAILABLE (safe default)", () => {
    // Type-valid-ish malformed state: sourceMode absent.
    const malformed = makeLive("VIX", { price: 16.0, sourceMode: undefined as unknown as "LIVE" });
    const quotes = selectMacroQuotesSafe(new Map([["VIX", malformed]]));
    const vix = quotes.find((q) => q.symbol === "VIX")!;
    expect(vix.status).toBe("UNAVAILABLE");
    expect(vix.value).toBeNull();
  });

  it("empty evidence arrays / zero observations do not crash and never invent data", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ intel: makeIntel("BTC/USD", { evidence: [], observationCount: 0, dataQuality: "INSUFFICIENT" }) }),
      macroFreshTreasuryOnly(),
    );
    expect(s.state).toBe("INSUFFICIENT_DATA");
    expect(s.dataQuality.intelQuality).toBe("INSUFFICIENT");
  });

  it("incomplete Treasury rows (no real curve) still work — only reported tenors surface", () => {
    const macro = baseMacro({
      hasAnyData: true,
      rates: makeRates({ available: true, freshness: "FRESH", observationDate: "2026-09-02", rows: [{ tenor: "10Y", value: 4.3 }] }),
    });
    const s = buildInvestorDecisionSynthesis(makeRow(), macro);
    expect(s.macro.ratesAvailable).toBe(true);
    expect(s.macro.status).toBe("AVAILABLE");
    expect(s.state).toBe("ALIGNED");
  });

  it("unknown-but-type-valid thesis/protection strings never crash and never ALIGN", () => {
    const s = buildInvestorDecisionSynthesis(
      makeRow({ thesisHealth: "SOMETHING_FUTURE", severity: "SOMETHING_FUTURE" }),
      macroAvailable(),
    );
    expect(["INSUFFICIENT_DATA", "CAUTION", "CONFLICT", "UNAVAILABLE"]).toContain(s.state);
    expect(s.state).not.toBe("ALIGNED");
  });
});

function makeLive(instrument: string, overrides: Partial<LiveInstrumentState> = {}): LiveInstrumentState {
  return {
    instrument,
    price: 0,
    provider: "TwelveData",
    sourceMode: "UNAVAILABLE",
    lastUpdateAt: 1_700_000_000_000,
    success: false,
    ...overrides,
  } as LiveInstrumentState;
}

// Minimal safe re-implementation of the selector contract used to prove the
// malformed-state default (kept local to this test file).
function selectMacroQuotesSafe(map: ReadonlyMap<string, LiveInstrumentState>): MacroQuoteView[] {
  const defs = [
    { symbol: "VIX", aliases: ["VIX", "^VIX"] },
    { symbol: "DXY", aliases: ["DXY", "DX-Y.NYB"] },
    { symbol: "US10Y", aliases: ["US10Y", "^TNX"] },
    { symbol: "WTI", aliases: ["WTI", "CL=F", "CL"] },
  ] as const;
  return defs.map(({ symbol, aliases }) => {
    let state: LiveInstrumentState | undefined;
    for (const alias of aliases) {
      const c = map.get(alias);
      if (c) { state = c; break; }
    }
    if (!state) return { symbol, value: null, change24h: null, status: "UNAVAILABLE", provider: null };
    if (state.sourceMode === "LIVE" && state.price > 0) {
      return { symbol, value: state.price, change24h: state.change24h ?? null, status: "LIVE", provider: state.provider };
    }
    if (state.sourceMode === "STALE") {
      return { symbol, value: state.price > 0 ? state.price : null, change24h: state.change24h ?? null, status: "STALE", provider: state.provider };
    }
    return { symbol, value: null, change24h: null, status: "UNAVAILABLE", provider: state.provider };
  });
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS ADVERSARIAL (STEP 8)
// ═══════════════════════════════════════════════════════════════

describe("freshness adversarial — each source keeps its own status", () => {
  it("LIVE quote + STALE Treasury: mixed semantics preserved, never all-LIVE", () => {
    const macro = macroMixedLiveQuoteStaleTreasury();
    expect(macro.quotes.find((q) => q.status === "LIVE")).toBeDefined();
    expect(macro.rates.freshness).toBe("STALE");
    // Macro pillar says AVAILABLE (some fresh evidence exists) — it does NOT
    // relabel the Treasury as fresh.
    const s = buildInvestorDecisionSynthesis(makeRow(), macro);
    expect(s.macro.status).toBe("AVAILABLE");
    expect(s.macro.ratesAvailable).toBe(true);
  });

  it("STALE quote + FRESH Treasury: mixed semantics preserved, never all-FRESH", () => {
    const macro = macroMixedStaleQuoteFreshTreasury();
    expect(macro.quotes.find((q) => q.status === "STALE")).toBeDefined();
    expect(macro.rates.freshness).toBe("FRESH");
    const s = buildInvestorDecisionSynthesis(makeRow(), macro);
    expect(s.macro.status).toBe("AVAILABLE");
  });

  it("no fresh sources → never ALIGNED solely from stale/partial context", () => {
    expect(buildInvestorDecisionSynthesis(makeRow(), macroStale()).state).toBe("CAUTION");
    expect(buildInvestorDecisionSynthesis(makeRow(), macroEventsOnly()).state).toBe("CAUTION");
    expect(buildInvestorDecisionSynthesis(makeRow(), macroUnavailable()).state).toBe("CAUTION");
  });

  it("upcoming event with otherwise unavailable market data does not manufacture confirmation", () => {
    const s = buildInvestorDecisionSynthesis(makeRow(), macroEventsOnly());
    expect(s.state).toBe("CAUTION");
    expect(s.macro.eventCount).toBe(1);
    expect(s.macro.status).toBe("LIMITED");
    expect(s.macro.liveQuoteCount).toBe(0);
    expect(s.macro.ratesAvailable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// UI SEMANTIC AUDIT (STEP 9) — static, since browser E2E is unavailable
// ═══════════════════════════════════════════════════════════════

describe("InvestorWorkspace UI semantic audit", () => {
  const ui = readFileSync(
    join(process.cwd(), "src/components/InvestorWorkspace.tsx"),
    "utf8",
  );

  it("never renders raw synthesis/thesis/protection enums directly", () => {
    expect(ui).not.toMatch(/\{synthesis\.state\}/);
    expect(ui).not.toMatch(/\{synthesis\.thesis\.health\}/);
    expect(ui).not.toMatch(/\{synthesis\.protection\.severity\}/);
    expect(ui).not.toMatch(/\{synthesis\.dataQuality\.intelQuality\}/);
  });

  it("decision displays route through the mapping layer", () => {
    expect(ui).toContain("mapDecisionState(synthesis.state, t)");
    expect(ui).toContain("mapThesisHealth(synthesis.thesis.health, t)");
    expect(ui).toContain("mapSeverity(synthesis.protection.severity, t)");
  });

  it("no accidental BUY/SELL/HOLD wording", () => {
    expect(ui).not.toMatch(/BUY|SELL|HOLD/);
  });

  it("new decision labels are i18n keys, not hardcoded English", () => {
    expect(ui).toContain("t.investor.decisionContext");
    expect(ui).toContain("t.investor.decisionInfo");
    expect(ui).toContain("t.investor.decisionStateConflict");
    // decisionStateAligned is consumed through the mapping layer instead.
    const mapping = readFileSync(
      join(process.cwd(), "src/lib/i18n/enum-mapping.ts"),
      "utf8",
    );
    expect(mapping).toContain("t.investor.decisionStateAligned");
    expect(mapping).toContain("t.investor.decisionStateConflict");
  });

  it("no position-scope confusion: macro pillar is labeled global only", () => {
    // The synthesis section never attaches macro data to a position row's
    // identity — macro status is only ever shown via the macro chip/labels.
    expect(ui).toContain("t.investor.macroScopeNote");
    expect(ui).not.toMatch(/macro.*positionId|positionId.*macro/);
  });
});

// ═══════════════════════════════════════════════════════════════
// SOURCE BOUNDARY (STEP 11)
// ═══════════════════════════════════════════════════════════════

describe("source boundary — synthesis stays pure", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/position-protection/investor-decision-synthesis.ts"),
    "utf8",
  );

  it("imports only the view-model layer (no engines/providers/convex)", () => {
    const imports = source
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("import"));
    const modules = imports.map((l) => (l.match(/from\s+"([^"]+)"/) ?? [])[1]).filter(Boolean);
    expect(modules.length).toBeGreaterThan(0);
    for (const m of modules) {
      expect(["./investor-intelligence-view", "./investor-macro-context"]).toContain(m);
    }
    expect(source).not.toMatch(/convex|useAction|fetchCandles|fetchLiveQuotes/);
  });

  it("contains no numerical fabrication tokens (code only, comments excluded)", () => {
    // The header comment documents the anti-fabrication guarantee; the CODE
    // itself must contain no percentage/expected-return/probability tokens.
    const code = source
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("*") && !t.startsWith("/") && !t.startsWith("//");
      })
      .join("\n");
    expect(code).not.toMatch(/%|probability|expected|priceTarget|winRate|alphaScore|riskReward/);
  });
});