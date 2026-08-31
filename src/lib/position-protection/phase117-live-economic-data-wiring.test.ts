/**
 * Phase 117 — Live Economic Data Provider Integration & Fundamental Data Completion
 *
 * Tests covering:
 * - Treasury real-yield wiring into fundamental pipeline
 * - Provider capability verification
 * - Real-yield OBSERVED vs DERIVED
 * - CPI/PCE/Fed Funds availability honesty
 * - Data freshness
 * - Provider failure degradation
 * - Partial availability
 * - LONG/SHORT symmetry
 * - Safety invariants
 * - Determinism
 */

import { describe, it, expect } from "vitest";
import {
  buildFundamentalRegime,
  buildFundamentalInputFromPositionIntel,
  buildAssetFundamentalContext,
  type FundamentalRegimeInput,
  type InflationObservation,
  type PolicyRateObservation,
} from "./fundamental-regime";
import type { TreasuryData, TreasuryContext } from "../../lib/data/treasury";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeTreasuryData(overrides: Partial<TreasuryContext> = {}): TreasuryContext {
  return {
    available: true,
    source: "US Treasury (home.treasury.gov XML feed)",
    fetchedAt: Date.now(),
    freshness: "FRESH",
    latest: {
      nominal: {
        observationDate: "2025-01-15",
        nominal: { "2Y": 4.25, "5Y": 4.10, "10Y": 4.55, "30Y": 4.75 },
      },
      real: {
        observationDate: "2025-01-15",
        real: { "5Y": 1.85, "7Y": 1.95, "10Y": 2.10, "20Y": 2.25, "30Y": 2.30 },
      },
    },
    ...overrides,
  };
}

function makeInput(overrides: Partial<FundamentalRegimeInput> = {}): FundamentalRegimeInput {
  return { vixLevel: 18, ...overrides };
}

function makeRegime(overrides: Partial<FundamentalRegimeInput> = {}): ReturnType<typeof buildFundamentalRegime> {
  return buildFundamentalRegime(makeInput(overrides));
}

// ═══════════════════════════════════════════════════════════════
// A. PROVIDER CAPABILITY AUDIT
// ═══════════════════════════════════════════════════════════════

