/**
 * Phase 165 — Consolidated safety invariants.
 *
 * One executable specification for the guarantees the product must never
 * lose, covering the full chain:
 *
 *   discovery → native acquisition → verified live source → scanner
 *   → recommendation → radar
 *
 * Each block maps to a required guarantee. These are deliberately written
 * against the PUBLIC contracts so a future refactor cannot quietly weaken
 * them while keeping internal tests green.
 */

import { describe, expect, it } from "vitest";
import { createOkxDiscoveryAdapter } from "./okx-adapter";
import { runUniversalDiscovery, selectAcquirableInstruments } from "./registry";
import { createPipelineState, runDiscoveryPipelineStep } from "./pipeline";
import type { NativeAcquisitionResult } from "./pipeline";
import { selectRotatingDiscoveryBatch } from "@/lib/liveScanner";
import { scanInstruments } from "@/lib/liveScanner";
import { generateRecommendation } from "@/lib/recommendation-engine";
import type { CandidateInput } from "@/lib/recommendation-engine";
import { scanRadar } from "@/lib/market-radar/radar";
import type { RadarCandidateSource } from "@/lib/market-radar/candidate-builder";
import type { DiscoveredInstrument } from "./types";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";

const NOW = 1_800_000_000_000;

function okxResponse(rows: Record<string, string>[]) {
  return async () =>
    new Response(JSON.stringify({ code: "0", data: rows }), { status: 200 });
}

function inst(
  id: string,
  provider = "okx",
  overrides: Partial<DiscoveredInstrument> = {},
): DiscoveredInstrument {
  return {
    provider,
    providerInstrumentId: id,
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: id.split("-")[0] ?? id,
    quoteAsset: "USDT",
    tradingState: "TRADING",
    capabilities: ["ohlcv"],
    discoveredAt: NOW,
    ...overrides,
  };
}

function liveSource(id: string, at = NOW): LiveCandidateSource {
  return {
    instrument: id,
    assetClass: "crypto",
    providerNative: { provider: "okx", providerInstrumentId: id },
    marketData: {
      instrument: id,
      instrumentType: "crypto",
      provider: "okx",
      fetchTimestamp: at,
      price: { price: 100, timestamp: at, source: "okx" },
      candles: [],
      timeframe: "1h",
      dataFreshness: "realtime",
    },
  };
}

function ok(i: DiscoveredInstrument): NativeAcquisitionResult {
  return {
    provider: i.provider,
    providerInstrumentId: i.providerInstrumentId,
    assetClass: i.assetClass,
    success: true,
    source: liveSource(i.providerInstrumentId),
    observedAt: NOW,
  };
}

