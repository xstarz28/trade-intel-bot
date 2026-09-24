/**
 * Phase 272 — regression for the GENERALIZED live technical-analysis path.
 *
 * The Phase 271 OKX slice is now one leg of a single provider-native
 * live-OHLCV route. This suite proves, through the REAL production modules
 * (no production fallback, no mocked prices anywhere in the path):
 *
 *   1. A `ccxt:binance` discovered instrument reaches the SAME fetchMarketData
 *      → validate → envelope → technical → deterministic-engine pipeline as
 *      OKX, with its EXACT provider/native identity ("BTC/USDT") preserved
 *      through every request and returned in the result — never rewritten
 *      into another provider's symbol space.
 *   2. Provider refusal semantics: a provider identity with no verified live
 *      OHLCV leg (quote-only / discovery-only / unknown) yields an explicit
 *      "live technical analysis unavailable" failure — no symbol forwarded
 *      to any other provider, no analysis from substituted data.
 *   3. Validation parity: invalid candles are rejected per-record with the
 *      SAME validator the OKX leg enforces inside `executeLiveRequest`
 *      (never repaired), while quote-only exchange responses are refused
 *      as evidence for OHLCV indicators.
 *   4. Stale-provider CCXT payloads reach the engine as stale and cannot
 *      execute: NO_TRADE with the staleness disclosed; direction flips with
 *      the evidence exactly like the OKX leg.
 *
 * The only stub in this file is the network/exchange boundary itself:
 * `fetchMarketData`'s dynamic import of the acquisitor module is bridged to
 * the module's REAL implementation with the production DI seam
 * (`CcxtLiveDeps.createExchange`, mirroring the sibling discovery adapter),
 * whose exchange resolves its market data through this file's stubbed
 * global fetch — the same boundary the OKX suite stands on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Belt-and-suspenders exchange seam: the production fallback inside
// `acquireCcxtLive` lazily `require("ccxt")`s. Mocking the package itself
// guarantees that ANY resolution path — including a vitest dynamic-import
// race that hands the glue the unmocked module — still lands on this file's
// deterministic exchange and never on live network. The class returns the
// freshly installed exchange object directly (ccxt's class call returns an
// object; ours returns the test's object).
vi.mock("ccxt", () => {
  return {
    binance: class {
      constructor() {
        const factory = (globalThis as Record<string, unknown>).__phase272CreateExchange;
        if (typeof factory !== "function") {
          throw new Error("test did not install the exchange seam");
        }
        return factory();
      }
    },
    pro: {
      binance: class {
        constructor() {
          const factory = (globalThis as Record<string, unknown>).__phase272CreateExchange;
          if (typeof factory !== "function") {
            throw new Error("test did not install the exchange seam");
          }
          return factory();
        }
      },
    },
  };
});

// Bridge: the glue (fetchMarketData) imports the acquisitor module
// dynamically without deps. This mock delegates to the REAL implementation,
// supplying ONLY the exchange seam — every behavior under test (identity
// passthrough, provider-timestamp preservation, per-candle handling below
// the seam, failure classification, refusal of quote-only success) is the
// production code.
vi.mock("../lib/discovery/ccxt-live", async () => {
  const real = await vi.importActual<typeof import("../lib/discovery/ccxt-live")>(
    "../lib/discovery/ccxt-live",
  );
  type Deps = { createExchange?: (id: string) => unknown };
  return {
    ...real,
    acquireCcxtLive: (
      input: Parameters<typeof real.acquireCcxtLive>[0],
      readEnv?: Parameters<typeof real.acquireCcxtLive>[1],
      transport?: Parameters<typeof real.acquireCcxtLive>[2],
    ) =>
      real.acquireCcxtLive(input, readEnv, transport ?? undefined, {
        createExchange: ((globalThis as Record<string, unknown>).__phase272CreateExchange ??
          (() => {
            throw new Error("test did not install the exchange seam");
          })) as Deps["createExchange"] as never,
      }),
  } as typeof real & { acquireCcxtLive: typeof real.acquireCcxtLive };
});

import { fetchMarketData } from "./marketData";
import { runAnalysis, type AnalysisInput } from "../lib/analysis-engine";
import { ema } from "../lib/data/technical";
import { resolveLiveIdentity } from "../lib/discovery/live-identity";
import type { DiscoveredInstrument } from "../lib/discovery/types";
import type { TechnicalData } from "../lib/data/market-types";
import { mapCcxtTimeframe } from "../lib/discovery/ccxt-live";
import { resetProviderCache } from "../lib/data/provider-cache-registry";

// ─────────────────────────────────────────────────────────────────
// Harness: deterministic OHLC payloads behind the global fetch boundary
// ─────────────────────────────────────────────────────────────────

const BAR_MS: Record<string, number> = {
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
};

interface PayloadSpec {
  /** Timestamp of the NEWEST candle open (ms). */
  anchorTs: number;
  start: number;
  /** Per-candle drift of the close series (positive = uptrend). */
  slopePerBar: number;
  /** Exchange throws on every OHLCV request (acquisition failure mode). */
  fail?: boolean;
  /** Pollute the middle of the series with one physically impossible row. */
  injectReversed?: boolean;
  /** Exchange exposes no OHLCV for this symbol — quote-only degradation. */
  quoteOnly?: boolean;
  /** Ticker payload used when quoteOnly (success-shaped, no usable price). */
  tickerTs?: number;
}

