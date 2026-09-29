/**
 * Phase 289J — WHAT "COMPLETE" IS ACTUALLY DECIDED ON.
 *
 * The deployed run reports `/commodities` as `31 kept / of:32`: the provider
 * published 32 rows, normalization kept 31 usable instruments, and the catalog is
 * still COMPLETE. That single number pair is why completeness may NOT be defined
 * as `providerCount == totalKept` — but it is also why the walk has to state the
 * numbers that DO reconcile:
 *
 *   rawRowsSeen          provider `data` elements parsed (the raw truth)
 *   providerCount        the count the provider itself published
 *   skippedIdentityRows  rows discarded for missing identity
 *   duplicateRows        rows discarded because their identity was taken
 *   totalDiscovered      unique usable instruments
 *   stagedRows           rows actually persisted
 *
 * The rules these tests pin:
 *   G. a body that hands over fewer raw rows than the provider counted is NOT
 *      COMPLETE, and the shortfall is stated;
 *   H. more provider rows than unique instruments is COMPLETE — as long as the
 *      RAW rows reconcile and every discarded row is counted;
 *   I. a walk that dies before its stage is closed never reports COMPLETE;
 *   J. a write failure with other writes in flight is never dressed as complete
 *      and never loses its cause.
 */
import { describe, expect, it } from "vitest";

import {
  createTwelveDataDiscoveryAdapter,
  type FetchJson,
} from "./twelve-data-adapter";
import { fetchTwelveDataCatalogPages } from "./twelve-data-pagination";
import type { DiscoveredInstrument } from "./types";

const KEYED = (name: string) => (name === "TWELVE_DATA_API_KEY" ? "test-key" : undefined);

function catalogText(rows: unknown[], count?: number): string {
  const body = rows.map((row) => JSON.stringify(row)).join(",");
  return `{"status":"ok",${count === undefined ? "" : `"count":${count},`}"data":[${body}]}`;
}

function chunked(text: string, size = 29): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator]() {
      for (let offset = 0; offset < bytes.length; offset += size) {
        yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
      }
    },
  };
}

const streamingFetch = (text: string): FetchJson => async () => ({
  ok: true,
  status: 200,
  body: chunked(text),
});

describe("289J — a short body is never COMPLETE, and says how short it was (G)", () => {
  it("stops at the page that answers with a failure, stating the raw rows it did read", async () => {
    const text = catalogText([{ symbol: "A" }, { symbol: "B" }, { symbol: "C" }], 5);
    const fetchJson: FetchJson = async (url) => {
      // The provider said it was sending 5 rows; page 1 hands over 3, and page 2
      // refuses. The read is short — and must never be reported as complete.
      if (new URL(url).searchParams.has("page")) {
        return { ok: false, status: 500, json: { status: "error", code: 500, message: "no further pages" } };
      }
      return { ok: true, status: 200, body: chunked(text) };
    };

    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/stocks",
      apiKey: "test-key",
    });

    expect(result.completeness).toBe("PARTIAL");
    expect(result.rawRowsSeen).toBe(3);
    expect(result.totalCount).toBe(5);
    expect(result.rawRowsSeen! < result.totalCount!).toBe(true);
    expect(result.failedPage).toBe(2);
    expect(result.warnings.join(" ")).toContain("page 2 returned HTTP 500");
  });

  it("a body that dies mid-array keeps the provider's count and the rows it parsed", async () => {
    const text = catalogText([{ symbol: "A" }, { symbol: "B" }, { symbol: "C" }], 5);
    // Truncate the payload: the array never closes.
    const truncated = text.slice(0, text.length - 12);
    const result = await fetchTwelveDataCatalogPages(streamingFetch(truncated), {
      path: "/stocks",
      apiKey: "test-key",
    });

    expect(result.completeness).toBe("PARTIAL");
    expect(result.rawRowsSeen).toBe(2);
    // The provider's own count was read before the body ran out, so the short
    // read is stated against the number the provider published.
    expect(result.totalCount).toBe(5);
    // The failure is named for what it is: the payload ended inside the array.
    expect(result.warnings.join(" ")).toContain("ended inside the data array");
    expect(result.completeness).not.toBe("COMPLETE");
  });

  it("a complete body that matches the provider's count is COMPLETE", async () => {
    const text = catalogText([{ symbol: "A" }, { symbol: "B" }], 2);
    const result = await fetchTwelveDataCatalogPages(streamingFetch(text), {
      path: "/forex_pairs",
      apiKey: "test-key",
    });

    expect(result.completeness).toBe("COMPLETE");
    expect(result.rawRowsSeen).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(result.duplicateRows).toBe(0);
  });
});