function failed(i: DiscoveredInstrument, error = "boom"): NativeAcquisitionResult {
  return {
    provider: i.provider,
    providerInstrumentId: i.providerInstrumentId,
    assetClass: i.assetClass,
    success: false,
    error,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1-7. DISCOVERY HONESTY
// ═══════════════════════════════════════════════════════════════

describe("discovery", () => {
  it("1. yields the exact provider instrument id", async () => {
    const adapter = createOkxDiscoveryAdapter(
      okxResponse([
        { instId: "BTC-USDT-SWAP", instType: "SWAP", baseCcy: "BTC", quoteCcy: "USDT", state: "live" },
      ]),
    );
    const result = await adapter.discover(NOW);
    expect(result.instruments[0].providerInstrumentId).toBe("BTC-USDT-SWAP");
  });

  it("2. never produces price, candles or freshness", async () => {
    const adapter = createOkxDiscoveryAdapter(
      okxResponse([{ instId: "BTC-USDT", instType: "SPOT", baseCcy: "BTC", quoteCcy: "USDT", state: "live" }]),
    );
    const [discovered] = (await adapter.discover(NOW)).instruments;
    const keys = Object.keys(discovered as unknown as Record<string, unknown>);

    for (const forbidden of ["price", "candles", "freshness", "ohlcv", "quote", "lastPrice"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("3. filters out non-live instruments", async () => {
    const adapter = createOkxDiscoveryAdapter(
      okxResponse([
        { instId: "LIVE-USDT", instType: "SPOT", baseCcy: "LIVE", quoteCcy: "USDT", state: "live" },
        { instId: "SUSP-USDT", instType: "SPOT", baseCcy: "SUSP", quoteCcy: "USDT", state: "suspend" },
        { instId: "PRE-USDT", instType: "SPOT", baseCcy: "PRE", quoteCcy: "USDT", state: "preopen" },
      ]),
    );
    const result = await adapter.discover(NOW);
    const acquirable = selectAcquirableInstruments(result.instruments, "ohlcv");
    expect(acquirable.map((i) => i.providerInstrumentId)).toEqual(["LIVE-USDT"]);
  });

  it("4. de-duplicates repeated discovery", async () => {
    const first = await runUniversalDiscovery(
      [createOkxDiscoveryAdapter(okxResponse([
        { instId: "BTC-USDT", instType: "SPOT", baseCcy: "BTC", quoteCcy: "USDT", state: "live" },
      ]))],
      NOW,
    );
    let state = createPipelineState();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const step = await runDiscoveryPipelineStep({
        state,
        discovered: first.instruments,
        succeededProviders: ["okx"],
        batchSize: 10,
        now: NOW + cycle * 1000,
        acquire: async (batch) => batch.map(ok),
      });
      state = step.state;
      expect(step.liveSources).toHaveLength(1);
    }
  });

  it("5. partial provider failure keeps the working provider", async () => {
    const good = createOkxDiscoveryAdapter(
      okxResponse([{ instId: "BTC-USDT", instType: "SPOT", baseCcy: "BTC", quoteCcy: "USDT", state: "live" }]),
    );
    const bad = {
      provider: "broken",
      assetClasses: ["crypto" as const],
      discover: async () => {
        throw new Error("down");
      },
    };

    const result = await runUniversalDiscovery([good, bad], NOW);
    expect(result.succeededProviders).toEqual(["okx"]);
    expect(result.failedProviders).toEqual(["broken"]);
    expect(result.instruments).toHaveLength(1);
  });

  it("6. total provider failure yields an honest empty result", async () => {
    const result = await runUniversalDiscovery(
      [
        { provider: "a", assetClasses: ["crypto"], discover: async () => { throw new Error("x"); } },
        { provider: "b", assetClasses: ["crypto"], discover: async () => { throw new Error("y"); } },
      ],
      NOW,
    );
    expect(result.instruments).toEqual([]);
    expect(result.succeededProviders).toEqual([]);
    expect(result.failedProviders.sort()).toEqual(["a", "b"]);
  });

  it("7. rejects rows without a usable native id", async () => {
    const adapter = createOkxDiscoveryAdapter(
      okxResponse([
        { instId: "", instType: "SPOT", baseCcy: "X", quoteCcy: "USDT", state: "live" },
        { instType: "SPOT", baseCcy: "Y", quoteCcy: "USDT", state: "live" },
      ]),
    );
    const result = await adapter.discover(NOW);
    expect(result.instruments).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8-12. ACQUISITION + ROTATION
// ═══════════════════════════════════════════════════════════════

describe("acquisition and rotation", () => {
  it("8. failed acquisition never deletes a retained source", async () => {
    const discovered = [inst("BTC-USDT")];
    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 5,
      now: NOW,
      acquire: async (b) => b.map(ok),
    });

    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered,
      succeededProviders: ["okx"],
      batchSize: 5,
      now: NOW + 60_000,
      acquire: async (b) => b.map((i) => failed(i)),
    });

    expect(second.liveSources).toHaveLength(1);
    expect(second.liveSources[0].instrument).toBe("BTC-USDT");
  });

  it("9. successful acquisition replaces the previous snapshot", async () => {
    const discovered = [inst("BTC-USDT")];
    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 5,
      now: NOW,
      acquire: async (b) => b.map(ok),
    });

    const later = NOW + 300_000;
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered,
      succeededProviders: ["okx"],
      batchSize: 5,
      now: later,
      acquire: async (b) =>
        b.map((i) => ({ ...ok(i), source: liveSource(i.providerInstrumentId, later), observedAt: later })),
    });

    expect(second.liveSources).toHaveLength(1);
    expect(second.liveSources[0].marketData!.price.timestamp).toBe(later);
  });

  it("10. provider-native id survives the whole pipeline", async () => {
    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered: [inst("BTC-USDT-SWAP")],
      succeededProviders: ["okx"],
      batchSize: 5,
      now: NOW,
      acquire: async (b) => b.map(ok),
    });

    expect(step.liveSources[0].providerNative).toEqual({
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
    });
    expect(step.liveSources[0].instrument).toBe("BTC-USDT-SWAP");
  });

  it("11. rotation eventually covers every discovered instrument", async () => {
    const discovered = Array.from({ length: 9 }, (_, i) => inst(`C${i}-USDT`));
    let state = createPipelineState();
    const seen = new Set<string>();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const step = await runDiscoveryPipelineStep({
        state,
        discovered,
        succeededProviders: ["okx"],
        batchSize: 3,
        now: NOW + cycle * 1000,
        acquire: async (batch) => {
          batch.forEach((i) => seen.add(i.providerInstrumentId));
          return batch.map(ok);
        },
      });
      state = step.state;
    }

    expect(seen.size).toBe(9);
  });

  it("12. rotating batch is safe at the boundaries", () => {
    const items = [inst("A"), inst("B"), inst("C")];

    expect(selectRotatingDiscoveryBatch([], 0, 5).batch).toEqual([]);
    expect(selectRotatingDiscoveryBatch(items, 0, 0).batch).toEqual([]);
    expect(selectRotatingDiscoveryBatch(items, 0, -1).batch).toEqual([]);
    // Budget larger than the universe must not duplicate.
    expect(selectRotatingDiscoveryBatch(items, 0, 99).batch).toHaveLength(3);
    // Cursor beyond the end must wrap deterministically, not crash.
    expect(selectRotatingDiscoveryBatch(items, 99, 2).batch).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 13-18. SCANNER / RADAR / EVIDENCE HONESTY
// ═══════════════════════════════════════════════════════════════

describe("scanner and radar", () => {
  it("13. scanner accepts an instrument absent from any static list", () => {
    const invented = liveSource("ZZZZ-NEWCOIN-USDT");
    const scan = scanInstruments([invented], { horizons: ["SWING"], now: NOW });
    expect(scan.totalScanned).toBe(1);
  });

  it("14. radar keeps an instrument that belongs to no correlation cluster", () => {
    const source: RadarCandidateSource = {
      universe: {
        instrument: "ZZZZ-NEWCOIN-USDT",
        assetClass: "crypto",
        requiredCapabilities: ["ohlcv"],
        priority: 1,
        refreshIntervalMs: 300_000,
        providerNative: { provider: "okx", providerInstrumentId: "ZZZZ-NEWCOIN-USDT" },
      },
      snapshot: {
        instrument: "ZZZZ-NEWCOIN-USDT",
        assetClass: "crypto",
        price: 100,
        ohlcvAvailable: true,
        availableTimeframes: ["1h"],
        provider: "okx",
        observedAt: NOW,
        freshness: "FRESH",
        quality: "VERIFIED",
      },
    };

    const result = scanRadar([source], { horizons: ["SWING"], maxResults: 10 });
    const opps = result.results.get("SWING") ?? [];
    expect(opps.length).toBeGreaterThan(0);
    // Provider-native identity is preserved into the radar opportunity.
    expect(opps[0].providerNative?.providerInstrumentId).toBe("ZZZZ-NEWCOIN-USDT");
  });

  it("16. historical data never counts as live", () => {
    const old = liveSource("BTC-USDT", NOW - 8 * 3_600_000);
    const scan = scanInstruments([old], { horizons: ["SCALPING"], now: NOW });

    expect(scan.totalWithLiveData).toBe(0);
    expect(scan.results.get("SCALPING")!.rankedInstruments).toEqual([]);
  });

  it("17. provider unavailability is not directional evidence", () => {
    const scan = scanInstruments([liveSource("BTC-USDT")], {
      horizons: ["SWING"],
      now: NOW,
      providerErrors: ["okx: ETH-USDT acquisition failed"],
    });

    const ranked = scan.results.get("SWING")!.rankedInstruments;
    for (const r of ranked) {
      const text = [...r.supportingEvidence, ...r.primaryReasons].join(" ").toLowerCase();
      expect(text).not.toContain("provider");
      expect(text).not.toContain("unavailable");
      expect(text).not.toContain("failed");
    }
  });

  it("18. insufficient data remains a valid outcome", () => {
    const bare: CandidateInput = {
      instrument: "BTC-USDT",
      assetClass: "crypto",
      currentPrice: 0,
      dataCompleteness: "NONE",
      dataPoints: 0,
      hasLiveData: false,
      freshness: "UNAVAILABLE",
      providerCoverage: "NONE",
    };

    const result = generateRecommendation([bare], "INTRADAY");
    expect(result.rankedInstruments).toEqual([]);
    expect(result.excludedInstruments.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 19-22. DETERMINISM AND PRESERVED SEMANTICS
// ═══════════════════════════════════════════════════════════════

describe("determinism and preserved semantics", () => {
  const candidates: CandidateInput[] = [
    {
      instrument: "BTC-USDT",
      assetClass: "crypto",
      currentPrice: 100,
      dataCompleteness: "FULL",
      dataPoints: 100,
      hasLiveData: true,
      freshness: "FRESH",
      providerCoverage: "FULL",
      htfBias: "long",
      marketRegime: "TRENDING",
    },
    {
      instrument: "ETH-USDT",
      assetClass: "crypto",
      currentPrice: 50,
      dataCompleteness: "PARTIAL",
      dataPoints: 40,
      hasLiveData: true,
      freshness: "FRESH",
      providerCoverage: "PARTIAL",
      htfBias: "neutral",
    },
  ];

  it("19. ranking is deterministic across repeated runs", () => {
    const shape = () =>
      generateRecommendation(candidates, "SWING").rankedInstruments.map((r) => [
        r.instrument,
        r.rank,
        r.analyticalScore,
        r.confidence,
      ]);
    expect(shape()).toEqual(shape());
  });

  it("19b. ranking is independent of input ordering", () => {
    const a = generateRecommendation(candidates, "SWING").rankedInstruments;
    const b = generateRecommendation([...candidates].reverse(), "SWING").rankedInstruments;
    expect(b.map((r) => r.instrument)).toEqual(a.map((r) => r.instrument));
  });

  it("20. missing data is never treated as positive evidence", () => {
    const rich = generateRecommendation([candidates[0]], "SWING").rankedInstruments[0];
    const sparse = generateRecommendation(
      [{ ...candidates[0], dataCompleteness: "MINIMAL", dataPoints: 3 }],
      "SWING",
    ).rankedInstruments[0];

    // Less data must never score higher than more data.
    expect(sparse?.analyticalScore ?? 0).toBeLessThanOrEqual(rich.analyticalScore);
  });

  it("21. LIVE accounting counts only genuinely live candidates", () => {
    const scan = scanInstruments(
      [liveSource("BTC-USDT"), liveSource("OLD-USDT", NOW - 30 * 3_600_000)],
      { horizons: ["SWING"], now: NOW },
    );
    expect(scan.totalScanned).toBe(2);
    expect(scan.totalWithLiveData).toBe(1);
  });

  it("22. a discovery failure retires nothing", async () => {
    const discovered = [inst("BTC-USDT")];
    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 5,
      now: NOW,
      acquire: async (b) => b.map(ok),
    });

    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [],
      succeededProviders: [],
      batchSize: 5,
      now: NOW + 60_000,
      acquire: async (b) => b.map(ok),
    });

    expect(second.liveSources).toHaveLength(1);
    expect(second.evicted).toEqual([]);
  });
});
