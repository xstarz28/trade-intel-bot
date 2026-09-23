/**
 * Phase 160 — Full asset-class coverage from REAL provider capability.
 *
 * The rule: coverage must come from a provider that genuinely lists the
 * instruments. Never a fake list, never placeholder rows, and never an
 * empty success standing in for "we have no credentials".
 */

import { describe, expect, it } from "vitest";
import {
  createTwelveDataDiscoveryAdapter,
  normalizeCatalogRow,
  type FetchJson,
} from "./twelve-data-adapter";
import { createOkxDiscoveryAdapter } from "./okx-adapter";
import { runUniversalDiscovery, selectAcquirableInstruments } from "./registry";
import { ALL_ASSET_CLASSES } from "./types";

const NOW = 1_800_000_000_000;
const KEYED = (name: string) =>
  name === "TWELVE_DATA_API_KEY" ? "test-key" : undefined;
const UNKEYED = () => undefined;

function catalogTransport(
  byPath: Record<string, unknown>,
  failing: string[] = [],
): FetchJson {
  return async (url) => {
    const path = new URL(url).pathname;
    if (failing.includes(path)) return { ok: false, status: 503 };
    const json = byPath[path];
    if (json === undefined) return { ok: false, status: 404 };
    return { ok: true, status: 200, json };
  };
}

const FULL_CATALOG = {
  "/forex_pairs": {
    data: [
      { symbol: "EUR/USD", currency_base: "EUR", currency_quote: "USD" },
      { symbol: "USD/JPY", currency_base: "USD", currency_quote: "JPY" },
    ],
  },
  "/stocks": {
    data: [
      { symbol: "AAPL", currency: "USD", exchange: "NASDAQ", country: "United States" },
      { symbol: "BBCA", currency: "IDR", exchange: "IDX", country: "Indonesia" },
    ],
  },
  "/commodities": {
    data: [{ symbol: "XAU/USD", category: "Precious Metal" }],
  },
  "/indices": {
    data: [{ symbol: "SPX", currency: "USD", country: "United States" }],
  },
  "/cryptocurrencies": {
    data: [{ symbol: "BTC/USD", currency_base: "BTC", currency_quote: "USD" }],
  },
};

// ═══════════════════════════════════════════════════════════════
// A. CREDENTIAL HONESTY
// ═══════════════════════════════════════════════════════════════

