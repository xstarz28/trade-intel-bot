/**
 * Phase 147 — Global product UX consistency + decision-surface audit.
 *
 * Verifies the centralized display-mapping invariants every decision surface
 * relies on:
 *
 * - every canonical state family (alert severity, rule scope, thesis health,
 *   protection severity, freshness, availability, completeness/coverage,
 *   monitor state, decision state, runtime health) has a non-empty,
 *   stable, translated label in ALL NINE locales
 * - known domain values resolve to the exact registered translation key
 *   (single mapping source of truth — no per-surface label drift)
 * - unknown/future values degrade to a safe, non-empty fallback
 * - display labels never leak raw `{placeholder}` syntax
 * - the previously-unmapped INFO alert severity and rule scope values are
 *   now covered (regression guards for the Phase 147 wiring)
 *
 * This file audits PRESENTATION mapping only. Internal enum values and
 * engine semantics are intentionally untouched.
 */
import { describe, it, expect } from "vitest";
import en from "./en";
import id from "./id";
import es from "./es";
import pt from "./pt";
import fr from "./fr";
import de from "./de";
import ja from "./ja";
import ko from "./ko";
import zh from "./zh";
import type { Translations } from "./types";
import {
  mapPriority,
  mapScope,
  mapFreshness,
  mapAvailability,
  mapCompleteness,
  mapCoverage,
  mapSeverity,
  mapMonitorState,
  mapDecisionState,
  mapThesisHealth,
  mapIntelligenceStatus,
  mapStance,
  mapPositionImpact,
  mapDirection,
  mapRelevance,
  mapConfidence,
  mapDimension,
  mapTrendLabel,
  mapMarketState,
  mapRiskLevel,
  mapHorizon,
  mapSide,
  mapPullbackClassification,
  mapStrength,
  mapTimelineEventType,
  mapAlignmentType,
  mapConflictType,
  mapPortfolioRisk,
  mapSensitivity,
  mapRegimeValue,
  mapAssessment,
  mapInvalidationStatus,
} from "./enum-mapping";

const LOCALES: Record<string, Translations> = { en, id, es, pt, fr, de, ja, ko, zh };
const NINE = Object.values(LOCALES);

// ─── Helpers ──────────────────────────────────────────────────────

/** Assert a domain maps to non-empty, placeholder-free text in all nine locales. */
function expectDomainMapped(
  fn: (value: string, t: Translations) => string,
  domain: string[],
) {
  for (const locale of NINE) {
    for (const value of domain) {
      const label = fn(value, locale);
      const key = localeKey(locale);
      expect(typeof label, `${value} in ${key}`).toBe("string");
      expect(label.length, `${value} → blank in ${key}`).toBeGreaterThan(0);
      expect(label, `${value} leaked placeholder in ${key}`).not.toContain("{");
    }
  }
}

/** Assert a domain resolves to exactly the registered translation key. */
function expectStableKeys(
  fn: (value: string, t: Translations) => string,
  pairs: [value: string, keyPath: (t: Translations) => string][],
) {
  for (const locale of NINE) {
    for (const [value, pick] of pairs) {
      expect(fn(value, locale)).toBe(pick(locale));
    }
  }
}

function localeKey(t: Translations): string {
  const entry = Object.entries(LOCALES).find(([, res]) => res === t);
  return entry ? entry[0] : "?";
}

// ─── Alert severity / priority + scope (Phase 147 wiring) ─────────

