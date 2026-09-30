/**
 * Phase 298 — BTC and XAU through the SHIPPED runtime path.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * --------------------------------------
 * The runtime path this suite drives is the product's own:
 *
 *   InstrumentInput shape → protected analysis (the Dashboard's action)
 *   → provider-native live acquisition (OKX / Twelve Data) → OHLCV
 *   → technical engine + SMC/structure/liquidity read
 *   → unified analysis / recommendation → scanner radar.
 *
 * The ONLY non-production layer is the provider HTTP response body, which is a
 * DESIGNED fixture (a provider-shaped candle series with real swings, anchored
 * to this process's clock so the engine's freshness rules see a live-shaped
 * series). Every request URL, envelope, validation step, technical computation,
 * gate and recommendation is the shipped one, and the suite asserts on the URLs
 * the path actually requested — so a substitution would be visible.
 *
 * This is NOT live verification and must never be reported as such: whether the
 * real providers answer correctly is decided by the live suite
 * (`four-asset-live-smoke.phase283.live.test.ts`) and by the deployed-runtime
 * smoke, both of which need credentials/egress this environment does not have.
 *
 * Instruments verified specifically:
 *   BTC  — provider `okx`, native id `BTC-USDT`, crypto, provider-native OHLCV.
 *   XAU  — provider `twelve-data`, native id `XAU/USD`, commodity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import { runProtectedAnalysis } from "./protectedAnalysis";
import {
  fetchMarketData,
  medianBarSpacingMs,
  providerSeriesFreshness,
} from "./marketData";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { scanInstruments } from "../lib/liveScanner";
import type { LiveCandidateSource } from "../lib/liveCandidateBuilder";

type Envelope = {
  success?: boolean;
  error?: string;
  errorCode?: string;
  data?: {
    provider?: string;
    providerInstrumentId?: string;
    instrumentType?: string;
    timeframe?: string;
    dataFreshness?: string;
    fetchTimestamp?: number;
    candles?: Array<{ timestamp: number; close: number }>;
    price?: { price: number; timestamp: number; source?: string };
  };
  technical?: { dataPoints?: number; smc?: unknown } | null;
  observedAt?: number;
  acquisition?: string;
};

type ProtectedResponse = {
  status: string;
  result?: {
    instrument?: string;
    instrumentType?: string;
    provider?: string;
    providerInstrumentId?: string;
    recommendation?: string;
    bias?: string;
    confidence?: number;
    timeframe?: string;
    setupState?: string;
    noTradeReasons?: string[];
    dataFlags?: string[];
    tradePlan?: unknown;
  };
  error?: string;
  errorCode?: string;
};

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

const fetchMarket = handlerOf<Record<string, unknown>, Envelope>(fetchMarketData);
const runProtected = handlerOf<{ input: Record<string, unknown> }, ProtectedResponse>(
  runProtectedAnalysis,
);

const REAL_HANDLERS: Record<string, (c: never, a: never) => Promise<unknown>> = {
  "marketData:fetchMarketData": fetchMarket as never,
};

function testCtx(subject = "user_phase298") {
  return {
    auth: { getUserIdentity: async () => ({ subject, issuer: "test" }) },
    // DB-backed collaborators only (entitlement + caller resolution). No
    // provider-facing work is stubbed.
    runMutation: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === "protectedAnalysis:resolveAndConsume") {
        return {
          allowed: true,
          plan: "pro",
          remaining: 5,
          charged: true,
          upgradeRequired: false,
          reason: "test entitlement",
        };
      }
      return "user_stub";
    },
    runQuery: async () => null,
    runAction: async (ref: unknown, args: unknown) => {
      let name = "";
      try {
        name = getFunctionName(ref as never);
      } catch {
        return { success: false, error: "unknown leg" };
      }
      const handler = REAL_HANDLERS[name];
      if (!handler) {
        // Optional intelligence legs (calendar, derivatives, COT, EIA, treasury,
        // Alpha Vantage) are deliberately unavailable here: the runtime path
        // must still deliver, and must report them as absent rather than filled.
        return { success: false, error: `leg ${name} unavailable in this run` };
      }
      return handler(testCtx(subject) as never, args as never);
    },
  } as never;
}

// ─────────────────────────────────────────────────────────────────
// Fixtures — provider-shaped payloads at the HTTP boundary
// ─────────────────────────────────────────────────────────────────

const BTC_BAR_MS = 15 * 60_000; // the setup timeframe this suite requests
const XAU_BAR_MS = 4 * 60 * 60_000; // H4

/** Bar open: one and a half minutes back, floored to the bar — live-shaped. */
const anchorFor = (barMs: number) => Math.floor((Date.now() - 90_000) / barMs) * barMs;