describe("A — credentials are required, never faked", () => {
  it("fails explicitly when credentials are missing", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      UNKEYED,
    );
    const result = await adapter.discover(NOW);

    expect(result.success).toBe(false);
    expect(result.instruments).toEqual([]);
    expect(result.error).toContain("TWELVE_DATA_API_KEY");
  });

  it("never emits placeholder instruments without credentials", async () => {
    const result = await runUniversalDiscovery(
      [createTwelveDataDiscoveryAdapter(catalogTransport(FULL_CATALOG), UNKEYED)],
      NOW,
    );

    expect(result.instruments).toEqual([]);
    expect(result.failedProviders).toEqual(["twelve-data"]);
    // A missing key must NOT be reported as a successful empty universe.
    expect(result.succeededProviders).toEqual([]);
  });

  it("does not call the network when credentials are missing", async () => {
    let calls = 0;
    const adapter = createTwelveDataDiscoveryAdapter(
      async () => {
        calls += 1;
        return { ok: true, status: 200, json: { data: [] } };
      },
      UNKEYED,
    );

    await adapter.discover(NOW);
    expect(calls).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. REAL MULTI-ASSET-CLASS COVERAGE
// ═══════════════════════════════════════════════════════════════

describe("B — coverage across asset classes", () => {
  it("discovers forex, equity, commodity, indices and crypto", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      KEYED,
    );
    const result = await runUniversalDiscovery([adapter], NOW);

    expect(result.assetClassCoverage.forex).toBe(2);
    expect(result.assetClassCoverage.equity).toBe(2);
    expect(result.assetClassCoverage.commodity).toBe(1);
    expect(result.assetClassCoverage.indices).toBe(1);
    expect(result.assetClassCoverage.crypto).toBe(1);
  });

  it("combines multiple providers into one universe", async () => {
    const okx = createOkxDiscoveryAdapter(
      async () =>
        new Response(
          JSON.stringify({
            code: "0",
            data: [
              {
                instId: "BTC-USDT",
                instType: "SPOT",
                baseCcy: "BTC",
                quoteCcy: "USDT",
                state: "live",
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const td = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      KEYED,
    );

    const result = await runUniversalDiscovery([okx, td], NOW);

    expect(result.succeededProviders.sort()).toEqual(["okx", "twelve-data"]);
    expect(new Set(result.instruments.map((i) => i.provider))).toEqual(
      new Set(["okx", "twelve-data"]),
    );
  });

  it("preserves provider-native symbols exactly", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      KEYED,
    );
    const result = await adapter.discover(NOW);
    const ids = result.instruments.map((i) => i.providerInstrumentId);

    expect(ids).toContain("EUR/USD");
    expect(ids).toContain("AAPL");
    expect(ids).toContain("XAU/USD");
    expect(ids).toContain("SPX");
  });

  it("treats non-US listings as first-class", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      KEYED,
    );
    const result = await adapter.discover(NOW);
    const bbca = result.instruments.find((i) => i.providerInstrumentId === "BBCA");

    expect(bbca).toBeDefined();
    expect(bbca!.quoteAsset).toBe("IDR");
    expect(bbca!.region).toBe("Indonesia");
  });

  it("makes discovered instruments acquirable across classes", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      KEYED,
    );
    const result = await runUniversalDiscovery([adapter], NOW);
    const acquirable = selectAcquirableInstruments(result.instruments, "ohlcv");

    expect(new Set(acquirable.map((i) => i.assetClass))).toEqual(
      new Set(["forex", "equity", "commodity", "indices", "crypto"]),
    );
  });

  it("supports filtering to specific asset classes", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      KEYED,
      { assetClasses: ["forex"] },
    );
    const result = await adapter.discover(NOW);

    expect(new Set(result.instruments.map((i) => i.assetClass))).toEqual(
      new Set(["forex"]),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// C. PARTIAL FAILURE ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("C — partial catalog failure", () => {
  it("keeps working classes when one catalog fails", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG, ["/stocks"]),
      KEYED,
    );
    const result = await adapter.discover(NOW);

    expect(result.success).toBe(true);
    expect(result.instruments.some((i) => i.assetClass === "forex")).toBe(true);
    expect(result.instruments.some((i) => i.assetClass === "equity")).toBe(false);
    expect(result.warnings.some((w) => w.includes("/stocks"))).toBe(true);
  });

  it("fails overall only when every catalog fails", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport({}, Object.keys(FULL_CATALOG)),
      KEYED,
    );
    const result = await adapter.discover(NOW);

    expect(result.success).toBe(false);
    expect(result.error).toContain("all catalogs");
  });

  it("survives a thrown transport", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(async () => {
      throw new Error("socket hang up");
    }, KEYED);
    const result = await adapter.discover(NOW);

    expect(result.success).toBe(false);
    expect(result.warnings.some((w) => w.includes("socket hang up"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. NEVER INVENT IDENTITY
// ═══════════════════════════════════════════════════════════════

describe("D — rows are skipped, never fabricated", () => {
  const forexSpec = {
    path: "/forex_pairs",
    assetClass: "forex" as const,
    subType: "forex_spot" as const,
    identity: (row: { currency_base?: string; currency_quote?: string }) =>
      row.currency_base && row.currency_quote
        ? { base: row.currency_base, quote: row.currency_quote }
        : null,
  };

  it("skips a row with no symbol", () => {
    expect(
      normalizeCatalogRow(
        { currency_base: "EUR", currency_quote: "USD" },
        forexSpec,
        NOW,
      ),
    ).toBeNull();
  });

  it("skips a row missing its quote leg rather than guessing USD", () => {
    expect(
      normalizeCatalogRow({ symbol: "EUR/???", currency_base: "EUR" }, forexSpec, NOW),
    ).toBeNull();
  });

  it("reports skipped rows as warnings", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport({
        "/forex_pairs": {
          data: [
            { symbol: "EUR/USD", currency_base: "EUR", currency_quote: "USD" },
            { symbol: "BROKEN" },
          ],
        },
      }),
      KEYED,
      { assetClasses: ["forex"] },
    );

    const result = await adapter.discover(NOW);
    expect(result.instruments).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("skipped 1 row"))).toBe(true);
  });

  it("rejects an unexpected payload shape instead of inventing data", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport({ "/forex_pairs": { unexpected: true } }),
      KEYED,
      { assetClasses: ["forex"] },
    );

    const result = await adapter.discover(NOW);
    expect(result.instruments).toEqual([]);
    expect(result.success).toBe(false);
  });

  it("never claims coverage for an asset class it cannot discover", async () => {
    const adapter = createTwelveDataDiscoveryAdapter(
      catalogTransport(FULL_CATALOG),
      KEYED,
      { assetClasses: ["forex"] },
    );
    const result = await runUniversalDiscovery([adapter], NOW);

    // macro has no discovery source here — coverage must read zero.
    expect(result.assetClassCoverage.macro).toBe(0);
    expect(result.assetClassCoverage.equity).toBe(0);
    for (const assetClass of ALL_ASSET_CLASSES) {
      expect(result.assetClassCoverage[assetClass]).toBeGreaterThanOrEqual(0);
    }
  });
});
