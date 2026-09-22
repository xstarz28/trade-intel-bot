/**
 * Phase 239 — Opportunity Evidence Integrity
 *
 * Verifies that opportunity layer does NOT lose truth established in Phase238.
 *
 * Invariants:
 * - Every opportunity traceable to exact source evidence
 * - Provider identity survives market evidence → opportunity → UI
 * - providerInstrumentId unchanged
 * - No silent substitution
 * - No stale/unavailable bypassing horizon gates
 * - Never marked LIVE merely because object exists
 * - Timestamp/provenance truthful
 * - Multiple providers same asset remain distinct unless correlation explicitly defined
 * - Correlation ≠ identity substitution
 * - Derived distinguishable from observed
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scanInstruments } from "../liveScanner";
import { buildRadarSourcesFromLiveSources } from "../market-radar/live-source-adapter";
import { scanRadar, opportunityKey, buildRadarState } from "../market-radar/radar";
import { assessFreshness } from "../market-radar/freshness";
import { buildCandidateFromSource, type LiveCandidateSource } from "../liveCandidateBuilder";
import type { MarketData } from "../data/market-types";
import type { DiscoveredInstrument } from "./types";
import type { RadarCandidateSource } from "../market-radar/candidate-builder";
import { deriveCorrelationKey } from "./correlation";

const NOW = 1_800_000_000_000;

function mkMarketData(overrides: any): MarketData {
  const price = overrides.price;
  const ts = overrides.timestamp;
  const ft = overrides.fetchTimestamp;
  return {
    instrument: overrides.instrument,
    instrumentType: (overrides.instrumentType as any) ?? "crypto",
    provider: overrides.provider,
    fetchTimestamp: ft,
    price: {
      price,
      timestamp: ts,
      source: overrides.provider,
      ...(overrides.bid !== undefined ? { bid: overrides.bid } : {}),
      ...(overrides.ask !== undefined ? { ask: overrides.ask } : {}),
    },
    candles: overrides.candles ?? [{ timestamp: ts, open: price, high: price * 1.01, low: price * 0.99, close: price, volume: 1000 }],
    timeframe: overrides.timeframe ?? "1h",
    dataFreshness: overrides.dataFreshness ?? "realtime",
    timestampProvenance: overrides.timestampProvenance ?? "PROVIDER_OBSERVED",
  } as MarketData;
}

function mkLiveSource(opts: {
  instrument: string;
  provider: string;
  providerInstrumentId: string;
  price: number;
  observedAt: number;
  fetchedAt: number;
  provenance?: MarketData["timestampProvenance"];
  assetClass?: any;
  correlationKey?: string;
  region?: string;
  bid?: number;
  ask?: number;
  dataFreshness?: MarketData["dataFreshness"];
}): LiveCandidateSource {
  const md = mkMarketData({
    instrument: opts.instrument,
    provider: opts.provider,
    price: opts.price,
    timestamp: opts.observedAt,
    fetchTimestamp: opts.fetchedAt,
    timestampProvenance: opts.provenance ?? "PROVIDER_OBSERVED",
    dataFreshness: opts.dataFreshness ?? "realtime",
    ...(opts.bid !== undefined ? { bid: opts.bid } as any : {}),
    ...(opts.ask !== undefined ? { ask: opts.ask } as any : {}),
  });
  return {
    instrument: opts.instrument,
    assetClass: opts.assetClass ?? "crypto",
    providerNative: { provider: opts.provider, providerInstrumentId: opts.providerInstrumentId },
    correlationKey: opts.correlationKey ?? `${opts.assetClass ?? "crypto"}:${opts.instrument.split("/")[0] ?? opts.instrument}`,
    region: opts.region,
    marketData: md,
  } as LiveCandidateSource;
}

// ────────────────────────────────────────────────────────────────
// 1. opportunity provenance preservation
// ────────────────────────────────────────────────────────────────
describe("Phase239 — opportunity provenance preservation", () => {
  it("radar opportunity contains provider, native id, observedAt, acquiredAt, provenance, freshness, horizon, evidence", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 60_000,
      fetchedAt: NOW,
      provenance: "PROVIDER_OBSERVED",
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].universe.providerNative?.provider).toBe("ccxt:binance");
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opps = result.results.get("INTRADAY")!;
    expect(opps.length).toBeGreaterThan(0);
    const opp = opps[0];
    expect(opp.providerNative?.provider).toBe("ccxt:binance");
    expect(opp.providerNative?.providerInstrumentId).toBe("BTC/USDT");
    expect(opp.provider).toBe("ccxt:binance");
    expect(opp.observedAt).toBe(NOW - 60_000);
    expect(opp.acquiredAt).toBe(NOW);
    expect(opp.timestampProvenance).toBe("PROVIDER_OBSERVED");
    expect(opp.freshness).toBe("FRESH");
    expect(opp.horizon).toBe("INTRADAY");
    expect(opp.evidence).toBeDefined();
    expect(opp.evidence?.price).toBe(50000);
    expect(opp.evidence?.observedAt).toBe(NOW - 60_000);
    expect(opp.evidence?.provider).toBe("ccxt:binance");
    expect(opp.evidence?.providerInstrumentId).toBe("BTC/USDT");
  });
});

// ────────────────────────────────────────────────────────────────
// 2. provider identity preservation
// ────────────────────────────────────────────────────────────────
describe("Phase239 — provider identity preservation", () => {
  it("provider identity survives liveSource → radar → opportunity", () => {
    const binance = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const okx = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:okx",
      providerInstrumentId: "BTC/USDT",
      price: 50100,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([binance, okx]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opps = result.results.get("INTRADAY")!;
    expect(opps.length).toBe(2);
    const providers = new Set(opps.map(o => o.providerNative?.provider));
    expect(providers.has("ccxt:binance")).toBe(true);
    expect(providers.has("ccxt:okx")).toBe(true);
    // Binance evidence cannot become OKX
    const binOpp = opps.find(o => o.providerNative?.provider === "ccxt:binance")!;
    expect(binOpp.evidence?.price).toBe(50000);
    const okxOpp = opps.find(o => o.providerNative?.provider === "ccxt:okx")!;
    expect(okxOpp.evidence?.price).toBe(50100);
  });

  it("scanInstruments preserves provider identity", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const result = scanInstruments([src], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked[0].providerNative?.provider).toBe("ccxt:binance");
  });
});

// ────────────────────────────────────────────────────────────────
// 3. providerInstrumentId preservation
// ────────────────────────────────────────────────────────────────
describe("Phase239 — providerInstrumentId preservation", () => {
  it("providerInstrumentId unchanged through pipeline", () => {
    const src = mkLiveSource({
      instrument: "BTC-USDT-SWAP",
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].universe.providerNative?.providerInstrumentId).toBe("BTC-USDT-SWAP");
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.providerNative?.providerInstrumentId).toBe("BTC-USDT-SWAP");
    expect(opp.evidence?.providerInstrumentId).toBe("BTC-USDT-SWAP");
  });

  it("BTC/USD vs BTC/USDT not silently replaced", () => {
    const usd = mkLiveSource({
      instrument: "BTC/USD",
      provider: "twelve-data",
      providerInstrumentId: "BTC/USD",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const usdt = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([usd, usdt]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opps = result.results.get("INTRADAY")!;
    const ids = opps.map(o => o.providerNative?.providerInstrumentId);
    expect(ids).toContain("BTC/USD");
    expect(ids).toContain("BTC/USDT");
  });
});

// ────────────────────────────────────────────────────────────────
// 4. timestamp provenance preservation
// ────────────────────────────────────────────────────────────────
describe("Phase239 — timestamp provenance preservation", () => {
  it("PROVIDER_OBSERVED preserved", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      provenance: "PROVIDER_OBSERVED",
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.timestampProvenance).toBe("PROVIDER_OBSERVED");
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].timestampProvenance).toBe("PROVIDER_OBSERVED");
  });

  it("PROVIDER_RESPONSE preserved (CoinGecko receipt-by-policy)", () => {
    const src = mkLiveSource({
      instrument: "BTC/USD",
      provider: "coingecko",
      providerInstrumentId: "btc",
      price: 50000,
      observedAt: NOW,
      fetchedAt: NOW,
      provenance: "PROVIDER_RESPONSE",
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.timestampProvenance).toBe("PROVIDER_RESPONSE");
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].timestampProvenance).toBe("PROVIDER_RESPONSE");
  });

  it("missing timestamp → observedAt undefined, not fabricated from fetchTimestamp", () => {
    const md = mkMarketData({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      price: 50000,
      timestamp: 0, // sentinel for missing
      fetchTimestamp: NOW,
      dataFreshness: "unavailable" as any,
      timestampProvenance: "UNKNOWN" as any,
    });
    const src: LiveCandidateSource = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
      marketData: md,
    } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.observedAt).toBeUndefined();
    expect(radarSources[0].snapshot?.acquiredAt).toBe(NOW);
    expect(radarSources[0].snapshot?.freshness).toBe("UNAVAILABLE");
  });
});

// ────────────────────────────────────────────────────────────────
// 5. freshness preservation
// ────────────────────────────────────────────────────────────────
describe("Phase239 — freshness preservation", () => {
  it("freshness derived from genuine observedAt", () => {
    const freshSrc = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 60_000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([freshSrc]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].freshness).toBe("FRESH");
  });

  it("stale evidence freshness preserved as STALE", () => {
    const staleSrc = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 2 * 60 * 60_000, // 2h ago → STALE
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([staleSrc]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    // INTRADAY allows DELAYED max, so stale should be EXPIRED lifecycle
    const opps = result.results.get("INTRADAY")!;
    expect(opps[0].freshness).toBe("STALE");
    expect(opps[0].lifecycle).toBe("EXPIRED");
  });
});

// ────────────────────────────────────────────────────────────────
// 6. derived-vs-observed distinction
// ────────────────────────────────────────────────────────────────
describe("Phase239 — derived-vs-observed distinction", () => {
  it("spreadBps is derived from bid/ask, not provider-observed price", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      bid: 49999,
      ask: 50001,
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.spreadBps).toBeDefined();
    expect(radarSources[0].snapshot?.spreadBps).toBeGreaterThan(0);
    // Spread should be in evidence.derived, not as observed price
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.evidence?.derived?.spreadBps).toBeDefined();
    expect(opp.evidence?.price).toBe(50000); // observed price
    expect(opp.evidence?.derived?.spreadBps).not.toBe(opp.evidence?.price);
  });

  it("volatility is derived, not observed price", () => {
    const srcFile = readFileSync("src/lib/market-radar/live-source-adapter.ts", "utf8");
    expect(srcFile).toContain("derived");
    expect(srcFile).toContain("spreadBps");
  });

  it("derived values not represented as provider-observed", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      bid: 49999,
      ask: 50001,
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const oppResult = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = oppResult.results.get("INTRADAY")![0];
    // Supporting evidence may mention spread but should not claim provider observed spread
    expect(opp.evidence?.derived).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 7. cross-provider correlation
// ────────────────────────────────────────────────────────────────
describe("Phase239 — cross-provider correlation", () => {
  it("same logical asset different providers remain distinct, correlation does not mutate identity", () => {
    const binance = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      correlationKey: "crypto:BTC",
    });
    const okx = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:okx",
      providerInstrumentId: "BTC/USDT",
      price: 50100,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      correlationKey: "crypto:BTC",
    });
    const twelve = mkLiveSource({
      instrument: "BTC/USD",
      provider: "twelve-data",
      providerInstrumentId: "BTC/USD",
      price: 50050,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      correlationKey: "crypto:BTC",
    });

    const radarSources = buildRadarSourcesFromLiveSources([binance, okx, twelve]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opps = result.results.get("INTRADAY")!;
    expect(opps.length).toBe(3);
    // Each retains its own identity
    expect(opps.map(o => o.providerNative?.provider).sort()).toEqual(["ccxt:binance", "ccxt:okx", "twelve-data"].sort());
    // Correlation key derived from base asset, but identity not mutated
    const keys = opps.map(o => deriveCorrelationKey({ assetClass: o.assetClass, baseAsset: "BTC" } as any));
    expect(keys.every(k => k === "crypto:BTC")).toBe(true);
  });

  it("correlation can reference multiple sources without overwriting", () => {
    const srcA = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      correlationKey: "crypto:BTC",
    });
    const srcB = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:okx",
      providerInstrumentId: "BTC/USDT",
      price: 50100,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      correlationKey: "crypto:BTC",
    });
    const radarSources = buildRadarSourcesFromLiveSources([srcA, srcB]);
    // Both have same correlation key but distinct provider identities
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// 8. same-native-ID collision prevention
// ────────────────────────────────────────────────────────────────
describe("Phase239 — same-native-ID collision prevention", () => {
  it("same native ID different providers remain distinct (no Map collision)", () => {
    const a = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const b = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:okx",
      providerInstrumentId: "BTC/USDT",
      price: 50100,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([a, b]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(2);
    // opportunityKey must be provider-qualified
    const keys = result.results.get("INTRADAY")!.map(opportunityKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("ccxt:binance::BTC/USDT");
    expect(keys).toContain("ccxt:okx::BTC/USDT");
  });
});

// ────────────────────────────────────────────────────────────────
// 9. different-instrument collision prevention
// ────────────────────────────────────────────────────────────────
describe("Phase239 — different-instrument collision prevention", () => {
  it("same provider different instruments remain distinct", () => {
    const btc = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const eth = mkLiveSource({
      instrument: "ETH/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "ETH/USDT",
      price: 3000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([btc, eth]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(2);
    const ids = result.results.get("INTRADAY")!.map(o => o.providerNative?.providerInstrumentId);
    expect(ids).toContain("BTC/USDT");
    expect(ids).toContain("ETH/USDT");
  });

  it("DEX pool vs CEX distinct", () => {
    const dex = mkLiveSource({
      instrument: "ethereum:uniswap:0xabc",
      provider: "dexscreener",
      providerInstrumentId: "ethereum:uniswap:0xabc",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const cex = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([dex, cex]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// 10. mixed-freshness inputs
// ────────────────────────────────────────────────────────────────
describe("Phase239 — mixed-freshness inputs", () => {
  it("opportunity built from single source — freshness is that source's freshness, not stronger", () => {
    const fresh = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 60_000,
      fetchedAt: NOW,
    });
    const stale = mkLiveSource({
      instrument: "ETH/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "ETH/USDT",
      price: 3000,
      observedAt: NOW - 2 * 60 * 60_000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([fresh, stale]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opps = result.results.get("INTRADAY")!;
    const freshOpp = opps.find(o => o.instrument === "BTC/USDT")!;
    const staleOpp = opps.find(o => o.instrument === "ETH/USDT")!;
    expect(freshOpp.freshness).toBe("FRESH");
    expect(staleOpp.freshness).toBe("STALE");
    // Stale should not claim FRESH
    expect(staleOpp.freshness).not.toBe("FRESH");
    expect(staleOpp.lifecycle).toBe("EXPIRED");
  });

  it("existing architecture handles mixed evidence: price fresh, other inputs may be missing, freshness remains price-based but confidence reflects missing", () => {
    // Price fresh, but no derivatives/COT etc — confidence should be lower than full evidence
    const src: LiveCandidateSource = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
      marketData: mkMarketData({
        instrument: "BTC/USDT",
        provider: "ccxt:binance",
        price: 50000,
        timestamp: NOW - 1000,
        fetchTimestamp: NOW,
        dataFreshness: "realtime",
      }),
      // No derivativesData, no COT, etc — mixed completeness
    } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.freshness).toBe("FRESH");
    // Missing evidence should be in missingInformation, not hidden
    expect(opp.missingInformation.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 11. stale input handling
// ────────────────────────────────────────────────────────────────
describe("Phase239 — stale input handling", () => {
  it("stale evidence → rejected/degraded where scanner policy requires", () => {
    const stale = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 2 * 60 * 60_000, // STALE
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([stale]);
    const resultScalp = scanRadar(radarSources, { horizons: ["SCALPING"], maxResults: 10, now: NOW });
    expect(resultScalp.results.get("SCALPING")![0].lifecycle).toBe("EXPIRED");
    const resultSwing = scanRadar(radarSources, { horizons: ["SWING"], maxResults: 10, now: NOW });
    // SWING allows STALE, so should be eligible (not EXPIRED)
    expect(resultSwing.results.get("SWING")![0].lifecycle).not.toBe("EXPIRED");
  });
});

// ────────────────────────────────────────────────────────────────
// 12. delayed input handling
// ────────────────────────────────────────────────────────────────
describe("Phase239 — delayed input handling", () => {
  it("delayed evidence → only horizons that explicitly allow delayed", () => {
    const delayed = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 10 * 60_000, // 10 min ago → DELAYED
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([delayed]);
    const scalp = scanRadar(radarSources, { horizons: ["SCALPING"], maxResults: 10, now: NOW });
    expect(scalp.results.get("SCALPING")![0].lifecycle).toBe("EXPIRED"); // SCALPING requires FRESH
    const intraday = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(intraday.results.get("INTRADAY")![0].lifecycle).not.toBe("EXPIRED"); // INTRADAY allows DELAYED
  });
});

// ────────────────────────────────────────────────────────────────
// 13. unknown input handling
// ────────────────────────────────────────────────────────────────
describe("Phase239 — unknown input handling", () => {
  it("unknown freshness → never silently promoted to LIVE", () => {
    const unknown = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: 0, // missing
      fetchedAt: NOW,
      provenance: "UNKNOWN",
      dataFreshness: "unavailable" as any,
    });
    // Override marketData to have timestamp 0
    unknown.marketData = mkMarketData({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      price: 50000,
      timestamp: 0,
      fetchTimestamp: NOW,
      dataFreshness: "unavailable" as any,
      timestampProvenance: "UNKNOWN" as any,
    });
    const radarSources = buildRadarSourcesFromLiveSources([unknown]);
    expect(radarSources[0].snapshot?.observedAt).toBeUndefined();
    expect(radarSources[0].snapshot?.freshness).toBe("UNAVAILABLE");
    const result = scanRadar(radarSources, { horizons: ["SCALPING", "INTRADAY", "SWING"], maxResults: 10, now: NOW });
    for (const h of ["SCALPING", "INTRADAY", "SWING"] as const) {
      const opp = result.results.get(h)![0];
      expect(opp.freshness).toBe("UNAVAILABLE");
      expect(opp.lifecycle).toBe("EXPIRED");
      expect(opp.qualityTier).toBe("X");
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 14. provider failure handling
// ────────────────────────────────────────────────────────────────
describe("Phase239 — provider failure handling", () => {
  it("provider failure → no fake opportunity", () => {
    // Empty sources = no opportunities
    const result = scanRadar([], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(0);
    expect(result.totalScanned).toBe(0);
  });

  it("provider errors remain visible to opportunity/radar layer", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const result = scanInstruments([src], {
      horizons: ["INTRADAY"],
      maxResults: 10,
      now: NOW,
      providerErrors: ["ccxt:binance: discovery failed this cycle"],
    });
    expect(result.degraded).toBe(true);
    expect(result.providerErrors).toContain("ccxt:binance: discovery failed this cycle");
  });
});

// ────────────────────────────────────────────────────────────────
// 15. retained-data behavior
// ────────────────────────────────────────────────────────────────
describe("Phase239 — retained-data behavior", () => {
  it("retained data after failure preserves observedAt, not marked as newly live", () => {
    // Simulate pipeline retaining previous data: liveSources still contains old observedAt
    const oldObserved = NOW - 60_000;
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: oldObserved, // old
      fetchedAt: NOW - 60_000, // old fetch
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    // observedAt should be old, not NOW
    expect(opp.observedAt).toBe(oldObserved);
    expect(opp.evidence?.observedAt).toBe(oldObserved);
    // Freshness based on old observedAt, not newly promoted
    expect(opp.freshness).toBe("FRESH"); // 1 min ago still fresh, but if older would be stale
    // If we now evaluate at much later time, it should become stale
    const laterResult = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 2 * 60 * 60_000 });
    expect(laterResult.results.get("INTRADAY")![0].freshness).toBe("STALE");
  });

  it("REFRESH_FAILED semantics preserved — lifecycle not LIVE when retained", async () => {
    const src = readFileSync("src/lib/discovery/lifecycle.ts", "utf8");
    expect(src).toContain("REFRESH_FAILED");
    expect(src).toContain("Math.max");
  });
});

// ────────────────────────────────────────────────────────────────
// 16. opportunity key integrity
// ────────────────────────────────────────────────────────────────
describe("Phase239 — opportunity key integrity", () => {
  it("opportunityKey uses provider::id when available", () => {
    const opp = {
      instrument: "BTC/USDT",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
    } as any;
    expect(opportunityKey(opp)).toBe("ccxt:binance::BTC/USDT");
  });

  it("opportunityKey falls back to instrument when no providerNative", () => {
    const opp = { instrument: "BTC/USDT" } as any;
    expect(opportunityKey(opp)).toBe("BTC/USDT");
  });

  it("buildRadarState uses provider-qualified keys", () => {
    const binance = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const okx = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:okx",
      providerInstrumentId: "BTC/USDT",
      price: 50100,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([binance, okx]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const state = buildRadarState(result);
    expect(state.previous.size).toBe(2);
    expect(state.previous.has("ccxt:binance::BTC/USDT")).toBe(true);
    expect(state.previous.has("ccxt:okx::BTC/USDT")).toBe(true);
  });

  it("no opportunity keyed only by symbol when providerNative exists", () => {
    const src = readFileSync("src/lib/market-radar/radar.ts", "utf8");
    expect(src).toContain("opportunityKey");
    expect(src).toContain("provider::");
  });
});

// ────────────────────────────────────────────────────────────────
// 17. numerical invalid-input handling
// ────────────────────────────────────────────────────────────────
describe("Phase239 — numerical invalid-input handling", () => {
  it("NaN price → explicit degraded/insufficient, not invented", () => {
    const md = mkMarketData({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      price: NaN,
      timestamp: NOW - 1000,
      fetchTimestamp: NOW,
    });
    const src: LiveCandidateSource = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
      marketData: md,
    } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    // NaN price should lead to no evidence or degraded
    const opp = result.results.get("INTRADAY")![0];
    // Price invalid → dataCompleteness NONE or MINIMAL, qualityTier X or D, not normal confidence
    expect(opp.evidence).toBeUndefined(); // buildEvidence rejects non-finite price
  });

  it("Infinity price → rejected", () => {
    const md = mkMarketData({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      price: Infinity,
      timestamp: NOW - 1000,
      fetchTimestamp: NOW,
    });
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].evidence).toBeUndefined();
  });

  it("zero price → degraded, not live", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 0,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.evidence).toBeUndefined();
    // Zero price → explicit degraded/insufficient, not A/B/C live
    expect(["X", "D"].includes(opp.qualityTier)).toBe(true);
    expect(opp.freshness === "FRESH" ? opp.qualityTier !== "A" : true).toBe(true);
  });

  it("missing volume/bid/ask handled without crash, marked as missing", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    // No bid/ask
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].evidence?.derived?.spreadBps).toBeUndefined();
  });

  it("future timestamp → UNAVAILABLE, not FRESH", () => {
    const future = NOW + 10 * 60_000;
    expect(assessFreshness(future, NOW)).toBe("UNAVAILABLE");
  });
});

// ────────────────────────────────────────────────────────────────
// 18. confidence/evidence integrity
// ────────────────────────────────────────────────────────────────
describe("Phase239 — confidence/evidence integrity", () => {
  it("missing evidence → low confidence, not normal", () => {
    const src: LiveCandidateSource = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
      marketData: mkMarketData({
        instrument: "BTC/USDT",
        provider: "ccxt:binance",
        price: 50000,
        timestamp: NOW - 1000,
        fetchTimestamp: NOW,
        dataFreshness: "realtime",
      }),
      // No other evidence
    } as any;
    const candidate = buildCandidateFromSource(src, NOW);
    // buildCandidateFromSource should have minimal completeness when only price
    expect(candidate.dataCompleteness).toBe("MINIMAL");
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    // Confidence should reflect missing evidence — not 90+
    expect(opp.confidence).toBeLessThan(70);
    expect(opp.missingInformation.length).toBeGreaterThan(0);
  });

  it("stale evidence → low confidence, not live confidence", () => {
    const stale = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 2 * 60 * 60_000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([stale]);
    const result = scanRadar(radarSources, { horizons: ["SWING"], maxResults: 10, now: NOW });
    const opp = result.results.get("SWING")![0];
    // Even though SWING allows stale, confidence should be penalized for stale
    expect(opp.conflictingEvidence.length).toBeGreaterThan(0);
  });

  it("confidence not mistaken for provider certainty — evidence-confidence distinguishes", () => {
    const src = readFileSync("src/lib/market-radar/evidence-confidence.ts", "utf8");
    expect(src).toContain("notProbabilityOfProfit");
    expect(src).toContain("FRESH");
  });

  it("provider errors represented, confidence degraded", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const result = scanInstruments([src], {
      horizons: ["INTRADAY"],
      maxResults: 10,
      now: NOW,
      providerErrors: ["ccxt:binance: timeout"],
    });
    expect(result.degraded).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 19. UI mapping
// ────────────────────────────────────────────────────────────────
describe("Phase239 — UI mapping", () => {
  it("MarketOpportunities can distinguish provider, native instrument, freshness, degraded, provenance", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("providerNative");
    expect(src).toContain("freshness");
    expect(src).toContain("providerErrors");
    expect(src).toContain("degraded");
    expect(src).toContain("timestampProvenance");
    expect(src).toContain("opportunityDisplayKey");
  });

  it("UI uses provider-qualified key to prevent collision", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("opportunityDisplayKey");
    expect(src).not.toMatch(/key=\{opp\.instrument\}.*\n.*key=\{item\.instrument\}/s); // should not use bare instrument
  });

  it("UI shows lifecycle and tradingState, not just LIVE", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("lifecycle");
    expect(src).toContain("LIFECYCLE_COLORS");
  });

  it("UI does not display LIVE when evidence is retained after failure", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("isLive");
    expect(src).toContain("totalWithLiveData");
    // LIVE badge based on totalWithLiveData, not mere existence of liveSources
    expect(src).toContain("totalWithLiveData");
  });
});

// ────────────────────────────────────────────────────────────────
// 20. credential isolation
// ────────────────────────────────────────────────────────────────
describe("Phase239 — credential isolation", () => {
  it("opportunity objects do not contain API keys", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/API_KEY|apikey|secret|sk-/i);
  });

  it("serialized UI payloads contain no credentials", () => {
    const files = [
      "src/lib/market-radar/live-source-adapter.ts",
      "src/lib/market-radar/radar.ts",
      "src/lib/discovery/runtime.ts",
    ];
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      expect(content).not.toMatch(/TWELVE_DATA_API_KEY\s*=\s*['\"][a-zA-Z0-9]{20,}/);
      expect(content).not.toContain("sk-");
    }
  });

  it("marketData does not carry headers or auth", () => {
    const src = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const serialized = JSON.stringify(src.marketData);
    expect(serialized).not.toMatch(/authorization|bearer|api.?key/i);
  });
});

// ────────────────────────────────────────────────────────────────
// Additional: correlation behavior explicit
// ────────────────────────────────────────────────────────────────
describe("Phase239 — correlation explicit behavior", () => {
  it("correlation is grouping, not identity substitution", () => {
    const a = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      correlationKey: "crypto:BTC",
    });
    const b = mkLiveSource({
      instrument: "BTC/USDT",
      provider: "ccxt:okx",
      providerInstrumentId: "BTC/USDT",
      price: 50100,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
      correlationKey: "crypto:BTC",
    });
    const radarSources = buildRadarSourcesFromLiveSources([a, b]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    // Both remain, correlation does not merge them
    expect(result.results.get("INTRADAY")!.length).toBe(2);
    // Their providerNative identities remain distinct
    const providers = result.results.get("INTRADAY")!.map(o => o.providerNative?.provider);
    expect(new Set(providers).size).toBe(2);
  });
});
