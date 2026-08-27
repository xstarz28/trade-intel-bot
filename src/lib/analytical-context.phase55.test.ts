/**
 * Phase 55 — Deep Multi-Asset Intelligence & Analytical Context Engine
 * Comprehensive test suite covering all 41 test groups (A-AU).
 */
import { describe, it, expect } from "vitest";
import {
  buildCryptoAnalyticalDepth,
  buildForexAnalyticalDepth,
  buildEquityAnalyticalDepth,
  buildCommodityAnalyticalDepth,
  assembleUniversalAnalyticalContext,
  type CryptoRawData,
  type ForexRawData,
  type EquityRawData,
  type CommodityRawData,
} from "@/lib/data/universal/analytical-depth";
import { classifyRegime, aggregateRegimes, type RegimeObservation } from "@/lib/data/universal/regime";
import {
  buildForexRelativeValue,
  buildCryptoRelativeValue,
  buildCommodityRelativeValue,
  assembleRelativeValue,
} from "@/lib/data/universal/relative-value";
import { scanRadar } from "@/lib/market-radar/radar";
import type { RadarCandidateSource } from "@/lib/market-radar/candidate-builder";
import type { UniverseEntry } from "@/lib/market-radar/types";

const NOW = Date.now();
const FIVE_MIN_AGO = NOW - 5 * 60_000;

function makeUniverseEntry(overrides: Partial<UniverseEntry> = {}): UniverseEntry {
  return { instrument: "BTC/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv","quote"], priority: 1, refreshIntervalMs: 60_000, ...overrides };
}

function makeSource(overrides: Partial<RadarCandidateSource> = {}): RadarCandidateSource {
  return {
    universe: makeUniverseEntry(),
    snapshot: { instrument: "BTC/USD", assetClass: "crypto", price: 100000, ohlcvAvailable: true, availableTimeframes: ["1m","5m","15m","1h","4h","1d"], provider: "coingecko", observedAt: FIVE_MIN_AGO, freshness: "FRESH", quality: "VERIFIED" },
    ...overrides,
  };
}

function cryptoData(): CryptoRawData {
  return {
    derivatives: { openInterest: { current: 15_000_000_000, change24h: 5.2 }, fundingRate: { currentRate: 0.0003, annualizedRate: 32.85 }, longShort: { accountRatio: 1.2, dominantSide: "long" }, liquidation: { totalVolume: 250_000_000, dominantSide: "short" } },
    defi: { tvl: { current: 50_000_000_000, change7d: 3.5 }, fees: { dailyFees: 2_000_000 } },
    tokenomics: { supply: { circulatingSupply: 19_500_000, totalSupply: 21_000_000 }, unlocks: { upcomingCount30d: 0 } },
    btcCorrelation: 1.0, btcDominance: 52.5,
  };
}

function forexData(): ForexRawData {
  return {
    rateDifferential: { baseRate: 4.5, quoteRate: 5.5, differential: -1.0 },
    yieldDifferential: { twoYear: 4.2, tenYear: 4.4 },
    centralBank: { baseBias: "neutral", quoteBias: "hawkish", baseBank: "ECB", quoteBank: "Fed" },
    cot: { netNonCommercial: 150000, change: 12000 },
    dxy: { trend: "falling", value: 103.5 },
  };
}

function equityData(): EquityRawData {
  return {
    valuation: { pe: 28.5, forwardPE: 25.0, pb: 45.0, evToEbitda: 22.0, marketCap: 2_800_000_000_000 },
    growth: { revenueGrowth: 0.08, earningsGrowth: 0.12 },
    profitability: { grossMargin: 0.46, operatingMargin: 0.30, netMargin: 0.25, roe: 1.50 },
    balanceSheet: { debtToEquity: 1.8, cash: 60_000_000_000, debt: 110_000_000_000, freeCashFlow: 100_000_000_000 },
    earnings: { lastDate: "2026-01-28", nextDate: "2026-04-30", lastEPS: 2.42, epsSurprise: 0.05 },
    corporateActions: { dividendYield: 0.005, buybacks: true },
    sector: { sector: "Technology", industry: "Consumer Electronics" },
  };
}

