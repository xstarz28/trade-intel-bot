import { describe, it, expect } from "vitest";
import {
  getProviderProfile,
  getProvidersForAssetClass,
  getStreamProvidersForAssetClass,
  getProvidersForCapability,
  isProviderAvailable,
  buildStreamConfig,
  getPollIntervalMs,
  getAllProviders,
} from "./provider-adapters";

describe("getProviderProfile", () => {
  it("returns OKX profile", () => {
    const profile = getProviderProfile("OKX");
    expect(profile).toBeDefined();
    expect(profile!.provider).toBe("OKX");
    expect(profile!.websocketSupported).toBe(true);
    expect(profile!.assetClasses).toContain("crypto");
  });

  it("returns TwelveData profile", () => {
    const profile = getProviderProfile("TwelveData");
    expect(profile).toBeDefined();
    expect(profile!.websocketSupported).toBe(true);
    expect(profile!.assetClasses).toContain("forex");
    expect(profile!.assetClasses).toContain("equity");
  });

  it("returns CoinGlass profile", () => {
    const profile = getProviderProfile("CoinGlass");
    expect(profile).toBeDefined();
    expect(profile!.websocketSupported).toBe(false);
    expect(profile!.capabilities).toContain("REALTIME_FUNDING");
  });

  it("returns undefined for unknown provider", () => {
    expect(getProviderProfile("UnknownProvider")).toBeUndefined();
  });
});

describe("getProvidersForAssetClass", () => {
  it("returns crypto providers", () => {
    const providers = getProvidersForAssetClass("crypto");
    expect(providers.length).toBeGreaterThanOrEqual(2);
    expect(providers.some(p => p.provider === "OKX")).toBe(true);
  });

  it("returns forex providers", () => {
    const providers = getProvidersForAssetClass("forex");
    expect(providers.length).toBeGreaterThanOrEqual(1);
    expect(providers.some(p => p.provider === "TwelveData")).toBe(true);
  });

  it("returns empty for unknown asset class", () => {
    const providers = getProvidersForAssetClass("unknown_class");
    expect(providers).toEqual([]);
  });
});

describe("getStreamProvidersForAssetClass", () => {
  it("returns only WebSocket-capable providers for crypto", () => {
    const providers = getStreamProvidersForAssetClass("crypto");
    for (const p of providers) {
      expect(p.websocketSupported).toBe(true);
    }
  });
});

describe("getProvidersForCapability", () => {
  it("finds providers with REALTIME_FUNDING", () => {
    const providers = getProvidersForCapability("REALTIME_FUNDING");
    expect(providers.some(p => p.provider === "CoinGlass")).toBe(true);
  });

  it("finds POLLED_ONLY providers", () => {
    const providers = getProvidersForCapability("POLLED_ONLY");
    expect(providers.length).toBeGreaterThan(0);
  });
});

describe("isProviderAvailable", () => {
  it("returns true for known providers", () => {
    expect(isProviderAvailable("OKX")).toBe(true);
    expect(isProviderAvailable("TwelveData")).toBe(true);
  });

  it("returns false for unknown providers", () => {
    expect(isProviderAvailable("UnknownProvider")).toBe(false);
  });
});

describe("buildStreamConfig", () => {
  it("creates config with provider and instruments", () => {
    const config = buildStreamConfig("OKX", ["BTC/USDT", "ETH/USDT"]);
    expect(config.provider).toBe("OKX");
    expect(config.instruments).toEqual(["BTC/USDT", "ETH/USDT"]);
    expect(config.maxReconnectAttempts).toBe(10);
  });

  it("uses provider defaults for heartbeat and stale thresholds", () => {
    const config = buildStreamConfig("OKX", ["BTC/USDT"]);
    expect(config.heartbeatIntervalMs).toBe(15_000);
    expect(config.staleThresholdMs).toBe(30_000);
  });

  it("falls back to generic defaults for unknown provider", () => {
    const config = buildStreamConfig("Unknown", ["BTC/USDT"]);
    expect(config.heartbeatIntervalMs).toBe(30_000);
  });
});

describe("getPollIntervalMs", () => {
  it("returns reasonable interval for OKX", () => {
    const ms = getPollIntervalMs("OKX");
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(60_000);
  });

  it("returns 60s for unknown provider", () => {
    expect(getPollIntervalMs("Unknown")).toBe(60_000);
  });
});

describe("getAllProviders", () => {
  it("returns all registered providers", () => {
    const all = getAllProviders();
    expect(all.length).toBeGreaterThan(5);
    expect(all.some(p => p.provider === "OKX")).toBe(true);
    expect(all.some(p => p.provider === "TwelveData")).toBe(true);
  });
});
