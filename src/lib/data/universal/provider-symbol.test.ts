import { describe, expect, it } from "vitest";
import { resolveProviderRequestSymbol } from "./provider-symbol";

describe("provider request symbol resolution", () => {
  it("uses explicit Twelve Data suffix mappings for Indonesian equities", () => {
    expect(resolveProviderRequestSymbol("BBCA", "twelve-data")).toBe("BBCA.JK");
    expect(resolveProviderRequestSymbol("BBRI", "twelve-data")).toBe("BBRI.JK");
    expect(resolveProviderRequestSymbol("TLKM", "twelve-data")).toBe("TLKM.JK");
  });

  it("keeps already-compatible registered provider symbols exact", () => {
    expect(resolveProviderRequestSymbol("XAU/USD", "twelve-data")).toBe("XAU/USD");
    expect(resolveProviderRequestSymbol("EUR/USD", "twelve-data")).toBe("EUR/USD");
    expect(resolveProviderRequestSymbol("AAPL", "twelve-data")).toBe("AAPL");
  });

  it("preserves exact provider-native contract IDs", () => {
    expect(resolveProviderRequestSymbol("btc-usdt-swap", "twelve-data", true)).toBe("BTC-USDT-SWAP");
    expect(resolveProviderRequestSymbol("0g-usd_um_xperp-310905", "twelve-data", true))
      .toBe("0G-USD_UM_XPERP-310905");
  });

  it("does not invent mappings for unknown instruments", () => {
    expect(resolveProviderRequestSymbol("UNKNOWN-XYZ", "twelve-data")).toBe("UNKNOWN-XYZ");
    expect(resolveProviderRequestSymbol("", "twelve-data")).toBe("");
  });
});
