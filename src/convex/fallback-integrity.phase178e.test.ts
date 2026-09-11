/**
 * Phase 178e — protected-path default/fallback integrity sweep.
 *
 * The recurring bug pattern across Phases 175/176/177/178d was:
 *
 *   missing / empty / failed evidence
 *     -> fallback value
 *     -> value falsely implies success, freshness, live observation,
 *        provider contact, or decision evidence.
 *
 * These tests pin the two real defects this sweep found, plus the invariants
 * that must hold for the fallbacks deliberately RETAINED as safe.
 *
 * Defects found and fixed:
 *   1. Malformed OHLC parsed to NaN and was returned as a successful market
 *      structure (`success: true` with NaN candles).
 *   2. The OKX order book did not report its EXCHANGE timestamp, so
 *      diagnostics aged a 12s-old snapshot as milliseconds old.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMarketData, fetchFxRate } from "./marketData";
import { fetchOkxOrderBook } from "./okx";
import { fetchIntelligence } from "./alphaVantage";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import {
  combineAcquisitions,
  envelopeAcquisition,
  legFromFailure,
  modeFromOutcome,
} from "../lib/data/provenance-diagnostics";
import {
  providerContacted,
  quotaChargeAttributableToCaller,
  recordProvenance,
} from "../lib/data/acquisition-provenance";
import { computeVolumeProfile } from "../lib/data/smc";

function handlerOf<A, R>(a: unknown): (c: never, x: A) => Promise<R> {
  return (a as { _handler: (c: never, x: A) => Promise<R> })._handler;
}

const ctx = {
  auth: { getUserIdentity: async () => ({ subject: "user_A" }) },
  runMutation: async () => "user_stub",
  runQuery: async () => null,
} as never;

interface MdResult {
  success: boolean;
  error?: string;
  data?: { candles?: Array<{ open: number; high: number; low: number; close: number; timestamp: number }>; price?: { price: number } };
}

const marketData = handlerOf<
  { instrument: string; instrumentType: string; timeframe: string },
  MdResult
>(fetchMarketData);

const orderBook = handlerOf<
  { instrument: string },
  { success: boolean; observedAt?: number; data?: { snapshotTs?: number; available?: boolean } }
>(fetchOkxOrderBook);

function candles(n: number, mutate?: (i: number) => Record<string, unknown>) {
  return Array.from({ length: n }, (_, i) => ({
    datetime: new Date(Date.now() - (n - i) * 36e5).toISOString(),
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: "1000",
    ...(mutate ? mutate(i) : {}),
  }));
}

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const body = handler(String(input));
      if (body instanceof Error) throw body;
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  resetProviderCache();
  process.env.TWELVE_DATA_API_KEY = "test-key";
  process.env.ALPHA_VANTAGE_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

// ═══════════════════════════════════════════════════════════
// DEFECT 1 — a missing price must never become a believable number
// ═══════════════════════════════════════════════════════════

describe("missing price cannot become a numeric observation", () => {
  it("all-malformed OHLC fails instead of returning NaN candles", async () => {
    stubFetch((url) =>
      url.includes("time_series")
        ? { values: candles(210, () => ({ open: "n/a", high: "n/a", low: "n/a", close: "n/a" })).reverse(), status: "ok" }
        : { close: "100" },
    );

    const result = await marketData(ctx, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no numerically valid candles/);
  });

  it("no NaN ever reaches the returned candle series", async () => {
    // A provider that corrupts a subset of rows must not poison the series.
    stubFetch((url) =>
      url.includes("time_series")
        ? {
            values: candles(210, (i) =>
              i % 50 === 0 ? { open: "n/a", high: "n/a", low: "n/a", close: "n/a" } : {},
            ).reverse(),
            status: "ok",
          }
        : { close: "100" },
    );

    const result = await marketData(ctx, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H1",
    });

    expect(result.success).toBe(true);
    const series = result.data?.candles ?? [];
    expect(series.length).toBeGreaterThan(0);
    for (const c of series) {
      expect(Number.isFinite(c.open)).toBe(true);
      expect(Number.isFinite(c.high)).toBe(true);
      expect(Number.isFinite(c.low)).toBe(true);
      expect(Number.isFinite(c.close)).toBe(true);
      expect(Number.isFinite(c.timestamp)).toBe(true);
    }
  });

  it("corrupt rows are dropped, not defaulted to zero", async () => {
    stubFetch((url) =>
      url.includes("time_series")
        ? {
            values: candles(210, (i) =>
              i % 50 === 0 ? { open: "n/a", high: "n/a", low: "n/a", close: "n/a" } : {},
            ).reverse(),
            status: "ok",
          }
        : { close: "100" },
    );

    const result = await marketData(ctx, {
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H1",
    });

    const series = result.data?.candles ?? [];
    // A zero price would be a believable-looking lie; dropping is the only
    // honest option. 210 rows minus the corrupted ones.
    expect(series.length).toBeLessThan(210);
    for (const c of series) expect(c.close).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// DEFECT 2 — provider observation time, not request time
// ═══════════════════════════════════════════════════════════

describe("order book reports the exchange observation time", () => {
  it("observedAt reflects the exchange timestamp, not request completion", async () => {
    const exchangeTs = Date.now() - 12_000;
    stubFetch(() => ({
      code: "0",
      data: [
        {
          bids: [["100", "5", "0", "1"], ["99.9", "5", "0", "1"]],
          asks: [["100.1", "5", "0", "1"], ["100.2", "5", "0", "1"]],
          ts: String(exchangeTs),
        },
      ],
    }));

    const result = await orderBook({} as never, { instrument: "BTC-USDT-SWAP" });

    expect(result.observedAt).toBeDefined();
    const reportedAge = Date.now() - (result.observedAt as number);
    // The true age is ~12s. Request time would have reported single-digit ms.
    expect(reportedAge).toBeGreaterThanOrEqual(11_000);
  });

  it("an unusable book reports no observation timestamp", async () => {
    stubFetch(() => ({ code: "0", data: [{ bids: [], asks: [], ts: String(Date.now()) }] }));

    const result = await orderBook({} as never, { instrument: "BTC-USDT-SWAP" });

    // No usable book means no observation to report.
    if (result.data?.available !== true) {
      expect(result.observedAt).toBeUndefined();
    }
  });

  it("provenance agrees with the freshness gate's own basis", async () => {
    const exchangeTs = Date.now() - 5_000;
    stubFetch(() => ({
      code: "0",
      data: [
        {
          bids: [["100", "5", "0", "1"], ["99.9", "5", "0", "1"]],
          asks: [["100.1", "5", "0", "1"], ["100.2", "5", "0", "1"]],
          ts: String(exchangeTs),
        },
      ],
    }));

    const result = await orderBook({} as never, { instrument: "BTC-USDT-SWAP" });

    // Both must derive from the same exchange timestamp.
    expect(result.observedAt).toBe(result.data?.snapshotTs);
  });
});

// ═══════════════════════════════════════════════════════════
// Provider failure semantics
// ═══════════════════════════════════════════════════════════

describe("provider failures never become successful evidence", () => {
  it("a timeout cannot become success", () => {
    expect(modeFromOutcome({ status: "failed", category: "timeout" })).toBe("timed-out");
    const leg = legFromFailure({
      provider: "market-data",
      dataset: "ohlcv",
      outcome: { status: "failed", category: "timeout" },
    });
    expect(leg.acquired).toBe(false);
    expect(leg.observedAt).toBeUndefined();
  });

  it("a 429 cannot become evidence", () => {
    expect(modeFromOutcome({ status: "failed", category: "rate-limit" })).toBe("rate-limited");
    const leg = legFromFailure({
      provider: "coinglass",
      dataset: "derivatives",
      outcome: { status: "failed", category: "rate-limit" },
    });
    expect(leg.acquired).toBe(false);
    expect(leg.attached).toBe(false);
    expect(leg.usedByEngine).toBe(false);
    expect(leg.evidenceAgeMs).toBeUndefined();
  });

  it("a network failure yields no FX rate rather than a fabricated one", async () => {
    stubFetch(() => new Error("socket hang up"));

    const fx = handlerOf<{ from: string; to: string }, { success: boolean; direct?: unknown }>(
      fetchFxRate,
    );
    const result = await fx(ctx, { from: "EUR", to: "USD" });

    expect(result.success).toBe(false);
    expect(result.direct).toBeUndefined();
  });

  it("a degraded provider makes no acquisition claim", async () => {
    stubFetch((url) => (url.includes("alphavantage") ? new Error("socket hang up") : {}));

    const intel = handlerOf<
      { instrument: string; instrumentType: string },
      { success: boolean; acquisition?: string; observedAt?: number }
    >(fetchIntelligence);
    const result = await intel(ctx, { instrument: "BTC/USDT", instrumentType: "crypto" });

    expect(result.acquisition).toBeUndefined();
    expect(result.observedAt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// Defence in depth — the timestamp guard has TWO independent layers
// ═══════════════════════════════════════════════════════════

describe("a failure mode drops observedAt even if a caller supplies one", () => {
  // Mutation testing revealed that removing the `observedAt: undefined` line
  // in `legFromFailure` changed nothing: `recordProvenance` independently
  // refuses to attach an observation to a mode that carries no evidence.
  // That second layer was real but UNTESTED, so a later refactor could have
  // removed it silently. These tests pin it directly.

  it("recordProvenance strips an observation from every failure mode", () => {
    const observedAt = Date.now() - 60_000;
    for (const mode of ["unavailable", "timed-out", "rate-limited", "skipped"] as const) {
      const p = recordProvenance({
        provider: "coinglass",
        dataset: "derivatives",
        mode,
        // A caller wrongly supplies a timestamp for a leg that observed
        // nothing. It must be discarded, not recorded.
        observedAt,
      });
      expect(p.observedAt).toBeUndefined();
      expect(p.evidenceAgeMs).toBeUndefined();
    }
  });

  it("evidence-carrying modes still keep their observation", () => {
    // Proves the guard discriminates rather than dropping everything.
    const observedAt = Date.now() - 5_000;
    for (const mode of [
      "observed-now",
      "observed-shared",
      "cache-reused",
      "uncached-by-design",
    ] as const) {
      const p = recordProvenance({
        provider: "market-data",
        dataset: "ohlcv",
        mode,
        observedAt,
      });
      expect(p.observedAt).toBe(observedAt);
      expect(p.evidenceAgeMs).toBeGreaterThanOrEqual(4_000);
    }
  });

  it("a failed leg reports no age regardless of the supplied usedAt", () => {
    const p = recordProvenance({
      provider: "tickatlas",
      dataset: "calendar",
      mode: "timed-out",
      observedAt: Date.now() - 30_000,
      usedAt: Date.now(),
    });
    expect(p.observedAt).toBeUndefined();
    expect(p.evidenceAgeMs).toBeUndefined();
    expect(quotaChargeAttributableToCaller(p)).toBe(false);
    expect(providerContacted(p)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Empty composite semantics (pinned)
// ═══════════════════════════════════════════════════════════

describe("empty composite semantics remain pinned", () => {
  it("combineAcquisitions([]) is unavailable", () => {
    expect(combineAcquisitions([])).toBe("unavailable");
  });

  it("envelopeAcquisition([]) is undefined", () => {
    expect(envelopeAcquisition([])).toBeUndefined();
  });

  it("no empty composite can claim a fresh or live observation", () => {
    expect(combineAcquisitions([])).not.toBe("observed-now");
    expect(combineAcquisitions([])).not.toBe("observed-shared");
    expect(envelopeAcquisition([])).not.toBe("observed-now");
  });
});

// ═══════════════════════════════════════════════════════════
// Deliberately RETAINED defaults — proven unable to fabricate
// ═══════════════════════════════════════════════════════════

describe("retained defaults cannot fabricate decision evidence", () => {
  it("volume || 0 cannot fabricate a volume profile", () => {
    // Volume is genuinely absent from many spot-forex feeds, so the zero
    // default is retained — but it must not become evidence. The consumer
    // refuses to build a profile from a zero total and says why.
    const zeroVolume = Array.from({ length: 60 }, (_, i) => ({
      timestamp: Date.now() - (60 - i) * 36e5,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 0,
    }));

    const profile = computeVolumeProfile(zeroVolume);
    expect(profile.available).toBe(false);
    expect(profile.unavailableReason).toMatch(/fabricated|zero/i);
  });

  it("a real volume series still produces a profile", () => {
    const realVolume = Array.from({ length: 60 }, (_, i) => ({
      timestamp: Date.now() - (60 - i) * 36e5,
      open: 100,
      high: 101 + (i % 5),
      low: 99 - (i % 3),
      close: 100 + (i % 4),
      volume: 1000 + i * 10,
    }));

    // Proves the guard rejects only fabricated input, not all input.
    expect(computeVolumeProfile(realVolume).available).toBe(true);
  });
});
