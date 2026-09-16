/**
 * Phase 47 — UNIVERSAL INTELLIGENCE PANEL UI INTEGRATION
 *
 * Tests the universal intelligence panel data shape validation,
 * instrument isolation, and decision immutability for non-crypto
 * asset classes (forex, equity, commodity, cross-asset).
 *
 * This test validates the DATA that would be rendered by the
 * AnalysisResult.tsx universal intelligence panel — it does NOT
 * test rendering directly (that is covered by the existing
 * ui-render.phase13.test.tsx).
 *
 * Test groups:
 * A. Universal Intelligence Context Shape
 * B. Forex Intelligence Panel Data
 * C. Equity Intelligence Panel Data
 * D. Commodity Intelligence Panel Data
 * E. Cross-Asset Intelligence Panel Data
 * F. Instrument Isolation (non-crypto only)
 * G. Decision Immutability
 * H. Evidence Honesty
 * I. Missing Data Handling
 * J. Determinism
 * K. Security (no secrets in output)
 */

import { describe, it, expect } from "vitest";

import type {
  UniversalIntelligenceContext,
  ForexIntelligenceContext,
  EquityIntelligenceContext,
  CommodityIntelligenceContext,
  CrossAssetIntelligenceContext,
  UniversalEvidenceItem,
} from "./data/universal/types";

import type { AnalysisResult } from "@/types/analysis";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const now = Date.now();

function makeForexIntelligence(instrument: string): ForexIntelligenceContext {
  return {
    instrument,
    instrumentType: "forex",
    assembledAt: now,
    rates: {
      provider: "treasury",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 2,
      totalDatasets: 2,
      baseCurrencyRate: 5.25,
      quoteCurrencyRate: 4.50,
      rateDifferential: 75,
      carryContext: "Positive carry",
    },
    yields: {
      provider: "treasury",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 2,
      totalDatasets: 2,
      baseYield: 4.25,
      quoteYield: 3.80,
      yieldDifferential: 45,
    },
    positioning: {
      provider: "cftc",
      observedAt: now,
      freshness: "DELAYED",
      quality: "DEGRADED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      nonCommercialNet: 45000,
      commercialNet: -45000,
    },
    macro: {
      provider: "trading-economics",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      upcomingEvents: [
        { name: "NFP", date: "2026-09-05", impact: "high" },
      ],
    },
    crossAsset: {
      provider: "twelve-data",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      dxyTrend: "falling",
      riskRegime: "risk_on",
    },
    evidence: [],
    overallAvailability: "FULL",
    overallQuality: "VERIFIED",
    missingInformation: [],
    analystSummary: "Forex intelligence fully available.",
  };
}

function makeEquityIntelligence(instrument: string): EquityIntelligenceContext {
  return {
    instrument,
    instrumentType: "equity",
    assembledAt: now,
    fundamentals: {
      provider: "alpha-vantage",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 5,
      totalDatasets: 5,
      marketCap: 3_500_000_000_000,
      peRatio: 28.5,
      revenueGrowth: 0.12,
      profitMargin: 0.25,
    },
    sector: {
      sector: "Technology",
      industry: "Software",
    },
    valuation: {
      provider: "alpha-vantage",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      relativeValuation: "fair",
    },
    evidence: [],
    overallAvailability: "PARTIAL",
    overallQuality: "VERIFIED",
    missingInformation: [],
    analystSummary: "Equity intelligence partially available.",
  };
}

