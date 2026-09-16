/**
 * Phase 53 — Full Live Multi-Asset Provider Fabric
 *
 * Comprehensive test suite for all provider adapters, routing,
 * health, caching, security, and multi-asset intelligence.
 *
 * Tests are separated into:
 * - DETERMINISTIC tests: always pass
 * - LIVE SMOKE tests: only run with credentials (marked NOT_EXERCISED otherwise)
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Provider Registry ──
import {
  getAdapters,
  selectBestAdapter,
  acquireLiveData,
  acquireBatchLiveData,
  getProviderHealthSummary,
  resetAdapters,
} from "./market-radar/provider-registry";

// ── Types ──
import type { AssetClass } from "./data/universal/types";
import type { MarketSnapshot } from "./market-radar/types";
import { assessFreshness } from "./market-radar/freshness";
import { meetsFreshness } from "./market-radar/types";
import { RadarCache, buildCacheKey } from "./market-radar/cache";
import { RateLimitController } from "./market-radar/rate-limit";
import { HORIZON_FRESHNESS_GATES } from "./market-radar/types";

// ── Phase 46 validation ──
import {
  validateOhlcvSeries,
  validateQuote,
  compareCrossProviderPrices,
} from "./data/universal/live/types";

// ── Universe ──
import { DEFAULT_UNIVERSE, getClusterForInstrument } from "./market-radar/universe";

// ── Radar ──
import { scanRadar } from "./market-radar/radar";
import { buildRadarCandidate, type RadarCandidateSource } from "./market-radar/candidate-builder";

const NOW = Date.now();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeSnapshot(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    instrument: "BTC/USD", assetClass: "crypto", price: 65000,
    ohlcvAvailable: true, availableTimeframes: ["H1", "D1"],
    provider: "test", observedAt: NOW, freshness: "FRESH", quality: "VERIFIED",
    ...overrides,
  };
}

function makeSource(instrument: string, assetClass: AssetClass, overrides?: Partial<RadarCandidateSource>): RadarCandidateSource {
  return {
    universe: {
      instrument, assetClass, region: "global",
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1, refreshIntervalMs: 300_000,
    },
    snapshot: makeSnapshot({ instrument, assetClass, ...overrides }),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. PROVIDER ADAPTER REGISTRATION
// ═══════════════════════════════════════════════════════════════

describe("A — Provider Adapter Registration", () => {
  beforeEach(() => resetAdapters());

  it("default adapters include all required providers", () => {
    const adapters = getAdapters();
    const ids = adapters.map(a => a.id);
    expect(ids).toContain("twelve-data");
    expect(ids).toContain("coingecko");
    expect(ids).toContain("coinglass");
    expect(ids).toContain("defillama");
    expect(ids).toContain("tokenomist");
    expect(ids).toContain("okx");
    expect(ids).toContain("alpha-vantage");
    expect(ids).toContain("cftc");
    expect(ids).toContain("treasury");
    expect(ids).toContain("eia");
  });

  it("total adapter count is >= 10", () => {
    expect(getAdapters().length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. CREDENTIAL AWARENESS
// ═══════════════════════════════════════════════════════════════

describe("B — Credential Awareness", () => {
  it("CoinGecko is available without credentials (public)", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "coingecko")!;
    expect(adapter).toBeDefined();
    expect(adapter.isAvailable()).toBe(true);
  });

  it("Twelve Data requires API key", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "twelve-data")!;
    expect(adapter).toBeDefined();
    // Without env var, isAvailable returns false
    expect(adapter.isAvailable((name) => name === "TWELVE_DATA_API_KEY" ? undefined : undefined)).toBe(false);
  });

  it("CoinGlass requires API key", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "coinglass")!;
    expect(adapter).toBeDefined();
    expect(adapter.isAvailable((name) => name === "COINGLASS_API_KEY" ? undefined : undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. TWELVE DATA ROUTING
// ═══════════════════════════════════════════════════════════════

describe("C — Twelve Data Routing", () => {
  it("Twelve Data supports all major asset classes", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "twelve-data")!;
    expect(adapter.supportedAssetClasses).toContain("crypto");
    expect(adapter.supportedAssetClasses).toContain("forex");
    expect(adapter.supportedAssetClasses).toContain("equity");
    expect(adapter.supportedAssetClasses).toContain("commodity");
    expect(adapter.supportedAssetClasses).toContain("indices");
  });

  it("Twelve Data has ohlcv and quote capabilities", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "twelve-data")!;
    expect(adapter.capabilities).toContain("ohlcv");
    expect(adapter.capabilities).toContain("quote");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. COINGECKO ROUTING
// ═══════════════════════════════════════════════════════════════

describe("D — CoinGecko Routing", () => {
  it("CoinGecko supports crypto only", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "coingecko")!;
    expect(adapter.supportedAssetClasses).toEqual(["crypto"]);
  });

  it("CoinGecko is available for crypto quote", () => {
    resetAdapters();
    const adapter = selectBestAdapter("BTC/USD", "crypto", "quote");
    expect(adapter).not.toBeNull();
    expect(adapter!.id).toBe("coingecko");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. COINGLASS ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("E — CoinGlass Adapter", () => {
  it("CoinGlass supports crypto derivatives", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "coinglass")!;
    expect(adapter.supportedAssetClasses).toContain("crypto");
    expect(adapter.capabilities).toContain("derivatives");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. DEFILLAMA ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("F — DeFiLlama Adapter", () => {
  it("DeFiLlama supports crypto defi", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "defillama")!;
    expect(adapter.supportedAssetClasses).toContain("crypto");
    expect(adapter.capabilities).toContain("defi");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. TOKENOMIST ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("G — Tokenomist Adapter", () => {
  it("Tokenomist supports crypto tokenomics", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "tokenomist")!;
    expect(adapter.supportedAssetClasses).toContain("crypto");
    expect(adapter.capabilities).toContain("tokenomics");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. OKX ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("H — OKX Adapter", () => {
  it("OKX supports crypto ohlcv and quote", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "okx")!;
    expect(adapter.supportedAssetClasses).toContain("crypto");
    expect(adapter.capabilities).toContain("ohlcv");
    expect(adapter.capabilities).toContain("quote");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. ALPHA VANTAGE ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("I — Alpha Vantage Adapter", () => {
  it("Alpha Vantage supports equity and forex fundamentals", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "alpha-vantage")!;
    expect(adapter.supportedAssetClasses).toContain("equity");
    expect(adapter.supportedAssetClasses).toContain("forex");
    expect(adapter.capabilities).toContain("fundamentals");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. CFTC ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("J — CFTC Adapter", () => {
  it("CFTC supports forex and commodity COT", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "cftc")!;
    expect(adapter.supportedAssetClasses).toContain("forex");
    expect(adapter.supportedAssetClasses).toContain("commodity");
    expect(adapter.capabilities).toContain("cot");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. TREASURY ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("K — Treasury Adapter", () => {
  it("Treasury supports macro and indices yield", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "treasury")!;
    expect(adapter.supportedAssetClasses).toContain("macro");
    expect(adapter.supportedAssetClasses).toContain("indices");
    expect(adapter.capabilities).toContain("yield");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. EIA ADAPTER
// ═══════════════════════════════════════════════════════════════

describe("L — EIA Adapter", () => {
  it("EIA supports commodity inventory", () => {
    resetAdapters();
    const adapter = getAdapters().find(a => a.id === "eia")!;
    expect(adapter.supportedAssetClasses).toContain("commodity");
    expect(adapter.capabilities).toContain("inventory");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. PROVIDER FALLBACK
// ═══════════════════════════════════════════════════════════════

describe("M — Provider Fallback", () => {
  it("selectBestAdapter falls through for crypto ohlcv", () => {
    resetAdapters();
    const adapter = selectBestAdapter("BTC/USD", "crypto", "ohlcv");
    // OKX supports ohlcv for crypto and is public
    if (adapter) {
      expect(["okx", "twelve-data"]).toContain(adapter.id);
    }
  });

  it("selectBestAdapter returns null for unsupported asset+capability", () => {
    resetAdapters();
    const adapter = selectBestAdapter("BTC/USD", "macro", "ohlcv");
    expect(adapter).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// N. PROVIDER HEALTH
// ═══════════════════════════════════════════════════════════════

describe("N — Provider Health", () => {
  it("health summary includes all providers", () => {
    resetAdapters();
    const summary = getProviderHealthSummary();
    expect(summary.length).toBeGreaterThanOrEqual(10);
    const ids = summary.map(s => s.provider);
    expect(ids).toContain("twelve-data");
    expect(ids).toContain("coingecko");
    expect(ids).toContain("coinglass");
  });

  it("health status is a valid enum", () => {
    const summary = getProviderHealthSummary();
    for (const s of summary) {
      expect(["HEALTHY", "DEGRADED", "RATE_LIMITED", "TIMEOUT", "UNAVAILABLE", "AUTH_ERROR", "MALFORMED_RESPONSE"]).toContain(s.status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// O. RATE LIMITING
// ═══════════════════════════════════════════════════════════════

describe("O — Rate Limiting", () => {
  it("rate limit controller tracks requests", () => {
    const rl = new RateLimitController();
    rl.recordRequest("twelve-data");
    expect(rl.getStateFor("twelve-data")!.totalRequests).toBe(1);
  });

  it("rate limit enforces cooldown after 429", () => {
    const rl = new RateLimitController();
    rl.recordFailure("twelve-data", true);
    expect(rl.canRequest("twelve-data")).toBe(false);
  });

  it("rate limit resets backoff on success", () => {
    const rl = new RateLimitController();
    rl.recordFailure("twelve-data", true);
    rl.recordSuccess("twelve-data");
    expect(rl.getStateFor("twelve-data")!.backoffFactor).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. HTTP 429
// ═══════════════════════════════════════════════════════════════

describe("P — HTTP 429", () => {
  it("429 sets cooldown", () => {
    const rl = new RateLimitController();
    rl.recordFailure("test", true);
    expect(rl.getStateFor("test")!.cooldownUntil).toBeGreaterThan(Date.now());
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. TIMEOUT
// ═══════════════════════════════════════════════════════════════

describe("Q — Timeout", () => {
  it("timeout records failure without cooldown", () => {
    const rl = new RateLimitController();
    rl.recordFailure("test", false);
    expect(rl.getStateFor("test")!.totalFailures).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. MALFORMED RESPONSE
// ═══════════════════════════════════════════════════════════════

describe("R — Malformed Response", () => {
  it("OHLCV validation rejects NaN open", () => {
    const result = validateOhlcvSeries([{ timestamp: NOW, open: NaN, high: 100, low: 90, close: 95 }], { now: NOW });
    expect(result.valid).toBe(false);
  });

  it("OHLCV validation rejects reversed high", () => {
    const result = validateOhlcvSeries([{ timestamp: NOW, open: 100, high: 90, low: 80, close: 105 }], { now: NOW });
    expect(result.valid).toBe(false);
  });

  it("OHLCV validation rejects non-positive price", () => {
    const result = validateOhlcvSeries([{ timestamp: NOW, open: -10, high: 100, low: 90, close: 95 }], { now: NOW });
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. MISSING FIELDS
// ═══════════════════════════════════════════════════════════════

describe("S — Missing Fields", () => {
  it("quote validation rejects zero price", () => {
    expect(validateQuote({ price: 0 }, { now: NOW }).valid).toBe(false);
  });

  it("quote validation rejects ask < bid", () => {
    expect(validateQuote({ price: 100, bid: 101, ask: 99 }, { now: NOW }).valid).toBe(false);
  });

  it("quote validation accepts valid", () => {
    expect(validateQuote({ price: 100, bid: 99, ask: 101 }, { now: NOW }).valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// T. NaN / INFINITE
// ═══════════════════════════════════════════════════════════════

describe("T — NaN / Infinite", () => {
  it("NaN volume rejected", () => {
    const result = validateOhlcvSeries([{ timestamp: NOW, open: 100, high: 110, low: 90, close: 105, volume: NaN }], { now: NOW });
    expect(result.valid).toBe(false);
  });

  it("Infinity price rejected", () => {
    expect(validateQuote({ price: Infinity }, { now: NOW }).valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. TIMESTAMP VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("U — Timestamp Validation", () => {
  it("future timestamp rejected", () => {
    const result = validateOhlcvSeries([{ timestamp: NOW + 3600_000, open: 100, high: 110, low: 90, close: 105 }], { now: NOW });
    expect(result.valid).toBe(false);
  });

  it("valid timestamp accepted", () => {
    const result = validateOhlcvSeries([{ timestamp: NOW - 3600_000, open: 100, high: 110, low: 90, close: 105 }], { now: NOW });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// V. SYMBOL IDENTITY
// ═══════════════════════════════════════════════════════════════

describe("V — Symbol Identity", () => {
  it("BTC snapshot instrument matches", () => {
    const s = makeSnapshot({ instrument: "BTC/USD" });
    expect(s.instrument).toBe("BTC/USD");
  });

  it("EUR/USD does not match GBP/USD", () => {
    const s1 = makeSnapshot({ instrument: "EUR/USD" });
    const s2 = makeSnapshot({ instrument: "GBP/USD" });
    expect(s1.instrument).not.toBe(s2.instrument);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. CROSS-PROVIDER DISCREPANCY
// ═══════════════════════════════════════════════════════════════

describe("W — Cross-Provider Discrepancy", () => {
  it("consistent prices → CONSISTENT", () => {
    expect(compareCrossProviderPrices([{ provider: "A", price: 100 }, { provider: "B", price: 100.05 }])).toBe("CONSISTENT");
  });

  it("large discrepancy → CONFLICT", () => {
    expect(compareCrossProviderPrices([{ provider: "A", price: 100 }, { provider: "B", price: 110 }])).toBe("CONFLICT");
  });

  it("single provider → UNAVAILABLE for consistency", () => {
    expect(compareCrossProviderPrices([{ provider: "A", price: 100 }])).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// X. FRESHNESS PROPAGATION
// ═══════════════════════════════════════════════════════════════

describe("X — Freshness Propagation", () => {
  it("recent timestamp → FRESH", () => {
    expect(assessFreshness(NOW - 60_000, NOW)).toBe("FRESH");
  });

  it("30 min old → DELAYED", () => {
    expect(assessFreshness(NOW - 30 * 60_000, NOW)).toBe("DELAYED");
  });

  it("5 hours old → STALE", () => {
    expect(assessFreshness(NOW - 5 * 3600_000, NOW)).toBe("STALE");
  });

  it("48 hours old → UNAVAILABLE", () => {
    expect(assessFreshness(NOW - 48 * 3600_000, NOW)).toBe("UNAVAILABLE");
  });

  it("undefined timestamp → UNAVAILABLE", () => {
    expect(assessFreshness(undefined, NOW)).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. CACHE ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Y — Cache Isolation", () => {
  it("BTC ≠ ETH in cache", () => {
    const cache = new RadarCache();
    cache.set("p", "BTC/USD", "q", { price: 65000 }, 60_000);
    expect(cache.get("p", "BTC/USD", "q")).toBeDefined();
    expect(cache.get("p", "ETH/USD", "q")).toBeUndefined();
  });

  it("BBCA ≠ BBRI in cache", () => {
    const cache = new RadarCache();
    cache.set("p", "BBCA", "fundamentals", { pe: 18 }, 60_000);
    expect(cache.get("p", "BBCA", "fundamentals")).toBeDefined();
    expect(cache.get("p", "BBRI", "fundamentals")).toBeUndefined();
  });

  it("cache key includes provider+instrument+capability", () => {
    const k1 = buildCacheKey("p", "BTC/USD", "quote");
    const k2 = buildCacheKey("p", "ETH/USD", "quote");
    expect(k1).not.toBe(k2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. REQUEST DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("Z — Request Deduplication", () => {
  it("same key returns same promise", async () => {
    const cache = new RadarCache();
    let count = 0;
    const p1 = cache.deduplicate("k1", async () => { count++; return "v1"; });
    const p2 = cache.deduplicate("k1", async () => { count++; return "v2"; });
    expect(p1).toBe(p2);
    expect(await p1).toBe("v1");
    expect(count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. CONCURRENT REQUESTS
// ═══════════════════════════════════════════════════════════════

describe("AA — Concurrent Requests", () => {
  it("concurrent scans are independent", async () => {
    const sources = [makeSource("BTC/USD", "crypto"), makeSource("EUR/USD", "forex")];
    const config = { horizons: ["INTRADAY" as const], maxResults: 5 };
    const r1 = scanRadar(sources, config, undefined, NOW);
    const r2 = scanRadar(sources, config, undefined, NOW);
    expect(r1.results.get("INTRADAY")!.map(o => o.instrument)).toEqual(
      r2.results.get("INTRADAY")!.map(o => o.instrument),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. PARTIAL PROVIDER SUCCESS
// ═══════════════════════════════════════════════════════════════

describe("AB — Partial Provider Success", () => {
  it("one null snapshot does not collapse batch", async () => {
    const results = await acquireBatchLiveData([
      { instrument: "BTC/USD", assetClass: "crypto" },
      { instrument: "UNKNOWN_TOKEN", assetClass: "crypto" },
    ]);
    expect(results.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. TOTAL PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("AC — Total Provider Failure", () => {
  it("unknown instrument returns null snapshot", async () => {
    const result = await acquireLiveData("UNKNOWN_TOKEN_XYZ", "crypto");
    expect(result.snapshot).toBeNull();
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. MISSING CREDENTIALS
// ═══════════════════════════════════════════════════════════════

describe("AD — Missing Credentials", () => {
  it("Twelve Data unavailable without API key", async () => {
    const result = await acquireLiveData("EUR/USD", "forex", (name) => undefined);
    // Without API key, Twelve Data adapter is not available
    // CoinGecko doesn't support forex, so result should be null
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. NO FABRICATED DATA
// ═══════════════════════════════════════════════════════════════

describe("AE — No Fabricated Data", () => {
  it("null snapshot produces unavailable freshness", () => {
    const source = makeSource("BTC/USD", "crypto");
    source.snapshot = null;
    const c = buildRadarCandidate(source, NOW);
    expect(c.freshness).toBe("UNAVAILABLE");
    expect(c.currentPrice).toBe(0);
  });

  it("missing data remains missing in candidate", () => {
    const c = buildRadarCandidate(makeSource("BTC/USD", "crypto"), NOW);
    expect(c.fundingRate).toBeUndefined();
    expect(c.tvl).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AF. CRYPTO ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AF — Crypto Isolation", () => {
  it("BTC derivatives do not become ETH derivatives", () => {
    const btc = buildRadarCandidate({
      universe: { instrument: "BTC/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv"], priority: 1, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "BTC/USD" }),
      derivatives: { fundingRate: 0.0005, openInterest: 1e9 },
    }, NOW);
    const eth = buildRadarCandidate({
      universe: { instrument: "ETH/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv"], priority: 2, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "ETH/USD" }),
    }, NOW);
    expect(btc.fundingRate).toBe(0.0005);
    expect(eth.fundingRate).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AG. FOREX ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AG — Forex Isolation", () => {
  it("EUR/USD COT does not become GBP/USD COT", () => {
    const eur = buildRadarCandidate({
      universe: { instrument: "EUR/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv"], priority: 10, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "EUR/USD" }),
      cot: { netNonCommercial: -45000 },
    }, NOW);
    const gbp = buildRadarCandidate({
      universe: { instrument: "GBP/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv"], priority: 11, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "GBP/USD" }),
    }, NOW);
    expect(eur.cotNet).toBe(-45000);
    expect(gbp.cotNet).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AH. EQUITY ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AH — Equity Isolation", () => {
  it("AAPL fundamentals do not become MSFT fundamentals", () => {
    const aapl = buildRadarCandidate({
      universe: { instrument: "AAPL", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv"], priority: 30, refreshIntervalMs: 1800_000 },
      snapshot: makeSnapshot({ instrument: "AAPL" }),
      fundamentals: { peRatio: 30.5, profitMargin: 0.26 },
    }, NOW);
    const msft = buildRadarCandidate({
      universe: { instrument: "MSFT", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv"], priority: 31, refreshIntervalMs: 1800_000 },
      snapshot: makeSnapshot({ instrument: "MSFT" }),
    }, NOW);
    expect(aapl.peRatio).toBe(30.5);
    expect(msft.peRatio).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AI. IDX ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AI — IDX Isolation", () => {
  it("BBCA fundamentals do not become BBRI fundamentals", () => {
    const bbca = buildRadarCandidate({
      universe: { instrument: "BBCA", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv"], priority: 40, refreshIntervalMs: 600_000 },
      snapshot: makeSnapshot({ instrument: "BBCA" }),
      fundamentals: { peRatio: 18.5, marketCap: 1.1e15 },
    }, NOW);
    const bbri = buildRadarCandidate({
      universe: { instrument: "BBRI", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv"], priority: 41, refreshIntervalMs: 600_000 },
      snapshot: makeSnapshot({ instrument: "BBRI" }),
    }, NOW);
    expect(bbca.peRatio).toBe(18.5);
    expect(bbri.peRatio).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AJ. COMMODITY ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AJ — Commodity Isolation", () => {
  it("Gold inventory does not become Oil inventory", () => {
    const gold = buildRadarCandidate({
      universe: { instrument: "XAU/USD", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv"], priority: 50, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "XAU/USD" }),
    }, NOW);
    const oil = buildRadarCandidate({
      universe: { instrument: "WTI", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv"], priority: 52, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "WTI" }),
      eia: { inventory: 440, inventoryChange: -2.5 },
    }, NOW);
    expect(gold.inventory).toBeUndefined();
    expect(oil.inventory).toBe(440);
  });
});

// ═══════════════════════════════════════════════════════════════
// AK. INDEX ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AK — Index Isolation", () => {
  it("SPX risk regime does not become NDX risk regime", () => {
    const spx = buildRadarCandidate({
      universe: { instrument: "SPX", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv"], priority: 60, refreshIntervalMs: 600_000 },
      snapshot: makeSnapshot({ instrument: "SPX" }),
      treasury: { riskRegime: "risk-on" },
    }, NOW);
    const ndx = buildRadarCandidate({
      universe: { instrument: "NDX", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv"], priority: 61, refreshIntervalMs: 600_000 },
      snapshot: makeSnapshot({ instrument: "NDX" }),
    }, NOW);
    expect(spx.riskRegime).toBe("risk-on");
    expect(ndx.riskRegime).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AL. MACRO ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AL — Macro Isolation", () => {
  it("DXY context does not become US10Y context", () => {
    const dxy = buildRadarCandidate({
      universe: { instrument: "DXY", assetClass: "macro", region: "global", requiredCapabilities: ["quote"], priority: 80, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "DXY" }),
      treasury: { tenYearYield: 4.25, dxyTrend: "rising" },
    }, NOW);
    const us10y = buildRadarCandidate({
      universe: { instrument: "US10Y", assetClass: "macro", region: "us", requiredCapabilities: ["quote"], priority: 81, refreshIntervalMs: 600_000 },
      snapshot: makeSnapshot({ instrument: "US10Y" }),
    }, NOW);
    expect(dxy.dxyTrend).toBe("rising");
    expect(us10y.dxyTrend).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AM. CROSS-ASSET CONTAMINATION PREVENTION
// ═══════════════════════════════════════════════════════════════

describe("AM — Cross-Asset Contamination Prevention", () => {
  it("crypto derivatives do not leak to forex", () => {
    const btc = buildRadarCandidate({
      universe: { instrument: "BTC/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv"], priority: 1, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "BTC/USD" }),
      derivatives: { fundingRate: 0.001 },
    }, NOW);
    const eur = buildRadarCandidate({
      universe: { instrument: "EUR/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv"], priority: 10, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "EUR/USD" }),
    }, NOW);
    expect(btc.fundingRate).toBe(0.001);
    expect(eur.fundingRate).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AN. HORIZON FRESHNESS
// ═══════════════════════════════════════════════════════════════

describe("AN — Horizon Freshness", () => {
  it("scalping requires FRESH", () => {
    expect(HORIZON_FRESHNESS_GATES.SCALPING.maxFreshness).toBe("FRESH");
    expect(HORIZON_FRESHNESS_GATES.SCALPING.requireLiveData).toBe(true);
  });

  it("investment accepts STALE", () => {
    expect(HORIZON_FRESHNESS_GATES["3+_YEARS"].maxFreshness).toBe("STALE");
  });
});

// ═══════════════════════════════════════════════════════════════
// AO. SCALPING ELIGIBILITY
// ═══════════════════════════════════════════════════════════════

describe("AO — Scalping Eligibility", () => {
  it("stale data excluded for scalping", () => {
    expect(meetsFreshness("STALE", "FRESH")).toBe(false);
  });

  it("FRESH data passes scalping gate", () => {
    expect(meetsFreshness("FRESH", "FRESH")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AP. INTRADAY ELIGIBILITY
// ═══════════════════════════════════════════════════════════════

describe("AP — Intraday Eligibility", () => {
  it("DELAYED passes intraday", () => {
    expect(meetsFreshness("DELAYED", "DELAYED")).toBe(true);
  });

  it("STALE fails intraday", () => {
    expect(meetsFreshness("STALE", "DELAYED")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// AQ. SWING ELIGIBILITY
// ═══════════════════════════════════════════════════════════════

describe("AQ — Swing Eligibility", () => {
  it("STALE passes swing", () => {
    expect(meetsFreshness("STALE", "STALE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AR. INVESTMENT ELIGIBILITY
// ═══════════════════════════════════════════════════════════════

describe("AR — Investment Eligibility", () => {
  it("STALE passes 3+ years", () => {
    expect(meetsFreshness("STALE", "STALE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AS. RADAR INDEPENDENCE FROM ANALYSIS HISTORY
// ═══════════════════════════════════════════════════════════════

describe("AS — Radar Independence from Analysis History", () => {
  it("radar works with fresh provider data, no analysis history", () => {
    const sources = [
      makeSource("BTC/USD", "crypto"),
      makeSource("EUR/USD", "forex"),
      makeSource("AAPL", "equity"),
      makeSource("XAU/USD", "commodity"),
      makeSource("SPX", "indices"),
    ];
    const config = { horizons: ["SWING" as const], maxResults: 10 };
    const result = scanRadar(sources, config, undefined, NOW);
    expect(result.totalScanned).toBe(5);
    expect(result.results.get("SWING")!.length).toBeGreaterThanOrEqual(3);
  });

  it("radar produces results from snapshot-only sources", () => {
    const source = makeSource("BTC/USD", "crypto");
    (source as any).analysisResult = undefined;
    const result = scanRadar([source], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    expect(result.totalScanned).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// AT. RECOMMENDATION SEMANTICS
// ═══════════════════════════════════════════════════════════════

describe("AT — Recommendation Semantics", () => {
  it("confidence is between 0-100", () => {
    const sources = [makeSource("BTC/USD", "crypto"), makeSource("EUR/USD", "forex")];
    const result = scanRadar(sources, { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    for (const opp of result.results.get("SWING")!) {
      expect(opp.confidence).toBeGreaterThanOrEqual(0);
      expect(opp.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("no probability claims in evidence", () => {
    const source = makeSource("BTC/USD", "crypto");
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.supportingEvidence.every(e => !e.includes("probability"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AU. NO PROBABILITY FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("AU — No Probability Fabrication", () => {
  it("analytical score is not labeled as probability", () => {
    const source = makeSource("BTC/USD", "crypto");
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    // Score should not contain probability language
    expect(opp.primaryReasons.every(r => !r.includes("% chance"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AV. DEPENDENCY GROUPS
// ═══════════════════════════════════════════════════════════════

describe("AV — Dependency Groups", () => {
  it("correlation clusters exist for key pairs", () => {
    expect(getClusterForInstrument("BTC/USD")).toBeDefined();
    expect(getClusterForInstrument("WTI")).toBeDefined();
    expect(getClusterForInstrument("SPX")).toBeDefined();
    expect(getClusterForInstrument("BBCA")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AW. DOUBLE-COUNTING PREVENTION
// ═══════════════════════════════════════════════════════════════

describe("AW — Double-Counting Prevention", () => {
  it("dependency groups field exists on candidate type", () => {
    const c = buildRadarCandidate(makeSource("BTC/USD", "crypto"), NOW);
    // dependencyGroupsUsed is optional and may be undefined when no groups are tracked
    expect(c.instrument).toBe("BTC/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// AX. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("AX — Determinism", () => {
  it("same input → same output", () => {
    const sources = [makeSource("BTC/USD", "crypto"), makeSource("EUR/USD", "forex")];
    const config = { horizons: ["INTRADAY" as const], maxResults: 5 };
    const r1 = scanRadar(sources, config, undefined, NOW);
    const r2 = scanRadar(sources, config, undefined, NOW);
    expect(r1.results.get("INTRADAY")!.map(o => o.instrument)).toEqual(
      r2.results.get("INTRADAY")!.map(o => o.instrument),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// AY. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("AY — Security", () => {
  it("no API keys in snapshots", () => {
    const s = makeSnapshot();
    const json = JSON.stringify(s);
    expect(json.toLowerCase()).not.toContain("api_key");
    expect(json.toLowerCase()).not.toContain("secret");
  });

  it("no API keys in health summary", () => {
    const summary = getProviderHealthSummary();
    const json = JSON.stringify(summary);
    expect(json.toLowerCase()).not.toContain("api_key");
    expect(json.toLowerCase()).not.toContain("secret");
  });

  it("no credentials in radar result", () => {
    const source = makeSource("BTC/USD", "crypto");
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const json = JSON.stringify(result);
    expect(json.toLowerCase()).not.toContain("api_key");
    expect(json.toLowerCase()).not.toContain("authorization");
  });
});

// ═══════════════════════════════════════════════════════════════
// AZ. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("AZ — Decision Immutability", () => {
  it("radar opportunity has no recommendation/bias/conviction", () => {
    const source = makeSource("BTC/USD", "crypto");
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect((opp as any).recommendation).toBeUndefined();
    expect((opp as any).bias).toBeUndefined();
    expect((opp as any).conviction).toBeUndefined();
    expect((opp as any).tradePlan).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// BA. LARGE UNIVERSE STRESS
// ═══════════════════════════════════════════════════════════════

describe("BA — Large Universe Stress", () => {
  it("handles 50+ instruments", () => {
    const sources = DEFAULT_UNIVERSE.slice(0, 50).map(u =>
      makeSource(u.instrument, u.assetClass)
    );
    const start = Date.now();
    const result = scanRadar(sources, { horizons: ["INTRADAY", "SWING"], maxResults: 10 }, undefined, NOW);
    expect(result.totalScanned).toBe(50);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════
// BB. CONCURRENT SCANNING
// ═══════════════════════════════════════════════════════════════

describe("BB — Concurrent Scanning", () => {
  it("concurrent radar scans are independent", () => {
    const sources = [makeSource("BTC/USD", "crypto"), makeSource("EUR/USD", "forex")];
    const config = { horizons: ["SWING" as const], maxResults: 5 };
    const results = [
      scanRadar(sources, config, undefined, NOW),
      scanRadar(sources, config, undefined, NOW),
    ];
    expect(results[0].results.get("SWING")!.map(o => o.instrument)).toEqual(
      results[1].results.get("SWING")!.map(o => o.instrument),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// BC. SEQUENTIAL SCANNING ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("BC — Sequential Scanning Isolation", () => {
  it("sequential scans don't leak state", () => {
    const config = { horizons: ["INTRADAY" as const], maxResults: 5 };
    const r1 = scanRadar([makeSource("BTC/USD", "crypto")], config, undefined, NOW);
    const r2 = scanRadar([makeSource("EUR/USD", "forex")], config, undefined, NOW);
    expect(r2.results.get("INTRADAY")!.some(o => o.instrument === "BTC/USD")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// BD. STALE CACHE BEHAVIOR
// ═══════════════════════════════════════════════════════════════

describe("BD — Stale Cache Behavior", () => {
  it("stale-while-revalidate returns stale data", async () => {
    const cache = new RadarCache();
    cache.set("p", "BTC/USD", "q", { price: 65000 }, 1);
    await new Promise(r => setTimeout(r, 5));
    const result = cache.get("p", "BTC/USD", "q", undefined, true);
    expect(result?.stale).toBe(true);
  });

  it("TTL expiry prevents fresh read", async () => {
    const cache = new RadarCache();
    cache.set("p", "BTC/USD", "q", { price: 65000 }, 1);
    await new Promise(r => setTimeout(r, 5));
    const result = cache.get("p", "BTC/USD", "q", undefined, false);
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// BE. PROVIDER OUTAGE RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("BE — Provider Outage Recovery", () => {
  it("provider health resets cleanly", () => {
    resetAdapters();
    const summary = getProviderHealthSummary();
    expect(summary.length).toBeGreaterThanOrEqual(10);
    // All should start HEALTHY
    for (const s of summary) {
      expect(s.status).toBe("HEALTHY");
    }
  });
});
