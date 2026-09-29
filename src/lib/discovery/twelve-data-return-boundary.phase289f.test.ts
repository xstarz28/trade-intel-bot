/**
 * Phase 289F — the Twelve Data discovery RETURN BOUNDARY (library layer).
 *
 * THE DEPLOYED FAILURE THIS PINS
 * ------------------------------
 * Phase 289E fixed the memory bound: each catalog is now read in its own
 * execution. The next deployed discovery answered
 *
 *   `Function marketData.js:discoverTwelveDataCatalog return value invalid:
 *    Array length is too long (143300 > maximum length 8192)`
 *
 * Twelve Data returns the whole `/stocks` catalog — 143300 normalized
 * instruments — for ANY `page`, and Convex rejects any array above 8192
 * elements. Slicing to 8192 would present a TRUNCATED catalog as the universe,
 * so these tests pin the honest alternative:
 *
 *   · a catalog that cannot cross the boundary is persisted as a stage, in
 *     provider order, with the provider's real total — never a first-N prefix;
 *   · the whole staged universe stays available through a deterministic,
 *     duplicate-free chunk walk;
 *   · COMPLETE/PARTIAL/FAILED (the catalog walk) and complete/partial/failed
 *     (the transport) are reported SEPARATELY and never substitute for each
 *     other; a bounded response is not a partial catalog;
 *   · one catalog's failure cannot erase the others.
 */
import { describe, expect, it } from "vitest";

import {
  createTwelveDataDiscoveryAdapter,
  settleCatalogTransport,
  type CatalogStagingSink,
} from "./twelve-data-adapter";
import {
  arrayBoundViolations,
  boundedInlineLimit,
  CONVEX_MAX_ARRAY_LENGTH,
  DISCOVERY_INLINE_LIMIT,
  fitsConvexReturnBoundary,
  STAGE_READ_ROWS,
  STAGE_WRITE_BATCH_ROWS,
  STAGE_WRITE_MAX_ROWS,
} from "./return-boundary";
import {
  discoveryTransportSummary,
  fromDiscoveryStageRow,
  hydrateStagedCatalogs,
  readFullStagedCatalog,
  stagedCatalogRefs,
  toDiscoveryStageRow,
  type DiscoveryStageRow,
  type ReadStagedCatalogPage,
} from "./staged-catalog";
import { TWELVE_DATA_CATALOG_PATHS } from "./twelve-data-adapter";
import type { DiscoveredInstrument, ProviderDiscoveryResult } from "./types";

/** The adapter is credential-gated: a keyed reader is what a deployment has. */
const KEYED = (name: string) => (name === "TWELVE_DATA_API_KEY" ? "test-key" : undefined);

/** The deployed catalog's own scale. */
const STOCK_COUNT = 143_300;
const STOCK_ROWS: unknown[] = Array.from({ length: STOCK_COUNT }, (_, i) => ({
  symbol: `STK${i}`,
  name: `Synthetic Equity ${i}`,
  currency: "USD",
  exchange: "SYNTH",
  country: "Syntheticland",
}));

const PROVIDER_CATALOGS: Record<string, unknown[]> = {
  "/forex_pairs": [
    { symbol: "EUR/USD", currency_group: "Major", currency_base: "Euro", currency_quote: "US Dollar" },
    { symbol: "USD/JPY", currency_group: "Major", currency_base: "US Dollar", currency_quote: "Japanese Yen" },
  ],
  "/commodities": [
    { symbol: "WTI/USD", name: "Crude Oil WTI Spot", category: "Energy Resource", description: "" },
    { symbol: "GAU/IDR", name: "Gold Gram", category: "Precious Metal", description: "" },
  ],
  "/indices": [{ symbol: "SPX", name: "S&P 500", currency: "USD", exchange: "INDEX" }],
  "/cryptocurrencies": [{ symbol: "BTC/USD", currency_base: "Bitcoin", currency_quote: "US Dollar" }],
};

