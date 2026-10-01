/**
 * Phase 300 runtime-integration fix — BTC/XAU runtime acceptance contracts
 * through the SHIPPED Convex market-data action (the exact path the browser
 * triggers).
 *
 * Production findings being locked down:
 *
 *   1. XAU/USD (twelve-data) rendered a NO_TRADE shell ("No live market price
 *      available" / "No technical data available" / "No price data available")
 *      — an evidence-less result that looked like a normal analysis. After
 *      this fix an answered-but-empty series or a missing price is an
 *      EXPLICIT data-unavailable refusal and can never reach the engine.
 *   2. The timeframe matrix and MTF runtime: M30 now maps to the provider's
 *      real "30min" interval, and the style-aware MTF acquisition actually
 *      fetches the style chain for setups outside the frozen ladder
 *      (scalping M5 → M15/H1/M1 context), while frozen timeframes (M15) keep
 *      their byte-identical chains regardless of style.
 *
 * The ONLY non-production layer is the provider HTTP body (a DESIGNED
 * fixture, as in the phase-298 suite). This is NOT live verification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMarketData } from "./marketData";
import { resetProviderCache } from "../lib/data/provider-cache-registry";

type Envelope = {
  success?: boolean;
  error?: string;
  errorCode?: string;
  data?: {
    provider?: string;
    providerInstrumentId?: string;
    timeframe?: string;
    dataFreshness?: string;
    candles?: Array<{ timestamp: number; close: number }>;
    price?: { price: number; timestamp: number };
  };
  technical?: {
    dataPoints?: number;
    mtf?: {
      timeframes?: Array<{ timeframe: string; role: string }>;
      unavailable?: Array<{ timeframe: string; reason: string }>;
      alignment?: string;
    };
    chainUnavailable?: string[];
  } | null;
};

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

const fetchMarket = handlerOf<Record<string, unknown>, Envelope>(fetchMarketData);

function testCtx() {
  return {
    auth: { getUserIdentity: async () => ({ subject: "user_300b", issuer: "test" }) },
  } as never;
}

// ─────────────────────────────────────────────────────────────────
// Fixture — provider-shaped Twelve Data payloads per interval
// ─────────────────────────────────────────────────────────────────

const INTERVAL_MS: Record<string, number> = {
  "1min": 60_000,
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1day": 86_400_000,
  "1week": 7 * 86_400_000,
};

function seriesBars(interval: string, count: number, base: number): Array<Record<string, unknown>> {
  const barMs = INTERVAL_MS[interval] ?? 60 * 60_000;
  const anchor = Math.floor((Date.now() - 90_000) / barMs) * barMs;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    const ts = anchor - i * barMs;
    const close = base + Math.sin(i * 0.4) * (base * 0.001);
    rows.push({
      datetime: new Date(ts).toISOString().replace("T", " ").slice(0, 19),
      open: (close - 0.5).toFixed(4),
      high: (close + 1.5).toFixed(4),
      low: (close - 1.5).toFixed(4),
      close: close.toFixed(4),
      volume: "1234",
    });
  }
  return rows;
}

interface Wire {
  /** When set, every time_series answers this vendor error body. */
  vendor?: Record<string, unknown>;
  /** When set, time_series answers HTTP-ok with an EMPTY values array. */
  empty?: boolean;
}

let requestedUrls: string[] = [];