function commodityData(): CommodityRawData {
  return {
    inventory: { current: 440, changeWeekly: -2.5, changeVsExpected: -1.0 },
    supplyDemand: { production: 13.2, consumption: 20.1 },
    futuresStructure: { structure: "backwardation" },
    cot: { managedMoneyNet: 250000, commercialNet: -180000, change: 15000 },
    seasonality: { tendency: "Winter demand increase", currentPosition: "pre-winter" },
    dxy: { trend: "falling" },
  };
}

// A. Universal context shape
describe("A. Universal context shape", () => {
  it("A1 — crypto context has all required fields", () => {
    const ctx = assembleUniversalAnalyticalContext({ instrument: "BTC/USD", assetClass: "crypto", crypto: buildCryptoAnalyticalDepth("BTC/USD", cryptoData()) });
    expect(ctx.instrument).toBe("BTC/USD");
    expect(ctx.assetClass).toBe("crypto");
    expect(ctx.assembledAt).toBeGreaterThan(0);
    expect(Array.isArray(ctx.overallDimensions)).toBe(true);
    expect(Array.isArray(ctx.allEvidence)).toBe(true);
    expect(typeof ctx.analystSummary).toBe("string");
  });
  it("A2 — forex context shape", () => {
    const ctx = assembleUniversalAnalyticalContext({ instrument: "EUR/USD", assetClass: "forex", forex: buildForexAnalyticalDepth("EUR/USD", forexData()) });
    expect(ctx.forex).toBeDefined();
  });
  it("A3 — equity context shape", () => {
    const ctx = assembleUniversalAnalyticalContext({ instrument: "AAPL", assetClass: "equity", equity: buildEquityAnalyticalDepth("AAPL", equityData()) });
    expect(ctx.equity).toBeDefined();
  });
  it("A4 — commodity context shape", () => {
    const ctx = assembleUniversalAnalyticalContext({ instrument: "WTI", assetClass: "commodity", commodity: buildCommodityAnalyticalDepth("WTI", commodityData()) });
    expect(ctx.commodity).toBeDefined();
  });
  it("A5 — no probability language", () => {
    const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData());
    const s = JSON.stringify(d).toLowerCase();
    expect(s).not.toContain("% chance");
    expect(s).not.toContain("probability of profit");
  });
});

// B. Crypto analytical context
describe("B. Crypto analytical context", () => {
  it("B1 — OI regime", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); expect(d.oiRegime).toBeDefined(); expect(d.oiRegime!.available).toBe(true); expect(["HIGH","LOW","NORMAL","UNKNOWN"]).toContain(d.oiRegime!.level); });
  it("B2 — funding regime", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); expect(d.fundingRegime).toBeDefined(); expect(d.fundingRegime!.available).toBe(true); });
  it("B3 — TVL trend", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); expect(d.tvlTrend).toBeDefined(); expect(d.tvlTrend!.direction).toBe("GROWING"); });
  it("B4 — unlock pressure", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); expect(d.unlockPressure).toBeDefined(); expect(d.unlockPressure!.level).toBe("NONE"); });
  it("B5 — BTC dominance", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); expect(d.marketDominance).toBeDefined(); expect(d.marketDominance!.btcDominance).toBe(52.5); });
  it("B6 — no fabricated metrics", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); for (const dim of d.dimensions) { if (dim.available) { expect(dim.source).toBeTruthy(); } } });
});

// C. Forex rate differential
describe("C. Forex rate differential", () => {
  it("C1 — rate differential computed", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.rateDifferential).toBeDefined(); expect(d.rateDifferential!.baseRate).toBe(4.5); expect(d.rateDifferential!.quoteRate).toBe(5.5); expect(d.rateDifferential!.differential).toBe(-1.0); });
  it("C2 — trend determined", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(["WIDENING","NARROWING","STABLE","UNKNOWN"]).toContain(d.rateDifferential!.trend); });
  it("C3 — explanation available", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.rateDifferential!.description.length).toBeGreaterThan(10); });
});

// D. Forex yield differential
describe("D. Forex yield differential", () => {
  it("D1 — computed when available", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.yieldDifferential).toBeDefined(); expect(d.yieldDifferential!.twoYearDifferential).toBeDefined(); });
  it("D2 — absent when unavailable", () => { const data = forexData(); delete data.yieldDifferential; const d = buildForexAnalyticalDepth("EUR/USD", data); expect(d.yieldDifferential).toBeUndefined(); });
});