/** A `FetchJson` over synthetic provider catalogs of the real shapes. */
function catalogFetch(
  catalogs: Record<string, unknown[]>,
  options: { throwFor?: string[]; statusFor?: Record<string, number> } = {},
) {
  const jsonCalls = { count: 0, paths: [] as string[] };
  const fetchJson = async (url: string) => {
    const path = new URL(url).pathname;
    jsonCalls.count += 1;
    jsonCalls.paths.push(path);
    if ((options.throwFor ?? []).includes(path)) throw new Error(`network refused for ${path}`);
    const status = options.statusFor?.[path] ?? 200;
    if (status !== 200) {
      return { ok: false, status, json: { status: "error", code: status, message: "provider refused" } };
    }
    const data = catalogs[path] ?? [];
    return { ok: true, status: 200, json: { status: "ok", count: data.length, data } };
  };
  return { fetchJson, jsonCalls };
}

/** An in-memory stage with the same contract as the Convex one. */
function memoryStaging(options: { failOnBegin?: boolean; failAfterRows?: number } = {}) {
  interface MemoryStage {
    path: string;
    rows: DiscoveryStageRow[];
    state: string;
    detail?: string;
    rowsWritten: number;
  }
  const stages = new Map<string, MemoryStage>();
  let counter = 0;

  const sink: CatalogStagingSink = {
    async begin({ catalogPath }) {
      if (options.failOnBegin) throw new Error("stage store unavailable");
      counter += 1;
      const stageId = `stage-${counter}`;
      stages.set(stageId, { path: catalogPath, rows: [], state: "open", rowsWritten: 0 });
      return { stageId };
    },
    async append({ stageId, rows }) {
      const stage = stages.get(stageId);
      if (!stage) throw new Error("unknown stage");
      if (options.failAfterRows !== undefined && stage.rowsWritten >= options.failAfterRows) {
        throw new Error("stage store rejected the write");
      }
      // `seq` is assigned the way the Convex sink assigns it: monotonically, in
      // the order the provider returned the rows.
      for (const row of rows) {
        stage.rows.push(toDiscoveryStageRow(row, stage.rowsWritten));
        stage.rowsWritten += 1;
      }
    },
    async finish({ stageId, state, detail }) {
      const stage = stages.get(stageId);
      if (stage) {
        stage.state = state;
        stage.detail = detail;
      }
    },
  };

  const readPage: ReadStagedCatalogPage = async ({ stageId, afterSeq, limit }) => {
    const stage = stages.get(stageId);
    if (!stage) throw new Error(`unknown stage ${stageId}`);
    const remaining = stage.rows.filter((row) => row.seq > afterSeq);
    const page = remaining.slice(0, limit);
    return {
      rows: page.map(fromDiscoveryStageRow),
      hasMore: remaining.length > page.length,
      nextAfterSeq: page.length > 0 ? page[page.length - 1].seq : null,
      stagedRows: stage.rows.length,
      catalogPath: stage.path,
      completeness: null,
      transportState: null,
    };
  };

  const stageIds = () => [...stages.keys()];
  return { sink, readPage, stages, stageIds };
}

const ids = (rows: readonly DiscoveredInstrument[]) => rows.map((r) => r.providerInstrumentId);

async function discoverStocks(options: { staging?: CatalogStagingSink; inlineLimit?: number } = {}) {
  const { fetchJson } = catalogFetch({ "/stocks": STOCK_ROWS });
  const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
    catalogPaths: ["/stocks"],
    ...(options.staging !== undefined ? { staging: options.staging } : {}),
    ...(options.inlineLimit !== undefined ? { inlineLimit: options.inlineLimit } : {}),
  });
  return adapter.discover(1_700_000_000_000);
}

