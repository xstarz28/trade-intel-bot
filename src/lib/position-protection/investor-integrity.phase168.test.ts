/**
 * Phase 168 — Investor decision surface integrity.
 *
 * Exercises the REAL investor pipeline (synthesis -> portfolio summary) rather
 * than mocking it, asserting the properties the product depends on:
 *
 *  - trader and investor semantics never collapse into one another,
 *  - missing data stays visible instead of being averaged away,
 *  - portfolio aggregation is arithmetically faithful to its inputs,
 *  - provider availability never becomes directional evidence,
 *  - no fabricated precision when nothing was reported.
 */

import { describe, expect, it } from "vitest";
import { buildInvestorDecisionSynthesis } from "./investor-decision-synthesis";
import { buildInvestorPortfolioSummary } from "./investor-portfolio-summary";
import type { InvestorIntelRow } from "./investor-intelligence-view";
import type { InvestorMacroContext } from "./investor-macro-context";
import type { PositionIntelligence } from "./market-intelligence-analyzer";

const NEUTRAL_MACRO: InvestorMacroContext = {
  quotes: [],
  rates: { rows: [], freshness: null } as never,
  events: [],
  macroRisk: null,
  hasAnyData: false,
  liveQuoteCount: 0,
} as InvestorMacroContext;

function intel(over: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 80_000,
    entryPrice: 75_000,
    marketState: "BULLISH",
    shortTermContext: "s",
    mediumTermContext: "m",
    volatilityContext: "v",
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    confidence: "MODERATE_EVIDENCE",
    evidence: [],
    supportingEvidence: [],
    conflictingEvidence: [],
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [],
    nextMonitor: [],
    actionRecommendation: "HOLD",
    ...over,
  } as PositionIntelligence;
}

function row(over: Partial<InvestorIntelRow> = {}): InvestorIntelRow {
  return {
    positionId: "pos-1",
    instrument: "BTC/USDT",
    side: "LONG",
    horizon: "INVESTING",
    entryPrice: 75_000,
    openedAt: 1_700_000_000_000,
    severity: "NONE",
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    intel: intel(),
    ...over,
  };
}

describe("missing intelligence stays explicit", () => {
  it("a position with no intel synthesizes to UNAVAILABLE, never to a decision", () => {
    const s = buildInvestorDecisionSynthesis(row({ intel: null }), NEUTRAL_MACRO);

    expect(s.state).toBe("UNAVAILABLE");
    expect(s.flags).toContain("INTEL_UNAVAILABLE");
    // Must not be silently upgraded to a tradable-looking state.
    expect(s.state).not.toBe("ALIGNED");
  });

  it("absent macro data does not become a bullish or bearish signal", () => {
    const withNoMacro = buildInvestorDecisionSynthesis(row(), NEUTRAL_MACRO);
    const withMacroData = buildInvestorDecisionSynthesis(row(), {
      ...NEUTRAL_MACRO,
      hasAnyData: true,
      macroRisk: "low",
    } as InvestorMacroContext);

    // Availability of the macro provider must not change the pillar outcome.
    expect(withNoMacro.thesis.health).toBe(withMacroData.thesis.health);
    expect(withNoMacro.protection.severity).toBe(withMacroData.protection.severity);
  });

  it("high macro risk flags globally without inventing a per-position signal", () => {
    const s = buildInvestorDecisionSynthesis(row(), {
      ...NEUTRAL_MACRO,
      hasAnyData: true,
      macroRisk: "high",
    } as InvestorMacroContext);

    expect(s.flags).toContain("GLOBAL_MACRO_CAUTION");
    // The position's own thesis is untouched by a global condition.
    expect(s.thesis.health).toBe("HEALTHY");
  });
});

describe("invalidation is never softened", () => {
  it("an invalidated thesis always synthesizes to CONFLICT", () => {
    const s = buildInvestorDecisionSynthesis(
      row({ thesisHealth: "INVALIDATED" }),
      NEUTRAL_MACRO,
    );
    expect(s.state).toBe("CONFLICT");
  });

  it("an invalidated protection severity always synthesizes to CONFLICT", () => {
    const s = buildInvestorDecisionSynthesis(
      row({ severity: "INVALIDATED" }),
      NEUTRAL_MACRO,
    );
    expect(s.state).toBe("CONFLICT");
  });

  it("keeps thesis health and protection severity as distinct pillars", () => {
    const s = buildInvestorDecisionSynthesis(
      row({ thesisHealth: "HEALTHY", severity: "HIGH_RISK" }),
      NEUTRAL_MACRO,
    );

    // The two must never be conflated into a single number.
    expect(s.thesis.health).toBe("HEALTHY");
    expect(s.protection.severity).toBe("HIGH_RISK");
  });
});