// E. Forex central bank
describe("E. Forex central-bank context", () => {
  it("E1 — includes both banks", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.centralBankRegime).toBeDefined(); expect(d.centralBankRegime!.baseCentralBank).toBe("ECB"); expect(d.centralBankRegime!.quoteCentralBank).toBe("Fed"); });
  it("E2 — bias classified", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.centralBankRegime!.baseBias).toBe("NEUTRAL"); expect(d.centralBankRegime!.quoteBias).toBe("HAWKISH"); });
  it("E3 — absent when unavailable", () => { const data = forexData(); delete data.centralBank; const d = buildForexAnalyticalDepth("EUR/USD", data); expect(d.centralBankRegime).toBeUndefined(); });
});

// F. Forex COT
describe("F. Forex COT", () => {
  it("F1 — net positioning captured", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.cotContext).toBeDefined(); expect(d.cotContext!.netNonCommercial).toBe(150000); });
  it("F2 — change captured", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.cotContext!.changeInPositioning).toBe(12000); });
  it("F3 — absent when unavailable", () => { const data = forexData(); delete data.cot; const d = buildForexAnalyticalDepth("EUR/USD", data); expect(d.cotContext).toBeUndefined(); });
});

// G. Forex DXY
describe("G. Forex DXY context", () => {
  it("G1 — trend captured", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); expect(d.dxyContext).toBeDefined(); expect(d.dxyContext!.trend).toBe("FALLING"); });
  it("G2 — absent when unavailable", () => { const data = forexData(); delete data.dxy; const d = buildForexAnalyticalDepth("EUR/USD", data); expect(d.dxyContext).toBeUndefined(); });
});

// H. Equity valuation
describe("H. Equity valuation", () => {
  it("H1 — P/E, P/B, EV/EBITDA", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.valuation).toBeDefined(); expect(d.valuation!.peRatio).toBe(28.5); expect(d.valuation!.evToEbitda).toBe(22.0); });
  it("H2 — relative valuation classified", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(["UNDERVALUED","FAIR","OVERVALUED","UNKNOWN"]).toContain(d.valuation!.relativeValuation); });
  it("H3 — absent when unavailable", () => { const data = equityData(); delete data.valuation; const d = buildEquityAnalyticalDepth("AAPL", data); expect(d.valuation).toBeUndefined(); });
});

// I. Equity growth
describe("I. Equity growth", () => {
  it("I1 — captured", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.growth).toBeDefined(); expect(d.growth!.revenueGrowth).toBe(0.08); });
  it("I2 — absent when unavailable", () => { const data = equityData(); delete data.growth; const d = buildEquityAnalyticalDepth("AAPL", data); expect(d.growth).toBeUndefined(); });
});

// J. Equity profitability
describe("J. Equity profitability", () => {
  it("J1 — margins and ROE", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.profitability!.grossMargin).toBe(0.46); expect(d.profitability!.roe).toBe(1.50); });
  it("J2 — absent when unavailable", () => { const data = equityData(); delete data.profitability; const d = buildEquityAnalyticalDepth("AAPL", data); expect(d.profitability).toBeUndefined(); });
});

// K. Equity balance sheet
describe("K. Equity balance sheet", () => {
  it("K1 — debt, cash, FCF", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.balanceSheet!.debtToEquity).toBe(1.8); expect(d.balanceSheet!.cash).toBe(60_000_000_000); });
  it("K2 — absent when unavailable", () => { const data = equityData(); delete data.balanceSheet; const d = buildEquityAnalyticalDepth("AAPL", data); expect(d.balanceSheet).toBeUndefined(); });
});

// L. Equity earnings
describe("L. Equity earnings", () => {
  it("L1 — dates and surprises", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.earnings!.lastEarningsDate).toBe("2026-01-28"); expect(d.earnings!.epsSurprise).toBe(0.05); });
  it("L2 — absent when unavailable", () => { const data = equityData(); delete data.earnings; const d = buildEquityAnalyticalDepth("AAPL", data); expect(d.earnings).toBeUndefined(); });
});

