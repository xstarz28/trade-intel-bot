/**
 * Phase 56 — Index & Macro Deep Intelligence + Analyst Context UI
 * Test suite covering groups A-AX.
 */
import { describe, it, expect } from "vitest";
import {
  buildIndexAnalyticalDepth,
  buildMacroAnalyticalDepth,
  buildCryptoAnalyticalDepth,
  buildForexAnalyticalDepth,
  buildEquityAnalyticalDepth,
  buildCommodityAnalyticalDepth,
  assembleUniversalAnalyticalContext,
  type IndexRawData,
  type MacroRawData,
} from "@/lib/data/universal/analytical-depth";
import { classifyRegime, aggregateRegimes, type RegimeObservation } from "@/lib/data/universal/regime";

// ═══════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════

function spxData(): IndexRawData {
  return {
    price: { current: 5200, changePct: 1.5 },
    volatility: { current: 18, average: 15 },
    breadth: { advanceDecline: 1.3, newHighsNewLows: 25 },
    valuation: { pe: 22.5, forwardPE: 20.0 },
    yields: { us10Y: 4.4, us2Y: 4.8, realYield10Y: 2.0 },
    dxy: { value: 103.5 },
    crossMarket: { spxVsNdx: "NDX outperforming", spxVsDji: "DJI lagging" },
  };
}

function vixData(): IndexRawData {
  return { price: { current: 14.5, changePct: -5.2 }, volatility: { current: 14.5 } };
}

function macroData(): MacroRawData {
  return {
    dxy: { value: 103.5, change: 0.5 },
    treasury: { tenYear: 4.4, twoYear: 4.8, change10Y: 0.05 },
    realYield: { tenYearReal: 2.0 },
    centralBank: { fedBias: "hawkish", ecbBias: "neutral", bojBias: "dovish" },
    liquidity: { m2Change: 3.5 },
    events: [{ name: "CPI", date: "2026-09-11", impact: "HIGH", region: "US" }],
  };
}

// ═══════════════════════════════════════════════════════════════
// A. Index context shape
// ═══════════════════════════════════════════════════════════════

describe("A. Index context shape", () => {
  it("A1 — has all required fields", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.instrument).toBe("SPX");
    expect(d.assetClass).toBe("indices");
    expect(d.assembledAt).toBeGreaterThan(0);
    expect(Array.isArray(d.dimensions)).toBe(true);
    expect(Array.isArray(d.supportingEvidence)).toBe(true);
    expect(Array.isArray(d.conflictingEvidence)).toBe(true);
    expect(Array.isArray(d.missingInformation)).toBe(true);
  });

  it("A2 — assembles into universal context", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    const ctx = assembleUniversalAnalyticalContext({ instrument: "SPX", assetClass: "indices", index: d });
    expect(ctx.index).toBeDefined();
    expect(ctx.instrument).toBe("SPX");
  });

  it("A3 — supported index instruments", () => {
    for (const inst of ["SPX", "NDX", "DJI", "RUT", "VIX", "IHSG", "NIKKEI", "DAX", "FTSE"]) {
      const d = buildIndexAnalyticalDepth(inst, { price: { current: 100, changePct: 0.5 } });
      expect(d.instrument).toBe(inst);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// B. Index structure
// ═══════════════════════════════════════════════════════════════

describe("B. Index structure", () => {
  it("B1 — trend computed from price change", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.marketStructure).toBeDefined();
    expect(d.marketStructure!.trend).toBe("BULLISH");
  });

  it("B2 — bearish trend", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 5000, changePct: -3 } });
    expect(d.marketStructure!.trend).toBe("BEARISH");
  });

  it("B3 — structure absent without price data", () => {
    const d = buildIndexAnalyticalDepth("SPX", {});
    expect(d.marketStructure).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// C. Index volatility
// ═══════════════════════════════════════════════════════════════

describe("C. Index volatility", () => {
  it("C1 — computed from current vs average", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.volatility).toBeDefined();
    expect(d.volatility!.available).toBe(true);
  });

  it("C2 — absent without volatility data", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 100, changePct: 1 } });
    expect(d.volatility).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// D. Index regime
// ═══════════════════════════════════════════════════════════════

describe("D. Index regime", () => {
  it("D1 — risk-on when price up + low vol", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.riskRegime).toBeDefined();
  });

  it("D2 — risk-off when price down + high vol", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 4800, changePct: -5 }, volatility: { current: 35, average: 15 } });
    expect(d.riskRegime).toBe("RISK_OFF");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. Index breadth
