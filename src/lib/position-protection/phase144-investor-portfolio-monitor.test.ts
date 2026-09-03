/**
 * Phase 144 — Investor Portfolio Monitoring Summary
 *
 * Verifies the deterministic portfolio monitor layer that consumes the
 * Phase 143 summary + Phase 141 syntheses (reads only — no recalculation)
 * and produces ONE categorical watch state + grounded reason codes.
 *
 * Domain facts verified against the repository:
 * - Per-position decision states = ALIGNED | CONFLICT | CAUTION |
 *   INSUFFICIENT_DATA | UNAVAILABLE (Phase 141 R1–R9)
 * - Protection severities = NONE | WATCH | CAUTION | HIGH_RISK | INVALIDATED
 * - Macro availability = AVAILABLE | LIMITED | STALE | UNAVAILABLE
 * - Phase 141 R3 (insufficient thesis) outranks R4 (HIGH_RISK protection)
 *   for the per-position STATE, but protection counts must still surface
 *   at monitor level (protection risk never disappears)
 * - No fabricated numbers: monitor output is categorical + counts only
 */

import { describe, it, expect } from "vitest";
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
import { buildInvestorPortfolioSummary } from "./investor-portfolio-summary";
import {
  buildInvestorMonitorState,
  type InvestorMonitorState,
  type MonitorReasonCode,
  type MonitorState,
} from "./investor-portfolio-monitor";
import { mapMonitorState, mapDecisionState } from "../i18n/enum-mapping";
import en from "../i18n/en";
import id from "../i18n/id";
import es from "../i18n/es";
import pt from "../i18n/pt";
import type { Translations } from "../i18n/types";

// ═══════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════

type MacroStatus = "AVAILABLE" | "LIMITED" | "STALE" | "UNAVAILABLE";

interface SynthesisOverrides {
  positionId?: string;
  instrument?: string;
  state?: InvestorDecisionSynthesis["state"];
  thesisHealth?: string;
  severity?: string;
  macroStatus?: MacroStatus;
  globalCaution?: boolean;
}

function makeSynthesis(o: SynthesisOverrides = {}): InvestorDecisionSynthesis {
  return {
    positionId: o.positionId ?? "pos-a",
    instrument: o.instrument ?? "BTC/USD",
    state: o.state ?? "ALIGNED",
    thesis: {
      health: o.thesisHealth ?? "HEALTHY",
      score: 80,
      limited: false,
    },
    protection: { severity: o.severity ?? "NONE" },
    macro: {
      status: o.macroStatus ?? "AVAILABLE",
      globalCaution: o.globalCaution ?? false,
      liveQuoteCount: 2,
      ratesAvailable: true,
      eventCount: 0,
    },
    dataQuality: { intelQuality: "SUFFICIENT" },
    flags: [],
  };
}

function makeMonitor(syntheses: InvestorDecisionSynthesis[]): InvestorMonitorState {
  return buildInvestorMonitorState(buildInvestorPortfolioSummary(syntheses), syntheses);
}

function reasonCodes(m: InvestorMonitorState): MonitorReasonCode[] {
  return m.reasons.map((r) => r.code);
}

function findReason(m: InvestorMonitorState, code: MonitorReasonCode) {
  return m.reasons.find((r) => r.code === code);
}

// Full-pipeline fixtures (row → synthesis → summary → monitor)
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

const FRESH_MACRO = baseMacro({
  quotes: [
    makeQuote("VIX", { value: 18.2, status: "LIVE", provider: "test" }),
    makeQuote("DXY", { value: 103.5, status: "LIVE", provider: "test" }),
  ],
  rates: makeRates({ available: true, freshness: "FRESH", rows: [{ tenor: "10Y", value: 4.21 }] }),
  hasAnyData: true,
  liveQuoteCount: 2,
});

// ═══════════════════════════════════════════════════════════════
// M1 — EMPTY PORTFOLIO
// ═══════════════════════════════════════════════════════════════

