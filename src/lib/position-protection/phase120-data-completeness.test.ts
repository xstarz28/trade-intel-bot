/**
 * Phase 120 — Data Completeness, Growth/Employment/Consumer Intelligence
 *
 * Tests for structured economic observations parsed from TickAtlas calendar events
 * and their integration into the FundamentalRegime engine.
 */
import { describe, it, expect } from "vitest";
import {
  buildFundamentalRegime,
  buildFundamentalInputFromPositionIntel,
  mapInstrumentToAssetClass,
  type FundamentalRegimeInput,
} from "./fundamental-regime";

function makeBase(overrides: Partial<FundamentalRegimeInput> = {}): FundamentalRegimeInput {
  return {
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// GROWTH OBSERVATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — Growth Observation from Calendar Events", () => {
  it("PMI > 55 → EXPANDING", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 57.2,
        pmiPrevious: 55.8,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("EXPANDING");
  });

  it("PMI 50-55 rising → EXPANDING", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 52.1,
        pmiPrevious: 51.0,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("EXPANDING");
  });

  it("PMI 50-55 falling → SLOWING", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 51.0,
        pmiPrevious: 52.5,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("SLOWING");
  });

  it("PMI exactly 50 → EXPANDING", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 50.0,
        pmiPrevious: 49.0,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("EXPANDING");
  });

  it("PMI 45-50 → SLOWING", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 47.5,
        pmiPrevious: 49.0,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("SLOWING");
  });

  it("PMI < 45 → CONTRACTING", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 42.0,
        pmiPrevious: 45.5,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("CONTRACTING");
  });

  it("GDP positive → EXPANDING", () => {
    const input = makeBase({
      growthObservation: {
        gdpActual: 2.5,
        gdpPrevious: 2.1,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("EXPANDING");
  });

  it("GDP mildly negative (> -1) → SLOWING", () => {
    const input = makeBase({
      growthObservation: {
        gdpActual: -0.5,
        gdpPrevious: 0.3,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("SLOWING");
  });

  it("GDP deeply negative (< -1) → CONTRACTING", () => {
    const input = makeBase({
      growthObservation: {
        gdpActual: -2.0,
        gdpPrevious: -0.5,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("CONTRACTING");
  });

  it("ISM > 55 → EXPANDING", () => {
    const input = makeBase({
      growthObservation: {
        ismActual: 58.0,
        ismPrevious: 56.5,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("EXPANDING");
  });

  it("no growth observation → falls back to text", () => {
    const input = makeBase({
      growthDescription: "strong growth",
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("EXPANDING");
  });

  it("unavailable growth observation → UNAVAILABLE", () => {
    const input = makeBase({
      growthObservation: {
        availability: "UNAVAILABLE",
        dataPointCount: 0,
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("UNAVAILABLE");
  });

  it("growth observation takes precedence over text", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 42.0,
        pmiPrevious: 45.0,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
      growthDescription: "strong growth",
    });
    const regime = buildFundamentalRegime(input);
    // Structured data says CONTRACTING (PMI < 45)
    expect(regime.growthRegime).toBe("CONTRACTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// EMPLOYMENT OBSERVATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — Employment Observation from Calendar Events", () => {
  it("NFP >= 200 → STRONG", () => {
    const input = makeBase({
      employmentObservation: {
        nfpActual: 250,
        nfpPrevious: 180,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("STRONG");
  });

  it("NFP 100-200 → STABLE", () => {
    const input = makeBase({
      employmentObservation: {
        nfpActual: 150,
        nfpPrevious: 200,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("STABLE");
  });

  it("NFP 0-100 → WEAKENING", () => {
    const input = makeBase({
      employmentObservation: {
        nfpActual: 50,
        nfpPrevious: 150,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("WEAKENING");
  });

  it("NFP negative → STRESSED", () => {
    const input = makeBase({
      employmentObservation: {
        nfpActual: -30,
        nfpPrevious: 100,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("STRESSED");
  });

  it("unemployment < 4% → STRONG", () => {
    const input = makeBase({
      employmentObservation: {
        unemploymentActual: 3.5,
        unemploymentPrevious: 3.7,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("STRONG");
  });

  it("unemployment 4-5% → STABLE", () => {
    const input = makeBase({
      employmentObservation: {
        unemploymentActual: 4.3,
        unemploymentPrevious: 4.1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("STABLE");
  });

  it("unemployment 5-6% → WEAKENING", () => {
    const input = makeBase({
      employmentObservation: {
        unemploymentActual: 5.5,
        unemploymentPrevious: 5.0,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("WEAKENING");
  });

  it("unemployment > 6% → STRESSED", () => {
    const input = makeBase({
      employmentObservation: {
        unemploymentActual: 6.5,
        unemploymentPrevious: 5.8,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("STRESSED");
  });

  it("no employment observation → UNAVAILABLE", () => {
    const input = makeBase({});
    const regime = buildFundamentalRegime(input);
    expect(regime.employmentRegime).toBe("UNAVAILABLE");
  });

  it("NFP takes precedence over unemployment when both present", () => {
    const input = makeBase({
      employmentObservation: {
        nfpActual: 250,
        unemploymentActual: 6.5, // conflicting — but NFP takes precedence
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    // NFP >= 200 → STRONG (takes precedence)
    expect(regime.employmentRegime).toBe("STRONG");
  });
});

// ═══════════════════════════════════════════════════════════════
// CONSUMER CONFIDENCE OBSERVATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — Consumer Confidence Observation", () => {
  it("actual >= 110 → STRONG", () => {
    const input = makeBase({
      consumerConfidenceObservation: {
        actual: 115,
        previous: 110,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.consumerConfidenceRegime).toBe("STRONG");
  });

  it("actual 90-110 → STABLE", () => {
    const input = makeBase({
      consumerConfidenceObservation: {
        actual: 100,
        previous: 105,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.consumerConfidenceRegime).toBe("STABLE");
  });

  it("actual < 90 → WEAKENING", () => {
    const input = makeBase({
      consumerConfidenceObservation: {
        actual: 85,
        previous: 95,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.consumerConfidenceRegime).toBe("WEAKENING");
  });

  it("no observation → UNAVAILABLE", () => {
    const input = makeBase({});
    const regime = buildFundamentalRegime(input);
    expect(regime.consumerConfidenceRegime).toBe("UNAVAILABLE");
  });

  it("unavailable observation → UNAVAILABLE", () => {
    const input = makeBase({
      consumerConfidenceObservation: {
        availability: "UNAVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.consumerConfidenceRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — LONG/SHORT Symmetry for Growth/Employment", () => {
  it("growth regime is side-independent", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 58,
        pmiPrevious: 55,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    // Same input regardless of LONG/SHORT → same regime
    expect(regime.growthRegime).toBe("EXPANDING");
    expect(regime.employmentRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — Deterministic Output", () => {
  it("identical inputs produce identical output", () => {
    const input = makeBase({
      growthObservation: {
        pmiActual: 52,
        pmiPrevious: 50,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
      employmentObservation: {
        nfpActual: 180,
        nfpPrevious: 200,
        availability: "AVAILABLE",
      },
      consumerConfidenceObservation: {
        actual: 105,
        previous: 108,
        availability: "AVAILABLE",
      },
    });
    const r1 = buildFundamentalRegime(input);
    const r2 = buildFundamentalRegime(input);
    expect(r1.growthRegime).toBe(r2.growthRegime);
    expect(r1.employmentRegime).toBe(r2.employmentRegime);
    expect(r1.consumerConfidenceRegime).toBe(r2.consumerConfidenceRegime);
  });
});

// ═══════════════════════════════════════════════════════════════
// BUILD FUNDAMENTAL INPUT FROM POSITION INTEL
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — buildFundamentalInputFromPositionIntel", () => {
  it("passes through growth observation", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "XAUUSD", assetClass: "GOLD" },
      {
        growthObservation: {
          pmiActual: 55,
          dataPointCount: 1,
          availability: "AVAILABLE",
        },
      },
    );
    expect(input.growthObservation).toBeDefined();
    expect(input.growthObservation?.pmiActual).toBe(55);
  });

  it("passes through employment observation", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "XAUUSD", assetClass: "GOLD" },
      {
        employmentObservation: {
          nfpActual: 250,
          availability: "AVAILABLE",
        },
      },
    );
    expect(input.employmentObservation).toBeDefined();
    expect(input.employmentObservation?.nfpActual).toBe(250);
  });

  it("passes through consumer confidence observation", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "XAUUSD", assetClass: "GOLD" },
      {
        consumerConfidenceObservation: {
          actual: 110,
          availability: "AVAILABLE",
        },
      },
    );
    expect(input.consumerConfidenceObservation).toBeDefined();
    expect(input.consumerConfidenceObservation?.actual).toBe(110);
  });

  it("missing observations remain undefined", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "XAUUSD", assetClass: "GOLD" },
      {},
    );
    expect(input.growthObservation).toBeUndefined();
    expect(input.employmentObservation).toBeUndefined();
    expect(input.consumerConfidenceObservation).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// DATA AVAILABILITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — Data Availability", () => {
  it("all dimensions missing → UNAVAILABLE", () => {
    const input = makeBase({});
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("UNAVAILABLE");
    expect(regime.employmentRegime).toBe("UNAVAILABLE");
    expect(regime.consumerConfidenceRegime).toBe("UNAVAILABLE");
  });

  it("partial data — only growth → growth available, rest UNAVAILABLE", () => {
    const input = makeBase({
      growthObservation: {
        gdpActual: 3.0,
        dataPointCount: 1,
        availability: "AVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("EXPANDING");
    expect(regime.employmentRegime).toBe("UNAVAILABLE");
    expect(regime.consumerConfidenceRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — Safety Invariants", () => {
  it("no BUY/SELL/EXECUTE in output", () => {
    const input = makeBase({
      growthObservation: { pmiActual: 58, dataPointCount: 1, availability: "AVAILABLE" },
      employmentObservation: { nfpActual: 300, availability: "AVAILABLE" },
    });
    const regime = buildFundamentalRegime(input);
    const json = JSON.stringify(regime).toLowerCase();
    expect(json).not.toContain("buy");
    expect(json).not.toContain("sell");
    expect(json).not.toContain("execute");
    expect(json).not.toContain("order");
    expect(json).not.toContain("probability");
    expect(json).not.toContain("guaranteed");
    expect(json).not.toContain("certainty");
  });

  it("no fabricated data in output", () => {
    const input = makeBase({
      growthObservation: {
        gdpActual: 0,
        gdpPrevious: null,
        gdpForecast: null,
        dataPointCount: 0,
        availability: "UNAVAILABLE",
      },
    });
    const regime = buildFundamentalRegime(input);
    expect(regime.growthRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// ASSET MAPPING (existing, verified)
// ═══════════════════════════════════════════════════════════════

describe("Phase 120 — Asset Mapping", () => {
  it("XAUUSD → GOLD", () => expect(mapInstrumentToAssetClass("XAUUSD")).toBe("GOLD"));
  it("BTC/USDT → CRYPTO", () => expect(mapInstrumentToAssetClass("BTC/USDT")).toBe("CRYPTO"));
  it("EUR/USD → FOREX", () => expect(mapInstrumentToAssetClass("EUR/USD")).toBe("FOREX"));
  it("USOIL → OIL", () => expect(mapInstrumentToAssetClass("USOIL")).toBe("OIL"));
});
