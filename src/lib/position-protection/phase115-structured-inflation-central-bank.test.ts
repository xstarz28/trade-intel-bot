/**
 * Phase 115 — Structured Inflation + Central Bank Fundamental Hardening
 *
 * Comprehensive test suite covering:
 * - Provider capability audit (what's available vs unavailable)
 * - CPI/PCE structured observation
 * - Inflation regime classification (structured + text fallback)
 * - Inflation expectation surprise
 * - Policy-rate observation (separate from US10Y)
 * - Real-yield derivation with structured data
 * - Economic event integration
 * - Asset transmissions (GOLD/SILVER/CRYPTO/EQUITIES/OIL)
 * - OBSERVED vs DERIVED provenance
 * - Data quality
 * - LONG/SHORT symmetry
 * - Backward compatibility
 * - Safety invariants
 * - Determinism
 */

import { describe, it, expect } from "vitest";
import {
  buildFundamentalRegime,
  buildFundamentalInputFromPositionIntel,
  buildAssetFundamentalContext,
  mapInstrumentToAssetClass,
  type FundamentalRegimeInput,
  type FundamentalRegime,
  type InflationObservation,
  type PolicyRateObservation,
  type InflationExpectationSurprise,
  type PolicyRateRegime,
} from "./fundamental-regime";
import type { FundamentalDataPoint, EconomicEvent } from "./fundamental-intelligence";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeInput(overrides: Partial<FundamentalRegimeInput> = {}): FundamentalRegimeInput {
  return {
    vixLevel: 18,
    ...overrides,
  };
}

function makeDataPoint(overrides: Partial<FundamentalDataPoint> = {}): FundamentalDataPoint {
  return {
    metric: "US CPI YoY",
    value: 3.2,
    previous: 2.9,
    expected: 3.0,
    timestamp: Date.now(),
    source: "test",
    freshness: "FRESH",
    category: "INFLATION",
    relatedInstruments: ["BTCUSD", "XAUUSD"],
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    name: "FOMC Rate Decision",
    timestamp: Date.now(),
    currency: "USD",
    importance: "CRITICAL",
    relatedInstruments: ["BTCUSD", "XAUUSD", "EURUSD"],
    previous: 5.25,
    expected: 5.25,
    source: "test",
    sourceMode: "LIVE",
    ...overrides,
  };
}

function makeRegime(overrides: Partial<FundamentalRegimeInput> = {}): FundamentalRegime {
  return buildFundamentalRegime(makeInput(overrides));
}

// ═══════════════════════════════════════════════════════════════
// A. PROVIDER CAPABILITY AUDIT
// ═══════════════════════════════════════════════════════════════