describe("M1 — empty portfolio", () => {
  it("returns IDLE with NO_POSITIONS when nothing is monitored", () => {
    const m = makeMonitor([]);
    expect(m.state).toBe("IDLE");
    expect(reasonCodes(m)).toEqual(["NO_POSITIONS"]);
    expect(m.reasons[0].count).toBe(0);
  });

  it("IDLE never carries macro or position-scoped reasons", () => {
    const m = makeMonitor([]);
    expect(m.reasons.every((r) => r.code === "NO_POSITIONS")).toBe(true);
    expect(m.macroStatus).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// M2 — INVALIDATION
// ═══════════════════════════════════════════════════════════════

describe("M2 — invalidation", () => {
  it("invalidated thesis → SEVERE with INVALIDATED reason + positionId", () => {
    const syntheses = [
      makeSynthesis({ positionId: "pos-x", thesisHealth: "INVALIDATED", state: "CONFLICT" }),
      makeSynthesis({ positionId: "pos-y" }),
    ];
    const m = makeMonitor(syntheses);
    expect(m.state).toBe("SEVERE");
    const r = findReason(m, "INVALIDATED")!;
    expect(r.count).toBe(1);
    expect(r.positionIds).toEqual(["pos-x"]);
  });

  it("invalidated protection → SEVERE (protection invalidation is preserved)", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", severity: "INVALIDATED", state: "CONFLICT" }),
    ]);
    expect(m.state).toBe("SEVERE");
    expect(findReason(m, "INVALIDATED")!.count).toBe(1);
  });

  it("SEVERE outranks ELEVATED: invalidated + conflict mix stays SEVERE", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", thesisHealth: "INVALIDATED", state: "CONFLICT" }),
      makeSynthesis({ positionId: "pos-b", state: "CONFLICT" }),
    ]);
    expect(m.state).toBe("SEVERE");
  });
});

// ═══════════════════════════════════════════════════════════════
// M3 — CONFLICT / HIGH RISK
// ═══════════════════════════════════════════════════════════════

describe("M3 — conflict / high risk", () => {
  it("any CONFLICT synthesis → ELEVATED with PORTFOLIO_CONFLICT count", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a" }),
      makeSynthesis({ positionId: "pos-b", state: "CONFLICT" }),
    ]);
    expect(m.state).toBe("ELEVATED");
    const r = findReason(m, "PORTFOLIO_CONFLICT")!;
    expect(r.count).toBe(1);
    expect(r.positionIds).toEqual(["pos-b"]);
  });

  it("portfolio state CONFLICT (healthy thesis + HIGH_RISK protection, fresh macro) → ELEVATED", () => {
    // Phase 141 R4: healthy + HIGH_RISK + macro AVAILABLE → CONFLICT
    const syntheses = [
      makeSynthesis({ positionId: "pos-a", thesisHealth: "HEALTHY", severity: "HIGH_RISK", state: "CONFLICT" }),
    ];
    const m = makeMonitor(syntheses);
    expect(m.state).toBe("ELEVATED");
    expect(findReason(m, "PORTFOLIO_CONFLICT")!.count).toBe(1);
    expect(findReason(m, "HIGH_RISK_PROTECTION")!.count).toBe(1);
  });

  it("HIGH_RISK protection is preserved even when the synthesis state is only CAUTION (R3 gate)", () => {
    // Phase 141 R3 outranks R4: insufficient thesis + HIGH_RISK + LIMITED macro
    // → per-position state INSUFFICIENT_DATA; protection risk must still
    // surface at the monitor level (never hidden by another pillar).
    const syntheses = [
      makeSynthesis({
        positionId: "pos-b",
        thesisHealth: "INSUFFICIENT_DATA",
        severity: "HIGH_RISK",
        macroStatus: "LIMITED",
        state: "INSUFFICIENT_DATA",
      }),
    ];
    const m = makeMonitor(syntheses);
    expect(m.state).toBe("ELEVATED");
    const r = findReason(m, "HIGH_RISK_PROTECTION")!;
    expect(r.count).toBe(1);
    expect(r.positionIds).toEqual(["pos-b"]);
  });

  it("ELEVATED outranks WATCH: conflict + caution mix stays ELEVATED", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "CAUTION", severity: "CAUTION" }),
      makeSynthesis({ positionId: "pos-b", state: "CONFLICT" }),
    ]);
    expect(m.state).toBe("ELEVATED");
  });
});

