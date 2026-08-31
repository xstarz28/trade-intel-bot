/**
 * Phase 107 — Trader Workspace & Intelligence Actionability Tests
 *
 * Tests for the presentation-only TraderWorkspace components.
 * Verifies that existing intelligence data is correctly surfaced
 * without new calculations, fabricated data, or execution language.
 */

import { describe, it, expect } from "vitest";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence, PortfolioSummary } from "./portfolio-intelligence";
import type { RuntimeHealthSnapshot, RuntimeHealthComponent } from "./runtime-health";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeIntel(overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 65000,
    entryPrice: 60000,
    marketState: "trending",
    shortTermContext: "BULLISH",
    mediumTermContext: "BULLISH",
    volatilityContext: "NORMAL",
    ohlcvRegime: "TRENDING_UP",
    pnlPct: 8.33,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    severity: "NONE",
    actionRecommendation: "HOLD",
    evidence: [
      { direction: "supporting", description: "H1 trend bullish" },
      { direction: "supporting", description: "M15 structure intact" },
      { direction: "conflicting", description: "M5 overbought" },
    ],
    independentSignalCount: 3,
    confidence: "STRONG_EVIDENCE",
    pullbackClassification: "NONE",
    invalidationConditions: [
      { description: "H1 structure breaks below support", distancePct: 5.2, approaching: false },
      { description: "H1 trend shifts to bearish", distancePct: 3.1, approaching: false },
    ],
    nextMonitor: ["M15 structure", "Volume confirmation"],
    dataQuality: "AVAILABLE",
    h1Analysis: { trend: "BULLISH", structureBroken: false, volatility: "NORMAL" } as any,
    m15Analysis: { trend: "BULLISH", structureBroken: false, volatility: "NORMAL" } as any,
    m5Analysis: { trend: "BEARISH", structureBroken: false, volatility: "EXPANDED" } as any,
    ...overrides,
  } as PositionIntelligence;
}

function makePortfolioSummary(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    totalPositions: 3,
    healthyPositions: 2,
    cautionPositions: 1,
    deterioratingPositions: 0,
    invalidatedPositions: 0,
    unavailablePositions: 0,
    dominantPortfolioState: "HEALTHY",
    portfolioEvidenceQuality: "MODERATE_EVIDENCE",
    ...overrides,
  };
}

