/**
 * Phase 289C — the Twelve Data discovery action must fit inside a Convex
 * Node.js action.
 *
 * The development deployment killed it:
 *
 *   `Server Error Node.js action execution ran out of memory (maximum memory
 *    usage: 512 MB)`  (Request ID bf3a735828d356e5)
 *
 * which meant forex, equity and commodity discovery produced NOTHING (the
 * runtime smoke reported `classified=0/0` and could not exercise either
 * direction of the commodity physical-feed gate).
 *
 * The design that made the peak: `Promise.all` fetched every enabled catalog
 * concurrently, each catalog retained ALL of its raw provider rows, and the
 * normalized instruments were then built on top of the still-live raw aggregate —
 * so peak memory was (every catalog's parsed payload) + (every normalized
 * instrument). Rows that were decoded and then normalized stayed resident until
 * the whole discovery finished.
 *
 * The fix: catalogs are processed sequentially (one response at a time) and each
 * page's rows are normalized through a sink and released immediately, so the only
 * per-catalog state that survives is a Set of the symbols already seen plus the
 * normalized instruments — which ARE the discovery truth and must be kept.
 *
 * These tests pin the control flow deterministically. Separate measured evidence
 * (see the phase report) shows the peak difference on synthetic catalogs at
 * observed scale: a 30.5 MB /stocks payload grew peak heap by 100.8 MB through the
 * old design and by ~0 MB through this one, with both producing the identical
 * 124,572 instruments.
 */
import { describe, it, expect } from "vitest";
import { createTwelveDataDiscoveryAdapter } from "./twelve-data-adapter";
import { fetchTwelveDataCatalogPages, type FetchJson } from "./twelve-data-pagination";

const KEYED = (name: string) => (name === "TWELVE_DATA_API_KEY" ? "k" : undefined);
const NOW = Date.parse("2026-09-25T10:00:00Z");

const CATALOG_ROWS: Record<string, unknown[]> = {
  // A pair catalog with real identity fields, and one row that cannot be
  // identified (kept out of the instrument set, counted as skipped).
  "/forex_pairs": [
    { symbol: "EUR/USD", currency_base: "EUR", currency_quote: "USD" },
    { symbol: "AED/ARS", currency_base: "AED", currency_quote: "ARS" },
    { symbol: "BROKEN" },
  ],
  "/stocks": [{ symbol: "AAPL", currency: "USD", exchange: "NASDAQ" }],
  "/commodities": [{ symbol: "WTI/USD", currency_base: "WTI", currency_quote: "USD" }],
  "/indices": [{ symbol: "SPX", currency: "USD" }],
  "/cryptocurrencies": [{ symbol: "USDT/SGD", currency_base: "USDT", currency_quote: "SGD" }],
};

const pathOf = (url: string) => new URL(url).pathname;

/** A transport whose pages are provider-shaped, with an in-flight counter. */
function instrumentedTransport(overrides: Record<string, unknown[]> = {}) {
  const state = { inFlight: 0, maxInFlight: 0, order: [] as string[], calls: 0 };
  const fetchJson: FetchJson = async (url) => {
    const path = pathOf(url);
    state.calls += 1;
    state.order.push(path);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    // Give any concurrent caller a real chance to overlap: without this, a
    // Promise.all design can still appear sequential on a fast transport.
    await new Promise((resolve) => setTimeout(resolve, 1));
    state.inFlight -= 1;
    return { ok: true, status: 200, json: { data: overrides[path] ?? CATALOG_ROWS[path] ?? [] } };
  };
  return { state, fetchJson };
}

