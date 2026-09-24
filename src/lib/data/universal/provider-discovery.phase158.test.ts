import { describe, expect, it } from "vitest";
import {
  createProviderDiscoveryRegistry,
  mergeProviderDiscoveryResults,
} from "./provider-discovery";
import {
  adaptOkxDiscoveryResult,
  okxProviderDiscoveryAdapter,
} from "./okx-provider-discovery";

describe("Phase 158 — provider discovery contract", () => {
  it("registers provider adapters without an instrument whitelist", () => {
    const registry = createProviderDiscoveryRegistry([okxProviderDiscoveryAdapter]);

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.provider).toBe("okx");
    expect(registry.list()[0]?.supportedAssetClasses).toEqual(["crypto"]);
  });

  it("replaces adapters by provider identity without creating duplicate providers", () => {
    const registry = createProviderDiscoveryRegistry();

    const first = {
      provider: "test-provider",
      supportedAssetClasses: ["crypto"] as const,
      discover: async () => ({
        success: true,
        provider: "test-provider",
        discoveredAt: 1,
        instruments: [],
        warnings: [],
      }),
    };

    const second = {
      ...first,
      supportedAssetClasses: ["crypto", "forex"] as const,
    };

    registry.register(first);
    registry.register(second);

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.supportedAssetClasses).toEqual([
      "crypto",
      "forex",
    ]);
  });

  it("returns provider failures as structured discovery results", async () => {
    const registry = createProviderDiscoveryRegistry([
      {
        provider: "failing-provider",
        supportedAssetClasses: ["crypto"],
        async discover() {
          throw new Error("provider unavailable");
        },
      },
    ]);

    const [result] = await registry.discoverAll(async () => {
      throw new Error("transport should not be called");
    }, 123);

    expect(result).toEqual({
      success: false,
      provider: "failing-provider",
      discoveredAt: 123,
      instruments: [],
      warnings: [],
      error: "provider unavailable",
    });
  });

  it("preserves exact OKX provider-native instrument IDs", () => {
    const result = adaptOkxDiscoveryResult({
      success: true,
      provider: "okx",
      discoveredAt: 123,
      instruments: [
        {
          instId: "BTC-USDT-SWAP",
          instType: "SWAP",
          baseAsset: "BTC",
          quoteAsset: "USDT",
          subType: "crypto_perpetual",
        },
        {
          instId: "ETH-USDT",
          instType: "SPOT",
          baseAsset: "ETH",
          quoteAsset: "USDT",
          subType: "crypto_spot",
        },
      ],
      warnings: [],
    });

    expect(result.instruments.map((item) => item.providerInstrumentId)).toEqual([
      "BTC-USDT-SWAP",
      "ETH-USDT",
    ]);
  });

  it("merges provider discoveries without substituting identities", () => {
    const result = mergeProviderDiscoveryResults([
      {
        success: true,
        provider: "okx",
        discoveredAt: 100,
        instruments: [
          {
            provider: "okx",
            providerInstrumentId: "BTC-USDT-SWAP",
            assetClass: "crypto",
          },
        ],
        warnings: [],
      },
      {
        success: true,
        provider: "other",
        discoveredAt: 110,
        instruments: [
          {
            provider: "other",
            providerInstrumentId: "BTC/USD",
            assetClass: "crypto",
          },
        ],
        warnings: [],
      },
    ]);

    expect(result.instruments).toHaveLength(2);
    expect(result.instruments.map((item) => item.providerInstrumentId)).toEqual([
      "BTC-USDT-SWAP",
      "BTC/USD",
    ]);
    expect(result.discoveredAt).toBe(110);
  });
});
