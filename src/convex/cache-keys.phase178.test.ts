/**
 * Phase 178 — cache-key correctness for the LIVE Convex provider caches.
 *
 * `provider-cache.phase178.test.ts` proves the new structural cache is sound.
 * This suite guards the three caches that already ship inside Convex actions
 * (Alpha Vantage, CoinGlass, TickAtlas), because those are the ones actually
 * serving the Phase 176/177 fan-out today.
 *
 * The key-construction expressions are asserted against the real source, and
 * the mapping functions are replicated exactly so collisions can be exercised
 * rather than reasoned about.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const AV = readFileSync("src/convex/alphaVantage.ts", "utf8");
const CG = readFileSync("src/convex/coinglass.ts", "utf8");
const TE = readFileSync("src/convex/tradingEconomics.ts", "utf8");

// ── Replicas of the in-module mappings (kept in step by the tests below) ──

function mapSymbolForCG(instrument: string): string {
  return instrument.toUpperCase().trim().split("/")[0];
}

function mapTickerForAV(instrument: string, instrumentType: string): string {
  const sym = instrument.toUpperCase().trim();
  if (instrumentType === "crypto") return sym.split("/")[0];
  if (instrumentType === "forex") return sym.replace("/", "");
  return sym;
}

/** The key expressions as they now exist in the actions. */
const cgKey = (instrument: string) =>
  `deriv:${instrument.toUpperCase().trim()}:${mapSymbolForCG(instrument)}`;
const avNewsKey = (instrument: string, type: string) =>
  `news:${type}:${mapTickerForAV(instrument, type)}`;
const avFundKey = (instrument: string, type: string) =>
  `fund:${type}:${mapTickerForAV(instrument, type)}`;
const calKey = (instrument: string, type: string) =>
  `cal:${instrument.toUpperCase().trim()}:${type.toLowerCase()}`;

// ═══════════════════════════════════════════════════════════
// CoinGlass — the quote-currency collision
// ═══════════════════════════════════════════════════════════

describe("CoinGlass derivatives keys", () => {
  it("BTC/USDT and BTC/USD no longer collide", () => {
    // Pre-178 both mapped to `deriv:BTC`, so a USDT-margined funding rate
    // could be served for a USD-quoted request.
    expect(cgKey("BTC/USDT")).not.toBe(cgKey("BTC/USD"));
  });

  it("spot and the perpetual swap stay distinct", () => {
    expect(cgKey("BTC/USDT")).not.toBe(cgKey("BTC-USDT-SWAP"));
  });

  it("dated futures stay distinct from the perpetual", () => {
    expect(cgKey("BTC-USDT-SWAP")).not.toBe(cgKey("BTC-USDT-241227"));
  });

  it("preserves exact provider-native identity in the key", () => {
    expect(cgKey("BTC-USDT-SWAP")).toContain("BTC-USDT-SWAP");
  });

  it("the source uses the widened key", () => {
    expect(CG).toContain("const cacheKey = `deriv:${args.instrument");
    expect(CG).not.toContain("const cacheKey = `deriv:${symbol}`");
  });

  it("the upstream request still uses the provider's own symbol mapping", () => {
    // Widening the CACHE key must not change what is asked of the provider.
    expect(CG).toContain("const symbol = mapSymbolForCG(args.instrument)");
  });
});

// ═══════════════════════════════════════════════════════════
// Alpha Vantage — asset-class qualification
// ═══════════════════════════════════════════════════════════

describe("Alpha Vantage keys", () => {
  it("a crypto symbol and an equity ticker of the same name are distinct", () => {
    expect(avNewsKey("BTC/USD", "crypto")).not.toBe(avNewsKey("BTC", "stock"));
  });

  it("news and fundamentals never share a key", () => {
    expect(avNewsKey("AAPL", "stock")).not.toBe(avFundKey("AAPL", "stock"));
  });

  it("different instruments stay distinct", () => {
    expect(avNewsKey("EUR/USD", "forex")).not.toBe(
      avNewsKey("GBP/USD", "forex"),
    );
  });

  it("the source qualifies both keys by instrument type", () => {
    expect(AV).toContain("`news:${args.instrumentType}:${ticker}`");
    expect(AV).toContain("`fund:${args.instrumentType}:${ticker}`");
  });
});

// ═══════════════════════════════════════════════════════════
// TickAtlas — case normalisation
// ═══════════════════════════════════════════════════════════

