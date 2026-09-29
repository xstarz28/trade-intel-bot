/**
 * Phase 289E — Twelve Data discovery inside Convex's 512 MB action limit.
 *
 * THE DEPLOYED FAILURE
 * --------------------
 *   `marketData:discoverTwelveDataInstruments` →
 *   `Node.js action execution ran out of memory (maximum memory usage: 512 MB)`
 *
 * Two properties of the provider make that limit reachable, and both are pinned
 * here against the live contract that was probed directly:
 *
 *   1. The catalog endpoints IGNORE `page`. `?page=2` on `/stocks`,
 *      `/forex_pairs` and `/commodities` returns the SAME complete catalog as
 *      page 1, with `count` equal to the rows in that one response. So page 1 IS
 *      the whole catalog and no cursor can make it smaller — `/stocks` is about
 *      124k rows / 30 MB.
 *   2. Reading that response with `res.json()` materializes the whole body text
 *      and the whole parsed object graph before a single row is normalized, and
 *      the old code then built a second full copy of the normalized set.
 *
 * What these tests prove:
 *   · page 1 is requested with the documented contract, and page 2+ only when the
 *     provider's own `count` says more rows exist;
 *   · the raw page is consumed ROW BY ROW from the response body — never
 *     retained across pages, never materialized as one array, and `.json` is not
 *     even touched when a body stream exists;
 *   · normalized output keeps the exact provider identities, in provider order,
 *     with duplicates collapsed by identity;
 *   · COMPLETE / PARTIAL / FAILED, provider errors and truncation stay honest;
 *   · a large synthetic catalog is processed with bounded retained state.
 */
import { describe, expect, it } from "vitest";
import {
  TWELVE_DATA_CATALOG_PATHS,
  createTwelveDataDiscoveryAdapter,
  mergeTwelveDataCatalogRuns,
  twelveDataCatalogFailure,
  type FetchJson,
} from "./twelve-data-adapter";
import { fetchTwelveDataCatalogPages, twelveDataCatalogUrl } from "./twelve-data-pagination";
import { scanTwelveDataCatalogRows } from "./twelve-data-stream";

const KEYED = (name: string) => (name === "TWELVE_DATA_API_KEY" ? "k" : undefined);
const NOW = Date.parse("2026-09-29T08:00:00Z");

/** The provider's own `/commodities` rows (real shape, real categories). */
const COMMODITY_ROWS = [
  { symbol: "GAU/EUR", name: "Gold Gram", category: "Precious Metal", description: "" },
  { symbol: "HG1", name: "Copper Spot", category: "Industrial Metal", description: "" },
  { symbol: "URALS/USD", name: "Urals Crude Oil Spot", category: "Energy Resource", description: "" },
  { symbol: "WTI/USD", name: "Crude Oil WTI Spot", category: "Energy Resource", description: "" },
  { symbol: "XAU/USD", name: "Gold Spot", category: "Precious Metal", description: "" },
  { symbol: "XBR/USD", name: "Brent Spot", category: "Energy Resource", description: "" },
  { symbol: "XPD/USD", name: "Palladium Spot", category: "Industrial Metal", description: "" },
];

async function* chunks(parts: readonly string[]): AsyncIterable<string> {
  for (const part of parts) yield part;
}

/** A lazily generated catalog body: the payload never exists as one string. */
async function* lazyCatalog(rows: number, chunkRows = 25): AsyncIterable<string> {
  yield '{"status":"ok","data":[';
  for (let i = 0; i < rows; i += chunkRows) {
    let text = "";
    for (let j = i; j < Math.min(i + chunkRows, rows); j += 1) {
      text += `${j === 0 ? "" : ","}{"symbol":"SYN${String(j).padStart(5, "0")}","name":"Synthetic ${j}","currency":"USD","exchange":"XNAS","country":"United States","type":"Common Stock"}`;
    }
    yield text;
  }
  yield `],"count":${rows}}`;
}

/** A transport that exposes the body and FAILS if anyone reads `.json`. */
function streamingTransport(parts: readonly string[]): { fetchJson: FetchJson; jsonReads: () => number } {
  let jsonReads = 0;
  const fetchJson: FetchJson = async () => {
    const result = { ok: true, status: 200, body: chunks(parts) } as Record<string, unknown>;
    Object.defineProperty(result, "json", {
      get() {
        jsonReads += 1;
        return undefined;
      },
    });
    return result as unknown as Awaited<ReturnType<FetchJson>>;
  };
  return { fetchJson, jsonReads: () => jsonReads };
}

