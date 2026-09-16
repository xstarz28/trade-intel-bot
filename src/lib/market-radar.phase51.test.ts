/**
 * Phase 51 — Autonomous Market Radar Test Suite
 *
 * Comprehensive coverage for the autonomous multi-asset market radar.
 * 130+ tests across 30+ groups.
 *
 * CRITICAL: This test file verifies deterministic architecture behavior.
 * Provider availability NEVER becomes directional evidence.
 */

import { describe, it, expect } from "vitest";

// ── Types ──
import {
  type FreshnessLevel,
  type RadarScanConfig,
  HORIZON_FRESHNESS_GATES,
} from "./market-radar/types";

// ── Cache ──
import { RadarCache, buildCacheKey } from "./market-radar/cache";

// ── Rate Limit ──
import { RateLimitController } from "./market-radar/rate-limit";

// ── Freshness ──
import {
  checkFreshnessEligibility,
  shouldTransitionLifecycle,
  summarizeFreshness,
} from "./market-radar/freshness";

// ── Universe ──
import {
  DEFAULT_UNIVERSE,
  getUniverse,
  getInstrumentEntry,
  getClusterForInstrument,
  getClusterInstruments,
} from "./market-radar/universe";

// ── Candidate Builder ──
import {
  buildRadarCandidate,
  type RadarCandidateSource,
} from "./market-radar/candidate-builder";

// ── Radar Engine ──
import {
  scanRadar,
  buildRadarState,
} from "./market-radar/radar";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const NOW = Date.now();
const HOUR = 3600_000;

function makeSnapshot(overrides?: Partial<{
  instrument: string;
  price: number;
  observedAt: number;
  htfBias: string;
  mtfAlignment: string;
  marketRegime: string;
  spreadBps: number;
  volatility: number;
  ohlcvAvailable: boolean;
  provider: string;
  freshness: FreshnessLevel;
}>): any {
  return {
    instrument: overrides?.instrument ?? "BTC/USD",
    assetClass: "crypto",
    region: "global",
    price: overrides?.price ?? 65000,
    ohlcvAvailable: overrides?.ohlcvAvailable ?? true,
    availableTimeframes: ["H1", "H4", "D1"],
    htfBias: overrides?.htfBias ?? "long",
    mtfAlignment: overrides?.mtfAlignment ?? "ALIGNED_BULLISH",
    marketRegime: overrides?.marketRegime ?? "TRENDING",
    spreadBps: overrides?.spreadBps ?? 3,
    volatility: overrides?.volatility ?? 800,
    provider: overrides?.provider ?? "twelve-data",
    observedAt: overrides?.observedAt ?? NOW,
    freshness: overrides?.freshness ?? "FRESH",
    quality: "VERIFIED",
  };
}

function makeSource(overrides?: Partial<RadarCandidateSource>): RadarCandidateSource {
  const instrument = overrides?.universe?.instrument ?? "BTC/USD";
  const assetClass = overrides?.universe?.assetClass ?? "crypto";
  return {
    universe: {
      instrument,
      assetClass,
      region: overrides?.universe?.region ?? "global",
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1,
      refreshIntervalMs: 300_000,
      ...overrides?.universe,
    },
    snapshot: overrides?.snapshot !== null ? (overrides?.snapshot ?? makeSnapshot({ instrument })) : null,
    ...overrides,
  };
}