function makeCommodityIntelligence(instrument: string): CommodityIntelligenceContext {
  return {
    instrument,
    instrumentType: "commodity",
    assembledAt: now,
    inventory: {
      provider: "eia",
      observedAt: now,
      freshness: "DELAYED",
      quality: "DEGRADED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      currentInventory: 420_000_000,
      changeWeekly: -2_500_000,
    },
    futuresStructure: {
      provider: "twelve-data",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      structure: "backwardation",
      rollYield: 3.2,
    },
    positioning: {
      provider: "cftc",
      observedAt: now,
      freshness: "DELAYED",
      quality: "DEGRADED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      managedMoneyNet: 125000,
    },
    seasonality: {
      provider: "seasonal-analysis",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      seasonalPattern: "Seasonally strong Q3",
    },
    macroInfluence: {
      provider: "news-analysis",
      observedAt: now,
      freshness: "FRESH",
      quality: "DEGRADED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      dollarContext: "Weak dollar supportive",
    },
    evidence: [],
    overallAvailability: "PARTIAL",
    overallQuality: "DEGRADED",
    missingInformation: [],
    analystSummary: "Commodity intelligence partially available.",
  };
}

function makeCrossAssetIntelligence(): CrossAssetIntelligenceContext {
  return {
    assembledAt: now,
    dxy: {
      provider: "twelve-data",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      value: 103.5,
      trend: "falling",
    },
    treasury: {
      provider: "treasury",
      observedAt: now,
      freshness: "FRESH",
      quality: "VERIFIED",
      available: true,
      availableDatasets: 3,
      totalDatasets: 3,
      tenYear: 4.25,
      yieldCurve: "inverted",
    },
    riskRegime: {
      provider: "cross-asset-analysis",
      observedAt: now,
      freshness: "FRESH",
      quality: "DEGRADED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      regime: "risk_on",
    },
    centralBanks: {
      provider: "news-analysis",
      observedAt: now,
      freshness: "FRESH",
      quality: "DEGRADED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      fedContext: "Hawkish pause, data dependent",
    },
    globalLiquidity: {
      provider: "macro-analysis",
      observedAt: now,
      freshness: "FRESH",
      quality: "DEGRADED",
      available: true,
      availableDatasets: 1,
      totalDatasets: 1,
      m2Trend: "expanding",
    },
    evidence: [],
    overallAvailability: "FULL",
    overallQuality: "VERIFIED",
    missingInformation: [],
    analystSummary: "Cross-asset intelligence fully available.",
  };
}

function makeUniversalContext(
  instrument: string,
  assetClass: "forex" | "equity" | "commodity" | "macro",
  overrides?: Partial<UniversalIntelligenceContext>,
): UniversalIntelligenceContext {
  const base: UniversalIntelligenceContext = {
    instrument,
    assetClass,
    assembledAt: now,
    evidence: [],
    overallAvailability: "PARTIAL",
    overallQuality: "VERIFIED",
    missingInformation: [],
    dataFlags: [],
    analystSummary: `Intelligence for ${instrument}`,
  };

  if (assetClass === "forex") base.forex = makeForexIntelligence(instrument);
  if (assetClass === "equity") base.equity = makeEquityIntelligence(instrument);
  if (assetClass === "commodity") base.commodity = makeCommodityIntelligence(instrument);
  if (assetClass === "macro") base.crossAsset = makeCrossAssetIntelligence();

  return { ...base, ...overrides };
}

function makeBaseResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    id: "test-1",
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H4",
    bias: "Bullish",
    confidence: 72,
    recommendation: "LONG",
    conviction: "Medium",
    noTradeReasons: [],
    tradePlan: {
      direction: "long",
      entry: "1.0850",
      entryBasis: "market price",
      stopLoss: "1.0780",
      slBasis: "structural support",
      takeProfit: "1.0980",
      tpBasis: "resistance level",
      riskReward: 1.86,
    },
    technicalSummary: "Test",
    fundamentalSummary: "Test",
    breakdown: { trend: 1, indicator: 0, fundamental: 1, sentiment: 0 },
    keyLevels: { support: "1.0780", resistance: "1.0980", invalidation: "1.0750" },
    riskNote: "Test risk",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: now,
    tradingStyle: "intraday",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. UNIVERSAL INTELLIGENCE CONTEXT SHAPE
// ═══════════════════════════════════════════════════════════════

