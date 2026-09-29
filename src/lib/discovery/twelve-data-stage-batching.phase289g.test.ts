/**
 * Phase 289G — STAGING BATCHING, BACKPRESSURE AND TIMEOUT SEMANTICS.
 *
 * THE DEPLOYED FAILURE THIS PINS
 * ------------------------------
 * Phase 289F shipped the staged transport and the deployed smoke proved the
 * return boundary works — `/stocks` no longer fails the whole discovery call —
 * but the run answered
 *
 *   `/stocks/PARTIAL/0p/33289kept/failedPage=1/staged:33289:complete`
 *   `catalog stream failed: The operation was aborted due to timeout`
 *
 * 33,289 rows of ~124,000 had been staged when a single 30 s budget expired.
 * Measured against the real path (see `return-boundary.ts` for the numbers), the
 * provider read was waiting on the write path: 289F flushed the pending rows
 * after EVERY transport chunk, so a mutation per chunk, and a mutation was
 * whatever the chunk happened to contain (40 rows, 37 rows, …) instead of a
 * bounded batch.
 *
 * WHAT THESE TESTS PIN
 * --------------------
 *   1. transport chunk boundaries do NOT decide persistence batch boundaries;
 *   2. every persisted batch is bounded, and only the LAST one may be short;
 *   3. the final short batch is flushed exactly once, at end of stream;
 *   4. no row is duplicated, dropped or reordered across batch boundaries;
 *   5. the queue is bounded by the ROW COUNT (a single oversized chunk cannot
 *      accumulate the catalog), which is what the scanner's pause implements;
 *   6. a write failure stops the transport and says so — never a short catalog
 *      presented as complete;
 *   7. a stream that dies mid-body is PARTIAL, and a timeout is explicit.
 */
import { describe, expect, it } from "vitest";

import { createTwelveDataDiscoveryAdapter, type FetchJson } from "./twelve-data-adapter";
import { fetchTwelveDataCatalogPages } from "./twelve-data-pagination";
import {
  STAGE_QUEUE_ROWS,
  STAGE_WRITE_BATCH_ROWS,
  STAGE_WRITE_IN_FLIGHT,
  STAGE_WRITE_MAX_ROWS,
} from "./return-boundary";
import type { DiscoveredInstrument } from "./types";

const ROWS = 5_000;

const stockRow = (i: number) => ({
  symbol: `STK${i}`,
  name: `Synthetic Equity ${i}`,
  currency: "USD",
  exchange: "SYNTH",
  country: "Syntheticland",
});

function bodyText(rows: number): string {
  const parts: string[] = [`{"status":"ok","count":${rows},"data":[`];
  for (let i = 0; i < rows; i += 1) parts.push(i === 0 ? JSON.stringify(stockRow(i)) : `,${JSON.stringify(stockRow(i))}`);
  parts.push("]}");
  return parts.join("");
}

/** Deliver `text` in the given chunk sizes (the last chunk takes the rest). */
function chunked(text: string, sizes: number[]): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator]() {
      let offset = 0;
      let i = 0;
      while (offset < bytes.length) {
        const size = i < sizes.length ? sizes[i] : sizes[sizes.length - 1];
        i += 1;
        yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
        offset += size;
      }
    },
  };
}

type Append = { rows: number; seqs: number[] };

function recordingSink(options: { failAfterRows?: number } = {}) {
  const appends: Append[] = [];
  const batchesInFlight: number[] = [];
  let inFlight = 0;
  let rowsConfirmed = 0;
  let delayMs = 0;

  const sink = {
    async begin() {
      return { stageId: "stage-1" };
    },
    async append({ rows }: { rows: readonly DiscoveredInstrument[] }) {
      inFlight += 1;
      batchesInFlight.push(inFlight);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (options.failAfterRows !== undefined && rowsConfirmed >= options.failAfterRows) {
        inFlight -= 1;
        throw new Error("stage store rejected the write");
      }
      // The identity carries the provider's own index, so order and duplication
      // are checked from the persisted rows alone.
      const seqs = rows.map((row) => Number(String(row.providerInstrumentId).replace("STK", "")));
      appends.push({ rows: rows.length, seqs });
      rowsConfirmed += rows.length;
      inFlight -= 1;
      return;
    },
    async finish() {
      return;
    },
  };
  return {
    sink,
    appends,
    batchesInFlight,
    get confirmed() {
      return rowsConfirmed;
    },
    setDelay(ms: number) {
      delayMs = ms;
    },
  };
}

function streamingFetch(text: string, sizes: number[]): FetchJson {
  return async () => ({ ok: true, status: 200, body: chunked(text, sizes) });
}