describe("289F — a catalog above the return boundary is staged, not truncated", () => {
  it("moves a 143300-instrument catalog onto the stage and never crosses the array boundary", async () => {
    const { sink } = memoryStaging();
    const result = await discoverStocks({ staging: sink });

    // Convex rejects any array above 8192 elements — nothing here may cross it.
    expect(arrayBoundViolations(result)).toEqual([]);
    expect(fitsConvexReturnBoundary(result)).toBe(true);
    // The response carries the descriptor, not a first-N prefix of the catalog.
    expect(result.instruments).toEqual([]);
    expect(result.totalDiscovered).toBe(STOCK_COUNT);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.catalogs?.[0]).toMatchObject({
      path: "/stocks",
      completeness: "COMPLETE",
      totalDiscovered: STOCK_COUNT,
      transport: {
        mode: "staged",
        state: "complete",
        inlineRows: 0,
        stagedRows: STOCK_COUNT,
        totalKept: STOCK_COUNT,
        chunkRows: STAGE_READ_ROWS,
      },
    });
    expect(result.catalogs?.[0].transport?.stageId).toBeTruthy();
  });

  it("keeps the full catalog available: provider order, every row, no duplicates", async () => {
    const { sink, readPage } = memoryStaging();
    const result = await discoverStocks({ staging: sink });

    const refs = stagedCatalogRefs(result);
    expect(refs).toHaveLength(1);
    expect(refs[0].stagedRows).toBe(STOCK_COUNT);
    const walk = await readFullStagedCatalog(refs[0], readPage);

    expect(walk.state).toBe("complete");
    expect(walk.rows).toHaveLength(STOCK_COUNT);
    expect(walk.pagesRead).toBe(Math.ceil(STOCK_COUNT / STAGE_READ_ROWS));
    // Provider order is exact, and no row is dropped or duplicated.
    expect(walk.rows[0].providerInstrumentId).toBe("STK0");
    expect(walk.rows[STOCK_COUNT - 1].providerInstrumentId).toBe(`STK${STOCK_COUNT - 1}`);
    expect(new Set(ids(walk.rows)).size).toBe(STOCK_COUNT);
    expect(ids(walk.rows).every((id) => id?.startsWith("STK"))).toBe(true);
  });

  it("re-reading a chunk returns the same rows in the same order and duplicates nothing", async () => {
    const { sink, readPage } = memoryStaging();
    const result = await discoverStocks({ staging: sink });
    const ref = stagedCatalogRefs(result)[0];

    const first = await readPage({ stageId: ref.stageId, afterSeq: -1, limit: 5 });
    const again = await readPage({ stageId: ref.stageId, afterSeq: -1, limit: 5 });
    expect(again.rows).toEqual(first.rows);
    expect(again.nextAfterSeq).toBe(first.nextAfterSeq);
    expect(ids(first.rows)).toEqual(["STK0", "STK1", "STK2", "STK3", "STK4"]);
    expect(first.hasMore).toBe(true);

    // A walk that continues from an existing cursor never repeats a row.
    const seen: number[] = [];
    let afterSeq = -1;
    for (let page = 0; page < 3; page += 1) {
      const chunk = await readPage({ stageId: ref.stageId, afterSeq, limit: 4 });
      seen.push(...chunk.rows.map((row) => Number(String(row.providerInstrumentId).slice(3))));
      afterSeq = chunk.nextAfterSeq as number;
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // Chunk size does not change the sequence: 1000-row and 2048-row walks agree.
    const small = await readFullStagedCatalog({ ...ref, stagedRows: 3000 }, readPage, { limit: 1000 });
    const large = await readFullStagedCatalog({ ...ref, stagedRows: 3000 }, readPage, { limit: 2048 });
    // Chunk size does not change the sequence: the overlap of a 1000-row walk
    // and a 2048-row walk is identical, and both are the provider's own order.
    expect(ids(small.rows).slice(0, 2000)).toEqual(ids(large.rows).slice(0, 2000));
  });

  it("carries the exact provider-native identity across the boundary", async () => {
    const { fetchJson } = catalogFetch({
      "/stocks": [
        {
          symbol: "BRK.B",
          name: "Berkshire Hathaway Inc.",
          currency: "USD",
          exchange: "NYSE",
          country: "United States",
        },
      ],
    });
    const { sink, readPage } = memoryStaging();
    const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      catalogPaths: ["/stocks"],
      staging: sink,
      inlineLimit: 0,
    });
    const result = await adapter.discover(1_700_000_000_456);
    const walk = await readFullStagedCatalog(stagedCatalogRefs(result)[0], readPage);

    expect(walk.rows).toHaveLength(1);
    expect(walk.rows[0]).toMatchObject({
      provider: "twelve-data",
      // A symbol a normalizer might "fix" stays exactly as the provider wrote it.
      providerInstrumentId: "BRK.B",
      assetClass: "equity",
      subType: "equity_common",
      baseAsset: "BRK.B",
      quoteAsset: "USD",
      tradingState: "TRADING",
      capabilities: ["ohlcv", "quote"],
      region: "United States",
      discoveredAt: 1_700_000_000_456,
    });
  });
});

