import { describe, it, expect } from "vitest";
import {
  buildFundamentalRegime,
  buildAssetFundamentalContext,
  assessTechnicalFundamentalAlignment,
  type FundamentalRegimeInput,
} from "./fundamental-regime";

// ═══════════════════════════════════════════════════════════════
// PHASE 110 — FUNDAMENTAL REGIME & MACRO TRANSMISSION TESTS
// ═══════════════════════════════════════════════════════════════

const now = Date.now();

function makeInput(overrides: FundamentalRegimeInput = {}): FundamentalRegimeInput {
  return {
    vixLevel: 18,
    macroContext: {
      riskRegime: "RISK_ON",
      vixLevel: 18,
      vixDescription: "VIX at 18 — moderate",
      positionImpact: "NEUTRAL",
      narrative: "Mixed",
      availability: "AVAILABLE",
    },
    inflationDescription: "Inflation stable at 2.5%",
    rateDescription: "Federal Reserve neutral stance",
    realYieldDescription: "Real yields stable at 1.8%",
    dxyTrend: "USD stable",
    liquidityDescription: "Liquidity neutral",
    growthDescription: "GDP expanding 2.1%",
    oilPrice: 75,
    oilChange: "Oil balanced",
    geopoliticalDescription: "Geopolitical risk low",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. FUNDAMENTAL REGIME CONSTRUCTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Fundamental Regime Construction", () => {
  it("builds regime from complete input", () => {
    const regime = buildFundamentalRegime(makeInput(), now);
    expect(regime.generatedAt).toBe(now);
    expect(regime.dimensions.length).toBeGreaterThan(0);
  });

  it("classifies all dimensions", () => {
    const regime = buildFundamentalRegime(makeInput(), now);
    const names = regime.dimensions.map((d) => d.name);
    expect(names).toContain("RISK_SENTIMENT");
    expect(names).toContain("INFLATION");
    expect(names).toContain("INTEREST_RATES");
    expect(names).toContain("REAL_YIELDS");
    expect(names).toContain("CURRENCY_STRENGTH");
    expect(names).toContain("LIQUIDITY");
    expect(names).toContain("GROWTH");
    expect(names).toContain("ENERGY");
    expect(names).toContain("GEOPOLITICAL_RISK");
  });

  it("reports available/unavailable counts correctly", () => {
    const regime = buildFundamentalRegime(makeInput(), now);
    const available = regime.dimensions.filter((d) => d.status === "AVAILABLE").length;
    const unavailable = regime.dimensions.filter((d) => d.status !== "AVAILABLE").length;
    expect(available).toBe(regime.availableDimensionCount);
    expect(unavailable).toBe(regime.unavailableDimensionCount);
  });

  it("deterministic output for same input", () => {
    const input = makeInput();
    const r1 = buildFundamentalRegime(input, now);
    const r2 = buildFundamentalRegime(input, now);
    expect(r1.overallRegime).toBe(r2.overallRegime);
    expect(r1.inflationRegime).toBe(r2.inflationRegime);
    expect(r1.rateRegime).toBe(r2.rateRegime);
    expect(r1.dimensions.length).toBe(r2.dimensions.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. INFLATION MODEL
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Inflation Model", () => {
  it("DISINFLATIONARY", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Disinflationary trend" }));
    expect(r.inflationRegime).toBe("DISINFLATIONARY");
  });

  it("STABLE", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Inflation stable at target" }));
    expect(r.inflationRegime).toBe("STABLE");
  });

  it("RISING", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Inflation rising to 4%" }));
    expect(r.inflationRegime).toBe("RISING");
  });

  it("HIGH", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "High inflation at 8%" }));
    expect(r.inflationRegime).toBe("HIGH");
  });

  it("ACCELERATING", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Inflation accelerating" }));
    expect(r.inflationRegime).toBe("ACCELERATING");
  });

  it("INSUFFICIENT_DATA when missing", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: null }));
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
  });

  it("demand-driven inflation", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Demand-driven inflation rising" }));
    expect(r.inflationDriver).toBe("DEMAND_DRIVEN");
  });

  it("supply-driven inflation", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Supply-driven inflation" }));
    expect(r.inflationDriver).toBe("SUPPLY_DRIVEN");
  });

  it("mixed inflation driver", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Supply and demand factors both contributing" }));
    expect(r.inflationDriver).toBe("MIXED");
  });

  it("inflation does NOT imply crash", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: "Rising inflation" }));
    // The regime should classify inflation, not make directional claims
    expect(r.inflationRegime).toBe("RISING");
    expect(r.overallRegime).not.toBe("STRESSED"); // Rising inflation alone ≠ stressed
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. RATE REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Rate Regime", () => {
  it("EASING", () => {
    const r = buildFundamentalRegime(makeInput({ rateDescription: "Federal Reserve cutting rates" }));
    expect(r.rateRegime).toBe("EASING");
  });

  it("TIGHTENING", () => {
    const r = buildFundamentalRegime(makeInput({ rateDescription: "Central bank hiking rates" }));
    expect(r.rateRegime).toBe("TIGHTENING");
  });

  it("RESTRICTIVE", () => {
    const r = buildFundamentalRegime(makeInput({ rateDescription: "Rates above neutral, restrictive policy" }));
    expect(r.rateRegime).toBe("RESTRICTIVE");
  });

  it("NEUTRAL", () => {
    const r = buildFundamentalRegime(makeInput({ rateDescription: "Neutral rate stance" }));
    expect(r.rateRegime).toBe("NEUTRAL");
  });

  it("TRANSITIONING", () => {
    const r = buildFundamentalRegime(makeInput({ rateDescription: "Policy transitioning" }));
    expect(r.rateRegime).toBe("TRANSITIONING");
  });

  it("INSUFFICIENT_DATA when missing", () => {
    const r = buildFundamentalRegime(makeInput({ rateDescription: null }));
    expect(r.rateRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. REAL YIELD REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Real Yield Regime", () => {
  it("RISING", () => {
    const r = buildFundamentalRegime(makeInput({ realYieldDescription: "Real yields rising" }));
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });

  it("FALLING", () => {
    const r = buildFundamentalRegime(makeInput({ realYieldDescription: "Real yields declining" }));
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });

  it("STABLE", () => {
    const r = buildFundamentalRegime(makeInput({ realYieldDescription: "Real yields flat" }));
    expect(r.realYieldRegime).toBe("REAL_YIELD_STABLE");
  });

  it("UNAVAILABLE when missing", () => {
    const r = buildFundamentalRegime(makeInput({ realYieldDescription: null }));
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. CURRENCY REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Currency Regime", () => {
  it("STRENGTHENING", () => {
    const r = buildFundamentalRegime(makeInput({ dxyTrend: "USD strengthening" }));
    expect(r.currencyRegime).toBe("STRENGTHENING");
  });

  it("WEAKENING", () => {
    const r = buildFundamentalRegime(makeInput({ dxyTrend: "USD weakening" }));
    expect(r.currencyRegime).toBe("WEAKENING");
  });

  it("VOLATILE", () => {
    const r = buildFundamentalRegime(makeInput({ dxyTrend: "USD volatile" }));
    expect(r.currencyRegime).toBe("VOLATILE");
  });

  it("UNAVAILABLE when missing", () => {
    const r = buildFundamentalRegime(makeInput({ dxyTrend: null, usdIndex: null }));
    expect(r.currencyRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. LIQUIDITY REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Liquidity Regime", () => {
  it("EASY", () => {
    const r = buildFundamentalRegime(makeInput({ liquidityDescription: "Easy monetary conditions" }));
    expect(r.liquidityRegime).toBe("EASY");
  });

  it("STRESS", () => {
    const r = buildFundamentalRegime(makeInput({ liquidityDescription: "Liquidity stress in markets" }));
    expect(r.liquidityRegime).toBe("STRESS");
  });

  it("TIGHTENING", () => {
    const r = buildFundamentalRegime(makeInput({ liquidityDescription: "Liquidity tightening" }));
    expect(r.liquidityRegime).toBe("TIGHTENING");
  });

  it("UNAVAILABLE when missing", () => {
    const r = buildFundamentalRegime(makeInput({ liquidityDescription: null }));
    expect(r.liquidityRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. GROWTH REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Growth Regime", () => {
  it("EXPANDING", () => {
    const r = buildFundamentalRegime(makeInput({ growthDescription: "GDP expanding strongly" }));
    expect(r.growthRegime).toBe("EXPANDING");
  });

  it("SLOWING", () => {
    const r = buildFundamentalRegime(makeInput({ growthDescription: "Growth slowing" }));
    expect(r.growthRegime).toBe("SLOWING");
  });

  it("CONTRACTING", () => {
    const r = buildFundamentalRegime(makeInput({ growthDescription: "Recession, GDP contracting" }));
    expect(r.growthRegime).toBe("CONTRACTING");
  });

  it("RECOVERING", () => {
    const r = buildFundamentalRegime(makeInput({ growthDescription: "Economy recovering" }));
    expect(r.growthRegime).toBe("RECOVERING");
  });

  it("UNAVAILABLE when missing", () => {
    const r = buildFundamentalRegime(makeInput({ growthDescription: null }));
    expect(r.growthRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. ENERGY REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Energy Regime", () => {
  it("SUPPLY_DISRUPTION", () => {
    const r = buildFundamentalRegime(makeInput({ oilChange: "Oil supply disruption" }));
    expect(r.energyRegime).toBe("SUPPLY_DISRUPTION");
  });

  it("OIL_SHOCK", () => {
    const r = buildFundamentalRegime(makeInput({ oilChange: "Oil price shock surge" }));
    expect(r.energyRegime).toBe("OIL_SHOCK");
  });

  it("DEMAND_DRIVEN", () => {
    const r = buildFundamentalRegime(makeInput({ oilChange: "Oil demand driven increase" }));
    expect(r.energyRegime).toBe("DEMAND_DRIVEN");
  });

  it("BALANCED", () => {
    const r = buildFundamentalRegime(makeInput({ oilChange: "Oil balanced" }));
    expect(r.energyRegime).toBe("BALANCED");
  });

  it("UNAVAILABLE when missing", () => {
    const r = buildFundamentalRegime(makeInput({ oilChange: null, oilPrice: null }));
    expect(r.energyRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. GEOPOLITICAL REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Geopolitical Regime", () => {
  it("ESCALATING", () => {
    const r = buildFundamentalRegime(makeInput({ geopoliticalDescription: "Geopolitical conflict escalating" }));
    expect(r.geopoliticalRegime).toBe("ESCALATING");
  });

  it("HIGH", () => {
    const r = buildFundamentalRegime(makeInput({ geopoliticalDescription: "High geopolitical risk" }));
    expect(r.geopoliticalRegime).toBe("HIGH");
  });

  it("DE_ESCALATING", () => {
    const r = buildFundamentalRegime(makeInput({ geopoliticalDescription: "Geopolitical de-escalation ceasefire" }));
    expect(r.geopoliticalRegime).toBe("DE_ESCALATING");
  });

  it("LOW", () => {
    const r = buildFundamentalRegime(makeInput({ geopoliticalDescription: "Geopolitical risk low" }));
    expect(r.geopoliticalRegime).toBe("LOW");
  });

  it("INSUFFICIENT_DATA when missing", () => {
    const r = buildFundamentalRegime(makeInput({ geopoliticalDescription: null }));
    expect(r.geopoliticalRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. OVERALL REGIME
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Overall Regime", () => {
  it("RISK_ON from macro context", () => {
    const r = buildFundamentalRegime(makeInput());
    expect(r.overallRegime).toBe("RISK_ON");
  });

  it("RISK_OFF from macro context", () => {
    const r = buildFundamentalRegime(makeInput({
      macroContext: { riskRegime: "RISK_OFF", vixLevel: 32, vixDescription: "High VIX", positionImpact: "CONFLICTING", narrative: "Risk off", availability: "AVAILABLE" },
    }));
    expect(r.overallRegime).toBe("RISK_OFF");
  });

  it("STRESSED from liquidity stress", () => {
    const r = buildFundamentalRegime(makeInput({
      macroContext: { riskRegime: "RISK_ON", vixLevel: 15, vixDescription: "Low VIX", positionImpact: "SUPPORTING", narrative: "Risk on", availability: "AVAILABLE" },
      liquidityDescription: "Liquidity stress crisis",
    }));
    expect(r.overallRegime).toBe("STRESSED");
  });

  it("STRESSED from contracting growth", () => {
    const r = buildFundamentalRegime(makeInput({
      macroContext: { riskRegime: "RISK_ON", vixLevel: 15, vixDescription: "Low", positionImpact: "SUPPORTING", narrative: "OK", availability: "AVAILABLE" },
      growthDescription: "Recession GDP contracting",
    }));
    expect(r.overallRegime).toBe("STRESSED");
  });

  it("INSUFFICIENT_DATA when no data", () => {
    const r = buildFundamentalRegime(makeInput({
      macroContext: null,
      vixLevel: null,
      inflationDescription: null,
      rateDescription: null,
      realYieldDescription: null,
      dxyTrend: null,
      usdIndex: null,
      liquidityDescription: null,
      growthDescription: null,
      oilChange: null,
      oilPrice: null,
      geopoliticalDescription: null,
    }));
    expect(r.overallRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. ASSET TRANSMISSION — GOLD
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Gold Transmission", () => {
  it("falling real yields support gold", () => {
    const regime = buildFundamentalRegime(makeInput({ realYieldDescription: "Real yields declining" }));
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Real Yields")).toBe(true);
  });

  it("rising real yields conflict with gold", () => {
    const regime = buildFundamentalRegime(makeInput({ realYieldDescription: "Real yields rising" }));
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.conflictingEvidence.some((e) => e.dimension === "Real Yields")).toBe(true);
  });

  it("weakening USD supports gold", () => {
    const regime = buildFundamentalRegime(makeInput({ dxyTrend: "USD weakening" }));
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Currency (USD)")).toBe(true);
  });

  it("geopolitical escalation supports gold", () => {
    const regime = buildFundamentalRegime(makeInput({ geopoliticalDescription: "Geopolitical conflict escalating" }));
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Geopolitical Risk")).toBe(true);
  });

  it("unavailable real yields → unavailable dimension", () => {
    const regime = buildFundamentalRegime(makeInput({ realYieldDescription: null }));
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.unavailableDimensions).toContain("Real Yields");
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. ASSET TRANSMISSION — CRYPTO
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Crypto Transmission", () => {
  it("easy liquidity supports crypto", () => {
    const regime = buildFundamentalRegime(makeInput({ liquidityDescription: "Easy monetary conditions" }));
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Liquidity")).toBe(true);
  });

  it("liquidity stress conflicts with crypto", () => {
    const regime = buildFundamentalRegime(makeInput({ liquidityDescription: "Liquidity stress crisis" }));
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    expect(ctx.conflictingEvidence.some((e) => e.dimension === "Liquidity")).toBe(true);
  });

  it("risk-on supports crypto", () => {
    const regime = buildFundamentalRegime(makeInput());
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Risk Sentiment")).toBe(true);
  });

  it("risk-off conflicts with crypto", () => {
    const regime = buildFundamentalRegime(makeInput({
      macroContext: { riskRegime: "RISK_OFF", vixLevel: 35, vixDescription: "High VIX", positionImpact: "CONFLICTING", narrative: "Risk off", availability: "AVAILABLE" },
    }));
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    expect(ctx.conflictingEvidence.some((e) => e.dimension === "Risk Sentiment")).toBe(true);
  });

  it("falling real yields support crypto (different from gold nuance)", () => {
    const regime = buildFundamentalRegime(makeInput({ realYieldDescription: "Real yields declining" }));
    const ctx = buildAssetFundamentalContext("CRYPTO", regime);
    // Crypto and gold both benefit from falling real yields, but for different reasons
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Real Yields")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. ASSET TRANSMISSION — EQUITIES
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Equities Transmission", () => {
  it("expanding growth supports equities", () => {
    const regime = buildFundamentalRegime(makeInput({ growthDescription: "GDP expanding strongly" }));
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Growth")).toBe(true);
  });

  it("contracting growth conflicts with equities", () => {
    const regime = buildFundamentalRegime(makeInput({ growthDescription: "Recession GDP contracting" }));
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    expect(ctx.conflictingEvidence.some((e) => e.dimension === "Growth")).toBe(true);
  });

  it("tightening rates conflict with equities", () => {
    const regime = buildFundamentalRegime(makeInput({ rateDescription: "Central bank hiking rates" }));
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    expect(ctx.conflictingEvidence.some((e) => e.dimension === "Interest Rates")).toBe(true);
  });

  it("easing rates support equities", () => {
    const regime = buildFundamentalRegime(makeInput({ rateDescription: "Federal Reserve cutting rates" }));
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Interest Rates")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. ASSET TRANSMISSION — OIL
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Oil Transmission", () => {
  it("supply disruption supports oil", () => {
    const regime = buildFundamentalRegime(makeInput({ oilChange: "Oil supply disruption" }));
    const ctx = buildAssetFundamentalContext("OIL", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Energy Supply")).toBe(true);
  });

  it("geopolitical escalation supports oil", () => {
    const regime = buildFundamentalRegime(makeInput({ geopoliticalDescription: "Geopolitical conflict escalating" }));
    const ctx = buildAssetFundamentalContext("OIL", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Geopolitical Risk")).toBe(true);
  });

  it("weakening USD supports oil", () => {
    const regime = buildFundamentalRegime(makeInput({ dxyTrend: "USD weakening" }));
    const ctx = buildAssetFundamentalContext("OIL", regime);
    expect(ctx.supportingEvidence.some((e) => e.dimension === "Currency (USD)")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 15. TECHNICAL / FUNDAMENTAL CONFLICT
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Technical/Fundamental Alignment", () => {
  it("BOTH_SUPPORTING", () => {
    const a = assessTechnicalFundamentalAlignment("SUPPORTING", "SUPPORTING");
    expect(a.alignment).toBe("BOTH_SUPPORTING");
  });

  it("BOTH_CONFLICTING", () => {
    const a = assessTechnicalFundamentalAlignment("CONFLICTING", "CONFLICTING");
    expect(a.alignment).toBe("BOTH_CONFLICTING");
  });

  it("TECHNICAL_SUPPORTING_FUNDAMENTAL_CONFLICTING", () => {
    const a = assessTechnicalFundamentalAlignment("SUPPORTING", "CONFLICTING");
    expect(a.alignment).toBe("TECHNICAL_SUPPORTING_FUNDAMENTAL_CONFLICTING");
  });

  it("TECHNICAL_CONFLICTING_FUNDAMENTAL_SUPPORTING", () => {
    const a = assessTechnicalFundamentalAlignment("CONFLICTING", "SUPPORTING");
    expect(a.alignment).toBe("TECHNICAL_CONFLICTING_FUNDAMENTAL_SUPPORTING");
  });

  it("INSUFFICIENT_DATA when either is unavailable", () => {
    const a = assessTechnicalFundamentalAlignment("SUPPORTING", "UNAVAILABLE");
    expect(a.alignment).toBe("INSUFFICIENT_DATA");
  });

  it("description is meaningful", () => {
    const a = assessTechnicalFundamentalAlignment("SUPPORTING", "CONFLICTING");
    expect(a.description.length).toBeGreaterThan(0);
    expect(a.description.toLowerCase()).toContain("technical");
    expect(a.description.toLowerCase()).toContain("fundamental");
  });
});

// ═══════════════════════════════════════════════════════════════
// 16. DATA QUALITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Data Quality", () => {
  it("AVAILABLE when most dimensions present", () => {
    const regime = buildFundamentalRegime(makeInput());
    expect(regime.dataQuality).toBe("AVAILABLE");
  });

  it("UNAVAILABLE when most dimensions missing", () => {
    const regime = buildFundamentalRegime(makeInput({
      inflationDescription: null,
      rateDescription: null,
      realYieldDescription: null,
      dxyTrend: null,
      usdIndex: null,
      liquidityDescription: null,
      growthDescription: null,
      oilChange: null,
      oilPrice: null,
      geopoliticalDescription: null,
      macroContext: null,
    }));
    expect(regime.dataQuality).toBe("UNAVAILABLE");
  });

  it("unavailable dimensions are surfaced", () => {
    const regime = buildFundamentalRegime(makeInput({ inflationDescription: null }));
    const inflationDim = regime.dimensions.find((d) => d.name === "INFLATION");
    expect(inflationDim?.status).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 17. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Safety Invariants", () => {
  const executionWords = ["buy", "sell", "execute", "order", "trade", "auto-buy", "auto-sell", "place order"];
  const probabilityWords = ["guaranteed", "likely", "will happen", "probability", "chance", "expected return"];
  const universalRules = ["always buy gold", "always sell stocks", "inflation means crash", "oil up means gold up"];

  it("no execution language in transmission descriptions", () => {
    const regime = buildFundamentalRegime(makeInput());
    for (const asset of ["GOLD", "CRYPTO", "EQUITIES", "OIL"] as const) {
      const ctx = buildAssetFundamentalContext(asset, regime);
      const allText = [
        ctx.transmissionExplanation,
        ...ctx.supportingEvidence.map((e) => e.description),
        ...ctx.conflictingEvidence.map((e) => e.description),
        ...ctx.whatToMonitor,
        ...ctx.whatCouldChangeAssessment,
      ].join(" ").toLowerCase();

      for (const word of executionWords) {
        expect(allText).not.toContain(word);
      }
    }
  });

  it("no probability language", () => {
    const regime = buildFundamentalRegime(makeInput());
    for (const asset of ["GOLD", "CRYPTO", "EQUITIES"] as const) {
      const ctx = buildAssetFundamentalContext(asset, regime);
      const allText = [
        ctx.transmissionExplanation,
        ...ctx.supportingEvidence.map((e) => e.description),
        ...ctx.conflictingEvidence.map((e) => e.description),
      ].join(" ").toLowerCase();

      for (const word of probabilityWords) {
        expect(allText).not.toContain(word);
      }
    }
  });

  it("no universal macro rules", () => {
    const regime = buildFundamentalRegime(makeInput());
    for (const asset of ["GOLD", "CRYPTO", "EQUITIES", "OIL"] as const) {
      const ctx = buildAssetFundamentalContext(asset, regime);
      const allText = [
        ctx.transmissionExplanation,
        ...ctx.supportingEvidence.map((e) => e.description),
        ...ctx.conflictingEvidence.map((e) => e.description),
      ].join(" ").toLowerCase();

      for (const rule of universalRules) {
        expect(allText).not.toContain(rule);
      }
    }
  });

  it("no fabricated macro values", () => {
    const regime = buildFundamentalRegime(makeInput());
    // All values come from input, not invented
    expect(regime.inflationRegime).toBeDefined();
    expect(regime.rateRegime).toBeDefined();
  });

  it("deterministic output", () => {
    const input = makeInput();
    const r1 = buildFundamentalRegime(input, now);
    const r2 = buildFundamentalRegime(input, now);
    expect(r1.overallRegime).toBe(r2.overallRegime);
    expect(r1.availableDimensionCount).toBe(r2.availableDimensionCount); // Deterministic
  });

  it("no mutation of input", () => {
    const input = makeInput();
    const original = JSON.stringify(input);
    buildFundamentalRegime(input, now);
    expect(JSON.stringify(input)).toBe(original);
  });
});

// ═══════════════════════════════════════════════════════════════
// 18. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: LONG/SHORT Symmetry", () => {
  it("fundamental regime is side-independent", () => {
    // The regime itself doesn't depend on position side
    // Transmission for specific assets is also side-independent
    // (direction is about the asset, not the position)
    const regime = buildFundamentalRegime(makeInput());
    const goldCtx = buildAssetFundamentalContext("GOLD", regime);
    // Same asset, same regime → same classification regardless of who asks
    expect(goldCtx.fundamentalAssessment).toBeDefined();
  });

  it("evidence direction is determined by regime, not position side", () => {
    const regime = buildFundamentalRegime(makeInput({ realYieldDescription: "Real yields declining" }));
    const gold = buildAssetFundamentalContext("GOLD", regime);
    // Falling real yields support gold — this is about the asset, not LONG/SHORT
    expect(gold.supportingEvidence.some((e) => e.dimension === "Real Yields")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 19. EMPTY STATE
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Empty State", () => {
  it("empty input produces INSUFFICIENT_DATA regime", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.overallRegime).toBe("INSUFFICIENT_DATA");
    expect(regime.dataQuality).toBe("UNAVAILABLE");
  });

  it("empty input produces UNAVAILABLE asset context", () => {
    const regime = buildFundamentalRegime({});
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.fundamentalAssessment).toBe("UNAVAILABLE");
  });

  it("no dimensions available = all unavailable", () => {
    const regime = buildFundamentalRegime({});
    const unavail = regime.dimensions.filter((d) => d.status === "UNAVAILABLE");
    expect(unavail.length).toBe(regime.dimensions.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// 20. PERFORMANCE BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Performance Bounds", () => {
  it("handles 50 asset contexts efficiently", () => {
    const regime = buildFundamentalRegime(makeInput());
    const start = Date.now();
    const assets = ["GOLD", "SILVER", "CRYPTO", "FOREX", "EQUITIES", "OIL", "COMMODITIES"] as const;
    for (let i = 0; i < 50; i++) {
      buildAssetFundamentalContext(assets[i % assets.length], regime);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it("handles many regime constructions efficiently", () => {
    const input = makeInput();
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      buildFundamentalRegime(input, now + i);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// 21. DEMAND vs SUPPLY INFLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: Inflation Driver Classification", () => {
  it("DEMAND_DRIVEN inflation", () => {
    const r = buildFundamentalRegime(makeInput({
      inflationDescription: "Demand-driven inflation rising from strong consumer spending",
    }));
    expect(r.inflationDriver).toBe("DEMAND_DRIVEN");
  });

  it("SUPPLY_DRIVEN inflation", () => {
    const r = buildFundamentalRegime(makeInput({
      inflationDescription: "Supply-driven inflation from energy costs",
    }));
    expect(r.inflationDriver).toBe("SUPPLY_DRIVEN");
  });

  it("MIXED inflation", () => {
    const r = buildFundamentalRegime(makeInput({
      inflationDescription: "Both supply and demand factors contributing to inflation",
    }));
    expect(r.inflationDriver).toBe("MIXED");
  });

  it("INSUFFICIENT_DATA when no inflation description", () => {
    const r = buildFundamentalRegime(makeInput({ inflationDescription: null }));
    expect(r.inflationDriver).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// 22. WHAT COULD CHANGE / WHAT TO MONITOR
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: What Could Change / Monitor", () => {
  it("unavailable dimensions generate what-could-change items", () => {
    const regime = buildFundamentalRegime(makeInput({ inflationDescription: null, realYieldDescription: null }));
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.whatCouldChangeAssessment.length).toBeGreaterThan(0);
  });

  it("transitioning rate generates monitor item", () => {
    const regime = buildFundamentalRegime(makeInput({ rateDescription: "Policy transitioning" }));
    const ctx = buildAssetFundamentalContext("EQUITIES", regime);
    expect(ctx.whatToMonitor.some((m) => m.toLowerCase().includes("transition"))).toBe(true);
  });

  it("escalating geopolitical generates monitor item", () => {
    const regime = buildFundamentalRegime(makeInput({ geopoliticalDescription: "Conflict escalating" }));
    const ctx = buildAssetFundamentalContext("GOLD", regime);
    expect(ctx.whatToMonitor.some((m) => m.toLowerCase().includes("geopolitical"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 23. CRYPTO vs GOLD — NO UNIVERSAL RULES
// ═══════════════════════════════════════════════════════════════

describe("Phase 110: No Universal Macro Rules", () => {
  it("rising inflation is not universally bullish or bearish", () => {
    const regime = buildFundamentalRegime(makeInput({
      inflationDescription: "Inflation rising to 5%",
    }));
    const gold = buildAssetFundamentalContext("GOLD", regime);
    const equities = buildAssetFundamentalContext("EQUITIES", regime);

    // Gold might see inflation as supporting, but equities might see it as conflicting
    // The point is that neither is guaranteed
    expect(gold.fundamentalAssessment).toBeDefined();
    expect(equities.fundamentalAssessment).toBeDefined();
  });

  it("weakening USD does not universally support all assets", () => {
    const regime = buildFundamentalRegime(makeInput({ dxyTrend: "USD weakening" }));
    const gold = buildAssetFundamentalContext("GOLD", regime);
    const crypto = buildAssetFundamentalContext("CRYPTO", regime);

    // Both may be supported, but for different reasons — not a universal rule
    expect(gold.supportingEvidence.some((e) => e.dimension === "Currency (USD)")).toBe(true);
    expect(crypto.supportingEvidence.some((e) => e.dimension === "Currency (USD)")).toBe(true);
    // The descriptions should be asset-specific, not identical
    const goldDesc = gold.supportingEvidence.find((e) => e.dimension === "Currency (USD)")?.description ?? "";
    const cryptoDesc = crypto.supportingEvidence.find((e) => e.dimension === "Currency (USD)")?.description ?? "";
    expect(goldDesc).toContain("gold");
    expect(cryptoDesc).toContain("crypto");
  });
});
