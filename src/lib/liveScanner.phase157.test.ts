import type { MarketSnapshot } from "./market-radar/types";
import type { OhlcvCandle } from "./data/market-types";
import { describe, expect, it } from "vitest";
import { mergeVerifiedLiveSources } from "./liveScanner";
import type { LiveCandidateSource } from "./liveCandidateBuilder";

describe("Phase 157 — verified live-source retention", () => {
  const existing: LiveCandidateSource = {
    instrument: "BTC-USDT-SWAP",
    assetClass: "crypto",
    providerNative: {
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
    },
  };

  const marketData = {
    instrument: "ETH-USDT-SWAP",
    instrumentType: "crypto" as const,
    provider: "okx",
    fetchTimestamp: 1000,
    price: {
      price: 2500,
      timestamp: 999,
      source: "okx",
    },
    candles: [
      {
        timestamp: 999,
        open: 2490,
        high: 2510,
        low: 2480,
        close: 2500,
        volume: 100,
      },
    ],
    timeframe: "1h",
    dataFreshness: "realtime" as const,
  };

  const makeAcquisition = (overrides: Partial<{ instrument: string; assetClass: "crypto"; providerInstrumentId?: string; provider: string; success: boolean; snapshot: MarketSnapshot; candles: OhlcvCandle[]; fetchedAt: number; latencyMs: number; error?: string }> = {}) => ({
    instrument: "ETH-USDT-SWAP",
    assetClass: "crypto" as const,
    providerInstrumentId: "ETH-USDT-SWAP",
    provider: "okx",
    success: true,
    snapshot: {
      instrument: "ETH-USDT-SWAP",
      assetClass: "crypto" as const,
      price: 2500,
      ohlcvAvailable: true,
      availableTimeframes: ["1h"],
      provider: "okx",
      observedAt: 1000,
      freshness: "FRESH" as const,
      quality: "VERIFIED" as const,
    },
    candles: [{
      timestamp: 999,
      open: 2490,
      high: 2510,
      low: 2480,
      close: 2500,
      volume: 100,
    }],
    fetchedAt: 1000,
    latencyMs: 10,
    ...overrides,
  });

  it("retains existing sources when new acquisitions fail", () => {
    const result = mergeVerifiedLiveSources(
      new Map([["BTC-USDT-SWAP", existing]]),
      [makeAcquisition({ success: false })],
      () => null,
    );

    expect(result.get("BTC-USDT-SWAP")).toBe(existing);
    expect(result.has("ETH-USDT-SWAP")).toBe(false);
  });

  it("retains only acquisitions that convert to verified market data", () => {
    const result = mergeVerifiedLiveSources(
      new Map(),
      [
        makeAcquisition(),
        makeAcquisition({
          instrument: "SOL-USDT-SWAP",
          providerInstrumentId: "SOL-USDT-SWAP",
        }),
      ],
      (acquisition) =>
        acquisition.instrument === "ETH-USDT-SWAP" ? marketData : null,
    );

    expect(result.has("ETH-USDT-SWAP")).toBe(true);
    expect(result.has("SOL-USDT-SWAP")).toBe(false);
  });

  it("preserves exact provider-native identity", () => {
    const result = mergeVerifiedLiveSources(
      new Map(),
      [makeAcquisition({ instrument: "ETH-USDT-SWAP" })],
      () => marketData,
    );

    expect(result.get("ETH-USDT-SWAP")?.providerNative).toEqual({
      provider: "okx",
      providerInstrumentId: "ETH-USDT-SWAP",
    });
  });

  it("rejects an acquisition with missing provider-native identity", () => {
    const result = mergeVerifiedLiveSources(
      new Map(),
      [makeAcquisition({ providerInstrumentId: undefined })],
      () => marketData,
    );

    expect(result.has("ETH-USDT-SWAP")).toBe(false);
  });

  it("preserves previously retained instruments not in the current batch", () => {
    const result = mergeVerifiedLiveSources(
      new Map([["BTC-USDT-SWAP", existing]]),
      [makeAcquisition()],
      () => marketData,
    );

    expect(result.has("BTC-USDT-SWAP")).toBe(true);
    expect(result.has("ETH-USDT-SWAP")).toBe(true);
  });
});