describe("289F — transport truth is reported separately from catalog completeness", () => {
  it("reports a stage that stopped after some rows as PARTIAL transport, with a warning", async () => {
    const { sink } = memoryStaging({ failAfterRows: 500 });
    const result = await discoverStocks({ staging: sink });

    const catalog = result.catalogs?.[0];
    // The provider walk finished — the CATALOG is complete...
    expect(catalog?.completeness).toBe("COMPLETE");
    expect(catalog?.totalDiscovered).toBe(STOCK_COUNT);
    // ...while the TRANSPORT says exactly how much of it is available.
    //
    // Phase 289G: rows are confirmed in FULL batches, so the count is the batch
    // size that really committed — never "whatever the last chunk held", and
    // never rounded up to look complete.
    expect(catalog?.transport?.mode).toBe("staged");
    expect(catalog?.transport?.state).toBe("partial");
    expect(catalog?.transport?.stagedRows).toBe(STAGE_WRITE_BATCH_ROWS);
    expect(catalog?.transport?.totalKept).toBe(STOCK_COUNT);
    expect(result.warnings.join(" ")).toContain("/stocks: staged transport partial");
    // The universe size is still the provider's real count.
    expect(result.totalDiscovered).toBe(STOCK_COUNT);
  });

  it("refuses to inline a catalog it cannot stage: explicit failure, never a short catalog", async () => {
    const result = await discoverStocks({ inlineLimit: 0 });

    expect(result.instruments).toEqual([]);
    expect(result.catalogs?.[0]).toMatchObject({
      completeness: "COMPLETE",
      totalDiscovered: STOCK_COUNT,
      transport: { mode: "staged", state: "failed" },
    });
    expect(result.warnings.join(" ")).toMatch(/no staging sink is configured|no stage was opened/);
    expect(result.totalDiscovered).toBe(STOCK_COUNT);
  });

  it("keeps a catalog PARTIAL when the provider walk stopped, even though its rows are all staged", async () => {
    // Page 1 answers with 4 of the 10 rows the provider reports; page 2 refuses.
    const partialFetch = async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/stocks" && parsed.searchParams.get("page") === "2") {
        return { ok: false, status: 429, json: { status: "error", code: 429, message: "rate limit" } };
      }
      const data = STOCK_ROWS.slice(0, 4);
      return { ok: true, status: 200, json: { status: "ok", count: 10, data } };
    };
    const { sink } = memoryStaging();
    const adapter = createTwelveDataDiscoveryAdapter(partialFetch, KEYED, {
      catalogPaths: ["/stocks"],
      staging: sink,
      inlineLimit: 0,
    });
    const result = await adapter.discover(1_700_000_000_000);

    const catalog = result.catalogs?.[0];
    expect(catalog?.completeness).toBe("PARTIAL");
    expect(catalog?.failedPage).toBe(2);
    expect(catalog?.totalDiscovered).toBe(4);
    // Everything that WAS kept is available: a bounded transport is not a lie
    // about the catalog, and a short catalog is not hidden by the transport.
    expect(catalog?.transport).toMatchObject({ mode: "staged", state: "complete", stagedRows: 4 });
  });

  it("settles transport state in one place, and can only make it worse", () => {
    expect(settleCatalogTransport("complete", 10, 10)).toEqual({ state: "complete" });
    expect(settleCatalogTransport("complete", 4, 10)).toEqual({
      state: "partial",
      detail: "4 of 10 row(s) staged",
    });
    expect(settleCatalogTransport("complete", 0, 10)).toEqual({
      state: "failed",
      detail: "0 of 10 row(s) staged",
    });
    expect(settleCatalogTransport("partial", 10, 10)).toEqual({
      state: "partial",
      detail: "the staging sink reported a partial write",
    });
    expect(settleCatalogTransport("failed", 10, 10)).toEqual({ state: "failed" });
  });

  it("keeps every boundary below the runtime's own array cap", () => {
    expect(DISCOVERY_INLINE_LIMIT).toBeLessThan(CONVEX_MAX_ARRAY_LENGTH);
    expect(STAGE_READ_ROWS).toBeLessThan(CONVEX_MAX_ARRAY_LENGTH);
    expect(STAGE_WRITE_BATCH_ROWS).toBeLessThanOrEqual(STAGE_WRITE_MAX_ROWS);
    expect(STAGE_WRITE_MAX_ROWS).toBeLessThan(CONVEX_MAX_ARRAY_LENGTH);
    expect(boundedInlineLimit(undefined)).toBe(DISCOVERY_INLINE_LIMIT);
    expect(boundedInlineLimit(999_999)).toBe(DISCOVERY_INLINE_LIMIT);
    expect(boundedInlineLimit(-5)).toBe(0);
  });

  it("finds an oversized array wherever it hides in a return value", () => {
    const violations = arrayBoundViolations({
      outer: { inner: [1, 2, 3], deep: { rows: new Array(CONVEX_MAX_ARRAY_LENGTH + 1).fill(0) } },
    });
    expect(violations).toEqual([{ path: "outer.deep.rows", length: CONVEX_MAX_ARRAY_LENGTH + 1 }]);
    expect(arrayBoundViolations({ ok: new Array(CONVEX_MAX_ARRAY_LENGTH).fill(null) })).toEqual([]);
  });
});