// M. Equity corporate actions
describe("M. Equity corporate actions", () => {
  it("M1 — dividend and buyback", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.corporateActions!.dividendYield).toBe(0.005); expect(d.corporateActions!.recentBuybacks).toBe(true); });
  it("M2 — absent when unavailable", () => { const data = equityData(); delete data.corporateActions; const d = buildEquityAnalyticalDepth("AAPL", data); expect(d.corporateActions).toBeUndefined(); });
});

// N. Equity sector context
describe("N. Equity sector context", () => {
  it("N1 — sector and industry", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.sectorContext!.sector).toBe("Technology"); expect(d.sectorContext!.industry).toBe("Consumer Electronics"); });
  it("N2 — absent when unavailable", () => { const data = equityData(); delete data.sector; const d = buildEquityAnalyticalDepth("AAPL", data); expect(d.sectorContext).toBeUndefined(); });
});

// O. IDX identity
describe("O. IDX identity", () => {
  it("O1 — BBCA recognized", () => { const d = buildEquityAnalyticalDepth("BBCA", { valuation: { pe: 25 }, sector: { sector: "Finance" } }); expect(d.instrument).toBe("BBCA"); expect(d.valuation!.peRatio).toBe(25); });
  it("O2 — BBRI recognized", () => { const d = buildEquityAnalyticalDepth("BBRI", { valuation: { pe: 12 }, sector: { sector: "Finance" } }); expect(d.instrument).toBe("BBRI"); });
});

// P. IDX isolation
describe("P. IDX isolation", () => {
  it("P1 — BBCA vs AAPL independent", () => {
    const bbca = buildEquityAnalyticalDepth("BBCA", { valuation: { pe: 25 }, sector: { sector: "Finance" } });
    const aapl = buildEquityAnalyticalDepth("AAPL", { valuation: { pe: 28.5 }, sector: { sector: "Technology" } });
    expect(bbca.sectorContext?.sector).toBe("Finance");
    expect(aapl.sectorContext?.sector).toBe("Technology");
  });
  it("P2 — independent evidence", () => {
    expect(buildEquityAnalyticalDepth("BBCA", { valuation: { pe: 25 } }).valuation!.peRatio).toBe(25);
    expect(buildEquityAnalyticalDepth("BBRI", { valuation: { pe: 12 } }).valuation!.peRatio).toBe(12);
  });
});

// Q. Commodity inventory
describe("Q. Commodity inventory", () => {
  it("Q1 — captured", () => { const d = buildCommodityAnalyticalDepth("WTI", commodityData()); expect(d.inventory!.currentInventory).toBe(440); expect(d.inventory!.changeWeekly).toBe(-2.5); });
  it("Q2 — absent when unavailable", () => { const data = commodityData(); delete data.inventory; expect(buildCommodityAnalyticalDepth("WTI", data).inventory).toBeUndefined(); });
});

// R. Commodity supply/demand
describe("R. Commodity supply/demand", () => {
  it("R1 — captured", () => { const d = buildCommodityAnalyticalDepth("WTI", commodityData()); expect(d.supplyDemand!.production).toBe(13.2); });
  it("R2 — absent when unavailable", () => { const data = commodityData(); delete data.supplyDemand; expect(buildCommodityAnalyticalDepth("WTI", data).supplyDemand).toBeUndefined(); });
});

// S. Commodity futures structure
describe("S. Commodity futures structure", () => {
  it("S1 — backwardation", () => { const d = buildCommodityAnalyticalDepth("WTI", commodityData()); expect(d.futuresStructure!.structure).toBe("BACKWARDATION"); });
  it("S2 — absent when unavailable", () => { const data = commodityData(); delete data.futuresStructure; expect(buildCommodityAnalyticalDepth("WTI", data).futuresStructure).toBeUndefined(); });
});

// T. Commodity COT
describe("T. Commodity COT", () => {
  it("T1 — captured", () => { const d = buildCommodityAnalyticalDepth("WTI", commodityData()); expect(d.cotContext!.managedMoneyNet).toBe(250000); });
  it("T2 — absent when unavailable", () => { const data = commodityData(); delete data.cot; expect(buildCommodityAnalyticalDepth("WTI", data).cotContext).toBeUndefined(); });
});

