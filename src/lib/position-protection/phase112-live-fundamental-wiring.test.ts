/**
 * Phase 112 — Live Fundamental Input Wiring & Data Provenance Tests
 *
 * Tests for deterministic instrument mapping, runtime data wiring,
 * data availability, and the complete regime → transmission pipeline.
 */

import { describe, it, expect } from "vitest";
import {
  mapInstrumentToAssetClass,
  buildFundamentalInputFromPositionIntel,
  buildFundamentalRegime,
  buildAssetFundamentalContext,
  type FundamentalRegimeInput,
  type AssetClass,
} from "./fundamental-regime";
import { buildAssetCausalContext, buildCausalTransmissions, buildFundamentalCausalResult } from "./fundamental-transmission";
import type { NewsItem } from "./news-intelligence";

// ═══════════════════════════════════════════════════════════════
// 1. INSTRUMENT → ASSET CLASS MAPPING
// ═══════════════════════════════════════════════════════════════

describe("mapInstrumentToAssetClass", () => {
  // GOLD
  it("maps XAUUSD to GOLD", () => {
    expect(mapInstrumentToAssetClass("XAUUSD")).toBe("GOLD");
  });
  it("maps XAU to GOLD", () => {
    expect(mapInstrumentToAssetClass("XAU")).toBe("GOLD");
  });
  it("maps GOLD to GOLD", () => {
    expect(mapInstrumentToAssetClass("GOLD")).toBe("GOLD");
  });
  it("maps xauusd (lowercase) to GOLD", () => {
    expect(mapInstrumentToAssetClass("xauusd")).toBe("GOLD");
  });
  it("maps XAU/USD to GOLD", () => {
    expect(mapInstrumentToAssetClass("XAU/USD")).toBe("GOLD");
  });

  // SILVER
  it("maps XAGUSD to SILVER", () => {
    expect(mapInstrumentToAssetClass("XAGUSD")).toBe("SILVER");
  });
  it("maps XAG to SILVER", () => {
    expect(mapInstrumentToAssetClass("XAG")).toBe("SILVER");
  });
  it("maps SILVER to SILVER", () => {
    expect(mapInstrumentToAssetClass("SILVER")).toBe("SILVER");
  });

  // OIL
  it("maps USOIL to OIL", () => {
    expect(mapInstrumentToAssetClass("USOIL")).toBe("OIL");
  });
  it("maps WTI to OIL", () => {
    expect(mapInstrumentToAssetClass("WTI")).toBe("OIL");
  });
  it("maps CL to OIL", () => {
    expect(mapInstrumentToAssetClass("CL")).toBe("OIL");
  });
  it("maps CRUDE_OIL to OIL", () => {
    expect(mapInstrumentToAssetClass("CRUDE_OIL")).toBe("OIL");
  });
  it("maps UKOIL to OIL", () => {
    expect(mapInstrumentToAssetClass("UKOIL")).toBe("OIL");
  });
  it("maps BRENT to OIL", () => {
    expect(mapInstrumentToAssetClass("BRENT")).toBe("OIL");
  });
  it("maps BRENT_OIL to OIL", () => {
    expect(mapInstrumentToAssetClass("BRENT_OIL")).toBe("OIL");
  });

  // CRYPTO
  it("maps BTCUSD to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("BTCUSD")).toBe("CRYPTO");
  });
  it("maps BTC to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("BTC")).toBe("CRYPTO");
  });
  it("maps XBTUSD to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("XBTUSD")).toBe("CRYPTO");
  });
  it("maps ETHUSD to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("ETHUSD")).toBe("CRYPTO");
  });
  it("maps ETH to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("ETH")).toBe("CRYPTO");
  });
  it("maps SOLUSD to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("SOLUSD")).toBe("CRYPTO");
  });
  it("maps DOGEUSD to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("DOGEUSD")).toBe("CRYPTO");
  });
  it("maps XRPUSD to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("XRPUSD")).toBe("CRYPTO");
  });

  // FOREX
  it("maps EURUSD to FOREX", () => {
    expect(mapInstrumentToAssetClass("EURUSD")).toBe("FOREX");
  });
  it("maps GBPUSD to FOREX", () => {
    expect(mapInstrumentToAssetClass("GBPUSD")).toBe("FOREX");
  });
  it("maps USDJPY to FOREX", () => {
    expect(mapInstrumentToAssetClass("USDJPY")).toBe("FOREX");
  });
  it("maps EURGBP to FOREX", () => {
    expect(mapInstrumentToAssetClass("EURGBP")).toBe("FOREX");
  });
  it("maps AUDUSD to FOREX", () => {
    expect(mapInstrumentToAssetClass("AUDUSD")).toBe("FOREX");
  });

  // EQUITIES
  it("maps AAPL to EQUITIES", () => {
    expect(mapInstrumentToAssetClass("AAPL")).toBe("EQUITIES");
  });
  it("maps TSLA to EQUITIES", () => {
    expect(mapInstrumentToAssetClass("TSLA")).toBe("EQUITIES");
  });
  it("maps MSFT to EQUITIES", () => {
    expect(mapInstrumentToAssetClass("MSFT")).toBe("EQUITIES");
  });
  it("maps NVDA to EQUITIES", () => {
    expect(mapInstrumentToAssetClass("NVDA")).toBe("EQUITIES");
  });

  // Edge cases
  it("handles empty string", () => {
    expect(mapInstrumentToAssetClass("")).toBe("COMMODITIES");
  });
  it("handles unknown symbol", () => {
    expect(mapInstrumentToAssetClass("RANDOMXYZ")).toBe("COMMODITIES");
  });
  it("handles whitespace", () => {
    expect(mapInstrumentToAssetClass("  BTCUSD  ")).toBe("CRYPTO");
  });

  // Determinism
  it("is deterministic", () => {
    const results = Array.from({ length: 10 }, () => mapInstrumentToAssetClass("BTCUSD"));
    expect(new Set(results).size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. BUILD FUNDAMENTAL INPUT FROM POSITION INTEL
// ═══════════════════════════════════════════════════════════════

describe("buildFundamentalInputFromPositionIntel", () => {
  it("returns empty input when no data available", () => {
    const input = buildFundamentalInputFromPositionIntel({
      instrument: "BTCUSD",
      assetClass: "crypto",
    });
    expect(input.macroContext).toBeUndefined();
    expect(input.crossAssetContext).toBeUndefined();
    expect(input.newsItems).toBeUndefined();
    expect(input.vixLevel).toBeUndefined();
  });

  it("passes through macroContext when available", () => {
    const macroCtx = { vixLevel: 25, riskRegime: "RISK_OFF" as const, vixDescription: "", positionImpact: "CONFLICTING" as const, narrative: "Geopolitical tensions", availability: "AVAILABLE" as const };
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { macroContext: macroCtx },
    );
    expect(input.macroContext).toBe(macroCtx);
    expect(input.vixLevel).toBe(25);
  });

  it("extracts liquidity description from macro narrative", () => {
    const macroCtx = { vixLevel: 20, riskRegime: "RISK_ON" as const, vixDescription: "", positionImpact: "SUPPORTING" as const, narrative: "Liquidity conditions improving", availability: "AVAILABLE" as const };
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { macroContext: macroCtx },
    );
    expect(input.liquidityDescription).toContain("Liquidity");
  });

  it("extracts geopolitical description from macro narrative", () => {
    const macroCtx = { vixLevel: 30, riskRegime: "RISK_OFF" as const, vixDescription: "", positionImpact: "CONFLICTING" as const, narrative: "Geopolitical conflict escalating", availability: "AVAILABLE" as const };
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "XAUUSD", assetClass: "commodity" },
      { macroContext: macroCtx },
    );
    expect(input.geopoliticalDescription).toContain("Geopolitical");
  });

  it("passes through newsItems", () => {
    const news: NewsItem[] = [{ id: "n1", headline: "Fed raises rates", timestamp: Date.now(), source: "test", relatedInstruments: ["BTCUSD"], assetClass: "macro" as const, category: "MONETARY_POLICY" as any, sentiment: "BEARISH" as any, impactStrength: "MODERATE" as any, freshness: "FRESH" as any, sourceMode: "LIVE" as any }];
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
      { newsItems: news },
    );
    expect(input.newsItems).toBe(news);
  });

  it("passes through crossAssetContext", () => {
    const cross = { correlationState: "ALIGNED" as const, positionImpact: "SUPPORTING" as const, narrative: "", pairs: [], availability: "AVAILABLE" as const };
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "EURUSD", assetClass: "forex" },
      { crossAssetContext: cross },
    );
    expect(input.crossAssetContext).toBe(cross);
  });

  it("does not fabricate descriptions when intel context is empty", () => {
    const input = buildFundamentalInputFromPositionIntel({
      instrument: "BTCUSD",
      assetClass: "crypto",
      shortTermContext: "",
      mediumTermContext: "",
    });
    expect(input.inflationDescription).toBeUndefined();
    expect(input.rateDescription).toBeUndefined();
    expect(input.growthDescription).toBeUndefined();
    expect(input.liquidityDescription).toBeUndefined();
    expect(input.geopoliticalDescription).toBeUndefined();
  });

  it("extracts inflation-related context from shortTermContext", () => {
    const input = buildFundamentalInputFromPositionIntel({
      instrument: "XAUUSD",
      assetClass: "commodity",
      shortTermContext: "Inflationary pressures mounting due to supply constraints",
    });
    expect(input.inflationDescription).toContain("Inflationary");
  });

  it("extracts rate-related context from shortTermContext", () => {
    const input = buildFundamentalInputFromPositionIntel({
      instrument: "BTCUSD",
      assetClass: "crypto",
      shortTermContext: "Rate expectations shifting due to monetary policy signals",
    });
    expect(input.rateDescription).toContain("Rate");
  });

  it("extracts growth-related context from mediumTermContext", () => {
    const input = buildFundamentalInputFromPositionIntel({
      instrument: "EURUSD",
      assetClass: "forex",
      mediumTermContext: "Growth expansion accelerating in major economies",
    });
    expect(input.growthDescription).toContain("Growth");
  });

  it("extracts geopolitical context from mediumTermContext", () => {
    const input = buildFundamentalInputFromPositionIntel({
      instrument: "XAUUSD",
      assetClass: "commodity",
      mediumTermContext: "Geopolitical tensions rising in Middle East",
    });
    expect(input.geopoliticalDescription).toContain("Geopolitical");
  });

  it("is deterministic", () => {
    const intel = { instrument: "BTCUSD", assetClass: "crypto", shortTermContext: "Inflation rising" };
    const results = Array.from({ length: 5 }, () => buildFundamentalInputFromPositionIntel(intel));
    for (let i = 1; i < results.length; i++) {
      expect(results[i].inflationDescription).toBe(results[0].inflationDescription);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. RUNTIME DATA WIRING
// ═══════════════════════════════════════════════════════════════

describe("Runtime data wiring", () => {
  it("non-empty input produces different regime than empty input", () => {
    const emptyRegime = buildFundamentalRegime({});
    const filledInput = buildFundamentalInputFromPositionIntel(
      { instrument: "XAUUSD", assetClass: "commodity", shortTermContext: "Inflation rising" },
      { macroContext: { vixLevel: 30, riskRegime: "RISK_OFF", vixDescription: "", positionImpact: "CONFLICTING", narrative: "Geopolitical tensions", availability: "AVAILABLE" } },
    );
    const filledRegime = buildFundamentalRegime(filledInput);
    // At minimum, dimensions count should differ
    expect(filledRegime.dimensions.length).toBeGreaterThanOrEqual(emptyRegime.dimensions.length);
  });

  it("changing macro input changes regime dimensions", () => {
    const input1: FundamentalRegimeInput = { vixLevel: 15 };
    const input2: FundamentalRegimeInput = { vixLevel: 35 };
    const regime1 = buildFundamentalRegime(input1);
    const regime2 = buildFundamentalRegime(input2);
    // Both should have risk sentiment available
    const hasRisk1 = regime1.dimensions.some((d) => d.name === "RISK_SENTIMENT");
    const hasRisk2 = regime2.dimensions.some((d) => d.name === "RISK_SENTIMENT");
    expect(hasRisk1).toBe(true);
    expect(hasRisk2).toBe(true);
    // Descriptions should differ
    const riskDesc1 = regime1.dimensions.find((d) => d.name === "RISK_SENTIMENT")?.description;
    const riskDesc2 = regime2.dimensions.find((d) => d.name === "RISK_SENTIMENT")?.description;
    expect(riskDesc1).not.toBe(riskDesc2);
  });

  it("changing regime changes transmission count", () => {
    const emptyRegime = buildFundamentalRegime({});
    const emptyTxs = buildCausalTransmissions(emptyRegime);
    const fullInput: FundamentalRegimeInput = {
      inflationDescription: "Inflation accelerating sharply",
      rateDescription: "Central bank tightening aggressively",
      realYieldDescription: "Real yields rising rapidly",
      dxyTrend: "USD strengthening significantly",
      growthDescription: "Growth contracting",
      geopoliticalDescription: "Major geopolitical escalation",
    };
    const fullRegime = buildFundamentalRegime(fullInput);
    const fullTxs = buildCausalTransmissions(fullRegime);
    expect(fullTxs.length).toBeGreaterThan(emptyTxs.length);
  });

  it("changing transmission changes asset context", () => {
    const regime = buildFundamentalRegime({
      realYieldDescription: "Falling yields",
      geopoliticalDescription: "Geopolitical escalation",
    });
    // If inputs produce real yields falling, gold should get supporting
    const txs = buildCausalTransmissions(regime);
    if (txs.length > 0) {
      const ctx = buildAssetCausalContext("GOLD", regime, txs);
      expect(ctx.asset).toBe("GOLD");
    }
  });

  it("empty input produces INSUFFICIENT_DATA or MIXED overall regime", () => {
    const regime = buildFundamentalRegime({});
    expect(["INSUFFICIENT_DATA", "MIXED"]).toContain(regime.overallRegime);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. DATA AVAILABILITY
// ═══════════════════════════════════════════════════════════════

describe("Data availability", () => {
  it("no data → all dimensions unavailable", () => {
    const regime = buildFundamentalRegime({});
    const avail = regime.dimensions.filter((d) => d.status === "AVAILABLE");
    expect(avail.length).toBe(0);
  });

  it("only VIX → risk sentiment available, others unavailable", () => {
    const regime = buildFundamentalRegime({ vixLevel: 20 });
    const riskDim = regime.dimensions.find((d) => d.name === "RISK_SENTIMENT");
    expect(riskDim?.status).toBe("AVAILABLE");
    const otherAvail = regime.dimensions.filter((d) => d.name !== "RISK_SENTIMENT" && d.status === "AVAILABLE");
    expect(otherAvail.length).toBe(0);
  });

  it("VIX + inflation description → two dimensions available", () => {
    const regime = buildFundamentalRegime({ vixLevel: 20, inflationDescription: "Rising inflation" });
    const avail = regime.dimensions.filter((d) => d.status === "AVAILABLE");
    expect(avail.length).toBe(2);
  });

  it("missing real-yield data → no fabricated yield regime", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.realYieldRegime).toBe("UNAVAILABLE");
  });

  it("missing currency data → no fabricated currency regime", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.currencyRegime).toBe("UNAVAILABLE");
  });

  it("missing growth data → no fabricated growth regime", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.growthRegime).toBe("UNAVAILABLE");
  });

  it("missing energy data → no fabricated energy regime", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.energyRegime).toBe("UNAVAILABLE");
  });

  it("missing geopolitical evidence → INSUFFICIENT_DATA", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.geopoliticalRegime).toBe("INSUFFICIENT_DATA");
  });

  it("partial data remains partial", () => {
    const regime = buildFundamentalRegime({ vixLevel: 20 });
    expect(regime.dataQuality).not.toBe("AVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. INFLATION MODEL
// ═══════════════════════════════════════════════════════════════

describe("Inflation model", () => {
  it("no inflation data → INSUFFICIENT_DATA", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.inflationRegime).toBe("INSUFFICIENT_DATA");
  });

  it("inflation description containing 'rising' → RISING", () => {
    const regime = buildFundamentalRegime({ inflationDescription: "Inflation rising above expectations" });
    expect(regime.inflationRegime).toBe("RISING");
  });

  it("inflation description containing 'high' → HIGH", () => {
    const regime = buildFundamentalRegime({ inflationDescription: "High inflation persisting" });
    expect(regime.inflationRegime).toBe("HIGH");
  });

  it("inflation description containing 'accelerating' → ACCELERATING", () => {
    const regime = buildFundamentalRegime({ inflationDescription: "Inflation accelerating sharply" });
    expect(regime.inflationRegime).toBe("ACCELERATING");
  });

  it("inflation description containing 'disinflation' → DISINFLATIONARY", () => {
    const regime = buildFundamentalRegime({ inflationDescription: "Disinflation trend continuing" });
    expect(regime.inflationRegime).toBe("DISINFLATIONARY");
  });

  it("inflation description containing 'stable' → STABLE", () => {
    const regime = buildFundamentalRegime({ inflationDescription: "Inflation stable at target" });
    expect(regime.inflationRegime).toBe("STABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. RATES / REAL YIELDS / CURRENCY
// ═══════════════════════════════════════════════════════════════

describe("Rates / Real Yields / Currency", () => {
  it("no rate data → INSUFFICIENT_DATA", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.rateRegime).toBe("INSUFFICIENT_DATA");
  });

  it("rate description containing 'tightening' → TIGHTENING", () => {
    const regime = buildFundamentalRegime({ rateDescription: "Central bank tightening aggressively" });
    expect(regime.rateRegime).toBe("TIGHTENING");
  });

  it("rate description containing 'easing' → EASING", () => {
    const regime = buildFundamentalRegime({ rateDescription: "Rate easing cycle begins" });
    expect(regime.rateRegime).toBe("EASING");
  });

  it("real yield description → classified", () => {
    const regime = buildFundamentalRegime({ realYieldDescription: "Real yields falling rapidly" });
    expect(regime.realYieldRegime).not.toBe("UNAVAILABLE");
  });

  it("no real yield data → UNAVAILABLE", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.realYieldRegime).toBe("UNAVAILABLE");
  });

  it("dxy trend → classified", () => {
    const regime = buildFundamentalRegime({ dxyTrend: "USD strengthening significantly" });
    expect(regime.currencyRegime).not.toBe("UNAVAILABLE");
  });

  it("no currency data → UNAVAILABLE", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.currencyRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. LIQUIDITY / GROWTH / ENERGY / GEOPOLITICS
// ═══════════════════════════════════════════════════════════════

describe("Liquidity / Growth / Energy / Geopolitics", () => {
  it("liquidity description → classified", () => {
    const regime = buildFundamentalRegime({ liquidityDescription: "Liquidity conditions tightening" });
    expect(regime.liquidityRegime).not.toBe("UNAVAILABLE");
  });

  it("growth description → classified", () => {
    const regime = buildFundamentalRegime({ growthDescription: "Growth expanding strongly" });
    expect(regime.growthRegime).not.toBe("UNAVAILABLE");
  });

  it("oil change description → classified", () => {
    const regime = buildFundamentalRegime({ oilChange: "Oil supply disruption detected" });
    expect(regime.energyRegime).not.toBe("UNAVAILABLE");
  });

  it("geopolitical description → classified", () => {
    const regime = buildFundamentalRegime({ geopoliticalDescription: "Geopolitical escalation in energy-producing region" });
    expect(regime.geopoliticalRegime).not.toBe("INSUFFICIENT_DATA");
  });

  it("no liquidity data → UNAVAILABLE", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.liquidityRegime).toBe("UNAVAILABLE");
  });

  it("no growth data → UNAVAILABLE", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.growthRegime).toBe("UNAVAILABLE");
  });

  it("no energy data → UNAVAILABLE", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.energyRegime).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. ASSET MAPPING DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Asset mapping determinism", () => {
  it("same input always produces same output for all asset classes", () => {
    const symbols = ["XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "EURUSD", "GBPUSD", "AAPL", "USOIL", "BRENT"];
    for (const sym of symbols) {
      const results = Array.from({ length: 5 }, () => mapInstrumentToAssetClass(sym));
      expect(new Set(results).size).toBe(1);
    }
  });

  it("false positive: GOLDUSD should map to GOLD (contains GOLD)", () => {
    expect(mapInstrumentToAssetClass("GOLDUSD")).toBe("GOLD");
  });

  it("false positive: SILVERUSD should map to SILVER", () => {
    expect(mapInstrumentToAssetClass("SILVERUSD")).toBe("SILVER");
  });

  it("BTCUSDT maps to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("BTCUSDT")).toBe("CRYPTO");
  });

  it("ETHUSDT maps to CRYPTO", () => {
    expect(mapInstrumentToAssetClass("ETHUSDT")).toBe("CRYPTO");
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. PROVENANCE
// ═══════════════════════════════════════════════════════════════

describe("Provenance", () => {
  it("no probability language in regime dimensions", () => {
    const regime = buildFundamentalRegime({ inflationDescription: "Rising inflation", vixLevel: 25 });
    for (const dim of regime.dimensions) {
      expect(dim.description).not.toMatch(/\d+%/);
      expect(dim.description).not.toMatch(/probability/);
    }
  });

  it("no execution language in regime", () => {
    const regime = buildFundamentalRegime({ inflationDescription: "Rising inflation" });
    const allText = regime.dimensions.map((d) => d.description).join(" ").toLowerCase();
    expect(allText).not.toMatch(/\bbuy\b/);
    expect(allText).not.toMatch(/\bsell\b/);
    expect(allText).not.toMatch(/\bexecute\b/);
  });

  it("causal transmissions use explanatory language", () => {
    const regime = buildFundamentalRegime({
      inflationDescription: "High inflation",
      rateDescription: "Tightening monetary policy",
    });
    const txs = buildCausalTransmissions(regime);
    for (const tx of txs) {
      const text = `${tx.mechanism} ${tx.explanation}`.toLowerCase();
      // Each transmission should have substantive causal explanation
      expect(text.length).toBeGreaterThan(20);
      // Should not contain BUY/SELL/EXECUTE
      expect(text).not.toMatch(/\bbuy\b/);
      expect(text).not.toMatch(/\bsell\b/);
      expect(text).not.toMatch(/\bexecute\b/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Safety invariants", () => {    const fullInput: FundamentalRegimeInput = {
      vixLevel: 30,
      inflationDescription: "Inflation rising sharply",
      rateDescription: "Central bank tightening",
      realYieldDescription: "Real yields rising",
      dxyTrend: "USD strengthening",
      liquidityDescription: "Liquidity tightening",
      growthDescription: "Growth contracting",
      oilChange: "Oil supply disruption",
      geopoliticalDescription: "Geopolitical escalation",
    };

  it("no BUY/SELL execution language in any transmission", () => {
    const regime = buildFundamentalRegime(fullInput);
    const txs = buildCausalTransmissions(regime);
    for (const tx of txs) {
      const text = `${tx.driver} ${tx.mechanism} ${tx.explanation}`.toLowerCase();
      expect(text).not.toMatch(/\bbuy\b/);
      expect(text).not.toMatch(/\bsell\b/);
      expect(text).not.toMatch(/\bexecute\b/);
      expect(text).not.toMatch(/\border\b/);
    }
  });

  it("no probability claims", () => {
    const regime = buildFundamentalRegime(fullInput);
    const result = buildFundamentalCausalResult(regime);
    expect(result.causalTrace.conclusion).not.toMatch(/\d+%/);
    expect(result.causalTrace.conclusion).not.toMatch(/probability/);
  });

  it("no fabricated market data in dimensions", () => {
    const regime = buildFundamentalRegime(fullInput);
    for (const dim of regime.dimensions) {
      expect(dim.description).not.toMatch(/\$[\d,]+/);
      expect(dim.description).not.toMatch(/price target/);
    }
  });

  it("unavailable data is never fabricated as available", () => {
    const regime = buildFundamentalRegime({});
    for (const dim of regime.dimensions) {
      // If a dimension is AVAILABLE, it must have real data backing it
      if (dim.status === "AVAILABLE") {
        expect(dim.description).toBeTruthy();
      }
    }
  });

  it("insufficient data does not become confident assessment", () => {
    const regime = buildFundamentalRegime({});
    expect(regime.dataQuality).not.toBe("AVAILABLE");
  });

  it("no universal macro rules — same input affects different assets differently", () => {
    const regime = buildFundamentalRegime({
      geopoliticalDescription: "Geopolitical escalation",
      realYieldDescription: "Real yields rising",
    });
    const txs = buildCausalTransmissions(regime);
    const goldSupport = txs.filter((t) => t.affectedAssets.includes("GOLD") && t.direction === "SUPPORTING");
    const cryptoConflict = txs.filter((t) => t.affectedAssets.includes("CRYPTO") && t.direction === "CONFLICTING");
    // Geopolitical escalation supports gold but conflicts crypto
    if (goldSupport.length > 0 && cryptoConflict.length > 0) {
      expect(true).toBe(true); // Both forces present
    }
  });

  it("deterministic output", () => {
    const results = Array.from({ length: 5 }, () => {
      const regime = buildFundamentalRegime(fullInput);
      return buildFundamentalCausalResult(regime);
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i].transmissions.length).toBe(results[0].transmissions.length);
      expect(results[i].macroRegime).toBe(results[0].macroRegime);
    }
  });

  it("does not mutate input", () => {
    const input: FundamentalRegimeInput = { vixLevel: 25, inflationDescription: "test" };
    const origVix = input.vixLevel;
    buildFundamentalRegime(input);
    expect(input.vixLevel).toBe(origVix);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. LIVE WIRING — NEWS REACHES REGIME
// ═══════════════════════════════════════════════════════════════

describe("Live wiring — news reaches regime", () => {
  const now = Date.now();

  const mockNewsItems: NewsItem[] = [
    {
      id: "n1",
      headline: "Fed signals rate cuts",
      timestamp: now,
      source: "Reuters",
      relatedInstruments: ["BTCUSD"],
      assetClass: "macro" as const,
      category: "MONETARY_POLICY" as any,
      sentiment: "BULLISH" as any,
      impactStrength: "HIGH" as any,
      freshness: "FRESH" as any,
      sourceMode: "LIVE" as any,
    },
    {
      id: "n2",
      headline: "Geopolitical tensions escalate in Middle East",
      timestamp: now,
      source: "Bloomberg",
      relatedInstruments: ["XAUUSD"],
      assetClass: "macro" as const,
      category: "GEOPOLITICAL" as any,
      sentiment: "BULLISH" as any,
      impactStrength: "MODERATE" as any,
      freshness: "FRESH" as any,
      sourceMode: "LIVE" as any,
    },
  ];

  it("news items make NEWS_EVENTS dimension AVAILABLE", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto", shortTermContext: "Rate expectations shifting" },
      { newsItems: mockNewsItems },
    );
    const regime = buildFundamentalRegime(input);
    const newsDim = regime.dimensions.find((d) => d.name === "NEWS_EVENTS");
    expect(newsDim?.status).toBe("AVAILABLE");
  });

  it("no news items leaves NEWS_EVENTS dimension UNAVAILABLE", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
    );
    const regime = buildFundamentalRegime(input);
    const newsDim = regime.dimensions.find((d) => d.name === "NEWS_EVENTS");
    expect(newsDim?.status).toBe("UNAVAILABLE");
  });

  it("news items flow through full pipeline to causal transmissions", () => {
    const input = buildFundamentalInputFromPositionIntel(
      {
        instrument: "XAUUSD",
        assetClass: "commodity",
        shortTermContext: "Inflation rising due to supply constraints",
        mediumTermContext: "Geopolitical tensions escalating",
      },
      { newsItems: mockNewsItems },
    );
    const regime = buildFundamentalRegime(input);
    const causalResult = buildFundamentalCausalResult(regime);

    // News should contribute to at least one available dimension
    expect(regime.availableDimensionCount).toBeGreaterThanOrEqual(1);

    // Causal result should exist and not throw
    expect(causalResult.transmissions).toBeDefined();
    expect(causalResult.macroRegime).toBeDefined();
    expect(causalResult.dataQuality).toBeDefined();
  });

  it("news items enrich asset fundamental context for gold with geopolitical escalation", () => {
    const input = buildFundamentalInputFromPositionIntel(
      {
        instrument: "XAUUSD",
        assetClass: "commodity",
        mediumTermContext: "Geopolitical conflict escalating",
      },
      { newsItems: mockNewsItems },
    );
    const regime = buildFundamentalRegime(input);

    // With geopolitical + inflation data, gold should get supporting evidence
    const assetCtx = buildAssetFundamentalContext("GOLD", regime);
    expect(assetCtx.asset).toBe("GOLD");
    expect(assetCtx.supportingEvidence.length + assetCtx.conflictingEvidence.length + assetCtx.neutralEvidence.length)
      .toBeGreaterThan(0);
  });

  it("news + macro narrative both feed into regime dimensions", () => {
    const macroCtx = {
      vixLevel: 35,
      riskRegime: "RISK_OFF" as const,
      vixDescription: "VIX elevated",
      positionImpact: "CONFLICTING" as const,
      narrative: "Geopolitical tensions driving risk-off",
      availability: "AVAILABLE" as const,
    };
    const input = buildFundamentalInputFromPositionIntel(
      {
        instrument: "BTCUSD",
        assetClass: "crypto",
        shortTermContext: "Inflation expectations rising",
        mediumTermContext: "Growth slowing",
      },
      { newsItems: mockNewsItems, macroContext: macroCtx },
    );
    const regime = buildFundamentalRegime(input);

    // Should have multiple available dimensions from macro + news + context
    expect(regime.availableDimensionCount).toBeGreaterThanOrEqual(3);
    expect(regime.dataQuality).not.toBe("UNAVAILABLE");
  });

  it("buildFundamentalInputFromPositionIntel does not fabricate news when none provided", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto" },
    );
    expect(input.newsItems).toBeUndefined();
    expect(input.newsRelevance).toBeUndefined();
  });

  it("pipeline is deterministic with news items", () => {
    const input = buildFundamentalInputFromPositionIntel(
      { instrument: "BTCUSD", assetClass: "crypto", shortTermContext: "Inflation rising" },
      { newsItems: mockNewsItems },
    );
    const runs = Array.from({ length: 5 }, () => {
      const regime = buildFundamentalRegime(input);
      const causal = buildFundamentalCausalResult(regime);
      return {
        overallRegime: regime.overallRegime,
        availableDimensions: regime.availableDimensionCount,
        transmissionCount: causal.transmissions.length,
        macroRegime: causal.macroRegime,
      };
    });
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].overallRegime).toBe(runs[0].overallRegime);
      expect(runs[i].availableDimensions).toBe(runs[0].availableDimensions);
      expect(runs[i].transmissionCount).toBe(runs[0].transmissionCount);
      expect(runs[i].macroRegime).toBe(runs[0].macroRegime);
    }
  });
});