interface Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function candleSeries(opts: {
  count: number;
  base: number;
  slope: number;
  amplitude: number;
  barMs: number;
  /** Shift the whole series back in time (a stale provider series). */
  ageDays?: number;
}): Bar[] {
  const anchor = anchorFor(opts.barMs) - (opts.ageDays ?? 0) * 86_400_000;
  const rows: Bar[] = [];
  for (let i = 0; i < opts.count; i++) {
    const j = opts.count - 1 - i; // 0 = oldest
    const close = opts.base + opts.slope * j + opts.amplitude * Math.sin(j * 0.55);
    const open = opts.base + opts.slope * j + opts.amplitude * Math.sin((j - 1) * 0.55);
    rows.push({
      ts: anchor - i * opts.barMs,
      open: Number(open.toFixed(4)),
      high: Number((Math.max(open, close) + opts.amplitude * 0.2).toFixed(4)),
      low: Number((Math.min(open, close) - opts.amplitude * 0.2).toFixed(4)),
      close: Number(close.toFixed(4)),
    });
  }
  return rows; // newest first
}

const BTC = candleSeries({ count: 210, base: 61_000, slope: 55, amplitude: 260, barMs: BTC_BAR_MS });
const XAU = candleSeries({ count: 210, base: 2_420, slope: 0.35, amplitude: 6.5, barMs: XAU_BAR_MS });
const XAU_STALE = candleSeries({
  count: 210,
  base: 2_420,
  slope: 0.35,
  amplitude: 6.5,
  barMs: XAU_BAR_MS,
  ageDays: 4,
});

/** OKX v5 array rows: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]. */
const okxRows = (bars: Bar[]) =>
  bars.map((b) => [
    String(b.ts),
    String(b.open),
    String(b.high),
    String(b.low),
    String(b.close),
    "10",
    "0",
    "0",
    "1",
  ]);

const twelveValues = (bars: Bar[]) =>
  bars.map((b) => ({
    datetime: new Date(b.ts).toISOString().slice(0, 19).replace("T", " "),
    open: String(b.open),
    high: String(b.high),
    low: String(b.low),
    close: String(b.close),
    volume: "1000",
  }));

interface Wire {
  /** Reject the primary Twelve Data candle leg with this HTTP status. */
  twelveStatus?: number;
  /** Serve a short series (insufficient OHLCV) instead of the full one. */
  shortSeries?: boolean;
  /** Serve a 4-day-old series (stale, not live) — candles and quote alike. */
  stale?: boolean;
}

let requestedUrls: string[] = [];

function responder(wire: Wire) {
  const xauBars = wire.stale ? XAU_STALE : wire.shortSeries ? XAU.slice(0, 4) : XAU;
  return (url: string): unknown => {
    if (
      url.includes("okx.com/api/v5/market/candles") ||
      url.includes("okx.com/api/v5/market/history-candles")
    ) {
      const u = new URL(url);
      const instId = u.searchParams.get("instId");
      if (instId !== "BTC-USDT") return { code: "51001", msg: "Instrument ID does not exist" };
      const after = Number(u.searchParams.get("after") ?? 0);
      const limit = Number(u.searchParams.get("limit") ?? 100);
      const pool = after > 0 ? BTC.filter((b) => b.ts < after) : BTC;
      return { code: "0", msg: "", data: okxRows(pool.slice(0, limit)) };
    }
    if (url.includes("okx.com/api/v5/public/instruments")) return { code: "0", msg: "", data: [] };
    if (url.includes("okx.com/api/v5/market/books")) return { code: "0", msg: "", data: [] };

    if (url.includes("twelvedata.com/time_series")) {
      if (wire.twelveStatus) {
        return { code: 4011, message: "Invalid API key", status: "error" };
      }
      const u = new URL(url);
      if (u.searchParams.get("symbol") !== "XAU/USD") {
        return { code: 400, message: "symbol not found", status: "error" };
      }
      return { status: "ok", values: twelveValues(xauBars) };
    }
    if (url.includes("twelvedata.com/quote")) {
      const newest = xauBars[0];
      return {
        symbol: "XAU/USD",
        close: String(newest.close),
        timestamp: Math.floor(newest.ts / 1000),
      };
    }
    return {};
  };
}

