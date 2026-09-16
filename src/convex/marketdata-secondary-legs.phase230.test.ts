/**
 * Phase 230 — marketData.ts SECONDARY-leg failure semantics.
 *
 * The primary candle leg already classified precisely (§217). The two bare
 * `catch {}` paths flagged in the Phase 229 release gate did not:
 *
 *  1. `marketData.ts` cross-asset block — the DXY candidate probes and the
 *     comparator fetch ended in `.catch(() => null)`, so a 429 during
 *     probing was laundered into "all candidates verified invalid" and
 *     POISONED DXY discovery for 24h (`dxyAllCandidatesFailedAt`), and a
 *     comparator outage was misreported as "provider returned no series".
 *     Now: only a DEFINITIVE provider answer (4xx symbol/plan rejection or
 *     an answered-but-empty series) may arm the 24h negative cache; a quota
 *     or transport failure is INCONCLUSIVE — nothing is armed, probing
 *     resumes next analysis, and the reason names the class.
 *
 *  2. The MTF / quote legs keep their existing non-fatal contracts; the
 *     outer action catch now passes fatal classes through defensively.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resetProviderCache } from "../lib/data/provider-cache-registry";

type CrossAsset = {
  available: boolean;
  unavailableReason?: string;
  comparatorSymbol?: string;
} | undefined;
type Envelope = {
  success: boolean;
  errorCode?: string;
  data?: { instrument: string; candles: unknown[] };
  technical?: { crossAsset: CrossAsset; chainUnavailable?: string[] };
};
type Handler = (
  c: unknown,
  a: { instrument: string; instrumentType: string; timeframe: string },
) => Promise<Envelope>;

const ctx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } };
const EURUSD = { instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4" };
const BTCUSD = { instrument: "BTC/USD", instrumentType: "crypto", timeframe: "H4" };

/** TD time_series payload: `values` newest-first, all numerically valid. */
function tdSeries(n: number, base: number, seed = 0): { values: Record<string, string>[] } {
  const stepMs = 4 * 3600e3;
  const rows: Record<string, string>[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(Date.now() - i * stepMs).toISOString().slice(0, 16).replace("T", " ");
    const p = base + Math.sin((i + seed) / 3) * 0.01 + ((i + seed) % 7) * 0.0004;
    const o = p, c = p + 0.0008, h = c + 0.0003, l = o - 0.0003;
    rows.push({
      datetime: t,
      open: o.toFixed(5), high: h.toFixed(5), low: l.toFixed(5), close: c.toFixed(5),
      volume: "1000",
    });
  }
  return { values: rows };
}
const RATE_LIMIT_BODY = { code: 429, message: "You have exceeded your 800 API credits" };
const NOT_FOUND_BODY = { code: 404, message: "symbol not found on this plan" };

type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
let routes: Record<string, Route> = {};
const calls: string[] = [];
function timeoutError() {
  const e = new Error("The operation timed out");
  e.name = "TimeoutError";
  return e;
}
function routeFor(url: string): Route {
  if (url.includes("/quote?")) return routes["@quote"] ?? { body: { close: "1.0850", timestamp: 1758000000 } };
  const symbol = decodeURIComponent(/[?&]symbol=([^&]+)/.exec(url)?.[1] ?? "?");
  const interval = /[?&]interval=([^&]+)/.exec(url)?.[1] ?? "?";
  const size = /[?&]outputsize=(\d+)/.exec(url)?.[1] ?? "?";
  return (
    routes[`${symbol}@${interval}@${size}`] ??
    routes[`${symbol}@*`] ??
    { body: tdSeries(Number(size) || 50, symbol.startsWith("BTC") ? 100 : 1.08) }
  );
}

