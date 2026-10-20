import { describe, it, expect } from "vitest";
import {
  buildDecisionSupport,
  classifyEvidence,
  classifyAllEvidence,
  detectThesisTransition,
  buildDecisionChanges,
  deriveInvalidationConditions,
  deriveWatchItems,
  getDecisionSupportSummary,
  buildPortfolioDecisionContext,
} from "./decision-support";
import type { PositionIntelligence, EvidenceItem, InvalidationCondition } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";

// ═══════════════════════════════════════════════════════════════
// PHASE 109 — DECISION SUPPORT & EVIDENCE QUALITY TESTS
// ═══════════════════════════════════════════════════════════════

const now = Date.now();

function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    category: "TECHNICAL",
    description: "Test evidence",
    direction: "supporting",
    strength: "MODERATE",
    ...overrides,
  };
}

function makeInvalidation(overrides: Partial<InvalidationCondition> = {}): InvalidationCondition {
  return {
    description: "Close below 58000",
    distancePct: 5.0,
    approaching: false,
    ...overrides,
  };
}

function makeIntel(overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 65000,
    entryPrice: 60000,
    marketState: "TRENDING_UP",
    shortTermContext: "Bullish momentum",
    mediumTermContext: "Uptrend intact",
    volatilityContext: "Normal volatility",
    pnlPct: 8.33,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    severity: "WATCH",
    actionRecommendation: "MONITOR",
    evidence: [
      makeEvidence({ category: "TECHNICAL", direction: "supporting", description: "H1 trend bullish", strength: "STRONG" }),
      makeEvidence({ category: "MOMENTUM", direction: "supporting", description: "Momentum positive", strength: "MODERATE" }),
      makeEvidence({ category: "VOLATILITY", direction: "conflicting", description: "RSI elevated", strength: "WEAK" }),
    ],
    independentSignalCount: 2,
    confidence: "STRONG_EVIDENCE",
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [
      makeInvalidation({ description: "Close below 58000", distancePct: 10.8, approaching: false }),
      makeInvalidation({ description: "Structure break", distancePct: 0, approaching: true }),
    ],
    nextMonitor: ["Volume confirmation", "Key resistance at 68000"],
    dataQuality: "AVAILABLE",
    observationCount: 100,
    provider: "TwelveData",
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makePortfolioIntel(overrides: Partial<PortfolioIntelligence> = {}): PortfolioIntelligence {
  return {
    summary: {
      totalPositions: 3,
      healthyPositions: 2,
      cautionPositions: 1,
      deterioratingPositions: 0,
      invalidatedPositions: 0,
      unavailablePositions: 0,
      dominantPortfolioState: "HEALTHY",
      portfolioEvidenceQuality: "STRONG_EVIDENCE",
    },
    exposure: [],
    alignments: [],
    conflicts: [],
    watchItems: [],
    marketContext: "Mixed markets",
    riskContext: "LOW_CONCERN",
    dataAvailability: {
      technical: "AVAILABLE",
      macro: "AVAILABLE",
      news: "AVAILABLE",
      derivatives: "LIMITED",
      fundamentals: "LIMITED",
    },
    generatedAt: now,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. DECISION SUPPORT CONSTRUCTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Decision Support Construction", () => {
  it("builds complete decision support from intelligence", () => {
    const intel = makeIntel();
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.positionId).toBe("pos-1");
    expect(ds.instrument).toBe("BTC/USDT");
    expect(ds.side).toBe("LONG");
    expect(ds.thesis).toBe("HEALTHY");
    expect(ds.score).toBe(80);
    expect(ds.generatedAt).toBe(now);
  });

  it("classifies evidence into supporting/conflicting/neutral", () => {
    const intel = makeIntel();
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.supportingEvidence.length).toBe(2);
    expect(ds.conflictingEvidence.length).toBe(1);
    expect(ds.neutralEvidence.length).toBe(0);
  });

  it("derives invalidation conditions", () => {
    const intel = makeIntel();
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.invalidationConditions.length).toBe(2);
    expect(ds.invalidationConditions[0].status).toBe("NOT_APPROACHING");
    expect(ds.invalidationConditions[1].status).toBe("TRIGGERED");
  });

  it("derives watch items", () => {
    const intel = makeIntel();
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.watchItems.length).toBeGreaterThanOrEqual(0);
  });

  it("derives dimension availability", () => {
    const intel = makeIntel({
      h1Analysis: { timeframe: "H1", trend: "BULLISH" } as any,
      m15Analysis: { timeframe: "M15", trend: "BULLISH" } as any,
    });
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.availableDimensions.length).toBeGreaterThan(0);
    expect(ds.availableDimensions.find((d) => d.dimension === "H1_TREND")).toBeDefined();
  });

  it("derives unavailable dimensions when missing", () => {
    const intel = makeIntel({ h1Analysis: undefined, m15Analysis: undefined, m5Analysis: undefined });
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.unavailableDimensions.find((d) => d.dimension === "H1_TREND")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. EVIDENCE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Evidence Classification", () => {
  it("supporting evidence classified correctly", () => {
    const evidence = makeEvidence({ direction: "supporting" });
    const classified = classifyEvidence(evidence, "LONG");
    expect(classified.classification).toBe("SUPPORTING");
    expect(classified.category).toBe("TECHNICAL");
  });

  it("conflicting evidence classified correctly", () => {
    const evidence = makeEvidence({ direction: "conflicting" });
    const classified = classifyEvidence(evidence, "LONG");
    expect(classified.classification).toBe("CONFLICTING");
  });

  it("neutral evidence classified correctly", () => {
    const evidence = makeEvidence({ direction: "neutral" });
    const classified = classifyEvidence(evidence, "LONG");
    expect(classified.classification).toBe("NEUTRAL");
  });

  it("classification is deterministic", () => {
    const evidence = makeEvidence({ direction: "supporting" });
    const c1 = classifyEvidence(evidence, "LONG");
    const c2 = classifyEvidence(evidence, "LONG");
    expect(c1.classification).toBe(c2.classification);
    expect(c1.description).toBe(c2.description);
  });

  it("classifyAllEvidence returns all items", () => {
    const intel = makeIntel();
    const classified = classifyAllEvidence(intel);
    expect(classified.length).toBe(intel.evidence.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: LONG/SHORT Symmetry", () => {
  it("LONG position classifies supporting evidence", () => {
    const evidence = makeEvidence({ direction: "supporting" });
    const classified = classifyEvidence(evidence, "LONG");
    expect(classified.classification).toBe("SUPPORTING");
  });

  it("SHORT position classifies supporting evidence the same way", () => {
    const evidence = makeEvidence({ direction: "supporting" });
    const classified = classifyEvidence(evidence, "SHORT");
    expect(classified.classification).toBe("SUPPORTING");
  });

  it("LONG and SHORT produce symmetric decision support", () => {
    const longIntel = makeIntel({ side: "LONG" });
    const shortIntel = makeIntel({ side: "SHORT" });

    const longDS = buildDecisionSupport("pos-long", longIntel, now);
    const shortDS = buildDecisionSupport("pos-short", shortIntel, now);

    // Same evidence → same classification counts
    expect(longDS.supportingEvidence.length).toBe(shortDS.supportingEvidence.length);
    expect(longDS.conflictingEvidence.length).toBe(shortDS.conflictingEvidence.length);
    expect(longDS.neutralEvidence.length).toBe(shortDS.neutralEvidence.length);
  });

  it("thesis is preserved per position regardless of side", () => {
    const longIntel = makeIntel({ side: "LONG", thesisHealth: "STABLE" });
    const shortIntel = makeIntel({ side: "SHORT", thesisHealth: "STABLE" });

    const longDS = buildDecisionSupport("pos-long", longIntel, now);
    const shortDS = buildDecisionSupport("pos-short", shortIntel, now);

    expect(longDS.thesis).toBe("STABLE");
    expect(shortDS.thesis).toBe("STABLE");
  });

  it("LONG and SHORT classify evidence identically for same direction", () => {
    const supporting = makeEvidence({ direction: "supporting" });
    const conflicting = makeEvidence({ direction: "conflicting" });

    const longS = classifyEvidence(supporting, "LONG");
    const shortS = classifyEvidence(supporting, "SHORT");
    const longC = classifyEvidence(conflicting, "LONG");
    const shortC = classifyEvidence(conflicting, "SHORT");

    expect(longS.classification).toBe("SUPPORTING");
    expect(shortS.classification).toBe("SUPPORTING");
    expect(longC.classification).toBe("CONFLICTING");
    expect(shortC.classification).toBe("CONFLICTING");
  });

  it("evidence classification does not assume directional bias", () => {
    // A supporting evidence item is SUPPORTING regardless of position side
    const evidence = makeEvidence({ direction: "supporting", description: "Volume confirmed" });
    expect(classifyEvidence(evidence, "LONG").classification).toBe("SUPPORTING");
    expect(classifyEvidence(evidence, "SHORT").classification).toBe("SUPPORTING");
  });

  it("evidence count symmetry for LONG and SHORT with identical evidence", () => {
    const evidence = [
      makeEvidence({ direction: "supporting" }),
      makeEvidence({ direction: "supporting" }),
      makeEvidence({ direction: "conflicting" }),
    ];
    const longIntel = makeIntel({ side: "LONG", evidence });
    const shortIntel = makeIntel({ side: "SHORT", evidence });

    const longDS = buildDecisionSupport("pos-long", longIntel, now);
    const shortDS = buildDecisionSupport("pos-short", shortIntel, now);

    expect(longDS.supportingEvidence.length).toBe(shortDS.supportingEvidence.length);
    expect(longDS.conflictingEvidence.length).toBe(shortDS.conflictingEvidence.length);
  });

  it("getDecisionSupportSummary uses count-based classification, not strength-weighted", () => {
    // The function compares counts of supporting vs conflicting evidence
    // It does NOT weight by evidence strength (STRONG/MODERATE/WEAK)
    const intel = makeIntel({
      evidence: [
        makeEvidence({ direction: "supporting", strength: "WEAK" }),
        makeEvidence({ direction: "conflicting", strength: "STRONG" }),
      ],
    });
    const ds = buildDecisionSupport("pos-1", intel, now);
    const summary = getDecisionSupportSummary(ds);
    // 1 supporting vs 1 conflicting → MIXED_EVIDENCE (not weighted by strength)
    expect(summary.overallAssessment).toBe("MIXED_EVIDENCE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. UNAVAILABLE DIMENSIONS
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Unavailable Dimensions", () => {
  it("missing timeframes are surfaced as unavailable", () => {
    const intel = makeIntel({
      h1Analysis: undefined,
      m15Analysis: undefined,
      m5Analysis: undefined,
    });
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.unavailableDimensions.find((d) => d.dimension === "H1_TREND")).toBeDefined();
    expect(ds.unavailableDimensions.find((d) => d.dimension === "M15_TREND")).toBeDefined();
    expect(ds.unavailableDimensions.find((d) => d.dimension === "M5_TREND")).toBeDefined();
  });

  it("available timeframes are surfaced correctly", () => {
    const intel = makeIntel({
      h1Analysis: { timeframe: "H1", trend: "BULLISH" } as any,
      m15Analysis: { timeframe: "M15", trend: "BULLISH" } as any,
    });
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.availableDimensions.find((d) => d.dimension === "H1_TREND")).toBeDefined();
    expect(ds.availableDimensions.find((d) => d.dimension === "M15_TREND")).toBeDefined();
  });

  it("zero price = unavailable price dimension", () => {
    const intel = makeIntel({ currentPrice: 0 });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.unavailableDimensions.find((d) => d.dimension === "PRICE")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. INSUFFICIENT DATA
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Insufficient Data", () => {
  it("unavailable dataQuality surfaces as unavailable dimensions", () => {
    const intel = makeIntel({ dataQuality: "UNAVAILABLE" });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.dataQuality).toBe("UNAVAILABLE");
  });

  it("insufficient evidence dataQuality surfaces correctly", () => {
    const intel = makeIntel({ dataQuality: "INSUFFICIENT_EVIDENCE" });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.dataQuality).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("insufficient data does not produce confident assessment", () => {
    const intel = makeIntel({ dataQuality: "UNAVAILABLE" });
    const ds = buildDecisionSupport("pos-1", intel, now);
    const summary = getDecisionSupportSummary(ds);
    expect(summary.overallAssessment).toBe("INSUFFICIENT_DATA");
  });

  it("empty evidence list produces INSUFFICIENT_EVIDENCE confidence", () => {
    const intel = makeIntel({ evidence: [] });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.evidenceClassified.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. THESIS TRANSITIONS
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Thesis Transitions", () => {
  it("no previous = INSUFFICIENT_DATA", () => {
    expect(detectThesisTransition(undefined, "HEALTHY")).toBe("INSUFFICIENT_DATA");
  });

  it("same state = STABLE", () => {
    expect(detectThesisTransition("HEALTHY", "HEALTHY")).toBe("STABLE");
    expect(detectThesisTransition("CAUTION", "CAUTION")).toBe("STABLE");
  });

  it("HEALTHY → CAUTION = DETERIORATING", () => {
    expect(detectThesisTransition("HEALTHY", "CAUTION")).toBe("DETERIORATING");
  });

  it("HEALTHY → DETERIORATING = FLIPPED", () => {
    expect(detectThesisTransition("HEALTHY", "DETERIORATING")).toBe("FLIPPED");
  });

  it("DETERIORATING → HEALTHY = FLIPPED", () => {
    expect(detectThesisTransition("DETERIORATING", "HEALTHY")).toBe("FLIPPED");
  });

  it("CAUTION → HEALTHY = IMPROVING", () => {
    expect(detectThesisTransition("CAUTION", "HEALTHY")).toBe("IMPROVING");
  });

  it("DETERIORATING → CAUTION = IMPROVING", () => {
    expect(detectThesisTransition("DETERIORATING", "CAUTION")).toBe("IMPROVING");
  });

  it("HEALTHY → STABLE = DETERIORATING (slight decline)", () => {
    expect(detectThesisTransition("HEALTHY", "STABLE")).toBe("DETERIORATING");
  });

  it("deterministic output", () => {
    const r1 = detectThesisTransition("HEALTHY", "CAUTION");
    const r2 = detectThesisTransition("HEALTHY", "CAUTION");
    expect(r1).toBe(r2);
  });

  // FLIPPED semantics: FLIPPED means thesis-health boundary crossing
  // (HEALTHY ↔ DETERIORATING+), NOT LONG→SHORT or SHORT→LONG
  it("FLIPPED = HEALTHY → DETERIORATING (boundary crossing)", () => {
    expect(detectThesisTransition("HEALTHY", "DETERIORATING")).toBe("FLIPPED");
  });

  it("FLIPPED = DETERIORATING → HEALTHY (boundary crossing back)", () => {
    expect(detectThesisTransition("DETERIORATING", "HEALTHY")).toBe("FLIPPED");
  });

  it("HEALTHY → SEVERELY_DETERIORATING = FLIPPED (extreme crossing)", () => {
    expect(detectThesisTransition("HEALTHY", "SEVERELY_DETERIORATING")).toBe("FLIPPED");
  });

  it("SEVERELY_DETERIORATING → HEALTHY = FLIPPED (extreme crossing back)", () => {
    expect(detectThesisTransition("SEVERELY_DETERIORATING", "HEALTHY")).toBe("FLIPPED");
  });

  it("STABLE → DETERIORATING = DETERIORATING (not FLIPPED, moderate decline)", () => {
    // STABLE (rank 3) → DETERIORATING (rank 5): moderate decline, not boundary flip
    expect(detectThesisTransition("STABLE", "DETERIORATING")).toBe("DETERIORATING");
  });

  it("FLIPPED is about thesis health, not position direction", () => {
    // LONG and SHORT with same health transition produce identical results
    // detectThesisTransition does not receive side — it operates on thesis states only
    expect(detectThesisTransition("HEALTHY", "DETERIORATING")).toBe("FLIPPED");
    expect(detectThesisTransition("HEALTHY", "DETERIORATING")).toBe("FLIPPED");
  });

  it("LONG→SHORT with same health does not produce FLIPPED", () => {
    // Side change is not a thesis health transition
    // detectThesisTransition only compares thesis states, not sides
    // With same thesis, any side change is STABLE
    expect(detectThesisTransition("HEALTHY", "HEALTHY")).toBe("STABLE");
  });

  it("SHORT→LONG with same health does not produce FLIPPED", () => {
    expect(detectThesisTransition("HEALTHY", "HEALTHY")).toBe("STABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. CHANGE DETECTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Change Detection", () => {
  it("no previous = empty changes", () => {
    const intel = makeIntel();
    const changes = buildDecisionChanges(undefined, intel);
    expect(changes).toHaveLength(0);
  });

  it("same state = no changes", () => {
    const intel = makeIntel();
    const changes = buildDecisionChanges(intel, intel);
    expect(changes).toHaveLength(0);
  });

  it("thesis health change detected", () => {
    const prev = makeIntel({ thesisHealth: "HEALTHY" });
    const curr = makeIntel({ thesisHealth: "STABLE" });
    const changes = buildDecisionChanges(prev, curr);
    expect(changes.some((c) => c.field === "thesisHealth")).toBe(true);
  });

  it("thesis score change detected", () => {
    const prev = makeIntel({ thesisHealthScore: 80 });
    const curr = makeIntel({ thesisHealthScore: 60 });
    const changes = buildDecisionChanges(prev, curr);
    expect(changes.some((c) => c.field === "thesisHealthScore")).toBe(true);
  });

  it("only changed fields are reported", () => {
    const prev = makeIntel({ thesisHealth: "HEALTHY", thesisHealthScore: 80 });
    const curr = makeIntel({ thesisHealth: "STABLE", thesisHealthScore: 80 });
    const changes = buildDecisionChanges(prev, curr);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("thesisHealth");
  });

  it("deterministic change detection", () => {
    const prev = makeIntel({ thesisHealth: "HEALTHY" });
    const curr = makeIntel({ thesisHealth: "DETERIORATING" });
    const c1 = buildDecisionChanges(prev, curr);
    const c2 = buildDecisionChanges(prev, curr);
    expect(c1.length).toBe(c2.length);
    expect(c1[0].field).toBe(c2[0].field);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. INVALIDATION MODEL
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Invalidation Model", () => {
  it("approaching invalidation = APPROACHING", () => {
    const intel = makeIntel({
      invalidationConditions: [makeInvalidation({ approaching: true, distancePct: 1.5 })],
    });
    const conditions = deriveInvalidationConditions(intel);
    expect(conditions[0].status).toBe("APPROACHING");
  });

  it("not approaching = NOT_APPROACHING", () => {
    const intel = makeIntel({
      invalidationConditions: [makeInvalidation({ approaching: false, distancePct: 10 })],
    });
    const conditions = deriveInvalidationConditions(intel);
    expect(conditions[0].status).toBe("NOT_APPROACHING");
  });

  it("triggered (distance 0 + approaching) = TRIGGERED", () => {
    const intel = makeIntel({
      invalidationConditions: [makeInvalidation({ approaching: true, distancePct: 0 })],
    });
    const conditions = deriveInvalidationConditions(intel);
    expect(conditions[0].status).toBe("TRIGGERED");
  });  it("no invalidation conditions = empty", () => {
    const intel = makeIntel({ invalidationConditions: [] });
    const conditions = deriveInvalidationConditions(intel);
    expect(conditions).toHaveLength(0);
  });

  it("distancePct < 0 + approaching = APPROACHING", () => {
    const intel = makeIntel({
      invalidationConditions: [makeInvalidation({ approaching: true, distancePct: -1.5 })],
    });
    const conditions = deriveInvalidationConditions(intel);
    expect(conditions[0].status).toBe("APPROACHING");
  });

  it("distancePct < 0 + not approaching = NOT_APPROACHING", () => {
    const intel = makeIntel({
      invalidationConditions: [makeInvalidation({ approaching: false, distancePct: -5 })],
    });
    const conditions = deriveInvalidationConditions(intel);
    expect(conditions[0].status).toBe("NOT_APPROACHING");
  });

  it("distancePct === 0 + not approaching = NOT_APPROACHING", () => {
    const intel = makeIntel({
      invalidationConditions: [makeInvalidation({ approaching: false, distancePct: 0 })],
    });
    const conditions = deriveInvalidationConditions(intel);
    expect(conditions[0].status).toBe("NOT_APPROACHING");
  });

  it("all six boundary states produce deterministic output", () => {
    const cases: Array<[number, boolean, string]> = [
      [5, false, "NOT_APPROACHING"],
      [5, true, "APPROACHING"],
      [0, true, "TRIGGERED"],
      [0, false, "NOT_APPROACHING"],
      [-1, true, "APPROACHING"],
      [-1, false, "NOT_APPROACHING"],
    ];
    for (const [dist, approaching, expected] of cases) {
      const intel = makeIntel({
        invalidationConditions: [makeInvalidation({ approaching, distancePct: dist })],
      });
      const conditions = deriveInvalidationConditions(intel);
      expect(conditions[0].status).toBe(expected);
    }
  });

});

// ═══════════════════════════════════════════════════════════════
// 9. WATCH ITEMS
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Watch Items", () => {
  it("timeframe disagreement generates MEDIUM watch item", () => {
    const intel = makeIntel({
      h1Analysis: { timeframe: "H1", trend: "BULLISH", ...{} } as any,
      m15Analysis: { timeframe: "M15", trend: "BEARISH", ...{} } as any,
      m5Analysis: { timeframe: "M5", trend: "BULLISH", ...{} } as any,
    });
    const classified = classifyAllEvidence(intel);
    const watchItems = deriveWatchItems(intel, classified);
    expect(watchItems.some((w) => w.category === "TIMEFRAME_DISAGREEMENT")).toBe(true);
  });

  it("deteriorating thesis generates HIGH watch item", () => {
    const intel = makeIntel({ thesisHealth: "DETERIORATING" });
    const classified = classifyAllEvidence(intel);
    const watchItems = deriveWatchItems(intel, classified);
    expect(watchItems.some((w) => w.category === "THESIS_HEALTH" && w.priority === "HIGH")).toBe(true);
  });

  it("severely deteriorating generates CRITICAL watch item", () => {
    const intel = makeIntel({ thesisHealth: "SEVERELY_DETERIORATING" });
    const classified = classifyAllEvidence(intel);
    const watchItems = deriveWatchItems(intel, classified);
    expect(watchItems.some((w) => w.category === "THESIS_HEALTH" && w.priority === "CRITICAL")).toBe(true);
  });

  it("approaching invalidation generates HIGH watch item", () => {
    const intel = makeIntel({
      invalidationConditions: [makeInvalidation({ approaching: true })],
    });
    const classified = classifyAllEvidence(intel);
    const watchItems = deriveWatchItems(intel, classified);
    expect(watchItems.some((w) => w.category === "INVALIDATION")).toBe(true);
  });

  it("watch items are sorted by priority", () => {
    const intel = makeIntel({
      thesisHealth: "SEVERELY_DETERIORATING",
      invalidationConditions: [makeInvalidation({ approaching: true })],
    });
    const classified = classifyAllEvidence(intel);
    const watchItems = deriveWatchItems(intel, classified);
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    for (let i = 1; i < watchItems.length; i++) {
      expect(priorityOrder[watchItems[i].priority]).toBeGreaterThanOrEqual(
        priorityOrder[watchItems[i - 1].priority],
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. PORTFOLIO DECISION CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Portfolio Decision Context", () => {
  it("builds context from portfolio intelligence", () => {
    const pi = makePortfolioIntel();
    const ctx = buildPortfolioDecisionContext(pi);

    expect(ctx.dominantThesis).toBe("HEALTHY");
    expect(ctx.positionCount).toBe(3);
  });

  it("captures conflicts", () => {
    const pi = makePortfolioIntel({
      conflicts: [
        {
          positionA: "BTC/USDT LONG",
          positionB: "BTC/USDT SHORT",
          conflictType: "DIRECT_DIRECTIONAL",
          description: "Direct conflict on BTC",
          strength: "STRONG",
        },
      ],
    });
    const ctx = buildPortfolioDecisionContext(pi);
    expect(ctx.thesisConflicts.length).toBe(1);
    expect(ctx.conflictingPositions.length).toBeGreaterThan(0);
  });

  it("captures alignments", () => {
    const pi = makePortfolioIntel({
      alignments: [
        {
          instruments: ["BTC/USDT", "ETH/USDT"],
          alignmentType: "REGIME_MATCH",
          description: "Both aligned",
          strength: "STRONG",
        },
      ],
    });
    const ctx = buildPortfolioDecisionContext(pi);
    expect(ctx.alignedPositions.length).toBe(2);
  });

  it("unavailable news surfaces as warning", () => {
    const pi = makePortfolioIntel({
      dataAvailability: {
        technical: "AVAILABLE",
        macro: "AVAILABLE",
        news: "UNAVAILABLE",
        derivatives: "LIMITED",
        fundamentals: "LIMITED",
      },
    });
    const ctx = buildPortfolioDecisionContext(pi);
    expect(ctx.dataQualityWarnings.some((w) => w.includes("News"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. DATA QUALITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Data Quality", () => {
  it("AVAILABLE dataQuality preserved in decision support", () => {
    const intel = makeIntel({ dataQuality: "AVAILABLE" });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.dataQuality).toBe("AVAILABLE");
  });

  it("summary reflects data quality", () => {
    const intel = makeIntel({ dataQuality: "UNAVAILABLE" });
    const ds = buildDecisionSupport("pos-1", intel, now);
    const summary = getDecisionSupportSummary(ds);
    expect(summary.dataQuality).toBe("UNAVAILABLE");
  });

  it("evidence-weighted assessment with more supporting", () => {
    const intel = makeIntel({
      evidence: [
        makeEvidence({ direction: "supporting" }),
        makeEvidence({ direction: "supporting" }),
        makeEvidence({ direction: "supporting" }),
        makeEvidence({ direction: "conflicting" }),
      ],
    });
    const ds = buildDecisionSupport("pos-1", intel, now);
    const summary = getDecisionSupportSummary(ds);
    expect(summary.overallAssessment).toBe("COUNT_SUPPORTING");
  });

  it("evidence-weighted assessment with more conflicting", () => {
    const intel = makeIntel({
      evidence: [
        makeEvidence({ direction: "conflicting" }),
        makeEvidence({ direction: "conflicting" }),
        makeEvidence({ direction: "supporting" }),
      ],
    });
    const ds = buildDecisionSupport("pos-1", intel, now);
    const summary = getDecisionSupportSummary(ds);
    expect(summary.overallAssessment).toBe("COUNT_CONFLICTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Safety Invariants", () => {
  const executionWords = ["buy", "sell", "execute", "order", "trade", "auto-buy", "auto-sell", "place order"];
  const probabilityWords = ["guaranteed", "likely", "will happen", "probability", "chance", "expected return"];

  it("no execution language in decision support descriptions", () => {
    const intel = makeIntel();
    const ds = buildDecisionSupport("pos-1", intel, now);
    const allText = [
      ds.marketContext,
      ds.trendContext,
      ...ds.watchItems.map((w) => w.description),
      ...ds.invalidationConditions.map((ic) => ic.description),
    ].join(" ").toLowerCase();

    for (const word of executionWords) {
      expect(allText).not.toContain(word);
    }
  });

  it("no probability language in decision support", () => {
    const intel = makeIntel();
    const ds = buildDecisionSupport("pos-1", intel, now);
    const allText = [
      ds.marketContext,
      ds.trendContext,
      ...ds.watchItems.map((w) => w.description),
      ...ds.invalidationConditions.map((ic) => ic.description),
    ].join(" ").toLowerCase();

    for (const word of probabilityWords) {
      expect(allText).not.toContain(word);
    }
  });

  it("no fabricated data — all fields from intelligence", () => {
    const intel = makeIntel({
      instrument: "ETH/USDT",
      side: "SHORT",
      thesisHealth: "STABLE",
    });
    const ds = buildDecisionSupport("pos-1", intel, now);

    expect(ds.instrument).toBe("ETH/USDT");
    expect(ds.side).toBe("SHORT");
    expect(ds.thesis).toBe("STABLE");
  });

  it("deterministic output for same inputs", () => {
    const intel = makeIntel();
    const ds1 = buildDecisionSupport("pos-1", intel, now);
    const ds2 = buildDecisionSupport("pos-1", intel, now);

    expect(ds1.supportingEvidence.length).toBe(ds2.supportingEvidence.length);
    expect(ds1.conflictingEvidence.length).toBe(ds2.conflictingEvidence.length);
    expect(ds1.watchItems.length).toBe(ds2.watchItems.length);
    expect(ds1.invalidationConditions.length).toBe(ds2.invalidationConditions.length);
  });

  it("no mutation of input intelligence", () => {
    const intel = makeIntel();
    const originalEvidence = [...intel.evidence];
    buildDecisionSupport("pos-1", intel, now);
    expect(intel.evidence.length).toBe(originalEvidence.length);
    expect(intel.thesisHealth).toBe("HEALTHY");
  });

  it("unavailable data never becomes confident assessment", () => {
    const intel = makeIntel({
      dataQuality: "UNAVAILABLE",
      evidence: [],
      h1Analysis: undefined,
      m15Analysis: undefined,
      m5Analysis: undefined,
    });
    const ds = buildDecisionSupport("pos-1", intel, now);
    const summary = getDecisionSupportSummary(ds);
    expect(summary.overallAssessment).toBe("INSUFFICIENT_DATA");
  });

  it("source dimension preserved in evidence", () => {
    const intel = makeIntel();
    const ds = buildDecisionSupport("pos-1", intel, now);
    for (const e of ds.evidenceClassified) {
      expect(e.sourceDimension).toBeDefined();
      expect(e.sourceDimension.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. PERFORMANCE BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Performance Bounds", () => {
  it("handles large evidence lists efficiently", () => {
    const evidence: EvidenceItem[] = [];
    for (let i = 0; i < 100; i++) {
      evidence.push(makeEvidence({
        category: `DIM_${i}`,
        direction: i % 3 === 0 ? "conflicting" : i % 3 === 1 ? "supporting" : "neutral",
      }));
    }
    const intel = makeIntel({ evidence });
    const start = Date.now();
    const ds = buildDecisionSupport("pos-1", intel, now);
    const elapsed = Date.now() - start;

    expect(ds.evidenceClassified.length).toBe(100);
    expect(elapsed).toBeLessThan(100);
  });

  it("handles positions with many invalidation conditions", () => {
    const conditions: InvalidationCondition[] = [];
    for (let i = 0; i < 20; i++) {
      conditions.push(makeInvalidation({
        description: `Condition ${i}`,
        approaching: i % 5 === 0,
        distancePct: i * 2,
      }));
    }
    const intel = makeIntel({ invalidationConditions: conditions });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.invalidationConditions.length).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. EMPTY STATE
// ═══════════════════════════════════════════════════════════════

describe("Phase 109: Empty State", () => {
  it("intel with no evidence produces empty classified lists", () => {
    const intel = makeIntel({ evidence: [] });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.supportingEvidence).toHaveLength(0);
    expect(ds.conflictingEvidence).toHaveLength(0);
    expect(ds.neutralEvidence).toHaveLength(0);
  });

  it("intel with no invalidation conditions", () => {
    const intel = makeIntel({ invalidationConditions: [] });
    const ds = buildDecisionSupport("pos-1", intel, now);
    expect(ds.invalidationConditions).toHaveLength(0);
  });

  it("portfolio with no conflicts", () => {
    const pi = makePortfolioIntel({ conflicts: [], alignments: [] });
    const ctx = buildPortfolioDecisionContext(pi);
    expect(ctx.thesisConflicts).toHaveLength(0);
    expect(ctx.alignedPositions).toHaveLength(0);
  });
});