describe("289J — provider rows vs unique instruments are different questions (H)", () => {
  it("keeps a catalog COMPLETE when the RAW rows reconcile and a row was skipped", async () => {
    // Three provider rows: two identifiable commodities and one that carries no
    // identity at all (no base/quote, no pair symbol). The deployed runtime sees
    // exactly this shape for `/commodities` (31 kept of 32).
    const rows = [
      { symbol: "WTI/USD", name: "Crude Oil WTI Spot" },
      { symbol: "GAU", name: "Gold (unidentified row)" },
      { symbol: "XAU/USD", name: "Gold Spot" },
    ];
    const adapter = createTwelveDataDiscoveryAdapter(streamingFetch(catalogText(rows, 3)), KEYED, {
      catalogPaths: ["/commodities"],
    });

    const result = await adapter.discover(1_700_000_000_000);
    const catalog = (result.catalogs ?? [])[0];

    expect(catalog.completeness).toBe("COMPLETE");
    // The equality that decides completeness: RAW rows seen vs the provider's own
    // count. NOT kept vs count.
    expect(catalog.rawRowsSeen).toBe(3);
    expect(catalog.providerCount).toBe(3);
    // The two are not equal — and the difference is accounted for, not hidden.
    expect(catalog.totalDiscovered).toBe(2);
    expect(catalog.skippedIdentityRows).toBe(1);
    expect(catalog.duplicateRows).toBe(0);
    expect(
      catalog.rawRowsSeen! -
        (catalog.totalDiscovered + catalog.skippedIdentityRows! + catalog.duplicateRows!),
    ).toBe(0);
    expect(result.warnings.join(" ")).toContain("skipped 1 row(s) missing identity fields");
    expect(result.instruments.map((i) => i.providerInstrumentId).sort()).toEqual([
      "WTI/USD",
      "XAU/USD",
    ]);
  });

  it("counts a duplicate provider row instead of hiding it", async () => {
    // Two identical provider rows and one distinct row. The provider publishes a
    // count of 3 raw rows; one is a duplicate, so two instruments are kept.
    const rows = [
      { symbol: "WTI/USD", name: "Crude Oil WTI Spot" },
      { symbol: "WTI/USD", name: "Crude Oil WTI Spot" },
      { symbol: "XAU/USD", name: "Gold Spot" },
    ];
    const adapter = createTwelveDataDiscoveryAdapter(streamingFetch(catalogText(rows, 3)), KEYED, {
      catalogPaths: ["/commodities"],
    });

    const result = await adapter.discover(1_700_000_000_000);
    const catalog = (result.catalogs ?? [])[0];

    // The body the provider described arrived in full, so the catalog is
    // COMPLETE even though one row was a repeat …
    expect(catalog.rawRowsSeen).toBe(3);
    expect(catalog.providerCount).toBe(3);
    expect(catalog.completeness).toBe("COMPLETE");
    // … and every raw row is accounted for exactly once.
    expect(catalog.totalDiscovered).toBe(2);
    expect(catalog.duplicateRows).toBe(1);
    expect(catalog.skippedIdentityRows).toBe(0);
    expect(
      catalog.rawRowsSeen! -
        (catalog.totalDiscovered + catalog.skippedIdentityRows! + catalog.duplicateRows!),
    ).toBe(0);
  });
});

