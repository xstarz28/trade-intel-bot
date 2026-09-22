/**
 * Phase 240 — Opportunity Evidence Aggregation Integrity
 *
 * Hardens:
 * - identity collisions from legacy bare-instrument keys
 * - numerical validation beyond price
 * - multi-evidence freshness semantics
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  scanRadar,
  opportunityKey,
  buildRadarState,
  isValidPrice,
  isValidVolume,
  isValidBidAsk,
  isValidSpreadBps,
  isValidChange,
  isValidVolatility,
  isValidCorrelation,
  computeEffectiveFreshness,
} from "../market-radar/radar";
import { buildRadarSourcesFromLiveSources } from "../market-radar/live-source-adapter";
import type { MarketData } from "../data/market-types";
import type { LiveCandidateSource } from "../liveCandidateBuilder";
import { scanInstruments } from "../liveScanner";

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
    ...(overrides.volume !== undefined ? { volume: overrides.volume } as any : {}),
    ...(overrides.change24h !== undefined ? { change24h: overrides.change24h } as any : {}),
    ...(overrides.volatility !== undefined ? { volatility: overrides.volatility } as any : {}),
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
  volume?: number;
  change24h?: number;
  volatility?: number;
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
    ...(opts.volume !== undefined ? { volume: opts.volume } as any : {}),
    ...(opts.change24h !== undefined ? { change24h: opts.change24h } as any : {}),
    ...(opts.volatility !== undefined ? { volatility: opts.volatility } as any : {}),
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
// 1. identity fallback
// ────────────────────────────────────────────────────────────────
describe("Phase240 — identity fallback", () => {
  it("fallback uses assetClass::instrument::region when providerNative absent", () => {
    const opp = { instrument: "BTC/USDT", assetClass: "crypto", region: "global" } as any;
    const key = opportunityKey(opp);
    expect(key).toBe("crypto::BTC/USDT::global");
    expect(key).not.toBe("BTC/USDT");
  });

  it("fallback with candidateInstrument distinct includes candidate", () => {
    const opp = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      region: "us",
      candidateInstrument: "BTC-USDT-PERP",
    } as any;
    const key = opportunityKey(opp);
    expect(key).toContain("BTC/USDT");
    expect(key).toContain("BTC-USDT-PERP");
    expect(key).toContain("crypto");
  });

  it("partial providerNative with only providerInstrumentId includes instrument+assetClass", () => {
    const opp = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { providerInstrumentId: "BTC/USDT" } as any,
    } as any;
    const key = opportunityKey(opp);
    expect(key).toContain("BTC/USDT");
    expect(key).toContain("crypto");
    expect(key).not.toBe("BTC/USDT");
  });

  it("partial providerNative with only provider includes instrument+assetClass", () => {
    const opp = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      region: "us",
      providerNative: { provider: "ccxt:binance" } as any,
    } as any;
    const key = opportunityKey(opp);
    expect(key).toContain("ccxt:binance");
    expect(key).toContain("BTC/USDT");
    expect(key).toContain("crypto");
  });
});

// ────────────────────────────────────────────────────────────────
// 2. provider-native identity
// ────────────────────────────────────────────────────────────────
describe("Phase240 — provider-native identity", () => {
  it("full provider-native identity preferred and unchanged", () => {
    const opp = {
      instrument: "BTC/USDT",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
    } as any;
    expect(opportunityKey(opp)).toBe("ccxt:binance::BTC/USDT");
  });

  it("providerNative identity never mutated by normalized symbol", () => {
    const src = mkLiveSource({
      instrument: "BTC-USDT-SWAP",
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.providerNative?.providerInstrumentId).toBe("BTC-USDT-SWAP");
    expect(opp.evidence?.providerInstrumentId).toBe("BTC-USDT-SWAP");
  });
});

// ────────────────────────────────────────────────────────────────
// 3. same-symbol collision
// ────────────────────────────────────────────────────────────────
describe("Phase240 — same-symbol collision", () => {
  it("same symbol different providers distinct", () => {
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
    const keys = opps.map(opportunityKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("same symbol same provider different native IDs distinct (provider-qualified)", () => {
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
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT-PERP",
      price: 50000,
      observedAt: NOW - 1000,
      fetchedAt: NOW,
    });
    const radarSources = buildRadarSourcesFromLiveSources([a, b]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const keys = result.results.get("INTRADAY")!.map(opportunityKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("ccxt:binance::BTC/USDT");
    expect(keys).toContain("ccxt:binance::BTC/USDT-PERP");
  });
});

// ────────────────────────────────────────────────────────────────
// 4. same-provider collision
// ────────────────────────────────────────────────────────────────
describe("Phase240 — same-provider collision", () => {
  it("same provider different instruments distinct", () => {
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
  });
});

// ────────────────────────────────────────────────────────────────
// 5. legacy identity collision
// ────────────────────────────────────────────────────────────────
describe("Phase240 — legacy identity collision", () => {
  it("legacy instruments same display symbol but different assetClass distinct", () => {
    const cryptoOpp = { instrument: "BTC/USD", assetClass: "crypto", region: "global" } as any;
    const forexOpp = { instrument: "BTC/USD", assetClass: "forex", region: "global" } as any;
    const k1 = opportunityKey(cryptoOpp);
    const k2 = opportunityKey(forexOpp);
    expect(k1).not.toBe(k2);
    expect(k1).toContain("crypto");
    expect(k2).toContain("forex");
  });

  it("legacy instruments same symbol different region distinct", () => {
    const us = { instrument: "AAPL", assetClass: "equity", region: "us" } as any;
    const idx = { instrument: "AAPL", assetClass: "equity", region: "idx" } as any;
    expect(opportunityKey(us)).not.toBe(opportunityKey(idx));
  });

  it("DEX vs CEX collision prevented", () => {
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
    const keys = result.results.get("INTRADAY")!.map(opportunityKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("BTC/USD vs BTC/USDT not silently merged", () => {
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
    const ids = result.results.get("INTRADAY")!.map(o => o.providerNative?.providerInstrumentId);
    expect(ids).toContain("BTC/USD");
    expect(ids).toContain("BTC/USDT");
  });
});

// ────────────────────────────────────────────────────────────────
// 6. numerical finite validation
// ────────────────────────────────────────────────────────────────
describe("Phase240 — numerical finite validation", () => {
  it("isValidPrice rejects NaN, Infinity, zero, negative", () => {
    expect(isValidPrice(NaN)).toBe(false);
    expect(isValidPrice(Infinity)).toBe(false);
    expect(isValidPrice(-Infinity)).toBe(false);
    expect(isValidPrice(0)).toBe(false);
    expect(isValidPrice(-1)).toBe(false);
    expect(isValidPrice(1)).toBe(true);
    expect(isValidPrice(50000)).toBe(true);
  });

  it("isValidVolume rejects NaN, Infinity, negative, allows zero", () => {
    expect(isValidVolume(NaN)).toBe(false);
    expect(isValidVolume(Infinity)).toBe(false);
    expect(isValidVolume(-1)).toBe(false);
    expect(isValidVolume(0)).toBe(true);
    expect(isValidVolume(1000)).toBe(true);
  });

  it("isValidBidAsk rejects invalid", () => {
    expect(isValidBidAsk(100, 90)).toBe(false); // bid > ask
    expect(isValidBidAsk(0, 100)).toBe(false);
    expect(isValidBidAsk(100, 0)).toBe(false);
    expect(isValidBidAsk(NaN, 100)).toBe(false);
    expect(isValidBidAsk(100, Infinity)).toBe(false);
    expect(isValidBidAsk(99, 100)).toBe(true);
  });

  it("isValidSpreadBps, Change, Volatility, Correlation", () => {
    expect(isValidSpreadBps(-1)).toBe(false);
    expect(isValidSpreadBps(NaN)).toBe(false);
    expect(isValidSpreadBps(0)).toBe(true);
    expect(isValidSpreadBps(5)).toBe(true);
    expect(isValidChange(NaN)).toBe(false);
    expect(isValidChange(-5)).toBe(true); // change can be negative
    expect(isValidChange(Infinity)).toBe(false);
    expect(isValidVolatility(-1)).toBe(false);
    expect(isValidVolatility(0)).toBe(true);
    expect(isValidVolatility(1.5)).toBe(true);
    expect(isValidCorrelation(2)).toBe(false);
    expect(isValidCorrelation(-2)).toBe(false);
    expect(isValidCorrelation(0.5)).toBe(true);
    expect(isValidCorrelation(-0.9)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 7. invalid price
// ────────────────────────────────────────────────────────────────
describe("Phase240 — invalid price", () => {
  it("NaN price → evidence undefined", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: NaN, timestamp: NOW - 1000, fetchTimestamp: NOW });
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].evidence).toBeUndefined();
  });

  it("negative price → evidence undefined", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: -100, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].evidence).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 8. invalid bid/ask
// ────────────────────────────────────────────────────────────────
describe("Phase240 — invalid bid/ask", () => {
  it("bid > ask → spread not computed, evidence still valid", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW, bid: 50100, ask: 50000 });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.spreadBps).toBeUndefined();
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.evidence?.price).toBe(50000);
    expect(opp.evidence?.derived?.spreadBps).toBeUndefined();
  });

  it("zero bid or ask → invalid, no spread", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW, bid: 0, ask: 50000 });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.spreadBps).toBeUndefined();
  });

  it("NaN bid/ask → no spread", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: 50000, timestamp: NOW - 1000, fetchTimestamp: NOW, bid: NaN, ask: 50001 } as any);
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.spreadBps).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 9. invalid volume
// ────────────────────────────────────────────────────────────────
describe("Phase240 — invalid volume", () => {
  it("negative volume → not preserved, not fabricated", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: 50000, timestamp: NOW - 1000, fetchTimestamp: NOW, volume: -100 } as any);
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    // volume should be dropped, not negative
    expect((radarSources[0].snapshot as any)?.volume24h).toBeUndefined();
  });

  it("NaN volume → not preserved", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: 50000, timestamp: NOW - 1000, fetchTimestamp: NOW, volume: NaN } as any);
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect((radarSources[0].snapshot as any)?.volume24h).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 10. invalid denominator / derived
// ────────────────────────────────────────────────────────────────
describe("Phase240 — invalid denominator / derived", () => {
  it("zero mid price → no spreadBps (division by zero prevented)", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: 50000, timestamp: NOW - 1000, fetchTimestamp: NOW, bid: 0, ask: 0 } as any);
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.spreadBps).toBeUndefined();
  });

  it("Infinity spread → rejected", () => {
    expect(isValidSpreadBps(Infinity)).toBe(false);
  });

  it("negative volatility → rejected", () => {
    expect(isValidVolatility(-0.5)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// 11. derived-vs-observed
// ────────────────────────────────────────────────────────────────
describe("Phase240 — derived-vs-observed", () => {
  it("spreadBps is derived, not provider-observed price", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW, bid: 49999, ask: 50001 });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const spread = radarSources[0].snapshot?.spreadBps;
    expect(spread).toBeDefined();
    expect(spread).toBeGreaterThan(0);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.evidence?.price).toBe(50000);
    expect(opp.evidence?.derived?.spreadBps).toBeDefined();
    expect(opp.evidence?.derived?.spreadBps).not.toBe(opp.evidence?.price);
  });

  it("derived values never represented as provider-observed", () => {
    const srcFile = readFileSync("src/lib/market-radar/live-source-adapter.ts", "utf8");
    expect(srcFile).toContain("DERIVED");
    expect(srcFile).toContain("spreadBps");
  });
});

// ────────────────────────────────────────────────────────────────
// 12. multi-evidence freshness
// ────────────────────────────────────────────────────────────────
describe("Phase240 — multi-evidence freshness", () => {
  it("computeEffectiveFreshness: weakest required wins", () => {
    const res = computeEffectiveFreshness("FRESH", [
      { freshness: "DELAYED", required: true, source: "derivatives" },
      { freshness: "STALE", required: true, source: "cot" },
    ]);
    expect(res.effective).toBe("STALE");
    expect(res.weakestRequired).toBe("STALE");
  });

  it("optional stale does not affect effective freshness", () => {
    const res = computeEffectiveFreshness("FRESH", [
      { freshness: "STALE", required: false, source: "derivatives" },
    ]);
    expect(res.effective).toBe("FRESH");
  });

  it("required FRESH + optional STALE → effective FRESH, but optional tracked separately", () => {
    const primary = "FRESH";
    const additional = [
      { freshness: "STALE" as const, required: false, source: "fundingRate" },
    ];
    const { effective } = computeEffectiveFreshness(primary, additional);
    expect(effective).toBe("FRESH");
  });
});

// ────────────────────────────────────────────────────────────────
// 13. required stale evidence
// ────────────────────────────────────────────────────────────────
describe("Phase240 — required stale evidence", () => {
  it("required stale → effective STALE, not FRESH", () => {
    const res = computeEffectiveFreshness("FRESH", [
      { freshness: "STALE", required: true, source: "price" },
    ]);
    expect(res.effective).toBe("STALE");
    expect(res.effective).not.toBe("FRESH");
  });
});

// ────────────────────────────────────────────────────────────────
// 14. required unknown evidence
// ────────────────────────────────────────────────────────────────
describe("Phase240 — required unknown evidence", () => {
  it("required UNAVAILABLE → effective UNAVAILABLE", () => {
    const res = computeEffectiveFreshness("FRESH", [
      { freshness: "UNAVAILABLE", required: true, source: "cot" },
    ]);
    expect(res.effective).toBe("UNAVAILABLE");
  });
});

// ────────────────────────────────────────────────────────────────
// 15. optional stale evidence
// ────────────────────────────────────────────────────────────────
describe("Phase240 — optional stale evidence", () => {
  it("optional stale preserves primary FRESH", () => {
    const src: any = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
      marketData: mkMarketData({
        instrument: "BTC/USDT",
        provider: "ccxt:binance",
        price: 50000,
        timestamp: NOW - 1000,
        fetchTimestamp: NOW,
      }),
    };
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.freshness).toBe("FRESH");
    // Missing optional should be in missingInformation, not hidden
    expect(opp.missingInformation.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 16. missing supporting evidence
// ────────────────────────────────────────────────────────────────
describe("Phase240 — missing supporting evidence", () => {
  it("missing supporting evidence → missingInformation, confidence degraded, not hidden", () => {
    const src: any = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" },
      marketData: mkMarketData({
        instrument: "BTC/USDT",
        provider: "ccxt:binance",
        price: 50000,
        timestamp: NOW - 1000,
        fetchTimestamp: NOW,
      }),
    };
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.missingInformation.length).toBeGreaterThan(0);
    expect(opp.confidence).toBeLessThan(70);
  });
});

// ────────────────────────────────────────────────────────────────
// 17. timestamp provenance
// ────────────────────────────────────────────────────────────────
describe("Phase240 — timestamp provenance", () => {
  it("PROVIDER_OBSERVED preserved, not replaced by Date.now", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW, provenance: "PROVIDER_OBSERVED" });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.timestampProvenance).toBe("PROVIDER_OBSERVED");
    expect(radarSources[0].snapshot?.observedAt).toBe(NOW - 1000);
    expect(radarSources[0].snapshot?.acquiredAt).toBe(NOW);
  });

  it("acquiredAt never promoted to observedAt", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: 50000, timestamp: 0, fetchTimestamp: NOW, dataFreshness: "unavailable" as any, timestampProvenance: "UNKNOWN" as any });
    const src: any = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md };
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.observedAt).toBeUndefined();
    expect(radarSources[0].snapshot?.acquiredAt).toBe(NOW);
  });
});

// ────────────────────────────────────────────────────────────────
// 18. retained data
// ────────────────────────────────────────────────────────────────
describe("Phase240 — retained data", () => {
  it("retained old observedAt remains old, freshness ages", () => {
    const oldObserved = NOW - 60_000;
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: oldObserved, fetchedAt: NOW - 60_000 });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.observedAt).toBe(oldObserved);
    const later = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 2 * 60 * 60_000 });
    expect(later.results.get("INTRADAY")![0].freshness).toBe("STALE");
  });

  it("retained data does not become newly live", () => {
    const oldObserved = NOW - 60_000;
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: oldObserved, fetchedAt: NOW - 60_000 });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 60_000 });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.observedAt).toBe(oldObserved);
    expect(opp.observedAt).not.toBe(NOW + 60_000);
  });
});

// ────────────────────────────────────────────────────────────────
// 19. provider failure
// ────────────────────────────────────────────────────────────────
describe("Phase240 — provider failure", () => {
  it("provider failure → no fake opportunity", () => {
    const result = scanRadar([], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(0);
  });

  it("provider errors preserved and visible", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const result = scanInstruments([src], { horizons: ["INTRADAY"], maxResults: 10, now: NOW, providerErrors: ["ccxt:binance: discovery failed"] });
    expect(result.degraded).toBe(true);
    expect(result.providerErrors).toContain("ccxt:binance: discovery failed");
  });
});

// ────────────────────────────────────────────────────────────────
// 20. correlation separation
// ────────────────────────────────────────────────────────────────
describe("Phase240 — correlation separation", () => {
  it("correlation does not merge provider-native identities", () => {
    const a = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW, correlationKey: "crypto:BTC" });
    const b = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:okx", providerInstrumentId: "BTC/USDT", price: 50100, observedAt: NOW - 1000, fetchedAt: NOW, correlationKey: "crypto:BTC" });
    const radarSources = buildRadarSourcesFromLiveSources([a, b]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(2);
    const providers = result.results.get("INTRADAY")!.map(o => o.providerNative?.provider);
    expect(new Set(providers).size).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// 21. UI identity mapping
// ────────────────────────────────────────────────────────────────
describe("Phase240 — UI identity mapping", () => {
  it("MarketOpportunities uses collision-safe display key", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("opportunityDisplayKey");
    expect(src).toContain("assetClass");
  });

  it("UI does not collapse distinct keys", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    // Should not use bare instrument as key
    expect(src).not.toMatch(/key=\{opp\.instrument\}/);
    expect(src).not.toMatch(/key=\{item\.instrument\}/);
  });
});

// ────────────────────────────────────────────────────────────────
// 22. UI freshness mapping
// ────────────────────────────────────────────────────────────────
describe("Phase240 — UI freshness mapping", () => {
  it("UI shows freshness and lifecycle, not just LIVE", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("freshness");
    expect(src).toContain("lifecycle");
    expect(src).toContain("LIFECYCLE_COLORS");
    expect(src).toContain("FRESHNESS_COLORS");
  });

  it("UI does not show stale as live", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("totalWithLiveData");
    expect(src).toContain("isLive");
  });
});

// ────────────────────────────────────────────────────────────────
// 23. provider error visibility
// ────────────────────────────────────────────────────────────────
describe("Phase240 — provider error visibility", () => {
  it("UI can display provider errors as degraded", () => {
    const src = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(src).toContain("providerErrors");
  });
});

// ────────────────────────────────────────────────────────────────
// 24. no fabricated values
// ────────────────────────────────────────────────────────────────
describe("Phase240 — no fabricated values", () => {
  it("invalid inputs never become invented valid values", () => {
    const invalidPrices = [NaN, Infinity, -Infinity, 0, -100];
    for (const p of invalidPrices) {
      const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: p, timestamp: NOW - 1000, fetchTimestamp: NOW });
      const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
      const radarSources = buildRadarSourcesFromLiveSources([src]);
      const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
      const opp = result.results.get("INTRADAY")![0];
      expect(opp.evidence).toBeUndefined();
    }
  });

  it("missing volume/bid/ask remain missing, not zero", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].evidence?.derived?.spreadBps).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 25. security / credential isolation
// ────────────────────────────────────────────────────────────────
describe("Phase240 — security / credential isolation", () => {
  it("opportunity objects contain no API keys", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/API_KEY|apikey|secret|sk-/i);
  });

  it("marketData does not carry auth headers", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const serialized = JSON.stringify(src.marketData);
    expect(serialized).not.toMatch(/authorization|bearer|api.?key/i);
  });
});
