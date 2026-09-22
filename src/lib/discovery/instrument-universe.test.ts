import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { DiscoveredInstrument } from "./types";
import type { TrackedInstrument } from "./lifecycle";
import {
  buildInstrumentCatalog,
  catalogFromDiscovered,
  catalogIdentityKey,
  countByAssetClass,
  countForFilter,
  CATALOG_RENDER_WINDOW,
  filterCatalog,
  findCatalogRow,
  identityFromTypedSearch,
  nativeSelectionOf,
  visibleClassFilters,
  windowCatalog,
  type CatalogInstrument,
} from "./instrument-universe";
import { resolveLiveIdentity } from "./live-identity";

const NOW = 1_800_000_000_000;

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

function tracked(
  instrument: DiscoveredInstrument,
  state: TrackedInstrument["state"] = "DISCOVERED",
): TrackedInstrument {
  return {
    instrument,
    state,
    lastLiveAt: state === "LIVE" ? NOW : null,
    lastSuccessAt: state === "LIVE" ? NOW : null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    lastSeenInDiscoveryAt: NOW,
  };
}

function mapOf(...entries: TrackedInstrument[]): Map<string, TrackedInstrument> {
  return new Map(
    entries.map((e) => [`${e.instrument.provider}::${e.instrument.providerInstrumentId}`, e]),
  );
}

const okxBtc = row({
  provider: "okx",
  providerInstrumentId: "BTC-USDT",
  assetClass: "crypto",
  subType: "crypto_spot",
  baseAsset: "BTC",
  quoteAsset: "USDT",
});
const tdBtc = row({
  provider: "twelve-data",
  providerInstrumentId: "BTC/USD",
  assetClass: "crypto",
  subType: "crypto_spot",
  baseAsset: "BTC",
  quoteAsset: "USD",
});
const eur = row({
  provider: "twelve-data",
  providerInstrumentId: "EUR/USD",
  assetClass: "forex",
  subType: "forex_spot",
  baseAsset: "EUR",
  quoteAsset: "USD",
});
const aapl = row({
  provider: "twelve-data",
  providerInstrumentId: "AAPL",
  assetClass: "equity",
  subType: "equity_common",
  baseAsset: "AAPL",
  quoteAsset: "USD",
});
const xau = row({
  provider: "twelve-data",
  providerInstrumentId: "XAU/USD",
  assetClass: "commodity",
  subType: "commodity_spot",
  baseAsset: "XAU",
  quoteAsset: "USD",
});
const us30 = row({
  provider: "twelve-data",
  providerInstrumentId: "US30",
  assetClass: "indices",
  subType: "index_cash",
  baseAsset: "US30",
  quoteAsset: "USD",
});

