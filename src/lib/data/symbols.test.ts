import { describe, it, expect } from "vitest";
import { detectAssetClass, normalizeInstrument, toProviderSymbol, toCoinGeckoId, getInstrumentLabel } from "./symbols";

describe("detectAssetClass", () => {
  it("detects forex pairs with slash", () => {
    expect(detectAssetClass("EUR/USD")).toBe("forex");
    expect(detectAssetClass("gbp/jpy")).toBe("forex");
  });

  it("detects crypto by prefix", () => {
    expect(detectAssetClass("BTC/USD")).toBe("crypto");
    expect(detectAssetClass("ETH/USD")).toBe("crypto");
    expect(detectAssetClass("SOL/USD")).toBe("crypto");
    expect(detectAssetClass("DOGE/USD")).toBe("crypto");
  });

  it("detects commodities by XAU/XAG prefix", () => {
    expect(detectAssetClass("XAU/USD")).toBe("commodity");
    expect(detectAssetClass("XAG/USD")).toBe("commodity");
  });

  it("detects stocks by 1-5 letter symbols", () => {
    expect(detectAssetClass("AAPL")).toBe("stock");
    expect(detectAssetClass("TSLA")).toBe("stock");
    expect(detectAssetClass("MSFT")).toBe("stock");
  });

  it("defaults to stock for unknown uppercase symbols", () => {
    expect(detectAssetClass("NVDA")).toBe("stock");
  });
});

describe("normalizeInstrument", () => {
  it("uppercases and trims input", () => {
    expect(normalizeInstrument("  eur/usd  ")).toBe("EUR/USD");
  });

  it("replaces hyphens with slashes", () => {
    expect(normalizeInstrument("BTC-USD")).toBe("BTC/USD");
  });

  it("removes spaces", () => {
    expect(normalizeInstrument("XAU / USD")).toBe("XAU/USD");
  });
});

describe("toProviderSymbol", () => {
  it("passes through forex and crypto symbols", () => {
    expect(toProviderSymbol("EUR/USD", "forex")).toBe("EUR/USD");
    expect(toProviderSymbol("BTC/USD", "crypto")).toBe("BTC/USD");
  });

  it("strips slash for stocks", () => {
    expect(toProviderSymbol("AAPL", "stock")).toBe("AAPL");
  });

  it("handles indices", () => {
    expect(toProviderSymbol("US30", "indices")).toBe("US30");
    expect(toProviderSymbol("US/30", "indices")).toBe("US30");
  });
});

describe("toCoinGeckoId", () => {
  it("returns correct IDs for known crypto pairs", () => {
    expect(toCoinGeckoId("BTC/USD")).toBe("bitcoin");
    expect(toCoinGeckoId("ETH/USD")).toBe("ethereum");
    expect(toCoinGeckoId("SOL/USD")).toBe("solana");
  });

  it("returns null for unknown pairs", () => {
    expect(toCoinGeckoId("EUR/USD")).toBeNull();
    expect(toCoinGeckoId("AAPL")).toBeNull();
  });
});

describe("getInstrumentLabel", () => {
  it("returns known labels", () => {
    expect(getInstrumentLabel("EUR/USD")).toBe("Euro / US Dollar");
    expect(getInstrumentLabel("BTC/USD")).toBe("Bitcoin");
  });

  it("falls back to uppercase symbol", () => {
    expect(getInstrumentLabel("XYZ")).toBe("XYZ");
  });
});