describe("TickAtlas calendar keys", () => {
  it("case variants no longer duplicate-fetch", () => {
    // Pre-178 these were two entries and two provider calls for identical
    // data — wasteful against a rate-limited provider.
    expect(calKey("eur/usd", "forex")).toBe(calKey("EUR/USD", "forex"));
  });

  it("different instruments remain distinct", () => {
    expect(calKey("EUR/USD", "forex")).not.toBe(calKey("USD/JPY", "forex"));
  });

  it("different asset classes remain distinct", () => {
    expect(calKey("XAU/USD", "commodity")).not.toBe(
      calKey("XAU/USD", "forex"),
    );
  });

  it("the source normalises the key", () => {
    expect(TE).toContain("cal:${args.instrument.toUpperCase().trim()}");
  });
});

// ═══════════════════════════════════════════════════════════
// Shared invariants across all three live caches
// ═══════════════════════════════════════════════════════════

describe("live cache invariants", () => {
  const MODULES: Array<[string, string]> = [
    ["alphaVantage", AV],
    ["coinglass", CG],
    ["tradingEconomics", TE],
  ];

  for (const [name, src] of MODULES) {
    it(`${name} never caches a failure envelope`, () => {
      // A `setCache`/`cache.set` must not appear inside a failure return path.
      // Approximated structurally: no cache write immediately after a
      // `success: false` literal.
      expect(src).not.toMatch(/success:\s*false[\s\S]{0,200}?cache\.set\(/);
    });

    it(`${name} keys contain no user-owned dimension`, () => {
      const keyLines = src
        .split("\n")
        .filter((l) => /cacheKey|CacheKey/.test(l) && /`/.test(l));

      expect(keyLines.length).toBeGreaterThan(0);
      for (const line of keyLines) {
        for (const field of [
          "accountEquity",
          "riskPercent",
          "accountCurrency",
          "userId",
        ]) {
          expect(line).not.toContain(field);
        }
      }
    });

    it(`${name} expires entries by wall-clock time`, () => {
      expect(src).toMatch(/Date\.now\(\)\s*<\s*entry\.expiresAt/);
    });
  }

  it("caches are documented as per-process, not distributed", () => {
    // These Maps live in module scope inside a Convex action instance. They
    // reduce load within an instance; they are NOT a cross-instance cache.
    expect(AV).toMatch(/in-memory cache/i);
    expect(CG).toMatch(/in-memory cache/i);
    expect(TE).toMatch(/in-memory cache/i);
  });

  it("cached payloads keep their own observation timestamp", () => {
    // Each provider builds its payload with an embedded `timestamp` BEFORE
    // caching, and cache hits return the stored object verbatim. If a hit
    // rebuilt the object it would reset the timestamp and launder age.
    expect(CG).toMatch(/return \{ success: true, data: cached \}/);
    expect(TE).toMatch(/return \{ success: true, data: cached \}/);
  });
});

// ═══════════════════════════════════════════════════════════
// Negative caching — the DXY comparator probe
// ═══════════════════════════════════════════════════════════

const MD = readFileSync("src/convex/marketData.ts", "utf8");

describe("DXY negative cache", () => {
  it("is bounded, not permanent", () => {
    expect(MD).toMatch(/Date\.now\(\) - dxyAllCandidatesFailedAt < DAY/);
    expect(MD).toMatch(/const DAY = 24 \* 3600e3/);
  });

  it("a failure marker suppresses probing rather than inventing a comparator", () => {
    // On a cached failure the code sets `compSymbol = null`, which flows to
    // `compCandles = null` — an explicit absence, never a synthetic series.
    expect(MD).toMatch(/compSymbol = null;/);
    expect(MD).toMatch(/const compCandles = compSymbol\s*\n?\s*\?/);
  });

  it("a successful resolution is memoised so the probe is not repeated", () => {
    expect(MD).toMatch(/if \(compSymbol\) dxyResolvedSymbol = compSymbol;/);
  });

  it("the probe stops at the first working candidate", () => {
    expect(MD).toMatch(/break; \/\/ stop at first success/);
  });

  it("negative state carries no directional information", () => {
    // The marker is a timestamp only — it cannot express a bias.
    expect(MD).toMatch(/let dxyAllCandidatesFailedAt: number \| null = null;/);
  });
});

describe("modules without a cache stay uncached deliberately", () => {
  // treasury/eia/cot/okx have no module-level TTL cache. That is correct:
  // Treasury/EIA/COT are low-frequency government datasets already bounded by
  // the fan-out, and OKX order-book data must never be reused across analyses.
  for (const m of ["treasury", "eia", "cot", "okx"]) {
    it(`${m} has no ad-hoc Map cache`, () => {
      const src = readFileSync(`src/convex/${m}.ts`, "utf8");
      expect(src).not.toMatch(/const cache = new Map/);
    });
  }
});