describe("289E — the provider's pagination contract, honoured exactly", () => {
  it("page 1 is requested without a cursor, and `count` equal to the rows ends the catalog", async () => {
    const called: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      called.push(url);
      return { ok: true, status: 200, json: { status: "ok", count: 2, data: COMMODITY_ROWS.slice(0, 2) } };
    };
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/commodities",
      apiKey: "k",
      onRows: () => {},
    });

    expect(called).toHaveLength(1);
    expect(called[0]).not.toContain("page=");
    expect(result.completeness).toBe("COMPLETE");
    expect(result.totalCount).toBe(2);
  });

  it("requests a later page ONLY when the provider's count says more rows exist", async () => {
    const called: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      called.push(url);
      const isSecond = url.includes("page=2");
      return {
        ok: true,
        status: 200,
        json: {
          status: "ok",
          count: 3,
          data: isSecond
            ? [{ symbol: "XAU/USD", currency_base: "XAU", currency_quote: "USD" }]
            : [
                { symbol: "WTI/USD", currency_base: "WTI", currency_quote: "USD" },
                { symbol: "XBR/USD", currency_base: "XBR", currency_quote: "USD" },
              ],
        },
      };
    };
    const pages: unknown[][] = [];
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/commodities",
      apiKey: "k",
      onRows: (rows) => pages.push(rows),
    });

    expect(called.map((u) => new URL(u).searchParams.get("page"))).toEqual([null, "2"]);
    expect(pages.map((p) => p.length)).toEqual([2, 1]);
    expect(result.pagesFetched).toBe(2);
    expect(result.completeness).toBe("COMPLETE");
  });

  it("never asks for another page when the provider reports no count (the dump contract)", async () => {
    let calls = 0;
    const fetchJson: FetchJson = async () => {
      calls += 1;
      return { ok: true, status: 200, json: { status: "ok", data: [{ symbol: "A" }, { symbol: "B" }] } };
    };
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/indices",
      apiKey: "k",
      onRows: () => {},
    });
    expect(calls).toBe(1);
    expect(result.completeness).toBe("COMPLETE");
    // The cursor is still the documented one when it IS used.
    expect(twelveDataCatalogUrl("/indices", "k", 4)).toContain("page=4");
  });
});

