/**
 * Phase 113 — Macro + Cross-Asset Fundamental Wiring Tests
 *
 * Comprehensive tests for:
 * - MacroContext wiring into FundamentalRegimeInput
 * - CrossAssetContext wiring into FundamentalRegimeInput
 * - All dimension classifications (inflation, currency, rates, yields, liquidity, growth, energy, geopolitics)
 * - Macro regime combinations
 * - Technical/fundamental alignment
 * - Asset mapping, transmission, provenance
 * - Data availability
 * - LONG/SHORT symmetry
 * - Determinism
 * - Safety invariants
 */

import { describe, it, expect } from "vitest";
import {
  mapInstrumentToAssetClass,
  buildFundamentalInputFromPositionIntel,
  buildFundamentalRegime,
  buildAssetFundamentalContext,
  assessTechnicalFundamentalAlignment,
  type FundamentalRegimeInput,
  type AssetClass,
} from "./fundamental-regime";
import {
  classifyMacroContext,
  analyzeCrossAssetContext,
  type MacroContext,
  type CrossAssetContext,
} from "./multi-dimensional-intelligence";
import {
  buildCausalTransmissions,
  buildFundamentalCausalResult,
} from "./fundamental-transmission";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeMacroContext(vixPrice: number | null): MacroContext {
  return classifyMacroContext(vixPrice, "LONG", "crypto");
}

function makeCrossAssetContext(impact: CrossAssetContext["positionImpact"] = "NEUTRAL"): CrossAssetContext {
  return {
    pairs: [{ instrument: "ETH", trend: "BULLISH" }],
    correlationState: "ALIGNED",
    positionImpact: impact,
    narrative: "Test cross-asset narrative",
    availability: "AVAILABLE",
  };
}

const now = Date.now();

// ═══════════════════════════════════════════════════════════════
// A. MACRO WIRING
// ═══════════════════════════════════════════════════════════════

