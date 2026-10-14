import { describe, expect, it } from "vitest";
import { resolveProviderRequest, resolveProviderRequestSymbol } from "./provider-symbol";
import { getAllInstruments } from "./instruments";

describe("provider request symbol resolution", () => {
  it("uses explicit Twelve Data suffix mappings for Indonesian equities", () => {
    expect(resolveProviderRequest("BBCA", "twelve-data")).toEqual({ symbol: "BBCA", micCode: "XIDX" });
    expect(resolveProviderRequest("BBRI", "twelve-data")).toEqual({ symbol: "BBRI", micCode: "XIDX" });
    expect(resolveProviderRequest("TLKM", "twelve-data")).toEqual({ symbol: "TLKM", micCode: "XIDX" });
  });

  it("keeps already-compatible registered provider symbols exact", () => {
    expect(resolveProviderRequestSymbol("XAU/USD", "twelve-data")).toBe("XAU/USD");
    expect(resolveProviderRequestSymbol("EUR/USD", "twelve-data")).toBe("EUR/USD");
    expect(resolveProviderRequestSymbol("AAPL", "twelve-data")).toBe("AAPL");
  });

  it("honors every declared available Twelve Data mapping in the registry", () => {
    for (const instrument of getAllInstruments()) {
      for (const mapping of instrument.providerMappings) {
        if (mapping.provider !== "twelve-data" || !mapping.available) continue;
        expect(
          resolveProviderRequestSymbol(instrument.canonical, "twelve-data"),
          instrument.canonical,
        ).toBe(
          mapping.symbol.endsWith(".JK") && instrument.primaryExchange === "IDX"
            ? mapping.symbol.slice(0, -3)
            : mapping.symbol,
        );
      }
    }
  });

  it("adds Twelve Data's XIDX MIC for canonical and discovered IDX listings only", () => {
    expect(resolveProviderRequest("GOTO", "twelve-data")).toEqual({ symbol: "GOTO", micCode: "XIDX" });
    expect(resolveProviderRequest("ADRO.JK", "twelve-data")).toEqual({ symbol: "ADRO", micCode: "XIDX" });
    expect(resolveProviderRequest("AMRT.JK", "twelve-data")).toEqual({ symbol: "AMRT", micCode: "XIDX" });
    expect(resolveProviderRequest("AAPL", "twelve-data")).toEqual({ symbol: "AAPL" });
    expect(resolveProviderRequest("UNKNOWN-XYZ", "twelve-data")).toEqual({ symbol: "UNKNOWN-XYZ" });
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