let currentSpec: PayloadSpec = { anchorTs: 0, start: 0, slopePerBar: 0 };
const recordedRequests: Array<{ path: string; symbol: string; interval: string; limit: number }> = [];
let ohlcvCalls: Array<{ symbol: string; timeframe?: string; limit?: number }> = [];

/** Binance public-klines wire shape: ascending rows. */
function binanceRows(spec: PayloadSpec, tf: string, count: number): unknown[][] {
  const barMs = BAR_MS[tf];
  const rows: unknown[][] = [];
  for (let j = 0; j < count; j++) {
    const close = Math.max(
      1,
      spec.start + spec.slopePerBar * j + 200 * Math.sin(j * 0.55),
    );
    const open = close - 30;
    const high = close + 60;
    let low = close - 70;
    if (spec.injectReversed && j === Math.floor(count / 2)) {
      low = high + 10; // impossible candle — must be rejected individually
    }
    const ts = spec.anchorTs - (count - 1 - j) * barMs;
    rows.push([ts, open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2), "10", ts + barMs - 1]);
  }
  return rows;
}

function installNetwork(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String((input as Request)?.url ?? input);
      if (!url.startsWith("https://api.binance.com/api/v3/klines")) {
        throw new Error(`unexpected request in test: ${url}`);
      }
      const u = new URL(url);
      recordedRequests.push({
        path: u.origin + u.pathname,
        symbol: u.searchParams.get("symbol") ?? "",
        interval: u.searchParams.get("interval") ?? "",
        limit: Number(u.searchParams.get("limit") ?? "0"),
      });
      const body = binanceRows(currentSpec, u.searchParams.get("interval") ?? "1h", Number(u.searchParams.get("limit") ?? "100"));
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

/** Installs the production DI seam: an exchange that talks to the stubbed fetch router. */
function installExchange(): void {
  (globalThis as Record<string, unknown>).__phase272CreateExchange = () => ({
    id: "binance",
    has: { fetchOHLCV: true },
    async fetchOHLCV(symbol: string, timeframe?: string, _since?: number, limit?: number) {
      ohlcvCalls.push({ symbol, timeframe, limit });
      if (currentSpec.fail) throw new Error("simulated ccxt transport outage");
      if (currentSpec.quoteOnly) return [];
      const u = new URL("https://api.binance.com/api/v3/klines");
      u.searchParams.set("symbol", symbol.replace("/", ""));
      u.searchParams.set("interval", timeframe ?? "1h");
      u.searchParams.set("limit", String(limit ?? 100));
      const res = await fetch(u.toString());
      const rows = (await res.json()) as Array<[number, string, string, string, string, string]>;
      return rows.map((r) => [r[0], Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])]);
    },
    async fetchTicker(_symbol: string) {
      // Quote-only degradation: the exchange answers BUT with no timestamp —
      // the acquisitor must never fabricate observedAt from the request clock.
      return { symbol: _symbol, last: 51_000, timestamp: currentSpec.tickerTs };
    },
  });
}

