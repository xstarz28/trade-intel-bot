import { describe, expect, it } from "vitest";
import { matchesDerivativeSymbol, normalizeDerivativeSymbol } from "./derivatives-symbol";

describe("derivatives symbol identity", () => {
  it.each([
    ["BTC/USD", "BTC"],
    ["BTC-USDT-SWAP", "BTC"],
    ["BTCUSDT", "BTC"],
    ["ETH-USD-260925", "ETH"],
    [" BTC / USD ", "BTC"],
    ["BTC USDT", "BTC"],
  ])("normalizes %s to the base asset %s", (input, expected) => {
    expect(normalizeDerivativeSymbol(input)).toBe(expected);
  });

  it("accepts base-symbol derivatives data for a canonical instrument", () => {
    expect(matchesDerivativeSymbol("BTC/USD", undefined, "BTC")).toBe(true);
  });

  it("accepts derivatives data keyed by base asset for an exchange-native contract", () => {
    expect(matchesDerivativeSymbol("BTC-USDT-SWAP", "BTC-USDT-SWAP", "BTC")).toBe(true);
  });

  it("accepts an exchange's concatenated base/quote symbol", () => {
    expect(matchesDerivativeSymbol("BTC-USDT-SWAP", "BTC-USDT-SWAP", "BTCUSDT")).toBe(true);
  });

  it("normalizes whitespace before comparing provider symbols", () => {
    expect(matchesDerivativeSymbol(" BTC / USD ", undefined, " BTC ")).toBe(true);
  });

  it("rejects derivatives data belonging to a different base asset", () => {
    expect(matchesDerivativeSymbol("BTC/USD", undefined, "ETH")).toBe(false);
    expect(matchesDerivativeSymbol("ETH-USDT-SWAP", "ETH-USDT-SWAP", "BTC")).toBe(false);
  });

  it("rejects empty provider symbols", () => {
    expect(matchesDerivativeSymbol("BTC/USD", undefined, undefined)).toBe(false);
    expect(matchesDerivativeSymbol("BTC/USD", undefined, "  ")).toBe(false);
  });
});