function installNetwork(wire: Wire = {}): void {
  const respond = responder(wire);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String((input as Request)?.url ?? input);
      requestedUrls.push(url);
      const body = respond(url);
      const rejected =
        wire.twelveStatus !== undefined && url.includes("twelvedata.com/time_series");
      return {
        ok: !rejected,
        status: rejected ? wire.twelveStatus : 200,
        statusText: rejected ? "Unauthorized" : "OK",
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  resetProviderCache();
  requestedUrls = [];
  process.env.TWELVE_DATA_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

/** The Dashboard's own live-source shape (Dashboard `handleAnalyze`). */
function liveSourceOf(
  res: ProtectedResponse,
  env: Envelope,
  assetClass: "crypto" | "commodity",
): LiveCandidateSource {
  const r = res.result!;
  return {
    instrument: r.instrument!,
    assetClass,
    providerNative: {
      provider: r.provider!,
      providerInstrumentId: r.providerInstrumentId!,
    },
    marketData: env.data as never,
    technicalData: env.technical as never,
    analysisResult: r as never,
  } as LiveCandidateSource;
}

/** Every Twelve Data request that carries a symbol, as {symbol, interval}. */
function twelveSymbolRequests() {
  return requestedUrls
    .filter((u) => u.includes("twelvedata.com") && u.includes("symbol="))
    .map((u) => {
      const parsed = new URL(u);
      return {
        symbol: parsed.searchParams.get("symbol"),
        interval: parsed.searchParams.get("interval"),
      };
    });
}

// ═════════════════════════════════════════════════════════════════
// A. BTC — OKX provider-native path
// ═════════════════════════════════════════════════════════════════

describe("298 (A) BTC through the shipped provider-native path", () => {
  it("(A1) acquires OKX candles under the exact native id and reports provider-observed time", async () => {
    installNetwork();
    const env = await fetchMarket(testCtx(), {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });

    expect(env.success).toBe(true);
    expect(env.data?.provider).toBe("okx");
    expect(env.data?.providerInstrumentId).toBe("BTC-USDT");
    expect(env.data?.instrumentType).toBe("crypto");
    expect(env.data?.timeframe).toBe("M15");
    expect(env.data?.candles?.length ?? 0).toBeGreaterThanOrEqual(100);

    // The request carried the provider-native identity — no substitution.
    const okxCandleUrls = requestedUrls.filter(
      (u) => u.includes("okx.com") && u.includes("instId="),
    );
    expect(okxCandleUrls.length).toBeGreaterThan(0);
    for (const u of okxCandleUrls) {
      expect(new URL(u).searchParams.get("instId")).toBe("BTC-USDT");
    }
    // BTC is never acquired from another provider (the Twelve Data hits below
    // are the documented cross-asset comparator leg, never the instrument).
    for (const req of twelveSymbolRequests()) {
      expect(req.symbol).not.toBe("BTC-USDT");
      expect(req.symbol).not.toBe("BTC/USDT");
    }

    // Provider time, not the request clock.
    const newest = BTC[0].ts;
    const oldest = BTC[BTC.length - 1].ts;
    expect(env.data?.price?.timestamp).toBe(newest);
    expect(env.data?.candles?.[0]?.timestamp).toBe(oldest);
    expect(env.data?.candles?.[(env.data?.candles?.length ?? 0) - 1]?.timestamp).toBe(newest);
    expect(env.observedAt).toBe(newest);
    expect(newest).not.toBe(Date.now());
    expect(env.technical?.dataPoints ?? 0).toBeGreaterThan(0);
    expect(env.technical?.smc).toBeTruthy();
  });

  it("(A2) delivers the analysis and a radar opportunity under the same identity", async () => {
    installNetwork();
    const res = await runProtected(testCtx(), {
      input: {
        instrument: "BTC-USDT",
        instrumentType: "crypto",
        timeframe: "M15",
        tradingStyle: "swing",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
      },
    });

    expect(res.status).toBe("DELIVERED");
    expect(res.result?.instrument).toBe("BTC-USDT");
    expect(res.result?.provider).toBe("okx");
    expect(res.result?.providerInstrumentId).toBe("BTC-USDT");
    expect(res.result?.instrumentType).toBe("crypto");
    expect(res.result?.recommendation).toBeTruthy();

    const env = await fetchMarket(testCtx(), {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });
    const scan = scanInstruments([liveSourceOf(res, env, "crypto")], {
      horizons: ["SWING"],
      now: Date.now(),
    });
    const ranked = scan.results.get("SWING")!.rankedInstruments;
    expect(ranked.length).toBe(1);
    expect(ranked[0].instrument).toBe("BTC-USDT");
    expect(ranked[0].providerNative).toEqual({
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });
  });

  it("(A3) fails explicitly, without substitution, when the provider leg fails", async () => {
    const respond = responder({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String((input as Request)?.url ?? input);
        requestedUrls.push(url);
        const body = url.includes("okx.com")
          ? { code: "51001", msg: "Instrument ID does not exist" }
          : respond(url);
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );
    const env = await fetchMarket(testCtx(), {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      timeframe: "M15",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
    });
    expect(env.success).toBe(false);
    expect(env.errorCode).toBeTruthy();
    expect(env.data).toBeUndefined();
    for (const u of requestedUrls.filter((x) => x.includes("okx.com") && x.includes("instId="))) {
      expect(new URL(u).searchParams.get("instId")).toBe("BTC-USDT");
    }
    for (const req of twelveSymbolRequests()) {
      expect(req.symbol).not.toBe("BTC-USDT");
      expect(req.symbol).not.toBe("BTC/USDT");
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// B. XAU — Twelve Data commodity path
// ═════════════════════════════════════════════════════════════════

describe("298 (B) XAU through the shipped commodity path", () => {
  it("(B1) acquires Twelve Data candles for XAU/USD and keeps it a commodity", async () => {
    installNetwork();
    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });

    expect(env.success).toBe(true);
    expect(env.data?.provider).toBe("twelve-data");
    expect(env.data?.providerInstrumentId).toBe("XAU/USD");
    expect(env.data?.instrumentType).toBe("commodity");
    expect(env.data?.candles?.length ?? 0).toBeGreaterThanOrEqual(100);

    // The setup series (and its MTF chain) is always XAU/USD; the only other
    // symbols this runtime is allowed to probe are the documented DXY
    // candidates for cross-asset context.
    const requests = twelveSymbolRequests();
    expect(requests.length).toBeGreaterThan(0);
    const setupReads = requests.filter((r) => r.interval === "4h");
    expect(setupReads.length).toBeGreaterThan(0);
    for (const r of setupReads) expect(r.symbol).toBe("XAU/USD");
    const allowedComparators = new Set(["DXY", "DX.Y.NYB", "USD_INDEX", "I:DXY"]);
    for (const r of requests) {
      if (r.symbol === "XAU/USD") continue;
      expect(allowedComparators.has(String(r.symbol))).toBe(true);
    }
    expect(requestedUrls.some((u) => u.includes("okx.com"))).toBe(false);

    // Provider-observed instants only.
    expect(env.data?.price?.timestamp).toBe(XAU[0].ts);
    expect(env.observedAt).toBe(XAU[0].ts);
    expect(env.technical?.dataPoints ?? 0).toBeGreaterThan(0);
    expect(env.technical?.smc).toBeTruthy();
  });

  it("(B2) delivers the XAU analysis and radar opportunity with commodity identity intact", async () => {
    installNetwork();
    const res = await runProtected(testCtx(), {
      input: {
        instrument: "XAU/USD",
        instrumentType: "commodity",
        timeframe: "H4",
        tradingStyle: "swing",
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
      },
    });

    expect(res.status).toBe("DELIVERED");
    expect(res.result?.instrument).toBe("XAU/USD");
    expect(res.result?.provider).toBe("twelve-data");
    expect(res.result?.providerInstrumentId).toBe("XAU/USD");
    expect(res.result?.instrumentType).toBe("commodity");

    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });
    const scan = scanInstruments([liveSourceOf(res, env, "commodity")], {
      horizons: ["SWING"],
      now: Date.now(),
    });
    const ranked = scan.results.get("SWING")!.rankedInstruments;
    expect(ranked.length).toBe(1);
    expect(ranked[0].instrument).toBe("XAU/USD");
    expect(ranked[0].assetClass).toBe("commodity");
    expect(ranked[0].providerNative).toEqual({
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });
  });

  it("(B3) surfaces an authentication failure as AUTH_ERROR — never a substituted symbol", async () => {
    installNetwork({ twelveStatus: 401 });
    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });

    expect(env.success).toBe(false);
    expect(env.errorCode).toBe("AUTH_ERROR");
    expect(env.error).toMatch(/auth/i);
    expect(env.data).toBeUndefined();
    for (const req of twelveSymbolRequests()) expect(req.symbol).toBe("XAU/USD");
  });

  it("(B4) refuses insufficient OHLCV: no plan, and the thin series is flagged", async () => {
    installNetwork({ shortSeries: true });
    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });

    // The envelope carries what the provider returned (4 bars) — it does not
    // pad, and it does not pretend the series is complete.
    expect(env.success).toBe(true);
    expect(env.data?.candles?.length).toBe(4);

    const res = await runProtected(testCtx(), {
      input: {
        instrument: "XAU/USD",
        instrumentType: "commodity",
        timeframe: "H4",
        tradingStyle: "swing",
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
      },
    });
    expect(res.status).toBe("DELIVERED");
    expect(res.result?.recommendation).toBe("NO_TRADE");
    expect(res.result?.tradePlan ?? undefined).toBeUndefined();
    const text = [...(res.result?.noTradeReasons ?? []), ...(res.result?.dataFlags ?? [])].join(" ");
    expect(text).toMatch(/limited candle history|insufficient|no higher-timeframe/i);
  });

  it("(B5) never presents a stale series as live evidence", async () => {
    installNetwork({ stale: true });
    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });

    // The envelope reports the provider's OWN instants, and the series — four
    // days old while its bars print every four hours — is labelled stale, not
    // "delayed". Nothing here is re-dated.
    expect(env.success).toBe(true);
    expect(env.observedAt).toBe(XAU_STALE[0].ts);
    expect(env.data?.price?.timestamp).toBe(XAU_STALE[0].ts);
    expect(env.data?.dataFreshness).toBe("stale");
    expect(Date.now() - (env.observedAt ?? 0)).toBeGreaterThan(86_400_000);

    const res = await runProtected(testCtx(), {
      input: {
        instrument: "XAU/USD",
        instrumentType: "commodity",
        timeframe: "H4",
        tradingStyle: "swing",
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
      },
    });
    expect(res.status).toBe("DELIVERED");
    expect(res.result?.recommendation).toBe("NO_TRADE");
    expect(res.result?.tradePlan ?? undefined).toBeUndefined();
    expect((res.result?.noTradeReasons ?? []).join(" ")).toMatch(/stale/i);
  });

  it("(B6) refuses a provider with no verified live OHLCV leg without forwarding its identity", async () => {
    installNetwork();
    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "coingecko",
      providerInstrumentId: "XAU/USD",
    });

    expect(env.success).toBe(false);
    expect(env.errorCode).toBe("NO_LIVE_DATA");
    expect(env.error).toMatch(/no fallback|substitution/i);
    expect(
      requestedUrls.filter((u) => u.includes("okx.com") || u.includes("twelvedata.com")),
    ).toHaveLength(0);
  });

  it("(B7) refuses an unconfigured market-data key with an explicit reason", async () => {
    installNetwork();
    delete process.env.TWELVE_DATA_API_KEY;
    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });
    expect(env.success).toBe(false);
    expect(env.errorCode).toBe("AUTH_ERROR");
    expect(env.error).toMatch(/TWELVE_DATA_API_KEY/);
    expect(requestedUrls).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// C. Series freshness semantics (the Phase 298 defect)
