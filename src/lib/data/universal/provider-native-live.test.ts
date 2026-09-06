import { describe, expect, it } from "vitest";
import { executeLiveRequest } from "./live/client";

describe("Phase 151 — provider-native live identity", () => {
  it("uses the exact provider-native instrument ID without registry substitution", async () => {
    const result = await executeLiveRequest({
      instrument: "BTC-USDT-SWAP",
      capability: "quote",
      providerNative: {
        provider: "okx",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
      },
      transport: async (url) => {
        expect(url).toContain("BTC-USDT-SWAP");
        expect(url).not.toContain("BTC/USDT");

        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: "0",
            data: [
              {
                instId: "BTC-USDT-SWAP",
                last: "100000",
                bidPx: "99999",
                askPx: "100001",
              },
            ],
          }),
        };
      },
      readEnv: () => undefined,
    });

    expect(result.instrument).toBe("BTC-USDT-SWAP");
    expect(result.symbolUsed).toBe("BTC-USDT-SWAP");
  });

  it("does not silently route a provider-native identity to another provider", async () => {
    const calls: string[] = [];

    const result = await executeLiveRequest({
      instrument: "ETH-USDT-SWAP",
      capability: "quote",
      providerNative: {
        provider: "okx",
        providerInstrumentId: "ETH-USDT-SWAP",
        assetClass: "crypto",
      },
      transport: async (url) => {
        calls.push(url);

        return {
          ok: false,
          status: 404,
          json: async () => ({ code: "1" }),
        };
      },
      readEnv: () => undefined,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("ETH-USDT-SWAP");
    expect(calls[0]).not.toContain("BTC");
    expect(result.provider).toBe("okx");
    expect(result.symbolUsed).toBe("ETH-USDT-SWAP");
  });
});

it("rejects unsupported native capability before transport", async () => {
  let transportCalled = false;

  const result = await executeLiveRequest({
    instrument: "BTC-USDT-SWAP",
    capability: "financial_statements",
    providerNative: {
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      assetClass: "crypto",
    },
    transport: async () => {
      transportCalled = true;

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    },
    readEnv: () => undefined,
  });

  expect(transportCalled).toBe(false);
  expect(result.status).toBe("UNSUPPORTED");
  expect(result.provider).toBe("okx");
  expect(result.symbolUsed).toBe("BTC-USDT-SWAP");
});