async function run(
  options: {
    rows?: number;
    chunks?: number[];
    failAfterRows?: number;
    delayMs?: number;
    inlineLimit?: number;
  } = {},
) {
  const rows = options.rows ?? ROWS;
  const text = bodyText(rows);
  const recorder = recordingSink({ failAfterRows: options.failAfterRows });
  if (options.delayMs) recorder.setDelay(options.delayMs);
  const adapter = createTwelveDataDiscoveryAdapter(
    streamingFetch(text, options.chunks ?? [64 * 1024]),
    (name) => (name === "TWELVE_DATA_API_KEY" ? "test-key" : undefined),
    {
      catalogPaths: ["/stocks"],
      inlineLimit: options.inlineLimit ?? 0,
      staging: recorder.sink,
    },
  );
  const result = await adapter.discover(1_700_000_000_000);
  return { result, recorder, rows, text };
}

const allSeqs = (appends: Append[]) => appends.flatMap((append) => append.seqs);

describe("289G — transport chunk boundaries do not decide batch boundaries", () => {
  it("persists full batches whatever the transport's chunking is", async () => {
    // The same catalog, delivered in very different chunk shapes: one giant
    // chunk, 40-byte dribbles, and 64 KiB blocks. The provider is chunking the
    // BYTES; it must not be chunking our writes.
    const shapes: Array<[string, number[]]> = [
      ["one chunk", [10 * 1024 * 1024]],
      ["40-byte dribble", [40]],
      ["64 KiB blocks", [64 * 1024]],
    ];
    const outcomes = [];
    for (const [label, chunks] of shapes) {
      const { recorder, result } = await run({ chunks });
      const sizes = recorder.appends.map((append) => append.rows);
      const full = sizes.slice(0, -1);
      const last = sizes[sizes.length - 1];
      outcomes.push({ label, sizes, full, last });
      // Every batch but the last is FULL, and the last one is the remainder.
      expect(full.every((n) => n === STAGE_WRITE_BATCH_ROWS), `${label}: full batches`).toBe(true);
      expect(last).toBe(ROWS % STAGE_WRITE_BATCH_ROWS);
      expect(recorder.appends.length).toBe(Math.ceil(ROWS / STAGE_WRITE_BATCH_ROWS));
      expect(result.catalogs?.[0]?.transport).toMatchObject({
        mode: "staged",
        state: "complete",
        stagedRows: ROWS,
        totalKept: ROWS,
      });
    }
    // Chunking influences NOTHING about the write shape.
    expect(outcomes[1].sizes).toEqual(outcomes[0].sizes);
    expect(outcomes[2].sizes).toEqual(outcomes[0].sizes);
    // And the dribbled body really did take many more transport chunks.
    expect(outcomes[1].sizes.length).toBeGreaterThan(1);
  }, 120_000);

  it("keeps every persisted batch inside the declared bounds", async () => {
    const { recorder } = await run({ chunks: [7 * 1024] });
    expect(recorder.appends.length).toBeGreaterThan(0);
    expect(recorder.appends.every((append) => append.rows <= STAGE_WRITE_BATCH_ROWS)).toBe(true);
    expect(recorder.appends.every((append) => append.rows <= STAGE_WRITE_MAX_ROWS)).toBe(true);
    // A chunk-sized batch is a red flag: it means the transport dictated a write.
    expect(recorder.appends.map((append) => append.rows).filter((n) => n < STAGE_WRITE_BATCH_ROWS)).toHaveLength(1);
  }, 120_000);

  it("flushes the final short batch exactly once, at the end", async () => {
    const { recorder } = await run({ rows: 2_500, chunks: [9 * 1024] });
    const sizes = recorder.appends.map((append) => append.rows);
    expect(sizes.slice(0, -1).every((n) => n === STAGE_WRITE_BATCH_ROWS)).toBe(true);
    expect(sizes.filter((n) => n < STAGE_WRITE_BATCH_ROWS)).toHaveLength(1);
    expect(recorder.confirmed).toBe(2_500);
  }, 120_000);

  it("does not duplicate, drop or reorder a row across batch boundaries", async () => {
    for (const chunks of [[3 * 1024], [64 * 1024], [1]]) {
      const { recorder, rows } = await run({ chunks });
      const seqs = allSeqs(recorder.appends);
      expect(seqs).toHaveLength(rows);
      expect(new Set(seqs).size).toBe(rows);
      // Provider order, exactly: 0..rows-1 in the order they were persisted.
      expect(seqs).toEqual(Array.from({ length: rows }, (_, i) => i));
    }
  }, 180_000);
});