describe("portfolio aggregation is faithful to its inputs", () => {
  const synth = (over: Partial<InvestorIntelRow>) =>
    buildInvestorDecisionSynthesis(row(over), NEUTRAL_MACRO);

  it("an empty portfolio is UNAVAILABLE, not a neutral 0% reading", () => {
    const summary = buildInvestorPortfolioSummary([]);

    expect(summary.state).toBe("UNAVAILABLE");
    expect(summary.coverage).toBe("EMPTY");
    expect(summary.totalMonitored).toBe(0);
  });

  it("counts every monitored position exactly once", () => {
    const summary = buildInvestorPortfolioSummary([
      synth({ positionId: "a" }),
      synth({ positionId: "b" }),
      synth({ positionId: "c" }),
    ]);
    expect(summary.totalMonitored).toBe(3);
  });

  it("surfaces unavailable positions instead of hiding them", () => {
    const summary = buildInvestorPortfolioSummary([
      synth({ positionId: "a" }),
      synth({ positionId: "b", intel: null }),
    ]);

    // The position with no intel must be visible as unavailable, never
    // silently dropped from the denominator.
    expect(summary.totalMonitored).toBe(2);
    expect(summary.flags).toContain("HAS_UNAVAILABLE");
    expect(summary.stateCounts.unavailable).toBe(1);
  });

  it("never reports FULL coverage when macro evidence is absent", () => {
    // ALIGNED requires fresh global macro evidence. With none, positions
    // degrade to INSUFFICIENT_DATA and coverage must not claim FULL.
    const summary = buildInvestorPortfolioSummary([
      synth({ positionId: "a" }),
      synth({ positionId: "b" }),
    ]);

    expect(summary.coverage).not.toBe("FULL");
    expect(summary.flags).toContain("HAS_INSUFFICIENT");
  });

  it("a single conflict puts the whole portfolio in CONFLICT", () => {
    const summary = buildInvestorPortfolioSummary([
      synth({ positionId: "a" }),
      synth({ positionId: "b", thesisHealth: "INVALIDATED" }),
    ]);

    expect(summary.state).toBe("CONFLICT");
    expect(summary.flags).toContain("HAS_CONFLICT");
  });

  it("detects instrument concentration only at 2+ positions", () => {
    const one = buildInvestorPortfolioSummary([synth({ positionId: "a" })]);
    expect(one.concentration.entries).toEqual([]);
    expect(one.concentration.distinctInstruments).toBe(1);

    const two = buildInvestorPortfolioSummary([
      synth({ positionId: "a", instrument: "BTC/USDT" }),
      synth({ positionId: "b", instrument: "BTC/USDT" }),
    ]);
    expect(two.concentration.entries).toEqual([
      { instrument: "BTC/USDT", positionCount: 2 },
    ]);
  });

  it("does not merge distinct instruments into one concentration bucket", () => {
    const summary = buildInvestorPortfolioSummary([
      synth({ positionId: "a", instrument: "BTC/USDT" }),
      synth({ positionId: "b", instrument: "ETH/USDT" }),
    ]);
    expect(summary.concentration.entries).toEqual([]);
    expect(summary.concentration.distinctInstruments).toBe(2);
  });

  it("is deterministic for identical input", () => {
    const build = () =>
      buildInvestorPortfolioSummary([
        synth({ positionId: "a" }),
        synth({ positionId: "b", severity: "HIGH_RISK" }),
      ]);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe("instrument and position isolation", () => {
  it("each synthesis references only its own positionId", () => {
    const a = buildInvestorDecisionSynthesis(
      row({ positionId: "pos-a", instrument: "BTC/USDT" }),
      NEUTRAL_MACRO,
    );
    const b = buildInvestorDecisionSynthesis(
      row({ positionId: "pos-b", instrument: "ETH/USDT", thesisHealth: "INVALIDATED" }),
      NEUTRAL_MACRO,
    );

    expect(a.instrument).toBe("BTC/USDT");
    expect(b.instrument).toBe("ETH/USDT");
    // One position's invalidation must not leak into the other.
    expect(a.state).not.toBe("CONFLICT");
    expect(b.state).toBe("CONFLICT");
  });
});
