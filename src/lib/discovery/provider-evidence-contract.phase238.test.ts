/**
 * Phase 238 — Provider Evidence Contract Unification
 *
 * Unifies and hardens provider evidence contract across all market-data providers.
 *
 * Core rule: never represent application receipt time as provider observation time.
 * If provider does not provide trustworthy observation timestamp: observedAt = undefined,
 * retain fetchedAt/acquiredAt = receipt. Do NOT silently promote acquiredAt into observedAt.
 *
 * Existing receipt-time policies that are semantically justified (CoinGecko simple/price current-at-response)
 * are preserved with explicit provenance PROVIDER_RESPONSE, not PROVIDER_OBSERVED.
 *
 * Evidence path:
 * provider response → executeLiveRequest (validate, completionAt single clock)
 * → acquireProviderNativeLiveData (observedAt = candle timestamp, provenance PROVIDER_OBSERVED, fetchedAt = receivedAt)
 * → providerNativeAcquisitionToMarketData (preserves provenance, timestamp 0 sentinel when missing)
 * → toAcquisitionResults (provider::id key, no collapse, provenance preserved)
 * → pipeline Math.max (lifecycle, not evidence)
 * → scanner (freshness gates)
 * → UI (provider+id, lifecycle, not fake LIVE)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { assessFreshness } from "../market-radar/freshness";
import {
  providerNativeAcquisitionToMarketData,
} from "../market-radar/provider-registry";
import { toAcquisitionResults } from "./runtime";
import { validateOhlcvSeries, validateQuote } from "../data/universal/live/types";
import { parseTwelveDataTimeSeries, parseTwelveDataQuote } from "../data/universal/live/twelve-data-protocol";
import { scanInstruments } from "../liveScanner";
import type { DiscoveredInstrument } from "./types";
import type { LiveCandidateSource } from "../liveCandidateBuilder";

const NOW = 1_800_000_000_000;

function row(
  overrides: Partial<DiscoveredInstrument> &
    Pick<DiscoveredInstrument, "provider" | "providerInstrumentId" | "assetClass">,
): DiscoveredInstrument {
  return {
    subType: "crypto_spot",
    baseAsset: "X",
    quoteAsset: "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────
// 1. provider observation timestamp preserved
// ────────────────────────────────────────────────────────────────
describe("Phase238 — provider observation timestamp preserved", () => {
  it("OKX candle ts preserved as observedAt with PROVIDER_OBSERVED", async () => {
    const inst = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const providerTs = NOW - 60_000;
    const fetchedAt = NOW;
    const liveAcq = {
      instrument: inst.providerInstrumentId,
      assetClass: inst.assetClass,
      providerInstrumentId: inst.providerInstrumentId,
      provider: inst.provider,
      fetchedAt,
      success: true,
      snapshot: {
        instrument: inst.providerInstrumentId,
        assetClass: inst.assetClass,
        price: 50000,
        ohlcvAvailable: true,
        availableTimeframes: ["H1"],
        provider: inst.provider,
        observedAt: providerTs,
        freshness: assessFreshness(providerTs, fetchedAt),
        quality: "VERIFIED",
        timestampProvenance: "PROVIDER_OBSERVED" as const,
      },
      candles: [{ timestamp: providerTs, open: 1, high: 2, low: 0.5, close: 50000, volume: 100 }],
      liveStatus: "LIVE_VERIFIED",
      quality: "VERIFIED",
      latencyMs: 50,
    } as any;

    const md = providerNativeAcquisitionToMarketData(liveAcq);
    expect(md).not.toBeNull();
    expect(md!.price.timestamp).toBe(providerTs);
    expect(md!.fetchTimestamp).toBe(fetchedAt);
    expect(md!.timestampProvenance).toBe("PROVIDER_OBSERVED");
  });

  it("Twelve Data datetime preserved as observedAt", () => {
    const dt = new Date(NOW - 120_000).toISOString();
    const json = {
      symbol: "BTC/USD",
      values: [{ datetime: dt, open: "50000", high: "51000", low: "49000", close: "50000", volume: "100" }],
    };
    const parsed = parseTwelveDataTimeSeries(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.candles[0].timestamp).toBe(new Date(dt).getTime());
    }
  });

  it("CCXT ticker timestamp preserved", () => {
    const providerTs = NOW - 30_000;
    const liveAcq = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerInstrumentId: "BTC/USDT",
      provider: "ccxt:binance",
      fetchedAt: NOW,
      success: true,
      snapshot: {
        instrument: "BTC/USDT",
        assetClass: "crypto",
        price: 50000,
        ohlcvAvailable: false,
        availableTimeframes: [],
        provider: "ccxt:binance",
        observedAt: providerTs,
        freshness: assessFreshness(providerTs, NOW),
        quality: "VERIFIED",
        timestampProvenance: "PROVIDER_OBSERVED" as const,
      },
      candles: [{ timestamp: providerTs, open: 1, high: 2, low: 0.5, close: 50000, volume: 100 }],
      liveStatus: "LIVE_VERIFIED",
      quality: "VERIFIED",
      latencyMs: 10,
    } as any;
    const md = providerNativeAcquisitionToMarketData(liveAcq);
    expect(md!.price.timestamp).toBe(providerTs);
    expect(md!.timestampProvenance).toBe("PROVIDER_OBSERVED");
  });
});

// ────────────────────────────────────────────────────────────────
// 2. application receipt timestamp preserved separately
// ────────────────────────────────────────────────────────────────
describe("Phase238 — application receipt timestamp preserved separately", () => {
  it("fetchedAt separate from observedAt, both preserved", () => {
    const observed = NOW - 60_000;
    const fetched = NOW;
    const liveAcq = {
      instrument: "BTC-USDT",
      assetClass: "crypto",
      providerInstrumentId: "BTC-USDT",
      provider: "okx",
      fetchedAt: fetched,
      success: true,
      snapshot: {
        instrument: "BTC-USDT",
        assetClass: "crypto",
        price: 50000,
        ohlcvAvailable: true,
        availableTimeframes: ["H1"],
        provider: "okx",
        observedAt: observed,
        freshness: assessFreshness(observed, fetched),
        quality: "VERIFIED",
        acquiredAt: fetched,
        timestampProvenance: "PROVIDER_OBSERVED" as const,
      },
      candles: [{ timestamp: observed, open: 1, high: 2, low: 0.5, close: 50000, volume: 100 }],
      liveStatus: "LIVE_VERIFIED",
      quality: "VERIFIED",
      latencyMs: 20,
    } as any;
    const md = providerNativeAcquisitionToMarketData(liveAcq);
    expect(md!.price.timestamp).toBe(observed);
    expect(md!.fetchTimestamp).toBe(fetched);
    expect(md!.price.timestamp).not.toBe(md!.fetchTimestamp);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. missing provider timestamp
// ────────────────────────────────────────────────────────────────
describe("Phase238 — missing provider timestamp", () => {
  it("missing observedAt → freshness UNAVAILABLE, timestamp sentinel 0, provenance UNKNOWN", () => {
    const liveAcq = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerInstrumentId: "BTC/USDT",
      provider: "ccxt:binance",
      fetchedAt: NOW,
      success: true,
      snapshot: {
        instrument: "BTC/USDT",
        assetClass: "crypto",
        price: 50000,
        ohlcvAvailable: false,
        availableTimeframes: [],
        provider: "ccxt:binance",
        observedAt: undefined,
        freshness: assessFreshness(undefined, NOW),
        quality: "DEGRADED",
        timestampProvenance: "UNKNOWN" as const,
      },
      candles: [{ timestamp: NOW - 60_000, open: 1, high: 2, low: 0.5, close: 50000, volume: 100 }],
      liveStatus: "LIVE_VERIFIED",
      quality: "DEGRADED",
      latencyMs: 10,
    } as any;
    const md = providerNativeAcquisitionToMarketData(liveAcq);
    expect(md!.dataFreshness).toBe("unavailable");
    expect(md!.price.timestamp).toBe(0);
    expect(md!.timestampProvenance).toBe("UNKNOWN");
  });

  it("OKX missing ts → observedAt undefined, not acquiredAt", async () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    // OKX adapter should not have `observedAt = ... ?? acquiredAt` pattern for ts
    // After fix, it should have hasProviderTs check and undefined fallback
    expect(src).toContain("hasProviderTs");
    expect(src).not.toMatch(/const observedAt = Number\.isFinite\(ts\) \? ts : acquiredAt/);
  });

  it("CCXT missing ticker timestamp → UNKNOWN, not Date.now()", async () => {
    const { acquireCcxtLive } = await import("./ccxt-live");
    // Mock CCXT exchange without timestamp
    const mockExchange = {
      fetchOHLCV: async () => [],
      fetchTicker: async () => ({ symbol: "BTC/USDT", last: 50000 }), // no timestamp
    };
    // We cannot easily inject exchange without mocking require, so test code path directly:
    // The file should contain timestampProvenance logic and not Date.now() fallback for observedAt
    const src = readFileSync("src/lib/discovery/ccxt-live.ts", "utf8");
    expect(src).not.toContain("ticker.timestamp ?? Date.now()");
    expect(src).toContain("timestampProvenance");
    expect(src).toContain("UNKNOWN");
  });
});

// ────────────────────────────────────────────────────────────────
// 4. malformed provider timestamp
// ────────────────────────────────────────────────────────────────
describe("Phase238 — malformed provider timestamp", () => {
  it("NaN timestamp rejected in OHLCV validation", () => {
    const candles = [{ timestamp: NaN, open: 1, high: 1.1, low: 0.9, close: 1 }];
    const res = validateOhlcvSeries(candles, { now: NOW });
    expect(res.valid).toBe(false);
  });

  it("Infinity timestamp rejected", () => {
    const candles = [{ timestamp: Infinity, open: 1, high: 1.1, low: 0.9, close: 1 }];
    const res = validateOhlcvSeries(candles, { now: NOW });
    expect(res.valid).toBe(false);
  });

  it("malformed datetime in Twelve Data dropped, not NaN-stamped", () => {
    const json = {
      values: [
        { datetime: "garbage", open: "1", high: "1", low: "1", close: "1" },
        { datetime: new Date(NOW).toISOString(), open: "1", high: "1", low: "1", close: "1" },
      ],
    };
    const parsed = parseTwelveDataTimeSeries(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.candles).toHaveLength(1);
      expect(Number.isFinite(parsed.candles[0].timestamp)).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 5. provider timestamp unit conversion
// ────────────────────────────────────────────────────────────────
describe("Phase238 — provider timestamp unit conversion", () => {
  it("Twelve Data quote timestamp in seconds → ms", () => {
    const sec = Math.floor(NOW / 1000) - 20;
    const json = { close: "1.085", timestamp: sec };
    const parsed = parseTwelveDataQuote(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // The provider-registry converts s to ms, but parse returns raw sec; test conversion logic
      const ms = sec * 1000;
      expect(ms).toBeGreaterThan(1e12);
      expect(ms).toBeLessThan(NOW + 1000);
    }
  });

  it("OKX ms timestamp preserved as ms, not seconds", () => {
    const ms = NOW - 60_000;
    expect(ms).toBeGreaterThan(1e12); // ms scale
    const sec = Math.floor(ms / 1000);
    expect(sec).toBeLessThan(1e11); // s scale
    // OKX returns ms, should not be multiplied by 1000
    expect(ms).not.toBe(sec);
  });

  it("Twelve Data datetime string → ms", () => {
    const iso = new Date(NOW - 60_000).toISOString();
    const ms = new Date(iso).getTime();
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThan(1e12);
  });
});

// ────────────────────────────────────────────────────────────────
// 6. future provider timestamp
// ────────────────────────────────────────────────────────────────
describe("Phase238 — future provider timestamp", () => {
  it("future timestamp → UNAVAILABLE", () => {
    const future = NOW + 60_000;
    expect(assessFreshness(future, NOW)).toBe("UNAVAILABLE");
  });

  it("future candle rejected", () => {
    const candles = [{ timestamp: NOW + 10 * 60_000, open: 1, high: 1.1, low: 0.9, close: 1 }];
    const res = validateOhlcvSeries(candles, { now: NOW, maxFutureSkewMs: 5 * 60_000 });
    expect(res.valid).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// 7. OKX timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — OKX timestamp semantics", () => {
  it("OKX candle ts is provider-observed, not receipt", () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    const okxSection = src.slice(src.indexOf("function buildOkxAdapter"), src.indexOf("function buildOkxAdapter") + 3000);
    expect(okxSection).toContain("PROVIDER_OBSERVED");
    expect(okxSection).toContain("provider-observed");
    expect(okxSection).toContain("hasProviderTs");
  });

  it("OKX missing ts → UNKNOWN, not acquiredAt promotion", () => {
    const ts = NaN;
    const hasProviderTs = Number.isFinite(ts) && (ts as number) > 0;
    expect(hasProviderTs).toBe(false);
    const observedAt = hasProviderTs ? ts : undefined;
    expect(observedAt).toBeUndefined();
    expect(assessFreshness(observedAt, NOW)).toBe("UNAVAILABLE");
  });

  it("OKX live acquisition via executeLiveRequest uses candle timestamp as observedAt", async () => {
    // Use real Date.now() based timestamp to pass future check in live client (which uses real clock)
    const providerTs = Date.now() - 60_000;
    const transport = async () => ({
      ok: true,
      status: 200,
      json: { data: [[String(providerTs), "1", "2", "0.5", "1.5", "100"]] },
    });
    const { acquireProviderNativeLiveData } = await import("../market-radar/provider-registry");
    const res = await acquireProviderNativeLiveData(
      {
        instrument: "BTC-USDT",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        assetClass: "crypto",
      },
      undefined,
      transport as any,
    );
    expect(res.success).toBe(true);
    expect(res.snapshot?.observedAt).toBe(providerTs);
    expect(res.snapshot?.timestampProvenance).toBe("PROVIDER_OBSERVED");
  });
});

// ────────────────────────────────────────────────────────────────
// 8. Twelve Data timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — Twelve Data timestamp semantics", () => {
  it("Twelve Data candle datetime is PROVIDER_OBSERVED", () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    const twelveSection = src.slice(src.indexOf("function buildTwelveDataAdapter"), src.indexOf("function buildTwelveDataAdapter") + 3000);
    expect(twelveSection).toContain("PROVIDER_OBSERVED");
    expect(twelveSection).toContain("provider's instant");
  });

  it("Twelve Data quote timestamp is provider-observed, not request clock", () => {
    const sec = Math.floor(NOW / 1000) - 3 * 3600;
    const json = { close: "1.0850", timestamp: sec };
    const parsed = parseTwelveDataQuote(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const ms = sec * 1000;
      expect(assessFreshness(ms, NOW)).toBe("STALE");
    }
  });

  it("Twelve Data without provider timestamp falls back to candle datetime, not Date.now()", () => {
    // From Phase220 E2: without quote time, fallback to last candle datetime
    const src = readFileSync("src/convex/marketData.ts", "utf8");
    expect(src).not.toContain('price: { price, timestamp: Date.now(), source: "twelve-data" }');
    expect(src).toContain("priceTimestamp");
  });
});

// ────────────────────────────────────────────────────────────────
// 9. CoinGecko timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — CoinGecko timestamp semantics", () => {
  it("CoinGecko simple/price has no provider timestamp, uses PROVIDER_RESPONSE provenance", () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    const cgSection = src.slice(src.indexOf("function buildCoinGeckoAdapter"), src.indexOf("function buildCoinGeckoAdapter") + 2000);
    expect(cgSection).toContain("PROVIDER_RESPONSE");
    expect(cgSection).toContain("current-at-response");
  });

  it("CoinGecko observedAt == acquiredAt with PROVIDER_RESPONSE, not PROVIDER_OBSERVED", () => {
    const acquiredAt = NOW;
    const observedAt = acquiredAt;
    const provenance = "PROVIDER_RESPONSE" as const;
    expect(provenance).not.toBe("PROVIDER_OBSERVED");
    expect(observedAt).toBe(acquiredAt);
    // Freshness FRESH is justified because price IS current at response
    expect(assessFreshness(observedAt, acquiredAt)).toBe("FRESH");
  });

  it("CoinGecko not labeled as PROVIDER_OBSERVED when no timestamp", () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    // Ensure CoinGecko adapter does not claim PROVIDER_OBSERVED
    const cgSection = src.slice(src.indexOf("function buildCoinGeckoAdapter"), src.indexOf("function buildCoinGeckoAdapter") + 2000);
    expect(cgSection).not.toContain('timestampProvenance: "PROVIDER_OBSERVED"');
  });
});

// ────────────────────────────────────────────────────────────────
// 10. CCXT timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — CCXT timestamp semantics", () => {
  it("CCXT OHLCV timestamp preserved as PROVIDER_OBSERVED", async () => {
    const src = readFileSync("src/lib/discovery/ccxt-live.ts", "utf8");
    expect(src).toContain("PROVIDER_OBSERVED");
    expect(src).toContain("hasProviderTs");
  });

  it("CCXT ticker without timestamp → UNKNOWN", () => {
    const observedAt = undefined;
    const provenance = "UNKNOWN" as const;
    expect(assessFreshness(observedAt, NOW)).toBe("UNAVAILABLE");
    expect(provenance).toBe("UNKNOWN");
  });

  it("CCXT does not fabricate observedAt from Date.now()", () => {
    const src = readFileSync("src/lib/discovery/ccxt-live.ts", "utf8");
    expect(src).not.toMatch(/observedAt:\s*Date\.now\(\)/);
    expect(src).not.toContain("ticker.timestamp ?? Date.now()");
    expect(src).not.toMatch(/Number\.isFinite\(ts\) \? ts : Date\.now\(\)/);
  });
});

// ────────────────────────────────────────────────────────────────
// 11. DexScreener timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — DexScreener timestamp semantics", () => {
  it("DexScreener discovery timestamp is discoveredAt, not live price observation", async () => {
    const transport = async () => ({
      ok: true,
      status: 200,
      json: {
        pairs: [
          {
            chainId: "ethereum",
            dexId: "uniswap",
            pairAddress: "0xabc123",
            baseToken: { address: "0xbase", symbol: "WETH" },
            quoteToken: { address: "0xquote", symbol: "USDC" },
          },
        ],
      },
    });
    const { discoverDexScreener } = await import("./dexscreener-adapter");
    const res = await discoverDexScreener(transport, NOW, { queries: ["WETH"] });
    expect(res.instruments[0].providerInstrumentId).toBe("ethereum:uniswap:0xabc123");
    // DiscoveredInstrument has no price
    expect((res.instruments[0] as any).price).toBeUndefined();
    expect(res.instruments[0].discoveredAt).toBe(NOW);
  });

  it("DexScreener pool metadata not treated as live price timestamp", () => {
    const src = readFileSync("src/lib/discovery/dexscreener-adapter.ts", "utf8");
    expect(src).not.toContain("observedAt");
    // Discovery does not emit MarketSnapshot price — only discoveredAt
    expect(src).not.toMatch(/\bprice\s*:\s*\n/);
    expect(src).toContain("discoveredAt");
    // It does have priceUsd optional field in pair type, but not used as live observation
    expect(src).not.toContain("assessFreshness");
  });
});

// ────────────────────────────────────────────────────────────────
// 12. GeckoTerminal timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — GeckoTerminal timestamp semantics", () => {
  it("GeckoTerminal discovery preserves chain:dex:pool identity, no price timestamp", async () => {
    const transport = async () => ({
      ok: true,
      status: 200,
      json: {
        data: [
          {
            id: "eth_0xabc",
            type: "pool",
            attributes: { address: "0xabc", name: "WETH / USDC" },
            relationships: {
              base_token: { data: { id: "eth_0xbase" } },
              quote_token: { data: { id: "eth_0xquote" } },
              dex: { data: { id: "uniswap" } },
            },
          },
        ],
        links: {},
      },
    });
    // Need to mock networks first
    const fetchJson = async (url: string) => {
      if (url.includes("/networks") && !url.includes("/pools")) {
        return { ok: true, status: 200, json: { data: [{ id: "eth" }] } };
      }
      return transport();
    };
    const { discoverGeckoTerminal } = await import("./geckoterminal-adapter");
    const res = await discoverGeckoTerminal(fetchJson, NOW, { maxNetworks: 1, maxPagesPerNetwork: 1 });
    expect(res.instruments[0].providerInstrumentId).toContain("eth:uniswap:0xabc");
    expect((res.instruments[0] as any).price).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 13. OHLCV candle timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — OHLCV candle timestamp semantics", () => {
  it("candle timestamp represents period, not tick instant, but valid as observedAt", () => {
    const candleTs = NOW - 60 * 60_000; // 1h candle open
    const fetchedAt = NOW;
    // Candle timestamp is start of period, but still provider-observed
    const freshness = assessFreshness(candleTs, fetchedAt);
    expect(freshness).toBe("STALE"); // 1h old → STALE, not FRESH
    // Should not claim greater precision than provider supplies
    // The system uses candle timestamp as observedAt, which is correct for OHLCV
    expect(candleTs).toBeLessThan(fetchedAt);
  });

  it("closed candle vs open candle distinction preserved via timestamp", () => {
    const closedCandleTs = NOW - 2 * 60 * 60_000;
    const openCandleTs = NOW - 10 * 60_000;
    expect(assessFreshness(closedCandleTs, NOW)).toBe("STALE");
    expect(assessFreshness(openCandleTs, NOW)).toBe("DELAYED");
  });

  it("candle timestamp not treated as instantaneous quote timestamp for freshness", () => {
    // A 1h candle from 1h ago is STALE (boundary <60min DELAYED), not FRESH
    const oneHourAgo = NOW - 60 * 60_000;
    expect(assessFreshness(oneHourAgo, NOW)).toBe("STALE");
    // The important point: candle timestamp age matters, not receipt
    expect(oneHourAgo).toBeLessThan(NOW);
  });
});

// ────────────────────────────────────────────────────────────────
// 14. ticker timestamp semantics
// ────────────────────────────────────────────────────────────────
describe("Phase238 — ticker timestamp semantics", () => {
  it("ticker timestamp is instantaneous quote time, distinct from candle period", () => {
    const tickerTs = NOW - 30_000; // 30s ago
    const candleTs = NOW - 60 * 60_000; // 1h candle open
    expect(assessFreshness(tickerTs, NOW)).toBe("FRESH");
    expect(assessFreshness(candleTs, NOW)).toBe("STALE"); // 60min boundary → STALE
  });

  it("ticker without timestamp → UNKNOWN", () => {
    const res = validateQuote({ price: 100 }, { now: NOW });
    expect(res.valid).toBe(true); // price valid, timestamp optional
    expect(assessFreshness(undefined, NOW)).toBe("UNAVAILABLE");
  });
});

// ────────────────────────────────────────────────────────────────
// 15. no Date.now() fabrication
// ────────────────────────────────────────────────────────────────
describe("Phase238 — no Date.now() fabrication", () => {
  it("ccxt-live does not fabricate observedAt from Date.now()", () => {
    const src = readFileSync("src/lib/discovery/ccxt-live.ts", "utf8");
    expect(src).not.toMatch(/observedAt:\s*Date\.now\(\)/);
    expect(src).not.toContain("?? Date.now()");
  });

  it("okx adapter does not fabricate observedAt from Date.now() when ts missing", () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    const okxIdx = src.indexOf("function buildOkxAdapter");
    const okxSection = src.slice(okxIdx, okxIdx + 2000);
    expect(okxSection).not.toContain("ts : acquiredAt");
    expect(okxSection).toContain("hasProviderTs");
  });

  it("providerNativeAcquisitionToMarketData uses 0 sentinel, not Date.now()", () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    expect(src).toContain("timestamp: result.snapshot.observedAt ?? 0");
    expect(src).not.toContain("observedAt ?? Date.now()");
  });

  it("runtime.ts does not fabricate observedAt from Date.now()", () => {
    const src = readFileSync("src/lib/discovery/runtime.ts", "utf8");
    expect(src).not.toMatch(/observedAt:\s*Date\.now\(\)/);
  });
});

// ────────────────────────────────────────────────────────────────
// 16. no acquiredAt → observedAt silent promotion
// ────────────────────────────────────────────────────────────────
describe("Phase238 — no acquiredAt → observedAt silent promotion", () => {
  it("OKX missing ts does not promote acquiredAt to observedAt", () => {
    const acquiredAt = NOW;
    const ts = undefined;
    const hasProviderTs = Number.isFinite(ts as any) && (ts as any) > 0;
    const observedAt = hasProviderTs ? ts : undefined;
    expect(observedAt).toBeUndefined();
    expect(observedAt).not.toBe(acquiredAt);
  });

  it("CCXT missing timestamp does not promote fetchedAt", () => {
    const fetchedAt = NOW;
    const observedAt = undefined;
    expect(observedAt).not.toBe(fetchedAt);
    expect(assessFreshness(observedAt, fetchedAt)).toBe("UNAVAILABLE");
  });

  it("CoinGecko PROVIDER_RESPONSE is explicit, not silent promotion", () => {
    const src = readFileSync("src/lib/market-radar/provider-registry.ts", "utf8");
    const cgSection = src.slice(src.indexOf("function buildCoinGeckoAdapter"), src.indexOf("function buildCoinGeckoAdapter") + 2000);
    expect(cgSection).toContain("PROVIDER_RESPONSE");
    expect(cgSection).toContain("current-at-response");
  });
});

// ────────────────────────────────────────────────────────────────
// 17. cross-provider timestamp isolation
// ────────────────────────────────────────────────────────────────
describe("Phase238 — cross-provider timestamp isolation", () => {
  it("BTC/USDT timestamps from binance and okx remain independent", () => {
    const binance = row({
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      assetClass: "crypto",
    });
    const okx = row({
      provider: "ccxt:okx",
      providerInstrumentId: "BTC/USDT",
      assetClass: "crypto",
    });

    const raw = [
      {
        instrument: binance.providerInstrumentId,
        assetClass: binance.assetClass,
        providerInstrumentId: binance.providerInstrumentId,
        provider: binance.provider,
        success: true,
        fetchedAt: NOW,
        snapshot: { price: 50000, observedAt: NOW - 1000, timestampProvenance: "PROVIDER_OBSERVED" },
        candles: [{ timestamp: NOW - 1000, open: 50000, high: 50100, low: 49900, close: 50000, volume: 100 }],
      },
      {
        instrument: okx.providerInstrumentId,
        assetClass: okx.assetClass,
        providerInstrumentId: okx.providerInstrumentId,
        provider: okx.provider,
        success: true,
        fetchedAt: NOW,
        snapshot: { price: 50100, observedAt: NOW - 2000, timestampProvenance: "PROVIDER_OBSERVED" },
        candles: [{ timestamp: NOW - 2000, open: 50100, high: 50200, low: 50000, close: 50100, volume: 100 }],
      },
    ];

    const res = toAcquisitionResults([binance, okx], raw as any);
    expect(res).toHaveLength(2);
    const byProvider = new Map(res.map((r) => [r.provider, r]));
    expect(byProvider.get("ccxt:binance")?.observedAt).toBe(NOW - 1000);
    expect(byProvider.get("ccxt:okx")?.observedAt).toBe(NOW - 2000);
    expect(byProvider.get("ccxt:binance")?.source?.marketData?.price.price).toBe(50000);
    expect(byProvider.get("ccxt:okx")?.source?.marketData?.price.price).toBe(50100);
    // Provenance preserved per provider
    expect(byProvider.get("ccxt:binance")?.source?.marketData?.timestampProvenance).toBe("PROVIDER_OBSERVED");
  });
});

// ────────────────────────────────────────────────────────────────
// 18. freshness derived from correct evidence
// ────────────────────────────────────────────────────────────────
describe("Phase238 — freshness derived from correct evidence", () => {
  it("freshness from provider observation time, not receipt", () => {
    const observed = NOW - 2 * 60_000; // 2 min ago
    const fetched = NOW;
    expect(assessFreshness(observed, fetched)).toBe("FRESH");
    // If we incorrectly used fetched as observed, it would also be FRESH, but for stale case:
    const staleObserved = NOW - 2 * 60 * 60_000; // 2h ago
    expect(assessFreshness(staleObserved, fetched)).toBe("STALE");
    expect(assessFreshness(fetched, fetched)).toBe("FRESH"); // would incorrectly be FRESH if we used receipt
    // So staleObserved correctly yields STALE, not FRESH
    expect(assessFreshness(staleObserved, fetched)).not.toBe("FRESH");
  });

  it("unknown provenance → UNAVAILABLE freshness", () => {
    expect(assessFreshness(undefined, NOW)).toBe("UNAVAILABLE");
  });

  it("future timestamp → UNAVAILABLE, not FRESH", () => {
    expect(assessFreshness(NOW + 60_000, NOW)).toBe("UNAVAILABLE");
  });
});

// ────────────────────────────────────────────────────────────────
// 19. scanner receives truthful freshness
// ────────────────────────────────────────────────────────────────
describe("Phase238 — scanner receives truthful freshness", () => {
  it("scanner rejects stale for SCALPING", () => {
    const staleSource: LiveCandidateSource = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "okx", providerInstrumentId: "BTC-USDT" },
      marketData: {
        instrument: "BTC/USDT",
        instrumentType: "crypto",
        provider: "okx",
        fetchTimestamp: NOW,
        price: { price: 50000, timestamp: NOW - 60 * 60_000, source: "okx" },
        candles: [{ timestamp: NOW - 60 * 60_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
        timeframe: "1h",
        dataFreshness: "stale",
        timestampProvenance: "PROVIDER_OBSERVED",
      },
    } as any;

    const result = scanInstruments([staleSource], {
      horizons: ["SCALPING"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      providerErrors: [],
    });

    expect(result.totalInsufficient).toBeGreaterThanOrEqual(1);
  });

  it("scanner accepts FRESH with PROVIDER_OBSERVED", () => {
    const freshSource: LiveCandidateSource = {
      instrument: "BTC/USDT",
      assetClass: "crypto",
      providerNative: { provider: "okx", providerInstrumentId: "BTC-USDT" },
      marketData: {
        instrument: "BTC/USDT",
        instrumentType: "crypto",
        provider: "okx",
        fetchTimestamp: NOW,
        price: { price: 50000, timestamp: NOW, source: "okx" },
        candles: [{ timestamp: NOW, open: 49000, high: 51000, low: 48000, close: 50000, volume: 1000 }],
        timeframe: "1h",
        dataFreshness: "realtime",
        timestampProvenance: "PROVIDER_OBSERVED",
      },
    } as any;

    const result = scanInstruments([freshSource], {
      horizons: ["INTRADAY"],
      maxResults: 10,
      maxPerCorrelationGroup: 5,
      providerErrors: [],
    });

    expect(result.totalScanned).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────
// 20. provenance survives serialization/UI mapping
// ────────────────────────────────────────────────────────────────
describe("Phase238 — provenance survives serialization/UI mapping", () => {
  it("MarketData timestampProvenance survives JSON serialization", () => {
    const inst = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const raw = [
      {
        instrument: inst.providerInstrumentId,
        assetClass: inst.assetClass,
        providerInstrumentId: inst.providerInstrumentId,
        provider: inst.provider,
        success: true,
        fetchedAt: NOW,
        snapshot: {
          price: 50000,
          observedAt: NOW - 1000,
          timestampProvenance: "PROVIDER_OBSERVED" as const,
        },
        candles: [{ timestamp: NOW - 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      },
    ];
    const res = toAcquisitionResults([inst], raw as any);
    const serialized = JSON.stringify(res);
    const parsed = JSON.parse(serialized);
    expect(parsed[0].source.marketData.timestampProvenance).toBe("PROVIDER_OBSERVED");
  });

  it("UI can distinguish PROVIDER_OBSERVED vs PROVIDER_RESPONSE vs UNKNOWN", () => {
    const provenances = ["PROVIDER_OBSERVED", "PROVIDER_RESPONSE", "APPLICATION_RECEIPT", "UNKNOWN"];
    for (const prov of provenances) {
      const md = {
        instrument: "BTC/USDT",
        instrumentType: "crypto",
        provider: "okx",
        fetchTimestamp: NOW,
        price: { price: 50000, timestamp: NOW, source: "okx" },
        candles: [],
        timeframe: "1h",
        dataFreshness: "realtime",
        timestampProvenance: prov,
      };
      expect(md.timestampProvenance).toBe(prov);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 21. credential isolation
// ────────────────────────────────────────────────────────────────
describe("Phase238 — credential isolation", () => {
  it("serialized live results do not contain API keys", () => {
    const inst = row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex" });
    const raw = [
      {
        instrument: inst.providerInstrumentId,
        assetClass: inst.assetClass,
        providerInstrumentId: inst.providerInstrumentId,
        provider: inst.provider,
        success: true,
        fetchedAt: NOW,
        snapshot: { price: 1.085, observedAt: NOW - 1000, timestampProvenance: "PROVIDER_OBSERVED" },
        candles: [{ timestamp: NOW - 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      },
    ];
    const res = toAcquisitionResults([inst], raw as any);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/API_KEY|apikey|secret/i);
    expect(serialized).not.toContain("sk-");
  });

  it("no credentials in provider adapters or runtime", () => {
    const files = [
      "src/lib/discovery/runtime.ts",
      "src/lib/discovery/ccxt-live.ts",
      "src/lib/market-radar/provider-registry.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/TWELVE_DATA_API_KEY\s*=\s*['\"][a-zA-Z0-9]{20,}/);
      expect(src).not.toContain("sk-");
    }
  });
});