/** Fresh module state per test (the DXY memo is module-level). */
let fetchMarketDataHandler: Handler;
let helpers: typeof import("./marketData");
beforeEach(async () => {
  vi.resetModules();
  resetProviderCache();
  helpers = await import("./marketData");
  fetchMarketDataHandler = (helpers.fetchMarketData as unknown as { _handler: Handler })._handler;
  calls.length = 0;
  routes = {};
  process.env.TWELVE_DATA_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const r = routeFor(url);
      if (r.throws) throw r.throws;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: `status-${status}`,
        json: async () => {
          if (r.badJson) throw new SyntaxError("Unexpected token <");
          return r.body;
        },
      } as unknown as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

const dxyProbeCalls = () => calls.filter((u) => /symbol=(DXY|DX\.Y\.NYB|USD_INDEX|I%3ADXY)/.test(u) && u.includes("outputsize=5"));

describe("230 marketData — DXY probe negative-cache semantics", () => {
  it("a 429 wave during probing is INCONCLUSIVE: no 24h poison, probing resumes, reason names the class", async () => {
    routes["DXY@1day@5"] = { body: RATE_LIMIT_BODY };
    routes["DX.Y.NYB@1day@5"] = { body: RATE_LIMIT_BODY };
    routes["USD_INDEX@1day@5"] = { body: RATE_LIMIT_BODY };
    routes["I:DXY@1day@5"] = { body: RATE_LIMIT_BODY };

    const r1 = await fetchMarketDataHandler(ctx, EURUSD);
    expect(r1.success).toBe(true);
    const xa1 = r1.technical?.crossAsset;
    expect(xa1?.available).toBe(false);
    expect(xa1?.unavailableReason).toMatch(/inconclusive/);
    expect(xa1?.unavailableReason).toMatch(/RATE_LIMIT/);
    expect(xa1?.unavailableReason).not.toMatch(/not available on the current Twelve Data plan/);
    expect(dxyProbeCalls().length).toBeGreaterThan(0);

    // Next analysis with a healthy provider: probing MUST run again (no
    // armed negative cache) and actual DXY resolves.
    routes["DXY@1day@5"] = { body: tdSeries(5, 104) };
    calls.length = 0;
    const r2 = await fetchMarketDataHandler(ctx, EURUSD);
    expect(dxyProbeCalls().length).toBeGreaterThan(0);
    expect(r2.technical?.crossAsset?.available).toBe(true);
  });

  it("a transport wave during probing is also INCONCLUSIVE (timeout / network / 5xx teach nothing about the symbol)", async () => {
    routes["DXY@1day@5"] = { throws: timeoutError() };
    routes["DX.Y.NYB@1day@5"] = { throws: new TypeError("fetch failed") };
    routes["USD_INDEX@1day@5"] = { status: 503, body: {} };
    routes["I:DXY@1day@5"] = { body: RATE_LIMIT_BODY };

    const r1 = await fetchMarketDataHandler(ctx, EURUSD);
    expect(r1.technical?.crossAsset?.unavailableReason).toMatch(/inconclusive/);

    routes["DXY@1day@5"] = { body: tdSeries(5, 104) };
    calls.length = 0;
    const r2 = await fetchMarketDataHandler(ctx, EURUSD);
    expect(dxyProbeCalls().length).toBeGreaterThan(0); // resumed, not poisoned
    expect(r2.technical?.crossAsset?.available).toBe(true);
  });

  it("a verified-invalid wave still arms the 24h negative cache (Phase 7C contract intact)", async () => {
    routes["DXY@1day@5"] = { body: NOT_FOUND_BODY };
    routes["DX.Y.NYB@1day@5"] = { body: NOT_FOUND_BODY };
    routes["USD_INDEX@1day@5"] = { body: NOT_FOUND_BODY };
    routes["I:DXY@1day@5"] = { body: NOT_FOUND_BODY };

    const r1 = await fetchMarketDataHandler(ctx, EURUSD);
    expect(r1.technical?.crossAsset?.unavailableReason).toBe(
      "actual DXY price series is not available on the current Twelve Data plan (all documented index symbols verified invalid live) — NEWS-derived USD proxy remains labeled fallback",
    );

    // A healthy provider next time changes nothing: probing is suppressed.
    calls.length = 0;
    const r2 = await fetchMarketDataHandler(ctx, EURUSD);
    expect(dxyProbeCalls().length).toBe(0);
    expect(r2.technical?.crossAsset?.unavailableReason).toMatch(/not available on the current Twelve Data plan/);
  });

  it("a definitive-invalid candidate followed by a working one still resolves (invalidity is per symbol)", async () => {
    routes["DXY@1day@5"] = { body: NOT_FOUND_BODY };
    routes["DX.Y.NYB@1day@5"] = { body: tdSeries(5, 104) }; // resolves here
    const r = await fetchMarketDataHandler(ctx, EURUSD);
    expect(r.technical?.crossAsset?.available).toBe(true);
    expect(r.technical?.crossAsset?.comparatorSymbol).toBe("DX.Y.NYB");
  });
});

describe("230 marketData — comparator fetch failure is classified, not 'no series'", () => {
  it("comparator 429 → unavailableReason names RATE_LIMIT, primary result intact", async () => {
    routes["NDX@4h@120"] = { body: RATE_LIMIT_BODY };
    const r = await fetchMarketDataHandler(ctx, BTCUSD);
    expect(r.success).toBe(true);
    expect(r.data!.candles.length).toBe(210); // primary candles kept
    const xa = r.technical?.crossAsset;
    expect(xa?.available).toBe(false);
    expect(xa?.unavailableReason).toMatch(/could not be fetched: RATE_LIMIT/);
    expect(xa?.unavailableReason).toMatch(/primary data unaffected/);
    expect(xa?.unavailableReason).not.toMatch(/no comparable series returned/);
  });

  it("comparator timeout → unavailableReason names the timeout class", async () => {
    routes["NDX@4h@120"] = { throws: timeoutError() };
    const r = await fetchMarketDataHandler(ctx, BTCUSD);
    expect(r.technical?.crossAsset?.unavailableReason).toMatch(/could not be fetched: timeout/);
  });

  it("comparator answering an empty-but-valid series keeps the 'no comparable series' wording (answered ≠ outage)", async () => {
    routes["NDX@4h@120"] = { body: { values: [] } };
    const r = await fetchMarketDataHandler(ctx, BTCUSD);
    // an empty series throws "no candle data returned" inside fetchCandles —
    // that is a definitive answer about the series, not a transport outage.
    expect(r.technical?.crossAsset?.unavailableReason).toMatch(/no comparable series returned by the provider for NDX/);
  });
});

describe("230 marketData — MTF partial contract unchanged", () => {
  it("a 429 on MTF legs keeps success with unavailable slots listed (existing contract)", async () => {
    routes["EUR/USD@1week@120"] = { body: RATE_LIMIT_BODY };
    routes["EUR/USD@1day@120"] = { body: RATE_LIMIT_BODY };
    routes["EUR/USD@1h@100"] = { body: RATE_LIMIT_BODY };
    const r = await fetchMarketDataHandler(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.technical?.chainUnavailable).toEqual(expect.arrayContaining(["W1", "D1", "H1"]));
  });
});

describe("230 marketData — helper classification units", () => {
  it("isDefinitiveProbeRejection only accepts provider-definitive answers", () => {
    const { isDefinitiveProbeRejection } = helpers;
    expect(isDefinitiveProbeRejection(new Error("[404] symbol not found"))).toBe(true);
    expect(isDefinitiveProbeRejection(new Error("no candle data returned"))).toBe(true);
    expect(isDefinitiveProbeRejection(new Error("provider returned no numerically valid candles"))).toBe(true);
    expect(isDefinitiveProbeRejection(new Error("[429] rate limit"))).toBe(false);
    expect(isDefinitiveProbeRejection(new Error("[401] auth"))).toBe(false);
    expect(isDefinitiveProbeRejection(new Error("[403] forbidden"))).toBe(false);
    expect(isDefinitiveProbeRejection(new Error("[500] server"))).toBe(false);
    expect(isDefinitiveProbeRejection(new TypeError("fetch failed"))).toBe(false);
    const t = new Error("timed out");
    t.name = "TimeoutError";
    expect(isDefinitiveProbeRejection(t)).toBe(false);
  });

  it("secondaryLegFailureText names the fatal classes and the shared taxonomy classes", () => {
    const { secondaryLegFailureText } = helpers;
    expect(secondaryLegFailureText(new Error("[429] hit"))).toMatch(/^RATE_LIMIT \(\[429\]/);
    expect(secondaryLegFailureText(new Error("[401] nope"))).toMatch(/^AUTH_ERROR \(\[401\]/);
    expect(secondaryLegFailureText(new TypeError("fetch failed"))).toMatch(/^network \(/);
    const t = new Error("The operation timed out");
    t.name = "TimeoutError";
    expect(secondaryLegFailureText(t)).toMatch(/^timeout \(/);
    expect(secondaryLegFailureText(new Error("[500] boom"))).toMatch(/^provider_error \(/);
  });

  it("the outer action catch passes fatal classes through defensively (source wiring)", () => {
    const src = readFileSync("src/convex/marketData.ts", "utf8");
    expect(src).toMatch(/msg\.startsWith\("RATE_LIMIT"\) \|\| msg\.startsWith\("\[429\]"\)/);
    expect(src).toMatch(/errorCode: "RATE_LIMIT"/);
    expect(src).toMatch(/errorCode: "AUTH_ERROR"/);
    expect(src).toMatch(/errorCode: "API_UNAVAILABLE"/);
  });
});
