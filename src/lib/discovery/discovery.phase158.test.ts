/**
 * Phase 158 — Universal Provider Discovery Expansion
 *
 * These tests target the INVARIANTS, not the happy path:
 *   - no symbol substitution
 *   - provider isolation on failure
 *   - discovery metadata is never live data
 *   - no hidden whitelist / permanent ceiling
 *   - correlation control works on discovered instruments
 */

import { describe, expect, it } from "vitest";
import {
  discoveredInstrumentKey,
  isAcquirableState,
  type DiscoveredInstrument,
  type ProviderDiscoveryAdapter,
  type ProviderDiscoveryResult,
} from "./types";
import { runUniversalDiscovery, selectAcquirableInstruments } from "./registry";
import {
  deriveCorrelationKey,
  deriveQuoteExposureKey,
  limitByCorrelationGroup,
} from "./correlation";
import {
  createOkxDiscoveryAdapter,
  mapOkxTradingState,
  normalizeOkxInstrument,
} from "./okx-adapter";

const NOW = 1_800_000_000_000;

function makeInstrument(
  overrides: Partial<DiscoveredInstrument> & {
    provider: string;
    providerInstrumentId: string;
  },
): DiscoveredInstrument {
  return {
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    ...overrides,
  };
}

function staticAdapter(
  provider: string,
  instruments: DiscoveredInstrument[],
  options: { success?: boolean; error?: string; throws?: boolean } = {},
): ProviderDiscoveryAdapter {
  return {
    provider,
    assetClasses: ["crypto"],
    async discover(now): Promise<ProviderDiscoveryResult> {
      if (options.throws) throw new Error("adapter exploded");
      return {
        provider,
        success: options.success ?? true,
        discoveredAt: now,
        instruments,
        warnings: [],
        ...(options.error ? { error: options.error } : {}),
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// A. NO SYMBOL SUBSTITUTION
// ═══════════════════════════════════════════════════════════════

describe("A — no symbol substitution", () => {
  it("keeps the exact provider-native id byte-for-byte", async () => {
    const weird = "BTC-USDT-240927";
    const result = await runUniversalDiscovery(
      [staticAdapter("okx", [makeInstrument({ provider: "okx", providerInstrumentId: weird })])],
      NOW,
    );

    expect(result.instruments).toHaveLength(1);
    expect(result.instruments[0].providerInstrumentId).toBe(weird);
  });

  it("keeps the same symbol on two providers as two distinct instruments", async () => {
    const result = await runUniversalDiscovery(
      [
        staticAdapter("okx", [
          makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" }),
        ]),
        staticAdapter("other", [
          makeInstrument({ provider: "other", providerInstrumentId: "BTC-USDT" }),
        ]),
      ],
      NOW,
    );

    expect(result.instruments).toHaveLength(2);
    expect(new Set(result.instruments.map((i) => i.provider))).toEqual(
      new Set(["okx", "other"]),
    );
  });

  it("scopes identity keys by provider", () => {
    expect(
      discoveredInstrumentKey({ provider: "okx", providerInstrumentId: "BTC-USDT" }),
    ).not.toBe(
      discoveredInstrumentKey({ provider: "other", providerInstrumentId: "BTC-USDT" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// B. PROVIDER ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("B — provider isolation", () => {
  it("a failing provider never removes another provider's instruments", async () => {
    const result = await runUniversalDiscovery(
      [
        staticAdapter("okx", [
          makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" }),
        ]),
        staticAdapter("broken", [], { success: false, error: "HTTP 503" }),
      ],
      NOW,
    );

    expect(result.instruments).toHaveLength(1);
    expect(result.instruments[0].provider).toBe("okx");
    expect(result.failedProviders).toEqual(["broken"]);
    expect(result.succeededProviders).toEqual(["okx"]);
  });

  it("a thrown adapter is recorded as failure, not silent empty success", async () => {
    const result = await runUniversalDiscovery(
      [
        staticAdapter("okx", [
          makeInstrument({ provider: "okx", providerInstrumentId: "ETH-USDT" }),
        ]),
        staticAdapter("explosive", [], { throws: true }),
      ],
      NOW,
    );

    expect(result.failedProviders).toContain("explosive");
    expect(result.succeededProviders).toEqual(["okx"]);
    expect(result.instruments).toHaveLength(1);
  });

  it("does not report a failed provider as succeeded", async () => {
    const result = await runUniversalDiscovery(
      [staticAdapter("broken", [], { success: false, error: "down" })],
      NOW,
    );

    expect(result.succeededProviders).toEqual([]);
    expect(result.instruments).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. DISCOVERY IS METADATA ONLY
// ═══════════════════════════════════════════════════════════════

describe("C — discovery metadata is never live data", () => {
  it("discovered instruments carry no price field", async () => {
    const result = await runUniversalDiscovery(
      [
        staticAdapter("okx", [
          makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" }),
        ]),
      ],
      NOW,
    );

    const instrument = result.instruments[0] as unknown as Record<string, unknown>;
    expect(instrument.price).toBeUndefined();
    expect(instrument.quote).toBeUndefined();
    expect(instrument.snapshot).toBeUndefined();
  });

  it("only TRADING state is acquirable", () => {
    expect(isAcquirableState("TRADING")).toBe(true);
    expect(isAcquirableState("HALTED")).toBe(false);
    expect(isAcquirableState("PRE_LAUNCH")).toBe(false);
    expect(isAcquirableState("SUSPENDED")).toBe(false);
    expect(isAcquirableState("EXPIRED")).toBe(false);
    expect(isAcquirableState("UNKNOWN")).toBe(false);
  });

  it("excludes non-trading instruments from acquisition", () => {
    const instruments = [
      makeInstrument({ provider: "okx", providerInstrumentId: "A", tradingState: "TRADING" }),
      makeInstrument({ provider: "okx", providerInstrumentId: "B", tradingState: "SUSPENDED" }),
      makeInstrument({ provider: "okx", providerInstrumentId: "C", tradingState: "PRE_LAUNCH" }),
    ];

    const acquirable = selectAcquirableInstruments(instruments, "ohlcv");
    expect(acquirable.map((i) => i.providerInstrumentId)).toEqual(["A"]);
  });

  it("excludes instruments whose provider lacks the capability", () => {
    const instruments = [
      makeInstrument({
        provider: "okx",
        providerInstrumentId: "A",
        capabilities: ["quote"],
      }),
    ];

    expect(selectAcquirableInstruments(instruments, "ohlcv")).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. NO HIDDEN WHITELIST / CEILING
// ═══════════════════════════════════════════════════════════════

describe("D — no hidden whitelist or permanent ceiling", () => {
  it("retains every discovered instrument regardless of count", async () => {
    const many = Array.from({ length: 750 }, (_, i) =>
      makeInstrument({
        provider: "okx",
        providerInstrumentId: `TOKEN${i}-USDT`,
        baseAsset: `TOKEN${i}`,
      }),
    );

    const result = await runUniversalDiscovery([staticAdapter("okx", many)], NOW);
    expect(result.instruments).toHaveLength(750);
  });

  it("accepts a brand-new never-hardcoded instrument", async () => {
    const result = await runUniversalDiscovery(
      [
        staticAdapter("okx", [
          makeInstrument({
            provider: "okx",
            providerInstrumentId: "ZZZNEWCOIN-USDT",
            baseAsset: "ZZZNEWCOIN",
          }),
        ]),
      ],
      NOW,
    );

    expect(selectAcquirableInstruments(result.instruments, "ohlcv")).toHaveLength(1);
  });

  it("counts coverage per asset class without a static list", async () => {
    const result = await runUniversalDiscovery(
      [
        staticAdapter("okx", [
          makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" }),
          makeInstrument({
            provider: "okx",
            providerInstrumentId: "EURUSD",
            assetClass: "forex",
            subType: "forex_spot",
            baseAsset: "EUR",
            quoteAsset: "USD",
          }),
        ]),
      ],
      NOW,
    );

    expect(result.assetClassCoverage.crypto).toBe(1);
    expect(result.assetClassCoverage.forex).toBe(1);
    expect(result.assetClassCoverage.equity).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. CORRELATION ON DISCOVERED INSTRUMENTS
// ═══════════════════════════════════════════════════════════════

describe("E — correlation derived from provider metadata", () => {
  it("groups spot/perp/futures of the same base asset", () => {
    const spot = makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" });
    const perp = makeInstrument({
      provider: "okx",
      providerInstrumentId: "BTC-USDT-SWAP",
      subType: "crypto_perpetual",
    });

    expect(deriveCorrelationKey(spot)).toBe(deriveCorrelationKey(perp));
  });

  it("does not group different base assets", () => {
    const btc = makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" });
    const eth = makeInstrument({
      provider: "okx",
      providerInstrumentId: "ETH-USDT",
      baseAsset: "ETH",
    });

    expect(deriveCorrelationKey(btc)).not.toBe(deriveCorrelationKey(eth));
  });

  it("derives a separate quote-side exposure key", () => {
    const eurusd = makeInstrument({
      provider: "fx",
      providerInstrumentId: "EURUSD",
      assetClass: "forex",
      baseAsset: "EUR",
      quoteAsset: "USD",
    });

    expect(deriveQuoteExposureKey(eurusd)).toBe("forex:QUOTE:USD");
  });

  it("caps how many correlated instruments surface together", () => {
    const items = [
      makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" }),
      makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT-SWAP" }),
      makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USD-240927" }),
      makeInstrument({ provider: "okx", providerInstrumentId: "ETH-USDT", baseAsset: "ETH" }),
    ];

    const limited = limitByCorrelationGroup(items, deriveCorrelationKey, 2);
    expect(limited).toHaveLength(3);
    expect(limited.filter((i) => i.baseAsset === "BTC")).toHaveLength(2);
    expect(limited.filter((i) => i.baseAsset === "ETH")).toHaveLength(1);
  });

  it("never suppresses an instrument with no derivable group", () => {
    const items = [1, 2, 3];
    expect(limitByCorrelationGroup(items, () => undefined, 1)).toEqual([1, 2, 3]);
  });

  it("is deterministic for identical input", () => {
    const items = [
      makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT" }),
      makeInstrument({ provider: "okx", providerInstrumentId: "BTC-USDT-SWAP" }),
    ];
    const a = limitByCorrelationGroup(items, deriveCorrelationKey, 1);
    const b = limitByCorrelationGroup(items, deriveCorrelationKey, 1);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. OKX ADAPTER NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("F — OKX adapter normalization", () => {
  it("maps OKX states without ever guessing TRADING", () => {
    expect(mapOkxTradingState("live")).toBe("TRADING");
    expect(mapOkxTradingState("suspend")).toBe("SUSPENDED");
    expect(mapOkxTradingState("preopen")).toBe("PRE_LAUNCH");
    expect(mapOkxTradingState("expired")).toBe("EXPIRED");
    expect(mapOkxTradingState(undefined)).toBe("UNKNOWN");
    expect(mapOkxTradingState("something-new")).toBe("UNKNOWN");
  });

  it("preserves the native instId and precision", () => {
    const normalized = normalizeOkxInstrument(
      {
        instId: "BTC-USDT-SWAP",
        instType: "SWAP",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        settleAsset: "USDT",
        subType: "crypto_perpetual",
        state: "live",
        tickSize: 0.1,
        lotSize: 1,
        minSize: 1,
      },
      NOW,
    );

    expect(normalized.providerInstrumentId).toBe("BTC-USDT-SWAP");
    expect(normalized.provider).toBe("okx");
    expect(normalized.subType).toBe("crypto_perpetual");
    expect(normalized.tradingState).toBe("TRADING");
    expect(normalized.precision?.tickSize).toBe(0.1);
    expect(normalized.settleAsset).toBe("USDT");
  });

  it("surfaces an OKX transport failure as a failed provider", async () => {
    const adapter = createOkxDiscoveryAdapter(async () => {
      throw new Error("network down");
    });

    const result = await runUniversalDiscovery([adapter], NOW);
    expect(result.failedProviders).toEqual(["okx"]);
    expect(result.instruments).toEqual([]);
  });
});
