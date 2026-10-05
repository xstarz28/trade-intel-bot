/**
 * Phase 317 — FX failover semantics (deterministic; no network).
 *
 * Covers the phase's required provider-failure semantics A–G plus the
 * request-mapping and response-parsing contracts:
 *
 *   A. Twelve Data FX refusal → fallback succeeds
 *   B. refusal → no valid fallback → the ORIGINAL primary error surfaces
 *      (explicit UNAVAILABLE), annotated with the fallback's own failure
 *   C. fallback delivers a wrong-timeframe series → REJECTED, no resampling
 *   D. the request derives ONLY from the catalog-declared native id
 *      (no guessed from/to split; unmapped instrument never fails over)
 *   E. stale fallback data carries honest freshness labels (never fake LIVE)
 *   F. a successful failover exposes the ACTUAL provider + native id + the
 *      primary failure (provenance the envelope renders)
 *   G. sticky-within-run routing: the primary is decision-probed exactly
 *   once; a new controller starts on the primary again (no cross-run
 *   memory, no arbitrary timing)
 */

import { describe, it, expect } from "vitest";
import type { OhlcvCandle } from "../market-types";
import {
  FX_FAILOVER_TRIGGER_CLASSES,
  isFxFailoverTrigger,
  mapAlphaVantageFxRequest,
  buildAlphaVantageFxUrl,
  parseAlphaVantageFxSeries,
  deliveredCadenceMatchesTimeframe,
  createFxFailoverController,
  type FxFailoverConfig,
} from "./fx-failover";

const HOUR = 60 * 60e3;

function series(tfMs: number, count: number, newestMs = Date.now()): OhlcvCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: newestMs - (count - 1 - i) * tfMs,
    open: 1.1, high: 1.2, low: 1.0, close: 1.15,
    volume: 0,
  }));
}

const okConfig: FxFailoverConfig = {
  catalogAvSymbol: "EURUSD",
  fallbackConfigured: true,
  classifyPrimary: () => ({
    errorCode: "SYMBOL_UNSUPPORTED",
    error: 'Unsupported symbol: [404] **symbol** or **figi** parameter is missing or invalid.',
  }),
};