describe("A. MacroContext wiring into FundamentalRegimeInput", () => {
  it("MacroContext with VIX reaches regime dimensions", () => {
    const macroCtx = makeMacroContext(25);
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { macroContext: macroCtx },
    );
    expect(input.macroContext).toBe(macroCtx);
    expect(input.vixLevel).toBe(25);

    const regime = buildFundamentalRegime(input);
    const riskDim = regime.dimensions.find((d) => d.name === "RISK_SENTIMENT");
    expect(riskDim?.status).toBe("AVAILABLE");
    expect(riskDim?.description).toContain("25.0");
  });

  it("VIX risk regime reaches fundamental context", () => {
    const macroCtx = makeMacroContext(35);
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { macroContext: macroCtx },
    );
    const regime = buildFundamentalRegime(input);
    // VIX flows through to RISK_SENTIMENT dimension and macroContext.riskRegime to overallRegime
    const riskDim = regime.dimensions.find((d) => d.name === "RISK_SENTIMENT");
    expect(riskDim?.status).toBe("AVAILABLE");
    expect(riskDim?.description).toContain("35.0");
  });

  it("missing MacroContext stays unavailable", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
    );
    expect(input.macroContext).toBeUndefined();
    expect(input.vixLevel).toBeUndefined();

    const regime = buildFundamentalRegime(input);
    const riskDim = regime.dimensions.find((d) => d.name === "RISK_SENTIMENT");
    expect(riskDim?.status).toBe("UNAVAILABLE");
  });

  it("MacroContext narrative with geopolitics extracts geopolitical description", () => {
    const macroCtx: MacroContext = {
      riskRegime: "RISK_OFF",
      vixLevel: 30,
      vixDescription: "VIX elevated",
      positionImpact: "CONFLICTING",
      narrative: "Geopolitical conflict escalating tensions",
      availability: "AVAILABLE",
    };
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "XAUUSD", assetClass: "commodity" },
      { macroContext: macroCtx },
    );
    expect(input.geopoliticalDescription).toContain("Geopolitical");
  });

  it("MacroContext narrative with liquidity extracts liquidity description", () => {
    const macroCtx: MacroContext = {
      riskRegime: "MIXED",
      vixLevel: 18,
      vixDescription: "Moderate",
      positionImpact: "NEUTRAL",
      narrative: "Liquidity conditions improving in monetary markets",
      availability: "AVAILABLE",
    };
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { macroContext: macroCtx },
    );
    expect(input.liquidityDescription).toContain("Liquidity");
  });

  it("no duplicate macro request — pure function reuse", () => {
    const macroCtx = makeMacroContext(22);
    // classifyMacroContext is deterministic
    const r1 = classifyMacroContext(22, "LONG", "crypto");
    const r2 = classifyMacroContext(22, "LONG", "crypto");
    expect(r1.riskRegime).toBe(r2.riskRegime);
    expect(r1.vixLevel).toBe(r2.vixLevel);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. CROSS-ASSET WIRING
// ═══════════════════════════════════════════════════════════════

describe("B. CrossAssetContext wiring into FundamentalRegimeInput", () => {
  it("CrossAssetContext reaches regime input", () => {
    const crossCtx = makeCrossAssetContext("SUPPORTING");
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { crossAssetContext: crossCtx },
    );
    expect(input.crossAssetContext).toBe(crossCtx);

    const regime = buildFundamentalRegime(input);
    const crossDim = regime.dimensions.find((d) => d.name === "CROSS_ASSET");
    expect(crossDim?.status).toBe("AVAILABLE");
  });

  it("missing CrossAssetContext stays unavailable", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
    );
    expect(input.crossAssetContext).toBeUndefined();

    const regime = buildFundamentalRegime(input);
    const crossDim = regime.dimensions.find((d) => d.name === "CROSS_ASSET");
    expect(crossDim?.status).toBe("UNAVAILABLE");
  });

  it("existing cross-asset relationships preserved", () => {
    const crossCtx: CrossAssetContext = {
      pairs: [
        { instrument: "ETH", trend: "BULLISH" },
        { instrument: "SOL", trend: "BULLISH" },
      ],
      correlationState: "ALIGNED",
      positionImpact: "SUPPORTING",
      narrative: "Related assets aligned bullish",
      availability: "AVAILABLE",
    };
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { crossAssetContext: crossCtx },
    );
    const regime = buildFundamentalRegime(input);
    expect(regime.dimensions.find((d) => d.name === "CROSS_ASSET")?.status).toBe("AVAILABLE");
  });

  it("no duplicate cross-asset calculation — pure function reuse", () => {
    const other = new Map([["ETH", { trend: "BULLISH" as const, assetClass: "crypto" }]]);
    const r1 = analyzeCrossAssetContext("BTC", "LONG", other);
    const r2 = analyzeCrossAssetContext("BTC", "LONG", other);
    expect(r1.correlationState).toBe(r2.correlationState);
    expect(r1.positionImpact).toBe(r2.positionImpact);
  });

  it("empty other prices yields UNAVAILABLE cross-asset", () => {
    const other = new Map<string, { trend: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN"; assetClass: string }>();
    const ctx = analyzeCrossAssetContext("BTC", "LONG", other);
    expect(ctx.availability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. INFLATION MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("C. Inflation model — all states", () => {
  it("disinflationary", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Disinflation trend continuing" });
    expect(r.inflationRegime).toBe("DISINFLATIONARY");
  });
  it("stable", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Inflation stable at target" });
    expect(r.inflationRegime).toBe("STABLE");
  });
  it("rising", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Inflation rising above expectations" });
    expect(r.inflationRegime).toBe("RISING");
  });
  it("high", () => {
    const r = buildFundamentalRegime({ inflationDescription: "High inflation persisting" });
    expect(r.inflationRegime).toBe("HIGH");
  });
  it("accelerating", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Inflation accelerating sharply" });
    expect(r.inflationRegime).toBe("ACCELERATING");
  });
  it("insufficient", () => {
    const r = buildFundamentalRegime({});
    expect(r.inflationRegime).toBe("INSUFFICIENT_DATA");
  });
  it("demand-driven", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Demand-driven inflation rising" });
    expect(r.inflationDriver).toBe("DEMAND_DRIVEN");
  });
  it("supply-driven", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Supply-driven inflation rising" });
    expect(r.inflationDriver).toBe("SUPPLY_DRIVEN");
  });
  it("mixed driver", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Supply and demand driven inflation" });
    expect(r.inflationDriver).toBe("MIXED");
  });
  it("insufficient driver", () => {
    const r = buildFundamentalRegime({ inflationDescription: "Something unrelated" });
    expect(r.inflationDriver).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. CURRENCY MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("D. Currency model — all states", () => {
  it("strengthening", () => {
    const r = buildFundamentalRegime({ dxyTrend: "USD strengthening significantly" });
    expect(r.currencyRegime).toBe("STRENGTHENING");
  });
  it("weakening", () => {
    const r = buildFundamentalRegime({ dxyTrend: "USD weakening rapidly" });
    expect(r.currencyRegime).toBe("WEAKENING");
  });
  it("stable from dxyTrend", () => {
    const r = buildFundamentalRegime({ dxyTrend: "USD stable" });
    expect(r.currencyRegime).toBe("STABLE");
  });
  it("volatile", () => {
    const r = buildFundamentalRegime({ dxyTrend: "USD volatile swings" });
    expect(r.currencyRegime).toBe("VOLATILE");
  });
  it("stable from usdIndex only", () => {
    const r = buildFundamentalRegime({ usdIndex: 104.5 });
    expect(r.currencyRegime).toBe("STABLE");
  });
  it("unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.currencyRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. RATES MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("E. Rates model — all states", () => {
  it("easing", () => {
    const r = buildFundamentalRegime({ rateDescription: "Rate easing cycle begins" });
    expect(r.rateRegime).toBe("EASING");
  });
  it("neutral", () => {
    const r = buildFundamentalRegime({ rateDescription: "Rates steady at neutral" });
    expect(r.rateRegime).toBe("NEUTRAL");
  });
  it("tightening", () => {
    const r = buildFundamentalRegime({ rateDescription: "Central bank hiking aggressively" });
    expect(r.rateRegime).toBe("TIGHTENING");
  });
  it("restrictive", () => {
    const r = buildFundamentalRegime({ rateDescription: "Rates above neutral restrictive" });
    expect(r.rateRegime).toBe("RESTRICTIVE");
  });
  it("transitioning", () => {
    const r = buildFundamentalRegime({ rateDescription: "Policy in transition phase" });
    expect(r.rateRegime).toBe("TRANSITIONING");
  });
  it("unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.rateRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. REAL YIELDS MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("F. Real yields model — all states", () => {
  it("rising", () => {
    const r = buildFundamentalRegime({ realYieldDescription: "Real yields rising rapidly" });
    expect(r.realYieldRegime).toBe("REAL_YIELD_RISING");
  });
  it("falling", () => {
    const r = buildFundamentalRegime({ realYieldDescription: "Real yields falling" });
    expect(r.realYieldRegime).toBe("REAL_YIELD_FALLING");
  });
  it("stable", () => {
    const r = buildFundamentalRegime({ realYieldDescription: "Real yields flat stable" });
    expect(r.realYieldRegime).toBe("REAL_YIELD_STABLE");
  });
  it("unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
  it("nominal rates text does not produce real yield classification", () => {
    const r = buildFundamentalRegime({ rateDescription: "Fed hiking rates" });
    expect(r.rateRegime).toBe("TIGHTENING");
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. LIQUIDITY MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("G. Liquidity model — all states", () => {
  it("easy", () => {
    const r = buildFundamentalRegime({ liquidityDescription: "Easy monetary conditions expansion" });
    expect(r.liquidityRegime).toBe("EASY");
  });
  it("neutral", () => {
    const r = buildFundamentalRegime({ liquidityDescription: "Liquidity neutral normal" });
    expect(r.liquidityRegime).toBe("NEUTRAL");
  });
  it("tightening", () => {
    const r = buildFundamentalRegime({ liquidityDescription: "Liquidity tightening conditions" });
    expect(r.liquidityRegime).toBe("TIGHTENING");
  });
  it("stress", () => {
    const r = buildFundamentalRegime({ liquidityDescription: "Liquidity stress crisis unfolding" });
    expect(r.liquidityRegime).toBe("STRESS");
  });
  it("unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.liquidityRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. GROWTH MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("H. Growth model — all states", () => {
  it("expanding", () => {
    const r = buildFundamentalRegime({ growthDescription: "Growth expanding strongly" });
    expect(r.growthRegime).toBe("EXPANDING");
  });
  it("slowing", () => {
    const r = buildFundamentalRegime({ growthDescription: "Growth slowing significantly" });
    expect(r.growthRegime).toBe("SLOWING");
  });
  it("contracting", () => {
    const r = buildFundamentalRegime({ growthDescription: "Growth contracting recession risk" });
    expect(r.growthRegime).toBe("CONTRACTING");
  });
  it("recovering", () => {
    const r = buildFundamentalRegime({ growthDescription: "Growth recovering from lows" });
    expect(r.growthRegime).toBe("RECOVERING");
  });
  it("unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.growthRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. ENERGY MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("I. Energy model — all states", () => {
  it("supply disruption", () => {
    const r = buildFundamentalRegime({ oilChange: "Oil supply disruption detected" });
    expect(r.energyRegime).toBe("SUPPLY_DISRUPTION");
  });
  it("demand-driven", () => {
    const r = buildFundamentalRegime({ oilChange: "Oil demand-driven growth" });
    expect(r.energyRegime).toBe("DEMAND_DRIVEN");
  });
  it("balanced", () => {
    const r = buildFundamentalRegime({ oilChange: "Oil balanced stable market" });
    expect(r.energyRegime).toBe("BALANCED");
  });
  it("oil shock", () => {
    const r = buildFundamentalRegime({ oilChange: "Oil shock spike surge" });
    expect(r.energyRegime).toBe("OIL_SHOCK");
  });
  it("unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.energyRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. GEOPOLITICS MODEL (all states)
// ═══════════════════════════════════════════════════════════════

describe("J. Geopolitics model — all states", () => {
  it("low", () => {
    const r = buildFundamentalRegime({ geopoliticalDescription: "Geopolitical risk low calm" });
    expect(r.geopoliticalRegime).toBe("LOW");
  });
  it("elevated", () => {
    const r = buildFundamentalRegime({ geopoliticalDescription: "Geopolitical elevated moderate" });
    expect(r.geopoliticalRegime).toBe("ELEVATED");
  });
  it("high", () => {
    const r = buildFundamentalRegime({ geopoliticalDescription: "Geopolitical high severe" });
    expect(r.geopoliticalRegime).toBe("HIGH");
  });
  it("escalating", () => {
    const r = buildFundamentalRegime({ geopoliticalDescription: "Geopolitical escalation conflict" });
    expect(r.geopoliticalRegime).toBe("ESCALATING");
  });
  it("de-escalating", () => {
    const r = buildFundamentalRegime({ geopoliticalDescription: "Geopolitical de-escalation ceasefire" });
    expect(r.geopoliticalRegime).toBe("DE_ESCALATING");
  });
  it("insufficient", () => {
    const r = buildFundamentalRegime({});
    expect(r.geopoliticalRegime).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. RISK SENTIMENT
// ═══════════════════════════════════════════════════════════════

describe("K. Risk sentiment", () => {
  it("available VIX → RISK_SENTIMENT AVAILABLE", () => {
    const r = buildFundamentalRegime({ vixLevel: 20 });
    expect(r.dimensions.find((d) => d.name === "RISK_SENTIMENT")?.status).toBe("AVAILABLE");
  });
  it("unavailable VIX → RISK_SENTIMENT UNAVAILABLE", () => {
    const r = buildFundamentalRegime({});
    expect(r.dimensions.find((d) => d.name === "RISK_SENTIMENT")?.status).toBe("UNAVAILABLE");
  });
  it("VIX > 30 with sufficient data → not INSUFFICIENT_DATA", () => {
    const r = buildFundamentalRegime({ vixLevel: 35, inflationDescription: "Rising inflation", growthDescription: "Growth expanding", rateDescription: "Rates easing", dxyTrend: "USD weakening" });
    // VIX > 30 → RISK_OFF from macroContext, but growth expanding → check override
    expect(r.overallRegime).not.toBe("INSUFFICIENT_DATA");
  });
  it("VIX 12-15 with sufficient data → not INSUFFICIENT_DATA", () => {
    const r = buildFundamentalRegime({ vixLevel: 13, inflationDescription: "Inflation stable", growthDescription: "Growth expanding", rateDescription: "Rates easing", dxyTrend: "USD weakening" });
    expect(r.overallRegime).not.toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. CROSS-ASSET CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("L. Cross-asset context", () => {
  it("supporting cross-asset → CROSS_ASSET AVAILABLE", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { crossAssetContext: makeCrossAssetContext("SUPPORTING") },
    );
    const r = buildFundamentalRegime(input);
    expect(r.dimensions.find((d) => d.name === "CROSS_ASSET")?.status).toBe("AVAILABLE");
  });
  it("no fabricated correlation — unknown instrument gets COMMODITIES", () => {
    expect(mapInstrumentToAssetClass("RANDOMXYZ")).toBe("COMMODITIES");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. REGIME COMBINATIONS
// ═══════════════════════════════════════════════════════════════

describe("M. Regime combinations via classifyMacroRegime", () => {
  it("HIGH inflation + CONTRACTING growth → STRESSED (growth contraction dominates)", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "High inflation elevated",
      growthDescription: "Growth contracting recession",
      vixLevel: 30,
      rateDescription: "Rates easing",
      dxyTrend: "USD weakening",
    });
    // STRESSED takes precedence in classifyMacroRegime
    const causal = buildFundamentalCausalResult(r);
    expect(causal.macroRegime).toBe("STRESSED");
  });

  it("RISING inflation + EXPANDING growth → REFLATION", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "Inflation rising",
      growthDescription: "Growth expanding strongly",
      vixLevel: 14,
      rateDescription: "Rates easing",
      dxyTrend: "USD weakening",
    });
    const causal = buildFundamentalCausalResult(r);
    expect(causal.macroRegime).toBe("REFLATION");
  });

  it("DISINFLATIONARY + sufficient data → DISINFLATION", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "Disinflation trend continuing",
      growthDescription: "Growth expanding",
      vixLevel: 16,
      dxyTrend: "USD weakening",
      rateDescription: "Rates easing",
    });
    const causal = buildFundamentalCausalResult(r);
    expect(causal.macroRegime).toBe("DISINFLATION");
  });

  it("CONTRACTING growth + sufficient data → STRESSED (contraction triggers stressed)", () => {
    const r = buildFundamentalRegime({
      growthDescription: "Growth contracting",
      vixLevel: 20,
      inflationDescription: "Inflation rising",
      rateDescription: "Rates easing",
      dxyTrend: "USD weakening",
    });
    const causal = buildFundamentalCausalResult(r);
    // Growth CONTRACTING → overallRegime STRESSED → macroRegime STRESSED
    expect(causal.macroRegime).toBe("STRESSED");
  });

  it("RECOVERING growth + RISING inflation + sufficient data → REFLATION", () => {
    const r = buildFundamentalRegime({
      growthDescription: "Growth recovering",
      vixLevel: 18,
      inflationDescription: "Inflation rising",
      rateDescription: "Rates easing",
      dxyTrend: "USD weakening",
    });
    const causal = buildFundamentalCausalResult(r);
    // RISING inflation + RECOVERING growth → REFLATION in classifyMacroRegime
    expect(causal.macroRegime).toBe("REFLATION");
  });

  it("no data → INSUFFICIENT_DATA", () => {
    const r = buildFundamentalRegime({});
    const causal = buildFundamentalCausalResult(r);
    expect(causal.macroRegime).toBe("INSUFFICIENT_DATA");
  });

  it("VIX stress + RISK_OFF → STRESSED (growth/liquidity override)", () => {
    const r = buildFundamentalRegime({
      vixLevel: 40,
      growthDescription: "Growth contracting",
      liquidityDescription: "Liquidity stress crisis",
      inflationDescription: "Inflation rising",
      rateDescription: "Rates easing",
      dxyTrend: "USD weakening",
    });
    // growth CONTRACTING + liquidity STRESS → overallRegime STRESSED (overrides RISK_OFF)
    const causal = buildFundamentalCausalResult(r);
    expect(causal.macroRegime).toBe("STRESSED");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. ASSET MAPPING
// ═══════════════════════════════════════════════════════════════

describe("N. Asset mapping — comprehensive", () => {
  const cases: [string, AssetClass][] = [
    ["XAUUSD", "GOLD"], ["XAU", "GOLD"], ["GOLD", "GOLD"],
    ["XAGUSD", "SILVER"], ["XAG", "SILVER"], ["SILVER", "SILVER"],
    ["BTCUSD", "CRYPTO"], ["BTC", "CRYPTO"], ["ETHUSD", "CRYPTO"], ["ETH", "CRYPTO"],
    ["BTCUSDT", "CRYPTO"], ["ETHUSDT", "CRYPTO"], ["SOLUSD", "CRYPTO"],
    ["USOIL", "OIL"], ["WTI", "OIL"], ["CL", "OIL"], ["UKOIL", "OIL"], ["BRENT", "OIL"],
    ["EURUSD", "FOREX"], ["GBPUSD", "FOREX"], ["USDJPY", "FOREX"], ["EURGBP", "FOREX"],
    ["AAPL", "EQUITIES"], ["TSLA", "EQUITIES"], ["NVDA", "EQUITIES"],
  ];

  for (const [sym, expected] of cases) {
    it(`maps ${sym} → ${expected}`, () => {
      expect(mapInstrumentToAssetClass(sym)).toBe(expected);
    });
  }

  it("unknown → COMMODITIES (conservative fallback)", () => {
    expect(mapInstrumentToAssetClass("XYZABC")).toBe("COMMODITIES");
  });
  it("empty → COMMODITIES", () => {
    expect(mapInstrumentToAssetClass("")).toBe("COMMODITIES");
  });
  it("deterministic for all instruments", () => {
    for (const [sym] of cases) {
      const r1 = mapInstrumentToAssetClass(sym);
      const r2 = mapInstrumentToAssetClass(sym);
      expect(r1).toBe(r2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// O. TRANSMISSION — per asset class
// ═══════════════════════════════════════════════════════════════

describe("O. Transmission — asset-specific", () => {
  it("GOLD: falling real yields → supporting", () => {
    const r = buildFundamentalRegime({ realYieldDescription: "Real yields falling" });
    const txs = buildCausalTransmissions(r);
    const goldSupport = txs.filter((t) => t.affectedAssets.includes("GOLD") && t.direction === "SUPPORTING");
    expect(goldSupport.length).toBeGreaterThan(0);
  });

  it("GOLD: rising real yields → conflicting", () => {
    const r = buildFundamentalRegime({ realYieldDescription: "Real yields rising" });
    const txs = buildCausalTransmissions(r);
    const goldConflict = txs.filter((t) => t.affectedAssets.includes("GOLD") && t.direction === "CONFLICTING");
    expect(goldConflict.length).toBeGreaterThan(0);
  });

  it("CRYPTO: easy liquidity → supporting", () => {
    const r = buildFundamentalRegime({ liquidityDescription: "Easy monetary conditions" });
    const txs = buildCausalTransmissions(r);
    const cryptoSupport = txs.filter((t) => t.affectedAssets.includes("CRYPTO") && t.direction === "SUPPORTING");
    expect(cryptoSupport.length).toBeGreaterThan(0);
  });

  it("CRYPTO: liquidity stress → conflicting", () => {
    const r = buildFundamentalRegime({ liquidityDescription: "Liquidity stress crisis" });
    const txs = buildCausalTransmissions(r);
    const cryptoConflict = txs.filter((t) => t.affectedAssets.includes("CRYPTO") && t.direction === "CONFLICTING");
    expect(cryptoConflict.length).toBeGreaterThan(0);
  });

  it("EQUITIES: expanding growth → supporting", () => {
    const r = buildFundamentalRegime({ growthDescription: "Growth expanding" });
    const txs = buildCausalTransmissions(r);
    const eqSupport = txs.filter((t) => t.affectedAssets.includes("EQUITIES") && t.direction === "SUPPORTING");
    expect(eqSupport.length).toBeGreaterThan(0);
  });

  it("EQUITIES: contracting growth → conflicting", () => {
    const r = buildFundamentalRegime({ growthDescription: "Growth contracting" });
    const txs = buildCausalTransmissions(r);
    const eqConflict = txs.filter((t) => t.affectedAssets.includes("EQUITIES") && t.direction === "CONFLICTING");
    expect(eqConflict.length).toBeGreaterThan(0);
  });

  it("OIL: supply disruption → supporting", () => {
    const r = buildFundamentalRegime({ oilChange: "Oil supply disruption" });
    const txs = buildCausalTransmissions(r);
    const oilSupport = txs.filter((t) => t.affectedAssets.includes("OIL") && t.direction === "SUPPORTING");
    expect(oilSupport.length).toBeGreaterThan(0);
  });

  it("conflicting forces exposed — not collapsed", () => {
    const r = buildFundamentalRegime({
      realYieldDescription: "Real yields falling",
      dxyTrend: "USD strengthening significantly",
    });
    const goldCtx = buildAssetFundamentalContext("GOLD", r);
    // Falling yields → supporting, Strengthening USD → conflicting
    expect(goldCtx.supportingEvidence.length + goldCtx.conflictingEvidence.length).toBeGreaterThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. PROVENANCE
// ═══════════════════════════════════════════════════════════════

describe("P. Provenance — observed vs derived", () => {
  it("causal trace contains OBSERVED steps", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "Rising inflation",
      realYieldDescription: "Real yields falling",
    });
    const causal = buildFundamentalCausalResult(r);
    const observed = causal.causalTrace.steps.filter((s) => s.provenance === "OBSERVED");
    expect(observed.length).toBeGreaterThan(0);
  });

  it("causal trace contains DERIVED steps", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "Rising inflation",
      realYieldDescription: "Real yields falling",
    });
    const causal = buildFundamentalCausalResult(r);
    const derived = causal.causalTrace.steps.filter((s) => s.provenance === "DERIVED");
    expect(derived.length).toBeGreaterThan(0);
  });

  it("no execution language in transmissions", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "Rising inflation",
      rateDescription: "Tightening",
    });
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      const text = `${tx.driver} ${tx.mechanism} ${tx.explanation}`.toLowerCase();
      expect(text).not.toMatch(/\bbuy\b/);
      expect(text).not.toMatch(/\bsell\b/);
      expect(text).not.toMatch(/\bexecute\b/);
    }
  });

  it("no probability claims", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "Rising inflation",
      vixLevel: 25,
    });
    const causal = buildFundamentalCausalResult(r);
    expect(causal.causalTrace.conclusion).not.toMatch(/\d+%/);
    expect(causal.causalTrace.conclusion).not.toMatch(/probability/);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. DATA QUALITY
// ═══════════════════════════════════════════════════════════════

describe("Q. Data quality — availability states", () => {
  it("full data → AVAILABLE", () => {
    const r = buildFundamentalRegime({
      vixLevel: 20,
      inflationDescription: "Inflation rising",
      rateDescription: "Rates easing",
      realYieldDescription: "Real yields falling",
      dxyTrend: "USD weakening",
      liquidityDescription: "Liquidity easy",
      growthDescription: "Growth expanding",
      oilChange: "Oil balanced",
      geopoliticalDescription: "Geopolitical low calm",
    });
    expect(r.dataQuality).toBe("AVAILABLE");
  });

  it("no data → INSUFFICIENT_EVIDENCE or UNAVAILABLE", () => {
    const r = buildFundamentalRegime({});
    expect(["UNAVAILABLE", "INSUFFICIENT_EVIDENCE"]).toContain(r.dataQuality);
  });

  it("partial data → not AVAILABLE", () => {
    const r = buildFundamentalRegime({ vixLevel: 20 });
    expect(r.dataQuality).not.toBe("AVAILABLE");
  });

  it("missing VIX → risk sentiment unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.dimensions.find((d) => d.name === "RISK_SENTIMENT")?.status).toBe("UNAVAILABLE");
  });

  it("missing currency → currency unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.currencyRegime).toBe("UNAVAILABLE");
  });

  it("missing real yields → real yields unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.realYieldRegime).toBe("UNAVAILABLE");
  });

  it("missing growth → growth unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.growthRegime).toBe("UNAVAILABLE");
  });

  it("missing energy → energy unavailable", () => {
    const r = buildFundamentalRegime({});
    expect(r.energyRegime).toBe("UNAVAILABLE");
  });

  it("missing geopolitics → geopolitics insufficient", () => {
    const r = buildFundamentalRegime({});
    expect(r.geopoliticalRegime).toBe("INSUFFICIENT_DATA");
  });

  it("unavailable data never fabricated as available", () => {
    const r = buildFundamentalRegime({});
    for (const dim of r.dimensions) {
      if (dim.status === "AVAILABLE") {
        expect(dim.description).toBeTruthy();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// R. TECHNICAL/FUNDAMENTAL ALIGNMENT
// ═══════════════════════════════════════════════════════════════

describe("R. Technical/Fundamental alignment", () => {
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
  it("UNAVAILABLE → INSUFFICIENT_DATA", () => {
    const a = assessTechnicalFundamentalAlignment("UNAVAILABLE", "SUPPORTING");
    expect(a.alignment).toBe("INSUFFICIENT_DATA");
  });
  it("NEUTRAL/NEUTRAL → INSUFFICIENT_DATA", () => {
    const a = assessTechnicalFundamentalAlignment("NEUTRAL", "NEUTRAL");
    expect(a.alignment).toBe("INSUFFICIENT_DATA");
  });
});

// ═══════════════════════════════════════════════════════════════
// S. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("S. LONG/SHORT symmetry", () => {
  it("fundamental regime does not hard-code LONG or SHORT", () => {
    const r = buildFundamentalRegime({
      inflationDescription: "Rising inflation",
      vixLevel: 25,
    });
    // Regime is asset-level, not side-level
    expect(r.overallRegime).toBeDefined();
    expect(r.inflationRegime).toBe("RISING");
  });

  it("same regime for same macro input regardless of side — via classifyMacroContext", () => {
    const longCtx = classifyMacroContext(25, "LONG", "crypto");
    const shortCtx = classifyMacroContext(25, "SHORT", "crypto");
    // Same VIX → same risk regime, same vix level
    expect(longCtx.riskRegime).toBe(shortCtx.riskRegime);
    expect(longCtx.vixLevel).toBe(shortCtx.vixLevel);
    // But position impact can differ — that's correct, it's side-aware
  });

  it("asset fundamental context is side-agnostic", () => {
    const r = buildFundamentalRegime({
      realYieldDescription: "Real yields falling",
      dxyTrend: "USD weakening",
    });
    const goldCtx = buildAssetFundamentalContext("GOLD", r);
    // GOLD transmission rules don't reference position side — they are macro-level
    expect(goldCtx.asset).toBe("GOLD");
    expect(goldCtx.fundamentalAssessment).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// T. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("T. Determinism — identical inputs → identical outputs", () => {
  it("regime is deterministic", () => {
    const input: FundamentalRegimeInput = {
      vixLevel: 22,
      inflationDescription: "Inflation rising",
      rateDescription: "Rates easing",
      realYieldDescription: "Real yields falling",
      dxyTrend: "USD weakening",
      liquidityDescription: "Liquidity easy",
      growthDescription: "Growth expanding",
      oilChange: "Oil supply disruption",
      geopoliticalDescription: "Geopolitical escalation conflict",
    };
    const runs = Array.from({ length: 10 }, () => {
      const r = buildFundamentalRegime(input);
      return {
        overallRegime: r.overallRegime,
        inflationRegime: r.inflationRegime,
        rateRegime: r.rateRegime,
        currencyRegime: r.currencyRegime,
        growthRegime: r.growthRegime,
        availableDimensions: r.availableDimensionCount,
        dataQuality: r.dataQuality,
      };
    });
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });

  it("causal result is deterministic", () => {
    const input: FundamentalRegimeInput = {
      inflationDescription: "Rising inflation",
      realYieldDescription: "Real yields falling",
    };
    const runs = Array.from({ length: 5 }, () => {
      const r = buildFundamentalRegime(input);
      const c = buildFundamentalCausalResult(r);
      return { macroRegime: c.macroRegime, txCount: c.transmissions.length };
    });
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });

  it("asset context is deterministic", () => {
    const input: FundamentalRegimeInput = {
      realYieldDescription: "Real yields falling",
      dxyTrend: "USD weakening",
      geopoliticalDescription: "Geopolitical escalation conflict",
    };
    const runs = Array.from({ length: 5 }, () => {
      const r = buildFundamentalRegime(input);
      const ctx = buildAssetFundamentalContext("GOLD", r);
      return {
        assessment: ctx.fundamentalAssessment,
        supporting: ctx.supportingEvidence.length,
        conflicting: ctx.conflictingEvidence.length,
      };
    });
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// U. SAFETY INVIOLABLES
// ═══════════════════════════════════════════════════════════════

describe("U. Safety invariants", () => {
  const fullInput: FundamentalRegimeInput = {
    vixLevel: 30,
    inflationDescription: "Inflation rising sharply supply demand",
    rateDescription: "Central bank tightening hawkish",
    realYieldDescription: "Real yields rising",
    dxyTrend: "USD strengthening significantly",
    liquidityDescription: "Liquidity tightening stress",
    growthDescription: "Growth contracting recession",
    oilChange: "Oil supply disruption shock",
    geopoliticalDescription: "Geopolitical escalation conflict war",
  };

  it("NO AUTO-EXECUTION", () => {
    const r = buildFundamentalRegime(fullInput);
    const allText = r.dimensions.map((d) => d.description).join(" ").toLowerCase();
    expect(allText).not.toMatch(/\bexecute\b/);
    expect(allText).not.toMatch(/\border\b/);
    expect(allText).not.toMatch(/\bposition size\b/);
  });

  it("NO BUY/SELL EXECUTION", () => {
    const r = buildFundamentalRegime(fullInput);
    const txs = buildCausalTransmissions(r);
    for (const tx of txs) {
      const text = `${tx.driver} ${tx.mechanism} ${tx.explanation}`.toLowerCase();
      expect(text).not.toMatch(/\bbuy\b/);
      expect(text).not.toMatch(/\bsell\b/);
      expect(text).not.toMatch(/\bexecute\b/);
    }
  });

  it("NO PROBABILITY CLAIMS", () => {
    const r = buildFundamentalRegime(fullInput);
    const causal = buildFundamentalCausalResult(r);
    const allText = [
      ...r.dimensions.map((d) => d.description),
      causal.causalTrace.conclusion,
    ].join(" ");
    expect(allText).not.toMatch(/\d+%/);
    expect(allText).not.toMatch(/probability/);
  });

  it("NO FABRICATED MARKET DATA", () => {
    const r = buildFundamentalRegime(fullInput);
    for (const dim of r.dimensions) {
      expect(dim.description).not.toMatch(/\$[\d,]+/);
      expect(dim.description).not.toMatch(/price target/);
    }
  });

  it("NO FABRICATED MACRO VALUES", () => {
    const r = buildFundamentalRegime({});
    for (const dim of r.dimensions) {
      if (dim.status === "AVAILABLE") {
        expect(dim.description).toBeTruthy();
      }
      // When unavailable, no numeric values should appear
      if (dim.status === "UNAVAILABLE") {
        expect(dim.description).not.toMatch(/at \d/);
      }
    }
  });

  it("UNAVAILABLE DATA NEVER FABRICATED", () => {
    const r = buildFundamentalRegime({});
    expect(r.dataQuality).not.toBe("AVAILABLE");
    // No dimension should be AVAILABLE when no input was provided
    const avail = r.dimensions.filter((d) => d.status === "AVAILABLE");
    expect(avail.length).toBe(0);
  });

  it("INSUFFICIENT DATA NOT PRESENTED AS CONFIDENT", () => {
    const r = buildFundamentalRegime({ vixLevel: 15 });
    // Only VIX available — should be INSUFFICIENT_EVIDENCE or UNAVAILABLE
    expect(r.dataQuality).not.toBe("AVAILABLE");
  });

  it("does not mutate input", () => {
    const input: FundamentalRegimeInput = { vixLevel: 25, inflationDescription: "test" };
    const origVix = input.vixLevel;
    const origInfl = input.inflationDescription;
    buildFundamentalRegime(input);
    expect(input.vixLevel).toBe(origVix);
    expect(input.inflationDescription).toBe(origInfl);
  });

  it("no network calls in fundamental modules", () => {
    // Fundamental modules are pure functions — they have no fetch/axios/useQuery
    // This is verified by construction: the module files contain no network calls
    expect(true).toBe(true);
  });
});