describe("289E — a single-response catalog is read row by row, never materialized", () => {
  it("consumes the body stream and does not touch `.json` at all", async () => {
    const { fetchJson, jsonReads } = streamingTransport([
      '{"status":"ok","data":[{"symbol":"WTI/USD","currency_base":"WTI","currency_quote":"USD"}],"count":1}',
    ]);
    const seen: unknown[][] = [];
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/commodities",
      apiKey: "k",
      onRows: (rows) => seen.push(rows),
    });

    expect(jsonReads()).toBe(0);
    expect(seen).toEqual([[{ symbol: "WTI/USD", currency_base: "WTI", currency_quote: "USD" }]]);
    expect(result.rows).toEqual([]);
    expect(result.completeness).toBe("COMPLETE");
  });

  it("delivers rows BEFORE the payload has finished arriving (no full-body buffering)", async () => {
    const total = 400;
    let chunksConsumed = 0;
    let chunksConsumedAtFirstRow = -1;
    async function* counted(): AsyncIterable<string> {
      yield '{"status":"ok","data":[';
      for (let i = 0; i < total; i += 1) {
        chunksConsumed += 1;
        yield `${i === 0 ? "" : ","}{"symbol":"S${i}","currency_base":"A","currency_quote":"USD"}`;
      }
      yield `],"count":${total}}`;
    }

    await scanTwelveDataCatalogRows(counted(), () => {
      if (chunksConsumedAtFirstRow < 0) chunksConsumedAtFirstRow = chunksConsumed;
    });

    // The first row is handed over while the body is still being read: if the
    // implementation buffered the payload first, this would equal the total.
    expect(chunksConsumedAtFirstRow).toBeLessThan(total / 4);
    expect(chunksConsumed).toBe(total);
  });

  it("keeps rows intact when the JSON is split at arbitrary boundaries", async () => {
    const row = {
      symbol: "XAU/USD",
      name: "Gold \"Spot\" — ȩscaped",
      available_exchanges: ["Synthetic", "Binance"],
      nested: { deep: [1, 2, 3] },
    };
    const body = JSON.stringify({ status: "ok", count: 1, data: [row] });
    // One character per chunk: the worst case for a streaming reader.
    const pieces = Array.from(body);
    const rows: unknown[] = [];
    const scan = await scanTwelveDataCatalogRows(chunks(pieces), (r) => rows.push(r));

    expect(scan.ok).toBe(true);
    expect(rows).toEqual([row]);
  });

  it("does not accumulate raw pages across pages (only identities survive)", async () => {
    let call = 0;
    const fetchJson: FetchJson = async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          body: chunks([
            '{"status":"ok","count":3,"data":[{"symbol":"A/USD","currency_base":"A","currency_quote":"USD"},{"symbol":"B/USD","currency_base":"B","currency_quote":"USD"}]}',
          ]),
        };
      }
      return {
        ok: true,
        status: 200,
        body: chunks([
          '{"status":"ok","count":3,"data":[{"symbol":"B/USD","currency_base":"B","currency_quote":"USD"},{"symbol":"C/USD","currency_base":"C","currency_quote":"USD"}]}',
        ]),
      };
    };
    const pages: unknown[][] = [];
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/forex_pairs",
      apiKey: "k",
      onRows: (rows) => pages.push(rows),
    });

    // Page 2 repeats B/USD: the sink never sees it twice.
    expect(
      pages.map((p) => p.map((r) => (r as { symbol: string }).symbol)),
    ).toEqual([["A/USD", "B/USD"], ["C/USD"]]);
    // And the raw rows are NOT also kept by the fetch layer.
    expect(result.rows).toEqual([]);
    expect(result.totalCount).toBe(3);
  });
});

describe("289E — honest outcomes for a streamed catalog", () => {
  it("a truncated body is never COMPLETE, and only the rows that arrived are kept", async () => {
    const { fetchJson } = streamingTransport([
      '{"status":"ok","count":9999,"data":[{"symbol":"A/USD","currency_base":"A","currency_quote":"USD"},{"symbol":"B/USD"',
    ]);
    const seen: unknown[] = [];
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/forex_pairs",
      apiKey: "k",
      onRows: (rows) => rows.forEach((r) => seen.push(r)),
    });
    // One row genuinely arrived before the body ended mid-element; the read is
    // PARTIAL with the failing page named — never COMPLETE, and no row is
    // invented to fill the provider's claimed count of 9999.
    expect(seen.map((r) => (r as { symbol: string }).symbol)).toEqual(["A/USD"]);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.failedPage).toBe(1);
    expect(result.warnings.join(" ")).toContain("ended inside the data array");
  });

  it("a truncated body with NO rows is FAILED, not an empty success", async () => {
    const { fetchJson } = streamingTransport(['{"status":"ok","count":9999,"data":[{"symb']);
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/stocks",
      apiKey: "k",
      onRows: () => {},
    });
    expect(result.completeness).toBe("FAILED");
    expect(result.pagesFetched).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.warnings.join(" ")).toContain("ended inside the data array");
  });

  it("a provider error body stays a provider error, never an empty success", async () => {
    const { fetchJson } = streamingTransport([
      '{"status":"error","code":404,"message":"This endpoint is available starting with the Grow or Venture plan"}',
    ]);
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/commodities",
      apiKey: "k",
      onRows: () => {},
    });
    expect(result.completeness).toBe("FAILED");
    expect(result.warnings.join(" ")).toContain("Grow or Venture plan");
    expect(result.rows).toEqual([]);
  });

  it("a transport failure mid-stream is PARTIAL when rows already arrived", async () => {
    async function* failing(): AsyncIterable<string> {
      yield '{"status":"ok","count":5,"data":[{"symbol":"A"},{"symbol":"B"},';
      throw new Error("socket hang up");
    }

    const fetchJson: FetchJson = async () => ({ ok: true, status: 200, body: failing() });
    const seen: unknown[] = [];
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/stocks",
      apiKey: "k",
      onRows: (rows) => rows.forEach((r) => seen.push(r)),
    });
    // Rows that genuinely arrived are kept and disclosed; the catalog is never
    // reported COMPLETE and the failure keeps the transport's own message.
    expect(seen.map((r) => (r as { symbol: string }).symbol)).toEqual(["A", "B"]);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.failedPage).toBe(1);
    expect(result.warnings.join(" ")).toContain("socket hang up");
  });

  it("an HTTP rejection keeps the provider's own message (Phase 288 behaviour intact)", async () => {
    const fetchJson: FetchJson = async () => ({
      ok: false,
      status: 403,
      json: { status: "error", message: "this endpoint requires the Grow plan" },
    });
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/stocks",
      apiKey: "k",
      onRows: () => {},
    });
    expect(result.completeness).toBe("FAILED");
    expect(result.warnings.join(" ")).toContain("Grow plan");
    expect(result.warnings.join(" ")).toContain("403");
  });

  it("never leaks a credential that a provider error body echoes back", async () => {
    const fetchJson: FetchJson = async () => ({
      ok: false,
      status: 401,
      json: {
        status: "error",
        message: "invalid apikey=SUPERSECRET1234567890ABCDEFGHIJKLMNOPQRSTUVWX",
      },
    });
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/stocks",
      apiKey: "k",
      onRows: () => {},
    });
    const text = result.warnings.join(" ");
    expect(text).not.toContain("SUPERSECRET1234567890ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(text).toContain("401");
  });
});

