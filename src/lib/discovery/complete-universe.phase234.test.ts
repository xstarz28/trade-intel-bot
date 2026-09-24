/**
 * Phase 234 — COMPLETE MARKET UNIVERSE DISCOVERY
 *
 * Proves pagination, completeness semantics, and catalog behavior.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  catalogHasMorePages,
  fetchTwelveDataCatalogPages,
  parseTwelveDataCatalogPage,
  twelveDataCatalogUrl,
  type FetchJson,
} from "./twelve-data-pagination";
import { createTwelveDataDiscoveryAdapter } from "./twelve-data-adapter";
import { discoverOkxInstruments } from "@/lib/data/universal/okx-discovery";
import { mergeDiscoveryResults } from "./universal-cycle";
import {
  buildInstrumentCatalog,
  catalogFromDiscovered,
  classDiscoverySummaries,
  countByAssetClass,
  countForFilter,
  CATALOG_RENDER_WINDOW,
  filterCatalog,
  providerStatusFromDiscovery,
  windowCatalog,
  type CatalogInstrument,
  type DiscoveryProviderStatus,
} from "./instrument-universe";
import type { DiscoveredInstrument } from "./types";
import type { TrackedInstrument } from "./lifecycle";

const NOW = 1_800_000_000_000;
const KEYED = (name: string) =>
  name === "TWELVE_DATA_API_KEY" ? "test-key" : undefined;

function row(
  overrides: Partial<DiscoveredInstrument> &
    Pick<DiscoveredInstrument, "provider" | "providerInstrumentId" | "assetClass">,
): DiscoveredInstrument {
  return {
    subType: "crypto_spot",
    baseAsset: "X",
    quoteAsset: "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    ...overrides,
  };
}

function paginatedTransport(
  pages: Record<number, { data: unknown[]; count?: number; status?: number }>,
  failAt?: number,
): FetchJson {
  return async (url) => {
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? "1");
    if (failAt !== undefined && page === failAt) {
      return { ok: false, status: 500 };
    }
    const p = pages[page];
    if (!p) {
      return { ok: true, status: 200, json: { data: [], count: 0 } };
    }
    if (p.status && p.status >= 400) {
      return { ok: false, status: p.status };
    }
    return {
      ok: true,
      status: 200,
      json: {
        data: p.data,
        ...(p.count !== undefined ? { count: p.count } : {}),
      },
    };
  };
}

describe("Phase 234 — Twelve Data pagination contract", () => {
  it("parseTwelveDataCatalogPage reads count as totalCount", () => {
    const parsed = parseTwelveDataCatalogPage({
      data: [{ symbol: "A" }],
      count: 10,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.totalCount).toBe(10);
      expect(parsed.rows).toHaveLength(1);
    }
  });

  it("missing count is a complete dump (historical contract)", () => {
    const parsed = parseTwelveDataCatalogPage({
      data: [{ symbol: "A" }, { symbol: "B" }],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.totalCount).toBeUndefined();
    }
    expect(
      catalogHasMorePages({
        rowsThisPage: 2,
        uniqueAccumulated: 2,
        totalCount: undefined,
        newUniqueThisPage: 2,
      }),
    ).toBe(false);
  });

  it("count > accumulated triggers continuation", () => {
    expect(
      catalogHasMorePages({
        rowsThisPage: 2,
        uniqueAccumulated: 2,
        totalCount: 5,
        newUniqueThisPage: 2,
      }),
    ).toBe(true);
  });

  it("twelveDataCatalogUrl omits page=1 and includes page>1", () => {
    const u1 = twelveDataCatalogUrl("/stocks", "k", 1);
    expect(u1).not.toContain("page=");
    const u2 = twelveDataCatalogUrl("/stocks", "k", 3);
    expect(u2).toContain("page=3");
  });

  it("single-page complete provider response is accepted as COMPLETE", async () => {
    const transport = paginatedTransport({
      1: {
        data: [
          { symbol: "AAPL", currency: "USD" },
          { symbol: "MSFT", currency: "USD" },
        ],
        // no count -> historical complete dump
      },
    });
    const res = await fetchTwelveDataCatalogPages(transport, {
      path: "/stocks",
      apiKey: "k",
    });
    expect(res.completeness).toBe("COMPLETE");
    expect(res.pagesFetched).toBe(1);
    expect(res.rows).toHaveLength(2);
    expect(res.warnings).toEqual([]);
  });

  it("single-page with count equal to length is COMPLETE", async () => {
    const transport = paginatedTransport({
      1: {
        data: [{ symbol: "A" }, { symbol: "B" }],
        count: 2,
      },
    });
    const res = await fetchTwelveDataCatalogPages(transport, {
      path: "/forex_pairs",
      apiKey: "k",
    });
    expect(res.completeness).toBe("COMPLETE");
    expect(res.pagesFetched).toBe(1);
  });

  it("multi-page Twelve Data discovery returns all pages", async () => {
    const transport = paginatedTransport({
      1: {
        data: [
          { symbol: "SYM0", currency: "USD" },
          { symbol: "SYM1", currency: "USD" },
        ],
        count: 5,
      },
      2: {
        data: [
          { symbol: "SYM2", currency: "USD" },
          { symbol: "SYM3", currency: "USD" },
        ],
        count: 5,
      },
      3: {
        data: [{ symbol: "SYM4", currency: "USD" }],
        count: 5,
      },
    });
    const res = await fetchTwelveDataCatalogPages(transport, {
      path: "/stocks",
      apiKey: "k",
    });
    expect(res.completeness).toBe("COMPLETE");
    expect(res.pagesFetched).toBe(3);
    expect(res.rows.map((r: any) => r.symbol).sort()).toEqual([
      "SYM0",
      "SYM1",
      "SYM2",
      "SYM3",
      "SYM4",
    ]);
  });

  it("pagination deduplicates exact provider-native IDs", async () => {
    const transport = paginatedTransport({
      1: {
        data: [
          { symbol: "DUP", currency: "USD" },
          { symbol: "A", currency: "USD" },
        ],
        count: 3,
      },
      2: {
        data: [
          { symbol: "DUP", currency: "USD" },
          { symbol: "B", currency: "USD" },
        ],
        count: 3,
      },
    });
    const res = await fetchTwelveDataCatalogPages(transport, {
      path: "/stocks",
      apiKey: "k",
    });
    // transport dedup by symbol, so second page only adds 1 new unique
    expect(res.rows.map((r: any) => r.symbol).sort()).toEqual(["A", "B", "DUP"]);
    // Adapter-level dedup also tested below
  });

  it("failure on later page produces PARTIAL, not COMPLETE", async () => {
    const transport = paginatedTransport(
      {
        1: {
          data: [{ symbol: "A", currency: "USD" }],
          count: 10,
        },
      },
      2, // fail at page 2
    );
    const res = await fetchTwelveDataCatalogPages(transport, {
      path: "/stocks",
      apiKey: "k",
    });
    expect(res.completeness).toBe("PARTIAL");
    expect(res.pagesFetched).toBe(1);
    expect(res.failedPage).toBe(2);
    expect(res.rows).toHaveLength(1);
    expect(res.warnings.some((w) => w.includes("page 2"))).toBe(true);
  });

  it("adapter rolls up COMPLETE/PARTIAL/FAILED per catalog and reports pagesFetched", async () => {
    const byPath = (path: string): FetchJson => {
      if (path === "/forex_pairs") {
        return paginatedTransport({
          1: { data: [{ symbol: "EUR/USD", currency_base: "EUR", currency_quote: "USD" }], count: 1 },
        });
      }
      if (path === "/stocks") {
        // fail this catalog
        return async () => ({ ok: false, status: 500 });
      }
      // other catalogs empty but complete
      return paginatedTransport({ 1: { data: [] } });
    };
    const fetchJson: FetchJson = async (url) => {
      const path = new URL(url).pathname;
      return byPath(path)(url);
    };
    const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      assetClasses: ["forex", "equity"],
    });
    const result = await adapter.discover(NOW);
    expect(result.success).toBe(true);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.catalogs?.find((c) => c.path === "/forex_pairs")?.completeness).toBe("COMPLETE");
    expect(result.catalogs?.find((c) => c.path === "/stocks")?.completeness).toBe("FAILED");
    expect(result.pagesFetched).toBeGreaterThanOrEqual(1);
  });
});

describe("Phase 234 — OKX discovery retains all provider-returned instruments", () => {
  it("retains every live instrument across SPOT/SWAP/FUTURES", async () => {
    const transport = async (url: string): Promise<Response> => {
      const mk = (data: any) =>
        new Response(JSON.stringify({ code: "0", data }), { status: 200 });
      if (url.includes("instType=SPOT")) {
        return mk([
          { instId: "BTC-USDT", instType: "SPOT", baseCcy: "BTC", quoteCcy: "USDT", state: "live" },
          { instId: "ETH-USDT", instType: "SPOT", baseCcy: "ETH", quoteCcy: "USDT", state: "live" },
        ]);
      }
      if (url.includes("instType=SWAP")) {
        return mk([
          { instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live", uly: "BTC-USDT" },
        ]);
      }
      return mk([
        { instId: "BTC-USDT-260925", instType: "FUTURES", state: "live", uly: "BTC-USDT" },
      ]);
    };
    const result = await discoverOkxInstruments(transport, NOW);
    expect(result.success).toBe(true);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.instruments.map((i) => i.instId).sort()).toEqual([
      "BTC-USDT",
      "BTC-USDT-260925",
      "BTC-USDT-SWAP",
      "ETH-USDT",
    ]);
    expect(result.totalDiscovered).toBe(4);
  });

  it("partial failure across instTypes yields PARTIAL", async () => {
    const transport = async (url: string): Promise<Response> => {
      if (url.includes("instType=SPOT")) {
        return new Response("fail", { status: 503 });
      }
      return new Response(JSON.stringify({ code: "0", data: [{ instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live", uly: "BTC-USDT" }] }), {
        status: 200,
      });
    };
    const result = await discoverOkxInstruments(transport, NOW);
    expect(result.success).toBe(true);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.instruments.length).toBeGreaterThan(0);
  });
});

describe("Phase 234 — catalog behavior", () => {
  it("no static ticker list controls discovery", () => {
    const src = readFileSync("src/lib/discovery/twelve-data-adapter.ts", "utf8");
    expect(src).not.toContain("POPULAR_INSTRUMENTS");
    expect(src).not.toMatch(/instruments\.ts/);
    const okxSrc = readFileSync("src/lib/data/universal/okx-discovery.ts", "utf8");
    expect(okxSrc).not.toContain("POPULAR_INSTRUMENTS");
    expect(okxSrc).not.toMatch(/hardcoded.*BTC/);
    const inputSrc = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    expect(inputSrc).not.toContain("POPULAR_INSTRUMENTS");
  });

  it("80-row UI window does not truncate search/catalog state", () => {
    const many = catalogFromDiscovered(
      Array.from({ length: CATALOG_RENDER_WINDOW + 50 }, (_, i) =>
        row({
          provider: "twelve-data",
          providerInstrumentId: `SYM${i}`,
          assetClass: i % 2 === 0 ? "crypto" : "forex",
          subType: "crypto_spot",
          baseAsset: `SYM${i}`,
        }),
      ),
    );
    expect(many.length).toBe(CATALOG_RENDER_WINDOW + 50);
    const filtered = filterCatalog(many, { classFilter: "all", query: "SYM100" });
    expect(filtered).toHaveLength(1);
    const windowed = windowCatalog(filtered);
    expect(windowed).toHaveLength(1);
    const allWindowed = windowCatalog(many);
    expect(allWindowed.length).toBe(CATALOG_RENDER_WINDOW);
    // Search operates over FULL catalog, not windowed
    expect(filterCatalog(many, { classFilter: "all", query: "" }).length).toBe(
      CATALOG_RENDER_WINDOW + 50,
    );
  });

  it("asset-class counts derive from discovered data", () => {
    const catalog = catalogFromDiscovered([
      row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" }),
      row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex" }),
      row({ provider: "twelve-data", providerInstrumentId: "AAPL", assetClass: "equity" }),
      row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity" }),
      row({ provider: "twelve-data", providerInstrumentId: "SPX", assetClass: "indices" }),
    ]);
    const counts = countByAssetClass(catalog);
    expect(counts.crypto).toBe(1);
    expect(counts.forex).toBe(1);
    expect(counts.equity).toBe(1);
    expect(counts.commodity).toBe(1);
    expect(counts.indices).toBe(1);
    expect(countForFilter(catalog, "crypto")).toBe(1);
    expect(countForFilter(catalog, "all")).toBe(5);
  });

  it("class summaries expose completeness per asset class", () => {
    const catalog: CatalogInstrument[] = [
      {
        provider: "twelve-data",
        providerInstrumentId: "EUR/USD",
        assetClass: "forex",
        subType: "forex_spot",
        baseAsset: "EUR",
        quoteAsset: "USD",
        tradingState: "TRADING",
        capabilities: ["ohlcv", "quote"],
        discoveredAt: NOW,
        lifecycle: "DISCOVERED",
      },
      {
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        assetClass: "crypto",
        subType: "crypto_spot",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        tradingState: "TRADING",
        capabilities: ["ohlcv", "quote"],
        discoveredAt: NOW,
        lifecycle: "DISCOVERED",
      },
    ];
    const providers: DiscoveryProviderStatus[] = [
      {
        provider: "twelve-data",
        ok: true,
        completeness: "PARTIAL",
        pagesFetched: 2,
        totalDiscovered: 1,
        catalogs: [
          {
            path: "/forex_pairs",
            assetClass: "forex",
            completeness: "PARTIAL",
            pagesFetched: 1,
            totalDiscovered: 1,
            failedPage: 2,
          },
        ],
      },
      {
        provider: "okx",
        ok: true,
        completeness: "COMPLETE",
        pagesFetched: 3,
        totalDiscovered: 1,
        catalogs: [
          {
            path: "/api/v5/public/instruments",
            assetClass: "crypto",
            completeness: "COMPLETE",
            pagesFetched: 3,
            totalDiscovered: 1,
          },
        ],
      },
    ];
    const summaries = classDiscoverySummaries(catalog, providers);
    expect(summaries.find((s) => s.assetClass === "forex")?.completeness).toBe("PARTIAL");
    expect(summaries.find((s) => s.assetClass === "forex")?.failedPage).toBe(2);
    expect(summaries.find((s) => s.assetClass === "crypto")?.completeness).toBe("COMPLETE");
    expect(summaries.find((s) => s.assetClass === "crypto")?.count).toBe(1);
  });

  it("duplicate economic asset across providers remains two identities", () => {
    const okx = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const td = row({ provider: "twelve-data", providerInstrumentId: "BTC/USD", assetClass: "crypto" });
    const merged = mergeDiscoveryResults([
      {
        provider: "okx",
        success: true,
        discoveredAt: NOW,
        instruments: [okx],
        warnings: [],
        completeness: "COMPLETE",
        pagesFetched: 1,
        totalDiscovered: 1,
      },
      {
        provider: "twelve-data",
        success: true,
        discoveredAt: NOW,
        instruments: [td],
        warnings: [],
        completeness: "COMPLETE",
        pagesFetched: 1,
        totalDiscovered: 1,
      },
    ]);
    expect(merged.discovered).toHaveLength(2);
    const keys = merged.discovered.map((d) => `${d.provider}::${d.providerInstrumentId}`).sort();
    expect(keys).toEqual(["okx::BTC-USDT", "twelve-data::BTC/USD"]);
  });

  it("DELISTED/non-trading rows remain excluded", () => {
    const live = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", tradingState: "TRADING" });
    const halted = row({ provider: "okx", providerInstrumentId: "HALT-USDT", assetClass: "crypto", tradingState: "HALTED" });
    const trackedLive: TrackedInstrument = {
      instrument: live,
      state: "LIVE",
      lastLiveAt: NOW,
      lastSuccessAt: NOW,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    };
    const trackedHalted: TrackedInstrument = {
      instrument: halted,
      state: "DISCOVERED",
      lastLiveAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    };
    const trackedDelisted: TrackedInstrument = {
      instrument: live,
      state: "DELISTED",
      lastLiveAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastSeenInDiscoveryAt: NOW,
    };
    const map = new Map<string, TrackedInstrument>([
      ["okx::BTC-USDT", trackedLive],
      ["okx::HALT-USDT", trackedHalted],
      ["okx::DELISTED", trackedDelisted],
    ]);
    const catalog = buildInstrumentCatalog(map);
    expect(catalog.map((c) => c.providerInstrumentId)).toEqual(["BTC-USDT"]);
  });

  it("discovery metadata never becomes live evidence", () => {
    const discovered = row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex" });
    expect((discovered as any).price).toBeUndefined();
    expect((discovered as any).close).toBeUndefined();
    const status = providerStatusFromDiscovery({
      provider: "twelve-data",
      success: true,
      discoveredAt: NOW,
      instruments: [discovered],
      warnings: [],
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: 1,
      catalogs: [
        { path: "/forex_pairs", assetClass: "forex", completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 1 },
      ],
    });
    // completeness is metadata, not a live flag
    expect(status.completeness).toBe("COMPLETE");
    expect(status.ok).toBe(true);
    expect((status as any).snapshot).toBeUndefined();
    // Ensure DiscoveredInstrument type has no price field in source
    const src = readFileSync("src/lib/discovery/types.ts", "utf8");
    expect(src).not.toMatch(/price\s*:\s*number/);
  });
});