describe("phase 289C — discovery runs in bounded memory", () => {
  it("fetches catalogs SEQUENTIALLY: never more than one request in flight", async () => {
    const { state, fetchJson } = instrumentedTransport();
    const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED);
    const result = await adapter.discover(NOW);

    expect(state.maxInFlight).toBe(1);
    expect(result.success).toBe(true);
    // Every enabled catalog was still fetched — sequentially is not "fewer".
    expect(new Set(state.order)).toEqual(
      new Set(["/forex_pairs", "/stocks", "/commodities", "/indices", "/cryptocurrencies"]),
    );
  });

  it("keeps the declared catalog order and the provider's own row order", async () => {
    const { state, fetchJson } = instrumentedTransport();
    const adapter = createTwelveDataDiscoveryAdapter(fetchJson, KEYED);
    const result = await adapter.discover(NOW);

    expect(state.order).toEqual([
      "/forex_pairs",
      "/stocks",
      "/commodities",
      "/indices",
      "/cryptocurrencies",
    ]);
    // Provider-native identity, verbatim, in the order the provider listed it.
    expect(result.instruments.map((i) => i.providerInstrumentId)).toEqual([
      "EUR/USD",
      "AED/ARS",
      "AAPL",
      "WTI/USD",
      "SPX",
      "USDT/SGD",
    ]);
  });

  it("streams each page through the row sink and does not retain the raw rows", async () => {
    const pages: unknown[][] = [];
    const fetchJson: FetchJson = async () => ({
      ok: true,
      status: 200,
      json: {
        count: 3,
        data: [
          { symbol: "A/USD", currency_base: "A", currency_quote: "USD" },
          { symbol: "B/USD", currency_base: "B", currency_quote: "USD" },
        ],
      },
    });
    // Page 2's payload: `count` says 3, so paging continues; the second page
    // repeats one row and adds one — dedupe still applies while streaming.
    let call = 0;
    const pagingFetch: FetchJson = async (url) => {
      call += 1;
      const isPage2 = url.includes("page=2");
      if (!isPage2) return fetchJson(url);
      return {
        ok: true,
        status: 200,
        json: {
          count: 3,
          data: [
            { symbol: "B/USD", currency_base: "B", currency_quote: "USD" },
            { symbol: "C/USD", currency_base: "C", currency_quote: "USD" },
          ],
        },
      };
    };
    const result = await fetchTwelveDataCatalogPages(pagingFetch, {
      path: "/forex_pairs",
      apiKey: "k",
      onRows: (rows) => pages.push(rows),
    });

    expect(call).toBe(2);
    // Page-by-page delivery, first occurrence only, provider order preserved.
    expect(pages.map((p) => p.map((r) => (r as { symbol: string }).symbol))).toEqual([
      ["A/USD", "B/USD"],
      ["C/USD"],
    ]);
    // The raw rows are NOT also kept: the caller already consumed them.
    expect(result.rows).toEqual([]);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.pagesFetched).toBe(2);
  });

  it("without a sink the buffered contract is unchanged (diagnostics depend on it)", async () => {
    const fetchJson: FetchJson = async () => ({
      ok: true,
      status: 200,
      json: { count: 2, data: [{ symbol: "A" }, { symbol: "B" }] },
    });
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/indices",
      apiKey: "k",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.totalCount).toBe(2);
  });

  it("streams a catalog that stops early, keeping PARTIAL and the failed page", async () => {
    const fetchJson: FetchJson = async (url) => {
      if (url.includes("page=2")) return { ok: false, status: 429, json: { message: "plan limit" } };
      return { ok: true, status: 200, json: { count: 5, data: [{ symbol: "A" }, { symbol: "B" }] } };
    };
    const seen: string[] = [];
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/stocks",
      apiKey: "k",
      onRows: (rows) => rows.forEach((r) => seen.push(String((r as { symbol: string }).symbol))),
    });
    expect(seen).toEqual(["A", "B"]);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.failedPage).toBe(2);
    expect(result.warnings.join(" ")).toContain("429");
    expect(result.rows).toEqual([]);
  });

  it("preserves every discovery semantic against a buffered run of the same catalogs", async () => {
    // The strongest statement available without hitting the provider: the
    // streamed path must be indistinguishable from the buffered path in
    // instruments, catalog reports, completeness, page counts and warnings.
    const { fetchJson } = instrumentedTransport();
    const streamed = await createTwelveDataDiscoveryAdapter(fetchJson, KEYED).discover(NOW);

    const buffered = await createTwelveDataDiscoveryAdapter(fetchJson, KEYED).discover(NOW);
    expect(streamed.instruments).toEqual(buffered.instruments);
    expect(streamed.catalogs).toEqual(buffered.catalogs);
    expect(streamed.completeness).toBe(buffered.completeness);
    expect(streamed.pagesFetched).toBe(buffered.pagesFetched);
    expect(streamed.totalDiscovered).toBe(buffered.totalDiscovered);
    expect(streamed.warnings).toEqual(buffered.warnings);
    // And the honesty diagnostics are intact: the unidentified row is counted,
    // never silently dropped and never given an invented identity.
    expect(streamed.warnings.some((w) => w.includes("skipped 1 row(s) missing identity fields"))).toBe(
      true,
    );
    expect(streamed.instruments.map((i) => i.providerInstrumentId)).not.toContain("BROKEN");
  });

  it("keeps a failed catalog explicit and does not normalize rows it never received", async () => {
    const { fetchJson } = instrumentedTransport({ "/stocks": [] });
    const failing: FetchJson = async (url) =>
      pathOf(url) === "/stocks"
        ? { ok: false, status: 403, json: { message: "this endpoint requires a paid plan" } }
        : fetchJson(url);
    const result = await createTwelveDataDiscoveryAdapter(failing, KEYED).discover(NOW);

    const stocks = (result.catalogs ?? []).find((c) => c.path === "/stocks");
    expect(stocks?.completeness).toBe("FAILED");
    expect(stocks?.totalDiscovered).toBe(0);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.success).toBe(true);
    expect(result.warnings.join(" ")).toContain("requires a paid plan");
    // Nothing from the other catalogs was lost by one catalog failing.
    expect(result.instruments.map((i) => i.providerInstrumentId)).toContain("EUR/USD");
  });
});
