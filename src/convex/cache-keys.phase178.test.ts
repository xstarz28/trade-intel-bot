/**
 * Phase 178b — cache authority and key correctness on the PRODUCTION path.
 *
 * Phase 178 originally asserted the string cache keys of three private
 * `Map` caches. Those caches have been REMOVED: every provider now routes
 * through the single authoritative `ProviderCache`. These tests were rewritten
 * to assert the new architecture rather than the deleted implementation.
 *
 * Behavioural single-flight / freshness proof against the real action handlers
 * lives in `provider-integration.phase178b.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { serializeKey } from "../lib/data/provider-cache";

const AV = readFileSync("src/convex/alphaVantage.ts", "utf8");
const CG = readFileSync("src/convex/coinglass.ts", "utf8");
const TE = readFileSync("src/convex/tradingEconomics.ts", "utf8");
const MD = readFileSync("src/convex/marketData.ts", "utf8");

const PROVIDER_MODULES: Array<[string, string]> = [
  ["alphaVantage", AV],
  ["coinglass", CG],
  ["tradingEconomics", TE],
];

// ═══════════════════════════════════════════════════════════
// Single cache authority
// ═══════════════════════════════════════════════════════════

describe("there is exactly one cache authority", () => {
  for (const [name, src] of PROVIDER_MODULES) {
    it(`${name} has no private Map cache`, () => {
      expect(src).not.toMatch(/const cache = new Map/);
      expect(src).not.toMatch(/function getCached/);
      expect(src).not.toMatch(/function setCache/);
    });

    it(`${name} uses the authoritative provider cache`, () => {
      expect(src).toContain("provider-cache-registry");
      expect(src).toMatch(/getProviderCache\(\)\.fetch/);
    });

    it(`${name} declares provider and dataset in its cache identity`, () => {
      expect(src).toMatch(/provider:\s*"[a-z-]+"/);
      expect(src).toMatch(/dataset:\s*"[a-z-]+"/);
    });
  }

  it("no legacy TTL constant survives to compete with the dataset TTLs", () => {
    for (const [, src] of PROVIDER_MODULES) {
      expect(src).not.toMatch(/const CACHE_TTL/);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Key identity — collisions proven through the real serializer
// ═══════════════════════════════════════════════════════════

describe("production cache identity has no collisions", () => {
  const avNews = (instrument: string, instrumentType: string, ticker: string) =>
    serializeKey({
      provider: "alpha-vantage",
      dataset: "news-sentiment",
      instrument,
      instrumentType,
      qualifier: ticker,
    });

  const cgDeriv = (instrument: string, symbol: string) =>
    serializeKey({
      provider: "coinglass",
      dataset: "derivatives",
      instrument,
      instrumentType: "crypto",
      qualifier: symbol,
    });

  const cal = (instrument: string, instrumentType: string) =>
    serializeKey({
      provider: "tickatlas",
      dataset: "calendar",
      instrument: instrument.toUpperCase().trim(),
      instrumentType,
    });

  it("BTC/USD and BTC/USDT do not collide", () => {
    expect(cgDeriv("BTC/USD", "BTC")).not.toBe(cgDeriv("BTC/USDT", "BTC"));
  });

  it("BTC spot and BTC-USDT-SWAP do not collide", () => {
    expect(cgDeriv("BTC/USDT", "BTC")).not.toBe(
      cgDeriv("BTC-USDT-SWAP", "BTC-USDT-SWAP"),
    );
  });

  it("a crypto ticker and an equity ticker of the same name do not collide", () => {
    expect(avNews("BTC/USD", "crypto", "BTC")).not.toBe(
      avNews("BTC", "stock", "BTC"),
    );
  });

  it("news and fundamentals never share an entry", () => {
    const news = serializeKey({
      provider: "alpha-vantage",
      dataset: "news-sentiment",
      instrument: "AAPL",
      instrumentType: "stock",
    });
    const fund = serializeKey({
      provider: "alpha-vantage",
      dataset: "fundamentals",
      instrument: "AAPL",
      instrumentType: "stock",
    });
    expect(news).not.toBe(fund);
  });

  it("calendar keys are case-normalised (no duplicate fetch)", () => {
    expect(cal("eur/usd", "forex")).toBe(cal("EUR/USD", "forex"));
  });

  it("calendar keys still separate asset classes", () => {
    expect(cal("XAU/USD", "commodity")).not.toBe(cal("XAU/USD", "forex"));
  });

  it("OKX native identity stays byte-exact", () => {
    for (const id of ["BTC-USDT-SWAP", "ETH-USD-240628", "BTC-USDT-241227"]) {
      const key = serializeKey({
        provider: "okx",
        dataset: "order-book",
        instrument: id,
      });
      expect(key).toContain(id);
      expect(key).not.toContain(id.toLowerCase());
    }
  });

  it("EUR/USD H1 and H4 do not collide", () => {
    const base = {
      provider: "twelve-data",
      dataset: "ohlcv" as const,
      instrument: "EUR/USD",
    };
    expect(serializeKey({ ...base, timeframe: "H1" })).not.toBe(
      serializeKey({ ...base, timeframe: "H4" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════
// Failures must never be cached on the production path
// ═══════════════════════════════════════════════════════════

describe("provider failures never become cached evidence", () => {
  it("coinglass throws rate-limit/auth out of the cache fetcher", () => {
    // Returning an error envelope from inside the fetcher would let the
    // cache store a 429 as if it were data.
    expect(CG).toMatch(/throw new Error\("RATE_LIMIT/);
    expect(CG).toMatch(/throw new Error\("AUTH_ERROR/);
  });

  it("coinglass still reports the correct error code to callers", () => {
    // Rethrowing must not collapse a 429 into a generic outage.
    expect(CG).toMatch(/msg\.startsWith\("RATE_LIMIT"\)/);
    expect(CG).toMatch(/errorCode: "RATE_LIMIT"/);
  });

  it("tradingEconomics rethrows rate-limit/auth out of the fetcher", () => {
    expect(TE).toMatch(/if \(m\.startsWith\("RATE_LIMIT"\) \|\| m\.startsWith\("AUTH_ERROR"\)\) throw err;/);
  });

  it("tradingEconomics still reports the correct error code", () => {
    expect(TE).toMatch(/msg\.startsWith\("RATE_LIMIT"\)/);
    expect(TE).toMatch(/errorCode: "RATE_LIMIT"/);
  });

  it("an unresolvable currency mapping caches nothing", () => {
    expect(TE).toMatch(/return null;/);
  });
});

// ═══════════════════════════════════════════════════════════
// Provenance
// ═══════════════════════════════════════════════════════════

describe("observation time is preserved by construction", () => {
  it("coinglass seeds observedAt from the payload timestamp", () => {
    expect(CG).toMatch(/observedAt: data\.timestamp/);
  });

  it("tradingEconomics seeds observedAt from the payload timestamp", () => {
    expect(TE).toMatch(/observedAt: data\.timestamp/);
  });

  it("no provider resets observedAt on the read path", () => {
    for (const [, src] of PROVIDER_MODULES) {
      // `observedAt` may only be set inside a fetcher (an actual acquisition),
      // never next to a cache read.
      expect(src).not.toMatch(/cached[\s\S]{0,80}observedAt:\s*Date\.now\(\)/);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Negative caching — DXY comparator probe
// ═══════════════════════════════════════════════════════════

describe("DXY negative cache", () => {
  it("is bounded, not permanent", () => {
    expect(MD).toMatch(/Date\.now\(\) - dxyAllCandidatesFailedAt < DAY/);
    expect(MD).toMatch(/const DAY = 24 \* 3600e3/);
  });

  it("suppresses probing rather than inventing a comparator", () => {
    expect(MD).toMatch(/compSymbol = null;/);
    expect(MD).toMatch(/const compCandles = compSymbol\s*\n?\s*\?/);
  });

  it("memoises a successful resolution", () => {
    expect(MD).toMatch(/if \(compSymbol\) dxyResolvedSymbol = compSymbol;/);
  });

  it("stops at the first working candidate", () => {
    expect(MD).toMatch(/break; \/\/ stop at first success/);
  });

  it("carries no directional information", () => {
    expect(MD).toMatch(/let dxyAllCandidatesFailedAt: number \| null = null;/);
  });
});

// ═══════════════════════════════════════════════════════════
// Modules that deliberately have no cache
// ═══════════════════════════════════════════════════════════

describe("uncached providers stay uncached deliberately", () => {
  for (const m of ["treasury", "eia", "cot", "okx"]) {
    it(`${m} has no ad-hoc Map cache`, () => {
      const src = readFileSync(`src/convex/${m}.ts`, "utf8");
      expect(src).not.toMatch(/const cache = new Map/);
    });
  }
});

// ═══════════════════════════════════════════════════════════
// Scope honesty
// ═══════════════════════════════════════════════════════════

describe("cache scope is documented honestly", () => {
  it("the registry states it is per-process, not distributed", () => {
    const reg = readFileSync("src/lib/data/provider-cache-registry.ts", "utf8");
    expect(reg).toMatch(/NOT distributed/);
    expect(reg).toMatch(/action instance/);
  });

  it("no module claims a global or distributed cache", () => {
    for (const [, src] of PROVIDER_MODULES) {
      expect(src).not.toMatch(/distributed cache/i);
      expect(src).not.toMatch(/global cache/i);
    }
  });
});
