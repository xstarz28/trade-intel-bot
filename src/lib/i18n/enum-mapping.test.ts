/**
 * Phase 138 — Enum display-mapping tests.
 *
 * Verifies the presentation-only display mappings used by the trader /
 * investor / intelligence surfaces:
 * - every domain value maps to a non-empty translated label in all 4 locales
 * - unknown/future values degrade to a safe non-empty fallback (never blank,
 *   never undefined, never crash)
 * - mapped labels stay stable for known domain values
 * - underlying locale resources keep 4-way parity (imported resources must
 *   contain the referenced keys)
 */
import { describe, it, expect } from "vitest";
import en from "./en";
import id from "./id";
import es from "./es";
import pt from "./pt";
import type { Translations } from "./types";
import {
  mapStance,
  mapPositionImpact,
  mapDirection,
  mapRelevance,
  mapAvailability,
  mapThesisHealth,
  mapConfidence,
  mapDimension,
  mapTrendLabel,
  mapSeverity,
  mapRiskLevel,
  mapHorizon,
  mapMarketState,
  mapDecisionState,
  mapSide,
  mapPullbackClassification,
  mapStrength,
  mapTimelineEventType,
  mapAlignmentType,
  mapConflictType,
  mapPortfolioRisk,
  mapPriority,
} from "./enum-mapping";

const LOCALES: Record<string, Translations> = { en, id, es, pt };

// ─── Helper: every domain value maps to non-empty text in every locale ──
function expectDomainMapped(
  fn: (value: string, t: Translations) => string,
  domain: string[],
) {
  for (const locale of Object.values(LOCALES)) {
    for (const value of domain) {
      const label = fn(value, locale);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      // Display labels must never surface raw interpolation placeholders.
      expect(label).not.toContain("{");
    }
  }
}

