/**
 * Phase 84 — Multi-Dimensional Intelligence Tests
 */

import { describe, it, expect } from "vitest";
import {
  classifyMacroContext,
  analyzeCrossAssetContext,
  analyzeDerivativesContext,
  buildHierarchicalEvidence,
  generateScenarios,
  synthesizeMultiDimensionalIntelligence,
} from "./multi-dimensional-intelligence";
import {
  createTimeframeData,
  analyzeMTFConfluence,
  type MTFConfluence,
} from "./multi-timeframe-engine";
import type { Candle } from "./technical-indicators";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeCandles(count: number, start: number, dir: "up" | "down" = "up", vol = 0.02): Candle[] {
  const now = Date.now();
  const c: Candle[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    const ch = dir === "up" ? vol : -vol;
    const o = p, cl = p * (1 + ch);
    c.push({ timestamp: now + i * 300_000, open: o, high: Math.max(o, cl) * 1.001, low: Math.min(o, cl) * 0.999, close: cl, volume: 1000 });
    p = cl;
  }
  return c;
}

function makeConfluence(dir: "up" | "down" | "mixed" = "up"): MTFConfluence {
  if (dir === "mixed") {
    return analyzeMTFConfluence([
      createTimeframeData("H1", makeCandles(50, 100, "down")),
      createTimeframeData("M15", makeCandles(50, 96, "up")),
      createTimeframeData("M5", makeCandles(50, 97, "up")),
    ]);
  }
  return analyzeMTFConfluence([
    createTimeframeData("H1", makeCandles(50, 100, dir)),
    createTimeframeData("M15", makeCandles(50, 100, dir)),
    createTimeframeData("M5", makeCandles(50, 100, dir)),
  ]);
}