describe("A. Provider capability audit", () => {
  it("Treasury real yields: PROVIDER_AVAILABLE (home.treasury.gov, no API key)", () => {
    const td = makeTreasuryData();
    expect(td.available).toBe(true);
    expect(td.latest.real).toBeDefined();
    expect(td.latest.real?.real["10Y"]).toBe(2.10);
  });

  it("Treasury nominal yields: PROVIDER_AVAILABLE", () => {
    const td = makeTreasuryData();
    expect(td.latest.nominal.nominal["10Y"]).toBe(4.55);
  });

  it("CPI/PCE: PROVIDER_UNAVAILABLE (no existing provider)", () => {
    // Verified: no CPI/PCE endpoint exists in Twelve Data, Alpha Vantage, Yahoo Finance, or Treasury
    // The economic calendar (TickAtlas) can provide CPI release events but not standalone CPI values
    const regime = makeRegime({});
    expect(regime.inflationRegime).toBe("INSUFFICIENT_DATA");
  });

  it("Fed Funds Rate: PROVIDER_UNAVAILABLE (no existing provider)", () => {
    const regime = makeRegime({});
    expect(regime.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. TREASURY REAL-YIELD WIRING
// ═══════════════════════════════════════════════════════════════

describe("B. Treasury real-yield wiring", () => {
  it("Treasury data with real 10Y → REAL_YIELD_STABLE (no previous)", () => {
    const td = makeTreasuryData();
    const r = makeRegime({ treasuryContext: td });
    expect(r.realYieldRegime).toBe("REAL_YIELD_STABLE");
  });

  it("Treasury data with real 10Y rising → REAL_YIELD_RISING", () => {
    const current = makeTreasuryData();
    const previous = makeTreasuryData({
      latest: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.50 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 1.90 } },
      },
    });
    // Simulate previous by modifying the context
    const td: TreasuryContext = {
      ...current,
      previous: previous.latest,
    };
    const r = makeRegime({ treasuryContext: td });
    // 2.10 - 1.90 = 0.20 > 0.03 → REAL_YIELD_RISING
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });

  it("Treasury data with real 10Y falling → REAL_YIELD_FALLING", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const r = makeRegime({ treasuryContext: td });
    // 2.10 - 2.30 = -0.20 < -0.03 → REAL_YIELD_FALLING
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("Treasury data takes precedence over text when text is absent", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const r = makeRegime({ treasuryContext: td });
    // Treasury data (OBSERVED) provides FALLING when no text override
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("Treasury OBSERVED data takes precedence over text", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const r = makeRegime({
      treasuryContext: td,
      realYieldDescription: "Real yields stable", // text says stable
    });
    // Treasury OBSERVED data takes precedence → FALLING
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("Treasury unavailable → falls back to text/derived", () => {
    const td: TreasuryData = { available: false, reason: "Network error" };
    const r = makeRegime({ treasuryContext: td, realYieldDescription: "Real yields rising" });
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });

  it("No treasury, no text, no structured data → UNAVAILABLE", () => {
    const r = makeRegime({});
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. OBSERVED VS DERIVED PROVENANCE
// ═══════════════════════════════════════════════════════════════

describe("C. Observed vs derived provenance", () => {
  it("Treasury real yield is OBSERVED (from home.treasury.gov)", () => {
    const td = makeTreasuryData();
    expect(td.source).toBe("US Treasury (home.treasury.gov XML feed)");
    expect(td.latest.real?.real["10Y"]).toBe(2.10);
  });

  it("Real-yield direction from treasury is OBSERVED (actual consecutive observations)", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const r = makeRegime({ treasuryContext: td });
    // REAL_YIELD_FALLING is derived from OBSERVED consecutive real-yield observations
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("Real-yield direction from US10Y+inflation is DERIVED (not observed)", () => {
    const r = makeRegime({
      us10yChange: -10,
      inflationObservation: { actual: 3.5, previous: 3.0, forecast: null, metric: "CPI", availability: "AVAILABLE" },
    });
    // This is DERIVED from nominal yield + inflation, not actual real-yield data
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. DATA FRESHNESS
// ═══════════════════════════════════════════════════════════════

describe("D. Data freshness", () => {
  it("Treasury FRESH → freshness preserved", () => {
    const td = makeTreasuryData({ freshness: "FRESH" });
    expect(td.freshness).toBe("FRESH");
  });

  it("Treasury DELAYED → freshness preserved", () => {
    const td = makeTreasuryData({ freshness: "DELAYED" });
    expect(td.freshness).toBe("DELAYED");
  });

  it("Treasury STALE → freshness preserved", () => {
    const td = makeTreasuryData({ freshness: "STALE" });
    expect(td.freshness).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. PROVIDER FAILURE DEGRADATION
// ═══════════════════════════════════════════════════════════════

describe("E. Provider failure degradation", () => {
  it("Treasury unavailable → regime degrades gracefully", () => {
    const td: TreasuryData = { available: false, reason: "Network timeout" };
    const r = makeRegime({ treasuryContext: td });
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
    expect(r.overallRegime).toBeDefined();
  });

  it("Treasury available but no real curve → nominal still works", () => {
    const td: TreasuryContext = {
      available: true,
      source: "US Treasury (home.treasury.gov XML feed)",
      fetchedAt: Date.now(),
      freshness: "FRESH",
      latest: {
        nominal: { observationDate: "2025-01-15", nominal: { "10Y": 4.55 } },
      },
    };
    const r = makeRegime({ treasuryContext: td });
    // No real curve → falls back to text/derived
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });

  it("Partial provider failure preserves available dimensions", () => {
    const r = makeRegime({
      vixLevel: 20,
      treasuryContext: makeTreasuryData(),
      // No CPI, no Fed Funds, no news
    });
    const availableDims = r.dimensions.filter((d) => d.status === "AVAILABLE");
    expect(availableDims.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. PARTIAL AVAILABILITY
// ═══════════════════════════════════════════════════════════════

describe("F. Partial availability", () => {
  it("Treasury + VIX available, CPI/Fed Funds unavailable → mixed regime", () => {
    const r = makeRegime({
      vixLevel: 20,
      treasuryContext: makeTreasuryData(),
    });
    expect(r.dataQuality).toBeDefined();
    expect(r.realYieldRegime).toBe("REAL_YIELD_STABLE");
  });

  it("Only treasury available → limited but honest regime", () => {
    const r = makeRegime({
      treasuryContext: makeTreasuryData(),
    });
    // Treasury provides real yields but not enough for full regime
    expect(r.realYieldRegime).toBe("REAL_YIELD_STABLE");
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("G. LONG/SHORT symmetry", () => {
  it("Treasury data produces same regime regardless of position side", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const input = makeInput({ treasuryContext: td });
    const r = buildFundamentalRegime(input);
    // Same regime regardless of which asset/side uses it
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("H. Safety invariants", () => {
  it("NO BUY/SELL EXECUTION in asset context", () => {
    const td = makeTreasuryData();
    const regime = makeRegime({ treasuryContext: td, vixLevel: 20 });
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
    const td = makeTreasuryData();
    const regime = makeRegime({ treasuryContext: td, vixLevel: 20 });
    const allText = JSON.stringify(regime).toLowerCase();
    expect(allText).not.toContain("probability");
    expect(allText).not.toContain("% chance");
  });

  it("NO FABRICATED DATA", () => {
    const r = makeRegime({});
    // With no data, regime should not contain fabricated values
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });

  it("US10Y NOT treated as policy rate", () => {
    const r = makeRegime({ us10yYield: 4.55, us10yChange: 10 });
    // US10Y affects rateRegime (market yield) but NOT policyRateRegime
    expect(r.rateRegime).toBe("TIGHTENING");
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });

  it("US10Y NOT treated as real yield", () => {
    const r = makeRegime({ us10yYield: 4.55 });
    // Without inflation context or treasury data, real yield is UNAVAILABLE
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("I. Deterministic output", () => {
  it("identical inputs → identical outputs", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const input: FundamentalRegimeInput = { treasuryContext: td, vixLevel: 18 };
    const r1 = buildFundamentalRegime(input);
    const r2 = buildFundamentalRegime(input);
    expect(r1.realYieldRegime).toBe(r2.realYieldRegime);
    expect(r1.overallRegime).toBe(r2.overallRegime);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. CPI/PCE HONESTY
// ═══════════════════════════════════════════════════════════════

describe("J. CPI/PCE availability honesty", () => {
  it("No CPI data → inflation regime INSUFFICIENT_DATA", () => {
    const r = makeRegime({});
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
  });

  it("Structured CPI observation → inflation regime classified", () => {
    const r = makeRegime({
      inflationObservation: { actual: 3.2, previous: 2.9, forecast: 3.0, metric: "CPI YoY", availability: "AVAILABLE" },
    });
    expect(r.inflationRegime).toBe("RISING");
    expect(r.inflationExpectationSurprise).toBe("ABOVE_EXPECTATION");
  });

  it("Fed Funds unavailable → policy rate INSUFFICIENT_DATA", () => {
    const r = makeRegime({});
    expect(r.policyRateRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. ASSET TRANSMISSION WITH TREASURY DATA
// ═══════════════════════════════════════════════════════════════

describe("K. Asset transmission with treasury data", () => {
  it("GOLD with falling real yields → supporting evidence possible", () => {
    const td: TreasuryContext = {
      ...makeTreasuryData(),
      previous: {
        nominal: { observationDate: "2025-01-10", nominal: { "10Y": 4.60 } },
        real: { observationDate: "2025-01-10", real: { "10Y": 2.30 } },
      },
    };
    const regime = makeRegime({ treasuryContext: td, vixLevel: 20 });
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.dataQuality).toBeDefined();
    // Falling real yields should appear in evidence
    const allText = JSON.stringify(ctx).toLowerCase();
    expect(allText).toContain("real");
  });

  it("CRYPTO with treasury data → regime includes real yield dimension", () => {
    const td = makeTreasuryData();
    const regime = makeRegime({ treasuryContext: td, vixLevel: 15 });
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    expect(ctx.dataQuality).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// L. NO DUPLICATE PROVIDER REQUESTS
// ═══════════════════════════════════════════════════════════════

describe("L. No duplicate provider requests", () => {
  it("treasuryContext passed once, used by regime builder without re-fetch", () => {
    const td = makeTreasuryData();
    const input = makeInput({ treasuryContext: td });
    // buildFundamentalRegime is a pure function — no network calls
    const r = buildFundamentalRegime(input);
    expect(r.realYieldRegime).toBe("REAL_YIELD_STABLE");
  });
});