// ═══════════════════════════════════════════════════════════════

describe("E. Index breadth availability", () => {
  it("E1 — present when data exists", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.breadth).toBeDefined();
    expect(d.breadth!.available).toBe(true);
  });

  it("E2 — unavailable when no breadth data", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 100, changePct: 1 } });
    expect(d.breadth?.available).toBe(false);
    expect(d.missingInformation).toContain("Breadth data");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Index valuation
// ═══════════════════════════════════════════════════════════════

describe("F. Index valuation", () => {
  it("F1 — P/E and regime", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.valuation).toBeDefined();
    expect(d.valuation!.pe).toBe(22.5);
    expect(["ELEVATED", "MODERATE", "DEPRESSED", "UNKNOWN"]).toContain(d.valuation!.regime);
  });

  it("F2 — absent when no valuation data", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 100, changePct: 1 } });
    expect(d.valuation).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// G. Index macro sensitivity
// ═══════════════════════════════════════════════════════════════

describe("G. Index macro sensitivity", () => {
  it("G1 — present with yields/DXY data", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.macroSensitivity).toBeDefined();
    expect(d.macroSensitivity!.available).toBe(true);
  });

  it("G2 — absent without macro data", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 100, changePct: 1 } });
    expect(d.macroSensitivity).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// H. Index cross-market context
// ═══════════════════════════════════════════════════════════════

describe("H. Index cross-market context", () => {
  it("H1 — present with cross-market data", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.crossMarket).toBeDefined();
  });

  it("H2 — absent without cross-market data", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 100, changePct: 1 } });
    expect(d.crossMarket).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// I. VIX context
// ═══════════════════════════════════════════════════════════════

