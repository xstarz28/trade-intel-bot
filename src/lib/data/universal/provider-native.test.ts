import { describe, expect, it } from "vitest";
import { createProviderNativeInstrument } from "./provider-native";

describe("Phase 151 — provider-native identity", () => {
  it("preserves the exact provider instrument identity", () => {
    const result = createProviderNativeInstrument({
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      assetClass: "crypto",
      subType: "crypto_perpetual",
    });

    expect(result).toEqual({
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      assetClass: "crypto",
      subType: "crypto_perpetual",
    });
  });

  it("does not substitute a provider-native instrument", () => {
    const result = createProviderNativeInstrument({
      provider: "okx",
      providerInstrumentId: "ETH-USDT-SWAP",
      assetClass: "crypto",
      subType: "crypto_perpetual",
    });

    expect(result?.providerInstrumentId).toBe("ETH-USDT-SWAP");
    expect(result?.providerInstrumentId).not.toBe("ETH/USDT");
    expect(result?.providerInstrumentId).not.toBe("BTC-USDT-SWAP");
  });

  it("rejects incomplete provider-native identity", () => {
    expect(
      createProviderNativeInstrument({
        provider: "",
        providerInstrumentId: "BTC-USDT-SWAP",
        assetClass: "crypto",
        subType: "crypto_perpetual",
      }),
    ).toBeNull();

    expect(
      createProviderNativeInstrument({
        provider: "okx",
        providerInstrumentId: "",
        assetClass: "crypto",
        subType: "crypto_perpetual",
      }),
    ).toBeNull();
  });
});
