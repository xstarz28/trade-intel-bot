/**
 * Phase 158 — Discovery → Acquisition → Scanner Pipeline
 *
 * End-to-end invariants for the runtime path that replaces the
 * hardcoded-symbol scanning flow.
 */

import { describe, expect, it } from "vitest";
import {
  createPipelineState,
  runDiscoveryPipelineStep,
  type NativeAcquisitionResult,
} from "./pipeline";
import { discoveredInstrumentKey, type DiscoveredInstrument } from "./types";
import { DEFAULT_LIFECYCLE_CONFIG } from "./lifecycle";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";

const NOW = 1_800_000_000_000;

function makeInstrument(
  providerInstrumentId: string,
  overrides: Partial<DiscoveredInstrument> = {},
): DiscoveredInstrument {
  return {
    provider: "okx",
    providerInstrumentId,
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: providerInstrumentId.split("-")[0] ?? "BTC",
    quoteAsset: "USDT",
    tradingState: "TRADING",
    capabilities: ["ohlcv"],
    discoveredAt: NOW,
    ...overrides,
  };
}

function makeSource(
  instrument: DiscoveredInstrument,
  observedAt: number,
): LiveCandidateSource {
  return {
    instrument: instrument.providerInstrumentId,
    assetClass: instrument.assetClass,
    providerNative: {
      provider: instrument.provider,
      providerInstrumentId: instrument.providerInstrumentId,
    },
    marketData: {
      instrument: instrument.providerInstrumentId,
      instrumentType: "crypto",
      provider: instrument.provider,
      fetchTimestamp: observedAt,
      price: { price: 100, timestamp: observedAt, source: instrument.provider },
      candles: [
        { timestamp: observedAt, open: 99, high: 101, low: 98, close: 100, volume: 5 },
      ],
      timeframe: "1h",
      dataFreshness: "realtime",
    },
  };
}

/** Acquisition that succeeds for every instrument in the batch. */
function acquireAll(observedAt: number) {
  return async (batch: readonly DiscoveredInstrument[]): Promise<NativeAcquisitionResult[]> =>
    batch.map((instrument) => ({
      provider: instrument.provider,
      providerInstrumentId: instrument.providerInstrumentId,
      assetClass: instrument.assetClass,
      success: true,
      source: makeSource(instrument, observedAt),
      observedAt,
    }));
}

/** Acquisition that fails for every instrument in the batch. */
const acquireNone = async (
  batch: readonly DiscoveredInstrument[],
): Promise<NativeAcquisitionResult[]> =>
  batch.map((instrument) => ({
    provider: instrument.provider,
    providerInstrumentId: instrument.providerInstrumentId,
    assetClass: instrument.assetClass,
    success: false,
  }));

