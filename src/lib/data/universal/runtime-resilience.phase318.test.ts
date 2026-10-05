/**
 * Phase 318 — runtime resilience, quota semantics and degraded-state truth.
 *
 * Deterministic adversarial coverage for the phase's required cases:
 *   A/B  RATE_LIMIT policy — verbatim surfacing, NO fallback (quota isolation:
 *        a per-minute primary blip must not burn the fallback's tiny daily
 *        budget, and a masked outage is a fake state)
 *   C    AUTH_ERROR — no forbidden fallback
 *   D    unsupported timeframe — explicit unavailable, no aggregation
 *   E/P  stale fallback data carries honest freshness labels; the freshness
 *        function can NEVER return a live-sounding label it cannot prove
 *   F    malformed fallback — rejected, primary fate surfaced
 *   G    provider identity mismatch — a series whose own meta names a
 *        different pair is rejected outright
 *   H    duplicate-call elimination — the authoritative cache collapses
 *        concurrent identical acquisitions to ONE
 *   I/J  sticky-within-run routing and no oscillation (primary recovering
 *        mid-run does NOT flip the snapshot source back and forth)
 *   K/L/M degraded-but-usable analysis: CoinGlass absent, macro absent,
 *        stock fundamentals absent — the analysis remains, honestly flagged
 *   N    chart/plan snapshot identity — same snapshot ⇒ same provenance hash
 *   O    the failover limitation reaches signal.limitations (rendered by the
 *        proven phase-312 SignalCard suite, `signal-limitations` section)
 */

import { describe, it, expect } from "vitest";
import type { OhlcvCandle } from "../market-types";
import {
  classifyLiveFailure,
  type LiveAcquisitionFailureClass,
} from "./live/failure-class";
import {
  FX_FAILOVER_TRIGGER_CLASSES,
  mapAlphaVantageFxRequest,
  parseAlphaVantageFxSeries,
  fxPairOf,
  createFxFailoverController,
} from "./fx-failover";
import { providerSeriesFreshness } from "../../../convex/marketData";
import { resetProviderCache, getProviderCache } from "../provider-cache-registry";
import { assemble } from "../../benchmark-fixtures.phase9";
import { runAnalysis } from "../../analysis-engine";
import { buildSignalResponse } from "../../strategy/signal";

const HOUR = 60 * 60e3;

function series(tfMs: number, count: number, newestMs = Date.now()): OhlcvCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: newestMs - (count - 1 - i) * tfMs,
    open: 1.1, high: 1.2, low: 1.0, close: 1.15,
    volume: 0,
  }));
}

function controller(overrides: {
  classify?: (err: unknown) => { errorCode: string; error: string };
  primary?: (tf: string, bars: number) => Promise<OhlcvCandle[]>;
  fallback?: (tf: string, bars: number, av: string) => Promise<OhlcvCandle[]>;
} = {}) {
  const calls = { primary: 0, fallback: 0 };
  const c = createFxFailoverController({
    config: {
      catalogAvSymbol: "EURUSD",
      fallbackConfigured: true,
      classifyPrimary:
        overrides.classify ??
        (() => ({
          errorCode: "SYMBOL_UNSUPPORTED",
          error: "Unsupported symbol: [404] invalid",
        })),
    },
    primary:
      overrides.primary ??
      (async () => {
        calls.primary++;
        throw new Error("primary failed");
      }),
    fallback:
      overrides.fallback ??
      (async () => {
        calls.fallback++;
        return series(HOUR, 30);
      }),
  });
  return { c, calls };
}

// ── §5 taxonomy: TIMEOUT is its own class, never collapsed ──────────