describe("289 FINAL — providerCount reconciliation is EXACT, never silently complete (1–9)", () => {
  type Walk = Awaited<ReturnType<typeof fetchTwelveDataCatalogPages>>;

  /** A fetch that serves the given pages in order. */
  function paged(pages: { data: unknown[]; count?: number }[]): {
    fetchJson: FetchJson;
    calls: () => number;
  } {
    let call = 0;
    const fetchJson: FetchJson = async () => {
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      const body = `{"status":"ok",${page.count === undefined ? "" : `"count":${page.count},`}"data":[${page.data
        .map((row) => JSON.stringify(row))
        .join(",")}]}`;
      return { ok: true, status: 200, body: chunked(body) };
    };
    return { fetchJson, calls: () => call };
  }

  const walk = (pages: { data: unknown[]; count?: number }[]): Promise<Walk> =>
    fetchTwelveDataCatalogPages(paged(pages).fetchJson, { path: "/stocks", apiKey: "test-key" });

  const symbols = (...names: string[]) => names.map((symbol) => ({ symbol, currency: "USD" }));

  it("1. providerCount 5 / rawRowsSeen 5 — the ONLY complete reconciliation", async () => {
    const result = await walk([{ data: symbols("A", "B", "C", "D", "E"), count: 5 }]);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.rawRowsSeen).toBe(5);
    expect(result.totalCount).toBe(5);
    expect(result.rawRowsSeen).toBe(result.totalCount);
    expect(result.duplicateRows).toBe(0);
  });

  it("2. providerCount 5 / rawRowsSeen 4 — short, never COMPLETE", async () => {
    // Page 1 hands over 4 of the 5 rows the provider counted; page 2 is empty, so
    // paging stops with an unsatisfied count.
    const result = await walk([
      { data: symbols("A", "B", "C", "D"), count: 5 },
      { data: [], count: 5 },
    ]);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.rawRowsSeen).toBe(4);
    expect(result.totalCount).toBe(5);
    expect(result.rawRowsSeen! < result.totalCount!).toBe(true);
    expect(result.warnings.join(" ")).toContain("provider count short");
    expect(result.warnings.join(" ")).toContain("read 4 raw row(s) of the 5");
    expect(result.completeness).not.toBe("COMPLETE");
  });

  it("3. providerCount 5 / rawRowsSeen 6 — exceeded, explicit mismatch, never COMPLETE", async () => {
    const result = await walk([{ data: symbols("A", "B", "C", "D", "E", "F"), count: 5 }]);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.rawRowsSeen).toBe(6);
    expect(result.totalCount).toBe(5);
    expect(result.rawRowsSeen! > result.totalCount!).toBe(true);
    // The diagnostic names BOTH numbers and the fact that the count was exceeded.
    const text = result.warnings.join(" ");
    expect(text).toContain("provider count exceeded");
    expect(text).toContain("read 6 raw row(s)");
    expect(text).toContain("counted 5");
  });

  it("4. a provider count BELOW the unique rows is a mismatch, not an automatic COMPLETE", async () => {
    // Three distinct instruments with a provider count of 2: the walk read more
    // raw rows than the provider counted, so the catalog cannot be complete.
    const result = await walk([{ data: symbols("A", "B", "C"), count: 2 }]);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.rawRowsSeen).toBe(3);
    expect(result.totalCount).toBe(2);
    // The comparison that fired is raw-vs-provider, never kept-vs-provider.
    expect(result.rawRowsSeen).toBeGreaterThan(result.totalCount!);
    expect(result.warnings.join(" ")).toContain("provider count exceeded");
  });

  it("5. skipped identity rows still reconcile: raw == providerCount is COMPLETE", async () => {
    const rows = [
      { symbol: "WTI/USD", name: "Crude Oil WTI Spot" },
      { symbol: "GAU", name: "Gold (unidentified row)" },
      { symbol: "XAU/USD", name: "Gold Spot" },
    ];
    const adapter = createTwelveDataDiscoveryAdapter(
      streamingFetch(catalogText(rows, 3)),
      KEYED,
      { catalogPaths: ["/commodities"] },
    );
    const result = await adapter.discover(1_700_000_000_000);
    const catalog = (result.catalogs ?? [])[0];

    expect(catalog.completeness).toBe("COMPLETE");
    expect(catalog.rawRowsSeen).toBe(3);
    expect(catalog.providerCount).toBe(3);
    expect(catalog.totalDiscovered).toBe(2);
    expect(catalog.skippedIdentityRows).toBe(1);
    // raw == providerCount, and raw == kept + skipped + duplicates.
    expect(catalog.rawRowsSeen).toBe(
      catalog.totalDiscovered + catalog.skippedIdentityRows! + catalog.duplicateRows!,
    );
  });

  it("6. duplicate rows: raw == providerCount while kept < providerCount is COMPLETE", async () => {
    const rows = [
      { symbol: "WTI/USD", name: "Crude Oil WTI Spot" },
      { symbol: "WTI/USD", name: "Crude Oil WTI Spot" },
      { symbol: "XAU/USD", name: "Gold Spot" },
    ];
    const adapter = createTwelveDataDiscoveryAdapter(
      streamingFetch(catalogText(rows, 3)),
      KEYED,
      { catalogPaths: ["/commodities"] },
    );
    const result = await adapter.discover(1_700_000_000_000);
    const catalog = (result.catalogs ?? [])[0];

    expect(catalog.completeness).toBe("COMPLETE");
    expect(catalog.rawRowsSeen).toBe(catalog.providerCount);
    expect(catalog.totalDiscovered).toBe(2);
    expect(catalog.totalDiscovered! < catalog.providerCount!).toBe(true);
    expect(catalog.duplicateRows).toBe(1);
    expect(catalog.rawRowsSeen).toBe(
      catalog.totalDiscovered + catalog.skippedIdentityRows! + catalog.duplicateRows!,
    );
  });

  it("7. no providerCount — the documented complete-dump semantics are preserved", async () => {
    const result = await walk([{ data: symbols("A", "B") }]);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.totalCount).toBeUndefined();
    expect(result.rawRowsSeen).toBe(2);
    // Nothing invented: no count means no count, and the dump is complete.
    expect(result.completeness).not.toBe("PARTIAL");
  });

  it("8. a provider that ignores `page` is never walked forever", async () => {
    // Every page returns the SAME three rows while counting five: the walk must
    // stop at the first page that yields no new identity, and must not claim
    // completeness — the repeated body pushed the raw count past the provider's.
    const same = symbols("A", "B", "C");
    const { fetchJson, calls } = paged([
      { data: same, count: 5 },
      { data: same, count: 5 },
      { data: same, count: 5 },
    ]);
    const result = await fetchTwelveDataCatalogPages(fetchJson, {
      path: "/cryptocurrencies",
      apiKey: "test-key",
    });

    // Two requests: the repeated page ends the walk (it is never asked again).
    expect(calls()).toBe(2);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.rawRowsSeen).toBe(6);
    expect(result.totalCount).toBe(5);
    // The repeated rows are counted as duplicates rather than dropped silently.
    expect(result.duplicateRows).toBe(3);
  });

  it("9. a truncated body is short of the provider count and never COMPLETE", async () => {
    const text = catalogText(symbols("A", "B", "C"), 5);
    const result = await fetchTwelveDataCatalogPages(
      streamingFetch(text.slice(0, text.length - 12)),
      { path: "/stocks", apiKey: "test-key" },
    );
    expect(result.completeness).toBe("PARTIAL");
    expect(result.rawRowsSeen).toBe(2);
    expect(result.rawRowsSeen! < result.totalCount!).toBe(true);
  });

  it("the shortfall and the excess are distinct, named classifications", async () => {
    const short = await walk([{ data: symbols("A"), count: 3 }, { data: [], count: 3 }]);
    const excess = await walk([{ data: symbols("A", "B", "C", "D"), count: 3 }]);
    expect(short.warnings.join(" ")).toContain("provider count short");
    expect(excess.warnings.join(" ")).toContain("provider count exceeded");
    expect(short.rawRowsSeen).toBe(1);
    expect(excess.rawRowsSeen).toBe(4);
    expect([short.completeness, excess.completeness]).toEqual(["PARTIAL", "PARTIAL"]);
  });
});