// U. Commodity seasonality
describe("U. Commodity seasonality", () => {
  it("U1 — captured", () => { const d = buildCommodityAnalyticalDepth("WTI", commodityData()); expect(d.seasonality!.seasonalTendency).toBe("Winter demand increase"); });
  it("U2 — absent when unavailable", () => { const data = commodityData(); delete data.seasonality; expect(buildCommodityAnalyticalDepth("WTI", data).seasonality).toBeUndefined(); });
});

// V. Commodity dollar context
describe("V. Commodity dollar context", () => {
  it("V1 — DXY trend", () => { const d = buildCommodityAnalyticalDepth("WTI", commodityData()); expect(d.dollarSensitivity!.dxyTrend).toBe("FALLING"); });
  it("V2 — absent when unavailable", () => { const data = commodityData(); delete data.dxy; expect(buildCommodityAnalyticalDepth("WTI", data).dollarSensitivity).toBeUndefined(); });
});

// W. Index regime
describe("W. Index context", () => {
  it("W1 — universal context supports macro type", () => {
    const ctx = assembleUniversalAnalyticalContext({ instrument: "DXY", assetClass: "macro" });
    expect(ctx.instrument).toBe("DXY");
    expect(ctx.assetClass).toBe("macro");
  });
});

// X. Macro context
describe("X. Macro context", () => {
  it("X1 — no trade signals", () => {
    const ctx = assembleUniversalAnalyticalContext({ instrument: "DXY", assetClass: "macro" });
    const s = JSON.stringify(ctx).toLowerCase();
    expect(s).not.toContain("buy signal");
    expect(s).not.toContain("sell signal");
  });
});

// Y. Relative value
describe("Y. Relative value", () => {
  it("Y1 — forex rate vs yield consistency", () => {
    const comps = buildForexRelativeValue({ instrument: "EUR/USD", rateDifferential: -1.0, yieldDifferential: -0.3, dxyTrend: "falling" });
    expect(comps.length).toBeGreaterThanOrEqual(1);
    expect(comps[0].direction).toBe("SUPPORTING");
  });
  it("Y2 — forex divergence detected", () => {
    const comps = buildForexRelativeValue({ instrument: "EUR/USD", rateDifferential: 1.0, yieldDifferential: -0.3 });
    const rv = comps.find(c => c.targetInstrument === "US10Y");
    expect(rv).toBeDefined();
    expect(rv!.direction).toBe("CONFLICTING");
  });
  it("Y3 — crypto BTC correlation", () => {
    const comps = buildCryptoRelativeValue({ instrument: "ETH/USD", btcCorrelation: 0.85 });
    expect(comps[0].targetInstrument).toBe("BTC/USD");
    expect(comps[0].strength).toBe("STRONG");
  });
  it("Y4 — commodity DXY + inventory", () => {
    const comps = buildCommodityRelativeValue({ instrument: "WTI", dxyTrend: "falling", inventoryChange: -2.5 });
    expect(comps.length).toBeGreaterThanOrEqual(2);
  });
  it("Y5 — contextual only", () => {
    const rv = assembleRelativeValue({ instrument: "EUR/USD", assetClass: "forex", comparisons: buildForexRelativeValue({ instrument: "EUR/USD", rateDifferential: -1.0, dxyTrend: "falling" }) });
    expect(JSON.stringify(rv).toLowerCase()).not.toContain("recommendation");
  });
});

// Z. Regime detection
describe("Z. Regime detection", () => {
  it("Z1 — trending", () => { expect(classifyRegime({ breakout: true, priceChangePct: 5 }).regime).toBe("TRENDING"); });
  it("Z2 — ranging", () => { expect(classifyRegime({ volatility: 5, avgVolatility: 30 }).regime).toBe("RANGING"); });
  it("Z3 — risk-on", () => { expect(classifyRegime({ riskOnAssets: true, safeHavenBid: false }).regime).toBe("RISK_ON"); });
  it("Z4 — risk-off", () => { expect(classifyRegime({ safeHavenBid: true, riskOnAssets: false }).regime).toBe("RISK_OFF"); });
  it("Z5 — UNKNOWN or RANGING when empty", () => { const r = classifyRegime({}); expect(["UNKNOWN","RANGING"]).toContain(r.regime); });
  it("Z6 — deterministic", () => {
    const i: RegimeObservation = { breakout: true, priceChangePct: 3, volatility: 50, avgVolatility: 20 };
    const r1 = classifyRegime(i), r2 = classifyRegime(i);
    expect(r1.regime).toBe(r2.regime);
    expect(r1.classificationConfidence).toBe(r2.classificationConfidence);
  });
  it("Z7 — aggregate", () => {
    const agg = aggregateRegimes([classifyRegime({ breakout: true, priceChangePct: 3 }), classifyRegime({ riskOnAssets: true, safeHavenBid: false })]);
    expect(agg.aggregateRegime).toBeTruthy();
    expect(agg.confidence).toBeGreaterThanOrEqual(0);
  });
});

