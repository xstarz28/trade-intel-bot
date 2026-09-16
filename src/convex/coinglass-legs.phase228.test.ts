/**
 * Phase 228 — CoinGlass leg-fetcher failure propagation.
 *
 * Before this phase each leg (`fetchOpenInterest` …) ended in
 * `catch { return undefined }`, so the RATE_LIMIT / AUTH_ERROR classification
 * produced by `cgFetch` never reached the Phase 178b rejection check: a 429 on
 * every leg was cached and served as `success: true, confidence: "unavailable"`
 * — indistinguishable from "the market has no derivatives".
 *
 * Drives the REAL action handler through a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchDerivatives, classifyLegError, isFatalLegError, summarizeLegFailures } from "./coinglass";
import type { DerivativesResult } from "../lib/data/derivatives-types";
import { derivativesForRadar } from "../lib/market-radar/derivatives-bridge";

type Handler = (ctx: unknown, args: { instrument: string }) => Promise<DerivativesResult>;
const cg = (fetchDerivatives as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "user_A|sess", issuer: "t" }) } };

type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
let routes: Record<string, Route> = {};
const calls: string[] = [];
const OK_OI = { code: "0", data: [{ openInterest: 900 }, { openInterest: 1000 }] };
const OK_FR = { code: "0", data: [{ symbol: "BTC", data: { currentRate: 0.0001 } }] };
const OK_LS = { code: "0", data: [{ longShortRatio: 1.2 }] };
const OK_LIQ = { code: "0", data: [{ longLiquidation: 10, shortLiquidation: 40 }] };
const ALL_OK = { openInterest: { body: OK_OI }, fundingRate: { body: OK_FR }, longShort: { body: OK_LS }, liquidation: { body: OK_LIQ } };

function routeFor(url: string): Route {
  for (const k of Object.keys(routes)) if (url.includes(k)) return routes[k];
  return { body: {} };
}
function timeoutError() {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  routes = { ...ALL_OK };
  process.env.COINGLASS_API_KEY = "k";
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const r = routeFor(url);
    if (r.throws) throw r.throws;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "x",
      text: async () => "",
      json: async () => {
        if (r.badJson) throw new SyntaxError("Unexpected token <");
        return r.body;
      },
    } as unknown as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); resetProviderCache(); });

const cacheKey = { provider: "coinglass", dataset: "derivatives", instrument: "BTC/USD", instrumentType: "crypto", qualifier: "BTC" } as const;

describe("228 — valid legs", () => {
  it("all four legs parse → success, no error field, cached", async () => {
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.data!.availability).toEqual({ openInterest: true, fundingRate: true, longShort: true, liquidations: true });
    expect(r.data!.confidence).toBe("high");
    expect(r.data!.error).toBeUndefined();
    expect(getProviderCache().peek(cacheKey)).not.toBeNull();
  });
});

describe("228 — RATE_LIMIT is fatal on any leg, via either transport", () => {
  it.each(["openInterest", "fundingRate", "longShort", "liquidation"])("JSON code 429 on %s leg → RATE_LIMIT, nothing cached", async (leg) => {
    routes[leg] = { body: { code: 429, msg: "too many" } };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(cacheKey)).toBeNull();
  });
  it("HTTP 429 (no JSON code) → RATE_LIMIT, not API_UNAVAILABLE", async () => {
    routes.fundingRate = { status: 429, body: {} };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.errorCode).toBe("RATE_LIMIT");
  });
  it("429 on all four legs is a RATE_LIMIT envelope, never a success-looking empty payload", async () => {
    for (const k of Object.keys(routes)) routes[k] = { body: { code: "429", msg: "rate limit" } };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.data).toBeUndefined();
  });
  it("msg mentioning 'rate' with an unknown code still classifies as RATE_LIMIT", async () => {
    routes.longShort = { body: { code: 50001, msg: "Rate limited, retry later" } };
    expect((await cg(ctx, { instrument: "BTC/USD" })).errorCode).toBe("RATE_LIMIT");
  });
  it("a rate-limited acquisition does not poison the cache for the next caller", async () => {
    routes.openInterest = { body: { code: 429, msg: "too many" } };
    expect((await cg(ctx, { instrument: "BTC/USD" })).errorCode).toBe("RATE_LIMIT");
    routes = { ...ALL_OK };
    const r2 = await cg(ctx, { instrument: "BTC/USD" });
    expect(r2.success).toBe(true);
    expect(r2.acquisition).toBe("observed-now");
  });
});

describe("228 — AUTH is fatal on any leg, via either transport", () => {
  it.each([401, 403])("HTTP %d → AUTH_ERROR, nothing cached", async (status) => {
    routes.liquidation = { status, body: {} };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(getProviderCache().peek(cacheKey)).toBeNull();
  });
  it.each(["401", "403"])("JSON code %s → AUTH_ERROR", async (code) => {
    routes.openInterest = { body: { code, msg: "invalid key" } };
    expect((await cg(ctx, { instrument: "BTC/USD" })).errorCode).toBe("AUTH_ERROR");
  });
  it("the credential never appears in the error envelope", async () => {
    process.env.COINGLASS_API_KEY = "SECRET-VALUE-XYZ";
    routes.openInterest = { status: 401, body: {} };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(JSON.stringify(r)).not.toContain("SECRET-VALUE-XYZ");
  });
});

describe("228 — non-fatal leg failures are partial with explicit metadata (option B)", () => {
  it("timeout on one leg → that leg unavailable, error names the leg + class, other legs kept", async () => {
    routes.openInterest = { throws: timeoutError() };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(true);
    expect(r.data!.availability.openInterest).toBe(false);
    expect(r.data!.openInterest).toBeUndefined();
    expect(r.data!.availability.fundingRate).toBe(true);
    expect(r.data!.error).toMatch(/openInterest: timeout/);
    expect(r.data!.error).not.toMatch(/fundingRate/);
  });
  it("network failure (undici TypeError) → network class", async () => {
    routes.fundingRate = { throws: new TypeError("fetch failed") };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.data!.error).toMatch(/fundingRate: network/);
    expect(r.data!.fundingRate).toBeUndefined();
  });
  it("non-JSON body → malformed class, no crash", async () => {
    routes.longShort = { badJson: true };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(true);
    expect(r.data!.error).toMatch(/longShort: malformed/);
  });
  it("HTTP 500 / non-zero provider code → provider_error class", async () => {
    routes.liquidation = { status: 500, body: {} };
    routes.longShort = { body: { code: 30001, msg: "internal" } };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.data!.error).toMatch(/liquidations: provider_error/);
    expect(r.data!.error).toMatch(/longShort: provider_error/);
    expect(r.data!.confidence).toBe("medium");
  });
  it("missing leg (provider answered, nothing usable) is NOT reported as a failure", async () => {
    routes.liquidation = { body: { code: "0", data: [] } };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.data!.availability.liquidations).toBe(false);
    expect(r.data!.error).toBeUndefined();
    expect(r.data!.confidence).toBe("high");
  });
  it("mixed: one ok, one unavailable, one timeout, one 500 → partial with two failure entries", async () => {
    routes.fundingRate = { body: { code: "0", data: [] } };
    routes.longShort = { throws: timeoutError() };
    routes.liquidation = { status: 503, body: {} };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(true);
    expect(r.data!.availability).toEqual({ openInterest: true, fundingRate: false, longShort: false, liquidations: false });
    expect(r.data!.confidence).toBe("low");
    expect(r.data!.error).toBe(
      `longShort: timeout (${timeoutError().message}); liquidations: provider_error (CoinGlass HTTP 503: x)`,
    );
  });
  it("mixed with a fatal leg: fatal wins over partial", async () => {
    routes.longShort = { throws: timeoutError() };
    routes.liquidation = { status: 429, body: {} };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
  });
  it("failed legs never yield zero readings", async () => {
    routes.openInterest = { throws: timeoutError() };
    routes.fundingRate = { status: 500, body: {} };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.data!.openInterest?.current).toBeUndefined();
    expect(r.data!.fundingRate?.currentRate).toBeUndefined();
  });
});

describe("228 — provider outage (every leg failed for transport/provider reasons)", () => {
  it("all timeouts → API_UNAVAILABLE, not success/unavailable, nothing cached", async () => {
    for (const k of Object.keys(routes)) routes[k] = { throws: timeoutError() };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/every leg failed/);
    expect(r.error).toMatch(/openInterest: timeout/);
    expect(getProviderCache().peek(cacheKey)).toBeNull();
  });
  it("all HTTP 500 → API_UNAVAILABLE", async () => {
    for (const k of Object.keys(routes)) routes[k] = { status: 500, body: {} };
    expect((await cg(ctx, { instrument: "BTC/USD" })).errorCode).toBe("API_UNAVAILABLE");
  });
  it("all legs answered-but-empty stays the Phase 227 contract: success with confidence unavailable", async () => {
    for (const k of Object.keys(routes)) routes[k] = { body: { code: "0", data: [] } };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.success).toBe(true);
    expect(r.data!.confidence).toBe("unavailable");
    expect(r.data!.error).toBeUndefined();
  });
});

describe("228 — quota / provenance", () => {
  it("a partial payload carries real provenance and a finite timestamp", async () => {
    routes.openInterest = { throws: timeoutError() };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(r.acquisition).toBe("observed-now");
    expect(Number.isFinite(r.observedAt)).toBe(true);
    expect(r.data!.timestamp).toBe(r.observedAt);
  });
  it("a partial payload is cached (it IS evidence) and its error metadata survives the hit", async () => {
    routes.openInterest = { throws: timeoutError() };
    const r1 = await cg(ctx, { instrument: "BTC/USD" });
    const r2 = await cg(ctx, { instrument: "BTC/USD" });
    expect(r2.acquisition).toBe("cache-reused");
    expect(r2.data!.error).toBe(r1.data!.error);
    expect(calls.length).toBe(4);
  });
  it("a fatal acquisition makes exactly one round of leg calls (no retry storm)", async () => {
    routes.openInterest = { status: 429, body: {} };
    await cg(ctx, { instrument: "BTC/USD" });
    expect(calls.length).toBe(4);
  });
});

describe("228 — scanner/radar never reads a provider failure as market absence", () => {
  it("bridge forwards only the surviving legs of a partial payload", async () => {
    routes.openInterest = { throws: timeoutError() };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    const b = derivativesForRadar("BTC/USD", r.data, r.data!.timestamp + 1000);
    expect(b.derivatives?.openInterest).toBeUndefined();
    expect(b.derivatives?.fundingRate).toBe(0.0001);
  });
  it("a fatal envelope has no data, so the bridge reports 'no derivatives payload'", async () => {
    routes.openInterest = { status: 429, body: {} };
    const r = await cg(ctx, { instrument: "BTC/USD" });
    expect(derivativesForRadar("BTC/USD", r.data, Date.now())).toEqual({ rejected: ["no derivatives payload"] });
  });
});

describe("228 — classifier units", () => {
  it("isFatalLegError only for the two fatal prefixes", () => {
    expect(isFatalLegError(new Error("RATE_LIMIT:x"))).toBe(true);
    expect(isFatalLegError(new Error("AUTH_ERROR:x"))).toBe(true);
    expect(isFatalLegError(new Error("CoinGlass HTTP 500: x"))).toBe(false);
    expect(isFatalLegError(undefined)).toBe(false);
  });
  it("classifyLegError maps timeout/abort/network/syntax/unknown", () => {
    expect(classifyLegError(timeoutError()).status).toBe("timeout");
    const abort = new Error("aborted"); abort.name = "AbortError";
    expect(classifyLegError(abort).status).toBe("timeout");
    expect(classifyLegError(new TypeError("fetch failed")).status).toBe("network");
    expect(classifyLegError(new SyntaxError("bad json")).status).toBe("malformed");
    expect(classifyLegError(new Error("weird")).status).toBe("provider_error");
    expect(classifyLegError("plain string")).toEqual({ status: "provider_error", reason: "plain string" });
  });
  it("summarizeLegFailures skips ok/unavailable and formats the rest", () => {
    expect(summarizeLegFailures({
      a: { status: "ok", value: 1 },
      b: { status: "unavailable", reason: "none" },
      c: { status: "timeout", reason: "t" },
      d: { status: "network", reason: "" },
    })).toBe("c: timeout (t); d: network");
  });
});
