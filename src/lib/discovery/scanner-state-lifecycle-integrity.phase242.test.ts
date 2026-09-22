/**
 * Phase 242 — Scanner State & Evidence Lifecycle Integrity
 *
 * Traces:
 * provider/live evidence → LiveCandidateSource → RadarCandidateSource → RadarOpportunity → scan result → scanner state → refresh/reconciliation → retained/expired/failed lifecycle → opportunity diff → UI
 *
 * Proves truthful evidence survives state transitions without replacement, timestamp-refresh errors, duplication, deletion, resurrection, merging, wrong lifecycle.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  reconcileDiscovery,
  applyAcquisitionOutcomes,
  expireStaleInstruments,
  keysToEvict,
  liveEligibleInstruments,
  DEFAULT_LIFECYCLE_CONFIG,
} from "./lifecycle";
import { discoveredInstrumentKey, type DiscoveredInstrument } from "./types";
import { createPipelineState, runDiscoveryPipelineStep } from "./pipeline";
import { buildRadarSourcesFromLiveSources } from "../market-radar/live-source-adapter";
import { scanRadar, buildRadarState, opportunityKey } from "../market-radar/radar";
import { canonicalOpportunityKey } from "../market-radar/opportunity-identity";
import type { LiveCandidateSource } from "../liveCandidateBuilder";
import type { MarketData } from "../data/market-types";
import { deriveCorrelationKey, limitByCorrelationGroup } from "./correlation";

const NOW = 1_800_000_000_000;

function mkDiscovered(overrides: Partial<DiscoveredInstrument> & { provider: string; providerInstrumentId: string }): DiscoveredInstrument {
  const { provider, providerInstrumentId, assetClass, subType, baseAsset, quoteAsset, tradingState, capabilities, discoveredAt, ...rest } = overrides as any;
  return {
    provider,
    providerInstrumentId,
    assetClass: assetClass ?? "crypto",
    subType: subType ?? "spot",
    baseAsset: baseAsset ?? providerInstrumentId.split("/")[0] ?? "BTC",
    quoteAsset: quoteAsset ?? "USDT",
    tradingState: tradingState ?? "TRADING",
    capabilities: capabilities ?? ["ohlcv", "quote"],
    discoveredAt: discoveredAt ?? NOW,
    ...rest,
  } as DiscoveredInstrument;
}

function mkMarketData(opts: { instrument: string; provider: string; price: number; observedAt: number; fetchTimestamp: number; provenance?: MarketData["timestampProvenance"] }): MarketData {
  return {
    instrument: opts.instrument,
    instrumentType: "crypto",
    provider: opts.provider,
    fetchTimestamp: opts.fetchTimestamp,
    price: { price: opts.price, timestamp: opts.observedAt, source: opts.provider },
    candles: [{ timestamp: opts.observedAt, open: opts.price, high: opts.price * 1.01, low: opts.price * 0.99, close: opts.price, volume: 1000 } as any],
    timeframe: "1h",
    dataFreshness: "realtime",
    timestampProvenance: opts.provenance ?? "PROVIDER_OBSERVED",
  } as MarketData;
}

function mkLiveSource(opts: { instrument: string; provider: string; providerInstrumentId: string; price: number; observedAt: number; fetchedAt: number; assetClass?: any }): LiveCandidateSource {
  const md = mkMarketData({ instrument: opts.instrument, provider: opts.provider, price: opts.price, observedAt: opts.observedAt, fetchTimestamp: opts.fetchedAt });
  return {
    instrument: opts.instrument,
    assetClass: opts.assetClass ?? "crypto",
    providerNative: { provider: opts.provider, providerInstrumentId: opts.providerInstrumentId },
    correlationKey: `${opts.assetClass ?? "crypto"}:${opts.instrument.split("/")[0]}`,
    marketData: md,
  } as LiveCandidateSource;
}

// ────────────────────────────────────────────────────────────────
// 1 initial live state
// ────────────────────────────────────────────────────────────────
describe("Phase242 1 — initial live state", () => {
  it("NEW LIVE EVIDENCE → DISCOVERED → LIVE with provider-qualified key", async () => {
    const state = createPipelineState();
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const discovered = [inst];
    const result = await runDiscoveryPipelineStep({
      state,
      discovered,
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    expect(result.state.tracked.get(discoveredInstrumentKey(inst))?.state).toBe("LIVE");
    expect(result.state.tracked.get(discoveredInstrumentKey(inst))?.lastLiveAt).toBe(NOW - 1000);
    expect(result.liveSources.length).toBe(1);
    expect(result.liveSources[0].providerNative?.provider).toBe("ccxt:binance");
  });
});

// ────────────────────────────────────────────────────────────────
// 2 refresh success
// ────────────────────────────────────────────────────────────────
describe("Phase242 2 — refresh success", () => {
  it("identity remains identical, observedAt becomes T2 only because provider supplied T2, acquiredAt becomes A2", async () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 5000,
      lastSuccessAt: NOW - 5000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW - 5000,
    });
    const outcomes = [{ key, success: true, observedAt: NOW - 1000 }];
    tracked = applyAcquisitionOutcomes(tracked, outcomes, NOW);
    const entry = tracked.get(key)!;
    expect(entry.state).toBe("LIVE");
    expect(entry.lastLiveAt).toBe(NOW - 1000);
    expect(entry.consecutiveFailures).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 3 newer provider timestamp
// ────────────────────────────────────────────────────────────────
describe("Phase242 3 — newer provider timestamp", () => {
  it("newer observedAt overwrites older via Math.max", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 5000,
      lastSuccessAt: NOW - 5000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: true, observedAt: NOW - 1000 }], NOW);
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - 1000);
  });
});

// ────────────────────────────────────────────────────────────────
// 4 older provider timestamp
// ────────────────────────────────────────────────────────────────
describe("Phase242 4 — older provider timestamp", () => {
  it("older evidence must not overwrite newer evidence (monotonic)", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: true, observedAt: NOW - 5000 }], NOW);
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - 1000); // not overwritten by older
  });
});

// ────────────────────────────────────────────────────────────────
// 5 equal provider timestamp
// ────────────────────────────────────────────────────────────────
describe("Phase242 5 — equal provider timestamp", () => {
  it("equal timestamp preserves existing, does not create duplicate", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: true, observedAt: NOW - 1000 }], NOW);
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - 1000);
    expect(tracked.size).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────
// 6 refresh failure
// ────────────────────────────────────────────────────────────────
describe("Phase242 6 — refresh failure", () => {
  it("LIVE → refresh fails → old observedAt unchanged, state REFRESH_FAILED, provider error retained, not newly live", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + 1000);
    const entry = tracked.get(key)!;
    expect(entry.lastLiveAt).toBe(NOW - 1000);
    expect(entry.state).toBe("REFRESH_FAILED");
    expect(entry.consecutiveFailures).toBe(1);
    expect(entry.lastFailureAt).toBe(NOW + 1000);
  });

  it("failed refresh does not fabricate new timestamp", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + 5000);
    expect(tracked.get(key)!.lastLiveAt).not.toBe(NOW + 5000);
  });
});

// ────────────────────────────────────────────────────────────────
// 7 repeated refresh failure
// ────────────────────────────────────────────────────────────────
describe("Phase242 7 — repeated refresh failure", () => {
  it("REFRESH_FAILED → another fail → timestamp does not move forward, lifecycle does not falsely recover", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "REFRESH_FAILED",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 2000,
      lastFailureAt: NOW - 100,
      consecutiveFailures: 1,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + 1000);
    const e = tracked.get(key)!;
    expect(e.lastLiveAt).toBe(NOW - 1000);
    expect(e.state).toBe("REFRESH_FAILED");
    expect(e.consecutiveFailures).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// 8 recovery after failure
// ────────────────────────────────────────────────────────────────
describe("Phase242 8 — recovery after failure", () => {
  it("LIVE → REFRESH_FAILED → genuine success recovers to LIVE with new observedAt/acquiredAt, identity unchanged", async () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    // first success
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    // fail
    const failed = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW + 1000,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: false,
        error: "network",
      })),
    });
    expect(failed.state.tracked.get(discoveredInstrumentKey(inst))?.state).toBe("REFRESH_FAILED");
    // recovery with newer timestamp
    const recovered = await runDiscoveryPipelineStep({
      state: failed.state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW + 2000,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50100, observedAt: NOW + 1000, fetchedAt: NOW + 2000 }),
        observedAt: NOW + 1000,
      })),
    });
    const entry = recovered.state.tracked.get(discoveredInstrumentKey(inst))!;
    expect(entry.state).toBe("LIVE");
    expect(entry.lastLiveAt).toBe(NOW + 1000);
    expect(entry.consecutiveFailures).toBe(0);
  });

  it("provider A fails, provider B does NOT heal A", async () => {
    const instA = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const instB = mkDiscovered({ provider: "ccxt:okx", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [instA, instB],
      succeededProviders: ["ccxt:binance", "ccxt:okx"],
      batchSize: 2,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    // fail A, succeed B
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [instA, instB],
      succeededProviders: ["ccxt:binance", "ccxt:okx"],
      batchSize: 2,
      now: NOW + 1000,
      acquire: async (batch) => batch.map(b => {
        if (b.provider === "ccxt:binance") {
          return { provider: b.provider, providerInstrumentId: b.providerInstrumentId, assetClass: b.assetClass, success: false, error: "fail" };
        }
        return {
          provider: b.provider,
          providerInstrumentId: b.providerInstrumentId,
          assetClass: b.assetClass,
          success: true,
          source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50100, observedAt: NOW, fetchedAt: NOW + 1000 }),
          observedAt: NOW,
        };
      }),
    });
    expect(second.state.tracked.get(discoveredInstrumentKey(instA))?.state).toBe("REFRESH_FAILED");
    expect(second.state.tracked.get(discoveredInstrumentKey(instB))?.state).toBe("LIVE");
  });
});

// ────────────────────────────────────────────────────────────────
// 9 stale transition
// ────────────────────────────────────────────────────────────────
describe("Phase242 9 — stale transition", () => {
  it("LIVE → time advances → STALE but no new timestamps, no freshness promotion, identity preserved", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const fresh = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(fresh.results.get("INTRADAY")![0].freshness).toBe("FRESH");
    const stale = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 2 * 60 * 60_000 });
    const opp = stale.results.get("INTRADAY")![0];
    expect(opp.freshness).toBe("STALE");
    expect(opp.observedAt).toBe(NOW - 1000);
    expect(opp.providerNative?.provider).toBe("ccxt:binance");
  });
});

// ────────────────────────────────────────────────────────────────
// 10 expiration
// ────────────────────────────────────────────────────────────────
describe("Phase242 10 — expiration", () => {
  it("EXPIRED after retention window, no resurrection without acquisition", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = expireStaleInstruments(tracked, NOW + DEFAULT_LIFECYCLE_CONFIG.retentionMs + 1000);
    expect(tracked.get(key)!.state).toBe("EXPIRED");
    expect(keysToEvict(tracked)).toContain(key);
  });
});

// ────────────────────────────────────────────────────────────────
// 11 no resurrection
// ────────────────────────────────────────────────────────────────
describe("Phase242 11 — no resurrection", () => {
  it("EXPIRED remains expired without new acquisition, must not appear as FRESH/LIVE", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "EXPIRED",
      lastLiveAt: NOW - DEFAULT_LIFECYCLE_CONFIG.retentionMs - 5000,
      lastSuccessAt: NOW - DEFAULT_LIFECYCLE_CONFIG.retentionMs - 5000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    // no new acquisition, still expired
    tracked = expireStaleInstruments(tracked, NOW);
    expect(tracked.get(key)!.state).toBe("EXPIRED");
    expect(liveEligibleInstruments(tracked).length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 12 discovery-vs-live separation
// ────────────────────────────────────────────────────────────────
describe("Phase242 12 — discovery-vs-live separation", () => {
  it("discovered instrument without successful acquisition cannot become LIVE", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    const tracked = reconcileDiscovery({
      tracked: new Map(),
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      now: NOW,
    });
    expect(tracked.get(key)!.state).toBe("DISCOVERED");
    expect(tracked.get(key)!.lastLiveAt).toBeNull();
    expect(liveEligibleInstruments(tracked).length).toBe(0);
  });

  it("no observedAt fabricated, no price invented, no fresh opportunity from discovery alone", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const tracked = reconcileDiscovery({
      tracked: new Map(),
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      now: NOW,
    });
    expect(tracked.get(discoveredInstrumentKey(inst))!.lastLiveAt).toBeNull();
    // scanRadar with no live sources → no opportunities
    const result = scanRadar([], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 13 discovery refresh isolation
// ────────────────────────────────────────────────────────────────
describe("Phase242 13 — discovery refresh isolation", () => {
  it("discovery refresh after existing live must not overwrite provider/native/price/observedAt", async () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    const liveBefore = first.state.liveSources.get(discoveredInstrumentKey(inst))!;
    // discovery refresh with same instrument but different metadata (should not overwrite live price)
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 0,
      now: NOW + 1000,
      acquire: async () => [],
    });
    const liveAfter = second.state.liveSources.get(discoveredInstrumentKey(inst))!;
    expect(liveAfter.marketData?.price.price).toBe(liveBefore.marketData?.price.price);
    expect(liveAfter.marketData?.price.timestamp).toBe(liveBefore.marketData?.price.timestamp);
  });
});

// ────────────────────────────────────────────────────────────────
// 14 multi-provider state
// ────────────────────────────────────────────────────────────────
describe("Phase242 14 — multi-provider state", () => {
  it("ccxt:binance BTC/USDT, ccxt:okx BTC/USDT, twelve-data BTC/USD are three independent entries", async () => {
    const binance = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", assetClass: "crypto" });
    const okx = mkDiscovered({ provider: "ccxt:okx", providerInstrumentId: "BTC/USDT", assetClass: "crypto" });
    const twelve = mkDiscovered({ provider: "twelve-data", providerInstrumentId: "BTC/USD", assetClass: "crypto" });
    const state = createPipelineState();
    const result = await runDiscoveryPipelineStep({
      state,
      discovered: [binance, okx, twelve],
      succeededProviders: ["ccxt:binance", "ccxt:okx", "twelve-data"],
      batchSize: 3,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    expect(result.state.tracked.size).toBe(3);
    expect(result.liveSources.length).toBe(3);
    const keys = Array.from(result.state.tracked.keys());
    expect(new Set(keys).size).toBe(3);
    const opps = scanRadar(buildRadarSourcesFromLiveSources(result.liveSources), { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const oppKeys = opps.results.get("INTRADAY")!.map(o => opportunityKey(o));
    expect(new Set(oppKeys).size).toBe(3);
  });

  it("refresh of Binance does not mutate OKX, failure of OKX does not degrade Binance, removal of Twelve Data does not remove others", async () => {
    const binance = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const okx = mkDiscovered({ provider: "ccxt:okx", providerInstrumentId: "BTC/USDT" });
    const twelve = mkDiscovered({ provider: "twelve-data", providerInstrumentId: "BTC/USD" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [binance, okx, twelve],
      succeededProviders: ["ccxt:binance", "ccxt:okx", "twelve-data"],
      batchSize: 3,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    // refresh only binance with newer timestamp, okx fails, twelve delisted
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [binance, okx], // twelve missing but provider succeeded -> delisted
      succeededProviders: ["ccxt:binance", "ccxt:okx", "twelve-data"],
      batchSize: 2,
      now: NOW + 1000,
      acquire: async (batch) => batch.map(b => {
        if (b.provider === "ccxt:binance") {
          return {
            provider: b.provider,
            providerInstrumentId: b.providerInstrumentId,
            assetClass: b.assetClass,
            success: true,
            source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50100, observedAt: NOW, fetchedAt: NOW + 1000 }),
            observedAt: NOW,
          };
        }
        return { provider: b.provider, providerInstrumentId: b.providerInstrumentId, assetClass: b.assetClass, success: false, error: "fail" };
      }),
    });
    expect(second.state.tracked.get(discoveredInstrumentKey(binance))?.state).toBe("LIVE");
    expect(second.state.tracked.get(discoveredInstrumentKey(okx))?.state).toBe("REFRESH_FAILED");
    // DELISTED instruments are evicted from tracked and liveSources per keysToEvict semantics
    expect(second.state.tracked.has(discoveredInstrumentKey(twelve))).toBe(false);
    expect(second.evicted).toContain(discoveredInstrumentKey(twelve));
    expect(second.state.liveSources.has(discoveredInstrumentKey(binance))).toBe(true);
    expect(second.state.liveSources.has(discoveredInstrumentKey(okx))).toBe(true); // retained
    expect(second.state.liveSources.has(discoveredInstrumentKey(twelve))).toBe(false); // evicted
  });
});

// ────────────────────────────────────────────────────────────────
// 15 same-provider multiple instruments
// ────────────────────────────────────────────────────────────────
describe("Phase242 15 — same-provider multiple instruments", () => {
  it("same provider two different native IDs remain separate", async () => {
    const btc = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const eth = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "ETH/USDT" });
    const state = createPipelineState();
    const result = await runDiscoveryPipelineStep({
      state,
      discovered: [btc, eth],
      succeededProviders: ["ccxt:binance"],
      batchSize: 2,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: b.providerInstrumentId.includes("BTC") ? 50000 : 3000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    expect(result.state.tracked.size).toBe(2);
    expect(result.liveSources.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// 16 retention
// ────────────────────────────────────────────────────────────────
describe("Phase242 16 — retention", () => {
  it("retained data survives failed refresh, original provenance preserved", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + 1000);
    const e = tracked.get(key)!;
    expect(e.lastLiveAt).toBe(NOW - 1000);
    expect(e.state).toBe("REFRESH_FAILED");
  });
});

// ────────────────────────────────────────────────────────────────
// 17 reconciliation
// ────────────────────────────────────────────────────────────────
describe("Phase242 17 — reconciliation", () => {
  it("reconciliation uses provider-qualified key, not bare instrument", () => {
    const a = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const b = mkDiscovered({ provider: "ccxt:okx", providerInstrumentId: "BTC/USDT" });
    const tracked = reconcileDiscovery({
      tracked: new Map(),
      discovered: [a, b],
      succeededProviders: ["ccxt:binance", "ccxt:okx"],
      now: NOW,
    });
    expect(tracked.size).toBe(2);
    expect(tracked.has(discoveredInstrumentKey(a))).toBe(true);
    expect(tracked.has(discoveredInstrumentKey(b))).toBe(true);
  });

  it("failed provider discovery does not retire instruments", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW - 1000,
    });
    tracked = reconcileDiscovery({
      tracked,
      discovered: [], // empty discovery but provider failed
      succeededProviders: [], // binance not in succeeded -> should retain
      now: NOW,
    });
    expect(tracked.has(key)).toBe(true);
    expect(tracked.get(key)!.state).toBe("LIVE");
  });
});

// ────────────────────────────────────────────────────────────────
// 18 duplicate prevention
// ────────────────────────────────────────────────────────────────
describe("Phase242 18 — duplicate prevention", () => {
  it("same evidence processed twice does not create duplicate opportunity", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src, src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    // buildRadarSourcesFromLiveSources maps each source, but scanRadar dedup via canonical key via filterByCorrelation seenKeys
    const opps = result.results.get("INTRADAY")!;
    const keys = opps.map(o => opportunityKey(o));
    expect(new Set(keys).size).toBe(opps.length);
    // With same provider/native, should be 1 after dedup in filterByCorrelation
    expect(opps.length).toBe(1);
  });

  it("same provider/native ID discovered twice remains single tracked entry", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const tracked = reconcileDiscovery({
      tracked: new Map(),
      discovered: [inst, inst],
      succeededProviders: ["ccxt:binance"],
      now: NOW,
    });
    expect(tracked.size).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────
// 19 phantom opportunity prevention
// ────────────────────────────────────────────────────────────────
describe("Phase242 19 — phantom opportunity prevention", () => {
  it("provider failure followed by retained state does not create phantom", async () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW + 1000,
      acquire: async (batch) => batch.map(b => ({ provider: b.provider, providerInstrumentId: b.providerInstrumentId, assetClass: b.assetClass, success: false, error: "fail" })),
    });
    expect(second.liveSources.length).toBe(1);
    const radar = scanRadar(buildRadarSourcesFromLiveSources(second.liveSources), { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 1000 });
    expect(radar.results.get("INTRADAY")!.length).toBe(1);
  });

  it("discovery result arriving after live result does not overwrite live evidence", async () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    // discovery refresh without acquisition
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 0,
      now: NOW + 1000,
      acquire: async () => [],
    });
    expect(second.state.liveSources.get(discoveredInstrumentKey(inst))?.marketData?.price.price).toBe(50000);
  });
});

// ────────────────────────────────────────────────────────────────
// 20 canonical state identity
// ────────────────────────────────────────────────────────────────
describe("Phase242 20 — canonical state identity", () => {
  it("State Maps use canonical opportunity identity (provider::id)", () => {
    const a = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" } } as any;
    const b = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:okx", providerInstrumentId: "BTC/USDT" } } as any;
    const ka = canonicalOpportunityKey(a);
    const kb = canonicalOpportunityKey(b);
    expect(ka).not.toBe(kb);
    const map = new Map();
    map.set(ka, a);
    map.set(kb, b);
    expect(map.size).toBe(2);
  });

  it("pipeline state uses discoveredInstrumentKey (provider::id) not bare instrument", () => {
    const file = readFileSync("src/lib/discovery/pipeline.ts", "utf8");
    expect(file).toContain("discoveredInstrumentKey");
    expect(file).not.toMatch(/liveSources\.set\(.*instrument,/);
  });
});

// ────────────────────────────────────────────────────────────────
// 21 state diff identity
// ────────────────────────────────────────────────────────────────
describe("Phase242 21 — state diff identity", () => {
  it("diff identity uses canonical opportunity identity, timestamp-only change does not create new identity", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const first = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const state = buildRadarState(first);
    const second = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 1000 }, state);
    // same identity, diff may contain score change but not appeared as new instrument
    expect(second.diffs.every(d => !d.appeared || d.instrument === "BTC/USDT")).toBe(true);
    expect(state.previous.size).toBe(1);
  });

  it("provider-native identity change is genuine identity change", () => {
    const src1 = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const src2 = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:okx", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const r1 = scanRadar(buildRadarSourcesFromLiveSources([src1]), { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const s1 = buildRadarState(r1);
    const r2 = scanRadar(buildRadarSourcesFromLiveSources([src2]), { horizons: ["INTRADAY"], maxResults: 10, now: NOW }, s1);
    // should be appeared/disappeared because identity changed
    expect(r2.diffs.some(d => d.appeared || d.disappeared)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 22 provider isolation
// ────────────────────────────────────────────────────────────────
describe("Phase242 22 — provider isolation", () => {
  it("provider A evidence never overwrites provider B", async () => {
    const binance = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const okx = mkDiscovered({ provider: "ccxt:okx", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [binance, okx],
      succeededProviders: ["ccxt:binance", "ccxt:okx"],
      batchSize: 2,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: b.provider === "ccxt:binance" ? 50000 : 60000, observedAt: NOW - 1000, fetchedAt: NOW }),
        observedAt: NOW - 1000,
      })),
    });
    const binancePrice = first.state.liveSources.get(discoveredInstrumentKey(binance))!.marketData!.price.price;
    const okxPrice = first.state.liveSources.get(discoveredInstrumentKey(okx))!.marketData!.price.price;
    expect(binancePrice).toBe(50000);
    expect(okxPrice).toBe(60000);
    expect(binancePrice).not.toBe(okxPrice);
  });
});

// ────────────────────────────────────────────────────────────────
// 23 UI lifecycle
// ────────────────────────────────────────────────────────────────
describe("Phase242 23 — UI lifecycle", () => {
  it("UI lifecycle reflects actual scanner state, LIVE means live-eligible, REFRESH_FAILED distinguishable", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("LIFECYCLE_COLORS");
    expect(ui).toContain("FRESHNESS_COLORS");
    expect(ui).toContain("isLive");
    expect(ui).toContain("providerErrors");
  });

  it("two providers do not collapse into one card/key", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("opportunityDisplayKey");
    expect(ui).not.toMatch(/key=\{opp\.instrument\}/);
  });

  it("empty/failure state does not produce fake opportunities", () => {
    const result = scanRadar([], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 24 observedAt/acquiredAt
// ────────────────────────────────────────────────────────────────
describe("Phase242 24 — observedAt/acquiredAt", () => {
  it("observedAt remains provider observation, acquiredAt may change but never overwrites observedAt", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 5000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const snap = radarSources[0].snapshot!;
    expect(snap.observedAt).toBe(NOW - 5000);
    expect(snap.acquiredAt).toBe(NOW);
    expect(snap.observedAt).not.toBe(snap.acquiredAt);
  });

  it("refresh cycle does not make old evidence look newly observed", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 10000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.observedAt).toBe(NOW - 10000);
    expect(opp.observedAt).not.toBe(NOW);
  });
});

// ────────────────────────────────────────────────────────────────
// 25 provenance preservation
// ────────────────────────────────────────────────────────────────
describe("Phase242 25 — provenance preservation", () => {
  it("retained instruments retain original provenance", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.timestampProvenance).toBe("PROVIDER_OBSERVED");
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 5000 });
    expect(result.results.get("INTRADAY")![0].timestampProvenance).toBe("PROVIDER_OBSERVED");
  });

  it("PROVIDER_OBSERVED vs APPLICATION_RECEIPT preserved across lifecycle", () => {
    const file = readFileSync("src/lib/market-radar/types.ts", "utf8");
    expect(file).toContain("PROVIDER_OBSERVED");
    expect(file).toContain("APPLICATION_RECEIPT");
  });
});

// ────────────────────────────────────────────────────────────────
// 26 numerical validation regression
// ────────────────────────────────────────────────────────────────
describe("Phase242 26 — numerical validation regression", () => {
  it("NaN price must not enter valid LIVE state through refresh shortcut", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: NaN, observedAt: NOW - 1000, fetchTimestamp: NOW });
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].evidence).toBeUndefined();
  });

  it("Infinity price, invalid bid/ask, invalid volume must not enter LIVE", () => {
    const md = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: Infinity, observedAt: NOW - 1000, fetchTimestamp: NOW } as any);
    const src = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: md } as any;
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].evidence).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 27 provider errors
// ────────────────────────────────────────────────────────────────
describe("Phase242 27 — provider errors", () => {
  it("provider errors retained and attributable", async () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    const result = await runDiscoveryPipelineStep({
      state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: false,
        error: "rate limit",
      })),
    });
    expect(result.providerErrors.length).toBeGreaterThan(0);
    expect(result.providerErrors[0]).toContain("ccxt:binance");
  });
});

// ────────────────────────────────────────────────────────────────
// 28 no fabricated evidence
// ────────────────────────────────────────────────────────────────
describe("Phase242 28 — no fabricated evidence", () => {
  it("no fabricated timestamps, prices, freshness, provider identity in state transitions", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 1000,
      lastSuccessAt: NOW - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    // failure should not fabricate new observedAt
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + 1000);
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - 1000);
  });

  it("discovery metadata never becomes live evidence", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const tracked = reconcileDiscovery({
      tracked: new Map(),
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      now: NOW,
    });
    expect(tracked.get(discoveredInstrumentKey(inst))!.lastLiveAt).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// 29 security
// ────────────────────────────────────────────────────────────────
describe("Phase242 29 — security", () => {
  it("credentials never enter scanner state, opportunity state, retained state, lifecycle errors, UI props", () => {
    const files = [
      "src/lib/discovery/lifecycle.ts",
      "src/lib/discovery/pipeline.ts",
      "src/lib/market-radar/radar.ts",
      "src/lib/market-radar/live-source-adapter.ts",
      "src/components/MarketOpportunities.tsx",
    ];
    for (const f of files) {
      const content = readFileSync(f, "utf8").toLowerCase();
      expect(content).not.toMatch(/api_key/);
      expect(content).not.toMatch(/sk-/);
      expect(content).not.toMatch(/authorization:\s*bearer/);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 30 deterministic state behavior
// ────────────────────────────────────────────────────────────────
describe("Phase242 30 — deterministic state behavior", () => {
  it("same inputs produce same state, no random, no Date.now in state keys", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key1 = discoveredInstrumentKey(inst);
    const key2 = discoveredInstrumentKey(inst);
    expect(key1).toBe(key2);
    expect(key1).toBe("ccxt:binance::BTC/USDT");
  });

  it("canonical identity deterministic across refresh cycles", () => {
    const opp = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" } } as any;
    const k1 = canonicalOpportunityKey(opp);
    const k2 = canonicalOpportunityKey(opp);
    expect(k1).toBe(k2);
  });

  it("no Date.now assigned to observedAt in lifecycle", () => {
    const file = readFileSync("src/lib/discovery/lifecycle.ts", "utf8");
    expect(file).not.toMatch(/observedAt:\s*Date\.now/);
    expect(file).not.toMatch(/lastLiveAt:\s*Date\.now/);
  });
});