describe("318 — provider failure taxonomy (§5)", () => {
  it("deadline/timeout failures are TIMEOUT, not NETWORK_ERROR", () => {
    expect(classifyLiveFailure({ message: "The operation was aborted due to timeout" })).toBe("TIMEOUT");
    expect(classifyLiveFailure({ message: "request timed out after 6000ms" })).toBe("TIMEOUT");
    expect(classifyLiveFailure({ message: "TimeoutError: signal timed out" })).toBe("TIMEOUT");
    expect(classifyLiveFailure({ message: "deadline exceeded" })).toBe("TIMEOUT");
  });

  it("transport failures stay NETWORK_ERROR — the classes stay distinct", () => {
    expect(classifyLiveFailure({ message: "fetch failed" })).toBe("NETWORK_ERROR");
    expect(classifyLiveFailure({ message: "socket hang up" })).toBe("NETWORK_ERROR");
    expect(classifyLiveFailure({ message: "aborted" })).toBe("NETWORK_ERROR");
  });

  it("classification is deterministic (same message → same class, always)", () => {
    const messages = [
      "timeout", "timed out", "fetch failed", "[429] quota", "[401] auth",
      "unsupported bar/timeframe", "malformed series",
    ];
    for (const m of messages) {
      const a: LiveAcquisitionFailureClass = classifyLiveFailure({ message: m });
      const b = classifyLiveFailure({ message: m });
      expect(a).toBe(b);
    }
  });

  it("TIMEOUT is a legal failover trigger — a slow provider is provider-side", () => {
    expect(FX_FAILOVER_TRIGGER_CLASSES).toContain("TIMEOUT");
    expect(FX_FAILOVER_TRIGGER_CLASSES).not.toContain("RATE_LIMIT");
    expect(FX_FAILOVER_TRIGGER_CLASSES).not.toContain("AUTH_ERROR");
    expect(FX_FAILOVER_TRIGGER_CLASSES).not.toContain("NO_LIVE_DATA");
  });
});

// ── §3/§6 rate-limit fallback matrix (controller semantics) ─────────