// ═══════════════════════════════════════════════════════════════
// M4 — CAUTION / COVERAGE / MACRO GATES
// ═══════════════════════════════════════════════════════════════

describe("M4 — caution, coverage and macro gates", () => {
  it("CAUTION synthesis → WATCH with CAUTION_POSITIONS count", () => {
    const m = makeMonitor([makeSynthesis({ state: "CAUTION", severity: "CAUTION" })]);
    expect(m.state).toBe("WATCH");
    expect(findReason(m, "CAUTION_POSITIONS")!.count).toBe(1);
  });

  it("stale macro never yields STABLE → WATCH with MACRO_STALE", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "ALIGNED", macroStatus: "STALE" }),
    ]);
    expect(m.state).toBe("WATCH");
    expect(reasonCodes(m)).toContain("MACRO_STALE");
  });

  it("unavailable macro → WATCH with MACRO_UNAVAILABLE", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "ALIGNED", macroStatus: "UNAVAILABLE" }),
    ]);
    expect(m.state).toBe("WATCH");
    expect(reasonCodes(m)).toContain("MACRO_UNAVAILABLE");
  });

  it("limited macro → WATCH with MACRO_LIMITED", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "ALIGNED", macroStatus: "LIMITED" }),
    ]);
    expect(m.state).toBe("WATCH");
    expect(reasonCodes(m)).toContain("MACRO_LIMITED");
  });

  it("global macro caution → WATCH with GLOBAL_MACRO_CAUTION", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "ALIGNED", globalCaution: true }),
    ]);
    expect(m.state).toBe("WATCH");
    expect(reasonCodes(m)).toContain("GLOBAL_MACRO_CAUTION");
  });

  it("partial coverage (ALIGNED + UNAVAILABLE) → WATCH with PARTIAL_COVERAGE + UNAVAILABLE_INTEL", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "ALIGNED" }),
      makeSynthesis({ positionId: "pos-b", state: "UNAVAILABLE" }),
    ]);
    expect(m.state).toBe("WATCH");
    const codes = reasonCodes(m);
    expect(codes).toContain("PARTIAL_COVERAGE");
    expect(codes).toContain("UNAVAILABLE_INTEL");
  });

  it("all INSUFFICIENT_DATA → WATCH via conservative fallback (never STABLE, never ALIGNED)", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "INSUFFICIENT_DATA", thesisHealth: "INSUFFICIENT_DATA" }),
      makeSynthesis({ positionId: "pos-b", state: "INSUFFICIENT_DATA", thesisHealth: "INSUFFICIENT_DATA" }),
    ]);
    expect(m.state).toBe("WATCH");
    expect(findReason(m, "INSUFFICIENT_DATA")!.count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// M5 — STABLE
// ═══════════════════════════════════════════════════════════════

describe("M5 — stable", () => {
  it("all ALIGNED + FULL coverage + macro AVAILABLE → STABLE with no caution reasons", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", instrument: "BTC/USD", state: "ALIGNED" }),
      makeSynthesis({ positionId: "pos-b", instrument: "ETH/USD", state: "ALIGNED" }),
    ]);
    expect(m.state).toBe("STABLE");
    expect(m.macroStatus).toBe("AVAILABLE");
    expect(m.reasons).toEqual([]);
  });

  it("STABLE requires FULL coverage — one UNAVAILABLE breaks it", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", state: "ALIGNED" }),
      makeSynthesis({ positionId: "pos-b", state: "UNAVAILABLE" }),
    ]);
    expect(m.state).toBe("WATCH");
  });

  it("STABLE requires fresh macro — LIMITED/STALE/UNAVAILABLE all downgrade", () => {
    for (const status of ["LIMITED", "STALE", "UNAVAILABLE"] as const) {
      const m = makeMonitor([makeSynthesis({ positionId: "pos-a", state: "ALIGNED", macroStatus: status })]);
      expect(m.state).toBe("WATCH");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// CONCENTRATION REASON
// ═══════════════════════════════════════════════════════════════

describe("concentration reason", () => {
  it("instruments with 2+ positions produce a CONCENTRATION reason with instruments", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", instrument: "BTC/USD", state: "ALIGNED" }),
      makeSynthesis({ positionId: "pos-b", instrument: "BTC/USD", state: "ALIGNED" }),
      makeSynthesis({ positionId: "pos-c", instrument: "ETH/USD", state: "ALIGNED" }),
    ]);
    expect(m.state).toBe("STABLE");
    const r = findReason(m, "CONCENTRATION")!;
    expect(r.count).toBe(1);
    expect(r.instruments).toEqual(["BTC/USD"]);
  });

  it("no concentration when every instrument appears once", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a", instrument: "BTC/USD" }),
      makeSynthesis({ positionId: "pos-b", instrument: "ETH/USD" }),
    ]);
    expect(reasonCodes(m)).not.toContain("CONCENTRATION");
  });
});