describe("instrument universe — catalog from discovery", () => {
  it("crypto selector derives only from discovered crypto rows", () => {
    const catalog = catalogFromDiscovered([okxBtc, tdBtc, eur, aapl, xau]);
    const crypto = filterCatalog(catalog, { classFilter: "crypto", query: "" });
    expect(crypto.map((r) => r.providerInstrumentId).sort()).toEqual(["BTC-USDT", "BTC/USD"]);
    expect(crypto.every((r) => r.assetClass === "crypto")).toBe(true);
  });

  it("forex selector derives only from discovered forex rows", () => {
    const catalog = catalogFromDiscovered([okxBtc, eur, xau]);
    const forex = filterCatalog(catalog, { classFilter: "forex", query: "" });
    expect(forex.map((r) => r.providerInstrumentId)).toEqual(["EUR/USD"]);
    expect(forex.every((r) => r.assetClass === "forex")).toBe(true);
  });

  it("equity selector derives only from discovered equity rows", () => {
    const catalog = catalogFromDiscovered([aapl, eur, okxBtc]);
    const equity = filterCatalog(catalog, { classFilter: "stock", query: "" });
    expect(equity.map((r) => r.providerInstrumentId)).toEqual(["AAPL"]);
    expect(equity.every((r) => r.assetClass === "equity")).toBe(true);
  });

  it("commodity selector derives only from discovered commodity rows", () => {
    const catalog = catalogFromDiscovered([xau, eur, okxBtc]);
    const commodity = filterCatalog(catalog, { classFilter: "commodity", query: "" });
    expect(commodity.map((r) => r.providerInstrumentId)).toEqual(["XAU/USD"]);
    expect(commodity.every((r) => r.assetClass === "commodity")).toBe(true);
  });

  it("indices selector derives only from discovered indices rows", () => {
    const catalog = catalogFromDiscovered([us30, eur, xau]);
    const indices = filterCatalog(catalog, { classFilter: "indices", query: "" });
    expect(indices.map((r) => r.providerInstrumentId)).toEqual(["US30"]);
    expect(indices.every((r) => r.assetClass === "indices")).toBe(true);
  });

  it("counts are derived from the catalog, never hardcoded", () => {
    const catalog = catalogFromDiscovered([okxBtc, tdBtc, eur, aapl, xau, us30]);
    const counts = countByAssetClass(catalog);
    expect(counts.crypto).toBe(2);
    expect(counts.forex).toBe(1);
    expect(counts.equity).toBe(1);
    expect(counts.commodity).toBe(1);
    expect(counts.indices).toBe(1);
    expect(countForFilter(catalog, "all")).toBe(6);
    expect(countForFilter(catalog, "crypto")).toBe(2);
    expect(countForFilter(catalog, "stock")).toBe(1);
  });

  it("no static symbol can appear when absent from discovery", () => {
    const catalog = catalogFromDiscovered([okxBtc]);
    expect(catalog.map((r) => r.providerInstrumentId)).toEqual(["BTC-USDT"]);
    expect(catalog.some((r) => r.providerInstrumentId === "EUR/USD")).toBe(false);
    expect(catalog.some((r) => r.providerInstrumentId === "BTC/USD")).toBe(false);
    expect(catalog.some((r) => r.providerInstrumentId === "XAU/USD")).toBe(false);
    expect(catalog.some((r) => r.providerInstrumentId === "GOLD")).toBe(false);
    expect(identityFromTypedSearch(catalog, "EUR/USD")).toBeUndefined();
    expect(identityFromTypedSearch(catalog, "GOLD")).toBeUndefined();
  });

  it("provider-native identity is preserved exactly", () => {
    const catalog = catalogFromDiscovered([okxBtc, xau]);
    const selection = nativeSelectionOf(catalog[0]);
    expect(selection).toEqual({
      provider: catalog[0].provider,
      providerInstrumentId: catalog[0].providerInstrumentId,
      assetClass: catalog[0].assetClass,
    });
    expect(catalog.map((r) => r.providerInstrumentId)).toEqual(["BTC-USDT", "XAU/USD"]);
  });

  it("BTC-USDT on OKX is not rewritten to BTC/USD", () => {
    const catalog = catalogFromDiscovered([okxBtc, tdBtc]);
    const okx = catalog.find((r) => r.provider === "okx")!;
    expect(okx.providerInstrumentId).toBe("BTC-USDT");
    expect(okx.providerInstrumentId).not.toBe("BTC/USD");
    const payload = nativeSelectionOf(okx);
    expect(payload.providerInstrumentId).toBe("BTC-USDT");
    expect(payload.provider).toBe("okx");
  });

  it("XAU/USD on Twelve Data is not rewritten to GOLD", () => {
    const catalog = catalogFromDiscovered([xau]);
    expect(catalog[0].providerInstrumentId).toBe("XAU/USD");
    expect(catalog.some((r) => r.providerInstrumentId === "GOLD")).toBe(false);
    const identity = resolveLiveIdentity({
      typed: "GOLD",
      provider: "twelve-data",
      providerInstrumentId: "XAU/USD",
      discovered: [xau],
    });
    expect(identity.ok).toBe(true);
    if (identity.ok) {
      expect(identity.providerInstrumentId).toBe("XAU/USD");
      expect(identity.providerInstrumentId).not.toBe("GOLD");
    }
  });

  it("same economic asset on two providers remains two identities", () => {
    const catalog = catalogFromDiscovered([okxBtc, tdBtc]);
    expect(catalog).toHaveLength(2);
    const keys = catalog.map((r) => catalogIdentityKey(r)).sort();
    expect(keys).toEqual(["okx::BTC-USDT", "twelve-data::BTC/USD"]);
    expect(nativeSelectionOf(catalog[0])).not.toEqual(nativeSelectionOf(catalog[1]));
  });

  it("selecting a discovered-but-not-yet-acquired instrument sends exact native identity", () => {
    const catalog = buildInstrumentCatalog(mapOf(tracked(okxBtc, "DISCOVERED")));
    expect(catalog).toHaveLength(1);
    expect(catalog[0].lifecycle).toBe("DISCOVERED");
    const selection = nativeSelectionOf(catalog[0]);
    const identity = resolveLiveIdentity({
      typed: selection.providerInstrumentId,
      provider: selection.provider,
      providerInstrumentId: selection.providerInstrumentId,
      discovered: [okxBtc],
    });
    expect(identity.ok).toBe(true);
    if (identity.ok) {
      expect(identity.provider).toBe("okx");
      expect(identity.providerInstrumentId).toBe("BTC-USDT");
      expect(identity.assetClass).toBe("crypto");
    }
  });

  it("failed discovery leaves no fake catalog entries", () => {
    expect(buildInstrumentCatalog(new Map())).toEqual([]);
    expect(catalogFromDiscovered([])).toEqual([]);
    expect(countByAssetClass([])).toEqual({
      crypto: 0,
      forex: 0,
      equity: 0,
      commodity: 0,
      indices: 0,
      macro: 0,
    });
  });

  it("DELISTED entries are excluded", () => {
    const catalog = buildInstrumentCatalog(
      mapOf(tracked(okxBtc, "LIVE"), tracked(eur, "DELISTED")),
    );
    expect(catalog.map((r) => r.providerInstrumentId)).toEqual(["BTC-USDT"]);
  });

  it("non-tradable trading states are excluded", () => {
    const halted = row({
      provider: "okx",
      providerInstrumentId: "HALT-USDT",
      assetClass: "crypto",
      tradingState: "HALTED",
    });
    const catalog = catalogFromDiscovered([okxBtc, halted]);
    expect(catalog.map((r) => r.providerInstrumentId)).toEqual(["BTC-USDT"]);
  });

  it("free-text search cannot bypass discovery", () => {
    const catalog = catalogFromDiscovered([okxBtc, xau]);
    expect(identityFromTypedSearch(catalog, "BTC/USD")).toBeUndefined();
    expect(identityFromTypedSearch(catalog, "GOLD")).toBeUndefined();
    expect(identityFromTypedSearch(catalog, "btc-usdt")).toBeUndefined();
    expect(filterCatalog(catalog, { classFilter: "all", query: "GOLD" })).toEqual([]);
    expect(filterCatalog(catalog, { classFilter: "all", query: "BTC-USDT" }).map((r) => r.providerInstrumentId)).toEqual([
      "BTC-USDT",
    ]);
    expect(identityFromTypedSearch(catalog, "BTC-USDT")?.provider).toBe("okx");
  });

  it("macro chip is hidden until discovery actually provides macro instruments", () => {
    const without = catalogFromDiscovered([okxBtc, eur]);
    expect(visibleClassFilters(without)).toEqual([
      "all",
      "crypto",
      "forex",
      "stock",
      "commodity",
    ]);
    const macro = row({
      provider: "twelve-data",
      providerInstrumentId: "DXY",
      assetClass: "macro",
      subType: "macro_index",
      baseAsset: "DXY",
      quoteAsset: "USD",
    });
    const withMacro = catalogFromDiscovered([okxBtc, macro]);
    expect(visibleClassFilters(withMacro)).toContain("macro");
    expect(visibleClassFilters(withMacro)).not.toContain("indices");
  });

  it("render window is a display slice, not a product ceiling", () => {
    const many: CatalogInstrument[] = catalogFromDiscovered(
      Array.from({ length: CATALOG_RENDER_WINDOW + 25 }, (_, i) =>
        row({
          provider: "twelve-data",
          providerInstrumentId: `SYM${i}`,
          assetClass: "equity",
          subType: "equity_common",
          baseAsset: `SYM${i}`,
        }),
      ),
    );
    expect(many.length).toBe(CATALOG_RENDER_WINDOW + 25);
    expect(windowCatalog(many).length).toBe(CATALOG_RENDER_WINDOW);
    expect(filterCatalog(many, { classFilter: "stock", query: "SYM100" })).toHaveLength(1);
  });
});