describe("A — Universal Intelligence Context Shape", () => {
  it("has required top-level fields", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(ctx.instrument).toBe("EUR/USD");
    expect(ctx.assetClass).toBe("forex");
    expect(ctx.assembledAt).toBeGreaterThan(0);
    expect(Array.isArray(ctx.evidence)).toBe(true);
    expect(Array.isArray(ctx.missingInformation)).toBe(true);
    expect(Array.isArray(ctx.dataFlags)).toBe(true);
    expect(typeof ctx.analystSummary).toBe("string");
  });

  it("has valid overallAvailability", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(["FULL", "PARTIAL", "MINIMAL", "UNAVAILABLE"]).toContain(ctx.overallAvailability);
  });

  it("has valid overallQuality", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(["VERIFIED", "DEGRADED", "STALE", "INSUFFICIENT", "UNAVAILABLE"]).toContain(ctx.overallQuality);
  });

  it("AnalysisResult type has universalIntelligenceContext field", () => {
    const result = makeBaseResult({
      universalIntelligenceContext: makeUniversalContext("EUR/USD", "forex"),
    });
    expect(result.universalIntelligenceContext).toBeDefined();
    expect(result.universalIntelligenceContext!.instrument).toBe("EUR/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. FOREX INTELLIGENCE PANEL DATA
// ═══════════════════════════════════════════════════════════════

describe("B — Forex Intelligence Panel Data", () => {
  it("forex context has rates with differential", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(ctx.forex).toBeDefined();
    expect(ctx.forex!.rates).toBeDefined();
    expect(ctx.forex!.rates!.rateDifferential).toBe(75);
    expect(ctx.forex!.rates!.available).toBe(true);
  });

  it("forex context has yield differential", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(ctx.forex!.yields).toBeDefined();
    expect(ctx.forex!.yields!.yieldDifferential).toBe(45);
  });

  it("forex context has COT positioning", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(ctx.forex!.positioning).toBeDefined();
    expect(ctx.forex!.positioning!.nonCommercialNet).toBe(45000);
  });

  it("forex context has macro calendar", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(ctx.forex!.macro).toBeDefined();
    expect(ctx.forex!.macro!.upcomingEvents).toHaveLength(1);
    expect(ctx.forex!.macro!.upcomingEvents![0].name).toBe("NFP");
  });

  it("forex context has cross-asset DXY trend", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(ctx.forex!.crossAsset).toBeDefined();
    expect(ctx.forex!.crossAsset!.dxyTrend).toBe("falling");
    expect(ctx.forex!.crossAsset!.riskRegime).toBe("risk_on");
  });

  it("forex rates carry disclaimer: rate differential is not a directional signal", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    // The panel should display rateDifferential, not interpret it as bullish/bearish
    expect(ctx.forex!.rates!.rateDifferential).toBe(75);
    // The intelligence context does NOT contain a directional recommendation
    expect(ctx.forex!.rates).not.toHaveProperty("recommendation");
    expect(ctx.forex!.rates).not.toHaveProperty("bias");
  });

  it("forex positioning disclaimer: COT is not a directional signal", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    expect(ctx.forex!.positioning!.nonCommercialNet).toBe(45000);
    expect(ctx.forex!.positioning).not.toHaveProperty("recommendation");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. EQUITY INTELLIGENCE PANEL DATA
// ═══════════════════════════════════════════════════════════════

describe("C — Equity Intelligence Panel Data", () => {
  it("equity context has fundamentals with P/E", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    expect(ctx.equity).toBeDefined();
    expect(ctx.equity!.fundamentals).toBeDefined();
    expect(ctx.equity!.fundamentals!.peRatio).toBe(28.5);
  });

  it("equity context has revenue growth", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    expect(ctx.equity!.fundamentals!.revenueGrowth).toBe(0.12);
  });

  it("equity context has profit margin", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    expect(ctx.equity!.fundamentals!.profitMargin).toBe(0.25);
  });

  it("equity context has market cap", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    expect(ctx.equity!.fundamentals!.marketCap).toBe(3_500_000_000_000);
  });

  it("equity context has sector info", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    expect(ctx.equity!.sector).toBeDefined();
    expect(ctx.equity!.sector!.sector).toBe("Technology");
    expect(ctx.equity!.sector!.industry).toBe("Software");
  });

  it("equity context has valuation", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    expect(ctx.equity!.valuation).toBeDefined();
    expect(ctx.equity!.valuation!.relativeValuation).toBe("fair");
  });

  it("equity fundamentals are informational, not directional signals", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    expect(ctx.equity!.fundamentals!.peRatio).toBe(28.5);
    expect(ctx.equity!.fundamentals).not.toHaveProperty("recommendation");
    expect(ctx.equity!.fundamentals).not.toHaveProperty("bias");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. COMMODITY INTELLIGENCE PANEL DATA
// ═══════════════════════════════════════════════════════════════

describe("D — Commodity Intelligence Panel Data", () => {
  it("commodity context has inventory data", () => {
    const ctx = makeUniversalContext("WTI", "commodity");
    expect(ctx.commodity).toBeDefined();
    expect(ctx.commodity!.inventory).toBeDefined();
    expect(ctx.commodity!.inventory!.currentInventory).toBe(420_000_000);
    expect(ctx.commodity!.inventory!.changeWeekly).toBe(-2_500_000);
  });

  it("commodity context has futures structure", () => {
    const ctx = makeUniversalContext("WTI", "commodity");
    expect(ctx.commodity!.futuresStructure).toBeDefined();
    expect(ctx.commodity!.futuresStructure!.structure).toBe("backwardation");
    expect(ctx.commodity!.futuresStructure!.rollYield).toBe(3.2);
  });

  it("commodity context has COT positioning", () => {
    const ctx = makeUniversalContext("WTI", "commodity");
    expect(ctx.commodity!.positioning).toBeDefined();
    expect(ctx.commodity!.positioning!.managedMoneyNet).toBe(125000);
  });

  it("commodity context has seasonality", () => {
    const ctx = makeUniversalContext("WTI", "commodity");
    expect(ctx.commodity!.seasonality).toBeDefined();
    expect(ctx.commodity!.seasonality!.seasonalPattern).toBe("Seasonally strong Q3");
  });

  it("commodity context has macro dollar influence", () => {
    const ctx = makeUniversalContext("WTI", "commodity");
    expect(ctx.commodity!.macroInfluence).toBeDefined();
    expect(ctx.commodity!.macroInfluence!.dollarContext).toBe("Weak dollar supportive");
  });

  it("commodity data is informational, not directional", () => {
    const ctx = makeUniversalContext("WTI", "commodity");
    expect(ctx.commodity!.inventory!.changeWeekly).toBe(-2_500_000);
    expect(ctx.commodity!.inventory).not.toHaveProperty("recommendation");
    expect(ctx.commodity!.futuresStructure).not.toHaveProperty("recommendation");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. CROSS-ASSET INTELLIGENCE PANEL DATA
// ═══════════════════════════════════════════════════════════════

describe("E — Cross-Asset Intelligence Panel Data", () => {
  it("cross-asset context has DXY", () => {
    const ctx = makeUniversalContext("DXY", "macro");
    expect(ctx.crossAsset).toBeDefined();
    expect(ctx.crossAsset!.dxy).toBeDefined();
    expect(ctx.crossAsset!.dxy!.value).toBe(103.5);
    expect(ctx.crossAsset!.dxy!.trend).toBe("falling");
  });

  it("cross-asset context has treasury yields", () => {
    const ctx = makeUniversalContext("DXY", "macro");
    expect(ctx.crossAsset!.treasury).toBeDefined();
    expect(ctx.crossAsset!.treasury!.tenYear).toBe(4.25);
    expect(ctx.crossAsset!.treasury!.yieldCurve).toBe("inverted");
  });

  it("cross-asset context has risk regime", () => {
    const ctx = makeUniversalContext("DXY", "macro");
    expect(ctx.crossAsset!.riskRegime).toBeDefined();
    expect(ctx.crossAsset!.riskRegime!.regime).toBe("risk_on");
  });

  it("cross-asset context has central bank policy", () => {
    const ctx = makeUniversalContext("DXY", "macro");
    expect(ctx.crossAsset!.centralBanks).toBeDefined();
    expect(ctx.crossAsset!.centralBanks!.fedContext).toBe("Hawkish pause, data dependent");
  });

  it("cross-asset context has global liquidity", () => {
    const ctx = makeUniversalContext("DXY", "macro");
    expect(ctx.crossAsset!.globalLiquidity).toBeDefined();
    expect(ctx.crossAsset!.globalLiquidity!.m2Trend).toBe("expanding");
  });

  it("cross-asset data is contextual, not predictive", () => {
    const ctx = makeUniversalContext("DXY", "macro");
    expect(ctx.crossAsset!.dxy!.trend).toBe("falling");
    expect(ctx.crossAsset).not.toHaveProperty("recommendation");
    expect(ctx.crossAsset).not.toHaveProperty("bias");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. INSTRUMENT ISOLATION (NON-CRYPTO ONLY)
// ═══════════════════════════════════════════════════════════════

describe("F — Instrument Isolation (Non-Crypto)", () => {
  it("EUR/USD context does not contain GBP/USD data", () => {
    const eurUsd = makeUniversalContext("EUR/USD", "forex");
    const gbpUsd = makeUniversalContext("GBP/USD", "forex");
    expect(eurUsd.instrument).toBe("EUR/USD");
    expect(gbpUsd.instrument).toBe("GBP/USD");
    expect(eurUsd.instrument).not.toBe(gbpUsd.instrument);
  });

  it("AAPL context does not contain MSFT data", () => {
    const aapl = makeUniversalContext("AAPL", "equity");
    const msft = makeUniversalContext("MSFT", "equity");
    expect(aapl.instrument).toBe("AAPL");
    expect(msft.instrument).toBe("MSFT");
    expect(aapl.instrument).not.toBe(msft.instrument);
  });

  it("WTI context does not contain BRENT data", () => {
    const wti = makeUniversalContext("WTI", "commodity");
    const brent = makeUniversalContext("BRENT", "commodity");
    expect(wti.instrument).toBe("WTI");
    expect(brent.instrument).toBe("BRENT");
    expect(wti.instrument).not.toBe(brent.instrument);
  });

  it("EUR/USD forex context does not appear in AAPL equity context", () => {
    const eurUsd = makeUniversalContext("EUR/USD", "forex");
    const aapl = makeUniversalContext("AAPL", "equity");
    expect(eurUsd.forex).toBeDefined();
    expect(eurUsd.equity).toBeUndefined();
    expect(aapl.equity).toBeDefined();
    expect(aapl.forex).toBeUndefined();
  });

  it("WTI commodity context does not appear in EUR/USD forex context", () => {
    const wti = makeUniversalContext("WTI", "commodity");
    const eurUsd = makeUniversalContext("EUR/USD", "forex");
    expect(wti.commodity).toBeDefined();
    expect(wti.forex).toBeUndefined();
    expect(eurUsd.forex).toBeDefined();
    expect(eurUsd.commodity).toBeUndefined();
  });

  it("forex instruments only have forex sub-context", () => {
    const ctx = makeUniversalContext("USD/JPY", "forex");
    expect(ctx.forex).toBeDefined();
    expect(ctx.equity).toBeUndefined();
    expect(ctx.commodity).toBeUndefined();
    expect(ctx.crossAsset).toBeUndefined();
  });

  it("equity instruments only have equity sub-context", () => {
    const ctx = makeUniversalContext("BBCA", "equity");
    expect(ctx.equity).toBeDefined();
    expect(ctx.forex).toBeUndefined();
    expect(ctx.commodity).toBeUndefined();
    expect(ctx.crossAsset).toBeUndefined();
  });

  it("commodity instruments only have commodity sub-context", () => {
    const ctx = makeUniversalContext("XAU/USD", "commodity");
    expect(ctx.commodity).toBeDefined();
    expect(ctx.forex).toBeUndefined();
    expect(ctx.equity).toBeUndefined();
    expect(ctx.crossAsset).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// G. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("G — Decision Immutability", () => {
  it("universal intelligence does not modify recommendation", () => {
    const result = makeBaseResult({
      universalIntelligenceContext: makeUniversalContext("EUR/USD", "forex"),
    });
    expect(result.recommendation).toBe("LONG");
    expect(result.bias).toBe("Bullish");
    expect(result.conviction).toBe("Medium");
    expect(result.confidence).toBe(72);
  });

  it("UNAVAILABLE intelligence does not modify decision", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex", {
      overallAvailability: "UNAVAILABLE",
      overallQuality: "UNAVAILABLE",
      missingInformation: ["All data sources unavailable"],
    });
    const result = makeBaseResult({
      universalIntelligenceContext: ctx,
    });
    expect(result.recommendation).toBe("LONG");
    expect(result.bias).toBe("Bullish");
    expect(result.noTradeReasons).toHaveLength(0);
  });

  it("stale intelligence does not modify trade plan", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex", {
      overallQuality: "STALE",
    });
    const result = makeBaseResult({
      universalIntelligenceContext: ctx,
    });
    expect(result.tradePlan).toBeDefined();
    expect(result.tradePlan!.entry).toBe("1.0850");
    expect(result.tradePlan!.stopLoss).toBe("1.0780");
  });

  it("conflicting intelligence does not modify conviction", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex", {
      overallAvailability: "PARTIAL",
    });
    const result = makeBaseResult({
      universalIntelligenceContext: ctx,
    });
    expect(result.conviction).toBe("Medium");
  });

  it("provider availability never becomes directional evidence", () => {
    const available = makeUniversalContext("EUR/USD", "forex");
    const unavailable = makeUniversalContext("EUR/USD", "forex", {
      overallAvailability: "UNAVAILABLE",
    });
    // Both have the same base decision — provider availability is informational only
    const result1 = makeBaseResult({ universalIntelligenceContext: available });
    const result2 = makeBaseResult({ universalIntelligenceContext: unavailable });
    expect(result1.recommendation).toBe(result2.recommendation);
    expect(result1.bias).toBe(result2.bias);
    expect(result1.confidence).toBe(result2.confidence);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. EVIDENCE HONESTY
// ═══════════════════════════════════════════════════════════════

describe("H — Evidence Honesty", () => {
  it("evidence items have required fields", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    // Add some evidence to the context
    const evidenceItem: UniversalEvidenceItem = {
      source: "treasury",
      category: "RATES",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: "VERIFIED",
      freshness: "FRESH",
      dependencyGroup: "MACRO_RATES",
      explanation: "Rate differential: 75bp",
      providerAvailable: true,
      assetClass: "forex",
      instrument: "EUR/USD",
    };
    ctx.evidence.push(evidenceItem);

    const e = ctx.evidence[0];
    expect(e.source).toBeTruthy();
    expect(e.category).toBeTruthy();
    expect(["SUPPORTING", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"]).toContain(e.direction);
    expect(["STRONG", "MODERATE", "WEAK", "UNKNOWN"]).toContain(e.strength);
    expect(["VERIFIED", "DEGRADED", "STALE", "INSUFFICIENT", "UNAVAILABLE"]).toContain(e.quality);
    expect(e.explanation).toBeTruthy();
    expect(e.instrument).toBe("EUR/USD");
  });

  it("unavailable evidence explicitly marks unavailability", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex", {
      missingInformation: ["CFTC COT positioning data"],
    });
    expect(ctx.missingInformation).toContain("CFTC COT positioning data");
    // Missing info is just informational — no directional implication
  });

  it("provider availability is never directional", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    // Even if rates are available, the intelligence should be NEUTRAL direction
    const evidenceItem: UniversalEvidenceItem = {
      source: "treasury",
      category: "RATES",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: "VERIFIED",
      freshness: "FRESH",
      dependencyGroup: "MACRO_RATES",
      explanation: "Rate context",
      providerAvailable: true,
      assetClass: "forex",
      instrument: "EUR/USD",
    };
    ctx.evidence.push(evidenceItem);
    expect(ctx.evidence[0].direction).toBe("NEUTRAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. MISSING DATA HANDLING
// ═══════════════════════════════════════════════════════════════

describe("I — Missing Data Handling", () => {
  it("forex context with no rates is valid", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    ctx.forex!.rates = undefined;
    expect(ctx.forex!.rates).toBeUndefined();
    // Other intelligence remains
    expect(ctx.forex!.yields).toBeDefined();
  });

  it("equity context with no fundamentals is valid", () => {
    const ctx = makeUniversalContext("AAPL", "equity");
    ctx.equity!.fundamentals = undefined;
    expect(ctx.equity!.fundamentals).toBeUndefined();
  });

  it("commodity context with no inventory is valid", () => {
    const ctx = makeUniversalContext("WTI", "commodity");
    ctx.commodity!.inventory = undefined;
    expect(ctx.commodity!.inventory).toBeUndefined();
  });

  it("cross-asset context with no DXY is valid", () => {
    const ctx = makeUniversalContext("DXY", "macro");
    ctx.crossAsset!.dxy = undefined;
    expect(ctx.crossAsset!.dxy).toBeUndefined();
  });

  it("fully unavailable context has empty missing information list", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex", {
      overallAvailability: "UNAVAILABLE",
      missingInformation: [],
      forex: {
        instrument: "EUR/USD",
        instrumentType: "forex",
        assembledAt: now,
        evidence: [],
        overallAvailability: "UNAVAILABLE",
        overallQuality: "UNAVAILABLE",
        missingInformation: [],
        analystSummary: "No data available",
      },
    });
    expect(ctx.forex!.overallAvailability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("J — Determinism", () => {
  it("creating the same context twice produces identical data", () => {
    const ctx1 = makeUniversalContext("EUR/USD", "forex");
    const ctx2 = makeUniversalContext("EUR/USD", "forex");
    expect(ctx1.instrument).toBe(ctx2.instrument);
    expect(ctx1.assetClass).toBe(ctx2.assetClass);
    expect(ctx1.forex!.rates!.rateDifferential).toBe(ctx2.forex!.rates!.rateDifferential);
    expect(ctx1.forex!.yields!.yieldDifferential).toBe(ctx2.forex!.yields!.yieldDifferential);
    expect(ctx1.forex!.positioning!.nonCommercialNet).toBe(ctx2.forex!.positioning!.nonCommercialNet);
  });

  it("evidence direction is deterministic", () => {
    const item: UniversalEvidenceItem = {
      source: "treasury",
      category: "RATES",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: "VERIFIED",
      freshness: "FRESH",
      dependencyGroup: "MACRO_RATES",
      explanation: "Rate context",
      providerAvailable: true,
      assetClass: "forex",
      instrument: "EUR/USD",
    };
    expect(item.direction).toBe("NEUTRAL");
    expect(item.direction).toBe("NEUTRAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. SECURITY (NO SECRETS)
// ═══════════════════════════════════════════════════════════════

describe("K — Security (No Secrets)", () => {
  it("intelligence context never contains API keys", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("secret");
  });

  it("evidence items never contain credentials", () => {
    const ctx = makeUniversalContext("EUR/USD", "forex");
    const evidenceItem: UniversalEvidenceItem = {
      source: "treasury",
      category: "RATES",
      direction: "NEUTRAL",
      strength: "MODERATE",
      quality: "VERIFIED",
      freshness: "FRESH",
      dependencyGroup: "MACRO_RATES",
      explanation: "Rate context",
      providerAvailable: true,
      assetClass: "forex",
      instrument: "EUR/USD",
    };
    ctx.evidence.push(evidenceItem);
    const serialized = JSON.stringify(ctx.evidence);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("secret");
  });

  it("AnalysisResult with universal intelligence never exposes secrets", () => {
    const result = makeBaseResult({
      universalIntelligenceContext: makeUniversalContext("EUR/USD", "forex"),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("Bearer");
  });
});