// ═══════════════════════════════════════════════════════════════
// DETERMINISM / IMMUTABILITY / NO FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("determinism, immutability and no fabrication", () => {
  it("identical inputs → identical fingerprint; changed input → changed fingerprint", () => {
    const a = [makeSynthesis({ positionId: "pos-a" }), makeSynthesis({ positionId: "pos-b", state: "CONFLICT" })];
    const b = [makeSynthesis({ positionId: "pos-a" }), makeSynthesis({ positionId: "pos-b", state: "CONFLICT" })];
    expect(makeMonitor(a).fingerprint).toBe(makeMonitor(b).fingerprint);

    const c = [makeSynthesis({ positionId: "pos-a" }), makeSynthesis({ positionId: "pos-b", state: "ALIGNED" })];
    expect(makeMonitor(c).fingerprint).not.toBe(makeMonitor(a).fingerprint);
  });

  it("does not mutate its inputs", () => {
    const syntheses = [
      makeSynthesis({ positionId: "pos-a" }),
      makeSynthesis({ positionId: "pos-b", state: "CONFLICT" }),
    ];
    const before = JSON.stringify(syntheses);
    makeMonitor(syntheses);
    expect(JSON.stringify(syntheses)).toBe(before);
  });

  it("outputs categorical state + counts only — never probabilities, percentages or returns", () => {
    const m = makeMonitor([
      makeSynthesis({ positionId: "pos-a" }),
      makeSynthesis({ positionId: "pos-b", state: "CAUTION", severity: "CAUTION" }),
    ]);
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/probability|percent|winRate|expectedReturn|alpha|sharpe|rrRatio|target/i);
    // Counts are integers; reasons carry only code/count/positionIds/instruments.
    for (const r of m.reasons) {
      expect(Number.isInteger(r.count)).toBe(true);
      expect(Array.isArray(r.positionIds)).toBe(true);
      expect(Array.isArray(r.instruments)).toBe(true);
    }
  });

  it("every MonitorState maps to a translated label in all four enabled locales", () => {
    const locales: [Translations, string][] = [
      [en, "en"],
      [id, "id"],
      [es, "es"],
      [pt, "pt"],
    ];
    const states: MonitorState[] = ["IDLE", "STABLE", "WATCH", "ELEVATED", "SEVERE"];
    for (const [t, name] of locales) {
      for (const s of states) {
        const label = mapMonitorState(s, t);
        expect(label.length, `${name}:${s}`).toBeGreaterThan(0);
        expect(label).not.toMatch(/_/); // never a raw underscore identifier
      }
    }
  });

  it("every reason code has a translated label in all four enabled locales", () => {
    const locales: [Translations, string][] = [
      [en, "en"],
      [id, "id"],
      [es, "es"],
      [pt, "pt"],
    ];
    // Mirrors the UI's monitorReasonLabel switch in InvestorWorkspace.tsx.
    const codeToKey: Record<MonitorReasonCode, string> = {
      NO_POSITIONS: "monitorReasonNoPositions",
      INVALIDATED: "monitorReasonInvalidated",
      PORTFOLIO_CONFLICT: "monitorReasonConflict",
      HIGH_RISK_PROTECTION: "monitorReasonHighRisk",
      CAUTION_POSITIONS: "monitorReasonCaution",
      INSUFFICIENT_DATA: "monitorReasonInsufficientData",
      UNAVAILABLE_INTEL: "monitorReasonUnavailable",
      PARTIAL_COVERAGE: "monitorReasonPartialCoverage",
      GLOBAL_MACRO_CAUTION: "monitorReasonMacroCaution",
      MACRO_STALE: "monitorReasonMacroStale",
      MACRO_LIMITED: "monitorReasonMacroLimited",
      MACRO_UNAVAILABLE: "monitorReasonMacroUnavailable",
      CONCENTRATION: "monitorReasonConcentration",
    };
    const codes = Object.keys(codeToKey) as MonitorReasonCode[];
    for (const [t, name] of locales) {
      for (const code of codes) {
        const label = t.investor[codeToKey[code] as keyof Translations["investor"]];
        expect(String(label).length, `${name}:${code}`).toBeGreaterThan(0);
        expect(String(label)).not.toContain("_");
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// FULL-PIPELINE INTEGRATION (row → synthesis → summary → monitor)
// ═══════════════════════════════════════════════════════════════

describe("full-pipeline integration (Phase 142 adversarial scenario)", () => {
  it("3-position scenario: A healthy, B insufficient+high-risk, C caution — protection risk preserved, positions isolated", () => {
    const rows = [
      makeRow({
        positionId: "pos-a",
        instrument: "BTC/USD",
        intel: makeIntel("BTC/USD", { thesisHealth: "HEALTHY", dataQuality: "SUFFICIENT" }),
      }),
      // B: R3 gate — insufficient thesis wins the per-position STATE,
      // but HIGH_RISK protection must survive at monitor level.
      makeRow({
        positionId: "pos-b",
        instrument: "BTC/USD",
        severity: "HIGH_RISK",
        thesisHealth: "INSUFFICIENT_DATA",
        intel: makeIntel("BTC/USD", { severity: "HIGH_RISK", dataQuality: "INSUFFICIENT" }),
      }),
      // C: healthy thesis + CAUTION protection + limited macro → CAUTION
      makeRow({
        positionId: "pos-c",
        instrument: "ETH/USD",
        severity: "CAUTION",
        thesisHealth: "HEALTHY",
        intel: makeIntel("ETH/USD", { thesisHealth: "HEALTHY", severity: "CAUTION" }),
      }),
    ];

    const macro = baseMacro({
      quotes: [makeQuote("VIX", { value: 20.1, status: "STALE", provider: "test" })],
      rates: makeRates(),
      events: [],
      macroRisk: "medium",
      hasAnyData: true,
      liveQuoteCount: 0,
    });

    const syntheses = rows.map((row) => buildInvestorDecisionSynthesis(row, macro));
    const summary = buildInvestorPortfolioSummary(syntheses, macro);
    const monitor = buildInvestorMonitorState(summary, syntheses);

    // Position states are isolated and correct (Phase 141 semantics).
    expect(syntheses.find((s) => s.positionId === "pos-a")!.state).toBe("CAUTION"); // stale macro → R6
    expect(syntheses.find((s) => s.positionId === "pos-b")!.state).toBe("INSUFFICIENT_DATA"); // R3
    expect(syntheses.find((s) => s.positionId === "pos-c")!.state).toBe("CAUTION"); // R5

    // Monitor: HIGH_RISK protection anywhere → ELEVATED (M3).
    expect(monitor.state).toBe("ELEVATED");
    const highRisk = findReason(monitor, "HIGH_RISK_PROTECTION")!;
    expect(highRisk.count).toBe(1);
    expect(highRisk.positionIds).toEqual(["pos-b"]);

    // Insufficient-data reason traces only to pos-b.
    const insuff = findReason(monitor, "INSUFFICIENT_DATA")!;
    expect(insuff.count).toBe(1);

    // Changing B must not change A's or C's synthesis.
    const rowB2 = makeRow({
      positionId: "pos-b",
      instrument: "BTC/USD",
      severity: "NONE",
      thesisHealth: "HEALTHY",
      intel: makeIntel("BTC/USD", { thesisHealth: "HEALTHY", severity: "NONE", dataQuality: "SUFFICIENT" }),
    });
    const syntheses2 = [syntheses[0], buildInvestorDecisionSynthesis(rowB2, macro), syntheses[2]];
    expect(syntheses2[0]).toEqual(syntheses[0]);
    expect(syntheses2[2]).toEqual(syntheses[2]);
    expect(syntheses2[1].state).not.toBe(syntheses[1].state);

    // Monitor downgrades accordingly: no HIGH_RISK, no INSUFFICIENT →
    // WATCH (stale macro R6 keeps every position in CAUTION).
    const monitor2 = buildInvestorMonitorState(buildInvestorPortfolioSummary(syntheses2, macro), syntheses2);
    expect(monitor2.state).toBe("WATCH");
    expect(reasonCodes(monitor2)).not.toContain("HIGH_RISK_PROTECTION");
    expect(reasonCodes(monitor2)).toContain("MACRO_STALE");
  });

  it("fresh macro + fully healthy portfolio → STABLE through the real pipeline", () => {
    const rows = [
      makeRow({ positionId: "pos-a", instrument: "BTC/USD" }),
      makeRow({ positionId: "pos-b", instrument: "ETH/USD" }),
    ];
    const syntheses = rows.map((row) => buildInvestorDecisionSynthesis(row, FRESH_MACRO));
    const summary = buildInvestorPortfolioSummary(syntheses, FRESH_MACRO);
    const monitor = buildInvestorMonitorState(summary, syntheses);

    expect(summary.state).toBe("ALIGNED");
    expect(monitor.state).toBe("STABLE");
    expect(monitor.macroStatus).toBe("AVAILABLE");
  });

  it("global macro caution flows through the real pipeline to WATCH", () => {
    const rows = [makeRow({ positionId: "pos-a", instrument: "BTC/USD" })];
    const macro = baseMacro({
      ...FRESH_MACRO,
      macroRisk: "high",
    });
    const syntheses = rows.map((row) => buildInvestorDecisionSynthesis(row, macro));
    const summary = buildInvestorPortfolioSummary(syntheses, macro);
    const monitor = buildInvestorMonitorState(summary, syntheses);

    expect(summary.globalMacroCaution).toBe(true);
    expect(monitor.state).toBe("WATCH");
    expect(reasonCodes(monitor)).toContain("GLOBAL_MACRO_CAUTION");
  });
});

// ═══════════════════════════════════════════════════════════════
// UI CONTRACT AUDIT
// ═══════════════════════════════════════════════════════════════

describe("UI contract audit", () => {
  it("monitor labels match the decision-state vocabulary where they overlap", () => {
    // WATCH and CAUTION share the semantic family; SEVERE/ELEVATED/IDLE are
    // monitor-specific and must exist distinctly.
    expect(mapMonitorState("STABLE", en)).not.toBe(mapDecisionState("ALIGNED", en));
    expect(mapMonitorState("WATCH", en)).not.toBe("");
    expect(mapMonitorState("IDLE", en)).not.toBe(mapDecisionState("UNAVAILABLE", en));
  });

  it("all monitor translation keys exist in every enabled locale (parity)", () => {
    const keys = [
      "monitorSummary", "monitorInfo", "monitorStateLabel",
      "monitorIdle", "monitorStable", "monitorWatch", "monitorElevated", "monitorSevere",
      "monitorReasonNoPositions", "monitorReasonInvalidated", "monitorReasonConflict",
      "monitorReasonHighRisk", "monitorReasonCaution", "monitorReasonInsufficientData",
      "monitorReasonUnavailable", "monitorReasonPartialCoverage", "monitorReasonMacroCaution",
      "monitorReasonMacroStale", "monitorReasonMacroLimited", "monitorReasonMacroUnavailable",
      "monitorReasonConcentration",
    ] as const;
    const locales: Translations[] = [en, id, es, pt];
    for (const t of locales) {
      for (const key of keys) {
        expect(t.investor[key], `${key}`).toBeDefined();
        expect(String(t.investor[key]).length).toBeGreaterThan(0);
      }
    }
  });
});