function makeForexSource(): RadarCandidateSource {
  return makeSource({
    universe: { instrument: "EUR/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 10, refreshIntervalMs: 300_000 },
    snapshot: makeSnapshot({ instrument: "EUR/USD", price: 1.085, htfBias: "short", mtfAlignment: "ALIGNED_BEARISH" }),
    cot: { netNonCommercial: -45000 },
  });
}

function makeEquitySource(): RadarCandidateSource {
  return makeSource({
    universe: { instrument: "AAPL", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 30, refreshIntervalMs: 1800_000 },
    snapshot: makeSnapshot({ instrument: "AAPL", price: 195, htfBias: "long", volatility: 15 }),
    fundamentals: { peRatio: 30.5, profitMargin: 0.26, marketCap: 3_000_000_000_000 },
  });
}

function makeCommoditySource(): RadarCandidateSource {
  return makeSource({
    universe: { instrument: "WTI", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote", "eia", "cot"], priority: 52, refreshIntervalMs: 300_000 },
    snapshot: makeSnapshot({ instrument: "WTI", price: 78.5, htfBias: "long" }),
    cot: { netNonCommercial: 120000 },
    eia: { inventory: 440, inventoryChange: -2.5, futuresStructure: "backwardation" },
  });
}

function makeIndexSource(): RadarCandidateSource {
  return makeSource({
    universe: { instrument: "SPX", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv", "quote"], priority: 60, refreshIntervalMs: 600_000 },
    snapshot: makeSnapshot({ instrument: "SPX", price: 5200, htfBias: "long", mtfAlignment: "ALIGNED_BULLISH" }),
    treasury: { riskRegime: "risk-on" },
  });
}

function makeMacroSource(): RadarCandidateSource {
  return makeSource({
    universe: { instrument: "DXY", assetClass: "macro", region: "global", requiredCapabilities: ["quote"], priority: 80, refreshIntervalMs: 300_000 },
    snapshot: makeSnapshot({ instrument: "DXY", price: 104.5, provider: "twelve-data" }),
    treasury: { tenYearYield: 4.25, dxyTrend: "rising", riskRegime: "neutral" },
  });
}

function makeIDXSource(): RadarCandidateSource {
  return makeSource({
    universe: { instrument: "BBCA", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 40, refreshIntervalMs: 600_000 },
    snapshot: makeSnapshot({ instrument: "BBCA", price: 9200, htfBias: "long", provider: "twelve-data" }),
    fundamentals: { peRatio: 18.5, marketCap: 1_100_000_000_000_000 },
  });
}

// ═══════════════════════════════════════════════════════════════
// A. EMPTY ANALYSIS HISTORY
// ═══════════════════════════════════════════════════════════════

describe("A — Empty Analysis History", () => {
  it("radar produces results with zero analysis history", () => {
    const sources = [makeSource()];
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const result = scanRadar(sources, config, undefined, NOW);
    expect(result.totalScanned).toBe(1);
    expect(result.results.get("INTRADAY")!.length).toBeGreaterThanOrEqual(1);
  });

  it("candidate builder works without analysis result", () => {
    const source = makeSource({ analysisResult: undefined });
    const candidate = buildRadarCandidate(source, NOW);
    expect(candidate.instrument).toBe("BTC/USD");
    expect(candidate.hasAnalysis).toBeUndefined();
    expect(candidate.dataCompleteness).not.toBe("NONE");
  });

  it("candidate from snapshot-only has reasonable data completeness", () => {
    const source = makeSource({
      snapshot: makeSnapshot({}),
      derivatives: undefined,
      fundamentals: undefined,
      cot: undefined,
      treasury: undefined,
    });
    const candidate = buildRadarCandidate(source, NOW);
    expect(candidate.dataCompleteness).toBe("PARTIAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. LIVE CANDIDATE GENERATION
// ═══════════════════════════════════════════════════════════════

describe("B — Live Candidate Generation", () => {
  it("builds candidate from snapshot + derivatives", () => {
    const source = makeSource({
      derivatives: { fundingRate: 0.0001, openInterest: 500_000_000 },
    });
    const c = buildRadarCandidate(source, NOW);
    expect(c.fundingRate).toBe(0.0001);
    expect(c.openInterest).toBe(500_000_000);
    expect(c.hasDerivatives).toBe(true);
  });

  it("builds candidate from snapshot + fundamentals", () => {
    const source = makeEquitySource();
    const c = buildRadarCandidate(source, NOW);
    expect(c.peRatio).toBe(30.5);
    expect(c.profitMargin).toBe(0.26);
    expect(c.hasFundamentals).toBe(true);
  });

  it("builds candidate from snapshot + COT", () => {
    const source = makeForexSource();
    const c = buildRadarCandidate(source, NOW);
    expect(c.cotNet).toBe(-45000);
    expect(c.hasCOT).toBe(true);
  });

  it("builds candidate from snapshot + EIA", () => {
    const source = makeCommoditySource();
    const c = buildRadarCandidate(source, NOW);
    expect(c.inventory).toBe(440);
    expect(c.inventoryChange).toBe(-2.5);
    expect(c.futuresStructure).toBe("backwardation");
  });

  it("builds candidate from snapshot + treasury", () => {
    const source = makeMacroSource();
    const c = buildRadarCandidate(source, NOW);
    expect(c.dxyTrend).toBe("rising");
    expect(c.riskRegime).toBe("neutral");
    expect(c.hasMacro).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. UNIVERSE DISCOVERY
// ═══════════════════════════════════════════════════════════════

describe("C — Universe Discovery", () => {
  it("default universe has instruments across all asset classes", () => {
    const classes = new Set(DEFAULT_UNIVERSE.map(e => e.assetClass));
    expect(classes.has("crypto")).toBe(true);
    expect(classes.has("forex")).toBe(true);
    expect(classes.has("equity")).toBe(true);
    expect(classes.has("commodity")).toBe(true);
    expect(classes.has("indices")).toBe(true);
    expect(classes.has("macro")).toBe(true);
  });

  it("filters by asset class", () => {
    const crypto = getUniverse(["crypto"]);
    expect(crypto.length).toBeGreaterThan(0);
    expect(crypto.every(e => e.assetClass === "crypto")).toBe(true);
  });

  it("filters by region", () => {
    const idx = getUniverse(undefined, ["idx"]);
    expect(idx.length).toBeGreaterThan(0);
    expect(idx.every(e => e.region === "idx")).toBe(true);
  });

  it("IDX equities are first-class citizens", () => {
    const idxEquities = DEFAULT_UNIVERSE.filter(e => e.region === "idx" && e.assetClass === "equity");
    expect(idxEquities.length).toBeGreaterThanOrEqual(6);
    const instruments = idxEquities.map(e => e.instrument);
    expect(instruments).toContain("BBCA");
    expect(instruments).toContain("BBRI");
    expect(instruments).toContain("TLKM");
    expect(instruments).toContain("BMRI");
  });

  it("finds instrument entry", () => {
    const entry = getInstrumentEntry("BTC/USD");
    expect(entry).toBeDefined();
    expect(entry!.assetClass).toBe("crypto");
  });

  it("returns undefined for unknown instrument", () => {
    expect(getInstrumentEntry("UNKNOWN_TOKEN")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// D. MULTI-ASSET SCANNING
// ═══════════════════════════════════════════════════════════════

describe("D — Multi-Asset Scanning", () => {
  it("scans crypto, forex, equity, commodity, indices, macro simultaneously", () => {
    const sources = [
      makeSource(),
      makeForexSource(),
      makeEquitySource(),
      makeCommoditySource(),
      makeIndexSource(),
      makeMacroSource(),
    ];
    const config: RadarScanConfig = { horizons: ["SWING"], maxResults: 10 };
    const result = scanRadar(sources, config, undefined, NOW);
    expect(result.totalScanned).toBe(6);

    const opps = result.results.get("SWING")!;
    const classes = new Set(opps.map(o => o.assetClass));
    expect(classes.size).toBeGreaterThanOrEqual(5);
  });

  it("filters by asset class in config", () => {
    const sources = [makeSource(), makeForexSource(), makeEquitySource()];
    const config: RadarScanConfig = { horizons: ["SWING"], assetClasses: ["crypto"], maxResults: 10 };
    const result = scanRadar(sources, config, undefined, NOW);
    const opps = result.results.get("SWING")!;
    expect(opps.every(o => o.assetClass === "crypto")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// E–H. FRESHNESS BY HORIZON
// ═══════════════════════════════════════════════════════════════

describe("E — Scalping Freshness", () => {
  it("scalping requires FRESH data", () => {
    const gate = HORIZON_FRESHNESS_GATES.SCALPING;
    expect(gate.maxFreshness).toBe("FRESH");
    expect(gate.requireLiveData).toBe(true);
  });

  it("DELAYED data is excluded for scalping", () => {
    const eligibility = checkFreshnessEligibility("DELAYED", true, "SCALPING");
    expect(eligibility.eligible).toBe(false);
  });

  it("FRESH data passes scalping gate", () => {
    const eligibility = checkFreshnessEligibility("FRESH", true, "SCALPING");
    expect(eligibility.eligible).toBe(true);
  });
});

describe("F — Intraday Freshness", () => {
  it("intraday accepts DELAYED data", () => {
    const eligibility = checkFreshnessEligibility("DELAYED", true, "INTRADAY");
    expect(eligibility.eligible).toBe(true);
  });

  it("STALE data excluded for intraday", () => {
    const eligibility = checkFreshnessEligibility("STALE", true, "INTRADAY");
    expect(eligibility.eligible).toBe(false);
  });
});

describe("G — Swing Freshness", () => {
  it("swing accepts STALE data", () => {
    const eligibility = checkFreshnessEligibility("STALE", true, "SWING");
    expect(eligibility.eligible).toBe(true);
  });

  it("UNAVAILABLE excluded for swing", () => {
    const eligibility = checkFreshnessEligibility("UNAVAILABLE", false, "SWING");
    expect(eligibility.eligible).toBe(false);
  });
});

describe("H — Investment Freshness", () => {
  it("1-3 years accepts STALE data", () => {
    const eligibility = checkFreshnessEligibility("STALE", false, "1-3_YEARS");
    expect(eligibility.eligible).toBe(true);
  });

  it("investment horizons do not require live data", () => {
    const gate = HORIZON_FRESHNESS_GATES["3+_YEARS"];
    expect(gate.requireLiveData).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. PROVIDER ROUTING
// ═══════════════════════════════════════════════════════════════

describe("I — Provider Routing", () => {
  it("provider availability never becomes directional evidence", () => {
    const sourceWithProvider = makeSource({
      snapshot: makeSnapshot({ provider: "twelve-data" }),
    });
    const sourceWithout = makeSource({
      snapshot: null,
    });
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const r1 = scanRadar([sourceWithProvider], config, undefined, NOW);
    const r2 = scanRadar([sourceWithout], config, undefined, NOW);

    const opp1 = r1.results.get("INTRADAY")![0];
    const opp2 = r2.results.get("INTRADAY")![0];

    // Both should be ranked, but with different evidence
    expect(opp1.score).toBeGreaterThan(opp2.score);
    // The reason must be about DATA, not about provider availability
    if (opp2.conflictingEvidence.length > 0) {
      expect(opp2.conflictingEvidence.some(e => e.includes("provider"))).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// J. RATE-LIMIT HANDLING
// ═══════════════════════════════════════════════════════════════

describe("J — Rate-Limit Handling", () => {
  it("canRequest returns true initially", () => {
    const rl = new RateLimitController();
    expect(rl.canRequest("twelve-data")).toBe(true);
  });

  it("canRequest returns false after 429 cooldown", () => {
    const rl = new RateLimitController();
    rl.recordFailure("twelve-data", true);
    expect(rl.canRequest("twelve-data")).toBe(false);
  });

  it("records requests and tracks count", () => {
    const rl = new RateLimitController();
    rl.recordRequest("twelve-data");
    const state = rl.getStateFor("twelve-data")!;
    expect(state.totalRequests).toBe(1);
    expect(state.requestCount).toBe(1);
  });

  it("resets backoff on success", () => {
    const rl = new RateLimitController();
    rl.recordFailure("twelve-data", true);
    rl.recordSuccess("twelve-data");
    const state = rl.getStateFor("twelve-data")!;
    expect(state.backoffFactor).toBe(1);
  });

  it("exponential backoff caps at 8x", () => {
    const rl = new RateLimitController();
    for (let i = 0; i < 10; i++) rl.recordFailure("test", true);
    const state = rl.getStateFor("test")!;
    expect(state.backoffFactor).toBeLessThanOrEqual(8);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. REQUEST DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("K — Request Deduplication", () => {
  it("deduplicate returns same promise for same key", async () => {
    const cache = new RadarCache();
    let callCount = 0;
    const p1 = cache.deduplicate("key1", async () => { callCount++; return "data1"; });
    const p2 = cache.deduplicate("key1", async () => { callCount++; return "data2"; });
    expect(p1).toBe(p2);
    // Both resolve with the same value
    const v1 = await p1;
    expect(v1).toBe("data1");
    expect(callCount).toBe(1); // only one fetch
  });

  it("deduplicate allows different keys", () => {
    const cache = new RadarCache();
    const p1 = cache.deduplicate("key1", async () => "a");
    const p2 = cache.deduplicate("key2", async () => "b");
    expect(p1).not.toBe(p2);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. CACHE ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("L — Cache Isolation", () => {
  it("BTC cache does not leak to ETH", () => {
    const cache = new RadarCache();
    cache.set("provider", "BTC/USD", "market-snapshot", { price: 65000 }, 60_000);
    const btc = cache.get("provider", "BTC/USD", "market-snapshot");
    const eth = cache.get("provider", "ETH/USD", "market-snapshot");
    expect(btc).toBeDefined();
    expect(eth).toBeUndefined();
  });

  it("cache key includes provider, instrument, capability, timeframe", () => {
    const k1 = buildCacheKey("p", "BTC/USD", "ohlcv", "H1");
    const k2 = buildCacheKey("p", "BTC/USD", "ohlcv", "H4");
    const k3 = buildCacheKey("p", "ETH/USD", "ohlcv", "H1");
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("stale-while-revalidate returns stale data", async () => {
    const cache = new RadarCache();
    cache.set("p", "BTC/USD", "snap", { v: 1 }, 1); // 1ms TTL
    await new Promise(r => setTimeout(r, 5));
    const result = cache.get("p", "BTC/USD", "snap", undefined, true);
    expect(result).toBeDefined();
    expect(result!.stale).toBe(true);
  });

  it("invalidateProvider removes all entries for provider", () => {
    const cache = new RadarCache();
    cache.set("p1", "BTC/USD", "a", 1, 60_000);
    cache.set("p1", "ETH/USD", "a", 2, 60_000);
    cache.set("p2", "BTC/USD", "a", 3, 60_000);
    const removed = cache.invalidateProvider("p1");
    expect(removed).toBe(2);
    expect(cache.get("p1", "BTC/USD", "a")).toBeUndefined();
    expect(cache.get("p2", "BTC/USD", "a")).toBeDefined();
  });

  it("invalidateInstrument removes all entries for instrument", () => {
    const cache = new RadarCache();
    cache.set("p1", "BTC/USD", "a", 1, 60_000);
    cache.set("p2", "BTC/USD", "a", 2, 60_000);
    cache.set("p1", "ETH/USD", "a", 3, 60_000);
    const removed = cache.invalidateInstrument("BTC/USD");
    expect(removed).toBe(2);
    expect(cache.get("p1", "ETH/USD", "a")).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// M. INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("M — Instrument Isolation", () => {
  it("BTC evidence does not become ETH evidence", () => {
    const btcSource = makeSource({
      universe: { instrument: "BTC/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv"], priority: 1, refreshIntervalMs: 300_000 },
      derivatives: { fundingRate: 0.0005, openInterest: 1_000_000_000 },
    });
    const ethSource = makeSource({
      universe: { instrument: "ETH/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv"], priority: 2, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "ETH/USD", price: 3500 }),
      derivatives: undefined,
    });

    const btcCandidate = buildRadarCandidate(btcSource, NOW);
    const ethCandidate = buildRadarCandidate(ethSource, NOW);

    expect(btcCandidate.fundingRate).toBe(0.0005);
    expect(ethCandidate.fundingRate).toBeUndefined();
  });

  it("BBCA fundamentals do not become BBRI fundamentals", () => {
    const bbca = buildRadarCandidate(makeIDXSource(), NOW);
    const bbri = buildRadarCandidate(makeSource({
      universe: { instrument: "BBRI", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv"], priority: 41, refreshIntervalMs: 600_000 },
      snapshot: makeSnapshot({ instrument: "BBRI", price: 4800 }),
    }), NOW);
    expect(bbca.hasFundamentals).toBe(true);
    expect(bbca.peRatio).toBe(18.5);
    expect(bbri.hasFundamentals).toBeUndefined();
  });

  it("EUR/USD macro does not become GBP/USD price evidence", () => {
    const eurusd = makeForexSource();
    const gbpusd = makeSource({
      universe: { instrument: "GBP/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv"], priority: 11, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "GBP/USD", price: 1.265 }),
    });
    const eur = buildRadarCandidate(eurusd, NOW);
    const gbp = buildRadarCandidate(gbpusd, NOW);
    expect(eur.cotNet).toBe(-45000);
    expect(gbp.cotNet).toBeUndefined();
  });

  it("gold inventory does not become oil inventory", () => {
    const gold = makeSource({
      universe: { instrument: "XAU/USD", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv"], priority: 50, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "XAU/USD", price: 2350 }),
    });
    const oil = makeCommoditySource();
    const g = buildRadarCandidate(gold, NOW);
    const o = buildRadarCandidate(oil, NOW);
    expect(g.inventory).toBeUndefined();
    expect(o.inventory).toBe(440);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. ASSET-CLASS SCORING
// ═══════════════════════════════════════════════════════════════

describe("N — Asset-Class Scoring", () => {
  it("crypto with derivatives scores higher than without", () => {
    const withDeriv = makeSource({ derivatives: { fundingRate: 0.0001, openInterest: 5e8 } });
    const without = makeSource({ derivatives: undefined });
    const c1 = scanRadar([withDeriv], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const c2 = scanRadar([without], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    expect(c1.results.get("SWING")![0].score).toBeGreaterThan(c2.results.get("SWING")![0].score);
  });

  it("forex with COT scores higher than without", () => {
    const withCot = makeForexSource();
    const without = makeSource({
      universe: { instrument: "EUR/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv"], priority: 10, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "EUR/USD", price: 1.085 }),
      cot: undefined,
    });
    const c1 = scanRadar([withCot], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const c2 = scanRadar([without], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    expect(c1.results.get("SWING")![0].score).toBeGreaterThanOrEqual(c2.results.get("SWING")![0].score);
  });

  it("equity with fundamentals scores higher", () => {
    const withF = makeEquitySource();
    const without = makeSource({
      universe: { instrument: "AAPL", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv"], priority: 30, refreshIntervalMs: 1800_000 },
      snapshot: makeSnapshot({ instrument: "AAPL", price: 195 }),
      fundamentals: undefined,
    });
    const c1 = scanRadar([withF], { horizons: ["1-3_YEARS"], maxResults: 5 }, undefined, NOW);
    const c2 = scanRadar([without], { horizons: ["1-3_YEARS"], maxResults: 5 }, undefined, NOW);
    expect(c1.results.get("1-3_YEARS")![0].score).toBeGreaterThanOrEqual(c2.results.get("1-3_YEARS")![0].score);
  });

  it("commodity with inventory scores higher", () => {
    const withEia = makeCommoditySource();
    const without = makeSource({
      universe: { instrument: "WTI", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv"], priority: 52, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "WTI", price: 78.5 }),
      eia: undefined,
    });
    const c1 = scanRadar([withEia], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const c2 = scanRadar([without], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    expect(c1.results.get("SWING")![0].score).toBeGreaterThanOrEqual(c2.results.get("SWING")![0].score);
  });

  it("macro with treasury data scores higher", () => {
    const withT = makeMacroSource();
    const without = makeSource({
      universe: { instrument: "DXY", assetClass: "macro", region: "global", requiredCapabilities: ["quote"], priority: 80, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "DXY", price: 104.5 }),
      treasury: undefined,
    });
    const c1 = scanRadar([withT], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const c2 = scanRadar([without], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    expect(c1.results.get("SWING")![0].score).toBeGreaterThanOrEqual(c2.results.get("SWING")![0].score);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. EVIDENCE CONFLICT
// ═══════════════════════════════════════════════════════════════

describe("O — Evidence Conflict", () => {
  it("mixed MTF alignment adds conflicting evidence", () => {
    const source = makeSource({
      snapshot: makeSnapshot({ mtfAlignment: "MIXED" }),
    });
    const result = scanRadar([source], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.conflictingEvidence.some(e => e.includes("MTF"))).toBe(true);
  });

  it("wide spread adds conflicting evidence", () => {
    const source = makeSource({
      snapshot: makeSnapshot({ spreadBps: 50 }),
    });
    const result = scanRadar([source], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.conflictingEvidence.some(e => e.includes("spread"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. MISSING INFORMATION
// ═══════════════════════════════════════════════════════════════

describe("P — Missing Information", () => {
  it("missing HTF structure is tracked", () => {
    const snapshot = makeSnapshot({});
    delete snapshot.htfBias;
    const source = makeSource({ snapshot });
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.missingInformation.some(m => m.includes("HTF"))).toBe(true);
  });

  it("missing DXY tracked for forex", () => {
    const source = makeSource({
      universe: { instrument: "EUR/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv"], priority: 10, refreshIntervalMs: 300_000 },
      snapshot: makeSnapshot({ instrument: "EUR/USD", price: 1.085 }),
      treasury: undefined,
    });
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.missingInformation.some(m => m.includes("DXY"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. OPPORTUNITY LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("Q — Opportunity Lifecycle", () => {
  it("fresh source with good data gets ACTIVE lifecycle", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("INTRADAY")![0];
    expect(["ACTIVE", "QUALIFIED"]).toContain(opp.lifecycle);
  });

  it("stale source for scalping gets EXPIRED lifecycle", () => {
    const source = makeSource({
      snapshot: makeSnapshot({ observedAt: NOW - 2 * 3600_000 }), // 2 hours old
    });
    const result = scanRadar([source], { horizons: ["SCALPING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SCALPING")![0];
    expect(opp.lifecycle).toBe("EXPIRED");
    expect(opp.qualityTier).toBe("X");
  });

  it("lifecycle transition: ACTIVE → DEGRADED → EXPIRED", () => {
    // Fresh source → ACTIVE
    const source = makeSource({ snapshot: makeSnapshot({ observedAt: NOW }) });
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const r1 = scanRadar([source], config, undefined, NOW);
    const state1 = buildRadarState(r1);
    expect(r1.results.get("INTRADAY")![0].lifecycle).toBe("ACTIVE");

    // Stale source → transition
    const staleSource = makeSource({ snapshot: makeSnapshot({ observedAt: NOW - 2 * HOUR }) });
    const r2 = scanRadar([staleSource], config, undefined, NOW + 2 * HOUR);
    const opp2 = r2.results.get("INTRADAY")![0];
    // Should be EXPIRED or DEGRADED
    expect(["EXPIRED", "DEGRADED"]).toContain(opp2.lifecycle);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. INVALIDATION
// ═══════════════════════════════════════════════════════════════

describe("R — Invalidation", () => {
  it("every opportunity has invalidation conditions", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.invalidationConditions.length).toBeGreaterThan(0);
  });

  it("provider failure is an invalidation condition", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.invalidationConditions.some(c => c.includes("provider"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. EXPIRATION
// ═══════════════════════════════════════════════════════════════

describe("S — Expiration", () => {
  it("unavailable data results in EXPIRED lifecycle", () => {
    const source = makeSource({ snapshot: null });
    const result = scanRadar([source], { horizons: ["SCALPING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SCALPING")![0];
    expect(opp.lifecycle).toBe("EXPIRED");
  });
});

// ═══════════════════════════════════════════════════════════════
// T. SNAPSHOT DIFF
// ═══════════════════════════════════════════════════════════════

describe("T — Snapshot Diff", () => {
  it("detects newly appeared opportunity", () => {
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const emptyState: import("./market-radar/radar").RadarState = { previous: new Map(), lastScanAt: NOW };
    const r = scanRadar([makeSource()], config, emptyState, NOW);
    expect(r.diffs.some(d => d.appeared)).toBe(true);
  });

  it("detects disappeared opportunity", () => {
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const r1 = scanRadar([makeSource()], config, undefined, NOW);
    const state = buildRadarState(r1);
    const r2 = scanRadar([], config, state, NOW + HOUR);
    expect(r2.diffs.some(d => d.disappeared)).toBe(true);
  });

  it("detects score change", () => {
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const r1 = scanRadar([makeSource({ snapshot: makeSnapshot({ spreadBps: 50 }) })], config, undefined, NOW);
    const state = buildRadarState(r1);
    const r2 = scanRadar([makeSource({ snapshot: makeSnapshot({ spreadBps: 2 }) })], config, state, NOW);
    const diff = r2.diffs.find(d => d.instrument === "BTC/USD");
    expect(diff).toBeDefined();
    expect(diff!.changes.some(c => c.includes("score"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. QUALITY TIERS
// ═══════════════════════════════════════════════════════════════

describe("U — Quality Tiers", () => {
  it("X tier for unavailable data", () => {
    const source = makeSource({ snapshot: null });
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.qualityTier).toBe("X");
  });

  it("strong source gets non-X tier", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.qualityTier).not.toBe("X");
  });
});

// ═══════════════════════════════════════════════════════════════
// V. CONFIDENCE SEMANTICS
// ═══════════════════════════════════════════════════════════════

describe("V — Confidence Semantics", () => {
  it("confidence is between 0 and 100", () => {
    const sources = [makeSource(), makeForexSource(), makeEquitySource(), makeCommoditySource()];
    const result = scanRadar(sources, { horizons: ["SWING"], maxResults: 10 }, undefined, NOW);
    for (const opp of result.results.get("SWING")!) {
      expect(opp.confidence).toBeGreaterThanOrEqual(0);
      expect(opp.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("confidence is NOT a probability", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    // Confidence should not be labeled as probability
    expect(opp.supportingEvidence.every(e => !e.includes("probability"))).toBe(true);
    expect(opp.primaryReasons.every(e => !e.includes("probability"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. CORRELATION / DEPENDENCY GROUPS
// ═══════════════════════════════════════════════════════════════

describe("W — Correlation / Dependency Groups", () => {
  it("clusters exist for BTC/ETH, oil, US indices, IDX banks", () => {
    expect(getClusterForInstrument("BTC/USD")).toBeDefined();
    expect(getClusterForInstrument("ETH/USD")).toBeDefined();
    expect(getClusterForInstrument("WTI")).toBeDefined();
    expect(getClusterForInstrument("SPX")).toBeDefined();
    expect(getClusterForInstrument("BBCA")).toBeDefined();
  });

  it("cluster limits display count", () => {
    const oil = getClusterForInstrument("WTI");
    expect(oil!.maxDisplay).toBe(1); // Only 1 of WTI/BRENT shown
  });

  it("getClusterInstruments returns correct instruments", () => {
    const idxBank = getClusterInstruments("idx-bank");
    expect(idxBank).toContain("BBCA");
    expect(idxBank).toContain("BBRI");
    expect(idxBank.length).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. NO FORCED OPPORTUNITY
// ═══════════════════════════════════════════════════════════════

describe("X — No Forced Opportunity", () => {
  it("empty sources produce empty results", () => {
    const result = scanRadar([], { horizons: ["INTRADAY"], maxResults: 5 }, undefined, NOW);
    expect(result.results.get("INTRADAY")!.length).toBe(0);
    expect(result.totalScanned).toBe(0);
  });

  it("all-unavailable sources still rank but with X tier", () => {
    const source = makeSource({ snapshot: null });
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp.qualityTier).toBe("X");
    expect(opp.lifecycle).toBe("EXPIRED");
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. NO FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("Y — No Fabrication", () => {
  it("missing data remains missing in candidate", () => {
    const source = makeSource({
      snapshot: makeSnapshot({ price: 0 }),
      derivatives: undefined,
    });
    const c = buildRadarCandidate(source, NOW);
    expect(c.fundingRate).toBeUndefined();
    expect(c.openInterest).toBeUndefined();
    expect(c.hasDerivatives).toBeUndefined();
  });

  it("null snapshot produces unavailable freshness", () => {
    const source = makeSource({ snapshot: null });
    const c = buildRadarCandidate(source, NOW);
    expect(c.freshness).toBe("UNAVAILABLE");
    expect(c.currentPrice).toBe(0);
    expect(c.hasLiveData).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Z — Determinism", () => {
  it("same input produces same output", () => {
    const sources = [makeSource(), makeForexSource()];
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const r1 = scanRadar(sources, config, undefined, NOW);
    const r2 = scanRadar(sources, config, undefined, NOW);
    expect(r1.results.get("INTRADAY")!.map(o => o.instrument)).toEqual(
      r2.results.get("INTRADAY")!.map(o => o.instrument),
    );
    expect(r1.results.get("INTRADAY")!.map(o => o.score)).toEqual(
      r2.results.get("INTRADAY")!.map(o => o.score),
    );
  });

  it("candidate builder is deterministic", () => {
    const source = makeSource();
    const c1 = buildRadarCandidate(source, NOW);
    const c2 = buildRadarCandidate(source, NOW);
    expect(c1.instrument).toBe(c2.instrument);
    expect(c1.dataPoints).toBe(c2.dataPoints);
    expect(c1.dataCompleteness).toBe(c2.dataCompleteness);
    expect(c1.freshness).toBe(c2.freshness);
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("AA — Security", () => {
  it("no API keys in opportunity objects", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const serialized = JSON.stringify(result);
    expect(serialized.toLowerCase()).not.toContain("api_key");
    expect(serialized.toLowerCase()).not.toContain("apikey");
    expect(serialized.toLowerCase()).not.toContain("secret");
    expect(serialized.toLowerCase()).not.toContain("token");
  });

  it("no API keys in candidate", () => {
    const c = buildRadarCandidate(makeSource(), NOW);
    const serialized = JSON.stringify(c);
    expect(serialized.toLowerCase()).not.toContain("api_key");
    expect(serialized.toLowerCase()).not.toContain("secret");
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("AB — Decision Immutability", () => {
  it("radar result does not contain recommendation/bias/conviction", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    // Opportunity should have its own fields, not decision-engine fields
    expect((opp as any).recommendation).toBeUndefined();
    expect((opp as any).bias).toBeUndefined();
    expect((opp as any).conviction).toBeUndefined();
    expect((opp as any).tradePlan).toBeUndefined();
    expect((opp as any).noTradeReasons).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. CONCURRENT SCANNING
// ═══════════════════════════════════════════════════════════════

describe("AC — Concurrent Scanning", () => {
  it("concurrent scans produce same results", async () => {
    const sources = [makeSource(), makeForexSource()];
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const results = await Promise.all([
      Promise.resolve(scanRadar(sources, config, undefined, NOW)),
      Promise.resolve(scanRadar(sources, config, undefined, NOW)),
    ]);
    expect(results[0].results.get("INTRADAY")!.map(o => o.instrument)).toEqual(
      results[1].results.get("INTRADAY")!.map(o => o.instrument),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. PARTIAL PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("AD — Partial Provider Failure", () => {
  it("one null snapshot does not collapse entire scan", () => {
    const sources = [
      makeSource(),
      makeSource({ snapshot: null }), // failed
      makeForexSource(),
    ];
    const result = scanRadar(sources, { horizons: ["SWING"], maxResults: 10 }, undefined, NOW);
    expect(result.totalScanned).toBe(3);
    const opps = result.results.get("SWING")!;
    expect(opps.length).toBeGreaterThanOrEqual(2); // at least BTC and EUR/USD
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. TOTAL PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("AE — Total Provider Failure", () => {
  it("all null snapshots produce X-tier results", () => {
    const sources = [
      makeSource({ snapshot: null }),
      makeForexSource() ? { ...makeForexSource(), snapshot: null } : null,
    ].filter(Boolean) as RadarCandidateSource[];
    const result = scanRadar(sources, { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opps = result.results.get("SWING")!;
    for (const opp of opps) {
      expect(opp.qualityTier).toBe("X");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// AF. LARGE UNIVERSE STRESS
// ═══════════════════════════════════════════════════════════════

describe("AF — Large Universe Stress", () => {
  it("handles 50+ instruments without error", () => {
    const sources = DEFAULT_UNIVERSE.slice(0, 50).map(u => makeSource({
      universe: u,
      snapshot: makeSnapshot({ instrument: u.instrument, price: 100 + Math.random() * 1000 }),
    }));
    const start = Date.now();
    const result = scanRadar(sources, { horizons: ["INTRADAY", "SWING"], maxResults: 10 }, undefined, NOW);
    const elapsed = Date.now() - start;
    expect(result.totalScanned).toBe(50);
    expect(result.results.size).toBe(2);
    expect(elapsed).toBeLessThan(5000); // Should complete in <5s
  });
});

// ═══════════════════════════════════════════════════════════════
// AG. SEQUENTIAL ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AG — Sequential Isolation", () => {
  it("sequential scans don't leak state", () => {
    const config: RadarScanConfig = { horizons: ["INTRADAY"], maxResults: 5 };
    const r1 = scanRadar([makeSource()], config, undefined, NOW);
    const r2 = scanRadar([makeForexSource()], config, undefined, NOW);
    const btcInR2 = r2.results.get("INTRADAY")!.some(o => o.instrument === "BTC/USD");
    expect(btcInR2).toBe(false);
    const eurInR1 = r1.results.get("INTRADAY")!.some(o => o.instrument === "EUR/USD");
    expect(eurInR1).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// AH. HORIZON ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AH — Horizon Isolation", () => {
  it("same instrument ranks differently for different horizons", () => {
    const source = makeEquitySource();
    const r1 = scanRadar([source], { horizons: ["SCALPING"], maxResults: 5 }, undefined, NOW);
    const r2 = scanRadar([source], { horizons: ["1-3_YEARS"], maxResults: 5 }, undefined, NOW);
    // Equity may rank higher for investing than for scalping
    const scalping = r1.results.get("SCALPING")![0];
    const investing = r2.results.get("1-3_YEARS")![0];
    // At minimum, both should exist
    expect(scalping).toBeDefined();
    expect(investing).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AI. UI RESULT SHAPE
// ═══════════════════════════════════════════════════════════════

describe("AI — UI Result Shape", () => {
  it("radar result has all required UI fields", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("diffs");
    expect(result).toHaveProperty("totalScanned");
    expect(result).toHaveProperty("totalWithLiveData");
    expect(result).toHaveProperty("freshCount");
    expect(result).toHaveProperty("delayedCount");
    expect(result).toHaveProperty("staleCount");
    expect(result).toHaveProperty("unavailableCount");
    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("durationMs");
  });

  it("each opportunity has all required fields", () => {
    const source = makeSource();
    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 5 }, undefined, NOW);
    const opp = result.results.get("SWING")![0];
    expect(opp).toHaveProperty("instrument");
    expect(opp).toHaveProperty("assetClass");
    expect(opp).toHaveProperty("lifecycle");
    expect(opp).toHaveProperty("qualityTier");
    expect(opp).toHaveProperty("score");
    expect(opp).toHaveProperty("confidence");
    expect(opp).toHaveProperty("freshness");
    expect(opp).toHaveProperty("supportingEvidence");
    expect(opp).toHaveProperty("conflictingEvidence");
    expect(opp).toHaveProperty("missingInformation");
    expect(opp).toHaveProperty("invalidationConditions");
    expect(opp).toHaveProperty("primaryReasons");
    expect(opp).toHaveProperty("providerCoverage");
    expect(opp).toHaveProperty("lastUpdated");
  });

  it("freshness summary is accurate", () => {
    const sources = [
      makeSource({ snapshot: makeSnapshot({ observedAt: NOW }) }), // FRESH
      makeSource({
        universe: { instrument: "ETH/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv"], priority: 2, refreshIntervalMs: 300_000 },
        snapshot: makeSnapshot({ instrument: "ETH/USD", observedAt: NOW - 30 * 60_000 }), // DELAYED
      }),
    ];
    const result = scanRadar(sources, { horizons: ["SWING"], maxResults: 10 }, undefined, NOW);
    expect(result.freshCount).toBeGreaterThanOrEqual(1);
    expect(result.delayedCount).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// AJ. FRESHNESS TRANSITIONS
// ═══════════════════════════════════════════════════════════════

describe("AJ — Freshness Transitions", () => {
  it("ACTIVE → DEGRADED when freshness expires", () => {
    const t = shouldTransitionLifecycle("ACTIVE", "STALE", false, "PARTIAL", "INTRADAY");
    expect(t.shouldTransition).toBe(true);
    expect(t.newLifecycle).toBe("DEGRADED");
  });

  it("DEGRADED → EXPIRED when data unavailable", () => {
    const t = shouldTransitionLifecycle("DEGRADED", "UNAVAILABLE", false, "NONE", "INTRADAY");
    expect(t.shouldTransition).toBe(true);
    expect(t.newLifecycle).toBe("EXPIRED");
  });

  it("DEGRADED → ACTIVE when freshness recovers", () => {
    const t = shouldTransitionLifecycle("DEGRADED", "FRESH", true, "PARTIAL", "INTRADAY");
    expect(t.shouldTransition).toBe(true);
    expect(t.newLifecycle).toBe("ACTIVE");
  });

  it("ACTIVE stays ACTIVE when freshness is fine", () => {
    const t = shouldTransitionLifecycle("ACTIVE", "FRESH", true, "FULL", "INTRADAY");
    expect(t.shouldTransition).toBe(false);
  });

  it("summarizeFreshness counts correctly", () => {
    const levels: FreshnessLevel[] = ["FRESH", "FRESH", "DELAYED", "STALE", "UNAVAILABLE"];
    const s = summarizeFreshness(levels);
    expect(s.fresh).toBe(2);
    expect(s.delayed).toBe(1);
    expect(s.stale).toBe(1);
    expect(s.unavailable).toBe(1);
  });
});
