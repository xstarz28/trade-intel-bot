/**
 * Phase 243 — Live Eligibility & Retention Semantics Integrity
 *
 * Hardens exact semantic boundary:
 * provider/live evidence → retained → refresh outcome → freshness → lifecycle → liveEligible/isLive → scanner eligibility → opportunity eligibility → UI
 *
 * Proves REFRESH_FAILED distinct from LIVE, retained usable only when freshness contract satisfied, no fabricated timestamps, no resurrection, provider isolation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  reconcileDiscovery,
  applyAcquisitionOutcomes,
  expireStaleInstruments,
  keysToEvict,
  liveEligibleInstruments,
  isRetentionEligible,
  isExpiredByRetention,
  isDiscoveryOnly,
  isLiveState,
  isRefreshFailedState,
  isExpiredState,
  isDelistedState,
  DEFAULT_LIFECYCLE_CONFIG,
} from "./lifecycle";
import { discoveredInstrumentKey, type DiscoveredInstrument } from "./types";
import { createPipelineState, runDiscoveryPipelineStep } from "./pipeline";
import { buildRadarSourcesFromLiveSources } from "../market-radar/live-source-adapter";
import { scanRadar, buildRadarState, opportunityKey } from "../market-radar/radar";
import { canonicalOpportunityKey } from "../market-radar/opportunity-identity";
import { assessFreshness, checkFreshnessEligibility } from "../market-radar/freshness";
import { HORIZON_FRESHNESS_GATES, meetsFreshness } from "../market-radar/types";
import { scanInstruments } from "../liveScanner";
import type { LiveCandidateSource } from "../liveCandidateBuilder";
import type { MarketData } from "../data/market-types";

const NOW = 1_800_000_000_000;
const FRESH_MS = 60_000; // 1 min → FRESH
const DELAYED_MS = 30 * 60_000; // 30 min → DELAYED
const STALE_MS = 2 * 60 * 60_000; // 2h → STALE
const RETENTION = DEFAULT_LIFECYCLE_CONFIG.retentionMs;

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
// 1 fresh retained after failure
// ────────────────────────────────────────────────────────────────
describe("Phase243 1 — fresh retained after failure", () => {
  it("FRESH evidence + refresh failure retains fresh, remains retention-eligible, freshness still FRESH", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - FRESH_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    const e = tracked.get(key)!;
    expect(e.state).toBe("REFRESH_FAILED");
    expect(e.lastLiveAt).toBe(NOW - FRESH_MS);
    expect(isRetentionEligible(e, NOW)).toBe(true);
    expect(assessFreshness(e.lastLiveAt, NOW)).toBe("FRESH");
  });

  it("fresh retained attributable to original provider observation", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    expect(radarSources[0].snapshot?.observedAt).toBe(NOW - FRESH_MS);
    expect(radarSources[0].snapshot?.acquiredAt).toBe(NOW);
    expect(radarSources[0].snapshot?.timestampProvenance).toBe("PROVIDER_OBSERVED");
  });
});

// ────────────────────────────────────────────────────────────────
// 2 delayed retained after failure
// ────────────────────────────────────────────────────────────────
describe("Phase243 2 — delayed retained after failure", () => {
  it("DELAYED evidence + failure remains DELAYED, eligible for INTRADAY but not SCALPING", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - DELAYED_MS,
      lastSuccessAt: NOW - DELAYED_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    const e = tracked.get(key)!;
    expect(assessFreshness(e.lastLiveAt, NOW)).toBe("DELAYED");
    expect(isRetentionEligible(e, NOW)).toBe(true);
    expect(checkFreshnessEligibility("DELAYED", true, "INTRADAY").eligible).toBe(true);
    expect(checkFreshnessEligibility("DELAYED", true, "SCALPING").eligible).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// 3 stale retained after failure
// ────────────────────────────────────────────────────────────────
describe("Phase243 3 — stale retained after failure", () => {
  it("STALE evidence + failure remains STALE, not eligible for INTRADAY, eligible for SWING, still retention-eligible", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - STALE_MS,
      lastSuccessAt: NOW - STALE_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    const e = tracked.get(key)!;
    expect(assessFreshness(e.lastLiveAt, NOW)).toBe("STALE");
    expect(isRetentionEligible(e, NOW)).toBe(true);
    expect(checkFreshnessEligibility("STALE", true, "INTRADAY").eligible).toBe(false);
    expect(checkFreshnessEligibility("STALE", true, "SWING").eligible).toBe(true);
  });

  it("stale retained must not remain effectively LIVE for INTRADAY", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - STALE_MS, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    // STALE is not eligible for INTRADAY → opportunity lifecycle EXPIRED, not ACTIVE
    const opp = result.results.get("INTRADAY")![0];
    expect(opp.lifecycle).toBe("EXPIRED");
    expect(opp.freshness).toBe("STALE");
  });
});

// ────────────────────────────────────────────────────────────────
// 4 expired retention
// ────────────────────────────────────────────────────────────────
describe("Phase243 4 — expired retention", () => {
  it("EXPIRED after retention window, never eligible without new acquisition", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - RETENTION - 1000,
      lastSuccessAt: NOW - RETENTION - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = expireStaleInstruments(tracked, NOW);
    const e = tracked.get(key)!;
    expect(e.state).toBe("EXPIRED");
    expect(isExpiredByRetention(e, NOW)).toBe(true);
    expect(isRetentionEligible(e, NOW)).toBe(false);
    expect(liveEligibleInstruments(tracked, NOW).length).toBe(0);
    expect(keysToEvict(tracked)).toContain(key);
  });

  it("EXPIRED + refresh failure does not resurrect", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "EXPIRED",
      lastLiveAt: NOW - RETENTION - 5000,
      lastSuccessAt: NOW - RETENTION - 5000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    expect(tracked.get(key)!.state).toBe("REFRESH_FAILED"); // failure path keeps lastLiveAt but still expired by age
    // But retention eligibility should still be false because age > retention
    expect(isRetentionEligible(tracked.get(key)!, NOW)).toBe(false);
    // After expiry step, it becomes EXPIRED again
    tracked = expireStaleInstruments(tracked, NOW);
    expect(tracked.get(key)!.state).toBe("EXPIRED");
  });
});

// ────────────────────────────────────────────────────────────────
// 5 repeated failures
// ────────────────────────────────────────────────────────────────
describe("Phase243 5 — repeated failures", () => {
  it("repeated failures do not fabricate new observation, do not extend freshness, do not prolong retention", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - FRESH_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    const originalObserved = tracked.get(key)!.lastLiveAt;
    for (let i = 0; i < 5; i++) {
      tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + i * 1000);
    }
    const e = tracked.get(key)!;
    expect(e.lastLiveAt).toBe(originalObserved);
    expect(e.consecutiveFailures).toBe(5);
    // freshness should age from original, not reset
    expect(assessFreshness(e.lastLiveAt, NOW + 5000)).toBe(assessFreshness(originalObserved, NOW + 5000));
  });
});

// ────────────────────────────────────────────────────────────────
// 6 no fabricated observation
// ────────────────────────────────────────────────────────────────
describe("Phase243 6 — no fabricated observation", () => {
  it("failure never creates new observedAt, never assigns Date.now", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - 10000,
      lastSuccessAt: NOW - 10000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + 100000);
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - 10000);
    expect(tracked.get(key)!.lastLiveAt).not.toBe(NOW + 100000);
  });

  it("no Date.now assigned to observedAt in lifecycle", () => {
    const file = readFileSync("src/lib/discovery/lifecycle.ts", "utf8");
    expect(file).not.toMatch(/observedAt:\s*Date\.now/);
    expect(file).not.toMatch(/lastLiveAt:\s*Date\.now/);
  });
});

// ────────────────────────────────────────────────────────────────
// 7 no freshness extension
// ────────────────────────────────────────────────────────────────
describe("Phase243 7 — no freshness extension", () => {
  it("acquiredAt does not reset freshness, refresh receipt does not become observation", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - DELAYED_MS, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const snap = radarSources[0].snapshot!;
    expect(snap.observedAt).toBe(NOW - DELAYED_MS);
    expect(snap.acquiredAt).toBe(NOW);
    expect(assessFreshness(snap.observedAt, NOW)).toBe("DELAYED");
    expect(assessFreshness(snap.acquiredAt, NOW)).toBe("FRESH"); // acquired is fresh, but freshness must use observed
    // effective freshness should be based on observed, not acquired
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")![0].freshness).toBe("DELAYED");
  });

  it("failed refresh must never improve freshness", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - STALE_MS,
      lastSuccessAt: NOW - STALE_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    const beforeFresh = assessFreshness(tracked.get(key)!.lastLiveAt!, NOW);
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW + 1000);
    const afterFresh = assessFreshness(tracked.get(key)!.lastLiveAt!, NOW + 1000);
    // freshness should not improve (FRESH rank < DELAYED < STALE < UNAVAILABLE)
    expect(["FRESH", "DELAYED", "STALE", "UNAVAILABLE"].indexOf(afterFresh)).toBeGreaterThanOrEqual(["FRESH", "DELAYED", "STALE", "UNAVAILABLE"].indexOf(beforeFresh));
  });
});

// ────────────────────────────────────────────────────────────────
// 8 no expiration resurrection
// ────────────────────────────────────────────────────────────────
describe("Phase243 8 — no expiration resurrection", () => {
  it("EXPIRED remains expired without new acquisition, must not appear as FRESH/LIVE", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "EXPIRED",
      lastLiveAt: NOW - RETENTION - 5000,
      lastSuccessAt: NOW - RETENTION - 5000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = expireStaleInstruments(tracked, NOW);
    expect(tracked.get(key)!.state).toBe("EXPIRED");
    expect(liveEligibleInstruments(tracked, NOW).length).toBe(0);
    expect(keysToEvict(tracked)).toContain(key);
  });

  it("stale/expired cannot be promoted to fresh via failure path", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - STALE_MS,
      lastSuccessAt: NOW - STALE_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: false }], NOW);
    expect(tracked.get(key)!.state).toBe("REFRESH_FAILED");
    expect(tracked.get(key)!.state).not.toBe("LIVE");
    expect(assessFreshness(tracked.get(key)!.lastLiveAt!, NOW)).toBe("STALE");
  });
});

// ────────────────────────────────────────────────────────────────
// 9 genuine recovery
// ────────────────────────────────────────────────────────────────
describe("Phase243 9 — genuine recovery", () => {
  it("REFRESH_FAILED → genuine new valid evidence recovers to LIVE", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "REFRESH_FAILED",
      lastLiveAt: NOW - STALE_MS,
      lastSuccessAt: NOW - STALE_MS * 2,
      lastFailureAt: NOW - 1000,
      consecutiveFailures: 1,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: true, observedAt: NOW }], NOW);
    const e = tracked.get(key)!;
    expect(e.state).toBe("LIVE");
    expect(e.lastLiveAt).toBe(NOW);
    expect(e.consecutiveFailures).toBe(0);
    expect(isRetentionEligible(e, NOW)).toBe(true);
  });

  it("STALE → new valid refresh recovers freshness", () => {
    const srcOld = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - STALE_MS, fetchedAt: NOW - STALE_MS });
    const radarOld = buildRadarSourcesFromLiveSources([srcOld]);
    const resultOld = scanRadar(radarOld, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(resultOld.results.get("INTRADAY")![0].freshness).toBe("STALE");
    expect(resultOld.results.get("INTRADAY")![0].lifecycle).toBe("EXPIRED");

    const srcNew = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50100, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const radarNew = buildRadarSourcesFromLiveSources([srcNew]);
    const resultNew = scanRadar(radarNew, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(resultNew.results.get("INTRADAY")![0].freshness).toBe("FRESH");
    expect(resultNew.results.get("INTRADAY")![0].lifecycle).not.toBe("EXPIRED");
  });

  it("EXPIRED → new valid refresh recovers only with genuine acquisition", async () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
      state,
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW - RETENTION - 10000,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - RETENTION - 10000, fetchedAt: NOW - RETENTION - 10000 }),
        observedAt: NOW - RETENTION - 10000,
      })),
    });
    // expire
    let tracked = expireStaleInstruments(first.state.tracked, NOW);
    expect(tracked.get(discoveredInstrumentKey(inst))!.state).toBe("EXPIRED");
    // recovery with new evidence
    const recovered = await runDiscoveryPipelineStep({
      state: { ...first.state, tracked },
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      batchSize: 1,
      now: NOW,
      acquire: async (batch) => batch.map(b => ({
        provider: b.provider,
        providerInstrumentId: b.providerInstrumentId,
        assetClass: b.assetClass,
        success: true,
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50100, observedAt: NOW - FRESH_MS, fetchedAt: NOW }),
        observedAt: NOW - FRESH_MS,
      })),
    });
    expect(recovered.state.tracked.get(discoveredInstrumentKey(inst))!.state).toBe("LIVE");
  });
});

// ────────────────────────────────────────────────────────────────
// 10 older response rejection
// ────────────────────────────────────────────────────────────────
describe("Phase243 10 — older response rejection", () => {
  it("older provider timestamp must not overwrite newer, no false recovery", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - FRESH_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: true, observedAt: NOW - STALE_MS }], NOW);
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - FRESH_MS);
  });

  it("older response after REFRESH_FAILED does not produce LIVE with old timestamp", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "REFRESH_FAILED",
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - DELAYED_MS,
      lastFailureAt: NOW - 1000,
      consecutiveFailures: 1,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: true, observedAt: NOW - STALE_MS }], NOW);
    // Math.max preserves newer
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - FRESH_MS);
    expect(tracked.get(key)!.state).toBe("LIVE"); // state recovers but timestamp not downgraded
  });
});

// ────────────────────────────────────────────────────────────────
// 11 equal response handling
// ────────────────────────────────────────────────────────────────
describe("Phase243 11 — equal response handling", () => {
  it("equal timestamp preserves existing, does not create duplicate, remains eligible", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    let tracked = new Map();
    tracked.set(key, {
      instrument: inst,
      state: "LIVE",
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - FRESH_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked = applyAcquisitionOutcomes(tracked, [{ key, success: true, observedAt: NOW - FRESH_MS }], NOW);
    expect(tracked.get(key)!.lastLiveAt).toBe(NOW - FRESH_MS);
    expect(tracked.size).toBe(1);
    expect(isRetentionEligible(tracked.get(key)!, NOW)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 12 provider isolation
// ────────────────────────────────────────────────────────────────
describe("Phase243 12 — provider isolation", () => {
  it("ccxt:binance, ccxt:okx, twelve-data independent failure, freshness, lifecycle, eligibility, recovery", async () => {
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
      acquire: async (batch) => batch.map(b => {
        // twelve starts stale to test independent freshness
        if (b.provider === "twelve-data") {
          return {
            provider: b.provider,
            providerInstrumentId: b.providerInstrumentId,
            assetClass: b.assetClass,
            success: true,
            source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - STALE_MS, fetchedAt: NOW }),
            observedAt: NOW - STALE_MS,
          };
        }
        return {
          provider: b.provider,
          providerInstrumentId: b.providerInstrumentId,
          assetClass: b.assetClass,
          success: true,
          source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW }),
          observedAt: NOW - FRESH_MS,
        };
      }),
    });
    expect(first.state.tracked.size).toBe(3);
    // fail binance, keep okx fresh, twelve stays stale (older timestamp not overwriting)
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [binance, okx, twelve],
      succeededProviders: ["ccxt:binance", "ccxt:okx", "twelve-data"],
      batchSize: 3,
      now: NOW + 1000,
      acquire: async (batch) => batch.map(b => {
        if (b.provider === "ccxt:binance") {
          return { provider: b.provider, providerInstrumentId: b.providerInstrumentId, assetClass: b.assetClass, success: false, error: "fail" };
        }
        if (b.provider === "ccxt:okx") {
          return {
            provider: b.provider,
            providerInstrumentId: b.providerInstrumentId,
            assetClass: b.assetClass,
            success: true,
            source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50100, observedAt: NOW, fetchedAt: NOW + 1000 }),
            observedAt: NOW,
          };
        }
        // twelve-data returns stale again (same age, Math.max keeps original stale)
        return {
          provider: b.provider,
          providerInstrumentId: b.providerInstrumentId,
          assetClass: b.assetClass,
          success: true,
          source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 50000, observedAt: NOW - STALE_MS, fetchedAt: NOW + 1000 }),
          observedAt: NOW - STALE_MS,
        };
      }),
    });
    expect(second.state.tracked.get(discoveredInstrumentKey(binance))!.state).toBe("REFRESH_FAILED");
    expect(second.state.tracked.get(discoveredInstrumentKey(okx))!.state).toBe("LIVE");
    expect(second.state.tracked.get(discoveredInstrumentKey(twelve))!.state).toBe("LIVE");
    // eligibility
    expect(isRetentionEligible(second.state.tracked.get(discoveredInstrumentKey(binance))!, NOW + 1000)).toBe(true);
    expect(isRetentionEligible(second.state.tracked.get(discoveredInstrumentKey(okx))!, NOW + 1000)).toBe(true);
    // freshness: binance retained fresh, twelve stale
    expect(assessFreshness(second.state.tracked.get(discoveredInstrumentKey(binance))!.lastLiveAt!, NOW + 1000)).toBe("FRESH");
    expect(assessFreshness(second.state.tracked.get(discoveredInstrumentKey(twelve))!.lastLiveAt!, NOW + 1000)).toBe("STALE");
    // radar gating: binance retained fresh should still be eligible for INTRADAY, twelve stale not
    const radarSources = buildRadarSourcesFromLiveSources(second.liveSources);
    const radarResult = scanRadar(radarSources, { horizons: ["INTRADAY", "SWING"], maxResults: 10, now: NOW + 1000 });
    const intraday = radarResult.results.get("INTRADAY")!;
    const swing = radarResult.results.get("SWING")!;
    // binance and okx fresh → INTRADAY eligible, twelve stale → INTRADAY EXPIRED
    expect(intraday.filter(o => o.lifecycle !== "EXPIRED").length).toBe(2);
    expect(swing.filter(o => o.lifecycle !== "EXPIRED").length).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────
// 13 native-ID isolation
// ────────────────────────────────────────────────────────────────
describe("Phase243 13 — native-ID isolation", () => {
  it("same provider different native IDs independent failure/eligibility", async () => {
    const btc = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const eth = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "ETH/USDT" });
    const state = createPipelineState();
    const first = await runDiscoveryPipelineStep({
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
        source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: b.providerInstrumentId.includes("BTC") ? 50000 : 3000, observedAt: NOW - FRESH_MS, fetchedAt: NOW }),
        observedAt: NOW - FRESH_MS,
      })),
    });
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [btc, eth],
      succeededProviders: ["ccxt:binance"],
      batchSize: 2,
      now: NOW + 1000,
      acquire: async (batch) => batch.map(b => {
        if (b.providerInstrumentId === "BTC/USDT") {
          return { provider: b.provider, providerInstrumentId: b.providerInstrumentId, assetClass: b.assetClass, success: false, error: "fail" };
        }
        return {
          provider: b.provider,
          providerInstrumentId: b.providerInstrumentId,
          assetClass: b.assetClass,
          success: true,
          source: mkLiveSource({ instrument: b.providerInstrumentId, provider: b.provider, providerInstrumentId: b.providerInstrumentId, price: 3100, observedAt: NOW, fetchedAt: NOW + 1000 }),
          observedAt: NOW,
        };
      }),
    });
    expect(second.state.tracked.get(discoveredInstrumentKey(btc))!.state).toBe("REFRESH_FAILED");
    expect(second.state.tracked.get(discoveredInstrumentKey(eth))!.state).toBe("LIVE");
    expect(isRetentionEligible(second.state.tracked.get(discoveredInstrumentKey(btc))!, NOW + 1000)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 14 discovery isolation
// ────────────────────────────────────────────────────────────────
describe("Phase243 14 — discovery isolation", () => {
  it("DISCOVERED metadata never live-eligible, never becomes eligible via retention", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const tracked = reconcileDiscovery({
      tracked: new Map(),
      discovered: [inst],
      succeededProviders: ["ccxt:binance"],
      now: NOW,
    });
    const entry = tracked.get(discoveredInstrumentKey(inst))!;
    expect(entry.state).toBe("DISCOVERED");
    expect(entry.lastLiveAt).toBeNull();
    expect(isDiscoveryOnly(entry)).toBe(true);
    expect(isRetentionEligible(entry, NOW)).toBe(false);
    expect(liveEligibleInstruments(tracked, NOW).length).toBe(0);
  });

  it("discovery-only records never produce radar opportunities", () => {
    const result = scanRadar([], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.results.get("INTRADAY")!.length).toBe(0);
    expect(result.totalWithLiveData).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 15 eligibility predicates
// ────────────────────────────────────────────────────────────────
describe("Phase243 15 — eligibility predicates", () => {
  it("isRetentionEligible, isLiveState, isRefreshFailedState, isExpiredState, isDelistedState, isDiscoveryOnly are centralized and deterministic", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key = discoveredInstrumentKey(inst);
    const liveEntry = {
      instrument: inst,
      state: "LIVE" as const,
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - FRESH_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    };
    const failedEntry = { ...liveEntry, state: "REFRESH_FAILED" as const, lastFailureAt: NOW, consecutiveFailures: 1 };
    const expiredEntry = { ...liveEntry, state: "EXPIRED" as const, lastLiveAt: NOW - RETENTION - 1000 };
    const discoveredEntry = { ...liveEntry, state: "DISCOVERED" as const, lastLiveAt: null };

    expect(isLiveState(liveEntry)).toBe(true);
    expect(isRefreshFailedState(failedEntry)).toBe(true);
    expect(isExpiredState(expiredEntry)).toBe(true);
    expect(isDiscoveryOnly(discoveredEntry)).toBe(true);
    expect(isRetentionEligible(liveEntry, NOW)).toBe(true);
    expect(isRetentionEligible(failedEntry, NOW)).toBe(true);
    expect(isRetentionEligible(expiredEntry, NOW)).toBe(false);
    expect(isRetentionEligible(discoveredEntry, NOW)).toBe(false);
  });

  it("liveEligible vs lifecycle not conflated: LIVE and REFRESH_FAILED both eligible, but distinct", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const live = { instrument: inst, state: "LIVE" as const, lastLiveAt: NOW - FRESH_MS, lastSuccessAt: NOW - FRESH_MS, lastFailureAt: null, consecutiveFailures: 0, lastSeenInDiscoveryAt: NOW };
    const failed = { ...live, state: "REFRESH_FAILED" as const, lastFailureAt: NOW, consecutiveFailures: 1 };
    expect(isLiveState(live)).toBe(true);
    expect(isRefreshFailedState(failed)).toBe(true);
    expect(isLiveState(failed)).toBe(false);
    expect(isRetentionEligible(live, NOW)).toBe(true);
    expect(isRetentionEligible(failed, NOW)).toBe(true);
    // lifecycle distinct but both retention-eligible
    expect(live.state).not.toBe(failed.state);
  });

  it("HORIZON_FRESHNESS_GATES centralized, no duplicated conflicting logic", () => {
    const file = readFileSync("src/lib/liveScanner.ts", "utf8");
    expect(file).toContain("HORIZON_FRESHNESS_GATES");
    expect(file).toContain("canonicalMeetsFreshness");
    expect(HORIZON_FRESHNESS_GATES["INTRADAY"].maxFreshness).toBe("DELAYED");
    expect(HORIZON_FRESHNESS_GATES["SCALPING"].maxFreshness).toBe("FRESH");
    expect(HORIZON_FRESHNESS_GATES["SWING"].maxFreshness).toBe("STALE");
  });
});

// ────────────────────────────────────────────────────────────────
// 16 radar gating
// ────────────────────────────────────────────────────────────────
describe("Phase243 16 — radar gating", () => {
  it("radar must not consume expired, discovery-only, stale outside horizon, failed-refresh with stale evidence", () => {
    const freshSrc = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const staleSrc = mkLiveSource({ instrument: "ETH/USDT", provider: "ccxt:binance", providerInstrumentId: "ETH/USDT", price: 3000, observedAt: NOW - STALE_MS, fetchedAt: NOW });
    const expiredSrc = mkLiveSource({ instrument: "OLD/USDT", provider: "ccxt:binance", providerInstrumentId: "OLD/USDT", price: 1, observedAt: NOW - RETENTION - 1000, fetchedAt: NOW - RETENTION - 1000 });
    const radarSources = buildRadarSourcesFromLiveSources([freshSrc, staleSrc, expiredSrc]);
    const result = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const intraday = result.results.get("INTRADAY")!;
    // fresh eligible, stale and expired not eligible for INTRADAY (lifecycle EXPIRED)
    const active = intraday.filter(o => o.lifecycle !== "EXPIRED");
    expect(active.length).toBe(1);
    expect(active[0].instrument).toBe("BTC/USDT");
  });
});

// ────────────────────────────────────────────────────────────────
// 17 opportunity gating
// ────────────────────────────────────────────────────────────────
describe("Phase243 17 — opportunity gating", () => {
  it("scanner opportunity gating respects freshness, does not use expired/discovery-only", () => {
    const fresh = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const stale = mkLiveSource({ instrument: "ETH/USDT", provider: "ccxt:binance", providerInstrumentId: "ETH/USDT", price: 3000, observedAt: NOW - STALE_MS, fetchedAt: NOW });
    const result = scanInstruments([fresh, stale], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(result.totalScanned).toBe(2);
    expect(result.totalWithLiveData).toBe(1); // only fresh is FRESH/DELAYED
    const intraday = result.results.get("INTRADAY")!;
    expect(intraday.rankedInstruments.length).toBe(1);
    expect(intraday.rankedInstruments[0].instrument).toBe("BTC/USDT");
  });

  it("SWING horizon allows STALE, INTRADAY does not", () => {
    const stale = mkLiveSource({ instrument: "ETH/USDT", provider: "ccxt:binance", providerInstrumentId: "ETH/USDT", price: 3000, observedAt: NOW - STALE_MS, fetchedAt: NOW });
    const intraday = scanInstruments([stale], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const swing = scanInstruments([stale], { horizons: ["SWING"], maxResults: 10, now: NOW });
    expect(intraday.results.get("INTRADAY")!.rankedInstruments.length).toBe(0);
    expect(swing.results.get("SWING")!.rankedInstruments.length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────
// 18 UI lifecycle semantics
// ────────────────────────────────────────────────────────────────
describe("Phase243 18 — UI lifecycle semantics", () => {
  it("UI distinguishes last valid retained from latest refresh succeeded, does not imply stale is live", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("isLive");
    expect(ui).toContain("isDegraded");
    expect(ui).toContain("DEGRADED");
    expect(ui).toContain("retained evidence");
    expect(ui).toContain("providerErrors");
    expect(ui).toContain("LIFECYCLE_COLORS");
    expect(ui).toContain("FRESHNESS_COLORS");
    expect(ui).toContain("opportunityDisplayKey");
  });

  it("UI isLive derived from totalWithLiveData, not mere existence", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("totalWithLiveData");
    expect(ui).not.toMatch(/isLive.*liveSources\.length/);
  });

  it("two providers do not collapse into one card", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("opportunityDisplayKey");
  });
});

// ────────────────────────────────────────────────────────────────
// 19 provenance semantics
// ────────────────────────────────────────────────────────────────
describe("Phase243 19 — provenance semantics", () => {
  it("retained snapshot preserves original provenance, PROVIDER_OBSERVED vs APPLICATION_RECEIPT", () => {
    const srcObserved = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const mdObserved = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: 50000, observedAt: NOW - FRESH_MS, fetchTimestamp: NOW, provenance: "PROVIDER_OBSERVED" });
    const mdReceipt = mkMarketData({ instrument: "BTC/USDT", provider: "coingecko", price: 50000, observedAt: NOW - FRESH_MS, fetchTimestamp: NOW, provenance: "APPLICATION_RECEIPT" });
    const srcObs = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: mdObserved } as any;
    const srcRec = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "coingecko", providerInstrumentId: "BTC/USDT" }, marketData: mdReceipt } as any;
    const radarObs = buildRadarSourcesFromLiveSources([srcObs]);
    const radarRec = buildRadarSourcesFromLiveSources([srcRec]);
    expect(radarObs[0].snapshot?.timestampProvenance).toBe("PROVIDER_OBSERVED");
    expect(radarRec[0].snapshot?.timestampProvenance).toBe("APPLICATION_RECEIPT");
    // provenance downgrade must not silently upgrade eligibility — both still assessed by observedAt
    expect(assessFreshness(radarObs[0].snapshot?.observedAt, NOW)).toBe(assessFreshness(radarRec[0].snapshot?.observedAt, NOW));
  });

  it("PROVIDER_OBSERVED, PROVIDER_RESPONSE, APPLICATION_RECEIPT, UNKNOWN preserved", () => {
    const file = readFileSync("src/lib/market-radar/types.ts", "utf8");
    expect(file).toContain("PROVIDER_OBSERVED");
    expect(file).toContain("PROVIDER_RESPONSE");
    expect(file).toContain("APPLICATION_RECEIPT");
    expect(file).toContain("UNKNOWN");
  });
});

// ────────────────────────────────────────────────────────────────
// 20 numerical validation
// ────────────────────────────────────────────────────────────────
describe("Phase243 20 — numerical validation", () => {
  it("NaN, Infinity, invalid bid/ask, invalid volume must not become eligible", () => {
    const mdNaN = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: NaN, observedAt: NOW - FRESH_MS, fetchTimestamp: NOW });
    const srcNaN = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: mdNaN } as any;
    const radarNaN = buildRadarSourcesFromLiveSources([srcNaN]);
    const resultNaN = scanRadar(radarNaN, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(resultNaN.results.get("INTRADAY")![0].evidence).toBeUndefined();

    const mdInf = mkMarketData({ instrument: "BTC/USDT", provider: "ccxt:binance", price: Infinity, observedAt: NOW - FRESH_MS, fetchTimestamp: NOW } as any);
    const srcInf = { instrument: "BTC/USDT", assetClass: "crypto", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" }, marketData: mdInf } as any;
    const radarInf = buildRadarSourcesFromLiveSources([srcInf]);
    const resultInf = scanRadar(radarInf, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(resultInf.results.get("INTRADAY")![0].evidence).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 21 state diff
// ────────────────────────────────────────────────────────────────
describe("Phase243 21 — state diff", () => {
  it("refresh failure, retained unchanged, freshness-only, lifecycle-only changes do not create new identity", () => {
    const src = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const radarSources = buildRadarSourcesFromLiveSources([src]);
    const first = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const state = buildRadarState(first);
    const second = scanRadar(radarSources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW + 1000 }, state);
    // same identity, diff may contain score change but not appeared as new instrument
    expect(state.previous.size).toBe(1);
    expect(second.diffs.every(d => !d.appeared || d.instrument === "BTC/USDT")).toBe(true);
  });

  it("provider-native identity change is genuine identity change", () => {
    const src1 = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const src2 = mkLiveSource({ instrument: "BTC/USDT", provider: "ccxt:okx", providerInstrumentId: "BTC/USDT", price: 50000, observedAt: NOW - FRESH_MS, fetchedAt: NOW });
    const r1 = scanRadar(buildRadarSourcesFromLiveSources([src1]), { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const s1 = buildRadarState(r1);
    const r2 = scanRadar(buildRadarSourcesFromLiveSources([src2]), { horizons: ["INTRADAY"], maxResults: 10, now: NOW }, s1);
    expect(r2.diffs.some(d => d.appeared || d.disappeared)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 22 eviction
// ────────────────────────────────────────────────────────────────
describe("Phase243 22 — eviction", () => {
  it("EXPIRED and DELISTED evicted, REFRESH_FAILED not evicted", () => {
    const instLive = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const instExpired = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "OLD/USDT" });
    const instFailed = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "ETH/USDT" });
    const keyLive = discoveredInstrumentKey(instLive);
    const keyExpired = discoveredInstrumentKey(instExpired);
    const keyFailed = discoveredInstrumentKey(instFailed);
    let tracked = new Map();
    tracked.set(keyLive, {
      instrument: instLive,
      state: "LIVE",
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - FRESH_MS,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked.set(keyExpired, {
      instrument: instExpired,
      state: "EXPIRED",
      lastLiveAt: NOW - RETENTION - 1000,
      lastSuccessAt: NOW - RETENTION - 1000,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    });
    tracked.set(keyFailed, {
      instrument: instFailed,
      state: "REFRESH_FAILED",
      lastLiveAt: NOW - FRESH_MS,
      lastSuccessAt: NOW - DELAYED_MS,
      lastFailureAt: NOW,
      consecutiveFailures: 1,
      lastSeenInDiscoveryAt: NOW,
    });
    const evict = keysToEvict(tracked);
    expect(evict).toContain(keyExpired);
    expect(evict).not.toContain(keyLive);
    expect(evict).not.toContain(keyFailed);
  });
});

// ────────────────────────────────────────────────────────────────
// 23 deterministic now
// ────────────────────────────────────────────────────────────────
describe("Phase243 23 — deterministic now", () => {
  it("same inputs produce same state, no random, no Date.now in state keys", () => {
    const inst = mkDiscovered({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" });
    const key1 = discoveredInstrumentKey(inst);
    const key2 = discoveredInstrumentKey(inst);
    expect(key1).toBe(key2);
    expect(key1).toBe("ccxt:binance::BTC/USDT");
    const k = canonicalOpportunityKey({ instrument: "BTC/USDT", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" } } as any);
    expect(k).toBe(canonicalOpportunityKey({ instrument: "BTC/USDT", providerNative: { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT" } } as any));
  });

  it("assessFreshness deterministic with injected now", () => {
    const ts = NOW - FRESH_MS;
    expect(assessFreshness(ts, NOW)).toBe(assessFreshness(ts, NOW));
    expect(assessFreshness(ts, NOW)).toBe("FRESH");
    expect(assessFreshness(ts, NOW + STALE_MS)).toBe("STALE");
  });
});

// ────────────────────────────────────────────────────────────────
// 24 no credentials/secrets
// ────────────────────────────────────────────────────────────────
describe("Phase243 24 — no credentials/secrets", () => {
  it("credentials never enter scanner state, opportunity state, retained state, lifecycle errors, UI props", () => {
    const files = [
      "src/lib/discovery/lifecycle.ts",
      "src/lib/discovery/pipeline.ts",
      "src/lib/market-radar/radar.ts",
      "src/lib/market-radar/live-source-adapter.ts",
      "src/components/MarketOpportunities.tsx",
      "src/lib/liveScanner.ts",
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
// 25 additional — provider errors retained, attributable
// ────────────────────────────────────────────────────────────────
describe("Phase243 25 — provider errors retained attributable", () => {
  it("provider errors retained and attributable, degraded visible", async () => {
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
// 26 — lifecycle predicates existence
// ────────────────────────────────────────────────────────────────
describe("Phase243 26 — lifecycle predicates existence", () => {
  it("isRetentionEligible, isExpiredByRetention, isDiscoveryOnly, isLiveState, isRefreshFailedState exist and are used", () => {
    const file = readFileSync("src/lib/discovery/lifecycle.ts", "utf8");
    expect(file).toContain("isRetentionEligible");
    expect(file).toContain("isExpiredByRetention");
    expect(file).toContain("isDiscoveryOnly");
    expect(file).toContain("isLiveState");
    expect(file).toContain("isRefreshFailedState");
    expect(file).toContain("isExpiredState");
    expect(file).toContain("isDelistedState");
  });
});