describe("318 — rate-limit fallback matrix (§2/§3)", () => {
  it("A/B: RATE_LIMIT → NO fallback, the primary quota state surfaces verbatim", async () => {
    const quotaError = new Error(
      "Rate limited: [429] You have run out of API credits for the current minute. 10 API credits were used, with the current limit being 8.",
    );
    const { c, calls } = controller({
      classify: () => ({
        errorCode: "RATE_LIMIT",
        error: "Rate limited: [429] You have run out of API credits for the current minute.",
      }),
      primary: async () => {
        calls.primary++;
        throw quotaError;
      },
    });
    await expect(c.load("H1", 30)).rejects.toThrow(/Rate limited: \[429\]/);
    expect(calls.fallback).toBe(0);
    expect(c.state()).toBeNull();
  });

  it("C: AUTH_ERROR → no forbidden fallback, surfaced verbatim", async () => {
    const { c, calls } = controller({
      classify: () => ({ errorCode: "AUTH_ERROR", error: "Auth error: [401] invalid apikey" }),
      primary: async () => {
        throw new Error("Auth error: [401] invalid apikey");
      },
    });
    await expect(c.load("H1", 30)).rejects.toThrow(/\[401\] invalid apikey/);
    expect(calls.fallback).toBe(0);
    expect(c.state()).toBeNull();
  });

  it("D: unsupported timeframe on the fallback → explicit unavailable, no aggregation", async () => {
    const { c, calls } = controller();
    await expect(c.load("H4", 30)).rejects.toThrow(/no alpha-vantage FX series.*no aggregation/s);
    expect(calls.fallback).toBe(0);
    expect(c.state()).toBeNull();
  });

  it("F: malformed fallback → rejected, the primary failure is what surfaces", async () => {
    const { c } = controller({
      fallback: async () => {
        throw new Error("MALFORMED_RESPONSE: time series is not an object");
      },
    });
    await expect(c.load("H1", 30)).rejects.toThrow(
      /Unsupported symbol.*alpha-vantage fallback failed \(MALFORMED_RESPONSE/s,
    );
    expect(c.state()).toBeNull();
  });
});

// ── §14G provider identity verification ─────────────────────────────

describe("318 — identity mismatch rejected (§14G)", () => {
  it("a series whose meta names a different pair is rejected outright", () => {
    const parsed = parseAlphaVantageFxSeries(
      {
        "Meta Data": { "1. From Symbol": "GBP", "2. To Symbol": "USD" },
        "Time Series FX (Intraday)": {
          "2026-10-05 10:00:00": { "1. open": "1.26", "2. high": "1.27", "3. low": "1.25", "4. close": "1.265" },
        },
      },
      { fromSymbol: "EUR", toSymbol: "USD" },
    );
    expect(parsed).toMatchObject({ ok: false, failureClass: "IDENTITY_MISMATCH" });
    if (!parsed.ok) expect(parsed.reason).toMatch(/GBP\/USD.*EUR\/USD.*rejected/s);
  });

  it("the requested pair's own meta passes; missing meta falls back to structural checks", () => {
    const expect_ = fxPairOf(mapAlphaVantageFxRequest("H1", "EURUSD") as Extract<ReturnType<typeof mapAlphaVantageFxRequest>, { ok: true }>);
    expect(expect_).toEqual({ fromSymbol: "EUR", toSymbol: "USD" });
    const ok = parseAlphaVantageFxSeries(
      {
        "Meta Data": { "1. From Symbol": "EUR", "2. To Symbol": "USD" },
        "Time Series FX (Intraday)": {
          "2026-10-05 10:00:00": { "1. open": "1.11", "2. high": "1.12", "3. low": "1.10", "4. close": "1.115" },
          "2026-10-05 09:00:00": { "1. open": "1.11", "2. high": "1.12", "3. low": "1.10", "4. close": "1.11" },
        },
      },
      expect_,
    );
    expect(ok.ok).toBe(true);
    const noMeta = parseAlphaVantageFxSeries({
      "Time Series FX (Intraday)": {
        "2026-10-05 10:00:00": { "1. open": "1.11", "2. high": "1.12", "3. low": "1.10", "4. close": "1.115" },
      },
    });
    expect(noMeta.ok).toBe(true);
  });
});

// ── §7/§14E/P freshness budget — no fake LIVE, ever ─────────────────

describe("318 — freshness honesty (§14E/P)", () => {
  it("a stale fallback series is labeled stale by the same rule the primary uses", () => {
    const now = Date.now();
    // Newest bar 25 hours old on a 30-minute cadence: past the runtime's
    // own 24h freshness horizon AND beyond 2× the stated spacing → stale.
    // Never dressed up as current.
    const grade = providerSeriesFreshness({
      newestBarTimestamp: now - 25 * HOUR,
      barSpacingMs: 30 * 60e3,
      now,
    });
    expect(grade).toBe("stale");
  });

  it("the freshness function can NEVER claim a live-sounding label (type + runtime)", () => {
    const now = Date.now();
    const cases: Array<[number | null, number | null]> = [
      [now, 60e3],
      [now - 90e3, 60e3],
      [now - 4 * HOUR, 30 * 60e3], // stale horizon not hit, cadence known → delayed (still not live)
      [now - 25 * HOUR, 30 * 60e3],
      [null, null],
      [now + 30 * 60e3, 60e3], // future beyond skew tolerance
      [now - 10 * 24 * HOUR, 24 * HOUR],
    ];
    for (const [bar, spacing] of cases) {
      const grade = providerSeriesFreshness({
        newestBarTimestamp: bar,
        barSpacingMs: spacing,
        now,
      });
      expect(["delayed", "stale", "unavailable"]).toContain(grade);
      expect(grade).not.toBe("realtime");
    }
  });
});

// ── §6/§14I/J sticky routing, no oscillation ────────────────────────

describe("318 — sticky routing, no oscillation (§14I/J)", () => {
  it("the primary RECOVERING mid-run does not flip the snapshot source back", async () => {
    const healthy = series(HOUR, 30);
    let primaryCalls = 0;
    const { c, calls } = controller({
      primary: async () => {
        primaryCalls++;
        throw new Error("Unsupported symbol: [404] transient");
      },
    });
    const first = await c.load("H1", 30);
    // From now on the primary is healthy — the policy still keeps the
    // fallback for the REST of this run (one deterministic decision per run).
    const second = await c.load("M30", 30, );
    expect(first).toHaveLength(30);
    expect(second).toHaveLength(30);
    expect(primaryCalls).toBe(1);
    expect(calls.fallback).toBe(2);
    expect(c.state()?.fallbackProvider).toBe("alpha-vantage");
    void healthy;
  });

  it("a fresh analysis starts on the primary again — no cross-run memory", async () => {
    const healthy = series(HOUR, 30);
    const first = controller();
    await first.c.load("H1", 30);
    const second = controller({ primary: async () => healthy });
    const candles = await second.c.load("H1", 30);
    expect(candles).toBe(healthy);
    expect(second.c.state()).toBeNull();
  });
});

// ── §8/§14H duplicate-call elimination ──────────────────────────────

describe("318 — duplicate acquisition collapses to one call (§14H)", () => {
  it("concurrent identical reads share ONE acquisition (single-flight cache)", async () => {
    resetProviderCache();
    let acquisitions = 0;
    const key = {
      provider: "twelve-data",
      dataset: "ohlcv",
      instrument: "EUR/USD",
      timeframe: "H1",
      qualifier: "bars=210",
    } as const;
    const acquire = async () => {
      acquisitions++;
      await new Promise((r) => setTimeout(r, 5));
      return { data: series(HOUR, 210), observedAt: Date.now() };
    };
    const [a, b] = await Promise.all([
      getProviderCache().fetch<OhlcvCandle[]>(key, acquire),
      getProviderCache().fetch<OhlcvCandle[]>(key, acquire),
    ]);
    expect(acquisitions).toBe(1);
    expect(a?.data).toEqual(b?.data);
  });

  it("distinct bar counts are distinct acquisitions (never shared across shapes)", async () => {
    resetProviderCache();
    let acquisitions = 0;
    const acquire = async () => {
      acquisitions++;
      return { data: series(HOUR, 10), observedAt: Date.now() };
    };
    const base = {
      provider: "twelve-data",
      dataset: "ohlcv",
      instrument: "EUR/USD",
      timeframe: "H1",
    } as const;
    await getProviderCache().fetch<OhlcvCandle[]>({ ...base, qualifier: "bars=210" }, acquire);
    await getProviderCache().fetch<OhlcvCandle[]>({ ...base, qualifier: "bars=120" }, acquire);
    expect(acquisitions).toBe(2);
  });
});

// ── §4/§14K/L/M degraded-but-usable analysis stays usable ───────────

describe("318 — degraded inputs never kill the analysis (§14K/L/M)", () => {
  it("L: forex without calendar → analysis remains, macro gap flagged", () => {
    const input = assemble();
    delete (input as { economicEvents?: unknown }).economicEvents;
    const result = runAnalysis(input as never);
    expect(result.recommendation).toBeDefined();
    expect(result.dataFlags?.some((f) => /No economic calendar data/.test(f))).toBe(true);
  });

  it("M: stock without fundamentals/news → analysis remains, gap flagged", () => {
    const input = assemble({ instrument: "AAPL", instrumentType: "stock" });
    const result = runAnalysis(input as never);
    expect(result.recommendation).toBeDefined();
    expect(result.dataFlags?.some((f) => /No news context or intelligence data/.test(f))).toBe(true);
  });

  it("K: crypto without derivatives data → analysis remains, sentiment gap flagged", () => {
    const input = assemble({ instrument: "BTC/USDT", instrumentType: "crypto" });
    const result = runAnalysis(input as never);
    expect(result.recommendation).toBeDefined();
    expect(result.dataFlags?.some((f) => /No funding rate data/.test(f))).toBe(true);
  });

  it("O: the failover provenance reaches dataFlags AND signal.limitations verbatim", () => {
    const input = assemble();
    const md = input.marketData as typeof input.marketData & {
      primaryProviderFailure?: { provider: string; errorCode: string; reason: string; engagedTimeframe: string };
    };
    md.primaryProviderFailure = {
      provider: "twelve-data",
      errorCode: "SYMBOL_UNSUPPORTED",
      reason: "404 invalid",
      engagedTimeframe: "H1",
    };
    // The action stamps the SERVING provider onto the envelope on failover;
    // mirror that here (the snapshot's own provenance names the actual source).
    md.provider = "alpha-vantage";
    (input as { provider?: string }).provider = "alpha-vantage";
    (input as { providerInstrumentId?: string }).providerInstrumentId = "EURUSD";
    const result = runAnalysis(input as never);
    const flag = result.dataFlags?.find((f) => /served by "alpha-vantage" after the primary provider "twelve-data" failed \(SYMBOL_UNSUPPORTED\)/.test(f));
    expect(flag).toBeDefined();
    const signal = buildSignalResponse({
      result: result as never,
      candles: (input.marketData as { candles: OhlcvCandle[] }).candles,
      provider: "alpha-vantage",
      providerInstrumentId: "EURUSD",
    });
    expect(signal.limitations.some((l) => l === flag)).toBe(true);
  });
});

// ── §13/§14N one snapshot feeds chart AND plan ──────────────────────

describe("318 — chart/plan snapshot identity (§14N)", () => {
  it("the same snapshot yields the same chart provenance hash; a different one does not", () => {
    const input = assemble();
    const candles = (input.marketData as { candles: OhlcvCandle[] }).candles;
    const result = runAnalysis(input as never);
    const s1 = buildSignalResponse({ result: result as never, candles });
    const s2 = buildSignalResponse({ result: result as never, candles });
    expect(s1.chart.available).toBe(true);
    expect(s1.chart.meta?.provenance.inputHash).toBe(s2.chart.meta?.provenance.inputHash);
    const shifted = candles.map((c, i) => (i === candles.length - 1 ? { ...c, close: c.close + 1 } : c));
    const s3 = buildSignalResponse({ result: result as never, candles: shifted });
    expect(s3.chart.meta?.provenance.inputHash).not.toBe(s1.chart.meta?.provenance.inputHash);
  });
});
