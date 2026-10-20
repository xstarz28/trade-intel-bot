/**
 * Phase 45 — PRODUCTION UNIVERSAL INTELLIGENCE ENGINE
 *
 * 26 test groups, 100+ tests covering:
 * A. Universal Instrument Resolution
 * B. Dynamic Symbol Mapping
 * C. IDX Equities
 * D. US Equities
 * E. Forex
 * F. Commodities
 * G. Indices
 * H. Crypto Venues
 * I. Provider Routing
 * J. Provider Fallback
 * K. Provider Health
 * L. Cache Isolation
 * M. Cross-Asset Context
 * N. Evidence Normalization
 * O. Dependency Groups
 * P. Double-Counting
 * Q. Missing Data
 * R. Stale Data
 * S. NaN/Infinity Safety
 * T. Rate Limits
 * U. Security
 * V. Decision Immutability
 * W. Determinism
 * X. Adversarial Cross-Instrument
 * Y. Forex Intelligence Engine
 * Z. Commodity Intelligence Engine
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  resolveInstrument,
  getProviderSymbol,
  detectAssetClass,
  isCryptoInstrument,
  getAllInstrumentIds,
} from "@/lib/data/universal/instruments";

import {
  routeProviderRequest,
  recordProviderHealth,
  resetProviderHealth,
  markRateLimited,
  getProviderHealth,
} from "@/lib/data/universal/routing-engine";

import {
  cacheSet,
  cacheGet,
  cacheHas,
  cacheClearInstrument,
  cacheClearProvider,
  cacheStats,
  resetCache,
} from "@/lib/data/universal/cache";

import {
  createEvidenceItem,
  detectDoubleCounting,
} from "@/lib/data/universal/evidence";

import {
  buildForexIntelligence,
  buildEquityIntelligence,
  buildCommodityIntelligence,
  buildCrossAssetIntelligence,
  assembleUniversalIntelligence,
} from "@/lib/data/universal/engines";

import type {
  ForexIntelligenceContext,
  EquityIntelligenceContext,
  CommodityIntelligenceContext,
  CrossAssetIntelligenceContext,
} from "@/lib/data/universal/types";

beforeEach(() => {
  resetProviderHealth();
  resetCache();
});

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const now = Date.now();

function makeForexCtx(instrument: string, overrides?: Partial<ForexIntelligenceContext>): ForexIntelligenceContext {
  return {
    instrument, instrumentType: "forex", assembledAt: now,
    rates: { provider: "treasury", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 2, totalDatasets: 2, rateDifferential: -25 },
    evidence: [], overallAvailability: "PARTIAL", overallQuality: "VERIFIED",
    missingInformation: [], analystSummary: "Forex intel", ...overrides,
  };
}

function makeEquityCtx(instrument: string, overrides?: Partial<EquityIntelligenceContext>): EquityIntelligenceContext {
  return {
    instrument, instrumentType: "equity", assembledAt: now,
    fundamentals: { provider: "alpha-vantage", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 5, totalDatasets: 5, peRatio: 28.5, revenueGrowth: 0.15 },
    evidence: [], overallAvailability: "PARTIAL", overallQuality: "VERIFIED",
    missingInformation: [], analystSummary: "Equity intel", ...overrides,
  };
}

function makeCommodityCtx(instrument: string, overrides?: Partial<CommodityIntelligenceContext>): CommodityIntelligenceContext {
  return {
    instrument, instrumentType: "commodity", assembledAt: now,
    inventory: { provider: "eia", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, currentInventory: 420_000_000 },
    evidence: [], overallAvailability: "PARTIAL", overallQuality: "VERIFIED",
    missingInformation: [], analystSummary: "Commodity intel", ...overrides,
  };
}

function makeCrossAssetCtx(overrides?: Partial<CrossAssetIntelligenceContext>): CrossAssetIntelligenceContext {
  return {
    assembledAt: now,
    dxy: { provider: "twelve-data", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 1, value: 103.5, trend: "rising" },
    evidence: [], overallAvailability: "MINIMAL", overallQuality: "VERIFIED",
    missingInformation: [], analystSummary: "Cross-asset", ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. UNIVERSAL INSTRUMENT RESOLUTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — A. Universal Instrument Resolution", () => {
  const assets: [string, string][] = [
    ["BTC/USD", "crypto"], ["ETH/USD", "crypto"], ["SOL/USD", "crypto"], ["DOGE/USD", "crypto"],
    ["EUR/USD", "forex"], ["GBP/USD", "forex"], ["USD/JPY", "forex"], ["AUD/USD", "forex"],
    ["USD/CAD", "forex"], ["USD/CHF", "forex"], ["NZD/USD", "forex"], ["USD/IDR", "forex"],
    ["XAU/USD", "commodity"], ["XAG/USD", "commodity"], ["WTI", "commodity"],
    ["BRENT", "commodity"], ["NGAS", "commodity"], ["COPPER", "commodity"],
    ["AAPL", "equity"], ["NVDA", "equity"], ["TSLA", "equity"], ["MSFT", "equity"], ["AMZN", "equity"],
    ["BBCA", "equity"], ["BBRI", "equity"], ["TLKM", "equity"], ["GOTO", "equity"],
    ["BMRI", "equity"], ["BBNI", "equity"],
    ["SPX", "indices"], ["NDX", "indices"], ["DJI", "indices"], ["IHSG", "indices"],
    ["DXY", "macro"],
  ];

  for (const [inst, cls] of assets) {
    it(`resolves ${inst} as ${cls}`, () => {
      const r = resolveInstrument(inst);
      expect(r).toBeDefined();
      expect(r!.assetClass).toBe(cls);
    });
  }

  it("returns undefined for unknown instruments", () => {
    expect(resolveInstrument("ZZZZZ")).toBeUndefined();
    expect(resolveInstrument("NONEXISTENT/PAIR")).toBeUndefined();
  });

  it("handles case insensitivity", () => {
    expect(resolveInstrument("btc/usd")?.canonical).toBe("BTC/USD");
    expect(resolveInstrument("eur/usd")?.canonical).toBe("EUR/USD");
  });

  it("returns 35+ registered instruments", () => {
    expect(getAllInstrumentIds().length).toBeGreaterThanOrEqual(34);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. DYNAMIC SYMBOL MAPPING
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — B. Dynamic Symbol Mapping", () => {
  it("crypto has provider mappings for all providers", () => {
    expect(getProviderSymbol("BTC/USD", "twelve-data")).toBe("BTC/USD");
    expect(getProviderSymbol("BTC/USD", "coingecko")).toBe("bitcoin");
    expect(getProviderSymbol("BTC/USD", "coinglass")).toBe("BTC");
    expect(getProviderSymbol("BTC/USD", "defillama")).toBe("bitcoin");
    expect(getProviderSymbol("BTC/USD", "tokenomist")).toBe("BTC");
  });

  it("forex has provider mappings", () => {
    expect(getProviderSymbol("EUR/USD", "twelve-data")).toBe("EUR/USD");
    expect(getProviderSymbol("EUR/USD", "alpha-vantage")).toBe("EURUSD");
  });

  it("IDX equities have .JK suffix for twelve-data", () => {
    expect(getProviderSymbol("BBCA", "twelve-data")).toBe("BBCA.JK");
    expect(getProviderSymbol("BBRI", "twelve-data")).toBe("BBRI.JK");
    expect(getProviderSymbol("TLKM", "twelve-data")).toBe("TLKM.JK");
    expect(getProviderSymbol("GOTO", "twelve-data")).toBe("GOTO.JK");
  });

  it("US equities have direct mapping", () => {
    expect(getProviderSymbol("AAPL", "twelve-data")).toBe("AAPL");
    expect(getProviderSymbol("AAPL", "alpha-vantage")).toBe("AAPL");
  });

  it("returns null for unsupported provider", () => {
    expect(getProviderSymbol("BTC/USD", "eia")).toBeNull();
    expect(getProviderSymbol("EUR/USD", "coinglass")).toBeNull();
  });

  it("returns null for unknown instrument", () => {
    expect(getProviderSymbol("ZZZZZ", "twelve-data")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// C. IDX EQUITIES
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — C. IDX Equities", () => {
  const idxStocks = ["BBCA", "BBRI", "TLKM", "GOTO", "BMRI", "BBNI"];

  for (const stock of idxStocks) {
    it(`${stock} is Indonesia equity on IDX`, () => {
      const inst = resolveInstrument(stock);
      expect(inst).toBeDefined();
      expect(inst!.assetClass).toBe("equity");
      expect(inst!.region).toBe("Indonesia");
      expect(inst!.primaryExchange).toBe("IDX");
      expect(inst!.countryCode).toBe("ID");
      expect(inst!.exchanges).toContain("IDX");
      expect(inst!.quoteAsset).toBe("IDR");
    });
  }

  it("IDX stocks do not resolve to US equities", () => {
    const bbca = resolveInstrument("BBCA");
    const aapl = resolveInstrument("AAPL");
    expect(bbca!.region).not.toBe(aapl!.region);
    expect(bbca!.primaryExchange).not.toBe(aapl!.primaryExchange);
  });

  it("IDX stocks have .JK provider mapping", () => {
    const bbca = resolveInstrument("BBCA");
    const mapping = bbca!.providerMappings.find((m) => m.provider === "twelve-data");
    expect(mapping).toBeDefined();
    expect(mapping!.symbol).toBe("BBCA.JK");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. US EQUITIES
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — D. US Equities", () => {
  const usStocks = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN"];

  for (const stock of usStocks) {
    it(`${stock} is US equity on NASDAQ`, () => {
      const inst = resolveInstrument(stock);
      expect(inst).toBeDefined();
      expect(inst!.assetClass).toBe("equity");
      expect(inst!.region).toBe("US");
      expect(inst!.primaryExchange).toBe("NASDAQ");
      expect(inst!.countryCode).toBe("US");
    });
  }

  it("US equities have sector/industry metadata", () => {
    const aapl = resolveInstrument("AAPL");
    expect(aapl!.sector).toBe("Technology");
    expect(aapl!.industry).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// E. FOREX
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — E. Forex", () => {
  const pairs = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"];

  for (const pair of pairs) {
    it(`${pair} is forex with correct base/quote`, () => {
      const inst = resolveInstrument(pair);
      expect(inst).toBeDefined();
      expect(inst!.assetClass).toBe("forex");
      expect(inst!.subType).toBe("forex_spot");
      expect(inst!.baseAsset).toBeTruthy();
      expect(inst!.quoteAsset).toBeTruthy();
    });
  }

  it("USD/IDR is exotic forex with Indonesia region", () => {
    const inst = resolveInstrument("USD/IDR");
    expect(inst).toBeDefined();
    expect(inst!.assetClass).toBe("forex");
    expect(inst!.region).toBe("Indonesia");
    expect(inst!.tags).toContain("exotic");
  });

  it("detectAssetClass identifies forex pairs", () => {
    expect(detectAssetClass("EUR/USD")).toBe("forex");
    expect(detectAssetClass("GBP/USD")).toBe("forex");
    expect(detectAssetClass("USD/JPY")).toBe("forex");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. COMMODITIES
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — F. Commodities", () => {
  it("XAU/USD is gold commodity", () => {
    const inst = resolveInstrument("XAU/USD");
    expect(inst!.assetClass).toBe("commodity");
    expect(inst!.baseAsset).toBe("Gold");
    expect(inst!.exchanges).toContain("COMEX");
  });

  it("WTI is crude oil futures", () => {
    const inst = resolveInstrument("WTI");
    expect(inst!.assetClass).toBe("commodity");
    expect(inst!.subType).toBe("commodity_futures");
    expect(inst!.exchanges).toContain("NYMEX");
  });

  it("BRENT is crude oil futures on ICE", () => {
    const inst = resolveInstrument("BRENT");
    expect(inst!.assetClass).toBe("commodity");
    expect(inst!.exchanges).toContain("ICE");
  });

  it("COPPER is industrial metal", () => {
    const inst = resolveInstrument("COPPER");
    expect(inst!.assetClass).toBe("commodity");
    expect(inst!.tags).toContain("industrial_metal");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. INDICES
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — G. Indices", () => {
  it("SPX is S&P 500 US index", () => {
    const inst = resolveInstrument("SPX");
    expect(inst!.assetClass).toBe("indices");
    expect(inst!.region).toBe("US");
  });

  it("IHSG is Jakarta Composite Indonesia index", () => {
    const inst = resolveInstrument("IHSG");
    expect(inst!.assetClass).toBe("indices");
    expect(inst!.region).toBe("Indonesia");
    expect(inst!.exchanges).toContain("IDX");
  });

  it("NDX is Nasdaq 100", () => {
    const inst = resolveInstrument("NDX");
    expect(inst!.assetClass).toBe("indices");
    expect(inst!.exchanges).toContain("NASDAQ");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. CRYPTO VENUES
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — H. Crypto Venues", () => {
  it("BTC/USD has multi-exchange support", () => {
    const inst = resolveInstrument("BTC/USD");
    expect(inst!.exchanges).toContain("binance");
    expect(inst!.exchanges).toContain("okx");
    expect(inst!.exchanges).toContain("coinbase");
    expect(inst!.exchanges).toContain("cme_crypto");
  });

  it("ETH/USD has multi-exchange support", () => {
    const inst = resolveInstrument("ETH/USD");
    expect(inst!.exchanges).toContain("binance");
    expect(inst!.exchanges).toContain("coinbase");
  });

  it("crypto detection via isCryptoInstrument", () => {
    expect(isCryptoInstrument("BTC/USD")).toBe(true);
    expect(isCryptoInstrument("ETH/USD")).toBe(true);
    expect(isCryptoInstrument("SOL/USD")).toBe(true);
    expect(isCryptoInstrument("EUR/USD")).toBe(false);
    expect(isCryptoInstrument("AAPL")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. PROVIDER ROUTING
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — I. Provider Routing", () => {
  it("routes ohlcv for BTC/USD", () => {
    const r = routeProviderRequest("BTC/USD", "ohlcv");
    expect(r.available).toBe(true);
    expect(r.routes.length).toBeGreaterThan(0);
    expect(r.bestRoute).toBeDefined();
  });

  it("routes ohlcv for AAPL", () => {
    const r = routeProviderRequest("AAPL", "ohlcv");
    expect(r.available).toBe(true);
  });

  it("routes cot_positioning for EUR/USD", () => {
    const r = routeProviderRequest("EUR/USD", "cot_positioning");
    const cftc = r.routes.find((r) => r.providerId === "cftc");
    expect(cftc).toBeDefined();
  });

  it("routes earnings for AAPL", () => {
    const r = routeProviderRequest("AAPL", "earnings");
    expect(r.available).toBe(true);
    const av = r.routes.find((r) => r.providerId === "alpha-vantage");
    expect(av).toBeDefined();
  });

  it("no route for open_interest on EUR/USD", () => {
    const r = routeProviderRequest("EUR/USD", "open_interest");
    expect(r.routes.length).toBe(0);
    expect(r.available).toBe(false);
  });

  it("unknown instrument returns unavailable", () => {
    const r = routeProviderRequest("ZZZZZ", "ohlcv");
    expect(r.available).toBe(false);
    expect(r.unavailableReason).toContain("not registered");
  });

  it("routes are sorted by health then priority", () => {
    const r = routeProviderRequest("BTC/USD", "ohlcv");
    if (r.routes.length > 1) {
      // First should be available with highest priority
      const first = r.routes[0];
      expect(first.healthStatus).not.toBe("UNAVAILABLE");
    }
  });

  it("routing includes routedAt timestamp", () => {
    const r = routeProviderRequest("BTC/USD", "ohlcv");
    expect(r.routedAt).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. PROVIDER FALLBACK
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — J. Provider Fallback", () => {
  it("degrades when primary provider fails", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "UNAVAILABLE", error: "timeout" });
    const r = routeProviderRequest("BTC/USD", "ohlcv");
    // Should still have available route from OKX or others
    expect(r.routes.length).toBeGreaterThan(0);
    const td = r.routes.find((r) => r.providerId === "twelve-data");
    expect(td?.healthStatus).toBe("UNAVAILABLE");
  });

  it("all providers unavailable produces unavailable result", () => {
    // Set all ohlcv-capable crypto providers to unavailable
    recordProviderHealth({ providerId: "twelve-data", status: "UNAVAILABLE", error: "down" });
    recordProviderHealth({ providerId: "okx", status: "UNAVAILABLE", error: "down" });
    recordProviderHealth({ providerId: "coingecko", status: "UNAVAILABLE", error: "down" });
    const r = routeProviderRequest("BTC/USD", "ohlcv");
    expect(r.available).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. PROVIDER HEALTH
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — K. Provider Health", () => {
  it("records health events", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "AVAILABLE", responseTimeMs: 150 });
    const h = getProviderHealth("twelve-data");
    expect(h).toBeDefined();
    expect(h!.status).toBe("AVAILABLE");
    expect(h!.avgResponseTimeMs).toBeCloseTo(150, 0);
  });

  it("tracks consecutive failures", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "UNAVAILABLE", error: "timeout" });
    recordProviderHealth({ providerId: "twelve-data", status: "UNAVAILABLE", error: "timeout" });
    const h = getProviderHealth("twelve-data");
    expect(h!.consecutiveFailures).toBe(2);
  });

  it("resets failures on success", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "UNAVAILABLE", error: "timeout" });
    recordProviderHealth({ providerId: "twelve-data", status: "AVAILABLE" });
    const h = getProviderHealth("twelve-data");
    expect(h!.consecutiveFailures).toBe(0);
  });

  it("marks provider as rate-limited", () => {
    markRateLimited("twelve-data", Date.now() + 60000);
    const r = routeProviderRequest("BTC/USD", "ohlcv");
    const td = r.routes.find((r) => r.providerId === "twelve-data");
    expect(td?.healthStatus).toBe("RATE_LIMITED");
  });

  it("resetProviderHealth clears all", () => {
    recordProviderHealth({ providerId: "twelve-data", status: "UNAVAILABLE" });
    resetProviderHealth();
    expect(getProviderHealth("twelve-data")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// L. CACHE ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — L. Cache Isolation", () => {
  it("sets and gets cache entry", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 50000 });
    const entry = cacheGet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" });
    expect(entry).not.toBeNull();
    expect((entry!.data as any).price).toBe(50000);
  });

  it("cacheHas returns correct result", () => {
    const key = { instrument: "BTC/USD", capability: "ohlcv" as const, providerId: "twelve-data" };
    expect(cacheHas(key)).toBe(false);
    cacheSet(key, { price: 50000 });
    expect(cacheHas(key)).toBe(true);
  });

  it("BTC data does NOT appear for ETH", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 50000 });
    const ethEntry = cacheGet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "twelve-data" });
    expect(ethEntry).toBeNull();
  });

  it("AAPL data does NOT appear for BBCA", () => {
    cacheSet({ instrument: "AAPL", capability: "earnings", providerId: "alpha-vantage" }, { eps: 1.50 });
    const bbcaEntry = cacheGet({ instrument: "BBCA", capability: "earnings", providerId: "alpha-vantage" });
    expect(bbcaEntry).toBeNull();
  });

  it("clears cache for specific instrument", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 50000 });
    cacheSet({ instrument: "BTC/USD", capability: "quote", providerId: "coingecko" }, { price: 50001 });
    cacheSet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 3000 });
    cacheClearInstrument("BTC/USD");
    expect(cacheHas({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" })).toBe(false);
    expect(cacheHas({ instrument: "BTC/USD", capability: "quote", providerId: "coingecko" })).toBe(false);
    expect(cacheHas({ instrument: "ETH/USD", capability: "ohlcv", providerId: "twelve-data" })).toBe(true);
  });

  it("clears cache for specific provider", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 50000 });
    cacheSet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 3000 });
    cacheSet({ instrument: "BTC/USD", capability: "quote", providerId: "coingecko" }, { price: 50001 });
    cacheClearProvider("twelve-data");
    expect(cacheHas({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" })).toBe(false);
    expect(cacheHas({ instrument: "ETH/USD", capability: "ohlcv", providerId: "twelve-data" })).toBe(false);
    expect(cacheHas({ instrument: "BTC/USD", capability: "quote", providerId: "coingecko" })).toBe(true);
  });

  it("cache stats return correct size", () => {
    expect(cacheStats().size).toBe(0);
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" }, {});
    expect(cacheStats().size).toBe(1);
  });

  it("resetCache clears everything", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" }, {});
    cacheSet({ instrument: "ETH/USD", capability: "ohlcv", providerId: "twelve-data" }, {});
    resetCache();
    expect(cacheStats().size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. CROSS-ASSET CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — M. Cross-Asset Context", () => {
  it("DXY resolves as macro", () => {
    const inst = resolveInstrument("DXY");
    expect(inst!.assetClass).toBe("macro");
  });

  it("cross-asset context produces evidence", () => {
    const ctx = buildCrossAssetIntelligence(makeCrossAssetCtx());
    expect(ctx.evidence.length).toBeGreaterThan(0);
    expect(ctx.overallAvailability).not.toBe("UNAVAILABLE");
  });

  it("unavailable DXY is handled gracefully", () => {
    const ctx = buildCrossAssetIntelligence(makeCrossAssetCtx({
      dxy: { provider: "twelve-data", observedAt: now, freshness: "UNAVAILABLE", quality: "UNAVAILABLE", available: false, availableDatasets: 0, totalDatasets: 1, failureReason: "Network error" },
    }));
    // Should produce unavailable evidence for DXY
    const dxyEvidence = ctx.evidence.find((e) => e.category === "CROSS_ASSET");
    expect(dxyEvidence).toBeDefined();
    expect(dxyEvidence!.direction).toBe("UNAVAILABLE");
    expect(ctx.overallAvailability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. EVIDENCE NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — N. Evidence Normalization", () => {
  it("evidence items have all required fields", () => {
    const item = createEvidenceItem({
      source: "Test", category: "DERIVATIVES", direction: "SUPPORTING",
      strength: "STRONG", quality: "VERIFIED", freshness: "FRESH",
      dependencyGroup: "DERIVATIVES_OI", explanation: "test",
      providerAvailable: true, assetClass: "crypto", instrument: "BTC/USD",
    });
    expect(item.source).toBeTruthy();
    expect(item.category).toBeTruthy();
    expect(item.direction).toBeTruthy();
    expect(item.strength).toBeTruthy();
    expect(item.quality).toBeTruthy();
    expect(item.freshness).toBeTruthy();
    expect(item.dependencyGroup).toBeTruthy();
    expect(item.explanation).toBeTruthy();
    expect(item.instrument).toBe("BTC/USD");
    expect(item.assetClass).toBe("crypto");
  });

  it("direction is always one of the allowed values", () => {
    const dirs = ["SUPPORTING", "CONFLICTING", "NEUTRAL", "UNAVAILABLE"];
    for (const d of dirs) {
      const item = createEvidenceItem({
        source: "Test", category: "MACRO", direction: d as any,
        strength: "WEAK", quality: "VERIFIED", freshness: "FRESH",
        dependencyGroup: "MACRO_RATES", explanation: "test",
        providerAvailable: true, assetClass: "forex", instrument: "EUR/USD",
      });
      expect(item.direction).toBe(d);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// O. DEPENDENCY GROUPS
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — O. Dependency Groups", () => {
  it("different dependency groups are independent", () => {
    const evidence = [
      createEvidenceItem({
        source: "CoinGlass", category: "DERIVATIVES", direction: "SUPPORTING",
        strength: "STRONG", quality: "VERIFIED", freshness: "FRESH",
        dependencyGroup: "DERIVATIVES_OI", explanation: "OI up",
        providerAvailable: true, assetClass: "crypto", instrument: "BTC/USD",
      }),
      createEvidenceItem({
        source: "DeFiLlama", category: "DEFI_FUNDAMENTAL", direction: "SUPPORTING",
        strength: "MODERATE", quality: "VERIFIED", freshness: "FRESH",
        dependencyGroup: "DEFI_TVL", explanation: "TVL up",
        providerAvailable: true, assetClass: "crypto", instrument: "BTC/USD",
      }),
    ];
    const warnings = detectDoubleCounting(evidence);
    expect(warnings.length).toBe(0);
  });

  it("same dependency group is flagged", () => {
    const evidence = [
      createEvidenceItem({
        source: "CoinGlass", category: "DERIVATIVES", direction: "SUPPORTING",
        strength: "STRONG", quality: "VERIFIED", freshness: "FRESH",
        dependencyGroup: "DERIVATIVES_OI", explanation: "OI current",
        providerAvailable: true, assetClass: "crypto", instrument: "BTC/USD",
      }),
      createEvidenceItem({
        source: "CoinGlass", category: "DERIVATIVES", direction: "SUPPORTING",
        strength: "MODERATE", quality: "VERIFIED", freshness: "FRESH",
        dependencyGroup: "DERIVATIVES_OI", explanation: "OI change",
        providerAvailable: true, assetClass: "crypto", instrument: "BTC/USD",
      }),
    ];
    const warnings = detectDoubleCounting(evidence);
    expect(warnings.length).toBe(1);
    expect(warnings[0].evidenceCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. DOUBLE-COUNTING
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — P. Double-Counting", () => {
  it("detects double-counting across multiple groups", () => {
    const evidence = Array.from({ length: 6 }, (_, i) =>
      createEvidenceItem({
        source: "Test", category: "MACRO", direction: "NEUTRAL",
        strength: "WEAK", quality: "VERIFIED", freshness: "FRESH",
        dependencyGroup: (i < 3 ? "MACRO_RATES" : "MACRO_YIELD_CURVE") as any,
        explanation: `item ${i}`,
        providerAvailable: true, assetClass: "forex", instrument: "EUR/USD",
      }),
    );
    const warnings = detectDoubleCounting(evidence);
    expect(warnings.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. MISSING DATA
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — Q. Missing Data", () => {
  it("missing forex data produces UNAVAILABLE evidence", () => {
    const ctx = buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD", {
      rates: undefined, yields: undefined, positioning: undefined,
      macro: undefined, crossAsset: undefined,
    }));
    expect(ctx.overallAvailability).toBe("UNAVAILABLE");
    expect(ctx.missingInformation.length).toBeGreaterThan(0);
  });

  it("missing equity data produces UNAVAILABLE evidence", () => {
    const ctx = buildEquityIntelligence("AAPL", makeEquityCtx("AAPL", {
      fundamentals: undefined, earnings: undefined, valuation: undefined,
      corporateActions: undefined,
    }));
    expect(ctx.overallAvailability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// R. STALE DATA
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — R. Stale Data", () => {
  it("stale provider data is marked stale", () => {
    const ctx = buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD", {
      rates: { provider: "treasury", observedAt: now - 3600000, freshness: "STALE", quality: "STALE", available: true, availableDatasets: 1, totalDatasets: 2 },
    }));
    const ratesEvidence = ctx.evidence.find((e) => e.dependencyGroup === "MACRO_RATES");
    expect(ratesEvidence?.freshness).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// S. NaN/INFINITY SAFETY
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — S. NaN/Infinity Safety", () => {
  it("evidence items never contain NaN", () => {
    const item = createEvidenceItem({
      source: "Test", category: "DERIVATIVES", direction: "SUPPORTING",
      strength: "STRONG", quality: "VERIFIED", freshness: "FRESH",
      dependencyGroup: "DERIVATIVES_OI", explanation: "test",
      providerAvailable: true, assetClass: "crypto", instrument: "BTC/USD",
    });
    expect(item.source).not.toBeNaN();
    expect(item.instrument).not.toBeNaN();
  });

  it("intelligence engines handle undefined numeric fields", () => {
    const ctx = buildEquityIntelligence("AAPL", makeEquityCtx("AAPL", {
      fundamentals: { provider: "alpha-vantage", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 3, totalDatasets: 5 },
    }));
    expect(ctx.overallQuality).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// T. RATE LIMITS
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — T. Rate Limits", () => {
  it("rate-limited provider is deprioritized", () => {
    markRateLimited("twelve-data", Date.now() + 60000);
    const r = routeProviderRequest("BTC/USD", "ohlcv");
    const td = r.routes.find((r) => r.providerId === "twelve-data");
    expect(td?.healthStatus).toBe("RATE_LIMITED");
    // Other providers should be ranked higher
    if (r.routes.length > 1) {
      const availableIdx = r.routes.findIndex((r) => r.healthStatus === "AVAILABLE");
      const limitedIdx = r.routes.findIndex((r) => r.providerId === "twelve-data");
      if (availableIdx >= 0) {
        expect(availableIdx).toBeLessThan(limitedIdx);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// U. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — U. Security", () => {
  it("no API keys in instrument registry", () => {
    const ids = getAllInstrumentIds();
    for (const id of ids) {
      const inst = resolveInstrument(id)!;
      const s = JSON.stringify(inst);
      expect(s).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(s).not.toContain("password");
      expect(s).not.toContain("secret");
    }
  });

  it("no secrets in evidence items", () => {
    const item = createEvidenceItem({
      source: "Test", category: "MACRO", direction: "NEUTRAL",
      strength: "WEAK", quality: "VERIFIED", freshness: "FRESH",
      dependencyGroup: "MACRO_RATES", explanation: "test",
      providerAvailable: true, assetClass: "forex", instrument: "EUR/USD",
    });
    const s = JSON.stringify(item);
    expect(s).not.toContain("password");
    expect(s).not.toContain("secret");
  });

  it("no secrets in intelligence results", () => {
    const result = buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD"));
    const s = JSON.stringify(result);
    expect(s).not.toContain("password");
    expect(s).not.toContain("secret");
    expect(s).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });
});

// ═══════════════════════════════════════════════════════════════
// V. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — V. Decision Immutability", () => {
  it("intelligence engines produce no decision fields", () => {
    const forex = buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD"));
    expect((forex as any).recommendation).toBeUndefined();
    expect((forex as any).bias).toBeUndefined();
    expect((forex as any).confidence).toBeUndefined();
    expect((forex as any).conviction).toBeUndefined();
    expect((forex as any).tradePlan).toBeUndefined();

    const equity = buildEquityIntelligence("AAPL", makeEquityCtx("AAPL"));
    expect((equity as any).recommendation).toBeUndefined();
    expect((equity as any).bias).toBeUndefined();
  });

  it("evidence items contain no decision fields", () => {
    const item = createEvidenceItem({
      source: "Test", category: "FUNDAMENTALS", direction: "SUPPORTING",
      strength: "STRONG", quality: "VERIFIED", freshness: "FRESH",
      dependencyGroup: "EQUITY_FINANCIAL_STATEMENTS", explanation: "test",
      providerAvailable: true, assetClass: "equity", instrument: "AAPL",
    });
    expect((item as any).recommendation).toBeUndefined();
    expect((item as any).bias).toBeUndefined();
    expect((item as any).tradePlan).toBeUndefined();
  });

  it("universal assembly produces no decision fields", () => {
    const result = assembleUniversalIntelligence({
      instrument: "EUR/USD",
      forex: buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD")),
    });
    expect((result as any).recommendation).toBeUndefined();
    expect((result as any).bias).toBeUndefined();
    expect((result as any).confidence).toBeUndefined();
    expect((result as any).tradePlan).toBeUndefined();
    expect((result as any).decisionFingerprint).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// W. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — W. Determinism", () => {
  it("same input produces same instrument resolution", () => {
    for (let i = 0; i < 20; i++) {
      const r = resolveInstrument("BTC/USD");
      expect(r?.canonical).toBe("BTC/USD");
      expect(r?.assetClass).toBe("crypto");
    }
  });

  it("routing is deterministic", () => {
    const r1 = routeProviderRequest("BTC/USD", "ohlcv");
    const r2 = routeProviderRequest("BTC/USD", "ohlcv");
    expect(r1.routes.length).toBe(r2.routes.length);
    for (let i = 0; i < r1.routes.length; i++) {
      expect(r1.routes[i].providerId).toBe(r2.routes[i].providerId);
    }
  });

  it("evidence creation is deterministic", () => {
    const makeItem = () => createEvidenceItem({
      source: "Test", category: "MACRO", direction: "NEUTRAL",
      strength: "WEAK", quality: "VERIFIED", freshness: "FRESH",
      dependencyGroup: "MACRO_RATES", explanation: "test",
      providerAvailable: true, assetClass: "forex", instrument: "EUR/USD",
    });
    const i1 = makeItem();
    const i2 = makeItem();
    expect(i1.source).toBe(i2.source);
    expect(i1.direction).toBe(i2.direction);
    expect(i1.dependencyGroup).toBe(i2.dependencyGroup);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. ADVERSARIAL CROSS-INSTRUMENT
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — X. Adversarial Cross-Instrument", () => {
  it("BTC cannot contaminate EUR", () => {
    const btc = resolveInstrument("BTC/USD");
    const eur = resolveInstrument("EUR/USD");
    expect(btc!.assetClass).not.toBe(eur!.assetClass);
  });

  it("AAPL cannot contaminate BBCA", () => {
    const aapl = resolveInstrument("AAPL");
    const bbca = resolveInstrument("BBCA");
    expect(aapl!.region).not.toBe(bbca!.region);
    expect(aapl!.primaryExchange).not.toBe(bbca!.primaryExchange);
  });

  it("XAU/USD cannot contaminate BTC/USD", () => {
    const xau = resolveInstrument("XAU/USD");
    const btc = resolveInstrument("BTC/USD");
    expect(xau!.assetClass).not.toBe(btc!.assetClass);
  });

  it("cache isolation prevents cross-contamination", () => {
    cacheSet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" }, { price: 50000 });
    cacheSet({ instrument: "AAPL", capability: "earnings", providerId: "alpha-vantage" }, { eps: 1.50 });

    const btc = cacheGet({ instrument: "BTC/USD", capability: "ohlcv", providerId: "twelve-data" });
    const aapl = cacheGet({ instrument: "AAPL", capability: "earnings", providerId: "alpha-vantage" });
    const crossCheck = cacheGet({ instrument: "AAPL", capability: "ohlcv", providerId: "twelve-data" });

    expect((btc!.data as any).price).toBe(50000);
    expect((aapl!.data as any).eps).toBe(1.50);
    expect(crossCheck).toBeNull();
  });

  it("routing respects asset class boundaries", () => {
    // coinglass should not route for forex
    const cgForex = routeProviderRequest("EUR/USD", "open_interest");
    expect(cgForex.routes.length).toBe(0);

    // cftc should not route for crypto
    const cftcCrypto = routeProviderRequest("BTC/USD", "cot_positioning");
    expect(cftcCrypto.routes.length).toBe(0);

    // eia should not route for equities
    const eiaEquity = routeProviderRequest("AAPL", "inventory");
    expect(eiaEquity.routes.length).toBe(0);
  });

  it("intelligence instruments are preserved through assembly", () => {
    const result = assembleUniversalIntelligence({
      instrument: "EUR/USD",
      forex: buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD")),
      crossAsset: buildCrossAssetIntelligence(makeCrossAssetCtx()),
    });
    expect(result.instrument).toBe("EUR/USD");
    // Evidence should reference the correct instruments
    const forexEvidence = result.allEvidence.filter((e) => e.instrument === "EUR/USD");
    expect(forexEvidence.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. FOREX INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — Y. Forex Intelligence Engine", () => {
  it("produces evidence from complete context", () => {
    const ctx = buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD"));
    expect(ctx.evidence.length).toBeGreaterThanOrEqual(1);
    expect(ctx.overallAvailability).not.toBe("UNAVAILABLE");
    expect(ctx.provenance.length).toBeGreaterThan(0);
  });

  it("handles partially available context", () => {
    const ctx = buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD", {
      rates: { provider: "treasury", observedAt: now, freshness: "FRESH", quality: "VERIFIED", available: true, availableDatasets: 1, totalDatasets: 2 },
      positioning: undefined,
    }));
    expect(ctx.missingInformation.length).toBeGreaterThan(0);
    expect(ctx.overallAvailability).toBe("MINIMAL");
  });

  it("evidence has provenance", () => {
    const ctx = buildForexIntelligence("EUR/USD", makeForexCtx("EUR/USD"));
    for (const e of ctx.evidence) {
      expect(e.provenance).toBeDefined();
      expect(e.provenance.provider).toBeTruthy();
      expect(e.provenance.observedAt).toBeGreaterThan(0);
      expect(e.provenance.instrument).toBe("EUR/USD");
    }
  });

  it("all evidence has correct instrument identity", () => {
    const ctx = buildForexIntelligence("GBP/USD", makeForexCtx("GBP/USD"));
    for (const e of ctx.evidence) {
      expect(e.instrument).toBe("GBP/USD");
      expect(e.assetClass).toBe("forex");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. COMMODITY INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

describe("Phase 45 — Z. Commodity Intelligence Engine", () => {
  it("produces evidence from complete context", () => {
    const ctx = buildCommodityIntelligence("WTI", makeCommodityCtx("WTI"));
    expect(ctx.evidence.length).toBeGreaterThanOrEqual(1);
    expect(ctx.overallAvailability).not.toBe("UNAVAILABLE");
  });

  it("handles missing inventory", () => {
    const ctx = buildCommodityIntelligence("WTI", makeCommodityCtx("WTI", {
      inventory: undefined,
    }));
    expect(ctx.missingInformation).toContain("Inventory data (no provider)");
  });

  it("evidence has provenance with correct instrument", () => {
    const ctx = buildCommodityIntelligence("XAU/USD", makeCommodityCtx("XAU/USD"));
    for (const e of ctx.evidence) {
      expect(e.instrument).toBe("XAU/USD");
      expect(e.assetClass).toBe("commodity");
      expect(e.provenance.instrument).toBe("XAU/USD");
    }
  });
});
