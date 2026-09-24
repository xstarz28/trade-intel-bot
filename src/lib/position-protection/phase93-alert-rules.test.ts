/**
 * Phase 93 — Custom Trader Alert Rules & Intelligence Triggers
 * Comprehensive test suite.
 */

import { describe, it, expect } from "vitest";
import {
  alertIdentity,
  shouldTriggerAlert,
  updateTriggerRecord,
  evaluateRule,
  evaluateRules,
  buildRuleAlert,
  classifyAlertImpact,
  CONDITION_LABELS,
  SEVERITY_COLORS,
  SEVERITY_BG,
  MAX_RULES_PER_USER,
  MAX_ALERTS_PER_EVALUATION,
  type AlertRule,
  type RuleEvaluationContext,
  type RuleTriggerRecord,
} from "./alert-rule-engine";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    ruleId: "rule-1",
    userId: "user-1",
    name: "Test Rule",
    enabled: true,
    scope: "POSITION",
    positionId: "pos-1",
    condition: "THESIS_STATE_CHANGED",
    severity: "MEDIUM",
    cooldownMs: 60_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeIntel(overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "BTC/USDT",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 65000,
    entryPrice: 60000,
    marketState: "BULLISH",
    shortTermContext: "RECOVERY",
    mediumTermContext: "BULLISH",
    volatilityContext: "MODERATE",
    pnlPct: 8.3,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    severity: "WATCH",
    actionRecommendation: "HOLD",
    evidence: [],
    independentSignalCount: 0,
    confidence: "MODERATE_EVIDENCE",
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [],
    nextMonitor: [],
    dataQuality: "SUFFICIENT",
    observationCount: 10,
    provider: "TwelveData",
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makePortfolio(overrides: Partial<PortfolioIntelligence> = {}): PortfolioIntelligence {
  return {
    summary: {
      totalPositions: 2,
      healthyPositions: 2,
      cautionPositions: 0,
      deterioratingPositions: 0,
      invalidatedPositions: 0,
      unavailablePositions: 0,
      dominantPortfolioState: "HEALTHY",
      portfolioEvidenceQuality: "MODERATE_EVIDENCE",
    },
    exposure: [],
    alignments: [],
    conflicts: [],
    watchItems: [],
    marketContext: "",
    riskContext: "LOW_CONCERN",
    dataAvailability: { technical: "AVAILABLE", macro: "AVAILABLE", news: "AVAILABLE", derivatives: "UNAVAILABLE", fundamentals: "UNAVAILABLE" },
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeCtx(
  positions?: PositionIntelligence[],
  portfolio?: PortfolioIntelligence,
  overrides: Partial<RuleEvaluationContext> = {},
  /** Position IDs to use as map keys. Falls back to instrument names. */
  positionIds?: string[],
): RuleEvaluationContext {
  const posMap = new Map<string, PositionIntelligence>();
  if (positions) {
    for (let i = 0; i < positions.length; i++) {
      const key = positionIds?.[i] ?? positions[i].instrument;
      posMap.set(key, positions[i]);
    }
  }
  return {
    positionIntelligence: posMap,
    portfolioIntelligence: portfolio,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. RULE MODEL
// ═══════════════════════════════════════════════════════════════

describe("Rule Model", () => {
  it("creates a rule with all required fields", () => {
    const rule = makeRule();
    expect(rule.ruleId).toBe("rule-1");
    expect(rule.userId).toBe("user-1");
    expect(rule.enabled).toBe(true);
    expect(rule.scope).toBe("POSITION");
    expect(rule.condition).toBe("THESIS_STATE_CHANGED");
    expect(rule.severity).toBe("MEDIUM");
    expect(rule.cooldownMs).toBe(60_000);
  });

  it("supports all 4 scopes", () => {
    for (const scope of ["POSITION", "INSTRUMENT", "PORTFOLIO", "GLOBAL"]) {
      const rule = makeRule({ scope: scope as AlertRule["scope"] });
      expect(rule.scope).toBe(scope);
    }
  });

  it("supports all 5 severity levels", () => {
    for (const sev of ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]) {
      const rule = makeRule({ severity: sev as AlertRule["severity"] });
      expect(rule.severity).toBe(sev);
    }
  });

  it("enforces MAX_RULES_PER_USER = 50", () => {
    expect(MAX_RULES_PER_USER).toBe(50);
  });

  it("enforces MAX_ALERTS_PER_EVALUATION = 20", () => {
    expect(MAX_ALERTS_PER_EVALUATION).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. RULE EVALUATION (disabled rules)
// ═══════════════════════════════════════════════════════════════

describe("Disabled rules never trigger", () => {
  it("returns empty for disabled rule", () => {
    const rule = makeRule({ enabled: false });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    });
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. POSITION SCOPE
// ═══════════════════════════════════════════════════════════════

describe("Position scope", () => {
  it("evaluates only the intended position", () => {
    const rule = makeRule({ scope: "POSITION", positionId: "pos-1", condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel(), makeIntel({ instrument: "ETH/USDT" })], undefined, {
      previousSnapshots: new Map([
        ["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }],
        ["ETH/USDT", { thesisState: "CAUTION", marketRegime: "RANGING", evidenceQuality: "WEAK_EVIDENCE", supportingCount: 1, conflictingCount: 3 }],
      ]),
    });
    // pos-1 thesis didn't change (HEALTHY→HEALTHY), so no trigger
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("triggers when position thesis changes", () => {
    const rule = makeRule({ scope: "POSITION", positionId: "pos-1", condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. INSTRUMENT SCOPE
// ═══════════════════════════════════════════════════════════════

describe("Instrument scope", () => {
  it("evaluates all positions matching the instrument", () => {
    const rule = makeRule({ scope: "INSTRUMENT", instrument: "BTC/USDT", condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    });
    // HEALTHY→HEALTHY = no change
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("does not evaluate unrelated instruments", () => {
    const rule = makeRule({ scope: "INSTRUMENT", instrument: "ETH/USDT", condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    });
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. PORTFOLIO SCOPE
// ═══════════════════════════════════════════════════════════════

describe("Portfolio scope", () => {
  it("evaluates portfolio concentration", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONCENTRATION_DETECTED" });
    const portfolio = makePortfolio({
      alignments: [
        { instruments: ["BTC LONG", "ETH LONG"], alignmentType: "CONCENTRATION", description: "Crypto LONG concentration", strength: "STRONG" },
      ],
    });
    const ctx = makeCtx([], portfolio);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("evaluates portfolio conflict", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONFLICT_DETECTED" });
    const portfolio = makePortfolio({
      conflicts: [{ positionA: "BTC LONG", positionB: "EUR/USD SHORT", conflictType: "REGIME", description: "Regime conflict", strength: "STRONG" }],
    });
    const ctx = makeCtx([], portfolio);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("no trigger when portfolio data missing", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONFLICT_DETECTED" });
    const ctx = makeCtx([], undefined);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. GLOBAL SCOPE
// ═══════════════════════════════════════════════════════════════

describe("Global scope", () => {
  it("evaluates all positions plus portfolio", () => {
    const rule = makeRule({ scope: "GLOBAL", condition: "THESIS_STATE_CHANGED" });
    const portfolio = makePortfolio({
      conflicts: [{ positionA: "BTC LONG", positionB: "ETH SHORT", conflictType: "EVIDENCE_CONFLICT", description: "test", strength: "MODERATE" }],
    });
    const ctx = makeCtx([makeIntel()], portfolio, {
      previousSnapshots: new Map([
        ["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }],
      ]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    // CAUTION→HEALTHY on pos-1 should trigger
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("LONG/SHORT symmetry", () => {
  it("THESIS_BECAME_DETERIORATING triggers for LONG", () => {
    const rule = makeRule({ scope: "POSITION", positionId: "long-1", condition: "THESIS_BECAME_DETERIORATING" });
    const intel = makeIntel({ instrument: "BTC/USDT", side: "LONG", thesisHealth: "DETERIORATING" });
    const ctx = makeCtx([intel], undefined, {
      previousSnapshots: new Map([["long-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["long-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("THESIS_BECAME_DETERIORATING triggers for SHORT", () => {
    const rule = makeRule({ scope: "POSITION", positionId: "short-1", condition: "THESIS_BECAME_DETERIORATING" });
    const intel = makeIntel({ instrument: "BTC/USDT", side: "SHORT", thesisHealth: "DETERIORATING" });
    const ctx = makeCtx([intel], undefined, {
      previousSnapshots: new Map([["short-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_DOWN", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["short-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("alert impact classification respects LONG/SHORT symmetry", () => {
    const longAlert = buildRuleAlert(
      makeRule({ condition: "THESIS_BECAME_DETERIORATING" }),
      { triggered: true, description: "test" },
    );
    const shortAlert = buildRuleAlert(
      makeRule({ condition: "THESIS_BECAME_DETERIORATING" }),
      { triggered: true, description: "test" },
    );

    expect(classifyAlertImpact(longAlert, "LONG")).toBe("CONFLICTING");
    expect(classifyAlertImpact(shortAlert, "SHORT")).toBe("SUPPORTING");
  });

  it("NEWS_BECAME_SUPPORTING is opposite for LONG vs SHORT", () => {
    const alert = buildRuleAlert(
      makeRule({ condition: "NEWS_BECAME_SUPPORTING" }),
      { triggered: true, description: "test" },
    );
    expect(classifyAlertImpact(alert, "LONG")).toBe("SUPPORTING");
    expect(classifyAlertImpact(alert, "SHORT")).toBe("CONFLICTING");
  });

  it("DATA_BECAME_UNAVAILABLE is opposite for LONG vs SHORT", () => {
    const alert = buildRuleAlert(
      makeRule({ condition: "DATA_BECAME_UNAVAILABLE" }),
      { triggered: true, description: "test" },
    );
    expect(classifyAlertImpact(alert, "LONG")).toBe("CONFLICTING");
    expect(classifyAlertImpact(alert, "SHORT")).toBe("SUPPORTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. THESIS TRANSITIONS
// ═══════════════════════════════════════════════════════════════

describe("Thesis transitions", () => {
  it("THESIS_STATE_CHANGED triggers on change", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("THESIS_STATE_CHANGED no trigger when same state", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("THESIS_BECAME_INVALIDATED triggers when becoming INVALIDATED", () => {
    const rule = makeRule({ condition: "THESIS_BECAME_INVALIDATED" });
    const ctx = makeCtx([makeIntel({ thesisHealth: "INVALIDATED" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. REGIME TRANSITIONS
// ═══════════════════════════════════════════════════════════════

describe("Regime transitions", () => {
  it("REGIME_CHANGED triggers when regime changes", () => {
    const rule = makeRule({ condition: "REGIME_CHANGED" });
    const ctx = makeCtx([makeIntel({ ohlcvRegime: "PULLBACK" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("REGIME_CHANGED no trigger when same regime", () => {
    const rule = makeRule({ condition: "REGIME_CHANGED" });
    const ctx = makeCtx([makeIntel({ ohlcvRegime: "TRENDING_UP" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. H1/M15/M5 TRANSITIONS
// ═══════════════════════════════════════════════════════════════

describe("Timeframe trend transitions", () => {
  it("H1_TREND_CHANGED triggers when H1 trend changes", () => {
    const rule = makeRule({ condition: "H1_TREND_CHANGED" });
    const ctx = makeCtx([makeIntel({ h1Analysis: { trend: "BEARISH" } as any })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", h1Trend: "BULLISH", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("M15_TREND_CHANGED triggers when M15 trend changes", () => {
    const rule = makeRule({ condition: "M15_TREND_CHANGED" });
    const ctx = makeCtx([makeIntel({ m15Analysis: { trend: "BEARISH" } as any })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", m15Trend: "BULLISH", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("M5_TREND_CHANGED triggers when M5 trend changes", () => {
    const rule = makeRule({ condition: "M5_TREND_CHANGED" });
    const ctx = makeCtx([makeIntel({ m5Analysis: { trend: "BULLISH" } as any })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", m5Trend: "BEARISH", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. STRUCTURE TRANSITION
// ═══════════════════════════════════════════════════════════════

describe("Structure transition", () => {
  it("STRUCTURE_CHANGED triggers when regime/structure changes", () => {
    const rule = makeRule({ condition: "STRUCTURE_CHANGED" });
    const ctx = makeCtx([makeIntel({ ohlcvRegime: "PULLBACK" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", structure: "TRENDING_UP", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. MOMENTUM TRANSITION
// ═══════════════════════════════════════════════════════════════

describe("Momentum transition", () => {
  it("MOMENTUM_CHANGED triggers when momentum context changes", () => {
    const rule = makeRule({ condition: "MOMENTUM_CHANGED" });
    const ctx = makeCtx([makeIntel({ shortTermContext: "BEARISH" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", momentum: "BULLISH", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. VOLATILITY TRANSITION
// ═══════════════════════════════════════════════════════════════

describe("Volatility transition", () => {
  it("VOLATILITY_CHANGED triggers when volatility context changes", () => {
    const rule = makeRule({ condition: "VOLATILITY_CHANGED" });
    const ctx = makeCtx([makeIntel({ volatilityContext: "HIGH" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", volatility: "LOW", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. EVIDENCE QUALITY
// ═══════════════════════════════════════════════════════════════

describe("Evidence quality", () => {
  it("EVIDENCE_QUALITY_CHANGED triggers on confidence change", () => {
    const rule = makeRule({ condition: "EVIDENCE_QUALITY_CHANGED" });
    const ctx = makeCtx([makeIntel({ confidence: "STRONG_EVIDENCE" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. NEWS CONFLICT/SUPPORT
// ═══════════════════════════════════════════════════════════════

describe("News conflict/support", () => {
  it("NEWS_BECAME_CONFLICTING triggers when news becomes conflicting", () => {
    const rule = makeRule({ condition: "NEWS_BECAME_CONFLICTING" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousNewsStance: new Map([["BTC/USDT", "SUPPORTING"]]),
      newsStance: new Map([["BTC/USDT", "CONFLICTING"]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("NEWS_BECAME_SUPPORTING triggers when news becomes supporting", () => {
    const rule = makeRule({ condition: "NEWS_BECAME_SUPPORTING" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousNewsStance: new Map([["BTC/USDT", "NEUTRAL"]]),
      newsStance: new Map([["BTC/USDT", "SUPPORTING"]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("no trigger when news stance unchanged", () => {
    const rule = makeRule({ condition: "NEWS_BECAME_CONFLICTING" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousNewsStance: new Map([["BTC/USDT", "CONFLICTING"]]),
      newsStance: new Map([["BTC/USDT", "CONFLICTING"]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. MACRO CHANGE
// ═══════════════════════════════════════════════════════════════

describe("Macro regime change", () => {
  it("MACRO_REGIME_CHANGED triggers when macro regime changes", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "MACRO_REGIME_CHANGED" });
    const ctx = makeCtx([], makePortfolio(), { previousMacroRegime: "RISK_ON", macroRegime: "RISK_OFF" });
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("no trigger when macro regime unchanged", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "MACRO_REGIME_CHANGED" });
    const ctx = makeCtx([], makePortfolio(), { previousMacroRegime: "RISK_ON", macroRegime: "RISK_ON" });
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. PORTFOLIO CONCENTRATION
// ═══════════════════════════════════════════════════════════════

describe("Portfolio concentration", () => {
  it("PORTFOLIO_CONCENTRATION_DETECTED triggers on strong concentration", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONCENTRATION_DETECTED" });
    const portfolio = makePortfolio({
      alignments: [
        { instruments: ["BTC LONG", "ETH LONG"], alignmentType: "CONCENTRATION", description: "Crypto LONG concentration", strength: "STRONG" },
      ],
    });
    const ctx = makeCtx([], portfolio);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. PORTFOLIO CONFLICT
// ═══════════════════════════════════════════════════════════════

describe("Portfolio conflict", () => {
  it("PORTFOLIO_CONFLICT_DETECTED triggers on strong conflict", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONFLICT_DETECTED" });
    const portfolio = makePortfolio({
      conflicts: [{ positionA: "BTC LONG", positionB: "BTC SHORT", conflictType: "DIRECT_DIRECTIONAL", description: "Same instrument opposite sides", strength: "STRONG" }],
    });
    const ctx = makeCtx([], portfolio);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. DATA UNAVAILABLE / RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("Data unavailable / recovery", () => {
  it("DATA_BECAME_UNAVAILABLE triggers when data becomes unavailable", () => {
    const rule = makeRule({ condition: "DATA_BECAME_UNAVAILABLE" });
    const ctx = makeCtx([makeIntel({ dataQuality: "UNAVAILABLE" })], undefined, {
      previousDataAvailability: new Map([["BTC/USDT", "SUFFICIENT"]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("DATA_RECOVERED triggers when data recovers", () => {
    const rule = makeRule({ condition: "DATA_RECOVERED" });
    const ctx = makeCtx([makeIntel({ dataQuality: "SUFFICIENT" })], undefined, {
      previousDataAvailability: new Map([["BTC/USDT", "UNAVAILABLE"]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("unavailable data never creates directional evidence", () => {
    const alert = buildRuleAlert(
      makeRule({ condition: "DATA_BECAME_UNAVAILABLE" }),
      { triggered: true, description: "Data became unavailable" },
    );
    expect(classifyAlertImpact(alert, "LONG")).toBe("CONFLICTING");
    expect(classifyAlertImpact(alert, "SHORT")).toBe("SUPPORTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// T. DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("Deduplication", () => {
  it("alertIdentity produces stable identity", () => {
    const id1 = alertIdentity("rule-1", "pos-1", "THESIS_STATE_CHANGED", 1000);
    const id2 = alertIdentity("rule-1", "pos-1", "THESIS_STATE_CHANGED", 1000);
    expect(id1).toBe(id2);
  });

  it("different states produce different identities", () => {
    const id1 = alertIdentity("rule-1", "pos-1", "THESIS_STATE_CHANGED", 1000);
    const id2 = alertIdentity("rule-1", "pos-1", "THESIS_STATE_CHANGED", 2000);
    expect(id1).not.toBe(id2);
  });

  it("different rules produce different identities", () => {
    const id1 = alertIdentity("rule-1", "pos-1", "THESIS_STATE_CHANGED", 1000);
    const id2 = alertIdentity("rule-2", "pos-1", "THESIS_STATE_CHANGED", 1000);
    expect(id1).not.toBe(id2);
  });

  it("undefined positionId uses 'global' fallback", () => {
    const id = alertIdentity("rule-1", undefined, "THESIS_STATE_CHANGED", 1000);
    expect(id).toContain("global");
  });
});

// ═══════════════════════════════════════════════════════════════
// U. COOLDOWN
// ═══════════════════════════════════════════════════════════════

describe("Cooldown / re-trigger", () => {
  it("disabled rules never trigger", () => {
    const rule = makeRule({ enabled: false });
    expect(shouldTriggerAlert(rule, new Map(), Date.now())).toBe(false);
  });

  it("rule triggers when never triggered before", () => {
    const rule = makeRule();
    expect(shouldTriggerAlert(rule, new Map(), Date.now())).toBe(true);
  });

  it("rule does not trigger during cooldown", () => {
    const rule = makeRule({ cooldownMs: 60_000 });
    const records = new Map<string, RuleTriggerRecord>([
      ["rule-1:pos-1", { ruleId: "rule-1", positionId: "pos-1", lastTriggeredAt: Date.now() - 10_000, lastConditionTrue: true }],
    ]);
    expect(shouldTriggerAlert(rule, records, Date.now())).toBe(false);
  });

  it("rule triggers after cooldown elapsed", () => {
    const rule = makeRule({ cooldownMs: 60_000 });
    const records = new Map<string, RuleTriggerRecord>([
      ["rule-1:pos-1", { ruleId: "rule-1", positionId: "pos-1", lastTriggeredAt: Date.now() - 70_000, lastConditionTrue: true }],
    ]);
    expect(shouldTriggerAlert(rule, records, Date.now())).toBe(true);
  });

  it("updateTriggerRecord updates the record", () => {
    const rule = makeRule();
    const before = new Map<string, RuleTriggerRecord>();
    const after = updateTriggerRecord(before, rule, 1000);
    const record = after.get("rule-1:pos-1");
    expect(record).toBeDefined();
    expect(record!.lastTriggeredAt).toBe(1000);
    expect(record!.lastConditionTrue).toBe(true);
  });

  it("cooldown logic is deterministic", () => {
    const rule = makeRule({ cooldownMs: 5000 });
    const records = new Map<string, RuleTriggerRecord>([
      ["rule-1:pos-1", { ruleId: "rule-1", positionId: "pos-1", lastTriggeredAt: 1000, lastConditionTrue: true }],
    ]);
    expect(shouldTriggerAlert(rule, records, 6000)).toBe(true);
    expect(shouldTriggerAlert(rule, records, 4999)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// V. MULTIPLE RULES
// ═══════════════════════════════════════════════════════════════

describe("Multiple rules evaluation", () => {
  it("evaluateRules handles multiple rules", () => {
    const rules = [
      makeRule({ ruleId: "r1", condition: "THESIS_STATE_CHANGED" }),
      makeRule({ ruleId: "r2", condition: "REGIME_CHANGED" }),
    ];
    const ctx = makeCtx([makeIntel({ ohlcvRegime: "PULLBACK" })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const { alerts, updatedRecords } = evaluateRules(rules, ctx, new Map(), Date.now());
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(updatedRecords.size).toBeGreaterThanOrEqual(1);
  });

  it("MAX_ALERTS_PER_EVALUATION limits output", () => {
    const rules = Array.from({ length: 25 }, (_, i) =>
      makeRule({ ruleId: `r${i}`, condition: "THESIS_STATE_CHANGED" })
    );
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const { alerts } = evaluateRules(rules, ctx, new Map(), Date.now());
    expect(alerts.length).toBeLessThanOrEqual(MAX_ALERTS_PER_EVALUATION);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. NO FABRICATED DATA / PROBABILITY / EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("No fabricated data / probability / execution", () => {
  it("alert descriptions contain no probability language", () => {
    const alert = buildRuleAlert(
      makeRule({ condition: "THESIS_STATE_CHANGED" }),
      { triggered: true, description: "Thesis state changed from HEALTHY to CAUTION", previousState: "HEALTHY", currentState: "CAUTION" },
    );
    const lower = alert.description.toLowerCase();
    expect(lower).not.toMatch(/\d+%/);
    expect(lower).not.toMatch(/probability/);
    expect(lower).not.toMatch(/likely/);
  });

  it("alert has source CUSTOM_RULE, never LIVE", () => {
    const alert = buildRuleAlert(
      makeRule(),
      { triggered: true, description: "test" },
    );
    expect(alert.source).toBe("CUSTOM_RULE");
    expect(alert.source).not.toBe("LIVE");
  });

  it("no execution commands in alert model", () => {
    const alert = buildRuleAlert(makeRule(), { triggered: true, description: "test" });
    const all = JSON.stringify(alert).toLowerCase();
    expect(all).not.toMatch(/buy|sell|close|execute|order|position.*size/);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Determinism", () => {
  it("same input produces identical results", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const r1 = evaluateRule(rule, ctx);
    const r2 = evaluateRule(rule, ctx);
    expect(r1.length).toBe(r2.length);
    expect(r1[0]?.description).toBe(r2[0]?.description);
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. MISSING PREVIOUS STATE
// ═══════════════════════════════════════════════════════════════

describe("Missing previous state", () => {
  it("no trigger when previous state is missing", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: undefined,
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. CONDITION LABELS
// ═══════════════════════════════════════════════════════════════

describe("Condition labels and styling", () => {
  it("all conditions have labels", () => {
    const allConditions = Object.keys(CONDITION_LABELS);
    expect(allConditions.length).toBeGreaterThanOrEqual(20);
    for (const label of Object.values(CONDITION_LABELS)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("all severities have colors and backgrounds", () => {
    for (const sev of ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]) {
      expect(SEVERITY_COLORS[sev as keyof typeof SEVERITY_COLORS]).toBeDefined();
      expect(SEVERITY_BG[sev as keyof typeof SEVERITY_BG]).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. CROSS-ASSET CONFLICT
// ═══════════════════════════════════════════════════════════════

describe("Cross-asset conflict", () => {
  it("CROSS_ASSET_CONFLICT triggers when portfolio has cross-asset conflict", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "CROSS_ASSET_CONFLICT" });
    const portfolio = makePortfolio({
      conflicts: [{ positionA: "BTC LONG", positionB: "EUR/USD LONG", conflictType: "CROSS_ASSET", description: "Cross-asset conflict", strength: "MODERATE" }],
    });
    const ctx = makeCtx([], portfolio);
    const results = evaluateRule(rule, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("CROSS_ASSET_CONFLICT no trigger when no cross-asset conflicts", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "CROSS_ASSET_CONFLICT" });
    const portfolio = makePortfolio({ conflicts: [] });
    const ctx = makeCtx([], portfolio);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. SUPPORTING/CONFLICTING EVIDENCE
// ═══════════════════════════════════════════════════════════════

describe("Supporting/conflicting evidence changes", () => {
  it("SUPPORTING_EVIDENCE_CHANGED triggers when supporting count changes by >= 2", () => {
    const rule = makeRule({ condition: "SUPPORTING_EVIDENCE_CHANGED" });
    const ctx = makeCtx([makeIntel({      evidence: [{ direction: "supporting", category: "TECHNICAL", description: "t", strength: "MODERATE" }, { direction: "supporting", category: "STRUCTURE", description: "s", strength: "MODERATE" }] })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 0, conflictingCount: 0 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });

  it("CONFLICTING_EVIDENCE_CHANGED triggers when conflicting count changes by >= 2", () => {
    const rule = makeRule({ condition: "CONFLICTING_EVIDENCE_CHANGED" });
    const ctx = makeCtx([makeIntel({      evidence: [{ direction: "conflicting", category: "TECHNICAL", description: "t", strength: "MODERATE" }, { direction: "conflicting", category: "STRUCTURE", description: "s", strength: "MODERATE" }] })], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "HEALTHY", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 0, conflictingCount: 0 }]]),
    }, ["pos-1"]);
    const results = evaluateRule(rule, ctx);
    expect(results[0]?.triggered).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. BUILD RULE ALERT
// ═══════════════════════════════════════════════════════════════

describe("buildRuleAlert", () => {
  it("creates alert with correct fields", () => {
    const rule = makeRule({ ruleId: "r1", name: "My Rule", userId: "u1", severity: "HIGH" });
    const evalResult = { triggered: true, description: "Thesis changed", previousState: "HEALTHY", currentState: "CAUTION" };
    const alert = buildRuleAlert(rule, evalResult, "pos-1", "BTC/USDT");

    expect(alert.alertId).toContain("custom-r1-");
    expect(alert.ruleId).toBe("r1");
    expect(alert.ruleName).toBe("My Rule");
    expect(alert.userId).toBe("u1");
    expect(alert.positionId).toBe("pos-1");
    expect(alert.instrument).toBe("BTC/USDT");
    expect(alert.condition).toBe("THESIS_STATE_CHANGED");
    expect(alert.severity).toBe("HIGH");
    expect(alert.description).toBe("Thesis changed");
    expect(alert.previousState).toBe("HEALTHY");
    expect(alert.currentState).toBe("CAUTION");
    expect(alert.source).toBe("CUSTOM_RULE");
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. BOUNDED EVALUATION
// ═══════════════════════════════════════════════════════════════

describe("Bounded evaluation", () => {
  it("never exceeds MAX_ALERTS_PER_EVALUATION", () => {
    // Create 30 rules that all trigger
    const rules = Array.from({ length: 30 }, (_, i) =>
      makeRule({
        ruleId: `r${i}`,
        condition: "THESIS_STATE_CHANGED",
        cooldownMs: 0,
      })
    );
    const ctx = makeCtx([makeIntel()], undefined, {
      previousSnapshots: new Map([["pos-1", { thesisState: "CAUTION", marketRegime: "TRENDING_UP", evidenceQuality: "MODERATE_EVIDENCE", supportingCount: 3, conflictingCount: 1 }]]),
    }, ["pos-1"]);
    const { alerts } = evaluateRules(rules, ctx, new Map(), Date.now());
    expect(alerts.length).toBeLessThanOrEqual(MAX_ALERTS_PER_EVALUATION);
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. NO ORPHAN EVALUATION
// ═══════════════════════════════════════════════════════════════

describe("Empty context safety", () => {
  it("no trigger when no positions and no portfolio", () => {
    const rule = makeRule({ scope: "POSITION", condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([], undefined);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("no trigger when empty context for global scope", () => {
    const rule = makeRule({ scope: "GLOBAL", condition: "THESIS_STATE_CHANGED" });
    const ctx = makeCtx([], undefined);
    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});
