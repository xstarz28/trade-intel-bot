import { describe, expect, it } from "vitest";
import { acquireProviderNativeLiveData, acquireBatchProviderNativeLiveData } from "./provider-registry";
import type { Transport } from "../data/universal/live/client";

describe("Phase 156 — provider-native live acquisition", () => {
  it("preserves exact provider-native identity and accepts verified OHLCV", async () => {
    const requestedUrls: string[] = [];

    const transport: Transport = async (url) => {
      requestedUrls.push(url);

      return {
        ok: true,
        status: 200,
        json: {
          data: [
            ["1700000000000", "60000", "61000", "59000", "60500", "123"],
          ],
        },
      };
    };

    const result = await acquireProviderNativeLiveData(
      {
        instrument: "BTC-USDT-SWAP",
        provider: "okx",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
      },
      undefined,
      transport,
    );

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("instId=BTC-USDT-SWAP");
    expect(result.success).toBe(true);
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot?.instrument).toBe("BTC-USDT-SWAP");
    expect(result.snapshot?.provider).toBe("okx");
    expect(result.snapshot?.price).toBe(60500);
    expect(result.snapshot?.quality).toBe("VERIFIED");
  });

  it("does not fabricate a snapshot when the native provider request fails", async () => {
    const transport: Transport = async () => ({
      ok: false,
      status: 503,
      json: {},
    });

    const result = await acquireProviderNativeLiveData(
      {
        instrument: "BTC-USDT-SWAP",
        provider: "okx",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
      },
      undefined,
      transport,
    );

    expect(result.success).toBe(false);
    expect(result.snapshot).toBeNull();
  });

  it("preserves exact native identity across a batch", async () => {
    const calls: string[] = [];

    const transport = async (url: string) => {
      const match = url.match(/instId=([^&]+)/);
      const instId = match?.[1] ?? "";
      calls.push(instId);

      return {
        ok: true,
        status: 200,
        json: {
          code: "0",
          data: [
            instId === "BTC-USDT" ? ["1710000000000", "100", "110", "90", "105", "10"] : ["1710000000000", "200", "210", "190", "205", "10"],
          ],
        },
      };
    };

    const inputs = [
      {
        instrument: "BTC/USD",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        assetClass: "crypto" as const,
      },
      {
        instrument: "ETH/USD",
        provider: "okx",
        providerInstrumentId: "ETH-USDT",
        assetClass: "crypto" as const,
      },
    ];

    const results = await acquireBatchProviderNativeLiveData(
      inputs,
      undefined,
      2,
      transport,
    );

    expect(results).toHaveLength(2);
    expect(calls).toEqual(["BTC-USDT", "ETH-USDT"]);
    expect(results.map((r) => r.instrument)).toEqual(["BTC/USD", "ETH/USD"]);
    });
  });