function responder(wire: Wire) {
  return (url: string): Record<string, unknown> => {
    if (url.includes("twelvedata.com/time_series")) {
      if (wire.vendor) return wire.vendor;
      if (wire.empty) return { status: "ok", values: [] };
      const u = new URL(url);
      const interval = u.searchParams.get("interval") ?? "15min";
      const symbol = u.searchParams.get("symbol") ?? "";
      const base = symbol.includes("XAU") ? 2650 : 61000;
      return { status: "ok", values: seriesBars(interval, 60, base) };
    }
    if (url.includes("twelvedata.com/quote")) {
      return {
        symbol: "XAU/USD",
        close: "2651.25",
        timestamp: Math.floor((Date.now() - 60_000) / 1000),
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
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

function requestedIntervals(): string[] {
  return requestedUrls
    .filter((u) => u.includes("twelvedata.com/time_series"))
    .map((u) => new URL(u).searchParams.get("interval") ?? "");
}

function xauArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instrument: "XAU/USD",
    instrumentType: "commodity",
    timeframe: "M15",
    provider: "twelve-data",
    providerInstrumentId: "XAU/USD",
    ...overrides,
  };
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

describe("Phase 300b — XAU no-live-data stays an explicit refusal (never a shell)", () => {
  it("an answered-but-EMPTY series is an explicit NO_LIVE_DATA refusal, not an analysis input", async () => {
    installNetwork({ empty: true });
    const res = await fetchMarket(testCtx(), xauArgs());
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("NO_LIVE_DATA");
    expect(res.error).toContain("no candle data returned");
    // No data envelope, no technical object — nothing that could render as a
    // normal-looking NO_TRADE shell.
    expect(res.data).toBeUndefined();
    expect(res.technical).toBeUndefined();
  });

  it("a vendor credential rejection stays an explicit AUTH_ERROR with its class", async () => {
    // Twelve Data answers credential failures as HTTP 401 with a vendor body;
    // the [status] prefix must carry the class through to the envelope.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String((input as Request)?.url ?? input);
        requestedUrls.push(url);
        const body = { code: 4011, message: "Invalid API key", status: "error" };
        return {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      }),
    );
    const res = await fetchMarket(testCtx(), xauArgs());
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("AUTH_ERROR");
    expect(res.data).toBeUndefined();
  });

  it("the healthy XAU/USD M15 path still succeeds with real price + OHLCV + provider observation", async () => {
    installNetwork();
    const res = await fetchMarket(testCtx(), xauArgs());
    expect(res.success).toBe(true);
    expect(res.data?.provider).toBe("twelve-data");
    expect(res.data?.providerInstrumentId).toBe("XAU/USD");
    expect(res.data?.price?.price).toBeGreaterThan(0);
    expect(res.data?.price?.timestamp).toBeGreaterThan(0);
    expect(res.data?.candles?.length).toBeGreaterThan(0);
    expect(res.technical?.dataPoints).toBeGreaterThan(0);
    // Delayed-class at best: Twelve Data never claims realtime here.
    expect(["delayed", "stale"]).toContain(res.data?.dataFreshness);
  });
});

describe("Phase 300b — the runtime MTF flow follows the style chain", () => {
  it("INTRADAY M30 now requests the provider's real 30min interval and climbs H1 → H4", async () => {
    installNetwork();
    const res = await fetchMarket(
      testCtx(),
      xauArgs({ timeframe: "M30", tradingStyle: "intraday" }),
    );
    expect(res.success).toBe(true);
    expect(res.data?.timeframe).toBe("M30");
    // The wire saw the REAL intervals — M30 was mapped, not passed raw.
    const intervals = requestedIntervals();
    expect(intervals).toContain("30min"); // setup
    expect(intervals).toContain("1h"); // structure
    expect(intervals).toContain("4h"); // macro
    expect(intervals).toContain("15min"); // trigger
    // The MTF context carries the actual per-timeframe reads with roles.
    const tfs = res.technical?.mtf?.timeframes ?? [];
    expect(tfs.find((t) => t.timeframe === "M30")?.role).toBe("setup");
    expect(tfs.find((t) => t.timeframe === "H1")?.role).toBe("structure");
    expect(tfs.find((t) => t.timeframe === "H4")?.role).toBe("macro");
    expect(tfs.find((t) => t.timeframe === "M15")?.role).toBe("trigger");
  });

  it("SCALPING M5 fetches M1 trigger + M15/H1 context — real series, not labels", async () => {
    installNetwork();
    const res = await fetchMarket(
      testCtx(),
      xauArgs({ timeframe: "M5", tradingStyle: "scalping" }),
    );
    expect(res.success).toBe(true);
    const intervals = requestedIntervals();
    expect(intervals).toContain("5min"); // setup
    expect(intervals).toContain("1min"); // trigger
    expect(intervals).toContain("15min"); // structure
    expect(intervals).toContain("1h"); // macro
    const tfs = res.technical?.mtf?.timeframes ?? [];
    expect(tfs.find((t) => t.timeframe === "M5")?.role).toBe("setup");
    expect(tfs.find((t) => t.timeframe === "M1")?.role).toBe("trigger");
    expect(tfs.find((t) => t.timeframe === "M15")?.role).toBe("structure");
    expect(tfs.find((t) => t.timeframe === "H1")?.role).toBe("macro");
  });

  it("a frozen timeframe (M15) keeps its byte-identical chain regardless of style — never M1/M30 slots", async () => {
    installNetwork();
    const res = await fetchMarket(
      testCtx(),
      xauArgs({ timeframe: "M15", tradingStyle: "scalping" }),
    );
    expect(res.success).toBe(true);
    const intervals = requestedIntervals();
    expect(intervals).toContain("15min"); // setup (frozen)
    expect(intervals).toContain("1h"); // structure (frozen)
    expect(intervals).toContain("4h"); // macro (frozen)
    // The frozen ladder did NOT grow new rungs.
    expect(intervals).not.toContain("1min");
    expect(intervals).not.toContain("5min");
    expect(intervals).not.toContain("30min");
    const tfs = res.technical?.mtf?.timeframes ?? [];
    expect(tfs.find((t) => t.timeframe === "M15")?.role).toBe("setup");
    expect(tfs.find((t) => t.timeframe === "H1")?.role).toBe("structure");
    expect(tfs.find((t) => t.timeframe === "H4")?.role).toBe("macro");
  });

  it("without a style, an out-of-ladder setup stays standalone (no invented context)", async () => {
    installNetwork();
    const res = await fetchMarket(testCtx(), xauArgs({ timeframe: "M5" }));
    expect(res.success).toBe(true);
    const intervals = new Set(requestedIntervals());
    // Only the setup series interval was requested — nothing fabricated for
    // context. (A second request with the same interval is the bounded DXY
    // comparator probe, which is a different SYMBOL, not another timeframe.)
    expect([...intervals]).toEqual(["5min"]);
    const setupReads = requestedUrls.filter(
      (u) => u.includes("twelvedata.com/time_series") && new URL(u).searchParams.get("symbol") === "XAU/USD",
    );
    expect(setupReads).toHaveLength(1);
    expect(res.technical?.chainUnavailable).toBeUndefined();
  });
});