describe("Phase 158 — discovery pipeline", () => {
  it("turns discovery into live sources only after successful acquisition", async () => {
    const instruments = [makeInstrument("BTC-USDT"), makeInstrument("ETH-USDT")];

    const result = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: instruments,
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    expect(result.acquired).toBe(2);
    expect(result.liveSources).toHaveLength(2);
    expect(result.liveSources.map((s) => s.instrument).sort()).toEqual([
      "BTC-USDT",
      "ETH-USDT",
    ]);
  });

  it("produces no live sources when acquisition fails", async () => {
    const result = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [makeInstrument("BTC-USDT")],
      succeededProviders: ["okx"],
      acquire: acquireNone,
      batchSize: 10,
      now: NOW,
    });

    expect(result.acquired).toBe(0);
    expect(result.liveSources).toEqual([]);
  });

  it("a later failed acquisition never removes an existing live source", async () => {
    const instrument = makeInstrument("BTC-USDT");

    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });
    expect(first.liveSources).toHaveLength(1);

    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: acquireNone,
      batchSize: 10,
      now: NOW + 60_000,
    });

    expect(second.acquired).toBe(0);
    expect(second.liveSources).toHaveLength(1);
    expect(second.evicted).toEqual([]);
  });

  it("a total acquisition throw never destroys retained live sources", async () => {
    const instrument = makeInstrument("BTC-USDT");

    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: async () => {
        throw new Error("provider outage");
      },
      batchSize: 10,
      now: NOW + 60_000,
    });

    expect(second.liveSources).toHaveLength(1);
  });

  it("a discovery failure never drops existing live sources", async () => {
    const instrument = makeInstrument("BTC-USDT");

    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    // Discovery failed: no instruments, no succeeded providers.
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [],
      succeededProviders: [],
      acquire: acquireNone,
      batchSize: 10,
      now: NOW + 60_000,
    });

    expect(second.liveSources).toHaveLength(1);
    expect(second.evicted).toEqual([]);
  });

  it("drops a live source once a successful discovery delists it", async () => {
    const instrument = makeInstrument("OLD-USDT");
    const key = discoveredInstrumentKey(instrument);

    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [],
      succeededProviders: ["okx"],
      acquire: acquireNone,
      batchSize: 10,
      now: NOW + 60_000,
    });

    expect(second.evicted).toEqual([key]);
    expect(second.liveSources).toEqual([]);
  });

  it("drops a live source once its data ages past retention", async () => {
    const instrument = makeInstrument("BTC-USDT");

    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    const later = NOW + DEFAULT_LIFECYCLE_CONFIG.retentionMs + 1;
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [instrument],
      succeededProviders: ["okx"],
      acquire: acquireNone,
      batchSize: 10,
      now: later,
    });

    expect(second.liveSources).toEqual([]);
    expect(second.evicted).toHaveLength(1);
  });

  it("rotates acquisition across the universe without a permanent ceiling", async () => {
    const instruments = Array.from({ length: 10 }, (_, i) =>
      makeInstrument(`T${i}-USDT`),
    );

    let state = createPipelineState();
    const seen = new Set<string>();

    // Batch of 3 per cycle; after 4 cycles every instrument must be reached.
    for (let cycle = 0; cycle < 4; cycle++) {
      const step = await runDiscoveryPipelineStep({
        state,
        discovered: instruments,
        succeededProviders: ["okx"],
        acquire: async (batch) => {
          for (const instrument of batch) seen.add(instrument.providerInstrumentId);
          return acquireAll(NOW)(batch);
        },
        batchSize: 3,
        now: NOW,
      });
      state = step.state;
    }

    expect(seen.size).toBe(10);
  });

  it("never acquires a non-trading instrument", async () => {
    const attempted: string[] = [];

    await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [
        makeInstrument("LIVE-USDT", { tradingState: "TRADING" }),
        makeInstrument("HALT-USDT", { tradingState: "SUSPENDED" }),
        makeInstrument("SOON-USDT", { tradingState: "PRE_LAUNCH" }),
      ],
      succeededProviders: ["okx"],
      acquire: async (batch) => {
        for (const instrument of batch) attempted.push(instrument.providerInstrumentId);
        return acquireAll(NOW)(batch);
      },
      batchSize: 10,
      now: NOW,
    });

    expect(attempted).toEqual(["LIVE-USDT"]);
  });

  it("preserves exact provider-native ids end to end", async () => {
    const native = "BTC-USDT-240927";

    const result = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [makeInstrument(native, { subType: "crypto_futures" })],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    expect(result.liveSources[0].instrument).toBe(native);
    expect(result.liveSources[0].providerNative?.providerInstrumentId).toBe(native);
  });

  it("keeps two providers' identical symbols as separate live sources", async () => {
    const result = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [
        makeInstrument("BTC-USDT", { provider: "okx" }),
        makeInstrument("BTC-USDT", { provider: "other" }),
      ],
      succeededProviders: ["okx", "other"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    expect(result.liveSources).toHaveLength(2);
  });

  it("adds newly listed instruments while retaining existing ones", async () => {
    const existing = makeInstrument("BTC-USDT");

    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [existing],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW),
      batchSize: 10,
      now: NOW,
    });

    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [existing, makeInstrument("BRANDNEW-USDT")],
      succeededProviders: ["okx"],
      acquire: acquireAll(NOW + 1000),
      batchSize: 10,
      now: NOW + 1000,
    });

    expect(second.liveSources).toHaveLength(2);
    expect(second.liveSources.map((s) => s.instrument).sort()).toEqual([
      "BRANDNEW-USDT",
      "BTC-USDT",
    ]);
  });
});