function ctx() {
  return {
    auth: { getUserIdentity: async () => ({ subject: "u1", issuer: "test" }) },
  } as never;
}

function handlerOf<A, R>(a: unknown): (c: never, x: A) => Promise<R> {
  return (a as { _handler: (c: never, x: A) => Promise<R> })._handler;
}

const runFetchMarketData = handlerOf<
  Record<string, unknown>,
  {
    success: boolean;
    error?: string;
    errorCode?: string;
    acquisition?: string;
    observedAt?: number;
    data?: {
      provider?: string;
      providerInstrumentId?: string;
      dataFreshness?: string;
      candles?: Array<{ timestamp: number; close: number; high: number; low: number }>;
      price?: { price: number; timestamp: number; source?: string };
    };
    technical?: TechnicalData;
  }
>(fetchMarketData);

const nowSecondFloor = (offsetMs: number) =>
  Math.floor((Date.now() + offsetMs) / 1000) * 1000;

const TREND_UP = { start: 40_000, slopePerBar: 40 };
const TREND_DOWN = { start: 64_000, slopePerBar: -60 };

function expectedNewestClose(spec: PayloadSpec, count: number): number {
  const j = count - 1;
  return Math.max(1, spec.start + spec.slopePerBar * j + 200 * Math.sin(j * 0.55));
}

function engineInputFrom(env: Awaited<ReturnType<typeof runFetchMarketData>>): AnalysisInput {
  return {
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    timeframe: "M15",
    tradingStyle: "intraday",
    provider: "ccxt:binance",
    providerInstrumentId: "BTC/USDT",
    marketData: env.data,
    technicalData: env.technical,
  } as unknown as AnalysisInput;
}

const ccxtBtcRow: DiscoveredInstrument = {
  provider: "ccxt:binance",
  providerInstrumentId: "BTC/USDT",
  assetClass: "crypto",
  subType: "crypto_spot",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  tradingState: "TRADING",
  capabilities: ["ohlcv", "quote"],
  discoveredAt: Date.now(),
};

beforeEach(() => {
  resetProviderCache();
  delete process.env.TWELVE_DATA_API_KEY; // prove no cross-provider fallback participates
  recordedRequests.length = 0;
  ohlcvCalls = [];
  installNetwork();
  installExchange();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
  delete (globalThis as Record<string, unknown>).__phase272CreateExchange;
});

// ─────────────────────────────────────────────────────────────────
// 1. THE CCXT LEG THROUGH THE SAME LIVE PIPELINE
// ─────────────────────────────────────────────────────────────────

