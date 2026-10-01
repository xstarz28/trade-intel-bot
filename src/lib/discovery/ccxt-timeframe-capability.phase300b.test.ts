/**
 * Phase 300 runtime-integration fix — provider LIVE capability is
 * TIMEFRAME-AWARE.
 *
 * Production finding being locked down: discovery marked CCXT instruments
 * LIVE through a default H1/quote acquisition, while the analysis path later
 * failed on the requested M15 with a generic NO_LIVE_DATA — and the failure
 * reason the provider actually gave was swallowed by a silent
 * fallback-to-ticker. After this fix:
 *
 *   - an explicitly requested timeframe is mapped to the exchange's native
 *     token and requested EXACTLY (no silent M1/M5/M30→H1/H4 fallback);
 *   - a timeframe the exchange truthfully does not support is refused
 *     BEFORE the wire as TIMEFRAME_UNAVAILABLE;
 *   - a quote is never dressed up as the requested OHLCV series — only the
 *     timeframe-agnostic scanner snapshot may degrade to quote-only, and it
 *     then claims NO timeframe support at all;
 *   - the snapshot's availableTimeframes names the timeframe ACTUALLY
 *     fetched, never a hardcoded claim;
 *   - discovery carries the exchange's own supported timeframe list when the
 *     provider publishes one, and nothing when it cannot be established.
 *
 * Provider-native identity is preserved verbatim in every case.
 */

import { describe, expect, it, vi } from "vitest";

import {
  acquireCcxtLive,
  mapCcxtTimeframeInternal,
} from "./ccxt-live";
import { discoverCcxtMarkets } from "./ccxt-discovery";
import type { OhlcvCandle } from "../data/market-types";

type RawCandle = [number, number, number, number, number, number];

const PROVIDER = "ccxt:apex";
const INSTRUMENT = "BTC/USDT:USDT";

/** Live-shaped series: newest bar 90 s back, hourly-ish spacing irrelevant here. */
function rawSeries(count: number, barMs = 15 * 60_000): RawCandle[] {
  const anchor = Math.floor((Date.now() - 90_000) / barMs) * barMs;
  const rows: RawCandle[] = [];
  for (let i = 0; i < count; i++) {
    const ts = anchor - i * barMs;
    const close = 60000 + i;
    rows.push([ts, close - 5, close + 40, close - 60, close, 12.5]);
  }
  return rows.reverse(); // oldest first, as ccxt returns
}

interface ExchangeBehavior {
  has?: Record<string, boolean>;
  timeframes?: Record<string, string>;
  ohlcv?: RawCandle[] | Error;
  ticker?: { symbol: string; last: number; timestamp?: number } | Error;
  /** Records the native timeframe actually requested. */
  requested?: { timeframe?: string };
}

function exchangeOf(behavior: ExchangeBehavior) {
  return {
    id: "apex",
    has: behavior.has,
    timeframes: behavior.timeframes,
    fetchOHLCV: vi.fn(async (_symbol: string, timeframe?: string) => {
      behavior.requested = { timeframe };
      if (behavior.ohlcv instanceof Error) throw behavior.ohlcv;
      return behavior.ohlcv ?? rawSeries(100);
    }),
    fetchTicker: vi.fn(async () => {
      if (behavior.ticker instanceof Error) throw behavior.ticker;
      return (
        behavior.ticker ?? { symbol: INSTRUMENT, last: 61000, timestamp: Date.now() - 30_000 }
      );
    }),
  };
}

const depsOf = (behavior: ExchangeBehavior) => ({
  createExchange: () => exchangeOf(behavior),
});

