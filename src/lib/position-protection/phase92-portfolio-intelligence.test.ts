/**
 * Phase 92 — Portfolio Intelligence Tests
 */

import { describe, it, expect } from "vitest";
import {
  generatePortfolioIntelligence,
} from "./portfolio-intelligence";
import type { PositionIntelligence } from "./market-intelligence-analyzer";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makePosition(overrides: Partial<PositionIntelligence> = {}): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 65000,
    entryPrice: 60000,
    marketState: "TRENDING_UP",
    shortTermContext: "Bullish",
    mediumTermContext: "Bullish",
    volatilityContext: "Normal",
    mtfConfluence: undefined,
    ohlcvRegime: "TRENDING_UP",
    h1Analysis: { trend: "BULLISH", momentum: "NORMAL", volatility: "NORMAL", structure: "HIGHER_HIGHS_HIGHER_LOWS", priceVsMA: "ABOVE" } as any,
    m15Analysis: { trend: "BULLISH", momentum: "NORMAL", volatility: "NORMAL", structure: "HIGHER_HIGHS_HIGHER_LOWS", priceVsMA: "ABOVE" } as any,
    m5Analysis: { trend: "BULLISH", momentum: "NORMAL", volatility: "NORMAL", structure: "HIGHER_HIGHS_HIGHER_LOWS", priceVsMA: "ABOVE" } as any,
    pnlPct: 8.33,
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    severity: "NONE",
    actionRecommendation: "Hold and monitor.",
    evidence: [{ category: "TECHNICAL", description: "H1 bullish", direction: "supporting", strength: "STRONG" }],
    independentSignalCount: 3,
    confidence: "MODERATE_EVIDENCE",
    pullbackClassification: "INSUFFICIENT_DATA",
    invalidationConditions: [{ description: "H1 structure breaks", distancePct: 2.5, isClose: false } as any],
    nextMonitor: ["M5 momentum"],
    dataQuality: "SUFFICIENT",
    observationCount: 10,
    provider: "TwelveData",
    sourceMode: "LIVE",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// EMPTY PORTFOLIO
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Empty Portfolio", () => {
  it("should handle empty positions array", () => {
    const intel = generatePortfolioIntelligence([]);
    expect(intel.summary.totalPositions).toBe(0);
    expect(intel.exposure.length).toBe(0);
    expect(intel.alignments.length).toBe(0);
    expect(intel.conflicts.length).toBe(0);
    expect(intel.watchItems.length).toBe(0);
    expect(intel.marketContext).toBe("No positions registered.");
    expect(intel.riskContext).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// SINGLE POSITION
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Single Position", () => {
  it("should produce valid intelligence for one position", () => {
    const intel = generatePortfolioIntelligence([makePosition()]);
    expect(intel.summary.totalPositions).toBe(1);
    expect(intel.summary.healthyPositions).toBe(1);
    expect(intel.summary.dominantPortfolioState).toBe("HEALTHY");
    expect(intel.exposure.length).toBe(1);
    expect(intel.alignments.length).toBe(0);
    expect(intel.conflicts.length).toBe(0);
  });

  it("should classify single deteriorating position", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ thesisHealth: "DETERIORATING" }),
    ]);
    expect(intel.summary.deterioratingPositions).toBe(1);
    expect(intel.summary.dominantPortfolioState).toBe("DETERIORATING");
    expect(intel.riskContext).toBe("MIXED");
  });
});

// ═══════════════════════════════════════════════════════════════
// THESIS DISTRIBUTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Thesis Distribution", () => {
  it("should count healthy positions correctly", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "HEALTHY" }),
    ]);
    expect(intel.summary.healthyPositions).toBe(2);
    expect(intel.summary.dominantPortfolioState).toBe("HEALTHY");
  });

  it("should count mixed thesis states", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "STABLE" }),
      makePosition({ instrument: "SOL/USDT", thesisHealth: "DETERIORATING" }),
    ]);
    expect(intel.summary.healthyPositions).toBe(2);
    expect(intel.summary.deterioratingPositions).toBe(1);
    expect(intel.summary.dominantPortfolioState).toBe("DETERIORATING");
  });

  it("should count invalidated positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "INVALIDATED" }),
    ]);
    expect(intel.summary.invalidatedPositions).toBe(1);
    expect(intel.summary.dominantPortfolioState).toBe("INVALIDATED");
  });
});