describe("ccxt:binance reaches the same live-OHLCV technical pipeline as OKX", () => {
  it("acquires exactly the native identity, returns provider price/time, derives technicals uphill", async () => {
    const anchorTs = nowSecondFloor(-30_000);
    currentSpec = { anchorTs, ...TREND_UP };

    const env = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });

    expect(env.success).toBe(true);
    expect(env.data?.provider).toBe("ccxt:binance");
    expect(env.data?.providerInstrumentId).toBe("BTC/USDT");
    expect(env.data?.price?.source).toBe("ccxt:binance");

    // The exchange seam was handed EXACTLY the provider-native identity,
    // once per timeframe in the chain, nothing substituted.
        expect(ohlcvCalls.length).toBe(3); // setup M15 + macro H4 + trigger M5 (M15's chain slots)
    for (const call of ohlcvCalls) {
      expect(call.symbol).toBe("BTC/USDT");
    }
    expect(ohlcvCalls.map((c) => c.timeframe).sort()).toEqual(["15m", "1h", "4h"]);
    expect(ohlcvCalls.map((c) => c.limit).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([120, 120, 210]);

    // Wire-level identity: the exchange id mapping is BTCUSDT, built from
    // the native id — visible at the (stubbed) network boundary.
    for (const r of recordedRequests) {
      expect(r.symbol).toBe("BTCUSDT");
    }
    expect(recordedRequests.map((r) => r.interval).sort()).toEqual(["15m", "1h", "4h"]);

    // Price = newest candle close; timestamp = provider-observed time.
    const expectedClose = Number(expectedNewestClose(currentSpec, 210).toFixed(2));
    expect(env.data?.price?.price).toBe(expectedClose);
    expect(env.data?.price?.timestamp).toBe(anchorTs);
    expect(env.data?.candles?.length).toBe(210);
    const lastCandle = env.data!.candles![env.data!.candles!.length - 1];
    expect(lastCandle.timestamp).toBe(anchorTs);

    // Same envelope semantics as the OKX leg: uncached live read, provider
    // observation time of the setup series — never the request clock.
    expect(env.acquisition).toBe("observed-now");
    expect(env.observedAt).toBe(anchorTs);

    // Technicals from the SAME candles (re-derived here from the evidence).
    const tech = env.technical!;
    const closes = env.data!.candles!.map((c) => c.close);
    expect(tech.dataPoints).toBe(210);
    expect(tech.ema20).toBeCloseTo(ema(closes, 20)[closes.length - 1], 9);
    expect(tech.ema50).toBeCloseTo(ema(closes, 50)[closes.length - 1], 9);
    expect(tech.ema20!).toBeGreaterThan(tech.ema50!);
    expect(tech.rsi14!).toBeGreaterThan(60);
    expect(tech.atr14!).toBeGreaterThan(0);
    expect(tech.structure).toBe("HH/HL");
    expect(tech.supportLevels.length + tech.resistanceLevels.length).toBeGreaterThan(0);
  });

  it("the SAME deterministic engine consumes the ccxt evidence — complete slice result", async () => {
    const anchorTs = nowSecondFloor(-30_000);
    currentSpec = { anchorTs, ...TREND_UP };
    const env = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });
    expect(env.success).toBe(true);

    const cloneInput = () => JSON.parse(JSON.stringify(engineInputFrom(env))) as AnalysisInput;
    const result = runAnalysis(cloneInput());
    const again = runAnalysis(cloneInput());
    const normalize = (r: typeof result) =>
      JSON.parse(JSON.stringify({ ...r, id: "", timestamp: 0 })) as Record<string, unknown>;
    expect(normalize(again)).toEqual(normalize(result));

    // Provider provenance reached the result surface like any live leg.
    expect(result.dataSource).toBe("ccxt:binance");
    expect(result.priceSnapshot!.price).toBeCloseTo(env.data!.price!.price, 9);
    expect(result.priceSnapshot!.timestamp).toBe(anchorTs);

    expect(["Bullish", "Bearish", "Neutral"]).toContain(result.bias);
    expect(result.confidence).toBeGreaterThanOrEqual(20);
    expect(result.confidence).toBeLessThanOrEqual(99);
    expect(["LONG", "SHORT", "NO_TRADE"]).toContain(result.recommendation);

    expect(result.keyLevels.support.length).toBeGreaterThan(0);
    expect(Number.isFinite(Number(result.keyLevels.support))).toBe(true);
    if (result.keyLevels.resistance.length > 0) {
      expect(Number.isFinite(Number(result.keyLevels.resistance))).toBe(true);
    }

    if (result.recommendation !== "NO_TRADE") {
      expect(result.tradePlan).toBeDefined();
      expect(result.keyLevels.invalidation).toBe(result.tradePlan!.stopLoss);
      const stop = Number(result.keyLevels.invalidation.match(/[\d.]+/)?.[0]);
      const entry = Number(result.tradePlan!.entry.match(/[\d.]+/)?.[0]);
      if (result.recommendation === "LONG") expect(stop).toBeLessThan(entry);
      else expect(stop).toBeGreaterThan(entry);
    } else {
      expect(result.noTradeReasons.length).toBeGreaterThan(0);
    }

    expect(result.technicalSummary).toMatch(/EMA\(20\)/);
    expect(result.technicalSummary).toMatch(/ATR\(14\)/);
    expect(result.technicalSummary).toMatch(/Key support/);
  });

  it("direction flips with the evidence on the ccxt leg — the analysis is not a constant", async () => {
    const anchorTs = nowSecondFloor(-30_000);
    currentSpec = { anchorTs, ...TREND_UP };
    const upEnv = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });
    expect(upEnv.success).toBe(true);

    currentSpec = { anchorTs, ...TREND_DOWN };
    const downEnv = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });
    expect(downEnv.success).toBe(true);

    expect(upEnv.technical!.rsi14!).toBeGreaterThan(downEnv.technical!.rsi14!);
    expect(upEnv.technical!.structure).toBe("HH/HL");
    expect(downEnv.technical!.structure).toBe("LH/LL");
    expect(upEnv.technical!.ema20!).toBeGreaterThan(upEnv.technical!.ema50!);
    expect(downEnv.technical!.ema20!).toBeLessThan(downEnv.technical!.ema50!);

    const up = runAnalysis(engineInputFrom(upEnv));
    const down = runAnalysis(engineInputFrom(downEnv));
    expect(up.priceSnapshot!.price).not.toBeCloseTo(down.priceSnapshot!.price, 6);
    expect(up.keyLevels.support).not.toBe(down.keyLevels.support);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. VALIDATION PARITY + REFUSAL SEMANTICS
  // ─────────────────────────────────────────────────────────────

  it("invalid candles are rejected per-record with the same validator — never repaired", async () => {
    const anchorTs = nowSecondFloor(-30_000);
    currentSpec = { anchorTs, ...TREND_UP, injectReversed: true };

    const env = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });

    expect(env.success).toBe(true);
    // 210 rows arrived; exactly one was physically impossible and rejected.
    expect(env.data?.candles?.length).toBe(209);
    // Every accepted candle is OHLC-coherent — the impossible row did not
    // leak a fabricated candle into the evidence.
    for (const c of env.data!.candles!) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.close, c.low));
      expect(c.low).toBeLessThanOrEqual(c.close);
    }
  });

  it("a quote-only exchange response is NOT evidence for OHLCV indicators — refused, nothing substituted", async () => {
    currentSpec = { anchorTs: nowSecondFloor(-30_000), ...TREND_UP, quoteOnly: true };
    const env = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });
    expect(env.success).toBe(false);
    expect(env.data).toBeUndefined();
    expect(env.technical).toBeUndefined();
    expect(env.error).toMatch(/401|500|usable|no candle|unavailable|error/i);
  });

  it("stale-provider payload survives as stale evidence, and the engine refuses to execute on it", async () => {
    const staleAnchor = nowSecondFloor(-72 * 3_600_000);
    currentSpec = { anchorTs: staleAnchor, ...TREND_UP };

    const env = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });
    expect(env.success).toBe(true);
    // 72-hour-old provider time must survive as 72 hours old.
    expect(env.observedAt).toBe(staleAnchor);
    expect(env.data?.price?.timestamp).toBe(staleAnchor);

    const result = runAnalysis(engineInputFrom(env));
    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.tradePlan).toBeUndefined();
    expect(result.noTradeReasons.join(" ")).toMatch(/stale/i);
    expect(result.priceSnapshot!.timestamp).toBe(staleAnchor);
  });

  it("acquisition outage on the ccxt leg is a classified failure with NO data", async () => {
    currentSpec = { anchorTs: nowSecondFloor(-30_000), ...TREND_UP, fail: true };
    const env = await runFetchMarketData(ctx(), {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
    });
    expect(env.success).toBe(false);
    expect(env.data).toBeUndefined();
    expect(env.technical).toBeUndefined();
    expect(typeof env.error).toBe("string");
    expect(env.errorCode).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────
  // 3. UNSUPPORTED CAPABILITY → EXPLICIT UNAVAILABLE
  // ─────────────────────────────────────────────────────────────

  it("a provider with no verified live-OHLCV leg gets an explicit refusal — no symbol forwarded", async () => {
    for (const provider of ["geckoterminal", "dexscreener", "coingecko", "idx"]) {
      const before = recordedRequests.length;
      const env = await runFetchMarketData(ctx(), {
        instrument: "whatever",
        instrumentType: "crypto",
        timeframe: "M15",
        provider,
        providerInstrumentId: "some-native-id",
      });
      expect(env.success).toBe(false);
      expect(env.errorCode).toBe("NO_LIVE_DATA");
      expect(env.error).toMatch(/live technical analysis unavailable/i);
      expect(env.error).toMatch(/no fallback|no symbol substitution|substitution/i);
      // Nothing was requested from any other provider on its behalf.
      expect(recordedRequests.length).toBe(before);
    }
  });

  it("the ccxt timeframe mapper is exact — unsupported bars stay undefined, never defaulted", () => {
    expect(mapCcxtTimeframe("M15")).toBe("15m");
    expect(mapCcxtTimeframe("M5")).toBe("5m");
    expect(mapCcxtTimeframe("H1")).toBe("1h");
    expect(mapCcxtTimeframe("H4")).toBe("4h");
    expect(mapCcxtTimeframe("D1")).toBe("1d");
    expect(mapCcxtTimeframe("W1")).toBe("1w");
    expect(mapCcxtTimeframe("1h")).toBe("1h");
    expect(mapCcxtTimeframe("m3")).toBeUndefined();
    expect(mapCcxtTimeframe("M3")).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────
  // 4. IDENTITY THROUGH DISCOVERY
  // ─────────────────────────────────────────────────────────────

  it("a discovered ccxt row resolves to its exact native id through the identity gate", () => {
    const identity = resolveLiveIdentity({
      typed: "BTC/USDT",
      instrumentType: "crypto",
      provider: "ccxt:binance",
      providerInstrumentId: "BTC/USDT",
      discovered: [ccxtBtcRow],
    });
    expect(identity.ok).toBe(true);
    if (identity.ok) {
      expect(identity.provider).toBe("ccxt:binance");
      expect(identity.providerInstrumentId).toBe("BTC/USDT");
      expect(identity.assetClass).toBe("crypto");
    }
  });

  it("typed BTC/USDT without discovery is SYMBOL_UNSUPPORTED — never an implicit listing", () => {
    const identity = resolveLiveIdentity({
      typed: "BTC/USDT",
      instrumentType: "crypto",
      discovered: [],
    });
    expect(identity.ok).toBe(false);
  });

  it("the okx leg in the same discovered world keeps its own exact id (no cross-provider drift)", () => {
    const okxRow: DiscoveredInstrument = {
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      assetClass: "crypto",
      subType: "crypto_spot",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING",
      capabilities: ["ohlcv", "quote"],
      discoveredAt: Date.now(),
    };
    const identity = resolveLiveIdentity({
      typed: "BTC-USDT",
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      discovered: [ccxtBtcRow, okxRow],
    });
    expect(identity.ok).toBe(true);
    if (identity.ok) {
      expect(identity.provider).toBe("okx");
      expect(identity.providerInstrumentId).toBe("BTC-USDT");
    }
  });
});