// ─── Safe fallback (unknown/future values) ────────────────────────────
describe("Phase 138 — safe fallbacks for unknown enum values", () => {
  it("unknown values never produce undefined/blank for any mapping", () => {
    const unknown = "SOME_FUTURE_STATE";
    for (const locale of Object.values(LOCALES)) {
      for (const fn of [
        mapStance,
        mapPositionImpact,
        mapDirection,
        mapRelevance,
        mapAvailability,
        mapThesisHealth,
        mapConfidence,
        mapDimension,
        mapTrendLabel,
        mapSeverity,
        mapRiskLevel,
        mapHorizon,
      ]) {
        const label = fn(unknown, locale);
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it("lowercase internal directions still resolve through uppercase mapping", () => {
    for (const locale of Object.values(LOCALES)) {
      const label = mapDirection("supporting".toUpperCase(), locale);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

// ─── Trend labels ─────────────────────────────────────────────────────
describe("Phase 138 — mapTrendLabel", () => {
  it("maps every MTF trend classification in every locale", () => {
    expectDomainMapped(mapTrendLabel, ["BULLISH", "BEARISH", "NEUTRAL", "MIXED", "UNKNOWN"]);
  });

  it("maps BULLISH to the localized bullish term", () => {
    expect(mapTrendLabel("BULLISH", en)).toBe(en.analysis.bullish);
    expect(mapTrendLabel("BEARISH", es)).toBe(es.analysis.bearish);
  });
});

// ─── Protection severity labels ───────────────────────────────────────
describe("Phase 138 — mapSeverity", () => {
  it("maps every protection severity in every locale", () => {
    expectDomainMapped(mapSeverity, ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]);
  });

  it("keeps existing semantics stable", () => {
    expect(mapSeverity("NONE", en)).toBe(en.status.none);
    expect(mapSeverity("INVALIDATED", en)).toBe(en.status.invalidated);
    expect(mapSeverity("HIGH_RISK", id)).toBe(id.status.highRisk);
  });
});

// ─── Risk level labels ────────────────────────────────────────────────
describe("Phase 138 — mapRiskLevel", () => {
  it("maps every risk level in every locale", () => {
    expectDomainMapped(mapRiskLevel, ["LOW", "MODERATE", "ELEVATED"]);
  });

  it("keeps existing semantics stable", () => {
    expect(mapRiskLevel("LOW", en)).toBe(en.investor.low);
    expect(mapRiskLevel("MODERATE", id)).toBe(id.investor.moderate);
    expect(mapRiskLevel("ELEVATED", pt)).toBe(pt.investor.elevated);
  });
});

// ─── Horizon labels ───────────────────────────────────────────────────
describe("Phase 138 — mapHorizon", () => {
  it("maps every horizon in every locale to non-empty text", () => {
    expectDomainMapped(mapHorizon, ["SCALPING", "INTRADAY", "SWING", "INVESTING"]);
  });

  it("resolves the newly synchronized horizon keys", () => {
    expect(mapHorizon("SCALPING", en)).toBe(en.investor.horizonScalping);
    expect(mapHorizon("INTRADAY", es)).toBe(es.investor.horizonIntraday);
    expect(mapHorizon("SWING", id)).toBe(id.investor.horizonSwing);
    expect(mapHorizon("INVESTING", pt)).toBe(pt.investor.horizonInvesting);
  });
});

// ─── Thesis health extension ──────────────────────────────────────────
describe("Phase 138 — mapThesisHealth extension", () => {
  it("maps extended states (CAUTION / INSUFFICIENT_DATA / UNKNOWN)", () => {
    expectDomainMapped(mapThesisHealth, [
      "HEALTHY",
      "STABLE",
      "CAUTION",
      "DETERIORATING",
      "SEVERELY_DETERIORATING",
      "INVALIDATED",
      "INSUFFICIENT_DATA",
      "UNKNOWN",
    ]);
  });

  it("keeps existing semantics stable", () => {
    expect(mapThesisHealth("HEALTHY", en)).toBe(en.status.healthy);
    expect(mapThesisHealth("INVALIDATED", en)).toBe(en.status.invalidated);
    expect(mapThesisHealth("CAUTION", en)).toBe(en.status.caution);
    expect(mapThesisHealth("UNKNOWN", en)).toBe(en.status.unknown);
  });
});

// ─── Existing mappings stay intact ────────────────────────────────────
describe("Phase 138 — existing mappings remain intact", () => {
  it("stance / impact / availability / confidence / dimension coverage", () => {
    expectDomainMapped(mapStance, ["SUPPORTING", "CONFLICTING", "MIXED", "NEUTRAL", "INSUFFICIENT"]);
    expectDomainMapped(mapPositionImpact, ["SUPPORTING", "CONFLICTING", "NEUTRAL", "INSUFFICIENT"]);
    expectDomainMapped(mapAvailability, ["AVAILABLE", "LIMITED", "INSUFFICIENT", "STALE", "UNAVAILABLE"]);
    expectDomainMapped(mapConfidence, [
      "STRONG_EVIDENCE",
      "MODERATE_EVIDENCE",
      "WEAK_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "HIGH",
      "MEDIUM",
      "LOW",
      "UNAVAILABLE",
    ]);
    expectDomainMapped(mapDimension, ["TECHNICAL", "MACRO", "CROSS_ASSET", "DERIVATIVES", "NEWS", "FUNDAMENTALS"]);
  });

  it("mapped text never leaks raw placeholders", () => {
    const label = mapThesisHealth("HEALTHY", en);
    expect(label).not.toContain("{");
  });

  // ─── Market state labels (actual MarketIntelligenceSummary domain) ────
  it("maps the real market-state domain in every locale", () => {
    expectDomainMapped(mapMarketState, [
      "TRENDING_UP",
      "TRENDING_DOWN",
      "RANGING",
      "VOLATILE",
      "INSUFFICIENT_DATA",
      "UNKNOWN",
    ]);
  });

  it("keeps market-state semantics stable", () => {
    expect(mapMarketState("TRENDING_UP", en)).toBe(en.analysis.bullish);
    expect(mapMarketState("TRENDING_DOWN", id)).toBe(id.analysis.bearish);
    expect(mapMarketState("RANGING", es)).toBe(es.intelligence.ranging);
    expect(mapMarketState("VOLATILE", pt)).toBe(pt.intelligence.volatilityLabel);
    expect(mapMarketState("INSUFFICIENT_DATA", en)).toBe(en.intelligence.insufficientData);
  });

  it("market-state mapping never fabricates a label for unknown states", () => {
    for (const locale of Object.values(LOCALES)) {
      const label = mapMarketState("SOME_FUTURE_MARKET_STATE", locale);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  // ─── Investor decision-state labels (Phase 141) ──────────────────────
  it("maps every decision state in every locale", () => {
    expectDomainMapped(mapDecisionState,    [
      "ALIGNED",
      "CONFLICT",
      "CAUTION",
      "INSUFFICIENT_DATA",
      "UNAVAILABLE",
    ]);
  });

  it("keeps decision-state semantics stable", () => {
    expect(mapDecisionState("ALIGNED", en)).toBe(en.investor.decisionStateAligned);
    expect(mapDecisionState("CONFLICT", id)).toBe(id.investor.decisionStateConflict);
    expect(mapDecisionState("CAUTION", pt)).toBe(pt.status.caution);
    expect(mapDecisionState("INSUFFICIENT_DATA", es)).toBe(es.status.insufficientData);
    expect(mapDecisionState("UNAVAILABLE", en)).toBe(en.status.unavailable);
  });

  it("unknown decision states never produce blank output", () => {
    for (const locale of Object.values(LOCALES)) {
      const label = mapDecisionState("SOME_FUTURE_STATE", locale);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("{");
    }
  });
});

// ─── Phase 147 — decision-surface wiring ────────────────────────
describe("Phase 147 — decision-surface wiring mappings", () => {
  it("mapSide covers LONG/SHORT in every locale with a safe fallback", () => {
    expectDomainMapped(mapSide, ["LONG", "SHORT"]);
    expect(mapSide("LONG", en)).toBe(en.analysis.long);
    expect(mapSide("SHORT", en)).toBe(en.analysis.short);
    const unknown = mapSide("SOME_FUTURE_SIDE", en);
    expect(typeof unknown).toBe("string");
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown).not.toMatch(/_/);
  });

  it("mapPullbackClassification covers the full engine domain", () => {
    expectDomainMapped(mapPullbackClassification, [
      "NORMAL_PULLBACK", "EARLY_CORRECTION", "MEANINGFUL_DETERIORATION",
      "STRUCTURAL_REVERSAL", "SHOCK_REVERSAL", "INSUFFICIENT_DATA",
    ]);
    expect(mapPullbackClassification("EARLY_CORRECTION", en)).toBe(en.intelligence.pullbackEarlyCorrection);
    expect(mapPullbackClassification("SHOCK_REVERSAL", en)).toBe(en.intelligence.pullbackShockReversal);
  });

  it("mapStrength maps change strength without raw leakage", () => {
    expectDomainMapped(mapStrength, ["STRONG", "MODERATE", "WEAK"]);
    expect(mapStrength("STRONG", en)).toBe(en.alerts.high);
    expect(mapStrength("MODERATE", id)).toBe(id.alerts.medium);
    expect(mapStrength("WEAK", pt)).toBe(pt.alerts.low);
  });

  it("mapTimelineEventType maps the full 11-value domain", () => {
    expectDomainMapped(mapTimelineEventType, [
      "INITIAL_ANALYSIS", "THESIS_CHANGE", "REGIME_CHANGE",
      "TIMEFRAME_CHANGE", "STRUCTURE_CHANGE", "MOMENTUM_CHANGE",
      "VOLATILITY_CHANGE", "EVIDENCE_CHANGE", "NEWS_CHANGE",
      "MACRO_CHANGE", "DATA_QUALITY_CHANGE",
    ]);
    expect(mapTimelineEventType("THESIS_CHANGE", en)).toBe(en.timeline.thesisChange);
    expect(mapTimelineEventType("DATA_QUALITY_CHANGE", es)).toBe(es.timeline.dataQualityChange);
  });

  it("mapAlignmentType / mapConflictType cover portfolio domains", () => {
    expectDomainMapped(mapAlignmentType, [
      "REGIME_MATCH", "HTF_ALIGNMENT", "CONCENTRATION", "DIRECTIONAL_CONCENTRATION",
    ]);
    expectDomainMapped(mapConflictType, [
      "DIRECT_DIRECTIONAL", "EVIDENCE_CONFLICT", "REGIME",
    ]);
    expect(mapAlignmentType("REGIME_MATCH", en)).toBe(en.portfolio.alignmentRegimeMatch);
    expect(mapConflictType("EVIDENCE_CONFLICT", pt)).toBe(pt.portfolio.conflictEvidenceConflict);
  });

  it("mapPortfolioRisk / mapPriority / mapAvailability(SIMULATED) resolve", () => {
    expectDomainMapped(mapPortfolioRisk, ["LOW_CONCERN", "MIXED", "ELEVATED_CONCERN", "INSUFFICIENT_DATA"]);
    expectDomainMapped(mapPriority, ["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expectDomainMapped(mapAvailability, ["AVAILABLE", "LIMITED", "INSUFFICIENT", "STALE", "UNAVAILABLE", "LIVE", "SIMULATED"]);
    expect(mapAvailability("SIMULATED", en)).toBe(en.status.simulated);
    expect(mapPortfolioRisk("ELEVATED_CONCERN", en)).toBe(en.investor.elevated);
  });
});