// ═══════════════════════════════════════════════════════════════
// DOMINANT STATE
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Dominant State", () => {
  it("should pick INVALIDATED over CAUTION", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "A", thesisHealth: "STABLE" }),
      makePosition({ instrument: "B", thesisHealth: "INVALIDATED" }),
    ]);
    expect(intel.summary.dominantPortfolioState).toBe("INVALIDATED");
  });

  it("should pick HEALTHY when all healthy/stable", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "A", thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "B", thesisHealth: "STABLE" }),
    ]);
    expect(intel.summary.dominantPortfolioState).toBe("HEALTHY");
  });

  it("should pick HEALTHY when all healthy", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "A", thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "B", thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "C", thesisHealth: "HEALTHY" }),
    ]);
    expect(intel.summary.dominantPortfolioState).toBe("HEALTHY");
  });
});

// ═══════════════════════════════════════════════════════════════
// ALIGNMENT DETECTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Alignment Detection", () => {
  it("should detect regime alignment between same-side positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP", h1Analysis: { trend: "BULLISH" } as any }),
      makePosition({ instrument: "ETH/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP", h1Analysis: { trend: "BULLISH" } as any }),
    ]);
    expect(intel.alignments.length).toBeGreaterThanOrEqual(1);
    expect(intel.alignments.some(a => a.alignmentType === "REGIME_MATCH")).toBe(true);
  });

  it("should detect H1 trend alignment even without regime match", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP", h1Analysis: { trend: "BULLISH" } as any }),
      makePosition({ instrument: "ETH/USDT", side: "LONG", ohlcvRegime: "PULLBACK", h1Analysis: { trend: "BULLISH" } as any }),
    ]);
    expect(intel.alignments.some(a => a.alignmentType === "HTF_ALIGNMENT")).toBe(true);
  });

  it("should detect concentration for 3+ same-side positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", assetClass: "crypto" }),
      makePosition({ instrument: "ETH/USDT", side: "LONG", assetClass: "crypto" }),
      makePosition({ instrument: "SOL/USDT", side: "LONG", assetClass: "crypto" }),
    ]);
    expect(intel.alignments.some(a => a.alignmentType === "CONCENTRATION")).toBe(true);
  });

  it("should not create alignments for opposite-side positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP" }),
      makePosition({ instrument: "ETH/USDT", side: "SHORT", ohlcvRegime: "TRENDING_UP" }),
    ]);
    expect(intel.alignments.some(a => a.alignmentType === "REGIME_MATCH")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// CONFLICT DETECTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Conflict Detection", () => {
  it("should detect direct directional conflict (same instrument, opposite sides)", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG" }),
      makePosition({ instrument: "BTC/USDT", side: "SHORT" }),
    ]);
    expect(intel.conflicts.some(c => c.conflictType === "DIRECT_DIRECTIONAL")).toBe(true);
  });

  it("should detect regime conflict with opposite sides", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP" }),
      makePosition({ instrument: "ETH/USDT", side: "SHORT", ohlcvRegime: "TRENDING_UP" }),
    ]);
    expect(intel.conflicts.some(c => c.conflictType === "REGIME")).toBe(true);
  });

  it("should not create conflicts for same-side positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG" }),
      makePosition({ instrument: "ETH/USDT", side: "LONG" }),
    ]);
    expect(intel.conflicts.length).toBe(0);
  });

  it("should not fabricate conflicts when no evidence supports them", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP" }),
      makePosition({ instrument: "EUR/USD", side: "SHORT", ohlcvRegime: "RANGING" }),
    ]);
    // Different regimes, different instruments — no conflict
    expect(intel.conflicts.filter(c => c.conflictType === "REGIME").length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// RISK CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Risk Context", () => {
  it("should be LOW_CONCERN for all healthy positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "HEALTHY" }),
    ]);
    expect(intel.riskContext).toBe("LOW_CONCERN");
  });

  it("should be ELEVATED_CONCERN for invalidated positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ thesisHealth: "INVALIDATED" }),
    ]);
    expect(intel.riskContext).toBe("ELEVATED_CONCERN");
  });

  it("should be MIXED for deteriorating positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "DETERIORATING" }),
    ]);
    expect(intel.riskContext).toBe("MIXED");
  });
});