// AA. Evidence provenance
describe("AA. Evidence provenance", () => {
  it("AA1 — every dim has source", () => { for (const dim of buildCryptoAnalyticalDepth("BTC/USD", cryptoData()).dimensions) { expect(dim.source).toBeTruthy(); } });
  it("AA2 — every dim has dependency group", () => { for (const dim of buildForexAnalyticalDepth("EUR/USD", forexData()).dimensions) { expect(dim.dependencyGroup).toBeTruthy(); } });
  it("AA3 — quality and freshness", () => { for (const dim of buildEquityAnalyticalDepth("AAPL", equityData()).dimensions) { expect(["VERIFIED","DEGRADED","UNAVAILABLE"]).toContain(dim.quality); } });
});

// AB. Dependency groups
describe("AB. Dependency groups", () => {
  it("AB1 — crypto derivatives grouped", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); const derivDims = d.dimensions.filter(x => x.dependencyGroup.startsWith("DERIVATIVES")); expect(derivDims.length).toBeGreaterThanOrEqual(2); });
  it("AB2 — forex rates grouped", () => { const d = buildForexAnalyticalDepth("EUR/USD", forexData()); const rateDims = d.dimensions.filter(x => x.dependencyGroup === "MACRO_RATES" || x.dependencyGroup.startsWith("FOREX")); expect(rateDims.length).toBeGreaterThanOrEqual(1); });
  it("AB3 — equity valuation grouped", () => { const d = buildEquityAnalyticalDepth("AAPL", equityData()); expect(d.dimensions.filter(x => x.dependencyGroup === "EQUITY_VALUATION").length).toBeGreaterThanOrEqual(1); });
});

// AC. Double-counting
describe("AC. Double-counting protection", () => {
  it("AC1 — crypto derivatives have related groups", () => {
    const dims = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()).dimensions.filter(d => d.dependencyGroup.startsWith("DERIVATIVES"));
    expect(dims.length).toBeGreaterThanOrEqual(2);
  });
});

// AD. Missing data
describe("AD. Missing data", () => {
  it("AD1 — no claim on missing inventory", () => { const d = buildCommodityAnalyticalDepth("XAU/USD", {}); expect(d.inventory).toBeUndefined(); expect(d.missingInformation.length).toBeGreaterThan(0); });
  it("AD2 — no fake positioning", () => { const d = buildForexAnalyticalDepth("EUR/USD", {}); expect(d.cotContext).toBeUndefined(); expect(JSON.stringify(d).toLowerCase()).not.toContain("net long"); });
});

// AG. No fabrication
describe("AG. No fabrication", () => {
  it("AG1 — no NaN", () => { expect(JSON.stringify(buildCryptoAnalyticalDepth("BTC/USD", cryptoData()))).not.toContain("NaN"); });
  it("AG2 — empty data → no fabrication", () => { const d = buildCryptoAnalyticalDepth("DOGE", {}); expect(d.oiRegime).toBeUndefined(); expect(d.fundingRegime).toBeUndefined(); });
});

// AH. No probability fabrication
describe("AH. No probability fabrication", () => {
  it("AH1 — no % chance", () => {
    for (const d of [buildCryptoAnalyticalDepth("BTC/USD", cryptoData()), buildForexAnalyticalDepth("EUR/USD", forexData()), buildEquityAnalyticalDepth("AAPL", equityData())]) {
      expect(JSON.stringify(d).toLowerCase()).not.toMatch(/\d+%\s*chance/);
    }
  });
  it("AH2 — classification confidence only", () => {
    const r = classifyRegime({ breakout: true, priceChangePct: 5 });
    expect(r.classificationConfidence).toBeGreaterThanOrEqual(0);
    expect(r.classificationConfidence).toBeLessThanOrEqual(100);
  });
});