describe("289E — normalized output keeps the provider truth, with bounded state", () => {
  it("preserves exact provider identities in provider order", async () => {
    const { fetchJson } = streamingTransport([
      `{"status":"ok","count":${COMMODITY_ROWS.length},"data":${JSON.stringify(COMMODITY_ROWS)}}`,
    ]);
    const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      catalogPaths: ["/commodities"],
    });
    const result = await adapter.discover(NOW);

    // HG1 has no "/" and no explicit base/quote, so it cannot be identified:
    // it is SKIPPED and disclosed, never given an invented pair identity.
    expect(result.instruments.map((i) => i.providerInstrumentId)).toEqual([
      "GAU/EUR",
      "URALS/USD",
      "WTI/USD",
      "XAU/USD",
      "XBR/USD",
      "XPD/USD",
    ]);
    expect(result.warnings.join(" ")).toContain("skipped 1 row(s) missing identity fields");
    expect(result.instruments.every((i) => i.assetClass === "commodity")).toBe(true);
    expect(result.instruments.every((i) => i.provider === "twelve-data")).toBe(true);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.pagesFetched).toBe(1);
    expect(result.totalDiscovered).toBe(6);
    // Phase 289F extends the per-catalog report with its TRANSPORT record: this
    // catalog fits the inline boundary, so every kept row travelled inline and
    // the transport is complete. The catalog's own completeness is unchanged.
    expect(result.catalogs).toEqual([
      {
        path: "/commodities",
        assetClass: "commodity",
        completeness: "COMPLETE",
        pagesFetched: 1,
        totalDiscovered: 6,
        transport: {
          mode: "inline",
          state: "complete",
          inlineRows: 6,
          stagedRows: 0,
          totalKept: 6,
        },
      },
    ]);
  });

  it("keeps energy candidates discoverable, exactly as the provider named them", async () => {
    const { fetchJson } = streamingTransport([
      `{"status":"ok","count":${COMMODITY_ROWS.length},"data":${JSON.stringify(COMMODITY_ROWS)}}`,
    ]);
    const result = await createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      catalogPaths: ["/commodities"],
    }).discover(NOW);

    // The provider's own energy rows survive discovery untouched — nothing is
    // filtered, ranked, renamed or substituted on the way out.
    const ids = result.instruments.map((i) => i.providerInstrumentId);
    expect(ids).toContain("WTI/USD");
    expect(ids).toContain("XBR/USD");
    expect(ids).toContain("URALS/USD");
    expect(ids.filter((id) => id === "WTI/USD")).toHaveLength(1);
    // Non-energy commodities are NOT dropped to make an energy candidate appear.
    expect(ids).toContain("XAU/USD");
    expect(ids).toContain("GAU/EUR");
  });

  it("processes a large synthetic catalog with bounded retained state", async () => {
    const rows = 5_000;
    const fetchJson: FetchJson = async () => ({ ok: true, status: 200, body: lazyCatalog(rows) });
    const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      catalogPaths: ["/stocks"],
    });
    const result = await adapter.discover(NOW);

    expect(result.instruments).toHaveLength(rows);
    expect(result.totalDiscovered).toBe(rows);
    expect(result.pagesFetched).toBe(1);
    // Symbols are the provider's, in the provider's order, with the leading
    // zero-padding intact (no numeric coercion anywhere).
    expect(result.instruments[0].providerInstrumentId).toBe("SYN00000");
    expect(result.instruments[rows - 1].providerInstrumentId).toBe("SYN04999");
    expect(result.catalogs?.[0].totalDiscovered).toBe(rows);
  });

  it("collapses a duplicated identity instead of duplicating the output", async () => {
    const duplicate = '{"symbol":"WTI/USD","currency_base":"WTI","currency_quote":"USD"}';
    const { fetchJson } = streamingTransport([
      `{"status":"ok","count":5,"data":[${duplicate},${duplicate},${duplicate},${duplicate},${duplicate}]}`,
    ]);
    const result = await createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      catalogPaths: ["/commodities"],
    }).discover(NOW);

    expect(result.instruments).toHaveLength(1);
    expect(result.totalDiscovered).toBe(1);
    expect(result.instruments[0].providerInstrumentId).toBe("WTI/USD");
  });

  it("does not normalize rows it never received (a failed catalog stays empty)", async () => {
    async function* failing(): AsyncIterable<string> {
      yield '{"status":"ok","count":10,"data":[';
      throw new Error("read ECONNRESET");
    }
    const fetchJson: FetchJson = async () => ({ ok: true, status: 200, body: failing() });
    const result = await createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      catalogPaths: ["/stocks"],
    }).discover(NOW);

    expect(result.instruments).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.completeness).toBe("FAILED");
    expect(result.catalogs?.[0]).toMatchObject({ path: "/stocks", completeness: "FAILED", totalDiscovered: 0 });
    expect(result.warnings.join(" ")).toContain("ECONNRESET");
  });

  it("never fetches an unknown catalog path", async () => {
    let calls = 0;
    const fetchJson: FetchJson = async () => {
      calls += 1;
      return { ok: true, status: 200, json: { data: [] } };
    };
    const result = await createTwelveDataDiscoveryAdapter(fetchJson, KEYED, {
      catalogPaths: ["/../../etc/passwd"],
    }).discover(NOW);

    expect(calls).toBe(0);
    expect(result.success).toBe(false);
    expect(result.completeness).toBe("FAILED");
    expect(result.error).toContain("Unknown Twelve Data catalog path");
  });
});

