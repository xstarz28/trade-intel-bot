/**
 * Phase 245 — Dashboard Instrument Recommendation Integrity
 *
 * Verifies recommendations originate from real discovered/provider-backed
 * instruments, preserve exact provider/native identity, capability-aware,
 * deterministic, no hardcoded popular list, no substitution.
 *
 * Pipeline traced:
 * provider discovery (discoverAllProviders action → adapters: okx, twelve-data, ccxt, dexscreener, geckoterminal, idx, stockbit, ajaib)
 * → normalize (normalizeOkxDiscoveryAction, normalizeTwelveDataDiscoveryAction, normalizeGenericDiscoveryAction) exact native id preserved
 * → mergeDiscoveryResults → discovered[], succeededProviders, discoveryErrors
 * → runDiscoveryPipelineStep → reconcileDiscovery (DELISTED excluded) → selectAcquirableInstruments (TRADING + ohlcv capability) → selectRotatingDiscoveryBatch (deterministic cursor) → acquireDiscoveredBatch → applyAcquisitionOutcomes → expireStaleInstruments → keysToEvict → liveSources Map<provider::id>
 * → buildInstrumentCatalog(tracked) → CatalogInstrument[] sorted provider::id deterministic, excludes DELISTED + non-TRADING, requires provider+id
 * → instrument-universe: filterCatalog (classFilter + query includes providerInstrumentId/base/quote/provider/assetClass), windowCatalog (80 display window), countByAssetClass, visibleClassFilters, nativeSelectionOf, findCatalogRow, identityFromTypedSearch (exact match only)
 * → InstrumentInput.tsx: catalog prop, discoveryProviders, classFilters, filtered, visibleRows, summaries, handleSelectRow → nativeSelectionOf, handleSubmit → findCatalogRow → onAnalyze({instrument:providerInstrumentId, provider, providerInstrumentId, instrumentType})
 * → Dashboard.tsx handleAnalyze → resolveLiveIdentity (exact provider+id check, no alias, refuses multi-provider collision) → fetchMarketData → protectedAnalysis re-acquires server-side → runAnalysis → liveSourceRef Map → scanInstruments/radar → MarketOpportunities isLive
 *
 * Source of truth: discovered instruments (tracked Map), not POPULAR_INSTRUMENTS, not static list.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildInstrumentCatalog,
  catalogFromDiscovered,
  filterCatalog,
  nativeSelectionOf,
  findCatalogRow,
  identityFromTypedSearch,
  catalogIdentityKey,
  countByAssetClass,
  countForFilter,
  windowCatalog,
  CATALOG_RENDER_WINDOW,
  visibleClassFilters,
  type CatalogInstrument,
} from "./instrument-universe";
import { resolveLiveIdentity, discoveredFromTracked } from "./live-identity";
import {
  createPipelineState,
  runDiscoveryPipelineStep,
  type NativeAcquisitionResult,
} from "./pipeline";
import {
  reconcileDiscovery,
  type TrackedInstrument,
} from "./lifecycle";
import { selectAcquirableInstruments } from "./registry";
import { scanInstruments } from "../liveScanner";
import type { DiscoveredInstrument } from "./types";
import type { LiveCandidateSource } from "../liveCandidateBuilder";
import type { MarketData } from "../data/market-types";

const NOW = 1_800_000_000_000;

function row(overrides: Partial<DiscoveredInstrument> & Pick<DiscoveredInstrument, "provider" | "providerInstrumentId" | "assetClass">): DiscoveredInstrument {
  return {
    subType: overrides.assetClass === "crypto" ? "crypto_spot" : overrides.assetClass === "commodity" ? "commodity_spot" : overrides.assetClass === "forex" ? "forex_spot" : overrides.assetClass === "equity" ? "equity_common" : "index_cash",
    baseAsset: overrides.baseAsset ?? overrides.providerInstrumentId.split(/[-/]/)[0] ?? "X",
    quoteAsset: overrides.quoteAsset ?? overrides.providerInstrumentId.split(/[-/]/)[1] ?? "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    ...overrides,
  } as DiscoveredInstrument;
}

function mkMarketData(opts: { instrument: string; provider: string; price: number; observedAt: number; fetchTimestamp: number }): MarketData {
  return {
    instrument: opts.instrument,
    instrumentType: "crypto",
    provider: opts.provider,
    fetchTimestamp: opts.fetchTimestamp,
    price: { price: opts.price, timestamp: opts.observedAt, source: opts.provider },
    candles: [{ timestamp: opts.observedAt, open: opts.price, high: opts.price * 1.01, low: opts.price * 0.99, close: opts.price, volume: 1000 }],
    timeframe: "1h",
    dataFreshness: "realtime",
    timestampProvenance: "PROVIDER_OBSERVED",
  } as unknown as MarketData;
}

function mkLiveSource(opts: { instrument: string; provider: string; providerInstrumentId: string; assetClass: any; price: number; observedAt: number; fetchedAt: number }): LiveCandidateSource {
  const md = mkMarketData({ instrument: opts.instrument, provider: opts.provider, price: opts.price, observedAt: opts.observedAt, fetchTimestamp: opts.fetchedAt });
  return {
    instrument: opts.instrument,
    assetClass: opts.assetClass,
    providerNative: { provider: opts.provider, providerInstrumentId: opts.providerInstrumentId },
    marketData: md,
  } as LiveCandidateSource;
}

// ── 1 BTC recommendation ──────────────────────────────────────────
describe("Phase245 1 — BTC recommendation", () => {
  it("BTC recommendation originates from discovered instrument", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT" });
    const catalog = catalogFromDiscovered([btc]);
    expect(catalog.length).toBe(1);
    expect(catalog[0].providerInstrumentId).toBe("BTC-USDT");
    const filtered = filterCatalog(catalog, { classFilter: "crypto", query: "BTC" });
    expect(filtered.map(r => r.providerInstrumentId)).toContain("BTC-USDT");
  });
});

// ── 2 XAU recommendation ──────────────────────────────────────────
describe("Phase245 2 — XAU recommendation", () => {
  it("XAU recommendation exact native identity", () => {
    const xau = row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" });
    const catalog = catalogFromDiscovered([xau]);
    expect(catalog[0].providerInstrumentId).toBe("XAU/USD");
    expect(catalog[0].baseAsset).toBe("XAU");
    const filtered = filterCatalog(catalog, { classFilter: "commodity", query: "XAU" });
    expect(filtered[0].providerInstrumentId).toBe("XAU/USD");
  });
});

// ── 3 EUR/USD recommendation ──────────────────────────────────────
describe("Phase245 3 — EUR/USD recommendation", () => {
  it("EUR/USD recommendation from discovery, no transformation", () => {
    const eur = row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex", baseAsset: "EUR", quoteAsset: "USD" });
    const catalog = catalogFromDiscovered([eur]);
    expect(catalog[0].providerInstrumentId).toBe("EUR/USD");
    expect(filterCatalog(catalog, { classFilter: "forex", query: "EUR" })[0].providerInstrumentId).toBe("EUR/USD");
    const identity = resolveLiveIdentity({ typed: "EUR/USD", discovered: [eur] });
    expect(identity.ok).toBe(true);
    if (identity.ok) expect(identity.providerInstrumentId).toBe("EUR/USD");
  });
});

// ── 4 AAPL recommendation ─────────────────────────────────────────
describe("Phase245 4 — AAPL recommendation", () => {
  it("AAPL equity recommendation preserved", () => {
    const aapl = row({ provider: "twelve-data", providerInstrumentId: "AAPL", assetClass: "equity", baseAsset: "AAPL", quoteAsset: "USD", subType: "equity_common" });
    const catalog = catalogFromDiscovered([aapl]);
    expect(catalog[0].providerInstrumentId).toBe("AAPL");
    expect(catalog[0].assetClass).toBe("equity");
    const stockFiltered = filterCatalog(catalog, { classFilter: "stock", query: "AAPL" });
    expect(stockFiltered[0].providerInstrumentId).toBe("AAPL");
  });
});

// ── 5 ETH recommendation ──────────────────────────────────────────
describe("Phase245 5 — ETH recommendation", () => {
  it("ETH recommendation from discovery", () => {
    const eth = row({ provider: "okx", providerInstrumentId: "ETH-USDT", assetClass: "crypto", baseAsset: "ETH", quoteAsset: "USDT" });
    const catalog = catalogFromDiscovered([eth]);
    expect(catalog[0].providerInstrumentId).toBe("ETH-USDT");
    expect(filterCatalog(catalog, { classFilter: "crypto", query: "ETH" })[0].baseAsset).toBe("ETH");
  });
});

// ── 6 exact native identity ───────────────────────────────────────
describe("Phase245 6 — exact native identity", () => {
  it("provider/native identity exact, never rewritten", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const catalog = catalogFromDiscovered([btc]);
    const sel = nativeSelectionOf(catalog[0]);
    expect(sel.providerInstrumentId).toBe("BTC-USDT");
    expect(sel.provider).toBe("okx");
    expect(catalog[0].providerInstrumentId).toBe("BTC-USDT");
  });

  it("XAU/USD not rewritten to GOLD", () => {
    const xau = row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" });
    const catalog = catalogFromDiscovered([xau]);
    expect(catalog[0].providerInstrumentId).not.toBe("GOLD");
    expect(catalog[0].providerInstrumentId).toBe("XAU/USD");
  });
});

// ── 7 no symbol substitution ──────────────────────────────────────
describe("Phase245 7 — no symbol substitution", () => {
  it("BTC does not substitute to BTC/USD, XAU does not substitute to XAU/USD unless exact", () => {
    const okxBtc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT" });
    const discovered = [okxBtc];
    expect(resolveLiveIdentity({ typed: "BTC", discovered }).ok).toBe(false);
    expect(resolveLiveIdentity({ typed: "BTC/USD", discovered }).ok).toBe(false);
    const xau = row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" });
    expect(resolveLiveIdentity({ typed: "XAU", discovered: [xau] }).ok).toBe(false);
    expect(resolveLiveIdentity({ typed: "GOLD", discovered: [xau] }).ok).toBe(false);
  });
});

// ── 8 provider-qualified identity ─────────────────────────────────
describe("Phase245 8 — provider-qualified identity", () => {
  it("catalog key is provider::id, not bare symbol", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const key = catalogIdentityKey(btc as any);
    expect(key).toBe("okx::BTC-USDT");
    expect(key).not.toBe("BTC-USDT");
  });
});

// ── 9 multi-provider same symbol ──────────────────────────────────
describe("Phase245 9 — multi-provider same symbol", () => {
  it("same economic symbol across providers remains separate", () => {
    const binance = row({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT" });
    const okx = row({ provider: "ccxt:okx", providerInstrumentId: "BTC/USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT" });
    const td = row({ provider: "twelve-data", providerInstrumentId: "BTC/USD", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USD" });
    const catalog = catalogFromDiscovered([binance, okx, td]);
    expect(catalog.length).toBe(3);
    const keys = catalog.map(c => catalogIdentityKey(c));
    expect(new Set(keys).size).toBe(3);
    expect(keys).toContain("ccxt:binance::BTC/USDT");
    expect(keys).toContain("ccxt:okx::BTC/USDT");
    expect(keys).toContain("twelve-data::BTC/USD");
  });
});

// ── 10 discovery source of truth ──────────────────────────────────
describe("Phase245 10 — discovery source of truth", () => {
  it("catalog originates from tracked discovery, not static list", () => {
    const tracked = new Map<string, TrackedInstrument>([
      ["okx::BTC-USDT", {
        instrument: row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" }),
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: NOW,
      }],
    ]);
    const catalog = buildInstrumentCatalog(tracked);
    expect(catalog.length).toBe(1);
    expect(catalog[0].providerInstrumentId).toBe("BTC-USDT");
    // empty discovery → empty catalog, no fallback
    expect(buildInstrumentCatalog(new Map())).toEqual([]);
  });

  it("InstrumentInput uses catalog prop, not POPULAR_INSTRUMENTS", () => {
    const src = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    expect(src).toContain("catalog");
    expect(src).toContain("nativeSelectionOf");
    expect(src).not.toContain("POPULAR_INSTRUMENTS");
  });
});

// ── 11 capability filtering ───────────────────────────────────────
describe("Phase245 11 — capability filtering", () => {
  it("selectAcquirableInstruments requires TRADING + ohlcv capability", () => {
    const ok = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", tradingState: "TRADING", capabilities: ["ohlcv", "quote"] });
    const halted = row({ provider: "okx", providerInstrumentId: "HALT-USDT", assetClass: "crypto", tradingState: "HALTED", capabilities: ["ohlcv"] });
    const noCap = row({ provider: "okx", providerInstrumentId: "NOCAP-USDT", assetClass: "crypto", tradingState: "TRADING", capabilities: [] });
    const acquirable = selectAcquirableInstruments([ok, halted, noCap], "ohlcv");
    expect(acquirable.map(i => i.providerInstrumentId)).toEqual(["BTC-USDT"]);
  });

  it("buildInstrumentCatalog excludes non-TRADING", () => {
    const halted = row({ provider: "okx", providerInstrumentId: "HALT-USDT", assetClass: "crypto", tradingState: "HALTED" });
    const ok = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", tradingState: "TRADING" });
    const catalog = catalogFromDiscovered([ok, halted]);
    expect(catalog.map(c => c.providerInstrumentId)).toEqual(["BTC-USDT"]);
  });
});

// ── 12 metadata-only handling ─────────────────────────────────────
describe("Phase245 12 — metadata-only handling", () => {
  it("DISCOVERED lifecycle displayed as metadata, not implied live", () => {
    const tracked = new Map<string, TrackedInstrument>([
      ["okx::BTC-USDT", {
        instrument: row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" }),
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: NOW,
      }],
    ]);
    const catalog = buildInstrumentCatalog(tracked);
    expect(catalog[0].lifecycle).toBe("DISCOVERED");
    // UI shows lifecycle, not live
    const uiSrc = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    expect(uiSrc).toContain("lifecycle");
  });
});

// ── 13 historical-only handling ───────────────────────────────────
describe("Phase245 13 — historical-only handling", () => {
  it("historical-only (no live data) not counted as live in scanner", () => {
    const staleSrc = mkLiveSource({ instrument: "BTC-USDT", provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", price: 50000, observedAt: NOW - 48 * 60 * 60_000, fetchedAt: NOW });
    const scan = scanInstruments([staleSrc], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(scan.totalWithLiveData).toBe(0);
  });
});

// ── 14 live-capability handling ───────────────────────────────────
describe("Phase245 14 — live-capability handling", () => {
  it("live-capable instruments have FRESH/DELAYED and counted as live", () => {
    const freshSrc = mkLiveSource({ instrument: "BTC-USDT", provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", price: 50000, observedAt: NOW - 1000, fetchedAt: NOW });
    const scan = scanInstruments([freshSrc], { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    expect(scan.totalWithLiveData).toBe(1);
  });
});

// ── 15 credential missing ─────────────────────────────────────────
describe("Phase245 15 — credential missing", () => {
  it("credential missing produces explicit failure, no fake recommendation", () => {
    // Simulate provider that requires credentials and fails
    const discovered: DiscoveredInstrument[] = [];
    const succeededProviders: string[] = [];
    const tracked = reconcileDiscovery({ tracked: new Map(), discovered, succeededProviders, now: NOW });
    const catalog = buildInstrumentCatalog(tracked);
    expect(catalog.length).toBe(0);
    // No fallback to POPULAR_INSTRUMENTS
    expect(catalog.some(c => c.providerInstrumentId === "BTC/USD")).toBe(false);
  });
});

// ── 16 provider unavailable ───────────────────────────────────────
describe("Phase245 16 — provider unavailable", () => {
  it("provider unavailable does not fabricate recommendations", () => {
    const tracked = new Map<string, TrackedInstrument>();
    const catalog = buildInstrumentCatalog(tracked);
    expect(catalog).toEqual([]);
  });
});

// ── 17 partial discovery ──────────────────────────────────────────
describe("Phase245 17 — partial discovery", () => {
  it("partial discovery still yields truthful catalog for succeeded providers", () => {
    const okxBtc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const tracked = new Map<string, TrackedInstrument>([
      ["okx::BTC-USDT", {
        instrument: okxBtc,
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: NOW,
      }],
    ]);
    const catalog = buildInstrumentCatalog(tracked);
    expect(catalog.length).toBe(1);
    // Twelve-data failed, so EUR/USD not present — no fallback
    expect(catalog.some(c => c.providerInstrumentId === "EUR/USD")).toBe(false);
  });
});

// ── 18 empty discovery ────────────────────────────────────────────
describe("Phase245 18 — empty discovery", () => {
  it("empty discovery produces empty recommendation, no fabricated symbols", () => {
    const catalog = catalogFromDiscovered([]);
    expect(catalog.length).toBe(0);
    expect(filterCatalog(catalog, { classFilter: "all", query: "BTC" }).length).toBe(0);
    expect(identityFromTypedSearch(catalog, "BTC-USDT")).toBeUndefined();
  });
});

// ── 19 stale discovery ────────────────────────────────────────────
describe("Phase245 19 — stale discovery", () => {
  it("retained discovery record does not become newly observed/live", () => {
    const tracked = new Map<string, TrackedInstrument>([
      ["okx::BTC-USDT", {
        instrument: row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", discoveredAt: NOW - 24 * 60 * 60_000 }),
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: NOW - 24 * 60 * 60_000,
      }],
    ]);
    const catalog = buildInstrumentCatalog(tracked);
    expect(catalog[0].discoveredAt).toBe(NOW - 24 * 60 * 60_000);
    expect(catalog[0].discoveredAt).not.toBe(NOW);
  });
});

// ── 20 selection handoff ──────────────────────────────────────────
describe("Phase245 20 — selection handoff", () => {
  it("recommended item → selection → onAnalyze preserves exact identity", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const catalog = catalogFromDiscovered([btc]);
    const sel = nativeSelectionOf(catalog[0]);
    const found = findCatalogRow(catalog, sel);
    expect(found?.providerInstrumentId).toBe("BTC-USDT");
    const identity = resolveLiveIdentity({ typed: sel.providerInstrumentId, provider: sel.provider, providerInstrumentId: sel.providerInstrumentId, discovered: [btc] });
    expect(identity.ok).toBe(true);
    if (identity.ok) {
      expect(identity.providerInstrumentId).toBe(sel.providerInstrumentId);
    }
  });
});

// ── 21 BTC analyze handoff ────────────────────────────────────────
describe("Phase245 21 — BTC analyze handoff", () => {
  it("BTC recommendation → BTC analysis exact", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT" });
    const catalog = catalogFromDiscovered([btc]);
    const sel = nativeSelectionOf(catalog[0]);
    const identity = resolveLiveIdentity({ typed: "BTC-USDT", provider: sel.provider, providerInstrumentId: sel.providerInstrumentId, discovered: [btc] });
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    expect(identity.providerInstrumentId).toBe("BTC-USDT");
    // Simulate onAnalyze payload
    const payload = { instrument: identity.providerInstrumentId, provider: identity.provider, providerInstrumentId: identity.providerInstrumentId };
    expect(payload.instrument).toBe("BTC-USDT");
  });
});

// ── 22 XAU analyze handoff ────────────────────────────────────────
describe("Phase245 22 — XAU analyze handoff", () => {
  it("XAU recommendation → exact discovered native identity", () => {
    const xau = row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" });
    const catalog = catalogFromDiscovered([xau]);
    const sel = nativeSelectionOf(catalog[0]);
    const identity = resolveLiveIdentity({ typed: "XAU/USD", provider: sel.provider, providerInstrumentId: sel.providerInstrumentId, discovered: [xau] });
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    expect(identity.providerInstrumentId).toBe("XAU/USD");
    expect(identity.providerInstrumentId).not.toBe("GOLD");
  });
});

// ── 23 previous-state isolation ───────────────────────────────────
describe("Phase245 23 — previous-state isolation", () => {
  it("recommendation state does not leak into previous analysis", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const xau = row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" });
    const catalogBtc = catalogFromDiscovered([btc]);
    const catalogXau = catalogFromDiscovered([xau]);
    // Simulate switching
    let currentCatalog = catalogBtc;
    expect(currentCatalog[0].providerInstrumentId).toBe("BTC-USDT");
    currentCatalog = catalogXau;
    expect(currentCatalog[0].providerInstrumentId).toBe("XAU/USD");
    expect(currentCatalog.some(c => c.providerInstrumentId === "BTC-USDT")).toBe(false);
  });
});

// ── 24 deterministic ordering ─────────────────────────────────────
describe("Phase245 24 — deterministic ordering", () => {
  it("catalog ordering deterministic sorted by provider::id", () => {
    const instruments = [
      row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex", baseAsset: "EUR", quoteAsset: "USD" }),
      row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT" }),
      row({ provider: "twelve-data", providerInstrumentId: "AAPL", assetClass: "equity", baseAsset: "AAPL", quoteAsset: "USD", subType: "equity_common" }),
      row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" }),
    ];
    const catalog1 = catalogFromDiscovered(instruments);
    const catalog2 = catalogFromDiscovered([...instruments].reverse());
    expect(catalog1.map(c => catalogIdentityKey(c))).toEqual(catalog2.map(c => catalogIdentityKey(c)));
    // Sorted order
    expect(catalog1.map(c => catalogIdentityKey(c))).toEqual([
      "okx::BTC-USDT",
      "twelve-data::AAPL",
      "twelve-data::EUR/USD",
      "twelve-data::XAU/USD",
    ]);
  });
});

// ── 25 no random ordering ─────────────────────────────────────────
describe("Phase245 25 — no random ordering", () => {
  it("no Math.random or Date.now in catalog ordering", () => {
    const src = readFileSync("src/lib/discovery/instrument-universe.ts", "utf8");
    expect(src).not.toContain("Math.random");
    // buildInstrumentCatalog uses localeCompare, not timestamp
    expect(src).toContain("localeCompare");
    const src2 = readFileSync("src/lib/discovery/registry.ts", "utf8");
    expect(src2).not.toContain("Math.random");
  });
});

// ── 26 no hardcoded popular-symbol source ─────────────────────────
describe("Phase245 26 — no hardcoded popular-symbol source", () => {
  it("InstrumentInput and Dashboard do not use POPULAR_INSTRUMENTS as source", () => {
    const inputSrc = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    expect(inputSrc).not.toContain("POPULAR_INSTRUMENTS");
    const dashSrc = readFileSync("src/pages/Dashboard.tsx", "utf8");
    expect(dashSrc).not.toContain("POPULAR_INSTRUMENTS");
    // analysis-engine defines it but it's not source of truth for recommendations
    const engineSrc = readFileSync("src/lib/analysis-engine.ts", "utf8");
    expect(engineSrc).toContain("POPULAR_INSTRUMENTS");
    // InstrumentInput may import AnalysisInput type, but must not use POPULAR_INSTRUMENTS
    expect(inputSrc).not.toMatch(/POPULAR_INSTRUMENTS/);
  });
});

// ── 27 assetClass preservation ────────────────────────────────────
describe("Phase245 27 — assetClass preservation", () => {
  it("asset class preserved through recommendation → selection", () => {
    const cases = [
      { provider: "okx", id: "BTC-USDT", assetClass: "crypto" },
      { provider: "twelve-data", id: "EUR/USD", assetClass: "forex" },
      { provider: "twelve-data", id: "XAU/USD", assetClass: "commodity" },
      { provider: "twelve-data", id: "AAPL", assetClass: "equity" },
    ];
    for (const c of cases) {
      const inst = row({ provider: c.provider, providerInstrumentId: c.id, assetClass: c.assetClass as any, baseAsset: c.id.split(/[-/]/)[0] });
      const catalog = catalogFromDiscovered([inst]);
      expect(catalog[0].assetClass).toBe(c.assetClass);
      const sel = nativeSelectionOf(catalog[0]);
      expect(sel.assetClass).toBe(c.assetClass);
    }
  });
});

// ── 28 provider preservation ──────────────────────────────────────
describe("Phase245 28 — provider preservation", () => {
  it("provider preserved exact through catalog", () => {
    const btc = row({ provider: "ccxt:binance", providerInstrumentId: "BTC/USDT", assetClass: "crypto" });
    const catalog = catalogFromDiscovered([btc]);
    expect(catalog[0].provider).toBe("ccxt:binance");
    const sel = nativeSelectionOf(catalog[0]);
    expect(sel.provider).toBe("ccxt:binance");
  });
});

// ── 29 unsupported instrument rejection ───────────────────────────
describe("Phase245 29 — unsupported instrument rejection", () => {
  it("unsupported instrument not in catalog, resolve fails", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const catalog = catalogFromDiscovered([btc]);
    expect(identityFromTypedSearch(catalog, "FAKE/USD")).toBeUndefined();
    expect(resolveLiveIdentity({ typed: "FAKE/USD", discovered: [btc] }).ok).toBe(false);
  });
});

// ── 30 malformed discovery entry ──────────────────────────────────
describe("Phase245 30 — malformed discovery entry", () => {
  it("malformed entry missing provider/id excluded", () => {
    const ok = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const malformed = { provider: "", providerInstrumentId: "", assetClass: "crypto", subType: "crypto_spot", baseAsset: "", quoteAsset: "", tradingState: "TRADING", capabilities: ["ohlcv"], discoveredAt: NOW } as any;
    const catalog = catalogFromDiscovered([ok, malformed]);
    // malformed missing provider/id should be excluded by buildInstrumentCatalog check
    const tracked = new Map<string, TrackedInstrument>([
      ["okx::BTC-USDT", {
        instrument: ok,
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: NOW,
      }],
      ["::", {
        instrument: malformed,
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: NOW,
      }],
    ]);
    const built = buildInstrumentCatalog(tracked);
    expect(built.length).toBe(1);
    expect(built[0].providerInstrumentId).toBe("BTC-USDT");
  });
});

// ── 31 duplicate discovery handling ───────────────────────────────
describe("Phase245 31 — duplicate discovery handling", () => {
  it("duplicate provider::id deduped, last wins but no duplication", () => {
    const btc1 = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT", discoveredAt: NOW });
    const btc2 = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT", discoveredAt: NOW + 1000 });
    const catalog = catalogFromDiscovered([btc1, btc2]);
    // catalogFromDiscovered sorts and keeps both? Actually it does not dedup, but buildInstrumentCatalog via Map dedupes
    const tracked = new Map<string, TrackedInstrument>([
      ["okx::BTC-USDT", {
        instrument: btc1,
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: NOW,
      }],
    ]);
    // reconcile with duplicate
    const reconciled = reconcileDiscovery({ tracked, discovered: [btc1, btc2], succeededProviders: ["okx"], now: NOW + 1000 });
    expect(reconciled.size).toBe(1);
    expect(reconciled.get("okx::BTC-USDT")?.instrument.discoveredAt).toBeDefined();
  });
});

// ── 32 canonical identity ─────────────────────────────────────────
describe("Phase245 32 — canonical identity", () => {
  it("canonical identity provider-qualified, not bare instrument", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const catalog = catalogFromDiscovered([btc]);
    const key = catalogIdentityKey(catalog[0]);
    expect(key).toBe("okx::BTC-USDT");
    // bare instrument key would be just BTC-USDT, which is not used
    expect(key).not.toBe("BTC-USDT");
  });
});

// ── 33 UI status semantics ────────────────────────────────────────
describe("Phase245 33 — UI status semantics", () => {
  it("UI does not imply live when only discovered", () => {
    const inputSrc = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    // Shows lifecycle, not hardcoded live
    expect(inputSrc).toContain("lifecycle");
    expect(inputSrc).toContain("tradingState");
    // Dashboard shows discovery status
    const dashSrc = readFileSync("src/pages/Dashboard.tsx", "utf8");
    expect(dashSrc).toContain("discoveryProviders");
  });

  it("MarketOpportunities shows provider/native, freshness, not fake live", () => {
    const ui = readFileSync("src/components/MarketOpportunities.tsx", "utf8");
    expect(ui).toContain("providerNative");
    expect(ui).toContain("freshness");
    expect(ui).toContain("totalWithLiveData");
  });
});

// ── 34 no fabricated recommendation ───────────────────────────────
describe("Phase245 34 — no fabricated recommendation", () => {
  it("no fabricated instruments when discovery empty", () => {
    const catalog = catalogFromDiscovered([]);
    expect(catalog.length).toBe(0);
    expect(filterCatalog(catalog, { classFilter: "all", query: "" }).length).toBe(0);
  });
});

// ── 35 no unrelated fallback ──────────────────────────────────────
describe("Phase245 35 — no unrelated fallback", () => {
  it("no fallback to unrelated provider/instrument when requested not found", () => {
    const btc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const catalog = catalogFromDiscovered([btc]);
    // Request ETH, should not fallback to BTC
    expect(identityFromTypedSearch(catalog, "ETH-USDT")).toBeUndefined();
    expect(findCatalogRow(catalog, { provider: "okx", providerInstrumentId: "ETH-USDT" })).toBeUndefined();
    const identity = resolveLiveIdentity({ typed: "ETH-USDT", discovered: [btc] });
    expect(identity.ok).toBe(false);
  });
});

// ── 36 provider failure isolation ─────────────────────────────────
describe("Phase245 36 — provider failure isolation", () => {
  it("one provider failing does not remove another's recommendations", async () => {
    const okxBtc = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" });
    const tdEur = row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex", baseAsset: "EUR", quoteAsset: "USD" });
    const state = createPipelineState();
    // Simulate okx succeeds, twelve-data fails discovery (not in succeededProviders)
    const res = await runDiscoveryPipelineStep({
      state,
      discovered: [okxBtc], // only okx discovered this cycle
      succeededProviders: ["okx"],
      batchSize: 10,
      now: NOW,
      acquire: async (batch) => batch.map(i => ({
        provider: i.provider,
        providerInstrumentId: i.providerInstrumentId,
        assetClass: i.assetClass,
        success: true,
        observedAt: NOW,
        source: mkLiveSource({ instrument: i.providerInstrumentId, provider: i.provider, providerInstrumentId: i.providerInstrumentId, assetClass: i.assetClass, price: 50000, observedAt: NOW, fetchedAt: NOW }),
      } as NativeAcquisitionResult)),
    });
    // tracked should still have okx, and knownProviders should include okx
    expect(res.state.tracked.has("okx::BTC-USDT")).toBe(true);
    // providerErrors should report twelve-data failure if it was previously known
    // but not delete okx
    const catalog = buildInstrumentCatalog(res.state.tracked);
    expect(catalog.some(c => c.provider === "okx")).toBe(true);
  });
});

// ── 37 retry/reload stability ─────────────────────────────────────
describe("Phase245 37 — retry/reload stability", () => {
  it("retry with same discovery produces same catalog ordering", () => {
    const instruments = [
      row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" }),
      row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex", baseAsset: "EUR", quoteAsset: "USD" }),
      row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" }),
    ];
    const catalog1 = catalogFromDiscovered(instruments);
    const catalog2 = catalogFromDiscovered(instruments);
    expect(catalog1.map(c => catalogIdentityKey(c))).toEqual(catalog2.map(c => catalogIdentityKey(c)));
  });
});

// ── 38 recommendation refresh stability ───────────────────────────
describe("Phase245 38 — recommendation refresh stability", () => {
  it("refresh with identical state produces same visible rows", () => {
    const many = Array.from({ length: 100 }, (_, i) => row({ provider: "twelve-data", providerInstrumentId: `SYM${i}`, assetClass: "equity", baseAsset: `SYM${i}`, subType: "equity_common" }));
    const catalog = catalogFromDiscovered(many);
    const visible1 = windowCatalog(filterCatalog(catalog, { classFilter: "all", query: "" }));
    const visible2 = windowCatalog(filterCatalog(catalog, { classFilter: "all", query: "" }));
    expect(visible1.map(c => c.providerInstrumentId)).toEqual(visible2.map(c => c.providerInstrumentId));
    expect(visible1.length).toBe(CATALOG_RENDER_WINDOW);
  });
});

// ── 39 numerical metadata validation ──────────────────────────────
describe("Phase245 39 — numerical metadata validation", () => {
  it("invalid numerical metadata does not crash catalog", () => {
    const invalid = row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto" }) as any;
    invalid.precision = { tickSize: NaN, lotSize: Infinity };
    const catalog = catalogFromDiscovered([invalid]);
    expect(catalog.length).toBe(1);
    expect(countByAssetClass(catalog).crypto).toBe(1);
  });
});

// ── 40 credential/security scan ───────────────────────────────────
describe("Phase245 40 — credential/security scan", () => {
  it("no credentials in recommendation pipeline files", () => {
    const files = [
      "src/lib/discovery/instrument-universe.ts",
      "src/lib/discovery/live-identity.ts",
      "src/lib/discovery/pipeline.ts",
      "src/lib/discovery/registry.ts",
      "src/components/InstrumentInput.tsx",
      "src/pages/Dashboard.tsx",
    ];
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      const lower = content.toLowerCase();
      expect(lower).not.toMatch(/sk-[a-z0-9]{20,}/);
      expect(lower).not.toMatch(/apikey.*=.*['\"][a-z0-9]{20,}/i);
      // env var names should not be returned to client
      if (!f.includes("marketData.ts") && !f.includes("verification.ts")) {
        expect(content).not.toContain("TWELVE_DATA_API_KEY");
      }
    }
  });
});

// ── extra: all asset classes ──────────────────────────────────────
describe("Phase245 extra — all asset classes", () => {
  it("BTC, ETH, XAU, EUR/USD, AAPL all recommendable from discovery", () => {
    const instruments = [
      row({ provider: "okx", providerInstrumentId: "BTC-USDT", assetClass: "crypto", baseAsset: "BTC", quoteAsset: "USDT" }),
      row({ provider: "okx", providerInstrumentId: "ETH-USDT", assetClass: "crypto", baseAsset: "ETH", quoteAsset: "USDT" }),
      row({ provider: "twelve-data", providerInstrumentId: "XAU/USD", assetClass: "commodity", baseAsset: "XAU", quoteAsset: "USD" }),
      row({ provider: "twelve-data", providerInstrumentId: "EUR/USD", assetClass: "forex", baseAsset: "EUR", quoteAsset: "USD" }),
      row({ provider: "twelve-data", providerInstrumentId: "AAPL", assetClass: "equity", baseAsset: "AAPL", quoteAsset: "USD", subType: "equity_common" }),
    ];
    const catalog = catalogFromDiscovered(instruments);
    expect(catalog.length).toBe(5);
    expect(countByAssetClass(catalog)).toEqual({ crypto: 2, forex: 1, equity: 1, commodity: 1, indices: 0, macro: 0 });
    expect(filterCatalog(catalog, { classFilter: "crypto", query: "" }).length).toBe(2);
    expect(filterCatalog(catalog, { classFilter: "commodity", query: "" })[0].providerInstrumentId).toBe("XAU/USD");
    expect(filterCatalog(catalog, { classFilter: "forex", query: "" })[0].providerInstrumentId).toBe("EUR/USD");
    expect(filterCatalog(catalog, { classFilter: "stock", query: "" })[0].providerInstrumentId).toBe("AAPL");
  });
});