// ═══════════════════════════════════════════════════════════════
// WATCH LIST
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Watch List", () => {
  it("should prioritize invalidated positions as CRITICAL", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", thesisHealth: "INVALIDATED" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "HEALTHY" }),
    ]);
    expect(intel.watchItems.some(w => w.priority === "CRITICAL" && w.instrument === "BTC/USDT")).toBe(true);
  });

  it("should prioritize deteriorating positions as HIGH", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", thesisHealth: "DETERIORATING" }),
    ]);
    expect(intel.watchItems.some(w => w.priority === "HIGH" && w.instrument === "BTC/USDT")).toBe(true);
  });

  it("should include deteriorating positions as MEDIUM or higher", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", thesisHealth: "DETERIORATING" }),
    ]);
    expect(intel.watchItems.some(w => (w.priority === "HIGH" || w.priority === "MEDIUM") && w.instrument === "BTC/USDT")).toBe(true);
  });

  it("should include data quality issues as LOW", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", dataQuality: "UNAVAILABLE" }),
    ]);
    expect(intel.watchItems.some(w => w.priority === "LOW" && w.category === "DATA")).toBe(true);
  });

  it("should not exceed MAX_WATCH_ITEMS", () => {
    const positions = Array.from({ length: 15 }, (_, i) =>
      makePosition({ instrument: `INST_${i}`, thesisHealth: "INVALIDATED" })
    );
    const intel = generatePortfolioIntelligence(positions);
    expect(intel.watchItems.length).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// EXPOSURE
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Exposure", () => {
  it("should show ISOLATED for single position", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG" }),
    ]);
    expect(intel.exposure[0].exposureCategory).toBe("ISOLATED");
  });

  it("should show ALIGNED_SUPPORTING for same-side positions", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP" }),
      makePosition({ instrument: "ETH/USDT", side: "LONG", ohlcvRegime: "TRENDING_UP" }),
    ]);
    expect(intel.exposure.every(e => e.exposureCategory === "ALIGNED_SUPPORTING")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — LONG/SHORT Symmetry", () => {
  it("should correctly classify both LONG and SHORT positions", () => {
    const longIntel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG", thesisHealth: "HEALTHY" }),
    ]);
    const shortIntel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "SHORT", thesisHealth: "HEALTHY" }),
    ]);
    expect(longIntel.exposure[0].side).toBe("LONG");
    expect(shortIntel.exposure[0].side).toBe("SHORT");
    expect(longIntel.summary.dominantPortfolioState).toBe("HEALTHY");
    expect(shortIntel.summary.dominantPortfolioState).toBe("HEALTHY");
  });

  it("should detect alignment for both LONG and SHORT groups", () => {
    const longs = generatePortfolioIntelligence([
      makePosition({ instrument: "A", side: "LONG", ohlcvRegime: "TRENDING_UP" }),
      makePosition({ instrument: "B", side: "LONG", ohlcvRegime: "TRENDING_UP" }),
    ]);
    const shorts = generatePortfolioIntelligence([
      makePosition({ instrument: "A", side: "SHORT", ohlcvRegime: "TRENDING_DOWN" }),
      makePosition({ instrument: "B", side: "SHORT", ohlcvRegime: "TRENDING_DOWN" }),
    ]);
    expect(longs.alignments.some(a => a.alignmentType === "REGIME_MATCH")).toBe(true);
    expect(shorts.alignments.some(a => a.alignmentType === "REGIME_MATCH")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// DATA AVAILABILITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Data Availability", () => {
  it("should detect AVAILABLE technical when OHLCV exists", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ h1Analysis: { trend: "BULLISH" } as any }),
    ]);
    expect(intel.dataAvailability.technical).toBe("AVAILABLE");
  });

  it("should show UNAVAILABLE for empty portfolio", () => {
    const intel = generatePortfolioIntelligence([]);
    expect(intel.dataAvailability.technical).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// BOUNDED OUTPUT
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Bounded Output", () => {
  it("should bound alignments to MAX 10", () => {
    const positions = Array.from({ length: 12 }, (_, i) =>
      makePosition({ instrument: `INST_${i}`, side: "LONG", ohlcvRegime: "TRENDING_UP" })
    );
    const intel = generatePortfolioIntelligence(positions);
    expect(intel.alignments.length).toBeLessThanOrEqual(10);
  });

  it("should bound conflicts to MAX 10", () => {
    const positions = Array.from({ length: 6 }, (_, i) =>
      makePosition({ instrument: `INST_${i}`, side: i % 2 === 0 ? "LONG" : "SHORT", ohlcvRegime: "TRENDING_UP" })
    );
    const intel = generatePortfolioIntelligence(positions);
    expect(intel.conflicts.length).toBeLessThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Safety Invariants", () => {
  it("should not contain probability language", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "STABLE" }),
    ]);
    const serialized = JSON.stringify(intel).toLowerCase();
    expect(serialized).not.toContain("probability");
    expect(serialized).not.toContain("chance");
    expect(serialized).not.toContain("likely to");
    expect(serialized).not.toContain("guaranteed");
    expect(serialized).not.toContain("will rise");
    expect(serialized).not.toContain("will fall");
  });

  it("should not contain auto-execution language", () => {
    const intel = generatePortfolioIntelligence([makePosition()]);
    const serialized = JSON.stringify(intel).toLowerCase();
    expect(serialized).not.toContain("execute trade");
    expect(serialized).not.toContain("buy order");
    expect(serialized).not.toContain("sell order");
    expect(serialized).not.toContain("close position");
  });

  it("should not fabricate correlations", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG" }),
      makePosition({ instrument: "XAU/USD", side: "LONG" }),
    ]);
    // No conflict should be detected just because they are commonly correlated
    expect(intel.conflicts.filter(c => c.conflictType === "CROSS_ASSET").length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Determinism", () => {
  it("should produce identical results for same inputs", () => {
    const positions = [
      makePosition({ instrument: "BTC/USDT", thesisHealth: "HEALTHY" }),
      makePosition({ instrument: "ETH/USDT", thesisHealth: "STABLE" }),
    ];
    const i1 = generatePortfolioIntelligence(positions);
    const i2 = generatePortfolioIntelligence(positions);
    expect(i1.summary.totalPositions).toBe(i2.summary.totalPositions);
    expect(i1.summary.dominantPortfolioState).toBe(i2.summary.dominantPortfolioState);
    expect(i1.alignments.length).toBe(i2.alignments.length);
    expect(i1.conflicts.length).toBe(i2.conflicts.length);
    expect(i1.watchItems.length).toBe(i2.watchItems.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// MARKET CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("Phase 92 — Market Context", () => {
  it("should generate narrative for mixed portfolio", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", thesisHealth: "HEALTHY", side: "LONG" }),
      makePosition({ instrument: "EUR/USD", thesisHealth: "STABLE", side: "SHORT" }),
    ]);
    expect(intel.marketContext.length).toBeGreaterThan(0);
    expect(intel.marketContext).toContain("2 position(s) healthy");
  });

  it("should detect mixed directional exposure", () => {
    const intel = generatePortfolioIntelligence([
      makePosition({ instrument: "BTC/USDT", side: "LONG" }),
      makePosition({ instrument: "EUR/USD", side: "SHORT" }),
    ]);
    expect(intel.marketContext).toContain("Mixed directional");
  });
});