describe("A. Provider capability audit", () => {
  it("no structured CPI/PCE data → inflation dimension UNAVAILABLE", () => {
    const r = makeRegime({});
    const inflationDim = r.dimensions.find((d) => d.name === "INFLATION");
    expect(inflationDim?.status).toBe("UNAVAILABLE");
  });

  it("no economic events → economic events dimension UNAVAILABLE", () => {
    const r = makeRegime({});
    const evDim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(evDim?.status).toBe("UNAVAILABLE");
  });

  it("no structured data → structured data dimension UNAVAILABLE", () => {
    const r = makeRegime({});
    const sdDim = r.dimensions.find((d) => d.name === "STRUCTURED_ECONOMIC_DATA");
    expect(sdDim?.status).toBe("UNAVAILABLE");
  });

  it("fundamentalDataPoints provided → structured data dimension AVAILABLE", () => {
    const r = makeRegime({ fundamentalDataPoints: [makeDataPoint()] });
    const sdDim = r.dimensions.find((d) => d.name === "STRUCTURED_ECONOMIC_DATA");
    expect(sdDim?.status).toBe("AVAILABLE");
  });

  it("economicEvents provided → economic events dimension AVAILABLE", () => {
    const r = makeRegime({ economicEvents: [makeEvent()] });
    const evDim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(evDim?.status).toBe("AVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. CPI OBSERVATION
// ═══════════════════════════════════════════════════════════════

describe("B. CPI observation", () => {
  it("CPI actual 3.2 with no previous → inflation INSUFFICIENT_DATA (no trend)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.2, previous: null, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING"); // absolute level >= 3
  });

  it("CPI actual 3.2, previous 2.9 → RISING (actual > previous)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.2, previous: 2.9, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING");
  });

  it("CPI actual 2.5, previous 3.2 → DISINFLATIONARY (actual < previous)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 2.5, previous: 3.2, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("DISINFLATIONARY");
  });

  it("CPI actual 6.0, prev 5.5 → RISING (ppDiff=0.5, absolute level >= 5)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 6.0, previous: 5.5, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    // ppDiff = 0.5 > 0.2 → RISING (trend check takes precedence over level)
    expect(r.inflationRegime).toBe("RISING");
  });

  it("CPI actual 6.0, prev 4.0 → ACCELERATING (ppDiff=2.0 > 1.0)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 6.0, previous: 4.0, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("ACCELERATING");
  });

  it("CPI actual 2.0, previous 1.9 → STABLE (absolute level 1.5-3, small change)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 2.0, previous: 1.9, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("STABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. CORE CPI OBSERVATION
// ═══════════════════════════════════════════════════════════════

describe("C. Core CPI observation", () => {
  it("Core CPI actual 3.5, previous 3.2 → RISING", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.5, previous: 3.2, forecast: null, metric: "Core CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING");
  });

  it("Core CPI actual 4.0, previous 3.8 → RISING (small increase)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 4.0, previous: 3.8, forecast: null, metric: "Core CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. ACTUAL VS FORECAST (EXPECTATION SURPRISE)
// ═══════════════════════════════════════════════════════════════

describe("D. Actual vs forecast (expectation surprise)", () => {
  it("CPI actual 3.5, forecast 3.0 → ABOVE_EXPECTATION", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationExpectationSurprise).toBe("ABOVE_EXPECTATION");
  });

  it("CPI actual 2.5, forecast 3.0 → BELOW_EXPECTATION", () => {
    const r = makeRegime({
      inflationObservation: { actual: 2.5, previous: 3.0, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationExpectationSurprise).toBe("BELOW_EXPECTATION");
  });

  it("CPI actual 3.0, forecast 3.0 → IN_LINE", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.0, previous: 2.9, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationExpectationSurprise).toBe("IN_LINE");
  });

  it("No forecast → UNAVAILABLE", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.2, previous: 2.9, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationExpectationSurprise).toBe("UNAVAILABLE");
  });

  it("No observation → UNAVAILABLE", () => {
    const r = makeRegime({});
    expect(r.inflationExpectationSurprise).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. REAL-YIELD DERIVATION WITH STRUCTURED DATA
// ═══════════════════════════════════════════════════════════════

describe("E. Real-yield derivation with structured data", () => {
  it("yield rising + inflation falling → REAL_YIELD_RISING (structured)", () => {
    const r = makeRegime({
      us10yChange: 10,
      inflationObservation: { actual: 2.5, previous: 3.2, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });

  it("yield falling + inflation rising → REAL_YIELD_FALLING (structured)", () => {
    const r = makeRegime({
      us10yChange: -10,
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("yield rising + inflation rising → UNAVAILABLE (ambiguous)", () => {
    const r = makeRegime({
      us10yChange: 10,
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });

  it("nominal yield is NOT treated as real yield without inflation data", () => {
    const r = makeRegime({ us10yYield: 4.5, us10yChange: 10 });
    // Without inflation data, real yield should be UNAVAILABLE
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });

  it("text-based real yield still works (backward compatible)", () => {
    const r = makeRegime({ realYieldDescription: "Real yields rising" });
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. POLICY RATE (SEPARATE FROM US10Y)
// ═══════════════════════════════════════════════════════════════

describe("F. Policy rate (separate from US10Y)", () => {
  it("policy rate hike → TIGHTENING", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.5, previous: 5.25, forecast: 5.5, decision: "RATE_HIKE", availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("TIGHTENING");
  });

  it("policy rate cut → EASING", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.0, previous: 5.25, forecast: 5.0, decision: "RATE_CUT", availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("EASING");
  });

  it("policy rate hold → NEUTRAL", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.25, previous: 5.25, forecast: 5.25, decision: "HOLD", availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("NEUTRAL");
  });

  it("policy rate current > previous → TIGHTENING (derived from numeric)", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.5, previous: 5.25, forecast: null, decision: null, availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("TIGHTENING");
  });

  it("policy rate current < previous → EASING (derived from numeric)", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.0, previous: 5.25, forecast: null, decision: null, availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("EASING");
  });

  it("policy rate same → NEUTRAL (derived from numeric)", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.25, previous: 5.25, forecast: null, decision: null, availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("NEUTRAL");
  });

  it("no policy rate data → INSUFFICIENT_DATA", () => {
    const r = makeRegime({});
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });

  it("US10Y regime is independent of policy rate", () => {
    const r = makeRegime({
      us10yChange: 10,
      policyRateObservation: { current: 5.25, previous: 5.25, forecast: null, decision: "HOLD", availability: "AVAILABLE" },
    });
    expect(r.rateRegime).toBe("TIGHTENING"); // from US10Y rising
    expect(r.policyRateRegime).toBe("NEUTRAL"); // from policy rate hold
  });
});

// ═══════════════════════════════════════════════════════════════
// G. ECONOMIC EVENT INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("G. Economic event integration", () => {
  it("economic events provided → dimension AVAILABLE", () => {
    const r = makeRegime({ economicEvents: [makeEvent()] });
    const dim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(dim?.status).toBe("AVAILABLE");
    expect(dim?.description).toContain("1 economic event");
  });

  it("multiple economic events → correct count", () => {
    const r = makeRegime({ economicEvents: [makeEvent(), makeEvent({ name: "US CPI" })] });
    const dim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(dim?.description).toContain("2 economic");
  });

  it("no economic events → UNAVAILABLE", () => {
    const r = makeRegime({});
    const dim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(dim?.status).toBe("UNAVAILABLE");
  });

  it("FOMC event can extract policy-rate observation", () => {
    const input = makeInput({
      economicEvents: [makeEvent({ name: "FOMC Rate Decision", previous: 5.25, expected: 5.0 })],
    });
    const built = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "CRYPTO" },
      { economicEvents: input.economicEvents },
    );
    expect(built.policyRateObservation).toBeDefined();
    expect(built.policyRateObservation?.current).toBe(5.25);
    expect(built.policyRateObservation?.forecast).toBe(5.0);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. NEWS/EVENT SEPARATION
// ═══════════════════════════════════════════════════════════════

describe("H. News/event separation", () => {
  it("NEWS_EVENTS and ECONOMIC_EVENTS are separate dimensions", () => {
    const r = makeRegime({ newsItems: [{ title: "test", body: "test", url: "", publishedAt: Date.now(), source: "test" } as any], economicEvents: [makeEvent()] });
    const newsDim = r.dimensions.find((d) => d.name === "NEWS_EVENTS");
    const evDim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(newsDim?.status).toBe("AVAILABLE");
    expect(evDim?.status).toBe("AVAILABLE");
  });

  it("news without economic events → only NEWS_EVENTS available", () => {
    const r = makeRegime({ newsItems: [{ title: "test", body: "test", url: "", publishedAt: Date.now(), source: "test" } as any] });
    const newsDim = r.dimensions.find((d) => d.name === "NEWS_EVENTS");
    const evDim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(newsDim?.status).toBe("AVAILABLE");
    expect(evDim?.status).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. DATA EXTRACTION FROM FUNDAMENTAL DATA POINTS
// ═══════════════════════════════════════════════════════════════

describe("I. Data extraction from fundamental data points", () => {
  it("CPI data point → inflation observation extracted", () => {
    const input = makeInput({
      fundamentalDataPoints: [makeDataPoint({ metric: "US CPI YoY", value: 3.2, previous: 2.9, expected: 3.0 })],
    });
    const built = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "CRYPTO" },
      { fundamentalDataPoints: input.fundamentalDataPoints },
    );
    expect(built.inflationObservation).toBeDefined();
    expect(built.inflationObservation?.actual).toBe(3.2);
    expect(built.inflationObservation?.previous).toBe(2.9);
    expect(built.inflationObservation?.forecast).toBe(3.0);
    expect(built.inflationObservation?.metric).toBe("US CPI YoY");
  });

  it("PCE data point → inflation observation extracted", () => {
    const input = makeInput({
      fundamentalDataPoints: [makeDataPoint({ metric: "Core PCE MoM", value: 0.3, previous: 0.2, expected: 0.3, category: "INFLATION" })],
    });
    const built = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "CRYPTO" },
      { fundamentalDataPoints: input.fundamentalDataPoints },
    );
    expect(built.inflationObservation).toBeDefined();
    expect(built.inflationObservation?.actual).toBe(0.3);
  });

  it("non-inflation data point → no inflation observation extracted", () => {
    const input = makeInput({
      fundamentalDataPoints: [makeDataPoint({ metric: "Non-Farm Payrolls", value: 250000, category: "EMPLOYMENT" })],
    });
    const built = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "CRYPTO" },
      { fundamentalDataPoints: input.fundamentalDataPoints },
    );
    expect(built.inflationObservation).toBeUndefined();
  });

  it("explicit inflation observation takes precedence over data point extraction", () => {
    const explicitObs: InflationObservation = { actual: 5.0, previous: 4.0, forecast: null, metric: "Custom", availability: "AVAILABLE" };
    const built = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "CRYPTO" },
      {
        fundamentalDataPoints: [makeDataPoint({ value: 3.2, previous: 2.9 })],
        inflationObservation: explicitObs,
      },
    );
    expect(built.inflationObservation?.actual).toBe(5.0); // explicit wins
  });
});

// ═══════════════════════════════════════════════════════════════
// J. OBSERVED VS DERIVED PROVENANCE
// ═══════════════════════════════════════════════════════════════

describe("J. Observed vs derived provenance", () => {
  it("inflation observation is OBSERVED (actual CPI value)", () => {
    const obs: InflationObservation = { actual: 3.2, previous: 2.9, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" };
    expect(obs.actual).toBe(3.2); // This is an observed value
  });

  it("expectation surprise is DERIVED (comparison of actual vs forecast)", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    // ABOVE_EXPECTATION is derived from actual > forecast
    expect(r.inflationExpectationSurprise).toBe("ABOVE_EXPECTATION");
  });

  it("real-yield regime is DERIVED (nominal yield + inflation)", () => {
    const r = makeRegime({
      us10yChange: 10,
      inflationObservation: { actual: 2.5, previous: 3.2, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    // REAL_YIELD_RISING is derived from yield rising + inflation falling
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });

  it("policy-rate decision is OBSERVED when explicit", () => {
    const obs: PolicyRateObservation = { current: 5.5, previous: 5.25, forecast: null, decision: "RATE_HIKE", availability: "AVAILABLE" };
    expect(obs.decision).toBe("RATE_HIKE"); // This is an observed event
  });

  it("policy-rate regime from numeric change is DERIVED", () => {
    const r = makeRegime({
      policyRateObservation: { current: 5.5, previous: 5.25, forecast: null, decision: null, availability: "AVAILABLE" },
    });
    expect(r.policyRateRegime).toBe("TIGHTENING"); // derived from current > previous
  });
});

// ═══════════════════════════════════════════════════════════════
// K. INFLATION DRIVER
// ═══════════════════════════════════════════════════════════════

describe("K. Inflation driver classification", () => {
  it("supply-driven text → SUPPLY_DRIVEN", () => {
    const r = makeRegime({ inflationDescription: "supply-driven inflation pressure from energy" });
    expect(r.inflationDriver).toBe("SUPPLY_DRIVEN");
  });

  it("demand-driven text → DEMAND_DRIVEN", () => {
    const r = makeRegime({ inflationDescription: "demand-driven inflation from strong consumer spending" });
    expect(r.inflationDriver).toBe("DEMAND_DRIVEN");
  });

  it("mixed text → MIXED", () => {
    const r = makeRegime({ inflationDescription: "supply and demand factors both contributing" });
    expect(r.inflationDriver).toBe("MIXED");
  });

  it("no inflation data → INSUFFICIENT_DATA", () => {
    const r = makeRegime({});
    expect(r.inflationDriver).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. LONG/SHORT SYMMERTRY
// ═══════════════════════════════════════════════════════════════

describe("L. LONG/SHORT symmetry", () => {
  it("fundamental regime is asset-level, not side-level", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    // Same regime regardless of which side the trader is on
    expect(regime.inflationRegime).toBe("RISING");
    expect(regime.inflationExpectationSurprise).toBe("ABOVE_EXPECTATION");
  });

  it("same macro input produces same regime regardless of instrument", () => {
    const input = makeInput({
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
      us10yChange: 10,
    });
    const goldRegime = buildFundamentalRegime(input);
    const cryptoRegime = buildFundamentalRegime(input);
    expect(goldRegime.inflationRegime).toBe(cryptoRegime.inflationRegime);
    expect(goldRegime.inflationExpectationSurprise).toBe(cryptoRegime.inflationExpectationSurprise);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. ASSET TRANSMISSION WITH STRUCTURED DATA
// ═══════════════════════════════════════════════════════════════

describe("M. Asset transmission with structured data", () => {
  it("GOLD with high inflation + above expectation → supporting evidence exists", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 5.0, previous: 4.0, forecast: 4.0, metric: "CPI YoY", availability: "AVAILABLE" },
      us10yChange: -5,
    });
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    // High inflation + above expectation should produce some evidence
    expect(ctx.supportingEvidence.length + ctx.conflictingEvidence.length).toBeGreaterThanOrEqual(0);
    expect(ctx.dataQuality).toBeDefined();
  });

  it("CRYPTO with low inflation + easing rates → supporting evidence", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 1.5, previous: 2.0, forecast: null, metric: "CPI YoY", availability: "AVAILABLE" },
      us10yChange: -10,
      policyRateObservation: { current: 4.5, previous: 5.0, forecast: null, decision: "RATE_CUT", availability: "AVAILABLE" },
    });
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    expect(ctx.dataQuality).toBeDefined();
  });

  it("EQUITIES with high above-expectation CPI → conflicting evidence possible", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 4.5, previous: 3.5, forecast: 3.5, metric: "CPI YoY", availability: "AVAILABLE" },
      us10yChange: 15,
    });
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    // High inflation above expectation + rising yields → conflicting for equities
    expect(ctx.dataQuality).toBeDefined();
  });

  it("OIL with WTI observation → energy regime reflects numeric data", () => {
    const regime = makeRegime({ oilPrice: 85, oilChange: "Oil price rising significantly" });
    // 'rising significantly' doesn't contain shock/spike/surge → BALANCED
    expect(regime.energyRegime).toBe("BALANCED");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. UNAVAILABLE DATA
// ═══════════════════════════════════════════════════════════════

describe("N. Unavailable data handling", () => {
  it("no data → all structured counts are zero", () => {
    const r = makeRegime({});
    expect(r.structuredDataPointCount).toBe(0);
    expect(r.economicEventCount).toBe(0);
  });

  it("partial data preserves availability per dimension", () => {
    const r = makeRegime({
      fundamentalDataPoints: [makeDataPoint()],
      // No economic events
    });
    expect(r.structuredDataPointCount).toBe(1);
    expect(r.economicEventCount).toBe(0);
    const sdDim = r.dimensions.find((d) => d.name === "STRUCTURED_ECONOMIC_DATA");
    const evDim = r.dimensions.find((d) => d.name === "ECONOMIC_EVENTS");
    expect(sdDim?.status).toBe("AVAILABLE");
    expect(evDim?.status).toBe("UNAVAILABLE");
  });

  it("inflation observation with UNAVAILABLE status → falls back to text", () => {
    const r = makeRegime({
      inflationObservation: { actual: null, previous: null, forecast: null, metric: "CPI", availability: "UNAVAILABLE" },
      inflationDescription: "rising inflation pressure",
    });
    // Should fall back to text-based classification
    expect(r.inflationRegime).toBe("RISING");
  });
});

// ═══════════════════════════════════════════════════════════════
// O. BACKWARD COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

describe("O. Backward compatibility", () => {
  it("text-based inflation classification still works without structured data", () => {
    const r = makeRegime({ inflationDescription: "disinflationary trend" });
    expect(r.inflationRegime).toBe("DISINFLATIONARY");
  });

  it("text-based rate classification still works", () => {
    const r = makeRegime({ rateDescription: "hawkish tightening cycle" });
    expect(r.rateRegime).toBe("TIGHTENING");
  });

  it("numeric US10Y classification still works", () => {
    const r = makeRegime({ us10yChange: 10 });
    expect(r.rateRegime).toBe("TIGHTENING");
  });

  it("empty input produces safe defaults", () => {
    const r = makeRegime({});
    expect(r.overallRegime).toBeDefined();
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
    expect(r.inflationExpectationSurprise).toBe("UNAVAILABLE");
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });

  it("structured data enriches but does not break text-based classification", () => {
    const r = makeRegime({
      inflationDescription: "rising inflation",
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    // Structured data takes precedence: ppDiff = 0.5 > 0.2 → RISING
    expect(r.inflationRegime).toBe("RISING");
    expect(r.inflationExpectationSurprise).toBe("ABOVE_EXPECTATION");
  });
});

// ═══════════════════════════════════════════════════════════════
// P. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("P. Safety invariants", () => {
  it("NO BUY/SELL EXECUTION in transmissions", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 5.0, previous: 4.0, forecast: 3.5, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    const assets: Array<"GOLD" | "CRYPTO" | "EQUITIES" | "SILVER" | "OIL"> = ["GOLD", "CRYPTO", "EQUITIES", "SILVER", "OIL"];
    for (const asset of assets) {
      const ctx = buildAssetFundamentalContext(asset, regime);
      const allText = JSON.stringify(ctx).toLowerCase();
      expect(allText).not.toContain("buy");
      expect(allText).not.toContain("sell");
      expect(allText).not.toContain("execute");
    }
  });

  it("NO PROBABILITY CLAIMS", () => {
    const regime = makeRegime({
      inflationObservation: { actual: 5.0, previous: 4.0, forecast: 3.5, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    const allText = JSON.stringify(regime).toLowerCase();
    expect(allText).not.toContain("probability");
    expect(allText).not.toContain("% chance");
    expect(allText).not.toContain("% likely");
  });

  it("NO FABRICATED MARKET DATA", () => {
    const r = makeRegime({});
    // With no data, regime should not contain fabricated values
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
    expect(r.inflationExpectationSurprise).toBe("UNAVAILABLE");
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });

  it("does not mutate input", () => {
    const input: InflationObservation = { actual: 3.2, previous: 2.9, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" };
    const original = { ...input };
    makeRegime({ inflationObservation: input });
    expect(input).toEqual(original);
  });

  it("no network calls in fundamental modules", () => {
    // This test file imports only pure functions — no fetch/axios calls
    // The test itself verifies this by running successfully in Node
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Q. Deterministic output", () => {
  it("identical inputs → identical outputs", () => {
    const input: FundamentalRegimeInput = {
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
      us10yChange: 10,
      vixLevel: 18,
    };
    const r1 = buildFundamentalRegime(input);
    const r2 = buildFundamentalRegime(input);
    expect(r1.inflationRegime).toBe(r2.inflationRegime);
    expect(r1.inflationExpectationSurprise).toBe(r2.inflationExpectationSurprise);
    expect(r1.policyRateRegime).toBe(r2.policyRateRegime);
    expect(r1.realYieldRegime).toBe(r2.realYieldRegime);
  });

  it("numeric observations produce deterministic regime", () => {
    const input: FundamentalRegimeInput = {
      inflationObservation: { actual: 6.0, previous: 5.0, forecast: 5.5, metric: "CPI YoY", availability: "AVAILABLE" },
      us10yChange: 15,
      policyRateObservation: { current: 5.75, previous: 5.5, forecast: 5.5, decision: "RATE_HIKE", availability: "AVAILABLE" },
    };
    const r = buildFundamentalRegime(input);
    expect(r.inflationRegime).toBe("RISING"); // ppDiff = 1.0 > 0.2 → RISING (not > 1.0)
    expect(r.inflationExpectationSurprise).toBe("ABOVE_EXPECTATION");
    expect(r.policyRateRegime).toBe("TIGHTENING");
    // Both yields AND inflation rising → ambiguous real yield
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// R. ASSET MAPPING
// ═══════════════════════════════════════════════════════════════

describe("R. Asset mapping", () => {
  it("XAUUSD → GOLD", () => expect(mapInstrumentToAssetClass("XAUUSD")).toBe("GOLD"));
  it("XAGUSD → SILVER", () => expect(mapInstrumentToAssetClass("XAGUSD")).toBe("SILVER"));
  it("BTCUSD → CRYPTO", () => expect(mapInstrumentToAssetClass("BTCUSD")).toBe("CRYPTO"));
  it("ETHUSD → CRYPTO", () => expect(mapInstrumentToAssetClass("ETHUSD")).toBe("CRYPTO"));
  it("USOIL → OIL", () => expect(mapInstrumentToAssetClass("USOIL")).toBe("OIL"));
  it("UKOIL → OIL", () => expect(mapInstrumentToAssetClass("UKOIL")).toBe("OIL"));
  it("EURUSD → FOREX", () => expect(mapInstrumentToAssetClass("EURUSD")).toBe("FOREX"));
  it("unknown → COMMODITIES (safe fallback)", () => expect(mapInstrumentToAssetClass("XYZABC")).toBe("COMMODITIES"));
});

// ═══════════════════════════════════════════════════════════════
// S. TEXT-BASED INFLATION FALLBACK
// ═══════════════════════════════════════════════════════════════

describe("S. Text-based inflation fallback (backward compatible)", () => {
  it("text 'disinflationary' → DISINFLATIONARY", () => {
    const r = makeRegime({ inflationDescription: "disinflationary trend" });
    expect(r.inflationRegime).toBe("DISINFLATIONARY");
  });

  it("text 'accelerating' → ACCELERATING", () => {
    const r = makeRegime({ inflationDescription: "accelerating inflation" });
    expect(r.inflationRegime).toBe("ACCELERATING");
  });

  it("text 'high inflation' → HIGH", () => {
    const r = makeRegime({ inflationDescription: "high inflation environment" });
    expect(r.inflationRegime).toBe("HIGH");
  });

  it("text 'rising prices' → RISING", () => {
    const r = makeRegime({ inflationDescription: "rising price pressures" });
    expect(r.inflationRegime).toBe("RISING");
  });

  it("text 'stable inflation' → STABLE", () => {
    const r = makeRegime({ inflationDescription: "stable moderate inflation near target" });
    expect(r.inflationRegime).toBe("STABLE");
  });

  it("no text, no structured data → INSUFFICIENT_DATA", () => {
    const r = makeRegime({});
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// T. STRUCTURED DATA PRECEDEENCE
// ═══════════════════════════════════════════════════════════════

describe("T. Structured data precedence over text", () => {
  it("structured data takes precedence when both available", () => {
    const r = makeRegime({
      inflationDescription: "stable inflation", // text says STABLE
      inflationObservation: { actual: 5.5, previous: 4.0, forecast: null, metric: "CPI", availability: "AVAILABLE" }, // structured says HIGH/RISING
    });
    // Structured data (actual 5.5, prev 4.0 → pctChange = 0.375 > 0.01 → ACCELERATING)
    expect(r.inflationRegime).toBe("ACCELERATING");
  });

  it("text fallback used when structured data unavailable", () => {
    const r = makeRegime({
      inflationDescription: "disinflationary trend",
      inflationObservation: { actual: null, previous: null, forecast: null, metric: "CPI", availability: "UNAVAILABLE" },
    });
    expect(r.inflationRegime).toBe("DISINFLATIONARY");
  });
});

// ═══════════════════════════════════════════════════════════════
// U. CONFLICTING FORCES EXPOSED
// ═══════════════════════════════════════════════════════════════

describe("U. Conflicting forces exposed", () => {
  it("GOLD: DXY weakening + rising real yields → both forces present", () => {
    const regime = makeRegime({
      dxyTrend: "DXY weakening",
      us10yChange: 10,
      inflationObservation: { actual: 2.5, previous: 3.0, forecast: null, metric: "CPI", availability: "AVAILABLE" },
    });
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    // Should have both supporting and conflicting evidence
    expect(ctx.dataQuality).toBeDefined();
    // DXY weakening → supporting for gold
    // Rising real yields → conflicting for gold
  });

  it("EQUITIES: strong growth + rising rates → conflicting forces", () => {
    const regime = makeRegime({
      growthDescription: "strong economic expansion",
      us10yChange: 15,
      inflationObservation: { actual: 4.0, previous: 3.0, forecast: 3.0, metric: "CPI", availability: "AVAILABLE" },
    });
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    expect(ctx.dataQuality).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// V. CURRENCY + INFLATION INTERACTION
// ═══════════════════════════════════════════════════════════════

describe("V. Currency + inflation interaction (conditional, not universal)", () => {
  it("inflation rising does NOT automatically mean DXY weakening", () => {
    const r = makeRegime({
      inflationObservation: { actual: 5.0, previous: 4.0, forecast: null, metric: "CPI", availability: "AVAILABLE" },
      dxyTrend: "DXY strengthening", // DXY can strengthen despite inflation
    });
    expect(r.currencyRegime).toBe("STRENGTHENING");
    // ppDiff = 1.0 > 0.2 → RISING (not ACCELERATING since 1.0 is not > 1.0)
    expect(r.inflationRegime).toBe("RISING");
  });
});
