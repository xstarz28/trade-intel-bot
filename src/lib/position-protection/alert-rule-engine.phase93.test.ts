import { describe, it, expect } from "vitest";
import {
  type AlertRule,
  type RuleEvaluationContext,
  type RuleTriggerRecord,
  type RuleSnapshot,
  evaluateRule,
  evaluateRules,
  shouldTriggerAlert,
  updateTriggerRecord,
  alertIdentity,
  buildRuleAlert,
  classifyAlertImpact,
  MAX_RULES_PER_USER,
  MAX_ALERTS_PER_EVALUATION,
  CONDITION_LABELS,
  SEVERITY_COLORS,
  SEVERITY_BG,
} from "./alert-rule-engine";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeRule(overrides?: Partial<AlertRule>): AlertRule {
  return {
    ruleId: "rule-1",
    userId: "user-1",
    name: "Test Rule",
    enabled: true,
    scope: "POSITION",
    positionId: "pos-1",
    instrument: "BTC/USDT",
    condition: "THESIS_STATE_CHANGED",
    severity: "MEDIUM",
    cooldownMs: 60_000,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeIntel(overrides?: Partial<PositionIntelligence>): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 60000,
    entryPrice: 55000,
    marketState: "TRENDING_UP",
    shortTermContext: "BULLISH",
    mediumTermContext: "BULLISH",
    volatilityContext: "NORMAL",
    pnlPct: 9.09,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    severity: "NONE",
    actionRecommendation: "HOLD",
    evidence: [
      { category: "structure", description: "Bullish BOS", direction: "supporting", strength: "STRONG" },
    ],
    independentSignalCount: 3,
    confidence: "MODERATE_EVIDENCE",
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [],
    nextMonitor: ["Watch for continuation"],
    dataQuality: "GOOD",
    observationCount: 100,
    provider: "TwelveData",
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<RuleSnapshot>): RuleSnapshot {
  return {
    thesisState: "HEALTHY",
    marketRegime: "TRENDING_UP",
    evidenceQuality: "MODERATE_EVIDENCE",
    structure: "BULLISH",
    momentum: "BULLISH",
    volatility: "NORMAL",
    h1Trend: "BULLISH",
    m15Trend: "BULLISH",
    m5Trend: "BULLISH",
    supportingCount: 1,
    conflictingCount: 0,
    ...overrides,
  };
}

function makePortfolio(overrides?: Partial<PortfolioIntelligence>): PortfolioIntelligence {
  return {
    summary: {
      totalPositions: 2,
      healthyPositions: 1,
      cautionPositions: 1,
      deterioratingPositions: 0,
      invalidatedPositions: 0,
      unavailablePositions: 0,
      dominantPortfolioState: "HEALTHY",
      portfolioEvidenceQuality: "MODERATE_EVIDENCE",
    },
    exposure: [],
    alignments: [
      {
        instruments: ["BTC LONG", "ETH LONG"],
        alignmentType: "DIRECTIONAL",
        description: "Both positions share bullish structural evidence",
        strength: "STRONG",
      },
    ],
    conflicts: [
      {
        positionA: "pos-1",
        positionB: "pos-2",
        conflictType: "CROSS_ASSET",
        description: "BTC LONG and ETH LONG diverge on momentum",
        strength: "MODERATE",
      },
    ],
    watchItems: [
      {
        priority: "MEDIUM",
        instrument: "ETH/USDT",
        reason: "Evidence quality declining",
        category: "Deterioration",
        strength: "MODERATE",
      },
    ],
    marketContext: "Mixed risk environment",
    riskContext: "MIXED",
    dataAvailability: {
      technical: "AVAILABLE",
      macro: "AVAILABLE",
      news: "AVAILABLE",
      derivatives: "UNAVAILABLE",
      fundamentals: "UNAVAILABLE",
    },
    generatedAt: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. ALERT IDENTITY
// ═══════════════════════════════════════════════════════════════

describe("alertIdentity", () => {
  it("produces deterministic identity from same inputs", () => {
    const id1 = alertIdentity("r1", "p1", "THESIS_STATE_CHANGED", 1000);
    const id2 = alertIdentity("r1", "p1", "THESIS_STATE_CHANGED", 1000);
    expect(id1).toBe(id2);
  });

  it("produces different identity for different ruleId", () => {
    const id1 = alertIdentity("r1", "p1", "THESIS_STATE_CHANGED", 1000);
    const id2 = alertIdentity("r2", "p1", "THESIS_STATE_CHANGED", 1000);
    expect(id1).not.toBe(id2);
  });

  it("produces different identity for different positionId", () => {
    const id1 = alertIdentity("r1", "p1", "THESIS_STATE_CHANGED", 1000);
    const id2 = alertIdentity("r1", "p2", "THESIS_STATE_CHANGED", 1000);
    expect(id1).not.toBe(id2);
  });

  it("uses 'global' for undefined positionId", () => {
    const id = alertIdentity("r1", undefined, "THESIS_STATE_CHANGED", 1000);
    expect(id).toContain("global");
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. DISABLED RULES NEVER TRIGGER
// ═══════════════════════════════════════════════════════════════

describe("disabled rules never trigger", () => {
  it("returns no results for disabled rule", () => {
    const rule = makeRule({ enabled: false });
    const intel = makeIntel({ thesisHealth: "INVALIDATED" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("shouldTriggerAlert returns false for disabled rule", () => {
    const rule = makeRule({ enabled: false });
    expect(shouldTriggerAlert(rule, new Map(), Date.now())).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. THESIS STATE CONDITIONS
// ═══════════════════════════════════════════════════════════════

describe("THESIS_STATE_CHANGED", () => {
  it("triggers when thesis state changes", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
    expect(results[0].previousState).toBe("HEALTHY");
    expect(results[0].currentState).toBe("STABLE");
  });

  it("does not trigger when thesis state is unchanged", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const intel = makeIntel({ thesisHealth: "HEALTHY" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("does not trigger when no previous snapshot exists", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const intel = makeIntel({ thesisHealth: "STABLE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("THESIS_BECAME_DETERIORATING", () => {
  it("triggers when thesis goes from HEALTHY to DETERIORATING", () => {
    const rule = makeRule({ condition: "THESIS_BECAME_DETERIORATING" });
    const intel = makeIntel({ thesisHealth: "DETERIORATING" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(true);
  });

  it("triggers when thesis goes from STABLE to INVALIDATED", () => {
    const rule = makeRule({ condition: "THESIS_BECAME_DETERIORATING" });
    const intel = makeIntel({ thesisHealth: "INVALIDATED" });
    const prev = makeSnapshot({ thesisState: "STABLE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when already deteriorating", () => {
    const rule = makeRule({ condition: "THESIS_BECAME_DETERIORATING" });
    const intel = makeIntel({ thesisHealth: "DETERIORATING" });
    const prev = makeSnapshot({ thesisState: "DETERIORATING" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("THESIS_BECAME_INVALIDATED", () => {
  it("triggers when thesis goes from HEALTHY to INVALIDATED", () => {
    const rule = makeRule({ condition: "THESIS_BECAME_INVALIDATED" });
    const intel = makeIntel({ thesisHealth: "INVALIDATED" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].previousState).toBe("HEALTHY");
    expect(results[0].currentState).toBe("INVALIDATED");
  });

  it("does not trigger when already INVALIDATED", () => {
    const rule = makeRule({ condition: "THESIS_BECAME_INVALIDATED" });
    const intel = makeIntel({ thesisHealth: "INVALIDATED" });
    const prev = makeSnapshot({ thesisState: "INVALIDATED" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. REGIME CHANGED
// ═══════════════════════════════════════════════════════════════

describe("REGIME_CHANGED", () => {
  it("triggers when market regime changes", () => {
    const rule = makeRule({ condition: "REGIME_CHANGED" });
    const intel = makeIntel({ ohlcvRegime: "HIGH_VOLATILITY" as any });
    const prev = makeSnapshot({ marketRegime: "LOW_VOLATILITY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].previousState).toBe("LOW_VOLATILITY");
  });

  it("does not trigger when regime is unchanged", () => {
    const rule = makeRule({ condition: "REGIME_CHANGED" });
    const intel = makeIntel({ ohlcvRegime: "TRENDING_UP" as any });
    const prev = makeSnapshot({ marketRegime: "TRENDING_UP" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. TREND CHANGED (H1, M15, M5)
// ═══════════════════════════════════════════════════════════════

describe("H1_TREND_CHANGED", () => {
  it("triggers when H1 trend changes", () => {
    const rule = makeRule({ condition: "H1_TREND_CHANGED" });
    const intel = makeIntel({ h1Analysis: { trend: "BEARISH" } as any });
    const prev = makeSnapshot({ h1Trend: "BULLISH" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].previousState).toBe("BULLISH");
    expect(results[0].currentState).toBe("BEARISH");
  });

  it("does not trigger when H1 trend is unchanged", () => {
    const rule = makeRule({ condition: "H1_TREND_CHANGED" });
    const intel = makeIntel({ h1Analysis: { trend: "BULLISH" } as any });
    const prev = makeSnapshot({ h1Trend: "BULLISH" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("M15_TREND_CHANGED", () => {
  it("triggers when M15 trend changes", () => {
    const rule = makeRule({ condition: "M15_TREND_CHANGED" });
    const intel = makeIntel({ m15Analysis: { trend: "BEARISH" } as any });
    const prev = makeSnapshot({ m15Trend: "BULLISH" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });
});

describe("M5_TREND_CHANGED", () => {
  it("triggers when M5 trend changes", () => {
    const rule = makeRule({ condition: "M5_TREND_CHANGED" });
    const intel = makeIntel({ m5Analysis: { trend: "NEUTRAL" } as any });
    const prev = makeSnapshot({ m5Trend: "BULLISH" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. STRUCTURE / MOMENTUM / VOLATILITY CHANGED
// ═══════════════════════════════════════════════════════════════

describe("STRUCTURE_CHANGED", () => {
  it("triggers when structure changes", () => {
    const rule = makeRule({ condition: "STRUCTURE_CHANGED" });
    const intel = makeIntel({ ohlcvRegime: "RANGE_BOUND" as any });
    const prev = makeSnapshot({ structure: "TRENDING_UP" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when prev structure is undefined", () => {
    const rule = makeRule({ condition: "STRUCTURE_CHANGED" });
    const intel = makeIntel({ ohlcvRegime: "RANGE_BOUND" as any });
    const prev = makeSnapshot({ structure: undefined });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("MOMENTUM_CHANGED", () => {
  it("triggers when momentum changes", () => {
    const rule = makeRule({ condition: "MOMENTUM_CHANGED" });
    const intel = makeIntel({ shortTermContext: "BEARISH" });
    const prev = makeSnapshot({ momentum: "BULLISH" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });
});

describe("VOLATILITY_CHANGED", () => {
  it("triggers when volatility context changes", () => {
    const rule = makeRule({ condition: "VOLATILITY_CHANGED" });
    const intel = makeIntel({ volatilityContext: "HIGH" });
    const prev = makeSnapshot({ volatility: "NORMAL" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. EVIDENCE QUALITY CHANGED
// ═══════════════════════════════════════════════════════════════

describe("EVIDENCE_QUALITY_CHANGED", () => {
  it("triggers when evidence quality changes", () => {
    const rule = makeRule({ condition: "EVIDENCE_QUALITY_CHANGED" });
    const intel = makeIntel({ confidence: "STRONG_EVIDENCE" });
    const prev = makeSnapshot({ evidenceQuality: "WEAK_EVIDENCE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].previousState).toBe("WEAK_EVIDENCE");
    expect(results[0].currentState).toBe("STRONG_EVIDENCE");
  });

  it("does not trigger when evidence quality is same", () => {
    const rule = makeRule({ condition: "EVIDENCE_QUALITY_CHANGED" });
    const intel = makeIntel({ confidence: "MODERATE_EVIDENCE" });
    const prev = makeSnapshot({ evidenceQuality: "MODERATE_EVIDENCE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. SUPPORTING / CONFLICTING EVIDENCE CHANGED
// ═══════════════════════════════════════════════════════════════

describe("SUPPORTING_EVIDENCE_CHANGED", () => {
  it("triggers when supporting count changes by 2+", () => {
    const rule = makeRule({ condition: "SUPPORTING_EVIDENCE_CHANGED" });
    const intel = makeIntel({
      evidence: [
        { category: "a", description: "1", direction: "supporting", strength: "STRONG" },
        { category: "b", description: "2", direction: "supporting", strength: "STRONG" },
        { category: "c", description: "3", direction: "supporting", strength: "STRONG" },
      ],
    });
    const prev = makeSnapshot({ supportingCount: 1 });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when supporting count changes by 1", () => {
    const rule = makeRule({ condition: "SUPPORTING_EVIDENCE_CHANGED" });
    const intel = makeIntel({
      evidence: [
        { category: "a", description: "1", direction: "supporting", strength: "STRONG" },
        { category: "b", description: "2", direction: "supporting", strength: "STRONG" },
      ],
    });
    const prev = makeSnapshot({ supportingCount: 1 });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("CONFLICTING_EVIDENCE_CHANGED", () => {
  it("triggers when conflicting count changes by 2+", () => {
    const rule = makeRule({ condition: "CONFLICTING_EVIDENCE_CHANGED" });
    const intel = makeIntel({
      evidence: [
        { category: "a", description: "1", direction: "conflicting", strength: "MODERATE" },
        { category: "b", description: "2", direction: "conflicting", strength: "WEAK" },
        { category: "c", description: "3", direction: "conflicting", strength: "WEAK" },
      ],
    });
    const prev = makeSnapshot({ conflictingCount: 1 });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. NEWS CONDITIONS
// ═══════════════════════════════════════════════════════════════

describe("NEWS_BECAME_CONFLICTING", () => {
  it("triggers when news becomes conflicting", () => {
    const rule = makeRule({ condition: "NEWS_BECAME_CONFLICTING" });
    const intel = makeIntel();

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousNewsStance: new Map([["BTC/USDT", "NEUTRAL"]]),
      newsStance: new Map([["BTC/USDT", "CONFLICTING"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when news was already conflicting", () => {
    const rule = makeRule({ condition: "NEWS_BECAME_CONFLICTING" });
    const intel = makeIntel();

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousNewsStance: new Map([["BTC/USDT", "CONFLICTING"]]),
      newsStance: new Map([["BTC/USDT", "CONFLICTING"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("NEWS_BECAME_SUPPORTING", () => {
  it("triggers when news becomes supporting", () => {
    const rule = makeRule({ condition: "NEWS_BECAME_SUPPORTING" });
    const intel = makeIntel();

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousNewsStance: new Map([["BTC/USDT", "NEUTRAL"]]),
      newsStance: new Map([["BTC/USDT", "SUPPORTING"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. MACRO REGIME CHANGED
// ═══════════════════════════════════════════════════════════════

describe("MACRO_REGIME_CHANGED", () => {
  it("triggers when macro regime changes", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "MACRO_REGIME_CHANGED" });
    const intel = makeIntel();

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousMacroRegime: "RISK_ON",
      macroRegime: "RISK_OFF",
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].previousState).toBe("RISK_ON");
    expect(results[0].currentState).toBe("RISK_OFF");
  });

  it("does not trigger when macro regime unchanged", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "MACRO_REGIME_CHANGED" });
    const intel = makeIntel();

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousMacroRegime: "RISK_ON",
      macroRegime: "RISK_ON",
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("does not trigger when macro regime is missing", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "MACRO_REGIME_CHANGED" });
    const intel = makeIntel();

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. DATA AVAILABILITY CONDITIONS
// ═══════════════════════════════════════════════════════════════

describe("DATA_BECAME_UNAVAILABLE", () => {
  it("triggers when data becomes unavailable", () => {
    const rule = makeRule({ condition: "DATA_BECAME_UNAVAILABLE" });
    const intel = makeIntel({ dataQuality: "UNAVAILABLE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousDataAvailability: new Map([["BTC/USDT", "AVAILABLE"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when data was already unavailable", () => {
    const rule = makeRule({ condition: "DATA_BECAME_UNAVAILABLE" });
    const intel = makeIntel({ dataQuality: "UNAVAILABLE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousDataAvailability: new Map([["BTC/USDT", "UNAVAILABLE"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("DATA_RECOVERED", () => {
  it("triggers when data recovers", () => {
    const rule = makeRule({ condition: "DATA_RECOVERED" });
    const intel = makeIntel({ dataQuality: "GOOD" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousDataAvailability: new Map([["BTC/USDT", "UNAVAILABLE"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when data was already available", () => {
    const rule = makeRule({ condition: "DATA_RECOVERED" });
    const intel = makeIntel({ dataQuality: "GOOD" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousDataAvailability: new Map([["BTC/USDT", "AVAILABLE"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. PORTFOLIO CONDITIONS
// ═══════════════════════════════════════════════════════════════

describe("PORTFOLIO_CONCENTRATION_DETECTED", () => {
  it("triggers when portfolio has strong concentration", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONCENTRATION_DETECTED" });
    const intel = makeIntel();
    const portfolio = makePortfolio({
      alignments: [
        {
        instruments: ["pos-1", "pos-2"],
        alignmentType: "CONCENTRATION",
          description: "High concentration",
          strength: "STRONG",
        },
      ],
    });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      portfolioIntelligence: portfolio,
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when no strong concentration", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONCENTRATION_DETECTED" });
    const intel = makeIntel();
    const portfolio = makePortfolio({
      alignments: [],
    });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      portfolioIntelligence: portfolio,
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("PORTFOLIO_CONFLICT_DETECTED", () => {
  it("triggers when portfolio has strong conflict", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONFLICT_DETECTED" });
    const intel = makeIntel();
    const portfolio = makePortfolio({
      conflicts: [
        {
          positionA: "pos-1",
          positionB: "pos-2",
          conflictType: "DIRECTIONAL",
          description: "Opposing directions",
          strength: "STRONG",
        },
      ],
    });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      portfolioIntelligence: portfolio,
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });

  it("does not trigger when no strong conflicts", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "PORTFOLIO_CONFLICT_DETECTED" });
    const intel = makeIntel();
    const portfolio = makePortfolio({
      conflicts: [
        {
          positionA: "pos-1",
          positionB: "pos-2",
          conflictType: "CROSS_ASSET",
          description: "Minor divergence",
          strength: "WEAK",
        },
      ],
    });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      portfolioIntelligence: portfolio,
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

describe("CROSS_ASSET_CONFLICT", () => {
  it("triggers when portfolio has cross-asset conflict", () => {
    const rule = makeRule({ scope: "PORTFOLIO", condition: "CROSS_ASSET_CONFLICT" });
    const intel = makeIntel();
    const portfolio = makePortfolio({
      conflicts: [
        {
          positionA: "pos-1",
          positionB: "pos-2",
          conflictType: "CROSS_ASSET",
          description: "Cross-asset divergence",
          strength: "MODERATE",
        },
      ],
    });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      portfolioIntelligence: portfolio,
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. SCOPE FILTERING
// ═══════════════════════════════════════════════════════════════

describe("scope filtering", () => {
  it("POSITION scope only evaluates the specified position", () => {
    const rule = makeRule({
      scope: "POSITION",
      positionId: "pos-1",
      condition: "THESIS_STATE_CHANGED",
    });
    const intel1 = makeIntel({ thesisHealth: "STABLE" });
    const intel2 = makeIntel({ thesisHealth: "STABLE" });
    const prev1 = makeSnapshot({ thesisState: "HEALTHY" });
    const prev2 = makeSnapshot({ thesisState: "STABLE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([
        ["pos-1", intel1],
        ["pos-2", intel2],
      ]),
      previousSnapshots: new Map([
        ["pos-1", prev1],
        ["pos-2", prev2],
      ]),
    };

    const results = evaluateRule(rule, ctx);
    // Only pos-1 should be evaluated (thesis changed), pos-2 should not
    expect(results).toHaveLength(1);
  });

  it("INSTRUMENT scope evaluates all positions matching instrument", () => {
    const rule = makeRule({
      scope: "INSTRUMENT",
      instrument: "BTC/USDT",
      condition: "THESIS_STATE_CHANGED",
    });
    const intel1 = makeIntel({ thesisHealth: "STABLE", instrument: "BTC/USDT" });
    const intel2 = makeIntel({ thesisHealth: "STABLE", instrument: "ETH/USDT" });
    const prev1 = makeSnapshot({ thesisState: "HEALTHY" });
    const prev2 = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([
        ["pos-1", intel1],
        ["pos-2", intel2],
      ]),
      previousSnapshots: new Map([
        ["pos-1", prev1],
        ["pos-2", prev2],
      ]),
    };

    const results = evaluateRule(rule, ctx);
    // Only BTC/USDT should be evaluated
    expect(results).toHaveLength(1);
  });

  it("GLOBAL scope evaluates all positions", () => {
    const rule = makeRule({
      scope: "GLOBAL",
      condition: "THESIS_STATE_CHANGED",
    });
    const intel1 = makeIntel({ thesisHealth: "STABLE" });
    const intel2 = makeIntel({ thesisHealth: "STABLE" });
    const prev1 = makeSnapshot({ thesisState: "HEALTHY" });
    const prev2 = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([
        ["pos-1", intel1],
        ["pos-2", intel2],
      ]),
      previousSnapshots: new Map([
        ["pos-1", prev1],
        ["pos-2", prev2],
      ]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("LONG/SHORT symmetry", () => {
  it("THESIS_STATE_CHANGED fires identically for LONG and SHORT", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });

    const longIntel = makeIntel({ side: "LONG", thesisHealth: "STABLE" });
    const shortIntel = makeIntel({ side: "SHORT", thesisHealth: "STABLE" });
    const prevLong = makeSnapshot({ thesisState: "HEALTHY" });
    const prevShort = makeSnapshot({ thesisState: "HEALTHY" });

    const ctxLong: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", longIntel]]),
      previousSnapshots: new Map([["pos-1", prevLong]]),
    };
    const ctxShort: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", shortIntel]]),
      previousSnapshots: new Map([["pos-1", prevShort]]),
    };

    const resultsLong = evaluateRule(rule, ctxLong);
    const resultsShort = evaluateRule(rule, ctxShort);

    expect(resultsLong).toHaveLength(1);
    expect(resultsShort).toHaveLength(1);
    expect(resultsLong[0].previousState).toBe(resultsShort[0].previousState);
    expect(resultsLong[0].currentState).toBe(resultsShort[0].currentState);
  });

  it("THESIS_BECAME_DETERIORATING fires for both LONG and SHORT", () => {
    const rule = makeRule({ condition: "THESIS_BECAME_DETERIORATING" });

    const longIntel = makeIntel({ side: "LONG", thesisHealth: "DETERIORATING" });
    const shortIntel = makeIntel({ side: "SHORT", thesisHealth: "DETERIORATING" });
    const prevLong = makeSnapshot({ thesisState: "HEALTHY" });
    const prevShort = makeSnapshot({ thesisState: "HEALTHY" });

    const ctxLong: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", longIntel]]),
      previousSnapshots: new Map([["pos-1", prevLong]]),
    };
    const ctxShort: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", shortIntel]]),
      previousSnapshots: new Map([["pos-1", prevShort]]),
    };

    const resultsLong = evaluateRule(rule, ctxLong);
    const resultsShort = evaluateRule(rule, ctxShort);

    expect(resultsLong).toHaveLength(1);
    expect(resultsShort).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 15. classifyAlertImpact
// ═══════════════════════════════════════════════════════════════

describe("classifyAlertImpact", () => {
  it("NEWS_BECAME_SUPPORTING is SUPPORTING for LONG, CONFLICTING for SHORT", () => {
    const alert = buildRuleAlert(
      makeRule(),
      { triggered: true, description: "News supporting" },
      "pos-1",
      "BTC/USDT",
    );
    const longImpact = classifyAlertImpact({ ...alert, condition: "NEWS_BECAME_SUPPORTING" }, "LONG");
    const shortImpact = classifyAlertImpact({ ...alert, condition: "NEWS_BECAME_SUPPORTING" }, "SHORT");

    expect(longImpact).toBe("SUPPORTING");
    expect(shortImpact).toBe("CONFLICTING");
  });

  it("THESIS_BECAME_INVALIDATED is CONFLICTING for LONG, SUPPORTING for SHORT", () => {
    const alert = buildRuleAlert(
      makeRule(),
      { triggered: true, description: "Thesis invalidated" },
      "pos-1",
      "BTC/USDT",
    );
    const longImpact = classifyAlertImpact({ ...alert, condition: "THESIS_BECAME_INVALIDATED" }, "LONG");
    const shortImpact = classifyAlertImpact({ ...alert, condition: "THESIS_BECAME_INVALIDATED" }, "SHORT");

    expect(longImpact).toBe("CONFLICTING");
    expect(shortImpact).toBe("SUPPORTING");
  });

  it("REGIME_CHANGED returns NEUTRAL (no directional mapping)", () => {
    const alert = buildRuleAlert(
      makeRule(),
      { triggered: true, description: "Regime changed" },
      "pos-1",
      "BTC/USDT",
    );
    const longImpact = classifyAlertImpact({ ...alert, condition: "REGIME_CHANGED" }, "LONG");
    const shortImpact = classifyAlertImpact({ ...alert, condition: "REGIME_CHANGED" }, "SHORT");

    expect(longImpact).toBe("NEUTRAL");
    expect(shortImpact).toBe("NEUTRAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// 16. COOLDOWN / DEDUP
// ═══════════════════════════════════════════════════════════════

describe("cooldown / dedup", () => {
  it("shouldTriggerAlert returns true when no prior trigger", () => {
    const rule = makeRule({ cooldownMs: 60_000 });
    expect(shouldTriggerAlert(rule, new Map(), Date.now())).toBe(true);
  });

  it("shouldTriggerAlert returns false within cooldown", () => {
    const rule = makeRule({ cooldownMs: 60_000 });
    const now = Date.now();
    const records = new Map<string, RuleTriggerRecord>();
    records.set(`rule-1:pos-1`, {
      ruleId: "rule-1",
      positionId: "pos-1",
      lastTriggeredAt: now,
      lastConditionTrue: true,
    });

    expect(shouldTriggerAlert(rule, records, now + 30_000)).toBe(false);
  });

  it("shouldTriggerAlert returns true after cooldown expires", () => {
    const rule = makeRule({ cooldownMs: 60_000 });
    const now = Date.now();
    const records = new Map<string, RuleTriggerRecord>();
    records.set(`rule-1:pos-1`, {
      ruleId: "rule-1",
      positionId: "pos-1",
      lastTriggeredAt: now,
      lastConditionTrue: true,
    });

    expect(shouldTriggerAlert(rule, records, now + 60_001)).toBe(true);
  });

  it("updateTriggerRecord updates the record", () => {
    const rule = makeRule();
    const now = Date.now();
    const records = new Map<string, RuleTriggerRecord>();

    const updated = updateTriggerRecord(records, rule, now);
    const key = `rule-1:pos-1`;
    expect(updated.has(key)).toBe(true);
    expect(updated.get(key)!.lastTriggeredAt).toBe(now);
  });

  it("batch evaluateRules respects cooldown", () => {
    const rule = makeRule({ cooldownMs: 60_000 });
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });
    const now = Date.now();

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    // First evaluation — should trigger
    const result1 = evaluateRules([rule], ctx, new Map(), now);
    expect(result1.alerts).toHaveLength(1);

    // Second evaluation immediately — should NOT trigger (cooldown)
    const result2 = evaluateRules([rule], ctx, result1.updatedRecords, now + 1000);
    expect(result2.alerts).toHaveLength(0);

    // Third evaluation after cooldown — should trigger
    const result3 = evaluateRules([rule], ctx, result2.updatedRecords, now + 60_001);
    expect(result3.alerts).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 17. BATCH EVALUATION LIMITS
// ═══════════════════════════════════════════════════════════════

describe("batch evaluation limits", () => {
  it("does not exceed MAX_ALERTS_PER_EVALUATION", () => {
    const now = Date.now();
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    // Create many rules that will all trigger
    const rules: AlertRule[] = [];
    for (let i = 0; i < MAX_ALERTS_PER_EVALUATION + 5; i++) {
      rules.push(makeRule({
        ruleId: `rule-${i}`,
        condition: "THESIS_STATE_CHANGED",
        cooldownMs: 0, // No cooldown
      }));
    }

    const result = evaluateRules(rules, ctx, new Map(), now);
    expect(result.alerts.length).toBeLessThanOrEqual(MAX_ALERTS_PER_EVALUATION);
  });
});

// ═══════════════════════════════════════════════════════════════
// 18. BUILD RULE ALERT
// ═══════════════════════════════════════════════════════════════

describe("buildRuleAlert", () => {
  it("creates alert with correct fields", () => {
    const rule = makeRule({ userId: "user-1", severity: "HIGH" });
    const evalResult = { triggered: true, description: "Thesis changed", previousState: "HEALTHY", currentState: "STABLE" };

    const alert = buildRuleAlert(rule, evalResult, "pos-1", "BTC/USDT");

    expect(alert.source).toBe("CUSTOM_RULE");
    expect(alert.ruleId).toBe("rule-1");
    expect(alert.userId).toBe("user-1");
    expect(alert.severity).toBe("HIGH");
    expect(alert.positionId).toBe("pos-1");
    expect(alert.instrument).toBe("BTC/USDT");
    expect(alert.description).toBe("Thesis changed");
    expect(alert.previousState).toBe("HEALTHY");
    expect(alert.currentState).toBe("STABLE");
    expect(alert.alertId).toContain("custom-rule-1-");
  });
});

// ═══════════════════════════════════════════════════════════════
// 19. SAME INPUT → SAME OUTPUT (Determinism)
// ═══════════════════════════════════════════════════════════════

describe("determinism", () => {
  it("same input always produces identical evaluation result", () => {
    const rule = makeRule({ condition: "THESIS_STATE_CHANGED" });
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const r1 = evaluateRule(rule, ctx);
    const r2 = evaluateRule(rule, ctx);
    const r3 = evaluateRule(rule, ctx);

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

// ═══════════════════════════════════════════════════════════════
// 20. UNAVAILABLE DATA NEVER CREATES DIRECTIONAL EVIDENCE
// ═══════════════════════════════════════════════════════════════

describe("unavailable data safety", () => {
  it("DATA_BECAME_UNAVAILABLE triggers when data is unavailable (no fabrication)", () => {
    const rule = makeRule({ condition: "DATA_BECAME_UNAVAILABLE" });
    const intel = makeIntel({ dataQuality: "UNAVAILABLE" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousDataAvailability: new Map([["BTC/USDT", "AVAILABLE"]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(1);
    // The alert should report data became unavailable, not make directional claims
    expect(results[0].description).toContain("unavailable");
  });
});

// ═══════════════════════════════════════════════════════════════
// 21. CONSTANTS & LABELS
// ═══════════════════════════════════════════════════════════════

describe("constants and labels", () => {
  it("MAX_RULES_PER_USER is 50", () => {
    expect(MAX_RULES_PER_USER).toBe(50);
  });

  it("MAX_ALERTS_PER_EVALUATION is 20", () => {
    expect(MAX_ALERTS_PER_EVALUATION).toBe(20);
  });

  it("all conditions have labels", () => {
    const conditions = [
      "THESIS_STATE_CHANGED", "THESIS_BECAME_DETERIORATING", "THESIS_BECAME_INVALIDATED",
      "REGIME_CHANGED", "H1_TREND_CHANGED", "M15_TREND_CHANGED", "M5_TREND_CHANGED",
      "STRUCTURE_CHANGED", "MOMENTUM_CHANGED", "VOLATILITY_CHANGED",
      "EVIDENCE_QUALITY_CHANGED", "SUPPORTING_EVIDENCE_CHANGED", "CONFLICTING_EVIDENCE_CHANGED",
      "NEWS_BECAME_CONFLICTING", "NEWS_BECAME_SUPPORTING", "MACRO_REGIME_CHANGED",
      "CROSS_ASSET_CONFLICT", "PORTFOLIO_CONCENTRATION_DETECTED", "PORTFOLIO_CONFLICT_DETECTED",
      "DATA_BECAME_UNAVAILABLE", "DATA_RECOVERED",
    ] as const;

    for (const cond of conditions) {
      expect(CONDITION_LABELS[cond]).toBeTruthy();
    }
  });

  it("all severities have colors", () => {
    for (const sev of ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const) {
      expect(SEVERITY_COLORS[sev]).toBeTruthy();
      expect(SEVERITY_BG[sev]).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 22. UNMATCHED SCOPE RETURNS NO TRIGGER
// ═══════════════════════════════════════════════════════════════

describe("unmatched scope", () => {
  it("POSITION scope with wrong positionId returns no trigger", () => {
    const rule = makeRule({ scope: "POSITION", positionId: "pos-999", condition: "THESIS_STATE_CHANGED" });
    const intel = makeIntel({ thesisHealth: "STABLE" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });

  it("INSTRUMENT scope with wrong instrument returns no trigger", () => {
    const rule = makeRule({ scope: "INSTRUMENT", instrument: "ETH/USDT", condition: "THESIS_STATE_CHANGED" });
    const intel = makeIntel({ thesisHealth: "STABLE", instrument: "BTC/USDT" });
    const prev = makeSnapshot({ thesisState: "HEALTHY" });

    const ctx: RuleEvaluationContext = {
      positionIntelligence: new Map([["pos-1", intel]]),
      previousSnapshots: new Map([["pos-1", prev]]),
    };

    const results = evaluateRule(rule, ctx);
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 23. MISSING PREVIOUS STATE HANDLING
// ═══════════════════════════════════════════════════════════════

describe("missing previous state handling", () => {
  it("all conditions return no trigger when previous snapshot is missing", () => {
    const conditions = [
      "THESIS_STATE_CHANGED", "REGIME_CHANGED",
      "H1_TREND_CHANGED", "M15_TREND_CHANGED", "M5_TREND_CHANGED",
      "STRUCTURE_CHANGED", "MOMENTUM_CHANGED", "VOLATILITY_CHANGED",
      "EVIDENCE_QUALITY_CHANGED",
    ] as const;

    for (const condition of conditions) {
      const rule = makeRule({ condition });
      const intel = makeIntel({ thesisHealth: "STABLE" });

      const ctx: RuleEvaluationContext = {
        positionIntelligence: new Map([["pos-1", intel]]),
        // No previousSnapshots
      };

      const results = evaluateRule(rule, ctx);
      expect(results).toHaveLength(0);
    }
  });
});