// ═══════════════════════════════════════════════════════════════
// A. MACRO CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("A. Macro Context", () => {
  it("VIX > 30 → RISK_OFF", () => {
    const ctx = classifyMacroContext(35, "LONG", "crypto");
    expect(ctx.riskRegime).toBe("RISK_OFF");
    expect(ctx.positionImpact).toBe("CONFLICTING");
    expect(ctx.narrative.toLowerCase()).toContain("risk");
  });

  it("VIX < 12 → RISK_ON", () => {
    const ctx = classifyMacroContext(10, "LONG", "crypto");
    expect(ctx.riskRegime).toBe("RISK_ON");
    expect(ctx.positionImpact).toBe("SUPPORTING");
  });

  it("VIX null → UNKNOWN", () => {
    const ctx = classifyMacroContext(null, "LONG", "crypto");
    expect(ctx.riskRegime).toBe("UNKNOWN");
    expect(ctx.availability).toBe("UNAVAILABLE");
  });

  it("forex → NEUTRAL macro impact", () => {
    const ctx = classifyMacroContext(35, "LONG", "forex");
    expect(ctx.positionImpact).toBe("NEUTRAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. CROSS-ASSET CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("B. Cross-Asset Context", () => {
  it("all bullish → ALIGNED", () => {
    const other = new Map([
      ["ETH/USD", { trend: "BULLISH" as const, assetClass: "crypto" }],
      ["SOL/USD", { trend: "BULLISH" as const, assetClass: "crypto" }],
    ]);
    const ctx = analyzeCrossAssetContext("BTC/USD", "LONG", other);
    expect(ctx.correlationState).toBe("ALIGNED");
    expect(ctx.positionImpact).toBe("SUPPORTING");
  });

  it("mixed trends → DIVERGING", () => {
    const other = new Map([
      ["ETH/USD", { trend: "BULLISH" as const, assetClass: "crypto" }],
      ["SOL/USD", { trend: "BEARISH" as const, assetClass: "crypto" }],
    ]);
    const ctx = analyzeCrossAssetContext("BTC/USD", "LONG", other);
    expect(ctx.correlationState).toBe("DIVERGING");
    expect(ctx.positionImpact).toBe("CONFLICTING");
  });

  it("no data → INSUFFICIENT_DATA", () => {
    const ctx = analyzeCrossAssetContext("BTC/USD", "LONG", new Map());
    expect(ctx.correlationState).toBe("INSUFFICIENT_DATA");
    expect(ctx.availability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. DERIVATIVES CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("C. Derivatives Context", () => {
  it("no data → UNAVAILABLE", () => {
    const ctx = analyzeDerivativesContext(null, null, false, "LONG");
    expect(ctx.availability).toBe("UNAVAILABLE");
    expect(ctx.narrative).toContain("unavailable");
  });

  it("extreme positive funding + LONG → CONFLICTING", () => {
    const ctx = analyzeDerivativesContext(0.002, null, false, "LONG");
    expect(ctx.positionImpact).toBe("CONFLICTING");
    expect(ctx.narrative).toContain("crowded");
  });

  it("extreme negative funding + LONG → SUPPORTING", () => {
    const ctx = analyzeDerivativesContext(-0.002, null, false, "LONG");
    expect(ctx.positionImpact).toBe("SUPPORTING");
  });

  it("liquidation spike → CONFLICTING", () => {
    const ctx = analyzeDerivativesContext(0, null, true, "LONG");
    expect(ctx.positionImpact).toBe("CONFLICTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. EVIDENCE HIERARCHY
// ═══════════════════════════════════════════════════════════════

describe("D. Evidence Hierarchy", () => {
  it("primary evidence has higher priority", () => {
    const confluence = makeConfluence("up");
    const evidence = buildHierarchicalEvidence(
      confluence,
      { riskRegime: "UNKNOWN", vixLevel: null, vixDescription: "", positionImpact: "UNAVAILABLE", narrative: "", availability: "UNAVAILABLE" },
      { pairs: [], correlationState: "INSUFFICIENT_DATA", positionImpact: "UNAVAILABLE", narrative: "", availability: "UNAVAILABLE" },
      { fundingRate: null, oiChange: null, liquidationPressure: "UNKNOWN", positionImpact: "UNAVAILABLE", narrative: "", availability: "UNAVAILABLE" },
      "LONG",
    );
    const primary = evidence.filter((e) => e.tier === "PRIMARY");
    const context = evidence.filter((e) => e.tier === "CONTEXT");
    expect(primary.length).toBeGreaterThan(0);
    // Context should be empty when unavailable
    expect(context.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. SCENARIO SYNTHESIS
// ═══════════════════════════════════════════════════════════════

describe("E. Scenario Synthesis", () => {
  it("generates base/alternative/invalidation", () => {
    const confluence = makeConfluence("up");
    const evidence = buildHierarchicalEvidence(
      confluence,
      { riskRegime: "UNKNOWN", vixLevel: null, vixDescription: "", positionImpact: "UNAVAILABLE", narrative: "", availability: "UNAVAILABLE" },
      { pairs: [], correlationState: "INSUFFICIENT_DATA", positionImpact: "UNAVAILABLE", narrative: "", availability: "UNAVAILABLE" },
      { fundingRate: null, oiChange: null, liquidationPressure: "UNKNOWN", positionImpact: "UNAVAILABLE", narrative: "", availability: "UNAVAILABLE" },
      "LONG",
    );
    const scenarios = generateScenarios("LONG", confluence, evidence);
    expect(scenarios.baseCase.label).toBe("BASE CASE");
    expect(scenarios.alternativeCase.label).toBe("ALTERNATIVE");
    expect(scenarios.invalidationCase.label).toBe("INVALIDATION");
    expect(scenarios.baseCase.conditions.length).toBeGreaterThan(0);
    expect(scenarios.invalidationCase.conditions.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. MULTI-DIMENSIONAL SYNTHESIS
// ═══════════════════════════════════════════════════════════════

describe("F. Multi-Dimensional Synthesis", () => {
  it("synthesizes all dimensions", () => {
    const confluence = makeConfluence("up");
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD",
      side: "LONG",
      confluence,
      vixPrice: 18,
      otherPrices: new Map([
        ["ETH/USD", { trend: "BULLISH", assetClass: "crypto" }],
      ]),
    });
    expect(result.instrument).toBe("BTC/USD");
    expect(result.side).toBe("LONG");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.scenarios.baseCase).toBeTruthy();
    expect(result.dimensions.length).toBe(6);
  });

  it("LONG in bullish market → supporting dimensions", () => {
    const confluence = makeConfluence("up");
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD",
      side: "LONG",
      confluence,
      vixPrice: 15,
    });
    expect(result.supportingDimensions).toBeGreaterThan(0);
  });

  it("SHORT in bullish market → conflicting dimensions", () => {
    const confluence = makeConfluence("up");
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD",
      side: "SHORT",
      confluence,
      vixPrice: 15,
    });
    expect(result.conflictingDimensions).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("G. LONG/SHORT Symmetry", () => {
  it("same bullish data produces opposite position impact", () => {
    const confluence = makeConfluence("up");
    const longResult = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD", side: "LONG", confluence, vixPrice: 15,
    });
    const shortResult = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD", side: "SHORT", confluence, vixPrice: 15,
    });
    // LONG should have more supporting, SHORT more conflicting
    expect(longResult.supportingDimensions).toBeGreaterThan(shortResult.supportingDimensions);
    expect(shortResult.conflictingDimensions).toBeGreaterThan(longResult.conflictingDimensions);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. MISSING DATA
// ═══════════════════════════════════════════════════════════════

describe("H. Missing Data", () => {
  it("no VIX + no cross-asset + no derivatives → still produces analysis", () => {
    const confluence = makeConfluence("up");
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "EUR/USD",
      side: "LONG",
      confluence,
      vixPrice: null,
    });
    expect(result.macro.availability).toBe("UNAVAILABLE");
    expect(result.crossAsset.availability).toBe("UNAVAILABLE");
    expect(result.derivatives.availability).toBe("UNAVAILABLE");
    // Technical evidence should still exist
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("I. Safety Invariants", () => {
  it("no probability claims in any output", () => {
    const confluence = makeConfluence("up");
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD", side: "LONG", confluence, vixPrice: 15,
    });
    const allText = JSON.stringify(result);
    expect(allText).not.toMatch(/\d+%/);
    expect(allText).not.toMatch(/probability/i);
  });

  it("deterministic", () => {
    const confluence = makeConfluence("up");
    const r1 = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD", side: "LONG", confluence, vixPrice: 15,
    });
    const r2 = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD", side: "LONG", confluence, vixPrice: 15,
    });
    expect(r1.evidenceQuality).toBe(r2.evidenceQuality);
    expect(r1.scenarios.baseCase.description).toBe(r2.scenarios.baseCase.description);
  });

  it("no auto-execution in output", () => {
    const confluence = makeConfluence("up");
    const result = synthesizeMultiDimensionalIntelligence({
      instrument: "BTC/USD", side: "LONG", confluence, vixPrice: 15,
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/execute|auto.?sell|auto.?buy|place order/i);
  });
});
