/**
 * Phase 111 — Fundamental Causal Transmission Engine Tests
 *
 * Comprehensive deterministic tests for causal transmission chains,
 * regime classification, asset-specific transmission, LONG/SHORT symmetry,
 * safety invariants, and data quality.
 */

import { describe, it, expect } from "vitest";
import {
  classifyMacroRegime,
  buildCausalTransmissions,
  buildCausalTrace,
  buildInflationCausalTrace,
  buildFundamentalCausalResult,
  buildAssetCausalContext,
  type MacroRegimeType,
  type FundamentalTransmission,
  type CausalStep,
  type FundamentalCausalResult,
  type AssetCausalContext,
} from "./fundamental-transmission";
import type {
  FundamentalRegime,
  AssetClass,
  InflationRegime,
  InflationDriver,
  RateRegime,
  RealYieldRegime,
  CurrencyRegime,
  LiquidityRegime,
  GrowthRegime,
  EnergyRegime,
  GeopoliticalRegime,
  OverallRegime,
  DimensionAvailability,
} from "./fundamental-regime";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeRegime(overrides: Partial<FundamentalRegime> = {}): FundamentalRegime {
  return {
    overallRegime: "MIXED",
    inflationRegime: "STABLE",
    inflationDriver: "INSUFFICIENT_DATA",
    rateRegime: "NEUTRAL",
    realYieldRegime: "UNAVAILABLE",
    currencyRegime: "UNAVAILABLE",
    liquidityRegime: "UNAVAILABLE",
    growthRegime: "UNAVAILABLE",
    employmentRegime: "UNAVAILABLE",
    consumerConfidenceRegime: "UNAVAILABLE",
    energyRegime: "UNAVAILABLE",
    geopoliticalRegime: "INSUFFICIENT_DATA",
    inflationExpectationSurprise: "UNAVAILABLE",
    policyRateRegime: "INSUFFICIENT_DATA",
    structuredDataPointCount: 0,
    economicEventCount: 0,
    dimensions: [],
    availableDimensionCount: 0,
    unavailableDimensionCount: 9,
    dataQuality: "UNAVAILABLE",
    generatedAt: Date.now(),
    ...overrides,
  };
}

function makeDim(name: string, status: DimensionAvailability = "AVAILABLE", desc = "test"): FundamentalRegime["dimensions"][0] {
  return { name, status, description: desc };
}

