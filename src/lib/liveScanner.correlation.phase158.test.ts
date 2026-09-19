/**
 * Phase 158 — Correlation control in the live scanner
 *
 * Before Phase 158 the only correlation control was `CORRELATION_CLUSTERS`,
 * keyed on canonical names like "BTC/USD". Discovery produces provider-native
 * ids like "BTC-USDT-SWAP", so the cluster list never matched and correlation
 * control was silently inert for every discovered instrument.
 *
 * These tests pin the replacement behaviour.
 */

import { describe, expect, it } from "vitest";
import { scanInstruments } from "./liveScanner";
import { deriveCorrelationKey } from "./discovery/correlation";
import type { LiveCandidateSource } from "./liveCandidateBuilder";

const NOW = Date.now();

function source(
  providerInstrumentId: string,
  baseAsset: string,
  close: number,
): LiveCandidateSource {
  return {
    instrument: providerInstrumentId,
    assetClass: "crypto",
    providerNative: { provider: "okx", providerInstrumentId },
    correlationKey: deriveCorrelationKey({ assetClass: "crypto", baseAsset }),
    marketData: {
      instrument: providerInstrumentId,
      instrumentType: "crypto",
      provider: "okx",
      fetchTimestamp: NOW,
      price: { price: close, timestamp: NOW, source: "okx" },
      candles: Array.from({ length: 60 }, (_, i) => ({
        timestamp: NOW - (60 - i) * 3_600_000,
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume: 100,
      })),
      timeframe: "1h",
      dataFreshness: "realtime",
    },
  };
}

describe("Phase 158 — live scanner correlation control", () => {
  const sources = [
    source("BTC-USDT", "BTC", 60000),
    source("BTC-USDT-SWAP", "BTC", 60010),
    source("BTC-USD-240927", "BTC", 60020),
    source("ETH-USDT", "ETH", 3000),
  ];

  it("caps correlated instruments from the same base asset", () => {
    const result = scanInstruments(sources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 1,
    });

    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    const btc = ranked.filter((r) => r.instrument.startsWith("BTC"));
    expect(btc).toHaveLength(1);
  });

  it("does not suppress uncorrelated instruments", () => {
    const result = scanInstruments(sources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 1,
    });

    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.some((r) => r.instrument === "ETH-USDT")).toBe(true);
  });

  it("reports every correlation-suppressed instrument explicitly", () => {
    const result = scanInstruments(sources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 1,
    });

    const excluded = result.results.get("INTRADAY")!.excludedInstruments;
    const correlationExcluded = excluded.filter((e) =>
      e.reason.includes("correlated exposure"),
    );
    expect(correlationExcluded).toHaveLength(2);
  });

  it("keeps ranks contiguous after suppression", () => {
    const result = scanInstruments(sources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 1,
    });

    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.map((r) => r.rank)).toEqual(
      Array.from({ length: ranked.length }, (_, i) => i + 1),
    );
  });

  it("is disabled by default, preserving pre-Phase-158 behaviour", () => {
    const result = scanInstruments(sources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
    });

    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.filter((r) => r.instrument.startsWith("BTC")).length).toBeGreaterThan(1);
  });

  it("allows a higher cap per group", () => {
    const result = scanInstruments(sources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 2,
    });

    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.filter((r) => r.instrument.startsWith("BTC"))).toHaveLength(2);
  });

  it("never suppresses candidates that carry no correlation key", () => {
    const unkeyed = sources.map((s) => ({ ...s, correlationKey: undefined }));
    const result = scanInstruments(unkeyed, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 1,
    });

    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked).toHaveLength(4);
  });

  it("is deterministic across repeated scans", () => {
    const config = {
      horizons: ["INTRADAY" as const],
      maxResults: 10,
      maxPerCorrelationGroup: 1,
    };
    const a = scanInstruments(sources, config).results.get("INTRADAY")!;
    const b = scanInstruments(sources, config).results.get("INTRADAY")!;

    expect(a.rankedInstruments.map((r) => r.instrument)).toEqual(
      b.rankedInstruments.map((r) => r.instrument),
    );
  });
});