describe("Phase 147 — alert severity & rule scope consistency", () => {
  it("maps every alert severity (INFO..CRITICAL) to non-empty labels in all 9 locales", () => {
    expectDomainMapped(mapPriority, ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it("INFO is covered by the registered alerts.info key (previously unmapped)", () => {
    expectStableKeys(mapPriority, [
      ["INFO", (t) => t.alerts.info],
      ["LOW", (t) => t.alerts.low],
      ["MEDIUM", (t) => t.alerts.medium],
      ["HIGH", (t) => t.alerts.high],
      ["CRITICAL", (t) => t.alerts.critical],
    ]);
  });

  it("maps every alert-rule scope to the registered scope keys in all 9 locales", () => {
    expectStableKeys(mapScope, [
      ["POSITION", (t) => t.alerts.positionScope],
      ["INSTRUMENT", (t) => t.alerts.instrumentScope],
      ["PORTFOLIO", (t) => t.alerts.portfolioScope],
      ["GLOBAL", (t) => t.alerts.globalScope],
    ]);
  });

  it("severity & scope keys are non-empty in every locale (no silent EN fallback)", () => {
    for (const locale of NINE) {
      for (const label of [
        locale.alerts.info,
        locale.alerts.low,
        locale.alerts.medium,
        locale.alerts.high,
        locale.alerts.critical,
        locale.alerts.positionScope,
        locale.alerts.instrumentScope,
        locale.alerts.portfolioScope,
        locale.alerts.globalScope,
      ]) {
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── Cross-surface state families ────────────────────────────────

describe("Phase 147 — thesis health family (thesis ≠ protection axis)", () => {
  it("maps every thesis-health state to non-empty labels in all 9 locales", () => {
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

  it("resolves to the registered status keys", () => {
    expectStableKeys(mapThesisHealth, [
      ["HEALTHY", (t) => t.status.healthy],
      ["STABLE", (t) => t.status.stable],
      ["CAUTION", (t) => t.status.caution],
      ["INVALIDATED", (t) => t.status.invalidated],
      ["INSUFFICIENT_DATA", (t) => t.status.insufficientData],
      ["UNKNOWN", (t) => t.status.unknown],
    ]);
  });
});

describe("Phase 147 — protection severity family", () => {
  it("maps every protection severity to non-empty labels in all 9 locales", () => {
    expectDomainMapped(mapSeverity, ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]);
  });

  it("resolves to the registered status keys", () => {
    expectStableKeys(mapSeverity, [
      ["NONE", (t) => t.status.none],
      ["WATCH", (t) => t.status.watch],
      ["CAUTION", (t) => t.status.caution],
      ["HIGH_RISK", (t) => t.status.highRisk],
      ["INVALIDATED", (t) => t.status.invalidated],
    ]);
  });
});

describe("Phase 147 — investor monitor + decision state families", () => {
  it("maps every monitor state (IDLE..SEVERE) to non-empty labels in all 9 locales", () => {
    expectDomainMapped(mapMonitorState, ["IDLE", "STABLE", "WATCH", "ELEVATED", "SEVERE"]);
  });

  it("maps every decision state (ALIGNED/CONFLICT/CAUTION/…) in all 9 locales", () => {
    expectDomainMapped(mapDecisionState, [
      "ALIGNED",
      "CONFLICT",
      "CAUTION",
      "INSUFFICIENT_DATA",
      "UNAVAILABLE",
    ]);
  });

  it("resolves monitor & decision states to their registered investor keys", () => {
    expectStableKeys(mapMonitorState, [
      ["IDLE", (t) => t.investor.monitorIdle],
      ["STABLE", (t) => t.investor.monitorStable],
      ["WATCH", (t) => t.investor.monitorWatch],
      ["ELEVATED", (t) => t.investor.monitorElevated],
      ["SEVERE", (t) => t.investor.monitorSevere],
    ]);
    expectStableKeys(mapDecisionState, [
      ["ALIGNED", (t) => t.investor.decisionStateAligned],
      ["CONFLICT", (t) => t.investor.decisionStateConflict],
    ]);
  });
});

describe("Phase 147 — data freshness / availability / completeness axes", () => {
  it("maps every freshness state (FRESH..UNAVAILABLE) in all 9 locales", () => {
    expectDomainMapped(mapFreshness, ["FRESH", "RECENT", "DELAYED", "STALE", "UNAVAILABLE"]);
  });

  it("maps every availability state in all 9 locales", () => {
    expectDomainMapped(mapAvailability, [
      "AVAILABLE",
      "LIMITED",
      "INSUFFICIENT",
      "STALE",
      "UNAVAILABLE",
      "LIVE",
      "SIMULATED",
    ]);
  });

  it("maps completeness & coverage states (FULL/PARTIAL/…) in all 9 locales", () => {
    expectDomainMapped(mapCompleteness, ["FULL", "PARTIAL", "MINIMAL", "NONE"]);
    expectDomainMapped(mapCoverage, ["FULL", "PARTIAL", "EMPTY"]);
  });

  it("resolves freshness & completeness to their registered market-panel keys", () => {
    expectStableKeys(mapFreshness, [
      ["FRESH", (t) => t.marketPanel.freshness.fresh],
      ["RECENT", (t) => t.marketPanel.freshness.recent],
      ["DELAYED", (t) => t.marketPanel.freshness.delayed],
      ["STALE", (t) => t.marketPanel.freshness.stale],
      ["UNAVAILABLE", (t) => t.marketPanel.freshness.unavailable],
    ]);
    expectStableKeys(mapCompleteness, [
      ["FULL", (t) => t.marketPanel.completeness.full],
      ["PARTIAL", (t) => t.marketPanel.completeness.partial],
      ["MINIMAL", (t) => t.marketPanel.completeness.minimal],
      ["NONE", (t) => t.marketPanel.completeness.none],
    ]);
  });

  it("partial-freshness anti-pattern guard: STALE freshness renders via mapFreshness, not mapAvailability", () => {
    // InvestorWorkspace previously mapped only "STALE" through mapAvailability
    // and leaked every other freshness value raw. Both mappers must resolve
    // non-empty so full-domain mapping can replace the partial ternary.
    for (const locale of NINE) {
      expect(mapFreshness("STALE", locale).length).toBeGreaterThan(0);
      expect(mapAvailability("STALE", locale).length).toBeGreaterThan(0);
      expect(mapFreshness("FRESH", locale).length).toBeGreaterThan(0);
      expect(mapFreshness("DELAYED", locale).length).toBeGreaterThan(0);
    }
  });
});

describe("Phase 147 — runtime/provider health family", () => {
  it("maps every intelligence-cycle status (HEALTHY/DEGRADED/…) in all 9 locales", () => {
    expectDomainMapped(mapIntelligenceStatus, ["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNKNOWN"]);
  });

  it("resolves to the registered system/status keys", () => {
    expectStableKeys(mapIntelligenceStatus, [
      ["HEALTHY", (t) => t.status.healthy],
      ["DEGRADED", (t) => t.system.degraded],
      ["UNAVAILABLE", (t) => t.status.unavailable],
      ["UNKNOWN", (t) => t.status.unknown],
    ]);
  });
});

// ─── Remaining registered families (regression sweep) ─────────────

describe("Phase 147 — remaining registered display families", () => {
  const sweep: [string, (v: string, t: Translations) => string, string[]][] = [
    ["stance", mapStance, ["SUPPORTING", "CONFLICTING", "MIXED", "NEUTRAL", "INSUFFICIENT"]],
    ["position impact", mapPositionImpact, ["SUPPORTING", "CONFLICTING", "NEUTRAL", "INSUFFICIENT"]],
    ["evidence direction", mapDirection, ["SUPPORTING", "CONFLICTING", "NEUTRAL"]],
    ["relevance", mapRelevance, ["DIRECT", "HIGH", "MODERATE", "LOW", "IRRELEVANT", "UNKNOWN"]],
    ["confidence", mapConfidence, ["HIGH", "MEDIUM", "LOW", "UNAVAILABLE", "STRONG_EVIDENCE", "MODERATE_EVIDENCE", "WEAK_EVIDENCE", "INSUFFICIENT_EVIDENCE"]],
    ["dimension", mapDimension, ["TECHNICAL", "MACRO", "CROSS_ASSET", "DERIVATIVES", "NEWS", "FUNDAMENTALS"]],
    ["trend", mapTrendLabel, ["BULLISH", "BEARISH", "NEUTRAL", "MIXED", "UNKNOWN"]],
    ["market state", mapMarketState, ["TRENDING_UP", "TRENDING_DOWN", "VOLATILE", "RANGING", "PULLBACK", "INSUFFICIENT_DATA", "UNKNOWN"]],
    ["risk level", mapRiskLevel, ["LOW", "MODERATE", "ELEVATED"]],
    ["horizon", mapHorizon, ["SCALPING", "INTRADAY", "SWING", "INVESTING", "1-4_WEEKS", "1-3_MONTHS", "3-6_MONTHS", "6-12_MONTHS", "1-3_YEARS", "3+_YEARS"]],
    ["position side", mapSide, ["LONG", "SHORT"]],
    ["pullback classification", mapPullbackClassification, ["NORMAL_PULLBACK", "EARLY_CORRECTION", "MEANINGFUL_DETERIORATION", "STRUCTURAL_REVERSAL", "SHOCK_REVERSAL", "INSUFFICIENT_DATA"]],
    ["change strength", mapStrength, ["STRONG", "MODERATE", "WEAK"]],
    ["timeline event type", mapTimelineEventType, ["INITIAL_ANALYSIS", "THESIS_CHANGE", "REGIME_CHANGE", "TIMEFRAME_CHANGE", "STRUCTURE_CHANGE", "MOMENTUM_CHANGE", "VOLATILITY_CHANGE", "EVIDENCE_CHANGE", "NEWS_CHANGE", "MACRO_CHANGE", "DATA_QUALITY_CHANGE"]],
    ["portfolio alignment type", mapAlignmentType, ["REGIME_MATCH", "HTF_ALIGNMENT", "CONCENTRATION", "DIRECTIONAL_CONCENTRATION"]],
    ["portfolio conflict type", mapConflictType, ["DIRECT_DIRECTIONAL", "EVIDENCE_CONFLICT", "REGIME"]],
    ["portfolio risk context", mapPortfolioRisk, ["LOW_CONCERN", "MIXED", "ELEVATED_CONCERN", "INSUFFICIENT_DATA"]],
    ["sensitivity", mapSensitivity, ["HIGH", "MODERATE", "LOW", "UNKNOWN"]],
    ["regime value", mapRegimeValue, ["EASING", "TIGHTENING", "RESTRICTIVE", "TRANSITIONING", "RISING", "FALLING", "STABLE", "STRENGTHENING", "WEAKENING", "VOLATILE", "EXPANDING", "SLOWING", "CONTRACTING", "RECOVERING", "BALANCED", "STRESSED", "RISK_ON", "RISK_OFF", "MIXED", "STAGFLATION", "REFLATION", "DISINFLATION", "CONTRACTION", "RECOVERY", "INSUFFICIENT_DATA", "UNAVAILABLE", "HIGH", "ACCELERATING", "SUPPLY_DRIVEN", "SUPPLY_DISRUPTION", "DEMAND_DRIVEN", "OIL_SHOCK", "ESCALATING", "DEESCALATING"]],
    ["decision assessment", mapAssessment, ["COUNT_SUPPORTING", "COUNT_CONFLICTING", "MIXED_EVIDENCE", "INSUFFICIENT_DATA", "SUPPORTING", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"]],
    ["invalidation status", mapInvalidationStatus, ["NOT_APPROACHING", "APPROACHING", "TRIGGERED", "UNAVAILABLE"]],
  ];

  it("every registered family maps all known domain values in all 9 locales", () => {
    for (const [name, fn, domain] of sweep) {
      expectDomainMapped(fn, domain);
      void name;
    }
  });

  it("unknown/future values always produce a safe non-empty fallback", () => {
    const unknown = "SOME_FUTURE_STATE_147";
    const allFns = [
      mapPriority, mapScope, mapFreshness, mapAvailability, mapCompleteness,
      mapCoverage, mapSeverity, mapMonitorState, mapDecisionState, mapThesisHealth,
      mapIntelligenceStatus, mapStance, mapPositionImpact, mapDirection,
      mapRelevance, mapConfidence, mapDimension, mapTrendLabel, mapMarketState,
      mapRiskLevel, mapHorizon, mapSide, mapPullbackClassification, mapStrength,
      mapTimelineEventType, mapAlignmentType, mapConflictType, mapPortfolioRisk,
      mapSensitivity, mapRegimeValue, mapAssessment, mapInvalidationStatus,
    ];
    for (const locale of NINE) {
      for (const fn of allFns) {
        const label = fn(unknown, locale);
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toContain("{");
        expect(label).not.toBeUndefined();
      }
    }
  });
});
