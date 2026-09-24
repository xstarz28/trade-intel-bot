/**
 * Phase 235 — Universal Provider Expansion Tests
 *
 * Covers:
 * - provider registration / capability / unsupported / failure
 * - CCXT dynamic exchange discovery, fetchMarkets normalization, exact identity, inactive exclusion, dedup
 * - DEX chain/pool identity, token-vs-pool distinction, pagination/completeness, partial
 * - Cross-provider distinct, no alias, no substitution, fallback requires explicit identity
 * - IDX public metadata, REQUIRES_LICENSE, no fake price
 * - Security: no secrets in fixtures
 * - Scanner multi-provider, bounded
 * - UI provider displayed, asset class filter, full-catalog search, window
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  STATIC_REGISTRY,
  getAvailableCcxtExchangesDynamic,
  expandCcxtFamily,
  getFullRegistry,
  registerUniversalAdapter,
  getUniversalAdapter,
  clearUniversalAdapters,
  getAllUniversalAdapters,
  runUniversalDiscoveryV2,
} from "./universal-provider-registry";
import {
  PROVIDER_DISCOVERY_PROFILES,
  classifyProviderDiscovery,
  getDiscoveryProfile,
} from "./provider-capability";
import {
  discoverCcxtMarkets,
  discoverSingleCcxtExchange,
  createCcxtDiscoveryAdapter,
} from "./ccxt-discovery";
import { discoverDexScreener } from "./dexscreener-adapter";
import { discoverGeckoTerminal } from "./geckoterminal-adapter";
import { discoverIdx, acquireIdxLive } from "./idx-adapter";
import {
  createStockbitDiscoveryAdapter,
  createAjaibDiscoveryAdapter,
  acquireStockbitLive,
  acquireAjaibLive,
} from "./stockbit-adapter";
import { mergeDiscoveryResults, acquireDiscoveredBatch } from "./universal-cycle";
import { buildInstrumentCatalog, catalogFromDiscovered, filterCatalog, windowCatalog, CATALOG_RENDER_WINDOW } from "./instrument-universe";
import type { DiscoveredInstrument } from "./types";
import type { TrackedInstrument } from "./lifecycle";

const NOW = 1_800_000_000_000;

function row(overrides: Partial<DiscoveredInstrument> & Pick<DiscoveredInstrument, "provider" | "providerInstrumentId" | "assetClass">): DiscoveredInstrument {
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

// ────────────────────────────────────────────────────────────────
// Provider architecture
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — provider registry architecture", () => {
  it("static registry includes universal providers, not tickers", () => {
    const ids = STATIC_REGISTRY.map((e) => e.providerId);
    expect(ids).toContain("twelve-data");
    expect(ids).toContain("okx");
    expect(ids).toContain("ccxt");
    expect(ids).toContain("dexscreener");
    expect(ids).toContain("geckoterminal");
    expect(ids).toContain("idx");
    expect(ids).toContain("stockbit");
    expect(ids).toContain("ajaib");
    // No ticker list
    expect(ids.some((id) => id.includes("BTC") || id.includes("EUR"))).toBe(false);
  });

  it("provider capability explicit, not all providers forced to have all capabilities", () => {
    const twelve = STATIC_REGISTRY.find((e) => e.providerId === "twelve-data")!;
    expect(twelve.capabilities).toContain("discovery");
    expect(twelve.capabilities).toContain("ohlcv");
    expect(twelve.capabilities).not.toContain("on_chain");

    const dex = STATIC_REGISTRY.find((e) => e.providerId === "dexscreener")!;
    expect(dex.capabilities).toContain("on_chain");
    expect(dex.capabilities).not.toContain("yield_curve");

    const stockbit = STATIC_REGISTRY.find((e) => e.providerId === "stockbit")!;
    expect(stockbit.discoverySupported).toBe(false);
    expect(stockbit.status).toBe("REQUIRES_LICENSE");
  });

  it("unsupported capability is explicit failure, not fake-success", async () => {
    clearUniversalAdapters();
    const adapter = createStockbitDiscoveryAdapter();
    const result = await adapter.discover(NOW);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/REQUIRES_LICENSE/);
    expect(result.completeness).toBe("FAILED");
  });

  it("provider failure explicit, not hidden", async () => {
    clearUniversalAdapters();
    registerUniversalAdapter({
      providerId: "failing-provider",
      displayName: "Failing",
      assetClasses: ["crypto"],
      capabilities: ["discovery"],
      status: "AVAILABLE",
      discoverySupported: true,
      liveSupported: false,
      discover: async () => {
        throw new Error("network down");
      },
    });
    const result = await runUniversalDiscoveryV2(getAllUniversalAdapters(), NOW);
    expect(result.failedProviders).toContain("failing-provider");
    expect(result.warnings.some((w) => w.includes("failing-provider"))).toBe(true);
  });

  it("provider registration is data-driven, no hardcoded if chain", () => {
    const src = readFileSync("src/lib/discovery/universal-provider-registry.ts", "utf8");
    // Should not have long if provider === chain
    const ifCount = (src.match(/if\s*\(\s*provider\s*===/g) ?? []).length;
    expect(ifCount).toBeLessThan(5);
    expect(src).toContain("STATIC_REGISTRY");
    expect(src).toContain("ccxt.exchanges");
  });
});

// ────────────────────────────────────────────────────────────────
// CCXT
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — CCXT backbone", () => {
  it("dynamic exchange discovery from ccxt.exchanges, not hardcoded whitelist as source of truth", () => {
    const exchanges = getAvailableCcxtExchangesDynamic();
    // Should be dynamic list from ccxt, at least 10 exchanges
    expect(exchanges.length).toBeGreaterThan(10);
    // Source file must reference ccxt.exchanges, not manual array as source of truth
    const src = readFileSync("src/lib/discovery/ccxt-discovery.ts", "utf8");
    expect(src).toContain("ccxt.exchanges");
    // Ensure not hardcoded as source of truth (allow bounded slice, but not manual list as registry)
    expect(src).not.toMatch(/const\s+EXCHANGES\s*=\s*\[.*binance.*coinbase.*\]/s);
  });

  it("fetchMarkets normalization preserves exact native identity", async () => {
    const fakeMarkets = [
      { id: "BTC/USDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true, active: true },
      { id: "ETH/USDT", symbol: "ETH/USDT", base: "ETH", quote: "USDT", spot: true, active: true },
    ];
    const result = await discoverCcxtMarkets(NOW, {
      getExchanges: () => ["binance", "coinbase"],
      createExchange: (id) => ({
        id,
        fetchMarkets: async () => (id === "binance" ? fakeMarkets : []),
      }),
      maxExchanges: 1,
    });
    expect(result.success).toBe(true);
    expect(result.instruments.some((i) => i.providerInstrumentId === "BTC/USDT")).toBe(true);
    expect(result.instruments[0].provider).toBe("ccxt:binance");
    // Exact identity, no substitution
    expect(result.instruments[0].providerInstrumentId).toBe("BTC/USDT");
    expect(result.instruments[0].baseAsset).toBe("BTC");
  });

  it("inactive market exclusion", async () => {
    const markets = [
      { id: "BTC/USDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true, active: true },
      { id: "FAKE/USDT", symbol: "FAKE/USDT", base: "FAKE", quote: "USDT", spot: true, active: false },
    ];
    const result = await discoverSingleCcxtExchange("binance", NOW, {
      createExchange: () => ({
        id: "binance",
        fetchMarkets: async () => markets,
      }),
    });
    expect(result.instruments.map((i) => i.providerInstrumentId)).not.toContain("FAKE/USDT");
    expect(result.instruments.map((i) => i.providerInstrumentId)).toContain("BTC/USDT");
  });

  it("duplicate handling across exchanges remains distinct", async () => {
    const marketsBinance = [
      { id: "BTC/USDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true, active: true },
    ];
    const marketsCoinbase = [
      { id: "BTC/USDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true, active: true },
    ];
    const result = await discoverCcxtMarkets(NOW, {
      getExchanges: () => ["binance", "coinbase"],
      createExchange: (id) => ({
        id,
        fetchMarkets: async () => (id === "binance" ? marketsBinance : marketsCoinbase),
      }),
      maxExchanges: 2,
    });
    // Same symbol on two exchanges → two distinct identities
    expect(result.instruments).toHaveLength(2);
    const providers = result.instruments.map((i) => i.provider).sort();
    expect(providers).toEqual(["ccxt:binance", "ccxt:coinbase"]);
  });

  it("ccxt family expands dynamically", () => {
    const expanded = expandCcxtFamily();
    expect(expanded.length).toBeGreaterThan(10);
    expect(expanded[0].providerId.startsWith("ccxt:")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// DEX
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — DEX / on-chain", () => {
  it("chain/pool identity: poolAddress is native id, not token pair", async () => {
    const fakePairs = [
      {
        chainId: "ethereum",
        dexId: "uniswap",
        pairAddress: "0xabc123",
        baseToken: { address: "0xbase1", name: "WETH", symbol: "WETH" },
        quoteToken: { address: "0xquote1", name: "USDC", symbol: "USDC" },
      },
      {
        chainId: "ethereum",
        dexId: "uniswap",
        pairAddress: "0xdef456",
        baseToken: { address: "0xbase1", name: "WETH", symbol: "WETH" },
        quoteToken: { address: "0xquote1", name: "USDC", symbol: "USDC" },
      },
    ];
    const transport = async () => ({
      ok: true,
      status: 200,
      json: { pairs: fakePairs },
    });
    const result = await discoverDexScreener(transport, NOW, { queries: ["WETH"] });
    expect(result.success).toBe(true);
    // Two pools same token pair → two distinct instruments
    expect(result.instruments).toHaveLength(2);
    expect(result.instruments[0].providerInstrumentId).toContain("0xabc123");
    expect(result.instruments[1].providerInstrumentId).toContain("0xdef456");
    expect(result.instruments[0].providerInstrumentId).not.toBe(result.instruments[1].providerInstrumentId);
  });

  it("token-vs-pool distinction preserved", async () => {
    const transport = async () => ({
      ok: true,
      status: 200,
      json: {
        pairs: [
          {
            chainId: "bsc",
            dexId: "pancakeswap",
            pairAddress: "0xpool1",
            baseToken: { address: "0xtokenA", name: "TokenA", symbol: "TKA" },
            quoteToken: { address: "0xtokenB", name: "TokenB", symbol: "TKB" },
          },
        ],
      },
    });
    const result = await discoverDexScreener(transport, NOW, { queries: ["TKA"] });
    const inst = result.instruments[0];
    // Pool identity distinct from token identity
    expect(inst.providerInstrumentId).toContain("0xpool1");
    expect(inst.baseAsset).toBe("TKA");
    expect(inst.quoteAsset).toBe("TKB");
    // Token address not used as instrument id
    expect(inst.providerInstrumentId).not.toBe("0xtokenA");
  });

  it("pagination/completeness semantics preserved for DEX", async () => {
    const transport = async (url: string) => {
      if (url.includes("q=ETH")) {
        return { ok: true, status: 200, json: { pairs: [] } };
      }
      return { ok: false, status: 500 };
    };
    const result = await discoverDexScreener(transport, NOW, { queries: ["ETH", "FAIL"] });
    expect(result.completeness).toBe("PARTIAL");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("geckoterminal networks discovered dynamically, pools paginated", async () => {
    let networkCalled = false;
    const transport = async (url: string) => {
      if (url.includes("/networks") && !url.includes("/pools")) {
        networkCalled = true;
        return { ok: true, status: 200, json: { data: [{ id: "eth" }, { id: "bsc" }] } };
      }
      if (url.includes("/pools")) {
        return {
          ok: true,
          status: 200,
          json: {
            data: [
              {
                id: "pool1",
                type: "pool",
                attributes: { address: "0xpool1", name: "WETH / USDC" },
                relationships: {
                  base_token: { data: { id: "eth_weth" } },
                  quote_token: { data: { id: "eth_usdc" } },
                  dex: { data: { id: "uniswap" } },
                },
              },
            ],
            links: {},
          },
        };
      }
      return { ok: false, status: 404 };
    };
    const result = await discoverGeckoTerminal(transport, NOW, { maxNetworks: 1, maxPagesPerNetwork: 1 });
    expect(networkCalled).toBe(true);
    expect(result.success).toBe(true);
    expect(result.instruments[0].provider).toBe("geckoterminal");
    expect(result.instruments[0].providerInstrumentId).toContain("0xpool1");
  });
});

// ────────────────────────────────────────────────────────────────
// Cross-provider
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — cross-provider identity", () => {
  it("same symbol different provider remains distinct", () => {
    const okx = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const td = row({ provider: "twelve-data", providerInstrumentId: "BTC/USD", assetClass: "crypto" });
    const ccxt = row({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", assetClass: "crypto" });
    const merged = mergeDiscoveryResults([
      { provider: "okx", success: true, discoveredAt: NOW, instruments: [okx], warnings: [], completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 1 },
      { provider: "twelve-data", success: true, discoveredAt: NOW, instruments: [td], warnings: [], completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 1 },
      { provider: "ccxt:binance", success: true, discoveredAt: NOW, instruments: [ccxt], warnings: [], completeness: "COMPLETE", pagesFetched: 1, totalDiscovered: 1 },
    ]);
    expect(merged.discovered).toHaveLength(3);
  });

  it("no alias: BTC-USDT not rewritten to BTC/USD", () => {
    const src = readFileSync("src/lib/discovery/ccxt-discovery.ts", "utf8");
    expect(src).not.toContain("BTC/USD");
    const dexSrc = readFileSync("src/lib/discovery/dexscreener-adapter.ts", "utf8");
    expect(dexSrc).not.toMatch(/BTC-USDT.*BTC\/USD/);
  });

  it("no symbol substitution in instrument-universe", () => {
    const src = readFileSync("src/lib/discovery/instrument-universe.ts", "utf8");
    expect(src).not.toContain("POPULAR_INSTRUMENTS");
    expect(src).not.toMatch(/GOLD.*XAU/);
  });

  it("provider fallback requires explicit discovered identity", async () => {
    const okx = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const batch = [okx];
    const results = await acquireDiscoveredBatch(batch, {
      okx: async () => {
        throw new Error("okx down");
      },
      // No twelve-data handler for this exact instrument, should fail explicitly, not fallback silently
    });
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/acquisition threw|no acquisition path/);
  });
});

// ────────────────────────────────────────────────────────────────
// IDX
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — IDX", () => {
  it("public metadata discovery returns REQUIRES_LICENSE when no credential, no fake price", async () => {
    const transport = async () => ({ ok: false, status: 401 });
    const result = await discoverIdx(transport, NOW, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/REQUIRES_LICENSE/);
    // No price field in DiscoveredInstrument
    expect((result.instruments[0] as any)?.price).toBeUndefined();
  });

  it("IDX live acquisition returns REQUIRES_LICENSE, never fake price", async () => {
    const res = await acquireIdxLive({ providerInstrumentId: "BBCA.JK", assetClass: "equity" });
    expect(res.success).toBe(false);
    expect(res.status).toBe("REQUIRES_LICENSE");
    expect(res.error).toMatch(/licensed/);
    expect((res as any).price).toBeUndefined();
  });

  it("IDX discovery preserves exact native identity", async () => {
    const transport = async () => ({
      ok: true,
      status: 200,
      json: {
        data: [
          { symbol: "BBCA.JK", name: "Bank Central Asia", exchange: "IDX", currency: "IDR" },
          { symbol: "TLKM.JK", name: "Telkom Indonesia", exchange: "IDX", currency: "IDR" },
        ],
      },
    });
    const result = await discoverIdx(transport, NOW, { apiKey: "test-key" });
    expect(result.success).toBe(true);
    expect(result.instruments.map((i) => i.providerInstrumentId)).toContain("BBCA.JK");
    expect(result.instruments[0].provider).toBe("idx");
    expect(result.instruments[0].baseAsset).toBe("BBCA");
    expect(result.instruments[0].quoteAsset).toBe("IDR");
  });
});

// ────────────────────────────────────────────────────────────────
// Security
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — security", () => {
  it("no secrets in provider adapters", () => {
    const files = [
      "src/lib/discovery/ccxt-discovery.ts",
      "src/lib/discovery/dexscreener-adapter.ts",
      "src/lib/discovery/geckoterminal-adapter.ts",
      "src/lib/discovery/idx-adapter.ts",
      "src/lib/discovery/stockbit-adapter.ts",
      "src/lib/discovery/provider-contract.ts",
      "src/lib/discovery/universal-provider-registry.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/TWELVE_DATA_API_KEY.*=.*['\"][a-zA-Z0-9]/);
      expect(src).not.toMatch(/apikey\s*=\s*['\"][a-zA-Z0-9]{10,}/i);
      expect(src).not.toContain("sk-");
    }
  });

  it("no credentials in test fixtures", () => {
    const src = readFileSync("src/lib/discovery/universal-provider-expansion.phase235.test.ts", "utf8");
    expect(src).not.toMatch(/API_KEY.*=.*['\"][a-zA-Z0-9]{20,}/);
  });

  it("stockbit/ajaib do not scrape private endpoints", () => {
    const stockbitSrc = readFileSync("src/lib/discovery/stockbit-adapter.ts", "utf8");
    // No actual private endpoint URLs or mobile API scraping
    expect(stockbitSrc).not.toMatch(/stockbit.*\/api\/private/i);
    expect(stockbitSrc).not.toMatch(/ajaib.*\/private/i);
    expect(stockbitSrc).not.toMatch(/fetch\(.*stockbit/i);
    expect(stockbitSrc).toMatch(/REQUIRES_LICENSE/);
    // Document that unauthorized access is prohibited
    expect(stockbitSrc).toMatch(/unauthorized|REQUIRES_LICENSE/i);
  });
});

// ────────────────────────────────────────────────────────────────
// Scanner
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — scanner multi-provider", () => {
  it("multiple providers actually eligible, scanner no longer OKX-only", () => {
    const src = readFileSync("src/pages/Dashboard.tsx", "utf8");
    // Should contain universal discovery, not only okx + twelve-data
    expect(src).toContain("discoverAllProviders");
    expect(src).toContain("ccxt");
    expect(src).toContain("dexscreener");
    expect(src).toContain("geckoterminal");
    expect(src).toContain("idx");
  });

  it("bounded acquisition retained", () => {
    const src = readFileSync("src/pages/Dashboard.tsx", "utf8");
    expect(src).toContain("batchSize: 20");
    expect(src).toContain("concurrency: 5");
  });

  it("catalog can contain multiple providers for similar economic asset", () => {
    const catalog = catalogFromDiscovered([
      row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" }),
      row({ provider: "twelve-data", providerInstrumentId: "BTC/USD", assetClass: "crypto" }),
      row({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", assetClass: "crypto" }),
      row({ provider: "dexscreener", providerInstrumentId: "ethereum:uniswap:0xabc", assetClass: "crypto" }),
    ]);
    expect(catalog.length).toBe(4);
    const providers = catalog.map((c) => c.provider).sort();
    expect(providers).toContain("okx");
    expect(providers).toContain("twelve-data");
    expect(providers).toContain("ccxt:binance");
    expect(providers).toContain("dexscreener");
  });
});

// ────────────────────────────────────────────────────────────────
// UI
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — UI instrument catalog", () => {
  it("provider displayed in catalog rows", () => {
    const src = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    expect(src).toContain("row.provider");
  });

  it("asset class filter preserved", () => {
    const src = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    expect(src).toContain("classFilter");
    expect(src).toContain("forex");
    expect(src).toContain("crypto");
    expect(src).toContain("stock");
    expect(src).toContain("commodity");
  });

  it("full-catalog search, render window does not cap universe", () => {
    const many = catalogFromDiscovered(
      Array.from({ length: CATALOG_RENDER_WINDOW + 50 }, (_, i) =>
        row({
          provider: i % 2 === 0 ? "okx" : "ccxt:binance",
          providerInstrumentId: `SYM${i}`,
          assetClass: "crypto",
          baseAsset: `SYM${i}`,
        }),
      ),
    );
    expect(many.length).toBe(CATALOG_RENDER_WINDOW + 50);
    const filtered = filterCatalog(many, { classFilter: "all", query: "SYM100" });
    expect(filtered).toHaveLength(1);
    const windowed = windowCatalog(filtered);
    expect(windowed).toHaveLength(1);
    expect(filterCatalog(many, { classFilter: "all", query: "" }).length).toBe(CATALOG_RENDER_WINDOW + 50);
  });
});

// ────────────────────────────────────────────────────────────────
// Twelve Data remains as one provider, pagination preserved
// ────────────────────────────────────────────────────────────────

describe("Phase 235 — Twelve Data remains, pagination preserved", () => {
  it("twelve-data still in registry and discovery profiles", () => {
    const profile = getDiscoveryProfile("twelve-data");
    expect(profile).toBeDefined();
    expect(profile?.discoverableAssetClasses).toContain("forex");
    const entry = STATIC_REGISTRY.find((e) => e.providerId === "twelve-data");
    expect(entry).toBeDefined();
  });

  it("pagination semantics still present in twelve-data adapter", () => {
    const src = readFileSync("src/lib/discovery/twelve-data-adapter.ts", "utf8");
    expect(src).toContain("fetchTwelveDataCatalogPages");
    expect(src).toContain("COMPLETE");
    expect(src).toContain("PARTIAL");
  });
});