describe("289G — the staging queue is bounded by rows, not by chunks", () => {
  it("pauses the scanner mid-chunk so one oversized chunk cannot accumulate the catalog", async () => {
    // ONE chunk carrying the whole catalog. 289F would have queued ~5000 rows
    // before its first drain; the scanner now pauses itself every
    // STAGE_QUEUE_ROWS rows, so the drain runs DURING the chunk.
    const delivered: number[] = [];
    let persisted = 0;
    let maxOutstanding = 0;
    const drains: number[] = [];

    await fetchTwelveDataCatalogPages(
      async () => ({
        ok: true,
        status: 200,
        body: chunked(bodyText(ROWS), [10 * 1024 * 1024]),
      }),
      {
        path: "/stocks",
        apiKey: "test-key",
        onRows: (rows) => {
          delivered.push(rows.length);
        },
        rowsPerDrain: STAGE_QUEUE_ROWS,
        drain: async () => {
          const deliveredTotal = delivered.reduce((sum, n) => sum + n, 0);
          if (deliveredTotal > persisted) {
            // The queue holds everything delivered but not yet persisted.
            maxOutstanding = Math.max(maxOutstanding, deliveredTotal - persisted);
            // Simulate the sink persisting one full batch per drain.
            persisted = Math.min(deliveredTotal, persisted + STAGE_WRITE_BATCH_ROWS);
          }
          drains.push(deliveredTotal);
        },
      },
    );

    expect(delivered.reduce((sum, n) => sum + n, 0)).toBe(ROWS);
    // More than one drain inside a single transport chunk: the bound fired.
    expect(drains.length).toBeGreaterThan(1);
    // The retained set never exceeds the declared bound plus one delivery batch.
    expect(maxOutstanding).toBeLessThanOrEqual(STAGE_QUEUE_ROWS + 512);
  }, 120_000);

  it("never lets more than the declared number of writes overlap", async () => {
    const { recorder, result } = await run({ rows: 4_000, chunks: [16 * 1024], delayMs: 5 });
    expect(Math.max(...recorder.batchesInFlight)).toBeLessThanOrEqual(STAGE_WRITE_IN_FLIGHT);
    expect(result.catalogs?.[0]?.transport).toMatchObject({ stagedRows: 4_000, state: "complete" });
  }, 120_000);

  it("waits for every write before it reports the catalog's transport", async () => {
    // A slow sink: the counts that are reported must be counts that committed.
    const { recorder, result } = await run({ rows: 3_000, chunks: [32 * 1024], delayMs: 4 });
    expect(recorder.confirmed).toBe(3_000);
    expect(result.catalogs?.[0]?.transport?.stagedRows).toBe(recorder.confirmed);
  }, 120_000);
});

describe("289G — a failed or interrupted write stays explicit", () => {
  it("stops the transport at the failing write and reports PARTIAL with its reason", async () => {
    const { recorder, result } = await run({ rows: 4_000, chunks: [24 * 1024], failAfterRows: 2_048 });
    const catalog = result.catalogs?.[0];
    expect(catalog?.transport?.mode).toBe("staged");
    expect(catalog?.transport?.state).toBe("partial");
    expect(catalog?.transport?.stagedRows).toBe(recorder.confirmed);
    expect(catalog?.transport?.totalKept).toBe(4_000);
    expect(String(catalog?.transport?.detail)).toContain("staging write failed");
    // Nothing was written after the failure.
    expect(recorder.confirmed).toBe(2_048);
    expect(result.warnings.join(" ")).toContain("staged transport partial");
  }, 120_000);

  it("keeps a stream that dies mid-body PARTIAL, never complete", async () => {
    const text = bodyText(3_000);
    const bytes = new TextEncoder().encode(text);
    const dying: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        yield bytes.subarray(0, Math.floor(bytes.length / 2));
        throw new Error("The operation was aborted due to timeout");
      },
    };
    const recorder = recordingSink();
    const adapter = createTwelveDataDiscoveryAdapter(
      async () => ({ ok: true, status: 200, body: dying }),
      (name) => (name === "TWELVE_DATA_API_KEY" ? "test-key" : undefined),
      { catalogPaths: ["/stocks"], inlineLimit: 0, staging: recorder.sink },
    );
    const result = await adapter.discover(1_700_000_000_000);
    const catalog = result.catalogs?.[0];
    expect(result.completeness).toBe("PARTIAL");
    expect(catalog?.completeness).toBe("PARTIAL");
    expect(String(catalog?.transport?.detail ?? result.warnings.join(" "))).toContain("timeout");
    // What did arrive is available, in provider order, and nothing claims more.
    expect(catalog?.transport?.stagedRows).toBe(recorder.confirmed);
    expect(recorder.confirmed).toBeGreaterThan(0);
    expect(recorder.confirmed).toBeLessThan(3_000);
  }, 120_000);
});