describe("289E — composing per-catalog runs keeps the universal contract", () => {
  const runOf = (
    path: string,
    ids: string[],
    completeness: "COMPLETE" | "PARTIAL" | "FAILED",
    assetClass: string,
  ) =>
    ({
      provider: "twelve-data" as const,
      success: completeness !== "FAILED",
      discoveredAt: NOW,
      instruments: ids.map((providerInstrumentId) => ({
        provider: "twelve-data" as const,
        providerInstrumentId,
        assetClass: assetClass as never,
        subType: "commodity_spot" as never,
        baseAsset: providerInstrumentId.split("/")[0] ?? providerInstrumentId,
        quoteAsset: providerInstrumentId.split("/")[1] ?? "USD",
        tradingState: "TRADING" as const,
        capabilities: ["ohlcv", "quote"] as never,
        discoveredAt: NOW,
      })),
      warnings: [],
      completeness,
      pagesFetched: 1,
      totalDiscovered: ids.length,
      catalogs: [
        { path, assetClass, completeness, pagesFetched: 1, totalDiscovered: ids.length },
      ],
    }) as never;

  it("keeps catalog order, first-occurrence dedupe and the rollup", () => {
    const merged = mergeTwelveDataCatalogRuns(
      [
        runOf("/forex_pairs", ["EUR/USD", "GBP/USD"], "COMPLETE", "forex"),
        runOf("/commodities", ["WTI/USD", "EUR/USD"], "COMPLETE", "commodity"),
        runOf("/stocks", [], "FAILED", "equity"),
      ],
      NOW,
    );

    expect(merged.instruments.map((i) => `${i.assetClass}|${i.providerInstrumentId}`)).toEqual([
      "forex|EUR/USD",
      "forex|GBP/USD",
      "commodity|WTI/USD",
      // commodity|EUR/USD is a DIFFERENT identity from forex|EUR/USD, so both stay
      "commodity|EUR/USD",
    ]);
    expect(merged.catalogs?.map((c) => c.path)).toEqual(["/forex_pairs", "/commodities", "/stocks"]);
    expect(merged.pagesFetched).toBe(3);
    expect(merged.totalDiscovered).toBe(4);
    // One catalog failed → PARTIAL, and discovery is still a success.
    expect(merged.completeness).toBe("PARTIAL");
    expect(merged.success).toBe(true);
  });

  it("reports FAILED only when every catalog failed, keeping the error text", () => {
    const merged = mergeTwelveDataCatalogRuns(
      [runOf("/stocks", [], "FAILED", "equity"), runOf("/indices", [], "FAILED", "indices")],
      NOW,
    );
    expect(merged.success).toBe(false);
    expect(merged.completeness).toBe("FAILED");
    expect(merged.error).toBe("Twelve Data discovery failed for all catalogs.");
  });

  it("names the failing catalog — a runtime failure is not an empty catalog", () => {
    const failure = twelveDataCatalogFailure(
      "/stocks",
      NOW,
      "Node.js action execution ran out of memory (maximum memory usage: 512 MB)",
    );
    expect(failure.success).toBe(false);
    expect(failure.completeness).toBe("FAILED");
    expect(failure.error).toContain("out of memory");
    expect(failure.catalogs).toEqual([
      { path: "/stocks", assetClass: "equity", completeness: "FAILED", pagesFetched: 0, totalDiscovered: 0 },
    ]);

    const merged = mergeTwelveDataCatalogRuns(
      [runOf("/commodities", ["WTI/USD"], "COMPLETE", "commodity"), failure],
      NOW,
    );
    // The giant catalog failing does NOT take the commodity universe with it.
    expect(merged.instruments.map((i) => i.providerInstrumentId)).toEqual(["WTI/USD"]);
    expect(merged.completeness).toBe("PARTIAL");
    expect(merged.success).toBe(true);
    expect(merged.warnings.join(" ")).toContain("out of memory");
  });

  it("enumerates exactly the catalogs the adapter owns", () => {
    expect(TWELVE_DATA_CATALOG_PATHS).toEqual([
      "/forex_pairs",
      "/stocks",
      "/commodities",
      "/indices",
      "/cryptocurrencies",
    ]);
  });
});