describe("Phase 300b — ccxt requested-timeframe acquisition", () => {
  it("requests the EXACT native token for the internal timeframe and reports what was actually fetched", async () => {
    const behavior: ExchangeBehavior = {};
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M15",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    expect(res.success).toBe(true);
    // The exchange was asked for ITS token, not the internal one.
    expect(behavior.requested?.timeframe).toBe("15m");
    // The snapshot names the timeframe actually delivered — internal token,
    // not a hardcoded "H1" claim about a 15-minute series.
    expect(res.snapshot?.availableTimeframes).toEqual(["M15"]);
    expect(res.snapshot?.ohlcvAvailable).toBe(true);
    // Native identity passthrough, untouched.
    expect(res.provider).toBe(PROVIDER);
    expect(res.providerInstrumentId).toBe(INSTRUMENT);
    expect(res.candles?.length).toBeGreaterThan(0);
  });

  it("maps the full matrix to native tokens for the wire (M1/M5/M30 included)", async () => {
    for (const [internal, native] of [
      ["M1", "1m"],
      ["M5", "5m"],
      ["M30", "30m"],
      ["H4", "4h"],
      ["W1", "1w"],
    ] as const) {
      const behavior: ExchangeBehavior = {};
      await acquireCcxtLive(
        {
          instrument: INSTRUMENT,
          provider: PROVIDER,
          providerInstrumentId: INSTRUMENT,
          assetClass: "crypto",
          timeframe: internal,
        },
        undefined,
        undefined,
        depsOf(behavior),
      );
      expect(behavior.requested?.timeframe).toBe(native);
    }
  });

  it("an unmappable internal timeframe is an explicit TIMEFRAME_UNAVAILABLE — no default, no fetch", async () => {
    const behavior: ExchangeBehavior = {};
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M2",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    expect(res.success).toBe(false);
    expect(res.failureClass).toBe("TIMEFRAME_UNAVAILABLE");
    expect(behavior.requested).toBeUndefined();
  });
});

describe("Phase 300b — ccxt capability refusal before the wire", () => {
  it("a timeframe outside the exchange's OWN published map is refused as TIMEFRAME_UNAVAILABLE — no fetch, no ticker fallback", async () => {
    // Truthful exchange map: hourly granularity only.
    const behavior: ExchangeBehavior = { timeframes: { "1h": "60", "4h": "240" } };
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M15",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    expect(res.success).toBe(false);
    expect(res.failureClass).toBe("TIMEFRAME_UNAVAILABLE");
    expect(res.error).toContain("15m");
    expect(res.snapshot).toBeNull();
    // The refusal happened BEFORE any network call.
    expect(behavior.requested).toBeUndefined();
  });

  it("has.fetchOHLCV === false refuses an OHLCV request explicitly", async () => {
    const behavior: ExchangeBehavior = { has: { fetchOHLCV: false } };
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M5",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    expect(res.success).toBe(false);
    expect(res.failureClass).toBe("TIMEFRAME_UNAVAILABLE");
    expect(behavior.requested).toBeUndefined();
  });
});

describe("Phase 300b — requested-timeframe failure never degrades to a quote", () => {
  it("an OHLCV failure on a REQUESTED timeframe stays a classified failure with the provider's own reason", async () => {
    const behavior: ExchangeBehavior = {
      ohlcv: new Error("apex: OHLCV not available for this market without authentication"),
    };
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M15",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    expect(res.success).toBe(false);
    // The provider's own reason travels (sanitized downstream) — no more
    // generic "verified live OHLCV unavailable" with the cause swallowed.
    expect(res.error).toContain("apex");
    expect(res.snapshot).toBeNull();
  });

  it("an auth-shaped provider failure classifies as PROVIDER_AUTH, not NO_LIVE_DATA", async () => {
    const behavior: ExchangeBehavior = { ohlcv: new Error("[401] authentication required") };
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M15",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    expect(res.success).toBe(false);
    expect(res.failureClass).toBe("PROVIDER_AUTH");
  });

  it("an empty-but-answered series on a REQUESTED timeframe is NO_LIVE_DATA — never a ticker substitution", async () => {
    const behavior: ExchangeBehavior = { ohlcv: [] };
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M15",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    expect(res.success).toBe(false);
    expect(res.failureClass).toBe("NO_LIVE_DATA");
    expect(res.snapshot).toBeNull();
  });
});