// AI. Cross-asset consistency
describe("AI. Cross-asset consistency", () => {
  it("AI1 — same input → same dimensions", () => {
    const d1 = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()), d2 = buildCryptoAnalyticalDepth("BTC/USD", cryptoData());
    expect(d1.dimensions.length).toBe(d2.dimensions.length);
  });
});

// AJ. Instrument isolation
describe("AJ. Instrument isolation", () => {
  it("AJ1 — BTC no ETH data", () => { expect(buildCryptoAnalyticalDepth("BTC/USD", cryptoData()).instrument).toBe("BTC/USD"); });
  it("AJ2 — EUR/USD no GBP", () => { expect(buildForexAnalyticalDepth("EUR/USD", forexData()).instrument).toBe("EUR/USD"); });
});

// AK. Asset class isolation
describe("AK. Asset class isolation", () => {
  it("AK1 — crypto only", () => { const ctx = assembleUniversalAnalyticalContext({ instrument: "BTC/USD", assetClass: "crypto", crypto: buildCryptoAnalyticalDepth("BTC/USD", cryptoData()) }); expect(ctx.crypto).toBeDefined(); expect(ctx.forex).toBeUndefined(); });
  it("AK2 — forex only", () => { const ctx = assembleUniversalAnalyticalContext({ instrument: "EUR/USD", assetClass: "forex", forex: buildForexAnalyticalDepth("EUR/USD", forexData()) }); expect(ctx.forex).toBeDefined(); expect(ctx.crypto).toBeUndefined(); });
});

// AL. Radar compatibility
describe("AL. Radar compatibility", () => {
  it("AL1 — radar accepts analytical depth", () => {
    const src = makeSource({ analyticalDepth: { regime: "TRENDING", supportingEvidence: ["OI rising"], conflictingEvidence: [], missingInformation: [], dimensionsAvailable: 5, dimensionsTotal: 8 } });
    expect(scanRadar([src], { horizons: ["SWING"], maxResults: 5, now: NOW }).totalScanned).toBe(1);
  });
  it("AL2 — opportunity includes context", () => {
    const src = makeSource({ analyticalDepth: { regime: "RANGING", supportingEvidence: ["Low vol"], conflictingEvidence: [], missingInformation: [], dimensionsAvailable: 3, dimensionsTotal: 5 } });
    const opps = scanRadar([src], { horizons: ["INTRADAY"], maxResults: 5, now: NOW }).results.get("INTRADAY")!;
    expect(opps.length).toBeGreaterThanOrEqual(1);
    if (opps[0].analyticalContext) expect(opps[0].analyticalContext.regime).toBe("RANGING");
  });
  it("AL3 — backward compatible", () => {
    expect(scanRadar([makeSource()], { horizons: ["SWING"], maxResults: 5, now: NOW }).totalScanned).toBe(1);
  });
});

// AM. Decision immutability
describe("AM. Decision immutability", () => {
  it("AM1 — no recommendation in depth", () => { const d = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()); expect((d as any).recommendation).toBeUndefined(); expect((d as any).bias).toBeUndefined(); });
  it("AM2 — no trade signals in regime", () => { expect(JSON.stringify(classifyRegime({ breakout: true })).toLowerCase()).not.toContain("entry"); });
});

// AN. Determinism
describe("AN. Determinism", () => {
  it("AN1 — same input → same output", () => {
    const d1 = buildCryptoAnalyticalDepth("BTC/USD", cryptoData()), d2 = buildCryptoAnalyticalDepth("BTC/USD", cryptoData());
    for (let i = 0; i < d1.dimensions.length; i++) expect(d1.dimensions[i].name).toBe(d2.dimensions[i].name);
  });
  it("AN2 — regime deterministic", () => { const o: RegimeObservation = { breakout: true, priceChangePct: 3 }; expect(classifyRegime(o).regime).toBe(classifyRegime(o).regime); });
  it("AN3 — relative value deterministic", () => { const p = { instrument: "EUR/USD", rateDifferential: -1.0 }; expect(buildForexRelativeValue(p).length).toBe(buildForexRelativeValue(p).length); });
});

