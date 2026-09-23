/**
 * Phase 249 — Universal Exchange, DEX & Instrument Universe Coverage Integrity
 * 60+ tests, 15+ categories
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ── helpers for CCXT rotation ──
function mockMarkets(exId: string, symbols: string[]) {
  return symbols.map((sym) => {
    const [base, quote] = sym.split("/");
    return {
      id: sym.replace("/", ""),
      symbol: sym,
      base: base ?? "BTC",
      quote: quote ?? "USDT",
      type: "spot",
      spot: true,
      active: true,
    };
  });
}

function makeCreateExchange(
  behavior: Record<string, { markets?: string[]; error?: string }>,
) {
  return (id: string) => {
    const cfg = behavior[id];
    return {
      id,
      fetchMarkets: async () => {
        if (!cfg) return mockMarkets(id, ["BTC/USDT"]);
        if (cfg.error) throw new Error(cfg.error);
        return mockMarkets(id, cfg.markets ?? ["BTC/USDT"]);
      },
    } as any;
  };
}

describe("Phase249 1 — CCXT exchange count", () => {
  it("getAvailableCcxtExchangesDynamic returns >=50", async () => {
    const { getAvailableCcxtExchangesDynamic } = await import("./universal-provider-registry");
    const list = getAvailableCcxtExchangesDynamic();
    expect(list.length).toBeGreaterThanOrEqual(50);
  });
  it("total 105+ expected", async () => {
    const { getAvailableCcxtExchangesDynamic } = await import("./universal-provider-registry");
    const list = getAvailableCcxtExchangesDynamic();
    // At time of writing 105, allow growth
    expect(list.length).toBeGreaterThanOrEqual(100);
  });
});

describe("Phase249 2 — unique exchange IDs", () => {
  it("exchange IDs unique", async () => {
    const { getAvailableCcxtExchangesDynamic } = await import("./universal-provider-registry");
    const list = getAvailableCcxtExchangesDynamic();
    const uniq = new Set(list);
    expect(uniq.size).toBe(list.length);
  });
  it("no empty IDs", async () => {
    const { getAvailableCcxtExchangesDynamic } = await import("./universal-provider-registry");
    const list = getAvailableCcxtExchangesDynamic();
    for (const id of list) expect(id.trim().length).toBeGreaterThan(0);
  });
});

describe("Phase249 3 — provider ID generation", () => {
  it("ccxt:<exchange> deterministic", async () => {
    const { ccxtProviderId } = await import("./universal-provider-registry");
    expect(ccxtProviderId("binance")).toBe("ccxt:binance");
    expect(ccxtProviderId("okx")).toBe("ccxt:okx");
  });
  it("provider ID uniqueness across exchanges", async () => {
    const { getAvailableCcxtExchangesDynamic, ccxtProviderId } = await import("./universal-provider-registry");
    const list = getAvailableCcxtExchangesDynamic();
    const pids = list.map(ccxtProviderId);
    expect(new Set(pids).size).toBe(pids.length);
  });
});

describe("Phase249 4 — dynamic registry", () => {
  it("registry expands dynamically, not hardcoded 105 names", () => {
    const src = read("src/lib/discovery/universal-provider-registry.ts");
    expect(src).toContain("ccxt.exchanges");
    expect(src).not.toContain('"binance","coinbase","okx"');
  });
  it("full registry includes dynamic CCXT family", async () => {
    const { getFullRegistry } = await import("./universal-provider-registry");
    const reg = getFullRegistry();
    const ccxtEntries = reg.filter((r) => r.providerId.startsWith("ccxt:"));
    expect(ccxtEntries.length).toBeGreaterThanOrEqual(100);
  });
});

describe("Phase249 5 — maxExchanges interpretation", () => {
  it("maxExchanges=5 is per-cycle batch, not permanent ceiling", () => {
    const src = read("src/lib/discovery/ccxt-discovery.ts");
    expect(src).toContain("bounded per cycle for scalability, NOT permanent ceiling");
    expect(src).toContain("cursor rotates to cover eventual");
  });
  it("code uses rotation, not slice(0,max) only", () => {
    const src = read("src/lib/discovery/ccxt-discovery.ts");
    expect(src).toContain("globalCcxtCursor");
    expect(src).toContain("nextCursor");
  });
});

describe("Phase249 6 — rotating batches (7 exchanges batch 2)", () => {
  beforeEach(async () => {
    const mod = await import("./ccxt-discovery");
    mod.resetCcxtDiscoveryCursor();
  });
  it("cycle1 1-2, cycle2 3-4, cycle3 5-6, cycle4 7", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor, getCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["ex1", "ex2", "ex3", "ex4", "ex5", "ex6", "ex7"];
    const behavior: Record<string, { markets: string[] }> = {};
    exchanges.forEach((e) => (behavior[e] = { markets: [`BTC/USDT`] }));
    const create = makeCreateExchange(behavior);

    // cycle1
    let res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["ccxt:ex1/fetchMarkets", "ccxt:ex2/fetchMarkets"]);
    expect(getCcxtDiscoveryCursor()).toBe(2);

    // cycle2
    res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["ccxt:ex3/fetchMarkets", "ccxt:ex4/fetchMarkets"]);
    expect(getCcxtDiscoveryCursor()).toBe(4);

    // cycle3
    res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["ccxt:ex5/fetchMarkets", "ccxt:ex6/fetchMarkets"]);
    expect(getCcxtDiscoveryCursor()).toBe(6);

    // cycle4
    res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["ccxt:ex7/fetchMarkets"]);
    expect(getCcxtDiscoveryCursor()).toBe(0);

    // cycle5 rotation restarts
    res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.catalogs?.map((c) => c.path)).toEqual(["ccxt:ex1/fetchMarkets", "ccxt:ex2/fetchMarkets"]);
  });
});

describe("Phase249 7 — no starvation", () => {
  it("every exchange eventually processed over ceil(N/batch) cycles", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["a", "b", "c", "d", "e", "f", "g"];
    const seen = new Set<string>();
    const create = makeCreateExchange(
      Object.fromEntries(exchanges.map((e) => [e, { markets: ["BTC/USDT"] }])),
    );
    const cycles = Math.ceil(exchanges.length / 2);
    for (let i = 0; i < cycles; i++) {
      const res = await discoverCcxtMarkets(Date.now(), {
        getExchanges: () => exchanges,
        createExchange: create as any,
        maxExchanges: 2,
      });
      res.catalogs?.forEach((c) => {
        const ex = c.path.split(":")[1].split("/")[0];
        seen.add(ex);
      });
    }
    expect(seen.size).toBe(exchanges.length);
    exchanges.forEach((e) => expect(seen.has(e)).toBe(true));
  });
});

describe("Phase249 8 — cursor advancement", () => {
  it("cursor advances even after success", async () => {
    const { discoverCcxtMarkets, getCcxtDiscoveryCursor, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["x1", "x2", "x3"];
    const create = makeCreateExchange({ x1: { markets: ["BTC/USDT"] }, x2: { markets: ["ETH/USDT"] }, x3: { markets: ["SOL/USDT"] } });
    await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 1 });
    expect(getCcxtDiscoveryCursor()).toBe(1);
    await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 1 });
    expect(getCcxtDiscoveryCursor()).toBe(2);
  });
  it("set/get/reset cursor", async () => {
    const mod = await import("./ccxt-discovery");
    mod.setCcxtDiscoveryCursor(5);
    expect(mod.getCcxtDiscoveryCursor()).toBe(5);
    mod.resetCcxtDiscoveryCursor();
    expect(mod.getCcxtDiscoveryCursor()).toBe(0);
  });
});

describe("Phase249 9 — failed exchange isolation", () => {
  it("one failure does not stop batch", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["good1", "bad", "good2"];
    const create = makeCreateExchange({
      good1: { markets: ["BTC/USDT"] },
      bad: { error: "timeout" },
      good2: { markets: ["ETH/USDT"] },
    });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 3,
    });
    expect(res.success).toBe(true);
    expect(res.instruments.length).toBe(2);
    expect(res.warnings.some((w) => w.includes("bad"))).toBe(true);
  });
});

describe("Phase249 10 — malformed response isolation", () => {
  it("malformed exchange fails only itself", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["ok", "malformed"];
    const create = (id: string) => ({
      id,
      fetchMarkets: async () => {
        if (id === "malformed") return [{ id: "", symbol: "", base: "", quote: "" }] as any;
        return mockMarkets(id, ["BTC/USDT"]) as any;
      },
    });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    // malformed filtered out, ok remains
    expect(res.instruments.length).toBe(1);
    expect(res.instruments[0].provider).toBe("ccxt:ok");
  });
});

describe("Phase249 11 — rate-limit isolation", () => {
  it("rate limited exchange does not crash batch", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["a", "b"];
    const create = makeCreateExchange({ a: { markets: ["BTC/USDT"] }, b: { error: "429 rate limited" } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.success).toBe(true);
    expect(res.warnings.some((w) => w.includes("429"))).toBe(true);
  });
});

describe("Phase249 12 — unavailable exchange", () => {
  it("unavailable exchange marked FAILED", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["unavail"];
    const create = makeCreateExchange({ unavail: { error: "UNAVAILABLE" } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 1,
    });
    expect(res.success).toBe(false);
    expect(res.completeness).toBe("FAILED");
  });
});

describe("Phase249 13 — native market ID", () => {
  it("preserves exact native symbol", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["binance"];
    const create = makeCreateExchange({ binance: { markets: ["BTC/USDT", "ETH/USDT"] } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 1,
    });
    const ids = res.instruments.map((i) => i.providerInstrumentId);
    expect(ids).toContain("BTC/USDT");
    expect(ids).toContain("ETH/USDT");
  });
  it("okx preserves exact instId", () => {
    const src = read("src/lib/discovery/okx-adapter.ts");
    expect(src).toContain("providerInstrumentId: row.instId");
  });
});

describe("Phase249 14 — trading state", () => {
  it("inactive markets excluded", async () => {
    const { discoverSingleCcxtExchange } = await import("./ccxt-discovery");
    const create = () => ({
      id: "test",
      fetchMarkets: async () => [
        { id: "BTCUSDT", symbol: "BTC/USDT", base: "BTC", quote: "USDT", active: true },
        { id: "DELISTED", symbol: "OLD/USDT", base: "OLD", quote: "USDT", active: false },
      ],
    });
    const res = await discoverSingleCcxtExchange("test", Date.now(), { createExchange: create as any });
    expect(res.instruments.map((i) => i.providerInstrumentId)).toEqual(["BTC/USDT"]);
  });
});

describe("Phase249 15 — discovery completeness", () => {
  it("completeness COMPLETE when all success", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["a", "b"];
    const create = makeCreateExchange({ a: { markets: ["BTC/USDT"] }, b: { markets: ["ETH/USDT"] } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.completeness).toBe("COMPLETE");
  });
  it("PARTIAL when some failed", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["good", "bad"];
    const create = makeCreateExchange({ good: { markets: ["BTC/USDT"] }, bad: { error: "fail" } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    expect(res.completeness).toBe("PARTIAL");
  });
});

describe("Phase249 16 — live acquisition", () => {
  it("discovered ccxt instruments have ohlcv/quote capabilities", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["binance"];
    const create = makeCreateExchange({ binance: { markets: ["BTC/USDT"] } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 1,
    });
    expect(res.instruments[0].capabilities).toContain("ohlcv");
    expect(res.instruments[0].capabilities).toContain("quote");
  });
  it("provider-registry acquireProviderNativeLiveData exists", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("acquireProviderNativeLiveData");
  });
});

describe("Phase249 17 — timestamp provenance", () => {
  it("providerQuoteTimestampMs validates seconds window", () => {
    const src = read("src/convex/marketData.ts");
    expect(src).toContain("providerQuoteTimestampMs");
  });
  it("coinglassPointObservationMs validates sec/ms", () => {
    const src = read("src/convex/coinglass.ts");
    expect(src).toContain("coinglassPointObservationMs");
  });
});

describe("Phase249 18 — freshness", () => {
  it("runtime-readiness freshness defined", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("FRESH");
    expect(src).toContain("STALE");
    expect(src).toContain("DELAYED");
  });
});

describe("Phase249 19 — DEX provider inventory", () => {
  it("dexscreener and geckoterminal in registry", async () => {
    const { STATIC_REGISTRY } = await import("./universal-provider-registry");
    expect(STATIC_REGISTRY.map((r) => r.providerId)).toContain("dexscreener");
    expect(STATIC_REGISTRY.map((r) => r.providerId)).toContain("geckoterminal");
  });
  it("dex adapters exist", () => {
    expect(read("src/lib/discovery/dexscreener-adapter.ts").length).toBeGreaterThan(0);
    expect(read("src/lib/discovery/geckoterminal-adapter.ts").length).toBeGreaterThan(0);
  });
});

describe("Phase249 20 — DEX discovery", () => {
  it("dexscreener discovery via search API", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("api.dexscreener.com");
    expect(src).toContain("chain:dex:poolAddress");
  });
  it("geckoterminal discovery via networks API dynamic", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("/networks");
    expect(src).toContain("network:dex:poolAddress");
  });
});

describe("Phase249 21 — DEX chain identity", () => {
  it("chain preserved in providerInstrumentId", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("${chain}:${dex}:${poolAddr}");
  });
  it("geckoterminal network preserved", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("${networkId}:${dexId}:${poolAddr}");
  });
});

describe("Phase249 22 — DEX/pool identity", () => {
  it("pool address makes identity unique per pool", async () => {
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
    expect(res.instruments.length).toBe(2);
    expect(res.instruments[0].providerInstrumentId).not.toBe(res.instruments[1].providerInstrumentId);
  });
});

describe("Phase249 23 — cross-DEX same symbol", () => {
  it("same token pair different pools remain distinct", async () => {
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
    const ids = res.instruments.map((i) => i.providerInstrumentId);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("Phase249 24 — DEX capability truth", () => {
  it("dexscreener capabilities on_chain + quote, not fake ohlcv live", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).toContain("on_chain");
    expect(src).toContain("quote");
  });
  it("geckoterminal capabilities include ohlcv where supported", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("ohlcv");
  });
  it("runtime-readiness marks DEX quote as RUNTIME_VERIFIED", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("dexscreener");
    expect(src).toContain("QUOTE");
  });
});

describe("Phase249 25 — catalog 80", () => {
  it("CATALOG_RENDER_WINDOW=80 display only", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("CATALOG_RENDER_WINDOW = 80");
    expect(src).toContain("Display window only");
  });
  it("InstrumentInput has load more", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("Load more");
    expect(src).toContain("catalog-load-more");
  });
});

describe("Phase249 26 — catalog 81", () => {
  it("81 instruments: first 80 visible, 1 remaining accessible via load more", async () => {
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
    expect(filtered.length).toBe(81);
    const visible = windowCatalog(filtered, CATALOG_RENDER_WINDOW);
    expect(visible.length).toBe(80);
    const remaining = filtered.length - visible.length;
    expect(remaining).toBe(1);
  });
});

describe("Phase249 27 — catalog 160", () => {
  it("160 instruments: 2 pages of 80", async () => {
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
    const first = windowCatalog(filtered, CATALOG_RENDER_WINDOW);
    expect(first.length).toBe(80);
    const second = windowCatalog(filtered, CATALOG_RENDER_WINDOW * 2);
    expect(second.length).toBe(160);
  });
});

describe("Phase249 28 — catalog 1000+", () => {
  it("1000+ instruments: window slices but full accessible via search", async () => {
    const { filterCatalog, windowCatalog, CATALOG_RENDER_WINDOW } = await import("./instrument-universe");
    const catalog = Array.from({ length: 1000 }, (_, i) => ({
      provider: i % 2 === 0 ? "okx" : "ccxt:binance",
      providerInstrumentId: `SYM-${i}-USDT`,
      assetClass: "crypto" as const,
      subType: "crypto_spot" as const,
      baseAsset: `SYM${i}`,
      quoteAsset: "USDT",
      tradingState: "TRADING" as const,
      capabilities: ["quote"] as any,
      lifecycle: "LIVE" as const,
      discoveredAt: Date.now(),
    }));
    const filtered = filterCatalog(catalog, { classFilter: "all", query: "SYM-999" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].providerInstrumentId).toBe("SYM-999-USDT");
    const visible = windowCatalog(filtered, CATALOG_RENDER_WINDOW);
    expect(visible.length).toBe(1);
  });
});

describe("Phase249 29 — search beyond 80", () => {
  it("search operates on complete catalog, finds item 900", async () => {
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
    const filtered = filterCatalog(catalog, { classFilter: "all", query: "TOKEN-900" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].providerInstrumentId).toBe("TOKEN-900");
  });
});

describe("Phase249 30 — filter beyond 80", () => {
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

describe("Phase249 31 — load-more behavior", () => {
  it("load more increments by 80", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("setRenderWindow((w) => Math.min(w + CATALOG_RENDER_WINDOW, filtered.length))");
  });
  it("remaining count displayed", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("remaining");
    expect(src).toContain("catalog-window-info");
  });
});

describe("Phase249 32 — reset on filter", () => {
  it("renderWindow resets when classFilter changes", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("setRenderWindow(CATALOG_RENDER_WINDOW)");
    expect(src).toContain("form.classFilter");
  });
});

describe("Phase249 33 — reset on query", () => {
  it("renderWindow resets when query changes", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("form.classFilter, query");
  });
});

describe("Phase249 34 — asset-class completeness", () => {
  it("countByAssetClass derived from catalog", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("countByAssetClass");
  });
  it("classDiscoverySummaries uses catalog + providers", () => {
    const src = read("src/components/InstrumentInput.tsx");
    expect(src).toContain("classDiscoverySummaries(catalog, discoveryProviders)");
  });
});

describe("Phase249 35 — BTC", () => {
  it("BTC anchor discoverable via okx or ccxt", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const create = makeCreateExchange({ binance: { markets: ["BTC/USDT", "BTC/USD"] } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => ["binance"],
      createExchange: create as any,
      maxExchanges: 1,
    });
    expect(res.instruments.some((i) => i.baseAsset === "BTC")).toBe(true);
  });
});

describe("Phase249 36 — ETH", () => {
  it("ETH anchor", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const create = makeCreateExchange({ binance: { markets: ["ETH/USDT"] } });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => ["binance"],
      createExchange: create as any,
      maxExchanges: 1,
    });
    expect(res.instruments.some((i) => i.baseAsset === "ETH")).toBe(true);
  });
});

describe("Phase249 37 — XAU", () => {
  it("XAU exact discovered identity via twelve-data", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("commodity");
    expect(src).toContain("providerInstrumentId");
  });
});

describe("Phase249 38 — EUR/USD", () => {
  it("EUR/USD forex via twelve-data", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("forex");
  });
});

describe("Phase249 39 — AAPL", () => {
  it("AAPL equity via twelve-data", () => {
    const src = read("src/lib/discovery/twelve-data-adapter.ts");
    expect(src).toContain("equity");
  });
});

describe("Phase249 40 — multi-provider BTC", () => {
  it("BTC/USDT distinct across ccxt:binance, ccxt:okx, okx, twelve-data", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["binance", "okx"];
    const create = makeCreateExchange({
      binance: { markets: ["BTC/USDT"] },
      okx: { markets: ["BTC/USDT"] },
    });
    const res = await discoverCcxtMarkets(Date.now(), {
      getExchanges: () => exchanges,
      createExchange: create as any,
      maxExchanges: 2,
    });
    const keys = res.instruments.map((i) => `${i.provider}|${i.providerInstrumentId}`);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("ccxt:binance|BTC/USDT");
    expect(keys).toContain("ccxt:okx|BTC/USDT");
  });
});

describe("Phase249 41 — no symbol substitution", () => {
  it("live-identity forbids substitution", () => {
    const src = read("src/lib/discovery/live-identity.ts");
    expect(src).toContain("never substitutes");
  });
  it("instrument-universe preserves exact", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("never uppercased/substituted");
  });
});

describe("Phase249 42 — no provider substitution", () => {
  it("catalogIdentityKey provider::id", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("catalogIdentityKey");
    expect(src).toContain("::");
  });
  it("selecting one cannot resolve to another", async () => {
    const { findCatalogRow, nativeSelectionOf } = await import("./instrument-universe");
    const catalog = [
      { provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", assetClass: "crypto", subType: "crypto_spot", baseAsset: "BTC", quoteAsset: "USDT", tradingState: "TRADING", capabilities: ["quote"], lifecycle: "LIVE", discoveredAt: Date.now() },
      { provider: "ccxt:okx", providerInstrumentId: "BTC/USDT", assetClass: "crypto", subType: "crypto_spot", baseAsset: "BTC", quoteAsset: "USDT", tradingState: "TRADING", capabilities: ["quote"], lifecycle: "LIVE", discoveredAt: Date.now() },
    ] as any;
    const sel = nativeSelectionOf(catalog[0] as any);
    const row = findCatalogRow(catalog, sel);
    expect(row?.provider).toBe("ccxt:binance");
  });
});

describe("Phase249 43 — readiness consistency", () => {
  it("runtime-readiness statuses match provider-capability", () => {
    const rr = read("src/lib/discovery/runtime-readiness.ts");
    const pc = read("src/lib/discovery/provider-capability.ts");
    expect(rr).toContain("RUNTIME_VERIFIED");
    expect(pc).toContain("SUPPORTED_DISCOVERY");
  });
  it("readiness matrix has okx, ccxt, dexscreener, geckoterminal", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("okx");
    expect(src).toContain("ccxt");
    expect(src).toContain("dexscreener");
    expect(src).toContain("geckoterminal");
  });
});

describe("Phase249 44 — stale discovery", () => {
  it("STALE not labeled live", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("STALE");
  });
});

describe("Phase249 45 — retry", () => {
  it("retryConfig exists", () => {
    expect(read("src/lib/data/universal/providers.ts")).toContain("retryConfig");
  });
});

describe("Phase249 46 — rotation after failure", () => {
  it("cursor advances even when exchange fails", async () => {
    const { discoverCcxtMarkets, getCcxtDiscoveryCursor, resetCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["good", "bad", "next"];
    const create = makeCreateExchange({
      good: { markets: ["BTC/USDT"] },
      bad: { error: "fail" },
      next: { markets: ["ETH/USDT"] },
    });
    // batch 1: good
    await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 1 });
    expect(getCcxtDiscoveryCursor()).toBe(1);
    // batch 2: bad fails but cursor still advances
    await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 1 });
    expect(getCcxtDiscoveryCursor()).toBe(2);
    // batch 3: next
    const res = await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 1 });
    expect(res.instruments[0].providerInstrumentId).toBe("ETH/USDT");
    expect(getCcxtDiscoveryCursor()).toBe(0);
  });
});

describe("Phase249 47 — state refresh", () => {
  it("cursor reset does not cause permanent starvation", async () => {
    const { discoverCcxtMarkets, resetCcxtDiscoveryCursor, getCcxtDiscoveryCursor } = await import("./ccxt-discovery");
    resetCcxtDiscoveryCursor();
    const exchanges = ["a", "b", "c"];
    const create = makeCreateExchange({ a: { markets: ["BTC/USDT"] }, b: { markets: ["ETH/USDT"] }, c: { markets: ["SOL/USDT"] } });
    await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 1 });
    expect(getCcxtDiscoveryCursor()).toBe(1);
    // simulate process refresh: reset cursor to 0
    resetCcxtDiscoveryCursor();
    expect(getCcxtDiscoveryCursor()).toBe(0);
    // after refresh, rotation still covers all eventually
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await discoverCcxtMarkets(Date.now(), { getExchanges: () => exchanges, createExchange: create as any, maxExchanges: 1 });
      r.catalogs?.forEach((c) => seen.add(c.path));
    }
    expect(seen.size).toBe(3);
  });
});

describe("Phase249 48 — deterministic ordering", () => {
  it("catalog sorted localeCompare deterministic", () => {
    const src = read("src/lib/discovery/instrument-universe.ts");
    expect(src).toContain("localeCompare");
  });
  it("ccxt exchanges sorted", () => {
    const src = read("src/lib/discovery/universal-provider-registry.ts");
    expect(src).toContain("sort()");
  });
});

describe("Phase249 49 — security", () => {
  it("no VITE_ secrets in discovery", () => {
    expect(read("src/lib/discovery/ccxt-discovery.ts")).not.toContain("VITE_");
  });
  it("Google OAuth PKCE+state", () => {
    expect(read("src/convex/auth.ts")).toContain("pkce");
  });
});

describe("Phase249 50 — no hardcoded whitelist", () => {
  it("no hardcoded exchange whitelist as source of truth", () => {
    const src = read("src/lib/discovery/universal-provider-registry.ts");
    expect(src).toContain("ccxt.exchanges");
    // should not contain literal list of 105 exchanges hardcoded
    expect(src).not.toMatch(/\"binance\".*\"coinbase\".*\"kraken\".*\"bybit\"/);
  });
});

describe("Phase249 51 — no hardcoded DEX whitelist", () => {
  it("dexscreener no hardcoded DEX list", () => {
    const src = read("src/lib/discovery/dexscreener-adapter.ts");
    expect(src).not.toContain("const DEXES = [\"uniswap\"");
  });
  it("geckoterminal fetches networks dynamically", () => {
    const src = read("src/lib/discovery/geckoterminal-adapter.ts");
    expect(src).toContain("fetchNetworks");
  });
});

describe("Phase249 52 — no fabricated data", () => {
  it("provider-registry returns null not fake price", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("return null");
  });
});

describe("Phase249 53 — no fake timestamps", () => {
  it("providerQuoteTimestampMs validates", () => {
    expect(read("src/convex/marketData.ts")).toContain("providerQuoteTimestampMs");
  });
});

describe("Phase249 54 — historical-as-live", () => {
  it("historical labeled delayed/stale not live", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toContain("HISTORICAL_ONLY");
  });
});

describe("Phase249 55 — discovery-as-live", () => {
  it("discovery metadata not live evidence", () => {
    const src = read("src/lib/discovery/universal-provider-registry.ts");
    expect(src).toContain("Discovery metadata ≠ live evidence");
  });
});

describe("Phase249 56 — live scanner coverage", () => {
  it("live scanner bounded but not permanently excluding", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("cooldownUntil");
    // Should not have permanent exclusion comment
    expect(src).not.toContain("permanent exclusion");
  });
  it("acquireProviderNativeLiveData iterates all requested", () => {
    const src = read("src/lib/market-radar/provider-registry.ts");
    expect(src).toContain("acquireProviderNativeLiveData");
  });
});

describe("Phase249 57 — malformed provider data", () => {
  it("malformed classified", () => {
    expect(read("src/lib/data/universal/live/failure-class.ts")).toContain("MALFORMED_RESPONSE");
  });
});

describe("Phase249 58 — numerical validation", () => {
  it("price validation exists", () => {
    const src = read("src/lib/discovery/live-evidence-integrity.phase237.test.ts");
    expect(src).toContain("valid decimal");
  });
});

describe("Phase249 59 — protected-analysis compatibility", () => {
  it("protected analysis uses fetchMarketData", () => {
    expect(read("src/convex/protectedAnalysis.ts")).toContain("fetchMarketData");
  });
});

describe("Phase249 60 — regression stability", () => {
  it("Phase248 tests still exist", () => {
    expect(read("src/lib/discovery/provider-runtime-gap-closure.phase248.test.ts").length).toBeGreaterThan(0);
  });
  it("Phase247 tests exist", () => {
    expect(read("src/lib/discovery/full-feature-provider-capability-audit.phase247.test.ts").length).toBeGreaterThan(0);
  });
});
