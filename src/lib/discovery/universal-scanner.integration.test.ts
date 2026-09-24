/**
 * Universal discovery → acquisition → live scanner.
 *
 * These tests pin the production path, not a Dashboard-specific shortcut:
 * a newly discovered provider-native instrument can reach the scanner
 * without anyone adding it to a whitelist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scanInstruments } from "@/lib/liveScanner";
import {
  createPipelineState,
  runDiscoveryPipelineStep,
  type NativeAcquisitionResult,
} from "./pipeline";
import {
  acquireDiscoveredBatch,
  mergeDiscoveryResults,
} from "./universal-cycle";
import { discoveredInstrumentKey, type DiscoveredInstrument } from "./types";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";
import type { MarketData } from "@/lib/data/market-types";

const NOW = 1_800_000_000_000;

function discovered(
  overrides: Partial<DiscoveredInstrument> &
    Pick<DiscoveredInstrument, "provider" | "providerInstrumentId" | "assetClass">,
): DiscoveredInstrument {
  return {
    subType: "crypto_spot",
    baseAsset: "X",
    quoteAsset: "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    ...overrides,
  };
}

function liveMarket(instrument: string, provider: string, observedAt: number): MarketData {
  return {
    instrument,
    instrumentType: "crypto",
    provider,
    fetchTimestamp: observedAt,
    price: { price: 100, timestamp: observedAt, source: provider },
    candles: [
      {
        timestamp: observedAt,
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 10,
      },
    ],
    timeframe: "1h",
    dataFreshness: "realtime",
  };
}

function verifiedAcquire(
  item: DiscoveredInstrument,
  observedAt: number,
): NativeAcquisitionResult {
  const source: LiveCandidateSource = {
    instrument: item.providerInstrumentId,
    assetClass: item.assetClass,
    providerNative: {
      provider: item.provider,
      providerInstrumentId: item.providerInstrumentId,
    },
    marketData: liveMarket(item.providerInstrumentId, item.provider, observedAt),
  };
  return {
    provider: item.provider,
    providerInstrumentId: item.providerInstrumentId,
    assetClass: item.assetClass,
    success: true,
    source,
    observedAt,
  };
}

async function runCycle(args: {
  discovered: DiscoveredInstrument[];
  succeededProviders: string[];
  acquire: (batch: readonly DiscoveredInstrument[]) => Promise<NativeAcquisitionResult[]>;
}) {
  return runDiscoveryPipelineStep({
    state: createPipelineState(),
    discovered: args.discovered,
    succeededProviders: args.succeededProviders,
    batchSize: 20,
    now: NOW,
    acquire: args.acquire,
  });
}

describe("universal discovery → scanner", () => {
  it("a newly discovered instrument reaches the scanner without a code change", async () => {
    const fresh = discovered({
      provider: "twelve-data",
      providerInstrumentId: "BRAND-NEW-XYZ",
      assetClass: "equity",
      subType: "equity_common",
      baseAsset: "BRAND-NEW-XYZ",
      quoteAsset: "USD",
    });

    const step = await runCycle({
      discovered: [fresh],
      succeededProviders: ["twelve-data"],
      acquire: async (batch) => batch.map((item) => verifiedAcquire(item, NOW)),
    });

    expect(step.liveSources.map((s) => s.instrument)).toContain("BRAND-NEW-XYZ");
    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      now: NOW,
      providerErrors: step.providerErrors,
    });
    const instruments =
      scan.results.get("INTRADAY")?.rankedInstruments.map((r) => r.instrument) ??
      [];
    expect(instruments).toContain("BRAND-NEW-XYZ");
  });

  it("preserves the exact provider-native id end-to-end", async () => {
    const inst = discovered({
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      assetClass: "crypto",
      subType: "crypto_perpetual",
      baseAsset: "BTC",
      quoteAsset: "USDT",
    });
    const step = await runCycle({
      discovered: [inst],
      succeededProviders: ["okx"],
      acquire: async (batch) => batch.map((item) => verifiedAcquire(item, NOW)),
    });
    const source = step.liveSources[0];
    expect(source.instrument).toBe("BTC-USDT-SWAP");
    expect(source.providerNative).toEqual({
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
    });
    expect(discoveredInstrumentKey(inst)).toBe("okx::BTC-USDT-SWAP");
  });

  it("an instrument not present in discovery cannot appear through substitution", async () => {
    const listed = discovered({
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      assetClass: "forex",
      subType: "forex_spot",
      baseAsset: "EUR",
      quoteAsset: "USD",
    });
    const step = await runCycle({
      discovered: [listed],
      succeededProviders: ["twelve-data"],
      acquire: async (batch) => {
        // Hostile acquirer tries to invent XAU. The pipeline only accepts
        // results that map back to the requested native id.
        return [
          ...batch.map((item) => verifiedAcquire(item, NOW)),
          verifiedAcquire(
            discovered({
              provider: "twelve-data",
              providerInstrumentId: "XAU/USD",
              assetClass: "commodity",
              subType: "commodity_spot",
              baseAsset: "XAU",
              quoteAsset: "USD",
            }),
            NOW,
          ),
        ];
      },
    });
    expect(step.liveSources.map((s) => s.instrument)).toEqual(["EUR/USD"]);
    expect(step.liveSources.map((s) => s.instrument)).not.toContain("XAU/USD");
  });

  it("provider discovery failure does not create fake opportunities", async () => {
    const merged = mergeDiscoveryResults([
      {
        provider: "twelve-data",
        success: false,
        discoveredAt: NOW,
        instruments: [],
        warnings: [],
        error: "Required credentials not configured: TWELVE_DATA_API_KEY.",
      },
    ]);
    expect(merged.discovered).toEqual([]);
    const step = await runCycle({
      discovered: merged.discovered,
      succeededProviders: merged.succeededProviders,
      acquire: async () => {
        throw new Error("acquire must not run on an empty discovery");
      },
    });
    expect(step.liveSources).toEqual([]);
    const scan = scanInstruments(step.liveSources, {
      horizons: ["INTRADAY"],
      maxResults: 10,
      now: NOW,
      providerErrors: merged.discoveryErrors,
    });
    expect(scan.results.get("INTRADAY")?.rankedInstruments ?? []).toEqual([]);
    expect(merged.discoveryErrors[0]).toMatch(/twelve-data/);
  });

  it("historical-only acquisition cannot become a live opportunity", async () => {
    const inst = discovered({
      provider: "twelve-data",
      providerInstrumentId: "AAPL",
      assetClass: "equity",
      subType: "equity_common",
      baseAsset: "AAPL",
      quoteAsset: "USD",
    });
    const step = await runCycle({
      discovered: [inst],
      succeededProviders: ["twelve-data"],
      acquire: async (batch) =>
        batch.map((item) => ({
          provider: item.provider,
          providerInstrumentId: item.providerInstrumentId,
          assetClass: item.assetClass,
          success: false,
          error: "historical-only series is not live evidence",
        })),
    });
    expect(step.liveSources).toEqual([]);
    expect(step.providerErrors.some((e) => /historical-only/.test(e))).toBe(true);
  });

  it("multiple providers can coexist without collapsing identical display names", async () => {
    const okxBtc = discovered({
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      assetClass: "crypto",
      baseAsset: "BTC",
      quoteAsset: "USDT",
    });
    const tdBtc = discovered({
      provider: "twelve-data",
      providerInstrumentId: "BTC/USD",
      assetClass: "crypto",
      baseAsset: "BTC",
      quoteAsset: "USD",
    });
    const merged = mergeDiscoveryResults([
      {
        provider: "okx",
        success: true,
        discoveredAt: NOW,
        instruments: [okxBtc],
        warnings: [],
      },
      {
        provider: "twelve-data",
        success: true,
        discoveredAt: NOW,
        instruments: [tdBtc],
        warnings: [],
      },
    ]);
    expect(merged.discovered).toHaveLength(2);

    const step = await runCycle({
      discovered: merged.discovered,
      succeededProviders: merged.succeededProviders,
      acquire: (batch) =>
        acquireDiscoveredBatch(batch, {
          okx: async (items) => items.map((i) => verifiedAcquire(i, NOW)),
          "twelve-data": async (items) => items.map((i) => verifiedAcquire(i, NOW)),
        }),
    });
    const keys = step.liveSources.map(
      (s) => `${s.providerNative?.provider}::${s.providerNative?.providerInstrumentId}`,
    );
    expect(keys.sort()).toEqual(["okx::BTC-USDT", "twelve-data::BTC/USD"]);
  });

  it("Twelve Data discovered commodity/forex/equity/crypto instruments enter the same pipeline when acquisition is available", async () => {
    const instruments = [
      discovered({
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
        assetClass: "commodity",
        subType: "commodity_spot",
        baseAsset: "XAU",
        quoteAsset: "USD",
      }),
      discovered({
        provider: "twelve-data",
        providerInstrumentId: "EUR/USD",
        assetClass: "forex",
        subType: "forex_spot",
        baseAsset: "EUR",
        quoteAsset: "USD",
      }),
      discovered({
        provider: "twelve-data",
        providerInstrumentId: "AAPL",
        assetClass: "equity",
        subType: "equity_common",
        baseAsset: "AAPL",
        quoteAsset: "USD",
      }),
      discovered({
        provider: "twelve-data",
        providerInstrumentId: "BTC/USD",
        assetClass: "crypto",
        subType: "crypto_spot",
        baseAsset: "BTC",
        quoteAsset: "USD",
      }),
    ];

    const step = await runCycle({
      discovered: instruments,
      succeededProviders: ["twelve-data"],
      acquire: async (batch) => batch.map((item) => verifiedAcquire(item, NOW)),
    });

    const ids = step.liveSources.map((s) => s.instrument).sort();
    expect(ids).toEqual(["AAPL", "BTC/USD", "EUR/USD", "XAU/USD"]);
    // XAU is present because the provider discovered it and acquisition
    // verified it — not because the name is popular.
    expect(ids).toContain("XAU/USD");
  });

  it("Dashboard runDiscoveryCycle registers Twelve Data alongside OKX", () => {
    const src = readFileSync("src/pages/Dashboard.tsx", "utf8");
    expect(src).toContain("const runDiscoveryCycle");
    expect(src).toContain("discoverTwelveDataInstruments");
    expect(src).toContain("acquireTwelveDataNativeLiveDataBatch");
    expect(src).toContain("acquireDiscoveredBatch");
    expect(src).toContain("mergeDiscoveryResults");
    expect(src).toContain('"twelve-data"');
    expect(src).toContain("api.okx.discoverOkxInstruments");
  });

  it("an unregistered provider cannot launder instruments onto another venue", async () => {
    const inst = discovered({
      provider: "unknown-venue",
      providerInstrumentId: "FOO",
      assetClass: "crypto",
    });
    const results = await acquireDiscoveredBatch([inst], {
      okx: async () => {
        throw new Error("okx must not be asked to acquire unknown-venue ids");
      },
    });
    expect(results).toEqual([
      {
        provider: "unknown-venue",
        providerInstrumentId: "FOO",
        assetClass: "crypto",
        success: false,
        error: "no acquisition path registered for provider unknown-venue",
      },
    ]);
  });
});