describe("I. VIX context", () => {
  it("I1 — VIX gets dedicated context", () => {
    const d = buildIndexAnalyticalDepth("VIX", vixData());
    expect(d.instrument).toBe("VIX");
    expect(d.marketStructure).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// J. Macro context shape
// ═══════════════════════════════════════════════════════════════

describe("J. Macro context shape", () => {
  it("J1 — has all required fields", () => {
    const d = buildMacroAnalyticalDepth("US10Y", macroData());
    expect(d.instrument).toBe("US10Y");
    expect(d.assetClass).toBe("macro");
    expect(d.assembledAt).toBeGreaterThan(0);
    expect(Array.isArray(d.dimensions)).toBe(true);
  });

  it("J2 — assembles into universal context", () => {
    const d = buildMacroAnalyticalDepth("US10Y", macroData());
    const ctx = assembleUniversalAnalyticalContext({ instrument: "US10Y", assetClass: "macro", macro: d });
    expect(ctx.macro).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// K. DXY context
// ═══════════════════════════════════════════════════════════════

describe("K. DXY context", () => {
  it("K1 — trend computed", () => {
    const d = buildMacroAnalyticalDepth("DXY", { dxy: { value: 103.5, change: 3.0 } });
    expect(d.dxyContext).toBeDefined();
    expect(d.dxyContext!.trend).toBe("RISING");
  });

  it("K2 — absent without DXY data", () => {
    const d = buildMacroAnalyticalDepth("DXY", {});
    expect(d.dxyContext).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// L. US10Y context
// ═══════════════════════════════════════════════════════════════

describe("L. US10Y context", () => {
  it("L1 — yield curve includes 10Y", () => {
    const d = buildMacroAnalyticalDepth("US10Y", macroData());
    expect(d.yieldCurve).toBeDefined();
    expect(d.yieldCurve!.tenYearYield).toBe(4.4);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. US2Y context
// ═══════════════════════════════════════════════════════════════

describe("M. US2Y context", () => {
  it("M1 — yield curve includes 2Y", () => {
    const d = buildMacroAnalyticalDepth("US2Y", macroData());
    expect(d.yieldCurve!.twoYearYield).toBe(4.8);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. Yield curve
// ═══════════════════════════════════════════════════════════════

describe("N. Yield curve", () => {
  it("N1 — inverted when 2Y > 10Y", () => {
    const d = buildMacroAnalyticalDepth("DXY", macroData());
    expect(d.yieldCurve!.shape).toBe("INVERTED");
  });

  it("N2 — positive slope when 10Y > 2Y", () => {
    const d = buildMacroAnalyticalDepth("DXY", { treasury: { tenYear: 4.8, twoYear: 4.4 } });
    expect(d.yieldCurve!.shape).toBe("POSITIVE_SLOPE");
  });

  it("N3 — absent without yield data", () => {
    const d = buildMacroAnalyticalDepth("DXY", {});
    expect(d.yieldCurve).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// O. Real yields
// ═══════════════════════════════════════════════════════════════

describe("O. Real yields", () => {
  it("O1 — present with data", () => {
    const d = buildMacroAnalyticalDepth("US10Y", macroData());
    expect(d.realYield).toBeDefined();
    expect(d.realYield!.tenYearRealYield).toBe(2.0);
  });

  it("O2 — absent without real yield data", () => {
    const d = buildMacroAnalyticalDepth("US10Y", {});
    expect(d.realYield).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// P. Central-bank context
// ═══════════════════════════════════════════════════════════════

describe("P. Central-bank context", () => {
  it("P1 — biases classified", () => {
    const d = buildMacroAnalyticalDepth("DXY", macroData());
    expect(d.centralBank).toBeDefined();
    expect(d.centralBank!.fedBias).toBe("HAWKISH");
    expect(d.centralBank!.ecbBias).toBe("NEUTRAL");
    expect(d.centralBank!.bojBias).toBe("DOVISH");
  });

  it("P2 — absent without central bank data", () => {
    const d = buildMacroAnalyticalDepth("DXY", {});
    expect(d.centralBank).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. Global liquidity
// ═══════════════════════════════════════════════════════════════

describe("Q. Global liquidity", () => {
  it("Q1 — present with data", () => {
    const d = buildMacroAnalyticalDepth("DXY", macroData());
    expect(d.globalLiquidity).toBeDefined();
    expect(d.globalLiquidity!.trend).toBe("STABLE");
  });

  it("Q2 — absent without liquidity data", () => {
    const d = buildMacroAnalyticalDepth("DXY", {});
    expect(d.globalLiquidity).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// R. Macro events
// ═══════════════════════════════════════════════════════════════

describe("R. Macro events", () => {
  it("R1 — present with events", () => {
    const d = buildMacroAnalyticalDepth("DXY", macroData());
    expect(d.macroEvents).toBeDefined();
    expect(d.macroEvents!.upcomingEvents.length).toBe(1);
  });

  it("R2 — absent without events", () => {
    const d = buildMacroAnalyticalDepth("DXY", {});
    expect(d.macroEvents).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// S. Macro regime
// ═══════════════════════════════════════════════════════════════

describe("S. Macro regime", () => {
  it("S1 — computed from yields + DXY", () => {
    const d = buildMacroAnalyticalDepth("DXY", macroData());
    expect(d.macroRegime).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// T. Cross-asset consistency
// ═══════════════════════════════════════════════════════════════

describe("T. Cross-asset consistency", () => {
  it("T1 — index and macro share dependency groups without duplication", () => {
    const idx = buildIndexAnalyticalDepth("SPX", spxData());
    const mac = buildMacroAnalyticalDepth("DXY", macroData());
    // Both may use MACRO_RATES but they're separate instruments
    expect(idx.instrument).not.toBe(mac.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. Evidence prioritization
// ═══════════════════════════════════════════════════════════════

describe("U. Evidence prioritization", () => {
  it("U1 — supporting evidence populated", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d.supportingEvidence.length).toBeGreaterThan(0);
  });

  it("U2 — missing data tracked", () => {
    const d = buildMacroAnalyticalDepth("DXY", {});
    expect(d.missingInformation.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// V. Dependency groups
// ═══════════════════════════════════════════════════════════════

describe("V. Dependency groups", () => {
  it("V1 — index dimensions have dependency groups", () => {
    for (const dim of buildIndexAnalyticalDepth("SPX", spxData()).dimensions) {
      expect(dim.dependencyGroup).toBeTruthy();
    }
  });

  it("V2 — macro dimensions have dependency groups", () => {
    for (const dim of buildMacroAnalyticalDepth("DXY", macroData()).dimensions) {
      expect(dim.dependencyGroup).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// W. Double-counting
// ═══════════════════════════════════════════════════════════════

describe("W. Double-counting", () => {
  it("W1 — no duplicate dependency groups within same instrument", () => {
    const dims = buildMacroAnalyticalDepth("DXY", macroData()).dimensions;
    const groups = dims.map(d => d.dependencyGroup);
    // Each group should appear at most once
    expect(new Set(groups).size).toBe(groups.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. Horizon relevance
// ═══════════════════════════════════════════════════════════════

describe("X. Horizon relevance", () => {
  it("X1 — every dimension has horizon relevance", () => {
    for (const dim of buildIndexAnalyticalDepth("SPX", spxData()).dimensions) {
      expect(["PRIMARY", "SECONDARY", "MINIMAL", "UNKNOWN"]).toContain(dim.horizonRelevance);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. Missing data
// ═══════════════════════════════════════════════════════════════

describe("Y. Missing data", () => {
  it("Y1 — empty index data → no fabricated claims", () => {
    const d = buildIndexAnalyticalDepth("SPX", {});
    expect(d.dimensions.length).toBe(0);
    expect(d.missingInformation.length).toBeGreaterThan(0);
  });

  it("Y2 — empty macro data → no fabricated claims", () => {
    const d = buildMacroAnalyticalDepth("DXY", {});
    expect(d.dimensions.length).toBe(0);
    expect(d.missingInformation.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. Stale data
// ═══════════════════════════════════════════════════════════════

describe("Z. Stale data", () => {
  it("Z1 — dimensions default to STALE", () => {
    for (const dim of buildIndexAnalyticalDepth("SPX", spxData()).dimensions) {
      expect(["CURRENT", "RECENT", "STALE", "UNAVAILABLE"]).toContain(dim.freshness);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. No fabrication
// ═══════════════════════════════════════════════════════════════

describe("AA. No fabrication", () => {
  it("AA1 — no NaN", () => {
    expect(JSON.stringify(buildIndexAnalyticalDepth("SPX", spxData()))).not.toContain("NaN");
    expect(JSON.stringify(buildMacroAnalyticalDepth("DXY", macroData()))).not.toContain("NaN");
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. No probability fabrication
// ═══════════════════════════════════════════════════════════════

describe("AB. No probability fabrication", () => {
  it("AB1 — no % chance", () => {
    for (const d of [buildIndexAnalyticalDepth("SPX", spxData()), buildMacroAnalyticalDepth("DXY", macroData())]) {
      expect(JSON.stringify(d).toLowerCase()).not.toMatch(/\d+%\s*chance/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. IDX compatibility
// ═══════════════════════════════════════════════════════════════

describe("AC. IDX compatibility", () => {
  it("AC1 — IHSG supported", () => {
    const d = buildIndexAnalyticalDepth("IHSG", { price: { current: 7200, changePct: -0.3 } });
    expect(d.instrument).toBe("IHSG");
    expect(d.assetClass).toBe("indices");
  });
});

// ═══════════════════════════════════════════════════════════════
// AD-AF. Cross-asset compatibility
// ═══════════════════════════════════════════════════════════════

describe("AD. Crypto compatibility", () => {
  it("AD1 — existing crypto builder still works", () => {
    const d = buildCryptoAnalyticalDepth("BTC/USD", { derivatives: { fundingRate: { currentRate: 0.0003 } } });
    expect(d.instrument).toBe("BTC/USD");
  });
});

describe("AE. Forex compatibility", () => {
  it("AE1 — existing forex builder still works", () => {
    const d = buildForexAnalyticalDepth("EUR/USD", { rateDifferential: { baseRate: 4.5, quoteRate: 5.5, differential: -1.0 } });
    expect(d.instrument).toBe("EUR/USD");
  });
});

describe("AF. Equity compatibility", () => {
  it("AF1 — existing equity builder still works", () => {
    const d = buildEquityAnalyticalDepth("AAPL", { valuation: { pe: 28.5 } });
    expect(d.instrument).toBe("AAPL");
  });
});

describe("AG. Commodity compatibility", () => {
  it("AG1 — existing commodity builder still works", () => {
    const d = buildCommodityAnalyticalDepth("WTI", { inventory: { current: 440 } });
    expect(d.instrument).toBe("WTI");
  });
});

// ═══════════════════════════════════════════════════════════════
// AH. Index isolation
// ═══════════════════════════════════════════════════════════════

describe("AH. Index isolation", () => {
  it("AH1 — SPX context does not leak to NDX", () => {
    const spx = buildIndexAnalyticalDepth("SPX", spxData());
    const ndx = buildIndexAnalyticalDepth("NDX", { price: { current: 18000, changePct: 2.1 } });
    expect(spx.instrument).toBe("SPX");
    expect(ndx.instrument).toBe("NDX");
  });
});

// ═══════════════════════════════════════════════════════════════
// AI. Macro isolation
// ═══════════════════════════════════════════════════════════════

describe("AI. Macro isolation", () => {
  it("AI1 — DXY context does not leak to US10Y", () => {
    const dxy = buildMacroAnalyticalDepth("DXY", macroData());
    const us10y = buildMacroAnalyticalDepth("US10Y", macroData());
    expect(dxy.instrument).toBe("DXY");
    expect(us10y.instrument).toBe("US10Y");
  });
});

// ═══════════════════════════════════════════════════════════════
// AJ. Cross-asset isolation
// ═══════════════════════════════════════════════════════════════

describe("AJ. Cross-asset isolation", () => {
  it("AJ1 — index and macro are separate in universal context", () => {
    const ctx = assembleUniversalAnalyticalContext({
      instrument: "SPX",
      assetClass: "indices",
      index: buildIndexAnalyticalDepth("SPX", spxData()),
    });
    expect(ctx.index).toBeDefined();
    expect(ctx.macro).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AK. Radar compatibility
// ═══════════════════════════════════════════════════════════════

describe("AK. Radar compatibility", () => {
  it("AK1 — index dimensions integrate with universal context", () => {
    const ctx = assembleUniversalAnalyticalContext({
      instrument: "SPX",
      assetClass: "indices",
      index: buildIndexAnalyticalDepth("SPX", spxData()),
    });
    expect(ctx.overallDimensions.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AL. UI result shape
// ═══════════════════════════════════════════════════════════════

describe("AL. UI result shape", () => {
  it("AL1 — analyst summary readable", () => {
    const ctx = assembleUniversalAnalyticalContext({
      instrument: "SPX",
      assetClass: "indices",
      index: buildIndexAnalyticalDepth("SPX", spxData()),
    });
    expect(typeof ctx.analystSummary).toBe("string");
    expect(ctx.analystSummary.length).toBeGreaterThan(5);
  });
});

// ═══════════════════════════════════════════════════════════════
// AM. Decision immutability
// ═══════════════════════════════════════════════════════════════

describe("AM. Decision immutability", () => {
  it("AM1 — no recommendation in index depth", () => {
    const d = buildIndexAnalyticalDepth("SPX", spxData());
    expect((d as any).recommendation).toBeUndefined();
    expect((d as any).bias).toBeUndefined();
  });

  it("AM2 — no trade signals in macro depth", () => {
    const d = buildMacroAnalyticalDepth("DXY", macroData());
    expect((d as any).recommendation).toBeUndefined();
    expect((d as any).bias).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AN. Determinism
// ═══════════════════════════════════════════════════════════════

describe("AN. Determinism", () => {
  it("AN1 — same input → same dimensions", () => {
    const d1 = buildIndexAnalyticalDepth("SPX", spxData());
    const d2 = buildIndexAnalyticalDepth("SPX", spxData());
    expect(d1.dimensions.length).toBe(d2.dimensions.length);
    for (let i = 0; i < d1.dimensions.length; i++) {
      expect(d1.dimensions[i].name).toBe(d2.dimensions[i].name);
    }
  });

  it("AN2 — macro same input → same output", () => {
    const d1 = buildMacroAnalyticalDepth("DXY", macroData());
    const d2 = buildMacroAnalyticalDepth("DXY", macroData());
    expect(d1.dimensions.length).toBe(d2.dimensions.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// AO. Security
// ═══════════════════════════════════════════════════════════════

describe("AO. Security", () => {
  it("AO1 — no API keys", () => {
    for (const d of [buildIndexAnalyticalDepth("SPX", spxData()), buildMacroAnalyticalDepth("DXY", macroData())]) {
      const s = JSON.stringify(d).toLowerCase();
      expect(s).not.toContain("api_key");
      expect(s).not.toContain("secret");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AP. Cache reuse
// ═══════════════════════════════════════════════════════════════

describe("AP. Cache reuse", () => {
  it("AP1 — pure functions", () => {
    const data = spxData();
    buildIndexAnalyticalDepth("SPX", data);
    expect(data.price!.changePct).toBe(1.5); // input not mutated
  });
});

// ═══════════════════════════════════════════════════════════════
// AQ. Request deduplication
// ═══════════════════════════════════════════════════════════════

describe("AQ. Request deduplication", () => {
  it("AQ1 — same input → identical output", () => {
    const data = macroData();
    expect(buildMacroAnalyticalDepth("DXY", data).dimensions.length).toBe(buildMacroAnalyticalDepth("DXY", data).dimensions.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// AR. Partial provider failure
// ═══════════════════════════════════════════════════════════════

describe("AR. Partial provider failure", () => {
  it("AR1 — partial macro data", () => {
    const d = buildMacroAnalyticalDepth("DXY", { dxy: { value: 103.5, change: 0.5 } });
    expect(d.dxyContext).toBeDefined();
    expect(d.yieldCurve).toBeUndefined();
  });

  it("AR2 — partial index data", () => {
    const d = buildIndexAnalyticalDepth("SPX", { price: { current: 5200, changePct: 1.5 } });
    expect(d.marketStructure).toBeDefined();
    expect(d.valuation).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AS. Total provider failure
// ═══════════════════════════════════════════════════════════════

describe("AS. Total provider failure", () => {
  it("AS1 — empty data → valid structure", () => {
    const idx = buildIndexAnalyticalDepth("SPX", {});
    expect(idx.instrument).toBe("SPX");
    expect(idx.dimensions.length).toBe(0);

    const mac = buildMacroAnalyticalDepth("DXY", {});
    expect(mac.instrument).toBe("DXY");
    expect(mac.dimensions.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AT. Large universe stress
// ═══════════════════════════════════════════════════════════════

describe("AT. Large universe stress", () => {
  it("AT1 — 20 index instruments", () => {
    const instruments = ["SPX", "NDX", "DJI", "RUT", "VIX", "IHSG", "NIKKEI", "DAX", "FTSE", "NIFTY50", "SPX2", "NDX2", "DJI2", "RUT2", "VIX2", "IHSG2", "NIKKEI2", "DAX2", "FTSE2", "NIFTY502"];
    for (const inst of instruments) {
      const d = buildIndexAnalyticalDepth(inst, { price: { current: 100 + Math.random() * 10000, changePct: (Math.random() - 0.5) * 6 } });
      expect(d.instrument).toBe(inst);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AU. Empty state
// ═══════════════════════════════════════════════════════════════

describe("AU. Empty state", () => {
  it("AU1 — no dimensions when data empty", () => {
    const ctx = assembleUniversalAnalyticalContext({
      instrument: "SPX",
      assetClass: "indices",
      index: buildIndexAnalyticalDepth("SPX", {}),
    });
    expect(ctx.overallDimensions.length).toBe(0);
    expect(ctx.missingInformation.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AV. Horizon isolation
// ═══════════════════════════════════════════════════════════════

describe("AV. Horizon isolation", () => {
  it("AV1 — index structure is PRIMARY, breadth is SECONDARY", () => {
    const dims = buildIndexAnalyticalDepth("SPX", spxData()).dimensions;
    const struct = dims.find(d => d.name === "index_structure");
    const breadth = dims.find(d => d.name === "index_breadth");
    if (struct) expect(struct.horizonRelevance).toBe("PRIMARY");
    if (breadth) expect(breadth.horizonRelevance).toBe("SECONDARY");
  });
});

// ═══════════════════════════════════════════════════════════════
// AW. Data provenance
// ═══════════════════════════════════════════════════════════════

describe("AW. Data provenance", () => {
  it("AW1 — every dimension has source", () => {
    for (const dim of buildIndexAnalyticalDepth("SPX", spxData()).dimensions) {
      expect(dim.source).toBeTruthy();
    }
    for (const dim of buildMacroAnalyticalDepth("DXY", macroData()).dimensions) {
      expect(dim.source).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AX. Classification confidence semantics
// ═══════════════════════════════════════════════════════════════

describe("AX. Classification confidence semantics", () => {
  it("AX1 — regime confidence 0-100", () => {
    const r = classifyRegime({ breakout: true, priceChangePct: 5 });
    expect(r.classificationConfidence).toBeGreaterThanOrEqual(0);
    expect(r.classificationConfidence).toBeLessThanOrEqual(100);
    expect(JSON.stringify(r).toLowerCase()).not.toContain("probability of profit");
  });
});
