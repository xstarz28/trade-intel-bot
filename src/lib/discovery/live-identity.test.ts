import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveInstrument } from "@/lib/data/universal/instruments";
import {
  discoveredFromTracked,
  resolveLiveIdentity,
} from "./live-identity";
import type { DiscoveredInstrument } from "./types";
import type { TrackedInstrument } from "./lifecycle";

const NOW = 1_800_000_000_000;

function row(
  overrides: Partial<DiscoveredInstrument> &
    Pick<DiscoveredInstrument, "provider" | "providerInstrumentId" | "assetClass">,
): DiscoveredInstrument {
  return {
    subType: "commodity_spot",
    baseAsset: "X",
    quoteAsset: "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    ...overrides,
  };
}

describe("resolveLiveIdentity", () => {
  it("empty discovery is SYMBOL_UNSUPPORTED — typed input is not a listing", () => {
    const r = resolveLiveIdentity({ typed: "XAU/USD", discovered: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failureClass).toBe("SYMBOL_UNSUPPORTED");
      expect(r.reason).toMatch(/not present in provider discovery/);
    }
  });

  it("matches the exact provider-native id, preserving casing", () => {
    const discovered = [
      row({
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
        assetClass: "commodity",
        baseAsset: "XAU",
      }),
    ];
    const r = resolveLiveIdentity({ typed: "XAU/USD", discovered });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provider).toBe("twelve-data");
      expect(r.providerInstrumentId).toBe("XAU/USD");
      expect(r.assetClass).toBe("commodity");
    }
  });

  it("falls back to case-insensitive native-id match without rewriting the catalog id", () => {
    const discovered = [
      row({
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
        assetClass: "commodity",
        baseAsset: "XAU",
      }),
    ];
    const r = resolveLiveIdentity({ typed: "xau/usd", discovered });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerInstrumentId).toBe("XAU/USD");
    }
  });

  it("never substitutes GOLD for XAU/USD", () => {
    const discovered = [
      row({
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
        assetClass: "commodity",
        baseAsset: "XAU",
      }),
    ];
    const r = resolveLiveIdentity({ typed: "GOLD", discovered });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failureClass).toBe("SYMBOL_UNSUPPORTED");
  });

  it("does not consult instruments.ts — an unregistered native id still resolves", () => {
    expect(resolveInstrument("BRAND-NEW-XYZ")).toBeUndefined();
    const discovered = [
      row({
        provider: "twelve-data",
        providerInstrumentId: "BRAND-NEW-XYZ",
        assetClass: "equity",
        subType: "equity_common",
        baseAsset: "BRAND-NEW-XYZ",
      }),
    ];
    const r = resolveLiveIdentity({ typed: "BRAND-NEW-XYZ", discovered });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerInstrumentId).toBe("BRAND-NEW-XYZ");
      expect(r.assetClass).toBe("equity");
    }
  });

  it("refuses when the same typed id matches multiple providers", () => {
    const discovered = [
      row({
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        assetClass: "crypto",
        subType: "crypto_spot",
        baseAsset: "BTC",
        quoteAsset: "USDT",
      }),
      row({
        provider: "twelve-data",
        providerInstrumentId: "BTC-USDT",
        assetClass: "crypto",
        subType: "crypto_spot",
        baseAsset: "BTC",
        quoteAsset: "USDT",
      }),
    ];
    const r = resolveLiveIdentity({ typed: "BTC-USDT", discovered });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/multiple provider-native identities/);
  });

  it("excludes DELISTED tracked rows", () => {
    const live = row({
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      assetClass: "commodity",
      baseAsset: "XAU",
    });
    const delisted = row({
      provider: "twelve-data",
      providerInstrumentId: "DEAD/USD",
      assetClass: "forex",
      subType: "forex_spot",
      baseAsset: "DEAD",
    });
    const tracked = new Map<string, TrackedInstrument>([
      [
        "twelve-data::XAU/USD",
        {
          instrument: live,
          state: "LIVE",
          lastLiveAt: NOW,
          lastSuccessAt: NOW,
          lastFailureAt: null,
          consecutiveFailures: 0,
          lastSeenInDiscoveryAt: NOW,
        },
      ],
      [
        "twelve-data::DEAD/USD",
        {
          instrument: delisted,
          state: "DELISTED",
          lastLiveAt: NOW,
          lastSuccessAt: NOW,
          lastFailureAt: null,
          consecutiveFailures: 0,
          lastSeenInDiscoveryAt: NOW - 1,
        },
      ],
    ]);
    const discovered = discoveredFromTracked(tracked);
    expect(discovered.map((d) => d.providerInstrumentId)).toEqual(["XAU/USD"]);
    expect(resolveLiveIdentity({ typed: "DEAD/USD", discovered }).ok).toBe(false);
    expect(resolveLiveIdentity({ typed: "XAU/USD", discovered }).ok).toBe(true);
  });

  it("a catalog selection uses exact provider+id and does not reinterpret the display string", () => {
    const discovered = [
      row({
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        assetClass: "crypto",
        subType: "crypto_spot",
        baseAsset: "BTC",
        quoteAsset: "USDT",
      }),
      row({
        provider: "twelve-data",
        providerInstrumentId: "BTC/USD",
        assetClass: "crypto",
        subType: "crypto_spot",
        baseAsset: "BTC",
        quoteAsset: "USD",
      }),
    ];
    const r = resolveLiveIdentity({
      typed: "BTC/USD",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      discovered,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provider).toBe("okx");
      expect(r.providerInstrumentId).toBe("BTC-USDT");
    }
  });

  it("source never aliases GOLD or reads the static instrument registry", () => {
    const src = readFileSync("src/lib/discovery/live-identity.ts", "utf8");
    expect(src).not.toMatch(/["']GOLD["']\s*:/);
    expect(src).not.toContain("resolveInstrument");
    expect(src).not.toMatch(/from ["']@\/lib\/data\/universal\/instruments["']/);
  });
});