function controller(overrides: {
  config?: Partial<FxFailoverConfig>;
  primary?: (tf: string, bars: number) => Promise<OhlcvCandle[]>;
  fallback?: (tf: string, bars: number, av: string) => Promise<OhlcvCandle[]>;
} = {}) {
  const calls = { primary: 0, fallback: 0 };
  const c = createFxFailoverController({
    config: { ...okConfig, ...overrides.config },
    primary:
      overrides.primary ??
      (async () => {
        calls.primary++;
        throw new Error("Unsupported symbol: [404] **symbol** or **figi** parameter is missing or invalid.");
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

describe("317 — FX failover trigger classes", () => {
  it("trigger classes are exactly the provider-side failure set", () => {
    expect(FX_FAILOVER_TRIGGER_CLASSES).toEqual([
      "SYMBOL_UNSUPPORTED",
      "API_UNAVAILABLE",
      "NETWORK_ERROR",
      "MALFORMED_RESPONSE",
      "TIMEFRAME_UNAVAILABLE",
    ]);
    expect(isFxFailoverTrigger("SYMBOL_UNSUPPORTED")).toBe(true);
    // The primary's own credential/quota states NEVER fail over.
    expect(isFxFailoverTrigger("RATE_LIMIT")).toBe(false);
    expect(isFxFailoverTrigger("AUTH_ERROR")).toBe(false);
    // A definitive answered-empty series is a data state, not an outage.
    expect(isFxFailoverTrigger("NO_LIVE_DATA")).toBe(false);
  });
});

describe("317 — request mapping (§D: catalog id only)", () => {
  it("splits from/to ONLY from the declared 6-letter native id", () => {
    const mapped = mapAlphaVantageFxRequest("M30", "EURUSD");
    expect(mapped).toEqual({
      ok: true,
      fn: "FX_INTRADAY",
      interval: "30min",
      fromSymbol: "EUR",
      toSymbol: "USD",
      expectedCadenceMs: 30 * 60e3,
    });
    const url = buildAlphaVantageFxUrl(mapped as Extract<typeof mapped, { ok: true }>);
    expect(url).toContain("function=FX_INTRADAY");
    expect(url).toContain("from_symbol=EUR");
    expect(url).toContain("to_symbol=USD");
    expect(url).toContain("interval=30min");
    expect(url).toContain("timezone=UTC");
  });

  it("intraday serves M1/M5/M15/M30/H1; D1 and W1 use their own functions", () => {
    expect(mapAlphaVantageFxRequest("M1", "EURUSD")).toMatchObject({ interval: "1min" });
    expect(mapAlphaVantageFxRequest("M5", "EURUSD")).toMatchObject({ interval: "5min" });
    expect(mapAlphaVantageFxRequest("M15", "EURUSD")).toMatchObject({ interval: "15min" });
    expect(mapAlphaVantageFxRequest("H1", "EURUSD")).toMatchObject({ interval: "60min" });
    const d1 = mapAlphaVantageFxRequest("D1", "EURUSD");
    expect(d1).toMatchObject({ fn: "FX_DAILY" });
    expect(d1.ok && "interval" in d1).toBe(false);
    expect(mapAlphaVantageFxRequest("W1", "EURUSD")).toMatchObject({ fn: "FX_WEEKLY" });
  });

  it("H4 is refused deterministically — no aggregation, no relabelling", () => {
    const mapped = mapAlphaVantageFxRequest("H4", "EURUSD");
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.reason).toMatch(/no alpha-vantage FX series/);
      expect(mapped.reason).toMatch(/no aggregation/);
    }
  });

  it("a non-6-letter native id is refused — never guessed from the display symbol", () => {
    const slash = mapAlphaVantageFxRequest("H1", "EUR/USD");
    expect(slash.ok).toBe(false);
    if (!slash.ok) expect(slash.reason).toMatch(/6-letter/);
    const lowercase = mapAlphaVantageFxRequest("H1", "eurusd");
    expect(lowercase.ok).toBe(false);
  });
});

describe("317 — response parsing", () => {
  it("parses an AV FX series strictly (asc order, UTC datetimes, volume 0)", () => {
    const parsed = parseAlphaVantageFxSeries({
      "Meta Data": { "1. Information": "FX Intraday" },
      "Time Series (FX)": {
        "2026-10-05 10:30:00": { "1. open": "1.1179", "2. high": "1.1181", "3. low": "1.1177", "4. close": "1.1180" },
        "2026-10-05 10:00:00": { "1. open": "1.1175", "2. high": "1.1180", "3. low": "1.1174", "4. close": "1.1179" },
      },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.candles.map((c) => c.timestamp)).toEqual([
        Date.parse("2026-10-05T10:00:00Z"),
        Date.parse("2026-10-05T10:30:00Z"),
      ]);
      expect(parsed.candles[0]).toMatchObject({ open: 1.1175, high: 1.118, low: 1.1174, close: 1.1179, volume: 0 });
    }
  });

  it("classifies quota notes, plan restrictions, errors and empty series", () => {
    expect(parseAlphaVantageFxSeries({ Note: "please claim your free apikey" })).toMatchObject({
      ok: false,
      failureClass: "QUOTA_EXHAUSTED",
    });
    expect(parseAlphaVantageFxSeries({ Information: "premium endpoint" })).toMatchObject({
      ok: false,
      failureClass: "PLAN_RESTRICTED",
    });
    expect(parseAlphaVantageFxSeries({ "Error Message": "Invalid API call" })).toMatchObject({
      ok: false,
      failureClass: "PROVIDER_FAILURE",
    });
    expect(parseAlphaVantageFxSeries({ "Time Series (FX)": {} })).toMatchObject({
      ok: false,
      failureClass: "NO_DATA",
    });
    expect(parseAlphaVantageFxSeries("nope")).toMatchObject({ ok: false, failureClass: "MALFORMED_RESPONSE" });
  });

  it("parses bare-date daily series as UTC midnight", () => {
    const parsed = parseAlphaVantageFxSeries({
      "Time Series FX (Daily)": {
        "2026-10-02": { "1. open": "1.12", "2. high": "1.13", "3. low": "1.11", "4. close": "1.125" },
      },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.candles[0].timestamp).toBe(Date.parse("2026-10-02T00:00:00Z"));
  });
});

describe("317 — delivered-cadence check (§C)", () => {
  it("accepts the requested cadence through session gaps; rejects a wrong series", () => {
    const hourly = series(HOUR, 30);
    expect(deliveredCadenceMatchesTimeframe(hourly, HOUR)).toBe(true);
    // Weekend: one 2-day gap inside an otherwise hourly series is a minority.
    const withWeekend = [...hourly.slice(0, 10), ...hourly.slice(10).map((c) => ({ ...c, timestamp: c.timestamp + 48 * HOUR }))];
    expect(deliveredCadenceMatchesTimeframe(withWeekend, HOUR)).toBe(true);
    // A daily series delivered for an H1 request is a WRONG-TIMEFRAME delivery.
    expect(deliveredCadenceMatchesTimeframe(series(24 * HOUR, 30), HOUR)).toBe(false);
    expect(deliveredCadenceMatchesTimeframe(series(HOUR, 30), 24 * HOUR)).toBe(false);
  });
});

describe("317 — controller semantics (§A–§G)", () => {
  it("A: primary refusal → fallback serves", async () => {
    const { c } = controller();
    const candles = await c.load("H1", 30);
    expect(candles).toHaveLength(30);
    expect(c.state()).toMatchObject({
      fallbackProvider: "alpha-vantage",
      fallbackNativeId: "EURUSD",
      primaryProvider: "twelve-data",
      primaryErrorCode: "SYMBOL_UNSUPPORTED",
      engagedTimeframe: "H1",
    });
  });

  it("B: no valid fallback → the primary failure surfaces (explicit UNAVAILABLE) with the reason named", async () => {
    const { c } = controller({
      config: { fallbackConfigured: false },
    });
    // The refusal LEADS with the original primary error (classification
    // preserved for the action's classifier) and names why no failover ran.
    await expect(c.load("H1", 30)).rejects.toThrow(
      /^Unsupported symbol: \[404\] \*\*symbol\*\* or \*\*figi\*\* parameter is missing or invalid\. — FX failover not attempted: no alpha-vantage credential is configured$/,
    );
    expect(c.state()).toBeNull();
  });

  it("B: the catalog declares no alpha-vantage id (e.g. XAU/USD) → never fails over", async () => {
    const primaryError = new Error("Unsupported symbol: [404] invalid");
    const { c } = controller({
      config: { catalogAvSymbol: null },
      primary: async () => {
        throw primaryError;
      },
    });
    await expect(c.load("H1", 30)).rejects.toThrow(/declares no alpha-vantage native id/);
    expect(c.state()).toBeNull();
  });

  it("B: fallback itself fails → primary error resurfaces with the fallback failure noted", async () => {
    const { c } = controller({
      fallback: async () => {
        throw new Error("QUOTA_EXHAUSTED: alpha-vantage note: premium");
      },
    });
    await expect(c.load("H1", 30)).rejects.toThrow(
      /Unsupported symbol.*FX failover not attempted: alpha-vantage fallback failed \(QUOTA_EXHAUSTED/s,
    );
    expect(c.state()).toBeNull();
  });

  it("B: the fallback cannot serve the requested timeframe (H4) → refused, no aggregation", async () => {
    const { c } = controller();
    await expect(c.load("H4", 30)).rejects.toThrow(/no alpha-vantage FX series.*no aggregation/s);
    expect(c.state()).toBeNull();
  });

  it("C: a wrong-timeframe fallback series is REJECTED — no resampling", async () => {
    const { c } = controller({
      fallback: async () => series(24 * HOUR, 30), // daily bars for an H1 request
    });
    await expect(c.load("H1", 30)).rejects.toThrow(/cadence does not match H1 — rejected, no resampling/);
    expect(c.state()).toBeNull();
  });

  it("D: RATE_LIMIT and AUTH_ERROR surface verbatim — no failover, no masking", async () => {
    for (const code of ["RATE_LIMIT", "AUTH_ERROR"]) {
      const err = new Error(`${code}: primary credential state`);
      const { c, calls } = controller({
        config: { classifyPrimary: () => ({ errorCode: code, error: `${code}: primary credential state` }) },
        primary: async () => {
          throw err;
        },
      });
      await expect(c.load("H1", 30)).rejects.toBe(err);
      expect(calls.fallback).toBe(0);
      expect(c.state()).toBeNull();
    }
  });

  it("E: stale fallback data is not rejected — freshness labels carry honestly (provider cadence rules)", async () => {
    // The controller accepts the series; the envelope derives freshness from
    // the provider's own newest bar + cadence (providerSeriesFreshness in the
    // action), so a days-old series grades stale — never "live".
    const staleNewest = Date.now() - 3 * 24 * HOUR;
    const { c } = controller({
      fallback: async () => series(HOUR, 30, staleNewest),
    });
    const candles = await c.load("H1", 30);
    expect(candles[candles.length - 1].timestamp).toBeLessThan(Date.now() - 24 * HOUR);
    expect(c.state()).not.toBeNull();
  });

  it("F: the engaged state exposes the ACTUAL provider, native id and primary failure", async () => {
    const { c } = controller();
    await c.load("M30", 30);
    const state = c.state();
    expect(state).not.toBeNull();
    expect(state?.fallbackProvider).toBe("alpha-vantage");
    expect(state?.fallbackNativeId).toBe("EURUSD");
    expect(state?.primaryReason).toMatch(/missing or invalid/);
  });

  it("G: sticky within one run — the fallback serves every later leg without re-probing", async () => {
    const { c, calls } = controller();
    await c.load("H1", 30);
    await c.load("H4", 120).catch(() => undefined); // even a fallback TF refusal path is not re-probing
    await c.load("D1", 100);
    expect(calls.primary).toBe(1);
    expect(calls.fallback).toBeGreaterThanOrEqual(2);
  });

  it("G: a fresh controller starts on the primary again — no cross-run memory", async () => {
    const healthy = series(HOUR, 30);
    const first = controller();
    await first.c.load("H1", 30);
    const second = controller({
      primary: async () => healthy,
    });
    const candles = await second.c.load("H1", 30);
    expect(candles).toBe(healthy);
    expect(second.c.state()).toBeNull();
  });

  it("primary serving → no failover state, fallback never called", async () => {
    const healthy = series(HOUR, 30);
    const { c, calls } = controller({ primary: async () => healthy });
    const candles = await c.load("H1", 30);
    expect(candles).toBe(healthy);
    expect(c.state()).toBeNull();
    expect(calls.fallback).toBe(0);
  });
});