// ═════════════════════════════════════════════════════════════════

describe("298 (C) provider-series freshness is derived, never assumed", () => {
  const HOUR = 60 * 60_000;

  it("(C1) reads the cadence from the provider's own series", () => {
    const bars = (gapMs: number, extras: number[] = []) => {
      const ts: number[] = [];
      let t = 1_700_000_000_000;
      for (let i = 0; i < 40; i++) {
        ts.push(t);
        t += gapMs;
      }
      // A weekend-sized gap must not redefine the cadence.
      return [...ts, ...extras.map((e) => t + e)].map((timestamp) => ({ timestamp }));
    };
    expect(medianBarSpacingMs(bars(15 * 60_000))).toBe(15 * 60_000);
    expect(medianBarSpacingMs(bars(4 * HOUR, [50 * HOUR]))).toBe(4 * HOUR);
    expect(medianBarSpacingMs([{ timestamp: 1 }, { timestamp: 2 }])).toBeUndefined();
  });

  it("(C2) holds the previous label for a current series and downgrades a stale one", () => {
    const now = 1_800_000_000_000;
    // Current 4h series: newest bar is the forming bar.
    expect(
      providerSeriesFreshness({
        newestBarTimestamp: now - 30 * 60_000,
        barSpacingMs: 4 * HOUR,
        now,
      }),
    ).toBe("delayed");
    // Four-day-old 4h series: stale — the demonstrated defect.
    expect(
      providerSeriesFreshness({
        newestBarTimestamp: now - 4 * 86_400_000,
        barSpacingMs: 4 * HOUR,
        now,
      }),
    ).toBe("stale");
    // A weekly series three days into its forming bar is NOT stale: the
    // cadence test keeps higher-timeframe setups from being flagged.
    expect(
      providerSeriesFreshness({
        newestBarTimestamp: now - 3 * 86_400_000,
        barSpacingMs: 7 * 86_400_000,
        now,
      }),
    ).toBe("delayed");
    // A daily series spanning a weekend is not stale either.
    expect(
      providerSeriesFreshness({
        newestBarTimestamp: now - 2 * 86_400_000,
        barSpacingMs: 86_400_000,
        now,
      }),
    ).toBe("delayed");
    // No provider instant, or one implausibly in the future, is unavailable.
    expect(
      providerSeriesFreshness({ newestBarTimestamp: null, barSpacingMs: HOUR, now }),
    ).toBe("unavailable");
    expect(
      providerSeriesFreshness({
        newestBarTimestamp: now + 10 * 60_000,
        barSpacingMs: HOUR,
        now,
      }),
    ).toBe("unavailable");
  });

  it("(C3) the label can only hold or fall — never rise", async () => {
    // Every probe below reaches the real envelope; the label is never
    // "realtime" on this leg and never fresher than the constant it replaced.
    for (const wire of [{}, { stale: true }] as Wire[]) {
      installNetwork(wire);
      const env = await fetchMarket(testCtx(), {
        instrument: "XAU/USD",
        instrumentType: "commodity",
        timeframe: "H4",
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
      });
      expect(["delayed", "stale", "unavailable"]).toContain(env.data?.dataFreshness);
      vi.unstubAllGlobals();
      resetProviderCache();
      requestedUrls = [];
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// D. Recommendation path (the Dashboard's scan)
// ═════════════════════════════════════════════════════════════════

describe("298 (D) recommendations carry identity and require evidence", () => {
  it("(D1) the same evidence produces the same recommendation twice", async () => {
    installNetwork();
    const res = await runProtected(testCtx(), {
      input: {
        instrument: "XAU/USD",
        instrumentType: "commodity",
        timeframe: "H4",
        tradingStyle: "swing",
        provider: "twelve-data",
        providerInstrumentId: "XAU/USD",
      },
    });
    const env = await fetchMarket(testCtx(), {
      instrument: "XAU/USD",
      instrumentType: "commodity",
      timeframe: "H4",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
    });
    const source = liveSourceOf(res, env, "commodity");
    const now = Date.now();
    const first = scanInstruments([source], { horizons: ["SWING"], now });
    const second = scanInstruments([source], { horizons: ["SWING"], now });
    expect(JSON.stringify(first.results.get("SWING")!.rankedInstruments)).toBe(
      JSON.stringify(second.results.get("SWING")!.rankedInstruments),
    );
    expect(JSON.stringify(first.results.get("SWING")!.rankedInstruments)).toBe(
      JSON.stringify(
        scanInstruments([source], { horizons: ["SWING"], now }).results.get("SWING")!
          .rankedInstruments,
      ),
    );
  });

  it("(D2) a discovered instrument with no acquired evidence is not recommended", () => {
    // Identity only: discovery metadata is never live evidence (Phase 234).
    const discoveredOnly = {
      instrument: "XAU/USD",
      assetClass: "commodity",
      providerNative: { provider: "twelve-data", providerInstrumentId: "XAU/USD" },
    } as LiveCandidateSource;
    const scan = scanInstruments([discoveredOnly], {
      horizons: ["SWING"],
      now: Date.now(),
    });
    const ranked = scan.results.get("SWING")!.rankedInstruments;
    expect(ranked).toHaveLength(0);
    expect(JSON.stringify(scan)).not.toMatch(/XAU\/USD/);
  });
});
