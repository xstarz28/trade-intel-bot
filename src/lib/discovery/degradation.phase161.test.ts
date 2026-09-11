/**
 * Phase 161 — Universal live scanning hardening.
 *
 * The failure mode being closed: when a provider breaks, the scanner simply
 * receives fewer sources. That is indistinguishable from "the market is
 * quiet today" unless failures are reported. A degraded scan must be
 * visibly degraded.
 */

import { describe, expect, it } from "vitest";
import { createPipelineState, runDiscoveryPipelineStep } from "./pipeline";
import type { NativeAcquisitionResult } from "./pipeline";
import type { DiscoveredInstrument } from "./types";
import { scanInstruments } from "@/lib/liveScanner";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";

const NOW = 1_800_000_000_000;

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

function source(id: string, observedAt = NOW): LiveCandidateSource {
  return {
    instrument: id,
    assetClass: "crypto",
    providerNative: { provider: "okx", providerInstrumentId: id },
    marketData: {
      instrument: id,
      instrumentType: "crypto",
      provider: "okx",
      fetchTimestamp: observedAt,
      price: { price: 100, timestamp: observedAt, source: "okx" },
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
    source: source(i.providerInstrumentId),
    observedAt: NOW,
  };
}

function fail(
  i: DiscoveredInstrument,
  error?: string,
): NativeAcquisitionResult {
  return {
    provider: i.provider,
    providerInstrumentId: i.providerInstrumentId,
    assetClass: i.assetClass,
    success: false,
    ...(error ? { error } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// A. FAILURES ARE REPORTED
// ═══════════════════════════════════════════════════════════════

describe("A — acquisition failures surface as provider errors", () => {
  it("reports nothing when everything succeeds", async () => {
    const discovered = [inst("BTC-USDT"), inst("ETH-USDT")];
    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) => batch.map(ok),
    });

    expect(step.providerErrors).toEqual([]);
  });

  it("attributes a failure to its provider and native id", async () => {
    const discovered = [inst("BTC-USDT"), inst("ETH-USDT")];
    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) =>
        batch.map((i) =>
          i.providerInstrumentId === "ETH-USDT" ? fail(i, "HTTP 429") : ok(i),
        ),
    });

    expect(step.providerErrors).toHaveLength(1);
    expect(step.providerErrors[0]).toContain("okx");
    expect(step.providerErrors[0]).toContain("ETH-USDT");
    expect(step.providerErrors[0]).toContain("HTTP 429");
  });

  it("reports a thrown acquisition for every attempted instrument", async () => {
    const discovered = [inst("BTC-USDT"), inst("ETH-USDT")];
    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async () => {
        throw new Error("network down");
      },
    });

    expect(step.providerErrors).toHaveLength(2);
    expect(step.providerErrors.every((e) => e.includes("network down"))).toBe(true);
  });

  it("notes when previous data was retained through a failure", async () => {
    const discovered = [inst("BTC-USDT")];
    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) => batch.map(ok),
    });

    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW + 60_000,
      acquire: async (batch) => batch.map((i) => fail(i, "timeout")),
    });

    expect(second.providerErrors[0]).toContain("previous data retained");
    // And the retained source is genuinely still there.
    expect(second.liveSources).toHaveLength(1);
  });

  it("reports a provider that previously succeeded and now fails discovery", async () => {
    const discovered = [inst("BTC-USDT")];
    const first = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) => batch.map(ok),
    });

    // Provider drops out entirely: no discovery success this cycle.
    const second = await runDiscoveryPipelineStep({
      state: first.state,
      discovered: [],
      succeededProviders: [],
      batchSize: 10,
      now: NOW + 60_000,
      acquire: async (batch) => batch.map(ok),
    });

    expect(
      second.providerErrors.some((e) => e.includes("discovery failed")),
    ).toBe(true);
    // Retention still holds — a discovery failure retires nothing.
    expect(second.liveSources).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. SCANNER DEGRADATION SIGNAL
// ═══════════════════════════════════════════════════════════════

describe("B — the scanner reports degradation", () => {
  it("is not degraded when no errors are supplied", () => {
    const result = scanInstruments([source("BTC-USDT")], {
      horizons: ["INTRADAY"],
      now: NOW,
    });

    expect(result.degraded).toBe(false);
    expect(result.providerErrors).toEqual([]);
  });

  it("is degraded when upstream errors are supplied", () => {
    const result = scanInstruments([source("BTC-USDT")], {
      horizons: ["INTRADAY"],
      now: NOW,
      providerErrors: ["okx: ETH-USDT acquisition failed"],
    });

    expect(result.degraded).toBe(true);
    expect(result.providerErrors).toHaveLength(1);
  });

  it("distinguishes an empty healthy scan from an empty broken scan", () => {
    const healthy = scanInstruments([], { horizons: ["INTRADAY"], now: NOW });
    const broken = scanInstruments([], {
      horizons: ["INTRADAY"],
      now: NOW,
      providerErrors: ["okx: total outage"],
    });

    expect(healthy.totalScanned).toBe(0);
    expect(broken.totalScanned).toBe(0);
    // Same emptiness, different meaning — and the difference is visible.
    expect(healthy.degraded).toBe(false);
    expect(broken.degraded).toBe(true);
  });

  it("preserves upstream error text verbatim", () => {
    const errors = [
      "okx: BTC-USDT acquisition failed — HTTP 503",
      "twelve-data: discovery failed this cycle",
    ];
    const result = scanInstruments([source("BTC-USDT")], {
      horizons: ["SWING"],
      now: NOW,
      providerErrors: errors,
    });

    expect(result.providerErrors).toEqual(errors);
  });

  it("degradation never fabricates or suppresses opportunities", () => {
    const sources = [source("BTC-USDT"), source("ETH-USDT")];
    const clean = scanInstruments(sources, { horizons: ["SWING"], now: NOW });
    const degraded = scanInstruments(sources, {
      horizons: ["SWING"],
      now: NOW,
      providerErrors: ["okx: SOL-USDT acquisition failed"],
    });

    // Identical inputs produce identical analysis; only the health flag moves.
    expect(degraded.totalScanned).toBe(clean.totalScanned);
    expect(degraded.results.get("SWING")!.rankedInstruments.length).toBe(
      clean.results.get("SWING")!.rankedInstruments.length,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// C. END-TO-END HONESTY
// ═══════════════════════════════════════════════════════════════

describe("C — pipeline to scanner", () => {
  it("carries real failures from acquisition into the scan result", async () => {
    const discovered = [inst("BTC-USDT"), inst("ETH-USDT")];
    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) =>
        batch.map((i) =>
          i.providerInstrumentId === "ETH-USDT" ? fail(i, "HTTP 500") : ok(i),
        ),
    });

    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      now: NOW,
      providerErrors: step.providerErrors,
    });

    // One instrument acquired, one failed — and the scan says so.
    expect(scan.totalScanned).toBe(1);
    expect(scan.degraded).toBe(true);
    expect(scan.providerErrors[0]).toContain("ETH-USDT");
  });

  it("a fully healthy cycle produces a non-degraded scan", async () => {
    const discovered = [inst("BTC-USDT"), inst("ETH-USDT")];
    const step = await runDiscoveryPipelineStep({
      state: createPipelineState(),
      discovered,
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) => batch.map(ok),
    });

    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      now: NOW,
      providerErrors: step.providerErrors,
    });

    expect(scan.totalScanned).toBe(2);
    expect(scan.degraded).toBe(false);
  });
});