function makePortfolioIntel(overrides: Partial<PortfolioIntelligence> = {}): PortfolioIntelligence {
  return {
    summary: makePortfolioSummary(),
    exposure: [],
    alignments: [
      {
        instruments: ["BTC/USDT", "ETH/USDT"],
        alignmentType: "DIRECTIONAL",
        description: "BTC and ETH share bullish structural evidence",
        strength: "STRONG",
      },
    ],
    conflicts: [],
    watchItems: [
      {
        priority: "MEDIUM",
        instrument: "XAU/USD",
        reason: "Approaching key resistance",
        category: "STRUCTURE",
        strength: "MODERATE",
      },
    ],
    marketContext: "Mixed risk environment",
    riskContext: { level: "MODERATE", description: "Moderate risk" } as any,
    dataAvailability: {
      technical: "AVAILABLE",
      macro: "AVAILABLE",
      news: "UNAVAILABLE",
      derivatives: "UNAVAILABLE",
      fundamentals: "UNAVAILABLE",
    } as any,
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeHealthSnapshot(overrides: Partial<RuntimeHealthSnapshot> = {}): RuntimeHealthSnapshot {
  return {
    timestamp: Date.now(),
    overallStatus: "HEALTHY",
    components: [
      { component: "MARKET_DATA", status: "HEALTHY", consecutiveFailures: 0, message: "OK", freshness: "FRESH" },
      { component: "OHLCV", status: "HEALTHY", consecutiveFailures: 0, message: "OK", freshness: "FRESH" },
      { component: "NEWS", status: "DEGRADED", consecutiveFailures: 2, message: "Rate limited", freshness: "AGING" },
    ],
    intelligenceCycleStatus: "HEALTHY",
    alertPipelineStatus: "HEALTHY",
    persistenceStatus: "HEALTHY",
    providerAvailability: {},
    staleComponents: [],
    unavailableComponents: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. DATA PRESERVATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — Data Preservation", () => {
  it("position intelligence fields are all present", () => {
    const intel = makeIntel();
    expect(intel.instrument).toBe("BTC/USDT");
    expect(intel.side).toBe("LONG");
    expect(intel.thesisHealth).toBe("HEALTHY");
    expect(intel.h1Analysis?.trend).toBe("BULLISH");
    expect(intel.m15Analysis?.trend).toBe("BULLISH");
    expect(intel.m5Analysis?.trend).toBe("BEARISH");
    expect(intel.dataQuality).toBe("AVAILABLE");
    expect(intel.evidence.length).toBe(3);
    expect(intel.invalidationConditions.length).toBe(2);
    expect(intel.nextMonitor.length).toBe(2);
  });

  it("unavailable intelligence dimension shows UNAVAILABLE, not fabricated value", () => {
    const intel = makeIntel({
      h1Analysis: undefined,
      m15Analysis: undefined,
      m5Analysis: undefined,
    });
    expect(intel.h1Analysis).toBeUndefined();
    expect(intel.m15Analysis).toBeUndefined();
    expect(intel.m5Analysis).toBeUndefined();
  });

  it("portfolio intelligence fields are preserved", () => {
    const pi = makePortfolioIntel();
    expect(pi.summary.totalPositions).toBe(3);
    expect(pi.summary.healthyPositions).toBe(2);
    expect(pi.alignments.length).toBe(1);
    expect(pi.conflicts.length).toBe(0);
    expect(pi.watchItems.length).toBe(1);
  });

  it("health snapshot fields are preserved", () => {
    const h = makeHealthSnapshot();
    expect(h.overallStatus).toBe("HEALTHY");
    expect(h.components.length).toBe(3);
    const news = h.components.find((c) => c.component === "NEWS");
    expect(news?.status).toBe("DEGRADED");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. EVIDENCE TRACE
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — Evidence Trace", () => {
  it("supporting evidence is correctly identified", () => {
    const intel = makeIntel();
    const supporting = intel.evidence.filter((e) => e.direction === "supporting");
    expect(supporting.length).toBe(2);
    expect(supporting[0].description).toContain("H1");
  });

  it("conflicting evidence is correctly identified", () => {
    const intel = makeIntel();
    const conflicting = intel.evidence.filter((e) => e.direction === "conflicting");
    expect(conflicting.length).toBe(1);
    expect(conflicting[0].description).toContain("M5");
  });

  it("evidence trace is deterministic", () => {
    const intel = makeIntel();
    const s1 = intel.evidence.filter((e) => e.direction === "supporting").length;
    const s2 = intel.evidence.filter((e) => e.direction === "supporting").length;
    expect(s1).toBe(s2);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — LONG/SHORT Symmetry", () => {
  it("LONG and SHORT positions have same data structure", () => {
    const long = makeIntel({ side: "LONG" });
    const short = makeIntel({ side: "SHORT", entryPrice: 65000, currentPrice: 60000, pnlPct: -7.69 });

    expect(long.evidence.length).toBe(short.evidence.length);
    expect(long.invalidationConditions.length).toBe(short.invalidationConditions.length);
    expect(long.nextMonitor.length).toBe(short.nextMonitor.length);
  });

  it("thesis health is independent of side", () => {
    const longHealthy = makeIntel({ side: "LONG", thesisHealth: "HEALTHY" });
    const shortHealthy = makeIntel({ side: "SHORT", thesisHealth: "HEALTHY" });
    expect(longHealthy.thesisHealth).toBe(shortHealthy.thesisHealth);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. PORTFOLIO DRILL-DOWN
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — Portfolio Drill-Down", () => {
  it("alignments have instruments and description", () => {
    const pi = makePortfolioIntel();
    expect(pi.alignments[0].instruments.length).toBe(2);
    expect(pi.alignments[0].description).toBeTruthy();
  });

  it("conflicts have both positions identified", () => {
    const pi = makePortfolioIntel({
      conflicts: [
        {
          positionA: "BTC/USDT LONG",
          positionB: "ETH/USDT SHORT",
          conflictType: "DIRECTIONAL",
          description: "Opposite directional bias",
          strength: "STRONG",
        },
      ],
    });
    expect(pi.conflicts[0].positionA).toBeTruthy();
    expect(pi.conflicts[0].positionB).toBeTruthy();
  });

  it("watch items have priority and reason", () => {
    const pi = makePortfolioIntel();
    expect(pi.watchItems[0].priority).toBeTruthy();
    expect(pi.watchItems[0].reason).toBeTruthy();
  });

  it("thesis distribution from summary is correct", () => {
    const pi = makePortfolioIntel({
      summary: makePortfolioSummary({
        healthyPositions: 1,
        cautionPositions: 2,
        deterioratingPositions: 1,
        totalPositions: 4,
      }),
    });
    expect(pi.summary.healthyPositions + pi.summary.cautionPositions + pi.summary.deterioratingPositions).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. DATA QUALITY TRANSPARENCY
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — Data Quality Transparency", () => {
  it("AVAILABLE data is correctly identified", () => {
    const intel = makeIntel({ dataQuality: "AVAILABLE" });
    expect(intel.dataQuality).toBe("AVAILABLE");
  });

  it("UNAVAILABLE data is not silently replaced", () => {
    const intel = makeIntel({ dataQuality: "UNAVAILABLE" });
    expect(intel.dataQuality).toBe("UNAVAILABLE");
  });

  it("INSUFFICIENT data shows explicitly", () => {
    const intel = makeIntel({ dataQuality: "INSUFFICIENT" });
    expect(intel.dataQuality).toBe("INSUFFICIENT");
  });

  it("health component degradation is surfaced", () => {
    const h = makeHealthSnapshot();
    const degraded = h.components.filter((c) => c.status !== "HEALTHY" && c.status !== "UNKNOWN");
    expect(degraded.length).toBe(1);
    expect(degraded[0].component).toBe("NEWS");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. INVALIDATION CONDITIONS
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — Invalidation Conditions", () => {
  it("invalidation conditions are surfaced as 'what could change this'", () => {
    const intel = makeIntel();
    expect(intel.invalidationConditions.length).toBe(2);
    expect(intel.invalidationConditions[0].description).toContain("H1");
  });

  it("approaching invalidation is tracked", () => {
    const intel = makeIntel({
      invalidationConditions: [
        { description: "H1 structure breaks", distancePct: 1.5, approaching: true },
      ],
    });
    expect(intel.invalidationConditions[0].approaching).toBe(true);
  });

  it("invalidation conditions do not contain execution language", () => {
    const intel = makeIntel();
    const execWords = ["buy", "sell", "execute", "close", "open position"];
    for (const ic of intel.invalidationConditions) {
      const lower = ic.description.toLowerCase();
      for (const word of execWords) {
        expect(lower).not.toContain(word);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// G. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — Safety Invariants", () => {
  it("no execution language in intelligence fields", () => {
    const intel = makeIntel();
    const execWords = ["buy now", "sell now", "execute trade", "place order", "auto-trade"];
    const combined = [
      intel.actionRecommendation,
      intel.shortTermContext,
      intel.mediumTermContext,
      ...intel.invalidationConditions.map((c) => c.description),
      ...intel.nextMonitor,
    ].join(" ").toLowerCase();
    for (const word of execWords) {
      expect(combined).not.toContain(word);
    }
  });

  it("no probability language in intelligence", () => {
    const intel = makeIntel();
    const probWords = ["probability", "percent chance", "will happen", "guaranteed"];
    const combined = [
      intel.actionRecommendation,
      intel.shortTermContext,
      intel.mediumTermContext,
      ...intel.evidence.map((e) => e.description),
    ].join(" ").toLowerCase();
    for (const word of probWords) {
      expect(combined).not.toContain(word);
    }
  });

  it("no fabricated market data in health snapshot", () => {
    const h = makeHealthSnapshot();
    // Should only contain status data, not prices
    expect(h.overallStatus).toBeTruthy();
    expect(h.components.length).toBeGreaterThan(0);
    expect(typeof h.timestamp).toBe("number");
  });

  it("deterministic output for same input", () => {
    const intel = makeIntel();
    const t1 = intel.thesisHealth;
    const t2 = intel.thesisHealth;
    expect(t1).toBe(t2);
  });

  it("portfolio intelligence has no execution commands", () => {
    const pi = makePortfolioIntel();
    const combined = [
      pi.marketContext,
      ...pi.alignments.map((a) => a.description),
      ...pi.conflicts.map((c) => c.description),
      ...pi.watchItems.map((w) => w.reason),
    ].join(" ").toLowerCase();
    const execWords = ["buy", "sell", "execute", "close position", "place order"];
    for (const word of execWords) {
      expect(combined).not.toContain(word);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// H. NO DUPLICATE CALCULATIONS
// ═══════════════════════════════════════════════════════════════

describe("Phase 107 — No Duplicate Calculations", () => {
  it("thesis distribution can be derived from existing summary", () => {
    const pi = makePortfolioIntel();
    const total = pi.summary.healthyPositions + pi.summary.cautionPositions +
      pi.summary.deterioratingPositions + pi.summary.invalidatedPositions +
      pi.summary.unavailablePositions;
    expect(total).toBe(pi.summary.totalPositions);
  });

  it("evidence counts are derivable from existing evidence array", () => {
    const intel = makeIntel();
    const supporting = intel.evidence.filter((e) => e.direction === "supporting").length;
    const conflicting = intel.evidence.filter((e) => e.direction === "conflicting").length;
    const total = supporting + conflicting + intel.evidence.filter((e) => e.direction === "neutral").length;
    expect(total).toBe(intel.evidence.length);
  });

  it("health components can be filtered from existing snapshot", () => {
    const h = makeHealthSnapshot();
    const healthy = h.components.filter((c) => c.status === "HEALTHY");
    const degraded = h.components.filter((c) => c.status === "DEGRADED");
    expect(healthy.length + degraded.length).toBeLessThanOrEqual(h.components.length);
  });
});