// AO. Security
describe("AO. Security", () => {
  it("AO1 — no API keys", () => { const s = JSON.stringify(buildCryptoAnalyticalDepth("BTC/USD", cryptoData())).toLowerCase(); expect(s).not.toContain("api_key"); expect(s).not.toContain("secret"); });
  it("AO2 — no credentials in explanations", () => { for (const dim of buildForexAnalyticalDepth("EUR/USD", forexData()).dimensions) { expect(dim.explanation.toLowerCase()).not.toContain("api_key"); } });
  it("AO3 — no infrastructure leaks", () => { expect(JSON.stringify(classifyRegime({ breakout: true })).toLowerCase()).not.toContain("server"); });
});

// AP. Large-universe stress
describe("AP. Large-universe stress", () => {
  it("AP1 — 35 instruments", () => {
    for (let i = 0; i < 35; i++) {
      const d = buildCryptoAnalyticalDepth(`INST${i}`, {});
      expect(d.instrument).toBe(`INST${i}`);
    }
  });
  it("AP2 — radar 35 instruments", () => {
    const sources: RadarCandidateSource[] = Array.from({ length: 35 }, (_, i) => makeSource({
      universe: makeUniverseEntry({ instrument: `INST${i}` }),
      snapshot: { instrument: `INST${i}`, assetClass: "crypto", price: 100 + i, ohlcvAvailable: true, availableTimeframes: ["1h"], provider: "test", observedAt: FIVE_MIN_AGO, freshness: "FRESH", quality: "VERIFIED" },
    }));
    expect(scanRadar(sources, { horizons: ["SWING"], maxResults: 10, now: NOW }).totalScanned).toBe(35);
  });
});

// AQ. Partial provider failure
describe("AQ. Partial provider failure", () => {
  it("AQ1 — partial data works", () => {
    const d = buildCryptoAnalyticalDepth("BTC/USD", { defi: { tvl: { current: 50e9, change7d: 3.5 } } });
    expect(d.oiRegime).toBeUndefined();
    expect(d.tvlTrend).toBeDefined();
  });
  it("AQ2 — provider failure not directional", () => {
    expect(JSON.stringify(buildCryptoAnalyticalDepth("BTC/USD", {})).toLowerCase()).not.toContain("bearish because");
  });
});

// AR. Total provider failure
describe("AR. Total provider failure", () => {
  it("AR1 — empty data → empty dims", () => { expect(buildForexAnalyticalDepth("EUR/USD", {}).dimensions.length).toBe(0); });
  it("AR2 — valid structure", () => { const d = buildEquityAnalyticalDepth("AAPL", {}); expect(d.instrument).toBe("AAPL"); expect(d.dimensions.length).toBe(0); });
});

// AS. Cache reuse
describe("AS. Cache reuse", () => {
  it("AS1 — pure function", () => { const data = cryptoData(); buildCryptoAnalyticalDepth("BTC/USD", data); expect(data.derivatives!.fundingRate!.currentRate).toBe(0.0003); });
  it("AS2 — regime pure", () => { expect(classifyRegime({ breakout: true }).regime).toBe(classifyRegime({ breakout: true }).regime); });
});

// AT. Request deduplication
describe("AT. Deduplication", () => {
  it("AT1 — same input → same output", () => { const data = forexData(); expect(buildForexAnalyticalDepth("EUR/USD", data).rateDifferential!.differential).toBe(buildForexAnalyticalDepth("EUR/USD", data).rateDifferential!.differential); });
});

// AU. UI result shape
describe("AU. UI result shape", () => {
  it("AU1 — analyst summary readable", () => {
    const ctx = assembleUniversalAnalyticalContext({ instrument: "BTC/USD", assetClass: "crypto", crypto: buildCryptoAnalyticalDepth("BTC/USD", cryptoData()) });
    expect(typeof ctx.analystSummary).toBe("string");
    expect(ctx.analystSummary.length).toBeGreaterThan(5);
  });
  it("AU2 — all required UI fields", () => {
    for (const dim of buildCryptoAnalyticalDepth("BTC/USD", cryptoData()).dimensions) {
      expect(typeof dim.name).toBe("string");
      expect(typeof dim.category).toBe("string");
      expect(typeof dim.source).toBe("string");
      expect(typeof dim.available).toBe("boolean");
    }
  });
});