describe("289J — a failed walk is never a complete stage (I, J)", () => {
  function sink(options: { failAppendAt?: number } = {}) {
    const appends: number[] = [];
    let confirmed = 0;
    let appendCount = 0;
    let finished: { completeness?: string; stagedRows: number; totalKept: number } | null = null;
    return {
      sink: {
        async begin() {
          return { stageId: "stage-289j" };
        },
        async append({ rows }: { rows: readonly DiscoveredInstrument[] }) {
          appendCount += 1;
          if (options.failAppendAt !== undefined && appendCount >= options.failAppendAt) {
            throw new Error("stage store rejected the write");
          }
          appends.push(rows.length);
          confirmed += rows.length;
        },
        async finish(args: { completeness?: string; stagedRows: number; totalDiscovered: number }) {
          finished = {
            completeness: args.completeness,
            stagedRows: args.stagedRows,
            totalKept: args.totalDiscovered,
          };
        },
      },
      appends,
      get confirmed() {
        return confirmed;
      },
      get finished() {
        return finished;
      },
    };
  }

  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      symbol: `STK${i}`,
      name: `Synthetic ${i}`,
      currency: "USD",
    }));

  it("I. a body that dies mid-walk closes its stage as PARTIAL, never COMPLETE", async () => {
    const text = catalogText(rows(3_000), 3_000);
    const truncated = text.slice(0, Math.floor(text.length * 0.6));
    const recorder = sink();
    const adapter = createTwelveDataDiscoveryAdapter(
      streamingFetch(truncated),
      KEYED,
      { catalogPaths: ["/stocks"], inlineLimit: 0, staging: recorder.sink },
    );

    const result = await adapter.discover(1_700_000_000_000);
    const catalog = (result.catalogs ?? [])[0];

    // The provider walk did not finish: the catalog is PARTIAL …
    expect(catalog.completeness).toBe("PARTIAL");
    // … and the stage it left behind says the same thing, because `closeStage`
    // is the only writer of the final verdict.
    expect(recorder.finished?.completeness).toBe("PARTIAL");
    // The rows that really were written are still readable — that is the
    // transport's separate question, and it is answered separately.
    expect(recorder.confirmed).toBeGreaterThan(0);
    expect(catalog.transport?.stagedRows).toBe(recorder.confirmed);
  });

  it("J. a write failure with writes in flight is reported, and loses no cause", async () => {
    const text = catalogText(rows(5_000), 5_000);
    const recorder = sink({ failAppendAt: 2 });
    const adapter = createTwelveDataDiscoveryAdapter(
      streamingFetch(text),
      KEYED,
      { catalogPaths: ["/stocks"], inlineLimit: 0, staging: recorder.sink },
    );

    const result = await adapter.discover(1_700_000_000_000);
    const catalog = (result.catalogs ?? [])[0];
    const transport = catalog.transport;

    // The provider walk itself finished — the catalog's own completeness must not
    // be falsified because the STORE failed.
    expect(catalog.completeness).toBe("COMPLETE");
    expect(catalog.rawRowsSeen).toBe(5_000);
    // The transport, however, is not complete: rows are missing …
    expect(transport?.state).not.toBe("complete");
    expect(transport?.stagedRows).toBe(recorder.confirmed);
    expect(transport!.stagedRows).toBeLessThan(catalog.totalDiscovered);
    // … the cause survives in the record …
    expect(`${transport?.detail ?? ""}`).toContain("staging write failed");
    expect(result.warnings.join(" ")).toContain("staged transport");
    // … and the stage's own verdict is not complete either.
    expect(recorder.finished?.completeness).toBe("COMPLETE");
    expect(recorder.finished?.stagedRows).toBe(recorder.confirmed);
  });
});
