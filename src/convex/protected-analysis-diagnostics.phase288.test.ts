/**
 * Phase 288 — the deployed runtime hands the caller its own leg records.
 *
 * `runProtectedAnalysis` computed a `LegDiagnostic` per provider leg, logged it
 * for the operator and then discarded it: the reason a leg produced nothing was
 * never part of the result. Every consumer outside the deployment — the runtime
 * smoke included — could therefore only repeat a summary sentence, and a rate
 * limit, a missing credential, an unmapped provider identity and an empty
 * provider series were indistinguishable.
 *
 * This suite drives the REAL handler (mocked transport, real fan-out) and pins:
 *   · a failing leg's own reason reaches `result.providerDiagnostics`;
 *   · a leg that answered carries none;
 *   · credentials never appear in the payload;
 *   · the diagnostics are inside `result`, so the entitlement gate still
 *     decides whether they are delivered (no bypass around it).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import { runProtectedAnalysis } from "./protectedAnalysis";
import { fetchMarketData, fetchFxRate } from "./marketData";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { fetchCotPositioning } from "./cot";
import { fetchTreasuryYields } from "./treasury";
import { fetchEiaInventory } from "./eia";
import { fetchOkxInstrumentSpec, fetchOkxOrderBook } from "./okx";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { looksLikeCredential } from "../lib/data/provenance-diagnostics";
import { readFileSync } from "node:fs";

function handlerOf<A, R>(a: unknown): (c: never, x: A) => Promise<R> {
  return (a as { _handler: (c: never, x: A) => Promise<R> })._handler;
}

const HANDLERS: Record<string, (c: never, a: never) => Promise<unknown>> = {
  "marketData:fetchMarketData": handlerOf(fetchMarketData) as never,
  "marketData:fetchFxRate": handlerOf(fetchFxRate) as never,
  "alphaVantage:fetchIntelligence": handlerOf(fetchIntelligence) as never,
  "coinglass:fetchDerivatives": handlerOf(fetchDerivatives) as never,
  "tradingEconomics:fetchCalendar": handlerOf(fetchCalendar) as never,
  "cot:fetchCotPositioning": handlerOf(fetchCotPositioning) as never,
  "treasury:fetchTreasuryYields": handlerOf(fetchTreasuryYields) as never,
  "eia:fetchEiaInventory": handlerOf(fetchEiaInventory) as never,
  "okx:fetchOkxInstrumentSpec": handlerOf(fetchOkxInstrumentSpec) as never,
  "okx:fetchOkxOrderBook": handlerOf(fetchOkxOrderBook) as never,
};

const runAnalysis = handlerOf<Record<string, unknown>, Record<string, unknown>>(
  runProtectedAnalysis,
);

function ctx(): never {
  const c: Record<string, unknown> = {
    auth: { getUserIdentity: async () => ({ subject: "user_A", issuer: "test" }) },
    runMutation: async () => "user_stub",
    runQuery: async () => null,
    runAction: async (ref: unknown, args: unknown) => {
      let name = "";
      try {
        name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      } catch {
        return { success: false, error: "unresolvable" };
      }
      const fn = HANDLERS[name];
      if (!fn) return { success: false, error: "not wired" };
      return fn(c as never, args as never);
    },
  };
  return c as never;
}

const CRYPTO_INPUT = {
  input: {
    instrument: "BTC/USDT",
    instrumentType: "crypto" as const,
    timeframe: "M5",
    tradingStyle: "scalping" as const,
  },
};

let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  resetProviderCache();
  for (const k of [
    "TWELVE_DATA_API_KEY",
    "ALPHA_VANTAGE_API_KEY",
    "COINGLASS_API_KEY",
    "TICKATLAS_API_KEY",
    "EIA_API_KEY",
  ]) {
    process.env[k] = "test-key-value";
  }
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

type LegRecord = {
  provider: string;
  dataset: string;
  acquired: boolean;
  attached: boolean;
  usedByEngine: boolean;
  reason?: string;
};

function legsOf(response: unknown): LegRecord[] {
  const result = (response as { result?: { providerDiagnostics?: unknown } }).result;
  const legs = result?.providerDiagnostics;
  return Array.isArray(legs) ? (legs as LegRecord[]) : [];
}

describe("phase 288 — the result carries the per-leg record", () => {
  it("a leg whose provider rejected the request keeps its own reason", async () => {
    // Twelve Data rejects the candle request the way a quota/plan rejection
    // arrives, so the market-data leg fails with a classified reason.
    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes("twelvedata.com/time_series")) {
        return new Response(
          JSON.stringify({ code: 429, message: "You have reached the API credits limit", status: "error" }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ code: "0", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const response = await runAnalysis(ctx(), CRYPTO_INPUT);
    const legs = legsOf(response);

    expect(legs.length).toBeGreaterThan(0);
    const failed = legs.filter((l) => !l.acquired);
    expect(failed.length).toBeGreaterThan(0);
    // The failing legs say what happened; a bare "unavailable" is not enough.
    const withReason = failed.filter((l) => typeof l.reason === "string" && l.reason.length > 0);
    expect(withReason.length).toBeGreaterThan(0);
    expect(withReason.some((l) => /429|credits limit|RATE_LIMIT/i.test(l.reason!))).toBe(true);
  });

  it("a leg that produced data never carries a reason", async () => {
    const candles = Array.from({ length: 210 }, (_, i) => ({
      datetime: new Date(Date.now() - (210 - i) * 36e5).toISOString(),
      open: "100",
      high: "100.5",
      low: "99.5",
      close: "100",
      volume: "1000",
    }));
    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes("time_series")) {
        return new Response(JSON.stringify({ values: [...candles].reverse(), status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.includes("market/books")) {
        return new Response(
          JSON.stringify({ code: "0", data: [{ bids: [["100", "5", "0", "1"]], asks: [["100.1", "5", "0", "1"]], ts: String(Date.now()) }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ code: "0", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const response = await runAnalysis(ctx(), CRYPTO_INPUT);
    const acquired = legsOf(response).filter((l) => l.acquired);
    expect(acquired.length).toBeGreaterThan(0);
    for (const leg of acquired) {
      expect(leg.reason).toBeUndefined();
    }
  });

  it("no diagnostic text is credential-shaped", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: 401, message: "unauthorized (apikey=SHOULDNEVERAPPEAR)", status: "error" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;

    const response = await runAnalysis(ctx(), CRYPTO_INPUT);
    const payload = JSON.stringify(response);
    // The provider's message survives as a bounded, redacted fragment; the key
    // VALUE it echoed must not. Before phase 288 the redactor masked only the
    // key NAME (`apikey=VALUE` → `[redacted]=VALUE`), which was harmless while
    // these strings were console lines and became a real leak once they travel
    // with the result.
    expect(payload).not.toContain("SHOULDNEVERAPPEAR");
    expect(payload).not.toContain("test-key-value");
    for (const leg of legsOf(response)) {
      if (typeof leg.reason === "string") expect(looksLikeCredential(leg.reason)).toBe(false);
    }
  });

  it("stays inside `result`, so the entitlement gate keeps deciding delivery", () => {
    const source = readFileSync("src/convex/protectedAnalysis.ts", "utf8");
    const attachAt = source.indexOf("engineResult.providerDiagnostics = provenanceLegs");
    const gateAt = source.indexOf("const gated = gateDecision(");
    expect(attachAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    // Attached BEFORE the gate → a LOCKED caller still receives only the
    // gate's own locked payload, never the diagnostics.
    expect(attachAt).toBeLessThan(gateAt);
    // …and every failed leg route passes the outcome's own reason through.
    expect((source.match(/reason: outcome\.reason/g) ?? []).length).toBe(2);
    expect((source.match(/\.\.\.\(typeof outcome\.reason === "string"/g) ?? []).length).toBe(2);
  });
});

describe("phase 288 — the crypto tokenomics credential path is live", () => {
  it("passes the deployment's Tokenomist key to the provider request", async () => {
    // The adapter has always supported an authenticated call and the
    // acquisition seam has always accepted the key — but nothing in production
    // ever populated it, so the credential was unreachable and the deployment's
    // value (if set) had no effect. This drives the REAL handler and inspects
    // the outgoing request.
    process.env.TOKENOMIST_API_KEY = "tokenomist-test-key";
    const seen: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const headers = new Headers((init?.headers as HeadersInit | undefined) ?? {});
      if (href.includes("tokenomist")) {
        seen.push({ url: href, authorization: headers.get("authorization") });
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ code: "0", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    try {
      await runAnalysis(ctx(), CRYPTO_INPUT);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]!.url).toContain("tokenomist");
      expect(seen[0]!.authorization).toBe("Bearer tokenomist-test-key");
    } finally {
      delete process.env.TOKENOMIST_API_KEY;
    }
  });

  it("stays unauthenticated when the deployment sets no key (no invented credential)", () => {
    delete process.env.TOKENOMIST_API_KEY;
    const source = readFileSync("src/convex/protectedAnalysis.ts", "utf8");
    // Conditional spread: an absent env var adds no field at all.
    expect(source).toContain('typeof process.env.TOKENOMIST_API_KEY === "string"');
    expect(source).toContain("{ tokenomistApiKey: process.env.TOKENOMIST_API_KEY }");
  });
});