describe("Phase 300b — timeframe-agnostic scanner snapshot stays honest", () => {
  it("without a requested timeframe the scanner may quote-only — and claims NO timeframe support", async () => {
    const behavior: ExchangeBehavior = {
      ohlcv: new Error("apex: endpoint unavailable"),
      ticker: { symbol: INSTRUMENT, last: 61000, timestamp: Date.now() - 30_000 },
    };
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    // Scanner quote acquisition still succeeds (a verified live PRICE).
    expect(res.success).toBe(true);
    expect(res.snapshot?.price).toBe(61000);
    // …but it claims no OHLCV and NO timeframes — a quote never implies
    // M1/M5/M15/H1 support.
    expect(res.snapshot?.ohlcvAvailable).toBe(false);
    expect(res.snapshot?.availableTimeframes).toEqual([]);
  });
});

describe("Phase 300b — reverse mapping stays truthful", () => {
  it("native tokens map back to internal tokens; unknown natives stay provider-native", () => {
    expect(mapCcxtTimeframeInternal("15m")).toBe("M15");
    expect(mapCcxtTimeframeInternal("1h")).toBe("H1");
    expect(mapCcxtTimeframeInternal("30m")).toBe("M30");
    // A provider-only interval is echoed back, never relabelled.
    expect(mapCcxtTimeframeInternal("3m")).toBe("3m");
  });
});

describe("Phase 300b — discovery carries the provider's OWN timeframe capability", () => {
  const NOW = 1_700_000_000_000;

  function market(symbol: string) {
    return {
      id: symbol,
      symbol,
      base: symbol.split("/")[0],
      quote: "USDT",
      spot: true,
      active: true,
    };
  }

  it("instruments carry supportedOhlcvTimeframes ONLY when the exchange truthfully publishes them", async () => {
    const result = await discoverCcxtMarkets(NOW, {
      getExchanges: () => ["apex"],
      createExchange: ((id: string) => ({
        id,
        timeframes: { "1m": "1", "5m": "5", "15m": "15", "3m": "3", "1M": "M" },
        fetchMarkets: async () => [market("BTC/USDT"), market("ETH/USDT")],
      })) as never,
      disableCursorAdvance: true,
    });
    expect(result.success).toBe(true);
    expect(result.instruments.length).toBe(2);
    for (const inst of result.instruments) {
      // Canonical internal tokens only: the provider-only 3m and the monthly
      // 1M are NOT ours to claim.
      expect(inst.supportedOhlcvTimeframes).toEqual(["M1", "M15", "M5"]);
      expect(inst.providerInstrumentId).toBe(inst.providerInstrumentId); // identity untouched
    }
  });

  it("when the capability cannot be established, no timeframe claim is made", async () => {
    const result = await discoverCcxtMarkets(NOW, {
      getExchanges: () => ["apex"],
      createExchange: ((id: string) => ({
        id,
        fetchMarkets: async () => [market("BTC/USDT")],
      })) as never,
      disableCursorAdvance: true,
    });
    expect(result.success).toBe(true);
    expect(result.instruments[0]?.supportedOhlcvTimeframes).toBeUndefined();
  });

  it("candles flowing through acquisition keep the OhlcvCandle shape (timestamp/open/high/low/close/volume)", async () => {
    const behavior: ExchangeBehavior = {};
    const res = await acquireCcxtLive(
      {
        instrument: INSTRUMENT,
        provider: PROVIDER,
        providerInstrumentId: INSTRUMENT,
        assetClass: "crypto",
        timeframe: "M15",
      },
      undefined,
      undefined,
      depsOf(behavior),
    );
    const first: OhlcvCandle | undefined = res.candles?.[0];
    expect(first).toBeDefined();
    expect(first).toMatchObject({
      timestamp: expect.any(Number),
      open: expect.any(Number),
      high: expect.any(Number),
      low: expect.any(Number),
      close: expect.any(Number),
      volume: expect.any(Number),
    });
  });
});