describe("289F — one catalog's failure cannot erase the others", () => {
  it("keeps forex and commodity discovery when the stock catalog fails", async () => {
    const { fetchJson } = catalogFetch(PROVIDER_CATALOGS, { throwFor: ["/stocks"] });
    const { sink } = memoryStaging();
    const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED, { staging: sink });
    const result = await adapter.discover(1_700_000_000_000);

    expect(result.success).toBe(true);
    expect(ids(result.instruments)).toEqual(["EUR/USD", "USD/JPY", "WTI/USD", "GAU/IDR", "SPX", "BTC/USD"]);
    expect(result.catalogs?.find((c) => c.path === "/stocks")).toMatchObject({
      completeness: "FAILED",
      totalDiscovered: 0,
      transport: { state: "failed" },
    });
    expect(result.completeness).toBe("PARTIAL");
    expect(result.totalDiscovered).toBe(6);
    // The energy candidate is present, provider-native, and untouched.
    expect(result.instruments.find((i) => i.providerInstrumentId === "WTI/USD")).toMatchObject({
      assetClass: "commodity",
      subType: "commodity_spot",
      baseAsset: "WTI",
      quoteAsset: "USD",
    });
  });

  it("composes five catalogs under ONE shared inline budget, staying inside the boundary", async () => {
    const { sink } = memoryStaging();
    const { fetchJson } = catalogFetch({ ...PROVIDER_CATALOGS, "/stocks": STOCK_ROWS });
    const parts: ProviderDiscoveryResult[] = [];
    let budget = DISCOVERY_INLINE_LIMIT;
    for (const path of TWELVE_DATA_CATALOG_PATHS) {
      const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
        catalogPaths: [path],
        staging: sink,
        inlineLimit: Math.max(0, budget),
      });
      const part = await adapter.discover(1_700_000_000_000);
      budget -= part.instruments.length;
      parts.push(part);
    }

    expect(budget).toBeGreaterThanOrEqual(0);
    expect(arrayBoundViolations({ parts })).toEqual([]);
    const summary = discoveryTransportSummary({ catalogs: parts.flatMap((p) => p.catalogs ?? []) });
    expect(summary.stagedCatalogs).toBe(1);
    expect(summary.stagedRows).toBe(STOCK_COUNT);
    expect(summary.inlineRows).toBe(6);
    expect(summary.state).toBe("complete");
    // Only the catalog that did not fit was staged; the rest travelled inline.
    expect(parts[1].catalogs?.[0].transport?.mode).toBe("staged");
    expect(parts[0].catalogs?.[0].transport?.mode).toBe("inline");
  });

  it("hydrates a composed result onto its instruments and reports a short walk honestly", async () => {
    const { sink, readPage } = memoryStaging();
    const result = await discoverStocks({ staging: sink });

    const hydrated = await hydrateStagedCatalogs(result, readPage);
    expect(hydrated.state).toBe("complete");
    expect(hydrated.errors).toEqual([]);
    expect(hydrated.hydratedRows).toBe(STOCK_COUNT);
    expect(result.instruments).toHaveLength(STOCK_COUNT);
    expect(result.instruments[0].providerInstrumentId).toBe("STK0");

    // A reader that stops early is an ERROR, never a smaller universe.
    const shortReader: ReadStagedCatalogPage = async (args) => {
      const page = await readPage(args);
      return { ...page, hasMore: false };
    };
    const second = await discoverStocks({ staging: memoryStaging().sink });
    const walk = await readFullStagedCatalog(stagedCatalogRefs(second)[0], shortReader);
    expect(walk.state).toBe("partial");
    expect(walk.detail).toContain("of");
    expect(walk.rows.length).toBeLessThan(STOCK_COUNT);
  });
});
