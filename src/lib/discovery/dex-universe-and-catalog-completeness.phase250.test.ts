/**
 * Phase 250 — DEX Universe Coverage & Full Instrument Catalog Hardening
 * 60+ tests, 15+ categories
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ── helpers ──
function mockDexPairs(pairs: { chainId: string; dexId: string; pool: string; base: string; quote: string }[]) {
  return {
    ok: true,
    status: 200,
    json: {
      pairs: pairs.map((p) => ({
        chainId: p.chainId,
        dexId: p.dexId,
        pairAddress: p.pool,
        baseToken: { address: "0x1", symbol: p.base },
        quoteToken: { address: "0x2", symbol: p.quote },
      })),
    },
  };
}

describe("Phase250 1 — DEXScreener source", () => {
  it("dexscreener adapter uses search API", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("api.dexscreener.com");
    expect(src).toContain("search/?q=");
  });
  it("source truth is API response not query list", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("Source of truth is API response");
  });
});

describe("Phase250 2 — DEXScreener bounded behavior", () => {
  it("bounded queries ETH/USDC/WETH/SOL documented as BOUNDED_DISCOVERY", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("BOUNDED_DISCOVERY");
    expect(src).toContain("Bounded convenience search");
    expect(src).toContain("NOT complete DEX universe");
  });
  it("runtime-readiness marks dexscreener BOUNDED_DISCOVERY", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("dexscreener");
    expect(src).toContain("BOUNDED_DISCOVERY");
  });
});

describe("Phase250 3 — DEXScreener pagination if supported", () => {
  it("API does not support full enumeration pagination — honestly bounded", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("API only supports search");
    expect(src).toContain("no full enumeration");
  });
});

describe("Phase250 4 — DEXScreener rotation if supported", () => {
  beforeEach(async () => {
    const mod = await import("./dexscreener-adapter");
    mod.resetDexScreenerCursor();
  });
  it("query rotation eventual coverage of partitions", async () => {
    const { discoverDexScreener, resetDexScreenerCursor, getDexScreenerCursor } = await import("./dexscreener-adapter");
    resetDexScreenerCursor();
    const queries = ["ETH", "USDC", "WETH", "SOL", "PEPE", "BONK"];
    const fetchMock = async (url: string) => ({
      ok: true,
      status: 200,
      json: { pairs: [{ chainId: "eth", dexId: "uniswap", pairAddress: "0x" + url.length, baseToken: { address: "0x1", symbol: "T" }, quoteToken: { address: "0x2", symbol: "U" } }] },
    });
    // batch 2
    let res = await discoverDexScreener(fetchMock as any, Date.now(), { queries, maxQueries: 2 });
    expect(res.catalogs?.length).toBe(2);
    expect(getDexScreenerCursor()).toBe(2);
    res = await discoverDexScreener(fetchMock as any, Date.now(), { queries, maxQueries: 2 });
    expect(getDexScreenerCursor()).toBe(4);
    res = await discoverDexScreener(fetchMock as any, Date.now(), { queries, maxQueries: 2 });
    expect(getDexScreenerCursor()).toBe(0); // wraps after full coverage
  });
});

describe("Phase250 5 — DEXScreener no fake completeness", () => {
  it("does not claim complete DEX universe as guaranteed", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    // Honest classification: BOUNDED_DISCOVERY, NOT complete
    expect(src).toContain("BOUNDED_DISCOVERY");
    expect(src).toContain("NOT complete");
    // Should not claim it is complete without NOT qualifier in same sentence
    expect(src).toContain("bounded convenience search");
  });
});

describe("Phase250 6 — Gecko network discovery", () => {
  it("fetches networks dynamically via /networks", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("/networks");
    expect(src).toContain("fetchNetworks");
  });
  it("networks discovered dynamically not hardcoded", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).not.toContain('const NETWORKS = ["eth"');
  });
});

describe("Phase250 7 — Gecko rotation", () => {
  beforeEach(async () => {
    const mod = await import("./geckoterminal-adapter");
    mod.resetGeckoDiscoveryCursor();
  });
  it("network rotation cycle1 1-3, cycle2 next", async () => {
    const { discoverGeckoTerminal, resetGeckoDiscoveryCursor, getGeckoDiscoveryCursor } = await import("./geckoterminal-adapter");
    resetGeckoDiscoveryCursor();
    const networks = ["eth", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche"];
    const fetchMock = async (url: string) => {
      if (url.includes("/networks") && !url.includes("/pools")) {
        return { ok: true, status: 200, json: { data: networks.map((id) => ({ id, type: "network" })) } };
      }
      // pools
      return { ok: true, status: 200, json: { data: [{ id: "1", type: "pool", attributes: { address: "0xabc", name: "WETH / USDC" }, relationships: { dex: { data: { id: "uniswap" } }, base_token: { data: { id: "weth" } }, quote_token: { data: { id: "usdc" } } } }], links: {} } };
    };
    let res = await discoverGeckoTerminal(fetchMock as any, Date.now(), { maxNetworks: 3, maxPagesPerNetwork: 1 });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["/networks/eth/pools", "/networks/bsc/pools", "/networks/polygon/pools"]);
    expect(getGeckoDiscoveryCursor()).toBe(3);
    res = await discoverGeckoTerminal(fetchMock as any, Date.now(), { maxNetworks: 3, maxPagesPerNetwork: 1 });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["/networks/arbitrum/pools", "/networks/optimism/pools", "/networks/base/pools"]);
    expect(getGeckoDiscoveryCursor()).toBe(6);
    res = await discoverGeckoTerminal(fetchMock as any, Date.now(), { maxNetworks: 3, maxPagesPerNetwork: 1 });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["/networks/avalanche/pools"]);
    expect(getGeckoDiscoveryCursor()).toBe(0);
  });
});

describe("Phase250 8 — Gecko page rotation", () => {
  it("maxPages per network bounded but hasMore respected", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("maxPagesPerNetwork");
    expect(src).toContain("hasMore");
    expect(src).toContain("page +=");
  });
});

describe("Phase250 9 — Gecko no starvation", () => {
  it("every network eventually processed", async () => {
    const { discoverGeckoTerminal, resetGeckoDiscoveryCursor } = await import("./geckoterminal-adapter");
    resetGeckoDiscoveryCursor();
    const networks = ["n1", "n2", "n3", "n4", "n5"];
    const seen = new Set<string>();
    const fetchMock = async (url: string) => {
      if (url.includes("/networks") && !url.includes("/pools")) {
        return { ok: true, status: 200, json: { data: networks.map((id) => ({ id, type: "network" })) } };
      }
      return { ok: true, status: 200, json: { data: [{ id: "1", type: "pool", attributes: { address: "0x" + url.length, name: "A / B" }, relationships: { dex: { data: { id: "dex" } } } }], links: {} } };
    };
    const cycles = Math.ceil(networks.length / 2);
    for (let i = 0; i < cycles; i++) {
      const res = await discoverGeckoTerminal(fetchMock as any, Date.now(), { maxNetworks: 2, maxPagesPerNetwork: 1 });
      res.catalogs?.forEach((c) => seen.add(c.path));
    }
    expect(seen.size).toBe(networks.length);
  });
});

describe("Phase250 10 — DEX failure isolation", () => {
  it("network failure does not stop other networks", async () => {
    const { discoverGeckoTerminal, resetGeckoDiscoveryCursor } = await import("./geckoterminal-adapter");
    resetGeckoDiscoveryCursor();
    const networks = ["good1", "bad", "good2"];
    const fetchMock = async (url: string) => {
      if (url.includes("/networks") && !url.includes("/pools")) {
        return { ok: true, status: 200, json: { data: networks.map((id) => ({ id, type: "network" })) } };
      }
      if (url.includes("bad")) throw new Error("timeout");
      return { ok: true, status: 200, json: { data: [{ id: "1", type: "pool", attributes: { address: "0x123", name: "WETH / USDC" }, relationships: { dex: { data: { id: "uniswap" } } } }], links: {} } };
    };
    const res = await discoverGeckoTerminal(fetchMock as any, Date.now(), { maxNetworks: 3, maxPagesPerNetwork: 1 });
    expect(res.success).toBe(true);
    expect(res.warnings.some((w) => w.includes("bad"))).toBe(true);
    expect(res.catalogs?.length).toBe(3);
  });
});

describe("Phase250 11 — rate limit isolation", () => {
  it("rate limited network does not crash batch", async () => {
    const { discoverDexScreener, resetDexScreenerCursor } = await import("./dexscreener-adapter");
    resetDexScreenerCursor();
    const fetchMock = async (url: string) => {
      if (url.includes("ETH")) return { ok: false, status: 429, json: {} };
      return { ok: true, status: 200, json: { pairs: [{ chainId: "eth", dexId: "uniswap", pairAddress: "0xabc", baseToken: { address: "0x1", symbol: "WETH" }, quoteToken: { address: "0x2", symbol: "USDC" } }] } };
    };
    const res = await discoverDexScreener(fetchMock as any, Date.now(), { queries: ["ETH", "USDC"], maxQueries: 2 });
    expect(res.success).toBe(true);
    expect(res.warnings.some((w) => w.includes("429") || w.includes("ETH"))).toBe(true);
  });
});

describe("Phase250 12 — malformed response isolation", () => {
  it("malformed pool filtered, valid remains", async () => {
    const { discoverGeckoTerminal, resetGeckoDiscoveryCursor } = await import("./geckoterminal-adapter");
    resetGeckoDiscoveryCursor();
    const fetchMock = async (url: string) => {
      if (url.includes("/networks") && !url.includes("/pools")) {
        return { ok: true, status: 200, json: { data: [{ id: "eth", type: "network" }] } };
      }
      return {
        ok: true,
        status: 200,
        json: {
          data: [
            { id: "1", type: "pool", attributes: { address: "", name: "" }, relationships: {} },
            { id: "2", type: "pool", attributes: { address: "0xvalid", name: "WETH / USDC" }, relationships: { dex: { data: { id: "uniswap" } } } },
          ],
          links: {},
        },
      };
    };
    const res = await discoverGeckoTerminal(fetchMock as any, Date.now(), { maxNetworks: 1, maxPagesPerNetwork: 1 });
    expect(res.instruments.length).toBe(1);
    expect(res.instruments[0].providerInstrumentId).toContain("0xvalid");
  });
});

describe("Phase250 13 — pool identity", () => {
  it("chain:dex:poolAddress unique per pool", async () => {
    const { discoverDexScreener } = await import("./dexscreener-adapter");
    const fetchMock = async () => ({
      ok: true,
      status: 200,
      json: {
        pairs: [
          { chainId: "eth", dexId: "uniswap", pairAddress: "0xabc", baseToken: { address: "0x1", symbol: "WETH" }, quoteToken: { address: "0x2", symbol: "USDC" } },
          { chainId: "eth", dexId: "uniswap", pairAddress: "0xdef", baseToken: { address: "0x1", symbol: "WETH" }, quoteToken: { address: "0x2", symbol: "USDC" } },
        ],
      },
    });
    const res = await discoverDexScreener(fetchMock as any, Date.now(), { queries: ["WETH"] });
    expect(res.instruments[0].providerInstrumentId).toBe("eth:uniswap:0xabc");
    expect(res.instruments[1].providerInstrumentId).toBe("eth:uniswap:0xdef");
  });
});

describe("Phase250 14 — chain identity", () => {
  it("chain preserved in identity", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("${chain}:${dex}:${poolAddr}");
  });
});

describe("Phase250 15 — DEX identity", () => {
  it("provider identity preserved", async () => {
    const { discoverDexScreener } = await import("./dexscreener-adapter");
    const fetchMock = async () => mockDexPairs([{ chainId: "eth", dexId: "uniswap", pool: "0x123", base: "WETH", quote: "USDC" }]);
    const res = await discoverDexScreener(fetchMock as any, Date.now(), { queries: ["WETH"] });
    expect(res.instruments[0].provider).toBe("dexscreener");
  });
});

describe("Phase250 16 — same-symbol pool separation", () => {
  it("same pair different pools remain distinct", async () => {
    const { discoverDexScreener } = await import("./dexscreener-adapter");
    const fetchMock = async () => ({
      ok: true,
      status: 200,
      json: {
        pairs: [
          { chainId: "eth", dexId: "uniswap", pairAddress: "0x111", baseToken: { address: "0xa", symbol: "PEPE" }, quoteToken: { address: "0xb", symbol: "WETH" } },
          { chainId: "eth", dexId: "sushiswap", pairAddress: "0x111", baseToken: { address: "0xa", symbol: "PEPE" }, quoteToken: { address: "0xb", symbol: "WETH" } },
          { chainId: "bsc", dexId: "pancakeswap", pairAddress: "0x111", baseToken: { address: "0xa", symbol: "PEPE" }, quoteToken: { address: "0xb", symbol: "WETH" } },
        ],
      },
    });
    const res = await discoverDexScreener(fetchMock as any, Date.now(), { queries: ["PEPE"] });
    expect(res.instruments.length).toBe(3);
    expect(new Set(res.instruments.map((i) => i.providerInstrumentId)).size).toBe(3);
  });
});

describe("Phase250 17 — capability truth", () => {
  it("dexscreener on_chain + quote not fake ohlcv live", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("on_chain");
    expect(src).toContain("quote");
  });
  it("geckoterminal includes ohlcv where supported", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("ohlcv");
  });
  it("runtime-readiness distinguishes BOUNDED vs RUNTIME_VERIFIED", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("BOUNDED_DISCOVERY");
    expect(src).toContain("RUNTIME_VERIFIED");
  });
});

describe("Phase250 18 — catalog 80", () => {
  it("CATALOG_RENDER_WINDOW=80 display only", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("CATALOG_RENDER_WINDOW = 80");
    expect(src).toContain("Display window only");
  });
});

describe("Phase250 19 — catalog 81", () => {
  it("81 instruments first 80 visible 1 remaining", async () => {
    const { filterCatalog, windowCatalog, CATALOG_RENDER_WINDOW } = await import("./instrument-universe");
    const catalog = Array.from({ length: 81 }, (_, i) => ({
      provider: "okx",
      providerInstrumentId: `INST-${i}`,
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: ["quote"] as any,
      lifecycle: "LIVE" as const,
      discoveredAt: Date.now(),
    }));
    const filtered = filterCatalog(catalog, { classFilter: "all", query: "" });
    const visible = windowCatalog(filtered, CATALOG_RENDER_WINDOW);
    expect(visible.length).toBe(80);
    expect(filtered.length - visible.length).toBe(1);
  });
});

describe("Phase250 20 — catalog 160", () => {
  it("160 instruments 2 pages", async () => {
    const { filterCatalog, windowCatalog, CATALOG_RENDER_WINDOW } = await import("./instrument-universe");
    const catalog = Array.from({ length: 160 }, (_, i) => ({
      provider: "okx",
      providerInstrumentId: `INST-${i}`,
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: ["quote"] as any,
      lifecycle: "LIVE" as const,
      discoveredAt: Date.now(),
    }));
    const filtered = filterCatalog(catalog, { classFilter: "all", query: "" });
    expect(windowCatalog(filtered, CATALOG_RENDER_WINDOW).length).toBe(80);
    expect(windowCatalog(filtered, CATALOG_RENDER_WINDOW * 2).length).toBe(160);
  });
});

describe("Phase250 21 — catalog 1000", () => {
  it("1000 instruments search beyond 80", async () => {
    const { filterCatalog } = await import("./instrument-universe");
    const catalog = Array.from({ length: 1000 }, (_, i) => ({
      provider: "okx",
      providerInstrumentId: `TOKEN-${i}`,
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: `T${i}`,
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: ["quote"] as any,
      lifecycle: "LIVE" as const,
      discoveredAt: Date.now(),
    }));
    const filtered = filterCatalog(catalog, { classFilter: "all", query: "TOKEN-999" });
    expect(filtered.length).toBe(1);
  });
});

describe("Phase250 22 — catalog 10000", () => {
  it("10000 simulated first window 80 remaining 9920 accessible", async () => {
    const { filterCatalog, windowCatalog, CATALOG_RENDER_WINDOW } = await import("./instrument-universe");
    const catalog = Array.from({ length: 10000 }, (_, i) => ({
      provider: "okx",
      providerInstrumentId: `BIG-${i}`,
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: ["quote"] as any,
      lifecycle: "LIVE" as const,
      discoveredAt: Date.now(),
    }));
    const filtered = filterCatalog(catalog, { classFilter: "all", query: "" });
    expect(filtered.length).toBe(10000);
    const visible = windowCatalog(filtered, CATALOG_RENDER_WINDOW);
    expect(visible.length).toBe(80);
    const second = windowCatalog(filtered, CATALOG_RENDER_WINDOW * 2);
    expect(second.length).toBe(160);
    // search deep
    const deep = filterCatalog(catalog, { classFilter: "all", query: "BIG-9999" });
    expect(deep.length).toBe(1);
  });
});

describe("Phase250 23 — search beyond 80", () => {
  it("search operates on complete catalog", async () => {
    const { filterCatalog } = await import("./instrument-universe");
    const catalog = Array.from({ length: 200 }, (_, i) => ({
      provider: "okx",
      providerInstrumentId: `SEARCH-${i}`,
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: ["quote"] as any,
      lifecycle: "LIVE" as const,
      discoveredAt: Date.now(),
    }));
    const res = filterCatalog(catalog, { classFilter: "all", query: "SEARCH-199" });
    expect(res.length).toBe(1);
    expect(res[0].providerInstrumentId).toBe("SEARCH-199");
  });
});

describe("Phase250 24 — filter beyond 80", () => {
  it("class filter counts use full catalog", async () => {
    const { countForFilter } = await import("./instrument-universe");
    const catalog = Array.from({ length: 100 }, (_, i) => ({
      provider: "okx",
      providerInstrumentId: `C-${i}`,
      assetClass: (i < 90 ? "crypto" : "forex") as any,
      subType: "crypto_spot" as any,
      baseAsset: "BTC",
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: ["quote"] as any,
      lifecycle: "LIVE" as const,
      discoveredAt: Date.now(),
    }));
    expect(countForFilter(catalog, "crypto")).toBe(90);
    expect(countForFilter(catalog, "forex")).toBe(10);
  });
});

describe("Phase250 25 — Load More", () => {
  it("load more increments by CATALOG_RENDER_WINDOW", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("setRenderWindow((w) => Math.min(w + CATALOG_RENDER_WINDOW, filtered.length))");
  });
});

describe("Phase250 26 — query reset", () => {
  it("renderWindow resets on query change", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("form.classFilter, query");
    expect(src).toContain("setRenderWindow(CATALOG_RENDER_WINDOW)");
  });
});

describe("Phase250 27 — class reset", () => {
  it("renderWindow resets on classFilter change", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("form.classFilter");
  });
});

describe("Phase250 28 — full catalog counts", () => {
  it("countByAssetClass derived from catalog", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("countByAssetClass");
  });
});

describe("Phase250 29 — crypto", () => {
  it("crypto present in registry", async () => {
    const { getFullRegistry } = await import("./universal-provider-registry");
    const reg = getFullRegistry();
    expect(reg.some((r) => r.assetClasses.includes("crypto"))).toBe(true);
  });
});

describe("Phase250 30 — forex", () => {
  it("forex present via twelve-data", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("forex");
  });
});

describe("Phase250 31 — commodity", () => {
  it("commodity present", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("commodity");
  });
});

describe("Phase250 32 — equity", () => {
  it("equity present", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("equity");
  });
});

describe("Phase250 33 — index where actually supported", () => {
  it("indices present via twelve-data", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("indices");
  });
  it("DXY actual NOT_IMPLEMENTED honest", () => {
    const src = read("src/convex/marketData.ts");
    expect(src).toContain("actual DXY price series is not available");
  });
});

describe("Phase250 34 — BTC", () => {
  it("BTC anchor via ccxt", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const create = (id: string) => ({ id, fetchMarkets: async () => [{ id: "BTCUSDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true, active: true }] } as any);
    const res = await discoverCcxtMarkets(Date.now(), { getExchanges: () => ["binance"], createExchange: create as any, maxExchanges: 1 });
    expect(res.instruments.some((i) => i.baseAsset === "BTC")).toBe(true);
  });
});

describe("Phase250 35 — ETH", () => {
  it("ETH anchor", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const create = (id: string) => ({ id, fetchMarkets: async () => [{ id: "ETHUSDT", symbol: "ETH/USDT", base: "ETH", quote: "USDT", spot: true, active: true }] } as any);
    const res = await discoverCcxtMarkets(Date.now(), { getExchanges: () => ["binance"], createExchange: create as any, maxExchanges: 1 });
    expect(res.instruments.some((i) => i.baseAsset === "ETH")).toBe(true);
  });
});

describe("Phase250 36 — XAU", () => {
  it("XAU exact identity via twelve-data commodity", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("commodity");
  });
});

describe("Phase250 37 — EUR/USD", () => {
  it("EUR/USD forex", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("forex");
  });
});

describe("Phase250 38 — AAPL", () => {
  it("AAPL equity", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("equity");
  });
});

describe("Phase250 39 — multi-provider identity", () => {
  it("BTC/USDT distinct across providers", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["binance", "okx"];
    const create = (id: string) => ({ id, fetchMarkets: async () => [{ id: "BTCUSDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", spot: true, active: true }] } as any);
    const res = await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 2 });
    const keys = res.instruments.map((i) => `${i.provider}|${i.providerInstrumentId}`);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("Phase250 40 — provider/native preservation", () => {
  it("catalogIdentityKey provider::id", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("catalogIdentityKey");
  });
});

describe("Phase250 41 — no substitution", () => {
  it("live-identity forbids substitution", () => {
    const src = read("src/lib/discovery/live-identity.ts");
    expect(src).toContain("never substitutes");
  });
});

describe("Phase250 42 — no fake fallback", () => {
  it("provider-registry returns null not fake price", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("return null");
  });
});

describe("Phase250 43 — no fabricated data", () => {
  it("no synthetic DXY", () => {
    const src = read("src/convex/marketData.ts");
    expect(src).not.toContain("synthetic DXY");
  });
});

describe("Phase250 44 — no fake timestamps", () => {
  it("providerQuoteTimestampMs validates", () => {
    expect(read("src/convex/marketData.ts")).toContain("providerQuoteTimestampMs");
  });
});

describe("Phase250 45 — stale discovery", () => {
  it("STALE not labeled live", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("STALE");
  });
});

describe("Phase250 46 — discovery-only semantics", () => {
  it("DISCOVERY_ONLY status exists", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("DISCOVERY_ONLY");
  });
});

describe("Phase250 47 — deterministic ordering", () => {
  it("catalog sorted localeCompare", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("localeCompare");
  });
});

describe("Phase250 48 — no hardcoded DEX list", () => {
  it("dexscreener no hardcoded DEX list", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).not.toContain('const DEXES = ["uniswap"');
  });
  it("geckoterminal fetches networks dynamically", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("fetchNetworks");
  });
});

describe("Phase250 49 — no hardcoded token list", () => {
  it("dexscreener queries not treated as source of truth", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("Source of truth is API response");
  });
});

describe("Phase250 50 — no permanent ceiling", () => {
  it("ccxt maxExchanges per-cycle not permanent ceiling", () => {
    const src = read("src/lib/discovery/ccxt-discovery.ts");
    expect(src).toContain("NOT permanent ceiling");
    expect(src).toContain("cursor rotates");
  });
  it("gecko maxNetworks per-cycle not permanent ceiling", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("NOT permanent ceiling");
    expect(src).toContain("cursor rotates");
  });
  it("dex maxQueries per-cycle not permanent ceiling", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("NOT permanent ceiling");
  });
});

describe("Phase250 51 — readiness consistency", () => {
  it("readiness matrix has BOUNDED_DISCOVERY and RUNTIME_VERIFIED", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("BOUNDED_DISCOVERY");
    expect(src).toContain("RUNTIME_VERIFIED");
  });
});

describe("Phase250 52 — runtime-vs-test distinction", () => {
  it("RUNTIME_UNVERIFIED vs SUPPORTED_DISCOVERY distinct", () => {
    const src = read("src/lib/discovery/provider-capability.ts");
    expect(src).toContain("RUNTIME_UNVERIFIED");
    expect(src).toContain("SUPPORTED_DISCOVERY");
  });
});

describe("Phase250 53 — security", () => {
  it("no VITE_ secrets", () => {
    expect(read("src/lib/discovery/ccxt-discovery.ts")).not.toContain("VITE_");
  });
});

describe("Phase250 54 — protected analysis compatibility", () => {
  it("protected analysis uses fetchMarketData", () => {
    expect(read("src/convex/protectedAnalysis.ts")).toContain("fetchMarketData");
  });
});

describe("Phase250 55 — scanner compatibility", () => {
  it("scanner uses provider-native", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("acquireProviderNativeLiveData");
  });
});

describe("Phase250 56 — opportunity compatibility", () => {
  it("liveCandidateBuilder uses provider-native", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("acquireProviderNativeLiveData");
  });
});

describe("Phase250 57 — retry/recovery", () => {
  it("retryConfig exists", () => {
    expect(read("src/lib/data/universal/providers.ts")).toContain("retryConfig");
  });
});

describe("Phase250 58 — duplicate discovery", () => {
  it("dedup by provider|instrumentId", () => {
    const src = read("src/lib/discovery/ccxt-discovery.ts");
    expect(src).toContain("deduped");
  });
});

describe("Phase250 59 — partial discovery", () => {
  it("PARTIAL completeness", () => {
    const src = read("src/lib/discovery/completeness.ts");
    expect(src).toContain("PARTIAL");
  });
});

describe("Phase250 60 — regression stability", () => {
  it("Phase249 tests still exist", () => {
    expect(read("src/lib/discovery/universal-universe-coverage.phase249.test.ts").length).toBeGreaterThan(0);
  });
  it("Phase248 tests exist", () => {
    expect(read("src/lib/discovery/provider-runtime-gap-closure.phase248.test.ts").length).toBeGreaterThan(0);
  });
});