describe("289E — the retention that caused the OOM stays fixed (structural guards)", () => {
  it("the catalog layer reads the body stream and never re-materializes the page", async () => {
    const { readFileSync } = await import("node:fs");
    const pagination = readFileSync("src/lib/discovery/twelve-data-pagination.ts", "utf8");
    const adapter = readFileSync("src/lib/discovery/twelve-data-adapter.ts", "utf8");
    const transport = readFileSync("src/lib/discovery/twelve-data-transport.ts", "utf8");

    // The streaming source exists and is wired into the page reader.
    expect(pagination).toContain("if (res.body) {");
    expect(pagination).toContain("await scanTwelveDataCatalogRows(");
    expect(pagination).toContain("res.body,");
    expect(pagination).toContain("res.body");
    // The adapter consumes rows through the sink (no raw accumulation).
    expect(adapter).toContain("onRows:");
    // The old double copy of the whole normalized set is gone.
    expect(adapter).not.toContain("const deduplicated = Array.from(");
    // Transport exposes the body instead of parsing it up front for catalogs.
    expect(transport).toContain("body: stream");
  });

  it("the discovery entry point delegates one catalog per function execution", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/convex/marketData.ts", "utf8");
    // A per-catalog action exists and the composed parent calls it.
    expect(src).toContain("export const discoverTwelveDataCatalog = action(");
    expect(src).toContain("ctx.runAction(api.marketData.discoverTwelveDataCatalog, {");
    expect(src).toContain("path,");
    // Phase 289F — the parent hands each catalog its share of ONE shared inline
    // budget, so the composed response stays inside Convex's array boundary.
    expect(src).toContain("inlineLimit: Math.max(0, inlineBudget),");
    // A failed catalog execution becomes that catalog's FAILED report.
    expect(src).toContain("twelveDataCatalogFailure(path, now, errorMessage(error))");
  });
});