describe("instrument universe — selected identity vs typed path", () => {
  it("selected provider+id does not fall back to a different provider", () => {
    const discovered = [okxBtc, tdBtc];
    const identity = resolveLiveIdentity({
      typed: "BTC/USD",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      discovered,
    });
    expect(identity.ok).toBe(true);
    if (identity.ok) {
      expect(identity.provider).toBe("okx");
      expect(identity.providerInstrumentId).toBe("BTC-USDT");
    }
  });

  it("selected identity that is absent from discovery fails explicitly", () => {
    const identity = resolveLiveIdentity({
      typed: "BTC-USDT",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      discovered: [tdBtc],
    });
    expect(identity.ok).toBe(false);
    if (!identity.ok) expect(identity.failureClass).toBe("SYMBOL_UNSUPPORTED");
  });
});

describe("instrument universe — UI wiring source contracts", () => {
  it("InstrumentInput no longer treats POPULAR_INSTRUMENTS as identity", () => {
    const src = readFileSync("src/components/InstrumentInput.tsx", "utf8");
    expect(src).not.toContain("POPULAR_INSTRUMENTS");
    expect(src).not.toMatch(/from ["']@\/lib\/data\/universal\/instruments["']/);
    expect(src).not.toMatch(/["']GOLD["']\s*:/);
    expect(src).toContain("nativeSelectionOf");
    expect(src).toContain("catalog");
    expect(src).toContain("providerInstrumentId");
  });

  it("Dashboard exposes a reactive catalog from tracked discovery, not a ref-only read", () => {
    const dash = readFileSync("src/pages/Dashboard.tsx", "utf8");
    expect(dash).toContain("discoveredInstruments");
    expect(dash).toContain("buildInstrumentCatalog");
    expect(dash).toContain("setDiscoveredInstruments");
    expect(dash).toContain("discoveryProviders");
    expect(dash).not.toContain("POPULAR_INSTRUMENTS");
    expect(dash).toContain("catalog={discoveredInstruments}");
    expect(dash).toMatch(/provider:\s*input\.provider/);
    expect(dash).toMatch(/providerInstrumentId:\s*input\.providerInstrumentId/);
  });
});