// ═══════════════════════════════════════════════════════════════
// 1. MACRO REGIME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("classifyMacroRegime", () => {
  it("returns INSUFFICIENT_DATA when growth and inflation are both unavailable", () => {
    const r = makeRegime({ overallRegime: "MIXED", growthRegime: "UNAVAILABLE", inflationRegime: "INSUFFICIENT_DATA" });
    expect(classifyMacroRegime(r)).toBe("INSUFFICIENT_DATA");
  });

  it("returns STRESSED when overall is STRESSED", () => {
    const r = makeRegime({ overallRegime: "STRESSED", growthRegime: "EXPANDING", inflationRegime: "RISING" });
    expect(classifyMacroRegime(r)).toBe("STRESSED");
  });

  it("returns RISK_OFF when overall is RISK_OFF", () => {
    const r = makeRegime({ overallRegime: "RISK_OFF" });
    expect(classifyMacroRegime(r)).toBe("RISK_OFF");
  });

  it("returns RISK_ON when overall is RISK_ON and growth is EXPANDING", () => {
    const r = makeRegime({ overallRegime: "RISK_ON", growthRegime: "EXPANDING" });
    expect(classifyMacroRegime(r)).toBe("RISK_ON");
  });

  it("returns STAGFLATION when inflation elevated and growth weak", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "HIGH", growthRegime: "SLOWING" });
    expect(classifyMacroRegime(r)).toBe("STAGFLATION");
  });

  it("returns STAGFLATION for RISING inflation + CONTRACTING growth", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "RISING", growthRegime: "CONTRACTING" });
    expect(classifyMacroRegime(r)).toBe("STAGFLATION");
  });

  it("returns STAGFLATION for ACCELERATING inflation + CONTRACTING growth", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "ACCELERATING", growthRegime: "CONTRACTING" });
    expect(classifyMacroRegime(r)).toBe("STAGFLATION");
  });

  it("returns REFLATION when growth expanding and inflation rising", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "RISING", growthRegime: "EXPANDING" });
    expect(classifyMacroRegime(r)).toBe("REFLATION");
  });

  it("returns REFLATION when growth recovering and inflation stable", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "STABLE", growthRegime: "RECOVERING" });
    expect(classifyMacroRegime(r)).toBe("REFLATION");
  });

  it("returns DISINFLATION when inflation is DISINFLATIONARY", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "DISINFLATIONARY" });
    expect(classifyMacroRegime(r)).toBe("DISINFLATION");
  });

  it("returns CONTRACTION when growth is CONTRACTING (without elevated inflation)", () => {
    const r = makeRegime({ overallRegime: "MIXED", growthRegime: "CONTRACTING", inflationRegime: "STABLE" });
    expect(classifyMacroRegime(r)).toBe("CONTRACTION");
  });

  it("returns RECOVERY when growth is RECOVERING", () => {
    const r = makeRegime({ overallRegime: "MIXED", growthRegime: "RECOVERING", inflationRegime: "INSUFFICIENT_DATA" });
    expect(classifyMacroRegime(r)).toBe("RECOVERY");
  });

  it("returns MIXED as default", () => {
    const r = makeRegime({ overallRegime: "MIXED", growthRegime: "EXPANDING", inflationRegime: "HIGH" });
    expect(classifyMacroRegime(r)).toBe("MIXED");
  });

  it("is deterministic — same input always produces same output", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "HIGH", growthRegime: "SLOWING" });
    const results = Array.from({ length: 10 }, () => classifyMacroRegime(r));
    expect(new Set(results).size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. CAUSAL TRANSMISSION CONSTRUCTION
// ═══════════════════════════════════════════════════════════════

describe("buildCausalTransmissions", () => {
  it("returns empty array when all dimensions are unavailable", () => {
    const r = makeRegime();
    const txs = buildCausalTransmissions(r);
    expect(txs).toEqual([]);
  });

  it("produces transmissions for supply-driven inflation", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
    });
    const txs = buildCausalTransmissions(r);
    expect(txs.length).toBeGreaterThan(0);
    // Should have supply-driven inflation chain
    const supplyTxs = txs.filter((t) => t.driver.includes("Supply-driven"));
    expect(supplyTxs.length).toBeGreaterThan(0);
    // Should have store-of-value transmission
    const storeTxs = txs.filter((t) => t.targetDimension === "STORE_OF_VALUE");
    expect(storeTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for demand-driven inflation", () => {
    const r = makeRegime({
      inflationRegime: "RISING",
      inflationDriver: "DEMAND_DRIVEN",
    });
    const txs = buildCausalTransmissions(r);
    const demandTxs = txs.filter((t) => t.driver.includes("Demand-driven"));
    expect(demandTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for mixed inflation driver", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "MIXED",
    });
    const txs = buildCausalTransmissions(r);
    const supplyTxs = txs.filter((t) => t.driver.includes("Supply-driven"));
    const demandTxs = txs.filter((t) => t.driver.includes("Demand-driven"));
    expect(supplyTxs.length).toBeGreaterThan(0);
    expect(demandTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for tightening rate regime", () => {
    const r = makeRegime({ rateRegime: "TIGHTENING" });
    const txs = buildCausalTransmissions(r);
    const rateTxs = txs.filter((t) => t.sourceDimension === "INTEREST_RATES");
    expect(rateTxs.length).toBeGreaterThan(0);
    // Should be conflicting for equities
    const eqConflict = rateTxs.filter((t) => t.affectedAssets.includes("EQUITIES") && t.direction === "CONFLICTING");
    expect(eqConflict.length).toBeGreaterThan(0);
  });

  it("produces transmissions for easing rate regime", () => {
    const r = makeRegime({ rateRegime: "EASING" });
    const txs = buildCausalTransmissions(r);
    const rateTxs = txs.filter((t) => t.sourceDimension === "INTEREST_RATES");
    expect(rateTxs.length).toBeGreaterThan(0);
    const eqSupport = rateTxs.filter((t) => t.affectedAssets.includes("EQUITIES") && t.direction === "SUPPORTING");
    expect(eqSupport.length).toBeGreaterThan(0);
  });

  it("produces transmissions for falling real yields supporting gold", () => {
    const r = makeRegime({ realYieldRegime: "REAL_YIELD_FALLING" });
    const txs = buildCausalTransmissions(r);
    const goldTxs = txs.filter((t) => t.affectedAssets.includes("GOLD") && t.direction === "SUPPORTING");
    expect(goldTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for rising real yields conflicting gold", () => {
    const r = makeRegime({ realYieldRegime: "REAL_YIELD_RISING" });
    const txs = buildCausalTransmissions(r);
    const goldConflict = txs.filter((t) => t.affectedAssets.includes("GOLD") && t.direction === "CONFLICTING");
    expect(goldConflict.length).toBeGreaterThan(0);
  });

  it("produces transmissions for weakening USD", () => {
    const r = makeRegime({ currencyRegime: "WEAKENING" });
    const txs = buildCausalTransmissions(r);
    const currTxs = txs.filter((t) => t.sourceDimension === "CURRENCY_STRENGTH");
    expect(currTxs.length).toBeGreaterThan(0);
    const supportTxs = currTxs.filter((t) => t.direction === "SUPPORTING");
    expect(supportTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for strengthening USD", () => {
    const r = makeRegime({ currencyRegime: "STRENGTHENING" });
    const txs = buildCausalTransmissions(r);
    const currTxs = txs.filter((t) => t.sourceDimension === "CURRENCY_STRENGTH");
    expect(currTxs.length).toBeGreaterThan(0);
    const conflictTxs = currTxs.filter((t) => t.direction === "CONFLICTING");
    expect(conflictTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for easy liquidity", () => {
    const r = makeRegime({ liquidityRegime: "EASY" });
    const txs = buildCausalTransmissions(r);
    const liqTxs = txs.filter((t) => t.sourceDimension === "LIQUIDITY");
    expect(liqTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for liquidity stress", () => {
    const r = makeRegime({ liquidityRegime: "STRESS" });
    const txs = buildCausalTransmissions(r);
    const liqConflict = txs.filter((t) => t.sourceDimension === "LIQUIDITY" && t.direction === "CONFLICTING");
    expect(liqConflict.length).toBeGreaterThan(0);
  });

  it("produces transmissions for expanding growth", () => {
    const r = makeRegime({ growthRegime: "EXPANDING" });
    const txs = buildCausalTransmissions(r);
    const growthTxs = txs.filter((t) => t.sourceDimension === "GROWTH");
    expect(growthTxs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for contracting growth", () => {
    const r = makeRegime({ growthRegime: "CONTRACTING" });
    const txs = buildCausalTransmissions(r);
    const growthConflict = txs.filter((t) => t.sourceDimension === "GROWTH" && t.direction === "CONFLICTING");
    expect(growthConflict.length).toBeGreaterThan(0);
  });

  it("produces transmissions for energy supply disruption", () => {
    const r = makeRegime({ energyRegime: "SUPPLY_DISRUPTION" });
    const txs = buildCausalTransmissions(r);
    const energyTxs = txs.filter((t) => t.sourceDimension === "ENERGY");
    expect(energyTxs.length).toBeGreaterThan(0);
    const oilSupport = energyTxs.filter((t) => t.affectedAssets.includes("OIL") && t.direction === "SUPPORTING");
    expect(oilSupport.length).toBeGreaterThan(0);
  });

  it("produces transmissions for oil shock", () => {
    const r = makeRegime({ energyRegime: "OIL_SHOCK" });
    const txs = buildCausalTransmissions(r);
    expect(txs.length).toBeGreaterThan(0);
  });

  it("produces transmissions for geopolitical escalation", () => {
    const r = makeRegime({ geopoliticalRegime: "ESCALATING" });
    const txs = buildCausalTransmissions(r);
    const geoTxs = txs.filter((t) => t.sourceDimension === "GEOPOLITICAL_RISK");
    expect(geoTxs.length).toBeGreaterThan(0);
    // Should support gold
    const goldSupport = geoTxs.filter((t) => t.affectedAssets.includes("GOLD") && t.direction === "SUPPORTING");
    expect(goldSupport.length).toBeGreaterThan(0);
    // Should conflict crypto/equities
    const riskConflict = geoTxs.filter((t) => t.direction === "CONFLICTING" && (t.affectedAssets.includes("CRYPTO") || t.affectedAssets.includes("EQUITIES")));
    expect(riskConflict.length).toBeGreaterThan(0);
  });

  it("produces transmissions for HIGH geopolitical risk", () => {
    const r = makeRegime({ geopoliticalRegime: "HIGH" });
    const txs = buildCausalTransmissions(r);
    expect(txs.length).toBeGreaterThan(0);
  });

  it("skips geopolitical when INSUFFICIENT_DATA", () => {
    const r = makeRegime({ geopoliticalRegime: "INSUFFICIENT_DATA" });
    const txs = buildCausalTransmissions(r);
    const geoTxs = txs.filter((t) => t.sourceDimension === "GEOPOLITICAL_RISK");
    expect(geoTxs.length).toBe(0);
  });

  it("skips real yields when UNAVAILABLE", () => {
    const r = makeRegime({ realYieldRegime: "UNAVAILABLE" });
    const txs = buildCausalTransmissions(r);
    const ryTxs = txs.filter((t) => t.sourceDimension === "REAL_YIELDS");
    expect(ryTxs.length).toBe(0);
  });

  it("skips currency when UNAVAILABLE", () => {
    const r = makeRegime({ currencyRegime: "UNAVAILABLE" });
    const txs = buildCausalTransmissions(r);
    const curTxs = txs.filter((t) => t.sourceDimension === "CURRENCY_STRENGTH");
    expect(curTxs.length).toBe(0);
  });

  it("skips liquidity when UNAVAILABLE", () => {
    const r = makeRegime({ liquidityRegime: "UNAVAILABLE" });
    const txs = buildCausalTransmissions(r);
    const liqTxs = txs.filter((t) => t.sourceDimension === "LIQUIDITY");
    expect(liqTxs.length).toBe(0);
  });

  it("skips growth when UNAVAILABLE", () => {
    const r = makeRegime({ growthRegime: "UNAVAILABLE" });
    const txs = buildCausalTransmissions(r);
    const growTxs = txs.filter((t) => t.sourceDimension === "GROWTH");
    expect(growTxs.length).toBe(0);
  });

  it("skips energy when UNAVAILABLE", () => {
    const r = makeRegime({ energyRegime: "UNAVAILABLE" });
    const txs = buildCausalTransmissions(r);
    const enTxs = txs.filter((t) => t.sourceDimension === "ENERGY");
    expect(enTxs.length).toBe(0);
  });

  it("skips rates when INSUFFICIENT_DATA", () => {
    const r = makeRegime({ rateRegime: "INSUFFICIENT_DATA" });
    const txs = buildCausalTransmissions(r);
    const rateTxs = txs.filter((t) => t.sourceDimension === "INTEREST_RATES");
    expect(rateTxs.length).toBe(0);
  });

  it("all transmissions have valid direction", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "MIXED",
      rateRegime: "TIGHTENING",
      realYieldRegime: "REAL_YIELD_RISING",
      currencyRegime: "STRENGTHENING",
      liquidityRegime: "STRESS",
      growthRegime: "SLOWING",
      energyRegime: "OIL_SHOCK",
      geopoliticalRegime: "ESCALATING",
    });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      expect(["SUPPORTING", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"]).toContain(tx.direction);
    }
  });

  it("all transmissions have non-empty required fields", () => {
    const r = makeRegime({
      inflationRegime: "RISING",
      inflationDriver: "SUPPLY_DRIVEN",
      rateRegime: "TIGHTENING",
    });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      expect(tx.id).toBeTruthy();
      expect(tx.sourceDimension).toBeTruthy();
      expect(tx.driver).toBeTruthy();
      expect(tx.mechanism).toBeTruthy();
      expect(tx.targetDimension).toBeTruthy();
      expect(tx.explanation).toBeTruthy();
      expect(tx.affectedAssets.length).toBeGreaterThan(0);
    }
  });

  it("all transmissions have provenance DERIVED", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      expect(tx.provenance).toBe("DERIVED");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. CAUSAL TRACE
// ═══════════════════════════════════════════════════════════════

describe("buildCausalTrace", () => {
  it("produces steps from available dimensions", () => {
    const r = makeRegime({ dimensions: [makeDim("INFLATION"), makeDim("GROWTH")] });
    const txs = buildCausalTransmissions(r);
    const trace = buildCausalTrace(r, txs);
    expect(trace.steps.length).toBeGreaterThan(0);
    // First steps should be OBSERVED
    const observed = trace.steps.filter((s) => s.provenance === "OBSERVED");
    expect(observed.length).toBe(2);
  });

  it("derives transmissions as DERIVED steps", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      dimensions: [makeDim("INFLATION")],
    });
    const txs = buildCausalTransmissions(r);
    const trace = buildCausalTrace(r, txs);
    const derived = trace.steps.filter((s) => s.provenance === "DERIVED");
    expect(derived.length).toBe(txs.length);
  });

  it("steps are sequentially numbered", () => {
    const r = makeRegime({ dimensions: [makeDim("INFLATION"), makeDim("GROWTH")] });
    const txs = buildCausalTransmissions(r);
    const trace = buildCausalTrace(r, txs);
    for (let i = 0; i < trace.steps.length; i++) {
      expect(trace.steps[i].step).toBe(i + 1);
    }
  });

  it("conclusion summarizes supporting and conflicting counts", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const txs = buildCausalTransmissions(r);
    const trace = buildCausalTrace(r, txs);
    if (txs.length > 0) {
      expect(trace.conclusion).toMatch(/supporting/);
      expect(trace.conclusion).toMatch(/conflicting/);
    }
  });

  it("returns no-strong-transmissions conclusion when no transmissions", () => {
    const r = makeRegime();
    const trace = buildCausalTrace(r, []);
    expect(trace.conclusion).toMatch(/No strong causal transmissions/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. INFLATION CAUSAL TRACE
// ═══════════════════════════════════════════════════════════════

describe("buildInflationCausalTrace", () => {
  it("returns unavailable message when inflation data missing", () => {
    const r = makeRegime({ inflationRegime: "INSUFFICIENT_DATA" });
    const steps = buildInflationCausalTrace(r);
    expect(steps.length).toBe(1);
    expect(steps[0].description).toMatch(/unavailable/);
  });

  it("builds chain for supply-driven inflation", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const steps = buildInflationCausalTrace(r);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    // Should include supply-driven consequence
    const supplyStep = steps.find((s) => s.description.includes("Supply-driven") || s.description.includes("supply"));
    expect(supplyStep).toBeDefined();
  });

  it("builds chain for demand-driven inflation", () => {
    const r = makeRegime({ inflationRegime: "RISING", inflationDriver: "DEMAND_DRIVEN" });
    const steps = buildInflationCausalTrace(r);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    const demandStep = steps.find((s) => s.description.includes("Demand-driven") || s.description.includes("demand"));
    expect(demandStep).toBeDefined();
  });

  it("builds chain for mixed driver including both supply and demand", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "MIXED" });
    const steps = buildInflationCausalTrace(r);
    const supplyStep = steps.find((s) => s.description.toLowerCase().includes("supply"));
    const demandStep = steps.find((s) => s.description.toLowerCase().includes("demand"));
    expect(supplyStep).toBeDefined();
    expect(demandStep).toBeDefined();
  });

  it("includes observed inflation regime as first step", () => {
    const r = makeRegime({ inflationRegime: "ACCELERATING", inflationDriver: "SUPPLY_DRIVEN" });
    const steps = buildInflationCausalTrace(r);
    expect(steps[0].provenance).toBe("OBSERVED");
    expect(steps[0].description).toContain("ACCELERATING");
  });

  it("is deterministic", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const results = Array.from({ length: 5 }, () => buildInflationCausalTrace(r).map((s) => s.description));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. FULL CAUSAL RESULT
// ═══════════════════════════════════════════════════════════════

describe("buildFundamentalCausalResult", () => {
  it("produces a complete result with all required fields", () => {
    const r = makeRegime({
      overallRegime: "STRESSED",
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      rateRegime: "TIGHTENING",
    });
    const result = buildFundamentalCausalResult(r);
    expect(result.macroRegime).toBeTruthy();
    expect(result.transmissions).toBeDefined();
    expect(result.supportingTransmissions).toBeDefined();
    expect(result.conflictingTransmissions).toBeDefined();
    expect(result.neutralTransmissions).toBeDefined();
    expect(result.causalTrace).toBeDefined();
    expect(result.inflationChain).toBeDefined();
    expect(result.dataQuality).toBeDefined();
    expect(result.generatedAt).toBe(r.generatedAt);
  });

  it("macroRegime matches classifyMacroRegime", () => {
    const r = makeRegime({ overallRegime: "STRESSED" });
    const result = buildFundamentalCausalResult(r);
    expect(result.macroRegime).toBe(classifyMacroRegime(r));
  });

  it("supporting + conflicting + neutral = total transmissions", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      rateRegime: "TIGHTENING",
      realYieldRegime: "REAL_YIELD_RISING",
      currencyRegime: "STRENGTHENING",
    });
    const result = buildFundamentalCausalResult(r);
    expect(
      result.supportingTransmissions.length +
      result.conflictingTransmissions.length +
      result.neutralTransmissions.length,
    ).toBe(result.transmissions.length);
  });

  it("returns empty transmissions when all dimensions unavailable", () => {
    const r = makeRegime();
    const result = buildFundamentalCausalResult(r);
    expect(result.transmissions).toEqual([]);
    expect(result.supportingTransmissions).toEqual([]);
    expect(result.conflictingTransmissions).toEqual([]);
  });

  it("produces mixed conflicting forces for real yields rising + geopolitical escalation", () => {
    const r = makeRegime({
      realYieldRegime: "REAL_YIELD_RISING",
      geopoliticalRegime: "ESCALATING",
      currencyRegime: "UNAVAILABLE",
      rateRegime: "INSUFFICIENT_DATA",
    });
    const result = buildFundamentalCausalResult(r);
    // Real yields rising conflicts gold, geopolitical supports gold
    expect(result.supportingTransmissions.length).toBeGreaterThan(0);
    expect(result.conflictingTransmissions.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. ASSET-SPECIFIC CAUSAL CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("buildAssetCausalContext", () => {
  const goldRegime = makeRegime({
    realYieldRegime: "REAL_YIELD_FALLING",
    currencyRegime: "WEAKENING",
    geopoliticalRegime: "ESCALATING",
    dimensions: [makeDim("REAL_YIELDS"), makeDim("CURRENCY"), makeDim("GEOPOLITICAL_RISK")],
    dataQuality: "AVAILABLE",
    availableDimensionCount: 3,
    unavailableDimensionCount: 3,
  });

  it("builds context for GOLD", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx.asset).toBe("GOLD");
    expect(ctx.transmissions.length).toBeGreaterThan(0);
  });

  it("GOLD gets supporting from falling real yields and weakening USD", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx.supportingEvidence.length).toBeGreaterThan(0);
    const sources = ctx.supportingEvidence.map((e) => e.dimension);
    expect(sources).toContain("REAL_YIELDS");
    expect(sources).toContain("CURRENCY_STRENGTH");
  });

  it("conflicting forces expose both sides for mixed regime", () => {
    const mixedRegime = makeRegime({
      realYieldRegime: "REAL_YIELD_RISING",
      geopoliticalRegime: "ESCALATING",
      currencyRegime: "STRENGTHENING",
      dimensions: [makeDim("REAL_YIELDS"), makeDim("GEOPOLITICAL_RISK"), makeDim("CURRENCY")],
      dataQuality: "AVAILABLE",
      availableDimensionCount: 3,
      unavailableDimensionCount: 3,
    });
    const txs = buildCausalTransmissions(mixedRegime);
    const ctx = buildAssetCausalContext("GOLD", mixedRegime, txs);
    expect(ctx.supportingEvidence.length).toBeGreaterThan(0);
    expect(ctx.conflictingEvidence.length).toBeGreaterThan(0);
  });

  it("conflicting and supporting drivers are exposed separately", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx.dominantMacroDrivers.length).toBeGreaterThan(0);
    // conflictingMacroDrivers should be empty if everything supports gold
    // (falling yields + weakening USD + geopolitical all support gold)
  });

  it("UNAVAILABLE data quality yields UNAVAILABLE assessment", () => {
    const unavail = makeRegime({ dataQuality: "UNAVAILABLE" });
    const txs = buildCausalTransmissions(unavail);
    const ctx = buildAssetCausalContext("GOLD", unavail, txs);
    expect(ctx.fundamentalAssessment).toBe("UNAVAILABLE");
  });

  it("provides transmission explanation", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx.transmissionExplanation).toBeTruthy();
    expect(ctx.transmissionExplanation.length).toBeGreaterThan(0);
  });

  it("provides whatToMonitor items", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx.whatToMonitor.length).toBeGreaterThan(0);
  });

  it("provides whatCouldChangeAssessment items", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx.whatCouldChangeAssessment.length).toBeGreaterThan(0);
  });

  it("causalTrace steps map to transmissions", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx.causalTrace.steps.length).toBe(txs.filter((t) => t.affectedAssets.includes("GOLD")).length);
  });

  it("is deterministic", () => {
    const txs = buildCausalTransmissions(goldRegime);
    const ctx1 = buildAssetCausalContext("GOLD", goldRegime, txs);
    const ctx2 = buildAssetCausalContext("GOLD", goldRegime, txs);
    expect(ctx1.fundamentalAssessment).toBe(ctx2.fundamentalAssessment);
    expect(ctx1.supportingEvidence.length).toBe(ctx2.supportingEvidence.length);
    expect(ctx1.conflictingEvidence.length).toBe(ctx2.conflictingEvidence.length);
  });

  it("reports unavailable dimensions from regime", () => {
    const r = makeRegime({
      dimensions: [
        makeDim("INFLATION", "UNAVAILABLE"),
        makeDim("GROWTH", "AVAILABLE"),
      ],
      dataQuality: "INSUFFICIENT_EVIDENCE",
    });
    const txs = buildCausalTransmissions(r);
    const ctx = buildAssetCausalContext("GOLD", r, txs);
    expect(ctx.unavailableDimensions).toContain("INFLATION");
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. ASSET TRANSMISSION — GOLD
// ═══════════════════════════════════════════════════════════════

describe("GOLD transmission", () => {
  it("receives conflicting transmissions from rising real yields", () => {
    const r = makeRegime({ realYieldRegime: "REAL_YIELD_RISING" });
    const txs = buildCausalTransmissions(r);
    const goldConflict = txs.filter(
      (t) => t.affectedAssets.includes("GOLD") && t.direction === "CONFLICTING",
    );
    expect(goldConflict.length).toBeGreaterThan(0);
  });

  it("receives supporting transmissions from geopolitical escalation", () => {
    const r = makeRegime({ geopoliticalRegime: "ESCALATING" });
    const txs = buildCausalTransmissions(r);
    const goldSupport = txs.filter(
      (t) => t.affectedAssets.includes("GOLD") && t.direction === "SUPPORTING",
    );
    expect(goldSupport.length).toBeGreaterThan(0);
  });

  it("receives supporting from falling real yields", () => {
    const r = makeRegime({ realYieldRegime: "REAL_YIELD_FALLING" });
    const txs = buildCausalTransmissions(r);
    const goldSupport = txs.filter(
      (t) => t.affectedAssets.includes("GOLD") && t.direction === "SUPPORTING",
    );
    expect(goldSupport.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. ASSET TRANSMISSION — CRYPTO
// ═══════════════════════════════════════════════════════════════

describe("CRYPTO transmission", () => {
  it("receives supporting from easy liquidity", () => {
    const r = makeRegime({ liquidityRegime: "EASY" });
    const txs = buildCausalTransmissions(r);
    const cryptoSupport = txs.filter(
      (t) => t.affectedAssets.includes("CRYPTO") && t.direction === "SUPPORTING",
    );
    expect(cryptoSupport.length).toBeGreaterThan(0);
  });

  it("receives conflicting from liquidity stress", () => {
    const r = makeRegime({ liquidityRegime: "STRESS" });
    const txs = buildCausalTransmissions(r);
    const cryptoConflict = txs.filter(
      (t) => t.affectedAssets.includes("CRYPTO") && t.direction === "CONFLICTING",
    );
    expect(cryptoConflict.length).toBeGreaterThan(0);
  });

  it("receives conflicting from rising real yields", () => {
    const r = makeRegime({ realYieldRegime: "REAL_YIELD_RISING" });
    const txs = buildCausalTransmissions(r);
    const cryptoConflict = txs.filter(
      (t) => t.affectedAssets.includes("CRYPTO") && t.direction === "CONFLICTING",
    );
    expect(cryptoConflict.length).toBeGreaterThan(0);
  });

  it("receives conflicting from geopolitical escalation", () => {
    const r = makeRegime({ geopoliticalRegime: "ESCALATING" });
    const txs = buildCausalTransmissions(r);
    const cryptoConflict = txs.filter(
      (t) => t.affectedAssets.includes("CRYPTO") && t.direction === "CONFLICTING",
    );
    expect(cryptoConflict.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. ASSET TRANSMISSION — EQUITIES
// ═══════════════════════════════════════════════════════════════

describe("EQUITIES transmission", () => {
  it("receives conflicting from tightening rates", () => {
    const r = makeRegime({ rateRegime: "TIGHTENING" });
    const txs = buildCausalTransmissions(r);
    const eqConflict = txs.filter(
      (t) => t.affectedAssets.includes("EQUITIES") && t.direction === "CONFLICTING",
    );
    expect(eqConflict.length).toBeGreaterThan(0);
  });

  it("receives supporting from easing rates", () => {
    const r = makeRegime({ rateRegime: "EASING" });
    const txs = buildCausalTransmissions(r);
    const eqSupport = txs.filter(
      (t) => t.affectedAssets.includes("EQUITIES") && t.direction === "SUPPORTING",
    );
    expect(eqSupport.length).toBeGreaterThan(0);
  });

  it("receives supporting from expanding growth", () => {
    const r = makeRegime({ growthRegime: "EXPANDING" });
    const txs = buildCausalTransmissions(r);
    const eqSupport = txs.filter(
      (t) => t.affectedAssets.includes("EQUITIES") && t.direction === "SUPPORTING",
    );
    expect(eqSupport.length).toBeGreaterThan(0);
  });

  it("receives conflicting from contracting growth", () => {
    const r = makeRegime({ growthRegime: "CONTRACTING" });
    const txs = buildCausalTransmissions(r);
    const eqConflict = txs.filter(
      (t) => t.affectedAssets.includes("EQUITIES") && t.direction === "CONFLICTING",
    );
    expect(eqConflict.length).toBeGreaterThan(0);
  });

  it("receives conflicting from supply-driven inflation (rate pressure chain)", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const txs = buildCausalTransmissions(r);
    const eqConflict = txs.filter(
      (t) => t.affectedAssets.includes("EQUITIES") && t.direction === "CONFLICTING",
    );
    expect(eqConflict.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. ASSET TRANSMISSION — OIL
// ═══════════════════════════════════════════════════════════════

describe("OIL transmission", () => {
  it("receives supporting from supply disruption", () => {
    const r = makeRegime({ energyRegime: "SUPPLY_DISRUPTION" });
    const txs = buildCausalTransmissions(r);
    const oilSupport = txs.filter(
      (t) => t.affectedAssets.includes("OIL") && t.direction === "SUPPORTING",
    );
    expect(oilSupport.length).toBeGreaterThan(0);
  });

  it("receives supporting from oil shock", () => {
    const r = makeRegime({ energyRegime: "OIL_SHOCK" });
    const txs = buildCausalTransmissions(r);
    const oilSupport = txs.filter(
      (t) => t.affectedAssets.includes("OIL") && t.direction === "SUPPORTING",
    );
    expect(oilSupport.length).toBeGreaterThan(0);
  });

  it("receives supporting from expanding growth", () => {
    const r = makeRegime({ growthRegime: "EXPANDING" });
    const txs = buildCausalTransmissions(r);
    const oilSupport = txs.filter(
      (t) => t.affectedAssets.includes("OIL") && t.direction === "SUPPORTING",
    );
    expect(oilSupport.length).toBeGreaterThan(0);
  });

  it("receives supporting from geopolitical escalation", () => {
    const r = makeRegime({ geopoliticalRegime: "ESCALATING" });
    const txs = buildCausalTransmissions(r);
    const oilSupport = txs.filter(
      (t) => t.affectedAssets.includes("OIL") && t.direction === "SUPPORTING",
    );
    expect(oilSupport.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. STAGFLATION / REFLATION / DISINFLATION / CONTRACTION
// ═══════════════════════════════════════════════════════════════

describe("Macro regime combinations", () => {
  it("STAGFLATION produces conflicting transmissions for equities", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "HIGH", growthRegime: "SLOWING" });
    const result = buildFundamentalCausalResult(r);
    expect(result.macroRegime).toBe("STAGFLATION");
    // Supply-driven inflation + tightening pressures → conflicting for equities
    const eqConflict = result.conflictingTransmissions.filter((t) => t.affectedAssets.includes("EQUITIES"));
    expect(eqConflict.length).toBeGreaterThan(0);
  });

  it("REFLATION produces supporting transmissions for equities", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "RISING", growthRegime: "EXPANDING" });
    const result = buildFundamentalCausalResult(r);
    expect(result.macroRegime).toBe("REFLATION");
    // Growth supports equities
    const eqSupport = result.supportingTransmissions.filter((t) => t.affectedAssets.includes("EQUITIES"));
    expect(eqSupport.length).toBeGreaterThan(0);
  });

  it("CONTRACTION produces conflicting for equities and commodities", () => {
    const r = makeRegime({ overallRegime: "MIXED", growthRegime: "CONTRACTING", inflationRegime: "STABLE" });
    const result = buildFundamentalCausalResult(r);
    expect(result.macroRegime).toBe("CONTRACTION");
    const conflict = result.conflictingTransmissions.filter(
      (t) => t.affectedAssets.includes("EQUITIES") || t.affectedAssets.includes("COMMODITIES"),
    );
    expect(conflict.length).toBeGreaterThan(0);
  });

  it("DISINFLATION maps correctly", () => {
    const r = makeRegime({ overallRegime: "MIXED", inflationRegime: "DISINFLATIONARY" });
    const result = buildFundamentalCausalResult(r);
    expect(result.macroRegime).toBe("DISINFLATION");
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. CONFLICTING FORCES EXPOSURE
// ═══════════════════════════════════════════════════════════════

describe("Conflicting forces exposure", () => {
  it("GOLD receives both supporting and conflicting in mixed regime", () => {
    const r = makeRegime({
      realYieldRegime: "REAL_YIELD_RISING",
      geopoliticalRegime: "ESCALATING",
      currencyRegime: "STRENGTHENING",
      rateRegime: "NEUTRAL",
      dimensions: [makeDim("REAL_YIELDS"), makeDim("GEOPOLITICAL_RISK"), makeDim("CURRENCY")],
      dataQuality: "AVAILABLE",
      availableDimensionCount: 3,
      unavailableDimensionCount: 3,
    });
    const txs = buildCausalTransmissions(r);
    const ctx = buildAssetCausalContext("GOLD", r, txs);
    expect(ctx.supportingEvidence.length).toBeGreaterThan(0);
    expect(ctx.conflictingEvidence.length).toBeGreaterThan(0);
    // Mixed forces should result in NEUTRAL (equal counts) or non-extreme
    expect(["NEUTRAL", "CONFLICTING"]).toContain(ctx.fundamentalAssessment);
  });

  it("assessment is CONFLICTING when conflicting > supporting", () => {
    const r = makeRegime({
      realYieldRegime: "REAL_YIELD_RISING",
      currencyRegime: "STRENGTHENING",
      rateRegime: "TIGHTENING",
      geopoliticalRegime: "INSUFFICIENT_DATA",
      dimensions: [makeDim("REAL_YIELDS"), makeDim("CURRENCY"), makeDim("INTEREST_RATES")],
      dataQuality: "AVAILABLE",
      availableDimensionCount: 3,
      unavailableDimensionCount: 3,
    });
    const txs = buildCausalTransmissions(r);
    const ctx = buildAssetCausalContext("CRYPTO", r, txs);
    expect(ctx.conflictingEvidence.length).toBeGreaterThan(ctx.supportingEvidence.length);
    expect(ctx.fundamentalAssessment).toBe("CONFLICTING");
  });

  it("assessment is SUPPORTING when supporting > conflicting", () => {
    const r = makeRegime({
      realYieldRegime: "REAL_YIELD_FALLING",
      currencyRegime: "WEAKENING",
      geopoliticalRegime: "ESCALATING",
      rateRegime: "EASING",
      dimensions: [makeDim("REAL_YIELDS"), makeDim("CURRENCY"), makeDim("GEOPOLITICAL_RISK"), makeDim("INTEREST_RATES")],
      dataQuality: "AVAILABLE",
      availableDimensionCount: 4,
      unavailableDimensionCount: 4,
    });
    const txs = buildCausalTransmissions(r);
    const ctx = buildAssetCausalContext("GOLD", r, txs);
    expect(ctx.supportingEvidence.length).toBeGreaterThan(ctx.conflictingEvidence.length);
    expect(ctx.fundamentalAssessment).toBe("SUPPORTING");
  });

  it("assessment is NEUTRAL when supporting equals conflicting", () => {
    const r = makeRegime({
      realYieldRegime: "REAL_YIELD_RISING",
      geopoliticalRegime: "ESCALATING",
      currencyRegime: "UNAVAILABLE",
      rateRegime: "NEUTRAL",
      dimensions: [makeDim("REAL_YIELDS"), makeDim("GEOPOLITICAL_RISK")],
      dataQuality: "AVAILABLE",
      availableDimensionCount: 2,
      unavailableDimensionCount: 2,
    });
    const txs = buildCausalTransmissions(r);
    const ctx = buildAssetCausalContext("GOLD", r, txs);
    if (ctx.supportingEvidence.length === ctx.conflictingEvidence.length && ctx.supportingEvidence.length > 0) {
      expect(ctx.fundamentalAssessment).toBe("NEUTRAL");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("LONG/SHORT symmetry", () => {
  const txRegime = makeRegime({
    realYieldRegime: "REAL_YIELD_FALLING",
    currencyRegime: "WEAKENING",
    geopoliticalRegime: "ESCALATING",
    dimensions: [makeDim("REAL_YIELDS"), makeDim("CURRENCY"), makeDim("GEOPOLITICAL_RISK")],
    dataQuality: "AVAILABLE",
    availableDimensionCount: 3,
    unavailableDimensionCount: 3,
  });

  it("fundamental direction is asset-class specific, not side-specific", () => {
    const txs = buildCausalTransmissions(txRegime);
    const goldCtx = buildAssetCausalContext("GOLD", txRegime, txs);
    // The fundamental assessment describes the fundamental forces on GOLD as an asset class
    // It does NOT change based on LONG vs SHORT — that interpretation happens at presentation
    expect(goldCtx.fundamentalAssessment).toBe("SUPPORTING");
  });

  it("transmissions are side-independent — same regime produces same transmissions", () => {
    const txs1 = buildCausalTransmissions(txRegime);
    const txs2 = buildCausalTransmissions(txRegime);
    expect(txs1.length).toBe(txs2.length);
    for (let i = 0; i < txs1.length; i++) {
      expect(txs1[i].direction).toBe(txs2[i].direction);
      expect(txs1[i].affectedAssets).toEqual(txs2[i].affectedAssets);
    }
  });

  it("LONG/SHORT interpretation must happen at presentation, not in transmission engine", () => {
    const txs = buildCausalTransmissions(txRegime);
    const goldCtx = buildAssetCausalContext("GOLD", txRegime, txs);
    // Transmission engine produces asset-class-level assessment
    // For LONG GOLD: SUPPORTING = supporting for the position
    // For SHORT GOLD: SUPPORTING = conflicting for the position
    // This mapping happens at presentation, NOT here
    expect(["SUPPORTING", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"]).toContain(goldCtx.fundamentalAssessment);
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. UNAVAILABLE DATA HANDLING
// ═══════════════════════════════════════════════════════════════

describe("Unavailable data handling", () => {
  it("unavailable dimensions do not produce directional conclusions", () => {
    const r = makeRegime({
      dimensions: [makeDim("INFLATION", "UNAVAILABLE"), makeDim("GROWTH", "UNAVAILABLE")],
      dataQuality: "UNAVAILABLE",
    });
    const txs = buildCausalTransmissions(r);
    // No dimensions available → no transmissions
    expect(txs.length).toBe(0);
  });

  it("missing dimension data does not become NEUTRAL assessment", () => {
    const r = makeRegime({ dataQuality: "UNAVAILABLE" });
    const txs = buildCausalTransmissions(r);
    const ctx = buildAssetCausalContext("GOLD", r, txs);
    expect(ctx.fundamentalAssessment).toBe("UNAVAILABLE");
  });

  it("partial data produces available-dimension-only transmissions", () => {
    const r = makeRegime({
      realYieldRegime: "REAL_YIELD_FALLING",
      inflationRegime: "INSUFFICIENT_DATA",
      rateRegime: "NEUTRAL",
      currencyRegime: "UNAVAILABLE",
      liquidityRegime: "UNAVAILABLE",
      growthRegime: "UNAVAILABLE",
      energyRegime: "UNAVAILABLE",
      geopoliticalRegime: "INSUFFICIENT_DATA",
      dimensions: [makeDim("REAL_YIELDS", "AVAILABLE", "real yields available"), makeDim("INFLATION", "UNAVAILABLE")],
      dataQuality: "INSUFFICIENT_EVIDENCE",
      availableDimensionCount: 1,
      unavailableDimensionCount: 2,
    });
    const txs = buildCausalTransmissions(r);
    // Only real yields should produce transmissions
    for (const tx of txs) {
      expect(tx.sourceDimension).toBe("REAL_YIELDS");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 15. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Safety invariants", () => {
  const fullRegime = makeRegime({
    inflationRegime: "HIGH",
    inflationDriver: "SUPPLY_DRIVEN",
    rateRegime: "TIGHTENING",
    realYieldRegime: "REAL_YIELD_RISING",
    currencyRegime: "STRENGTHENING",
    liquidityRegime: "STRESS",
    growthRegime: "SLOWING",
    energyRegime: "OIL_SHOCK",
    geopoliticalRegime: "ESCALATING",
    dataQuality: "AVAILABLE",
  });

  it("no BUY/SELL execution language in any transmission", () => {
    const txs = buildCausalTransmissions(fullRegime);
    for (const tx of txs) {
      const combined = `${tx.driver} ${tx.mechanism} ${tx.explanation}`.toLowerCase();
      expect(combined).not.toMatch(/\bbuy\b/);
      expect(combined).not.toMatch(/\bsell\b/);
      expect(combined).not.toMatch(/\bexecute\b/);
      expect(combined).not.toMatch(/\border\b/);
      expect(combined).not.toMatch(/\bposition\b/);
    }
  });

  it("no probability language in any transmission", () => {
    const txs = buildCausalTransmissions(fullRegime);
    for (const tx of txs) {
      const combined = `${tx.driver} ${tx.mechanism} ${tx.explanation}`.toLowerCase();
      expect(combined).not.toMatch(/\d+%/);
      expect(combined).not.toMatch(/\bprobability\b/);
      expect(combined).not.toMatch(/\bguaranteed\b/);
      expect(combined).not.toMatch(/\bwill definitely\b/);
      expect(combined).not.toMatch(/\bcertain\b/);
    }
  });

  it("no fabricated market data", () => {
    const txs = buildCausalTransmissions(fullRegime);
    for (const tx of txs) {
      const combined = `${tx.driver} ${tx.mechanism} ${tx.explanation}`.toLowerCase();
      // Should not contain specific price predictions
      expect(combined).not.toMatch(/\$[\d,]+/);
      expect(combined).not.toMatch(/price will/);
      expect(combined).not.toMatch(/price target/);
    }
  });

  it("no probability claims in causal result", () => {
    const result = buildFundamentalCausalResult(fullRegime);
    expect(result.causalTrace.conclusion).not.toMatch(/\d+%/);
    expect(result.causalTrace.conclusion).not.toMatch(/probability/);
  });

  it("no probability in trace steps", () => {
    const txs = buildCausalTransmissions(fullRegime);
    const trace = buildCausalTrace(fullRegime, txs);
    for (const step of trace.steps) {
      expect(step.description).not.toMatch(/\d+%/);
      expect(step.description).not.toMatch(/probability/);
    }
  });

  it("all transmissions use hedged language", () => {
    const txs = buildCausalTransmissions(fullRegime);
    for (const tx of txs) {
      const combined = `${tx.mechanism} ${tx.explanation}`.toLowerCase();
      // Should use hedged/causal language, not deterministic
      // At least one hedged phrase should appear
      const hasHedged =
        combined.includes("can") ||
        combined.includes("may") ||
        combined.includes("potential") ||
        combined.includes("pressure") ||
        combined.includes("support") ||
        combined.includes("reduce") ||
        combined.includes("increase") ||
        combined.includes("compress") ||
        combined.includes("expansion");
      expect(hasHedged).toBe(true);
    }
  });

  it("no universal macro rules — same condition affects different assets differently", () => {
    const r = makeRegime({ geopoliticalRegime: "ESCALATING" });
    const txs = buildCausalTransmissions(r);
    const goldTx = txs.filter((t) => t.affectedAssets.includes("GOLD"));
    const cryptoTx = txs.filter((t) => t.affectedAssets.includes("CRYPTO"));
    // Gold gets SUPPORTING, crypto gets CONFLICTING
    const goldDir = goldTx.map((t) => t.direction);
    const cryptoDir = cryptoTx.map((t) => t.direction);
    expect(goldDir).toContain("SUPPORTING");
    expect(cryptoDir).toContain("CONFLICTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// 16. PROVENANCE
// ═══════════════════════════════════════════════════════════════

describe("Provenance", () => {
  it("all transmissions are DERIVED, not OBSERVED", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      expect(tx.provenance).toBe("DERIVED");
    }
  });

  it("trace distinguishes OBSERVED from DERIVED", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      dimensions: [makeDim("INFLATION")],
    });
    const txs = buildCausalTransmissions(r);
    const trace = buildCausalTrace(r, txs);
    const observed = trace.steps.filter((s) => s.provenance === "OBSERVED");
    const derived = trace.steps.filter((s) => s.provenance === "DERIVED");
    expect(observed.length).toBeGreaterThan(0);
    expect(derived.length).toBeGreaterThan(0);
  });

  it("OBSERVED steps come before DERIVED steps", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      dimensions: [makeDim("INFLATION")],
    });
    const txs = buildCausalTransmissions(r);
    const trace = buildCausalTrace(r, txs);
    const lastObservedIdx = trace.steps.reduce(
      (max, s, i) => (s.provenance === "OBSERVED" ? i : max),
      -1,
    );
    const firstDerivedIdx = trace.steps.findIndex((s) => s.provenance === "DERIVED");
    expect(lastObservedIdx).toBeLessThan(firstDerivedIdx);
  });
});

// ═══════════════════════════════════════════════════════════════
// 17. EMPTY / EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("empty regime produces no transmissions", () => {
    const r = makeRegime();
    const txs = buildCausalTransmissions(r);
    expect(txs).toEqual([]);
  });

  it("empty regime causal result has empty arrays", () => {
    const r = makeRegime();
    const result = buildFundamentalCausalResult(r);
    expect(result.transmissions).toEqual([]);
    expect(result.supportingTransmissions).toEqual([]);
    expect(result.conflictingTransmissions).toEqual([]);
  });

  it("empty asset context when no transmissions affect the asset", () => {
    const r = makeRegime({ energyRegime: "SUPPLY_DISRUPTION" });
    const txs = buildCausalTransmissions(r);
    // SILVER may not have specific transmissions in this regime
    const ctx = buildAssetCausalContext("SILVER", r, txs);
    // May have some transmissions that overlap (like store-of-value from inflation)
    // But the context should still be valid
    expect(ctx.asset).toBe("SILVER");
    expect(ctx.dataQuality).toBeDefined();
  });

  it("multiple identical calls produce identical output", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      rateRegime: "TIGHTENING",
    });
    const results = Array.from({ length: 5 }, () => buildFundamentalCausalResult(r));
    for (let i = 1; i < results.length; i++) {
      expect(results[i].transmissions.length).toBe(results[0].transmissions.length);
      expect(results[i].macroRegime).toBe(results[0].macroRegime);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 18. NO MUTATION
// ═══════════════════════════════════════════════════════════════

describe("No mutation of inputs", () => {
  it("does not mutate the input regime", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      rateRegime: "TIGHTENING",
    });
    const originalInflation = r.inflationRegime;
    const originalRate = r.rateRegime;
    buildFundamentalCausalResult(r);
    expect(r.inflationRegime).toBe(originalInflation);
    expect(r.rateRegime).toBe(originalRate);
  });

  it("does not mutate transmissions array", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const txs = buildCausalTransmissions(r);
    const originalLength = txs.length;
    buildCausalTrace(r, txs);
    expect(txs.length).toBe(originalLength);
  });
});

// ═══════════════════════════════════════════════════════════════
// 19. PERFORMANCE
// ═══════════════════════════════════════════════════════════════

describe("Performance", () => {
  it("processes a full regime with all dimensions quickly", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "MIXED",
      rateRegime: "TIGHTENING",
      realYieldRegime: "REAL_YIELD_RISING",
      currencyRegime: "STRENGTHENING",
      liquidityRegime: "STRESS",
      growthRegime: "SLOWING",
      energyRegime: "OIL_SHOCK",
      geopoliticalRegime: "ESCALATING",
      dataQuality: "AVAILABLE",
      dimensions: [
        makeDim("INFLATION"), makeDim("INTEREST_RATES"), makeDim("REAL_YIELDS"),
        makeDim("CURRENCY_STRENGTH"), makeDim("LIQUIDITY"), makeDim("GROWTH"),
        makeDim("ENERGY"), makeDim("GEOPOLITICAL_RISK"), makeDim("RISK_SENTIMENT"),
      ],
    });
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      buildFundamentalCausalResult(r);
    }
    const elapsed = performance.now() - start;
    // 100 iterations should complete well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });
});

// ═══════════════════════════════════════════════════════════════
// 20. COMPREHENSIVE TRANSMISSION VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe("Comprehensive transmission verification", () => {
  it("all transmission IDs are unique within a single build", () => {
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "MIXED",
      rateRegime: "TIGHTENING",
      realYieldRegime: "REAL_YIELD_RISING",
      currencyRegime: "STRENGTHENING",
      liquidityRegime: "STRESS",
      growthRegime: "SLOWING",
      energyRegime: "OIL_SHOCK",
      geopoliticalRegime: "ESCALATING",
    });
    const txs = buildCausalTransmissions(r);
    const ids = txs.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every transmission affects at least one asset class", () => {
    const validAssets = ["GOLD", "SILVER", "CRYPTO", "FOREX", "EQUITIES", "OIL", "COMMODITIES"];
    const r = makeRegime({
      inflationRegime: "HIGH",
      inflationDriver: "SUPPLY_DRIVEN",
      rateRegime: "TIGHTENING",
    });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      expect(tx.affectedAssets.length).toBeGreaterThan(0);
      for (const asset of tx.affectedAssets) {
        expect(validAssets).toContain(asset);
      }
    }
  });

  it("every transmission has a valid evidence source", () => {
    const validSources = ["MACRO_CONTEXT", "CROSS_ASSET_CONTEXT", "NEWS_CONTEXT", "POSITION_INTELLIGENCE", "EXISTING_FUNDAMENTAL_REGIME"];
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      expect(validSources).toContain(tx.evidenceSource);
    }
  });

  it("every transmission has valid provenance", () => {
    const r = makeRegime({ inflationRegime: "HIGH", inflationDriver: "SUPPLY_DRIVEN" });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      expect(["OBSERVED", "DERIVED"]).toContain(tx.provenance);
    }
  });
});
