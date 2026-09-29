/**
 * Phase 289G — THE COMPLETE LARGE CATALOG, THROUGH THE REAL STAGING MUTATIONS.
 *
 * WHY CONVEX-TEST
 * ---------------
 * The 289F suites proved the boundary against a HAND-WRITTEN stage store. This
 * suite drives the SHIPPED functions — `marketData:discoverTwelveDataCatalog`,
 * the real `discoveryStage` mutations and the real `readTwelveDataCatalogStage`
 * cursor — against convex-test's own database, so the claims under test are
 * claims about the deployment's code and not about a stand-in:
 *
 *   · a ~124,000-row catalog is staged COMPLETE and reaches
 *     `stagedRows == totalDiscovered == provider count`;
 *   · the walk writes in bounded batches — a few hundred documents, never one
 *     per row and never one per transport chunk;
 *   · the whole universe is readable back through the real read action, in
 *     provider order, with no duplicate and no gap;
 *   · a catalog that fails is its OWN failure — the others stay complete.
 *
 * The provider is stubbed at the network edge only. Every row, identity and
 * count below is produced by the same code the deployment runs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";

import schema from "./schema";
import { discoverTwelveDataCatalog, discoverTwelveDataInstruments, readTwelveDataCatalogStage } from "./marketData";
import {
  STAGE_CHUNK_ROWS,
  STAGE_READ_ROWS,
  STAGE_WRITE_BATCH_ROWS,
  arrayBoundViolations,
} from "../lib/discovery/return-boundary";

const modules = import.meta.glob("./**/*.ts");

type AnyHandler = (ctx: never, args: never) => Promise<unknown>;
const handlerOf = (fn: unknown) => (fn as { _handler: AnyHandler })._handler;

const catalogHandler = handlerOf(discoverTwelveDataCatalog);
const discoveryHandler = handlerOf(discoverTwelveDataInstruments);
const readStageHandler = handlerOf(readTwelveDataCatalogStage);

/** The real `/stocks` catalog the deployed run reported: ~124k rows. */
const STOCK_COUNT = 124_000;
const FOREX_ROWS = [
  { symbol: "EUR/USD", currency_group: "Major", currency_base: "Euro", currency_quote: "US Dollar" },
  { symbol: "USD/JPY", currency_group: "Major", currency_base: "US Dollar", currency_quote: "Japanese Yen" },
];
const COMMODITY_ROWS = [
  { symbol: "WTI/USD", name: "Crude Oil WTI Spot", category: "Energy Resource", description: "" },
];

const stockRow = (i: number) => ({
  symbol: `STK${i}`,
  name: `Synthetic Equity ${i}`,
  currency: "USD",
  exchange: "SYNTH",
  country: "Syntheticland",
});

function catalogBody(rows: unknown[]): string {
  const parts: string[] = [`{"status":"ok","count":${rows.length},"data":[`];
  for (let i = 0; i < rows.length; i += 1) parts.push(i === 0 ? JSON.stringify(rows[i]) : `,${JSON.stringify(rows[i])}`);
  parts.push("]}");
  return parts.join("");
}

/** Deliver a body in the given chunk sizes (dribbles included). */
function streamOf(text: string, chunkBytes: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        controller.enqueue(bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length)));
      }
      controller.close();
    },
  });
}

let requested: string[];

function installFetch(options: {
  stocksChunkBytes?: number;
  failStocks?: boolean;
  stockRows?: number;
} = {}) {
  requested = [];
  const stockRows = options.stockRows ?? STOCK_COUNT;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    const path = new URL(url).pathname;
    requested.push(path);
    if (path === "/stocks" && options.failStocks) throw new Error("network refused for /stocks");
    const rows =
      path === "/stocks"
        ? Array.from({ length: stockRows }, (_, i) => stockRow(i))
        : path === "/forex_pairs"
          ? FOREX_ROWS
          : path === "/commodities"
            ? COMMODITY_ROWS
            : [];
    const body = catalogBody(rows);
    return new Response(streamOf(body, path === "/stocks" ? (options.stocksChunkBytes ?? 64 * 1024) : 64 * 1024), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/**
 * One context that satisfies `requireIdentity` AND routes every nested call to
 * convex-test's own database — so the staging mutations and the cursor query are
 * the shipped ones.
 */
function actionCtx(t: ReturnType<typeof convexTest>) {
  const queries: number[] = [];
  const mutations: number[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) },
    runMutation: async (ref: unknown, args: unknown) => {
      mutations.push(1);
      // convex-test resolves the function by its name, exactly as the deployment
      // resolves the reference — no stand-in for the staging mutation.
      return await t.mutation(
        ref as Parameters<typeof t.mutation>[0],
        args as Parameters<typeof t.mutation>[1],
      );
    },
    runQuery: async (ref: unknown, args: unknown) => {
      queries.push(1);
      return await t.query(
        ref as Parameters<typeof t.query>[0],
        args as Parameters<typeof t.query>[1],
      );
    },
    // The composed discovery reaches each catalog through `runAction`; routing
    // it to the SHIPPED handler keeps that path on the real code too.
    runAction: async (_ref: never, args: never) => catalogHandler(ctx as never, args as never),
    scheduler: { runAfter: async () => null },
  };
  return { ctx, queries, mutations };
}

/** Count the documents the stage really holds, per table. */
async function countDocs(t: ReturnType<typeof convexTest>) {
  return await t.run(async ({ db }) => {
    const stages = await db.query("discoveryStages").collect();
    const chunks = await db.query("discoveryStageChunks").collect();
    const rowDocs = await db.query("discoveryStageRows").collect();
    return {
      stages: stages.length,
      chunkDocs: chunks.length,
      rowsInsideChunks: chunks.reduce((n, chunk) => n + chunk.rows.length, 0),
      legacyRowDocs: rowDocs.length,
      stage: stages[0] ?? null,
    };
  });
}

beforeEach(() => {
  process.env.TWELVE_DATA_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.TWELVE_DATA_API_KEY;
});

describe("289G — a complete large catalog reaches the provider's own count", () => {
  it("stages every row of a 124000-row catalog and reports it COMPLETE", async () => {
    installFetch();
    const t = convexTest(schema, modules);
    const { ctx } = actionCtx(t);

    const result = (await catalogHandler(ctx as never, { path: "/stocks" } as never)) as {
      instruments: unknown[];
      totalDiscovered: number;
      completeness: string;
      catalogs: {
        completeness: string;
        totalDiscovered: number;
        providerCount?: number;
        rawRowsSeen?: number;
        skippedIdentityRows?: number;
        duplicateRows?: number;
        transport?: { mode: string; state: string; stagedRows: number; stageId?: string };
      }[];
    };

    // Convex rejects any array above 8192: the response must stay inside it.
    expect(arrayBoundViolations(result)).toEqual([]);
    expect(result.instruments).toEqual([]);
    // Catalog truth, transport truth and the PROVIDER's own count all agree.
    expect(result.catalogs[0].completeness).toBe("COMPLETE");
    expect(result.catalogs[0].providerCount).toBe(STOCK_COUNT);
    expect(result.catalogs[0].totalDiscovered).toBe(STOCK_COUNT);
    /**
     * Phase 289J — the numbers that DECIDE completeness, stated separately.
     *
     * The provider's count reconciles with the RAW rows this walk parsed, and the
     * persisted rows reconcile with the unique instruments it kept. Neither
     * equality is `providerCount == totalDiscovered` — for this catalog all three
     * happen to be equal, and the test proves they are equal for the RIGHT
     * reasons: nothing was skipped and nothing was a duplicate.
     */
    expect(result.catalogs[0].rawRowsSeen).toBe(STOCK_COUNT);
    expect(result.catalogs[0].skippedIdentityRows).toBe(0);
    expect(result.catalogs[0].duplicateRows).toBe(0);
    expect(
      result.catalogs[0].rawRowsSeen! -
        (result.catalogs[0].totalDiscovered +
          result.catalogs[0].skippedIdentityRows! +
          result.catalogs[0].duplicateRows!),
    ).toBe(0);
    expect(result.catalogs[0].transport).toMatchObject({
      mode: "staged",
      state: "complete",
      stagedRows: STOCK_COUNT,
    });
    // stagedRows == totalKept is the TRANSPORT's completeness proof.
    expect(result.catalogs[0].transport?.stagedRows).toBe(result.catalogs[0].totalDiscovered);

    const docs = await countDocs(t);
    // ONE stage, and the rows are stored in bounded chunk documents.
    expect(docs.stages).toBe(1);
    expect(docs.stage?.stagedRows).toBe(STOCK_COUNT);
    expect(docs.stage?.providerCount).toBe(STOCK_COUNT);
    // Phase 289J — the stage document carries the raw accounting too, so the
    // READ PROOF can state the provider-count reconciliation on its own.
    expect(docs.stage?.rawRowsSeen).toBe(STOCK_COUNT);
    expect(docs.stage?.skippedIdentityRows).toBe(0);
    expect(docs.stage?.duplicateRows).toBe(0);
    expect(docs.stage?.completeness).toBe("COMPLETE");
    expect(docs.stage?.transportState).toBe("complete");
    expect(docs.rowsInsideChunks).toBe(STOCK_COUNT);
    expect(docs.chunkDocs).toBe(Math.ceil(STOCK_COUNT / STAGE_CHUNK_ROWS));
    // The write cost is document writes, NOT one per row: this is the whole
    // reason the provider read can finish inside a bounded budget.
    expect(docs.chunkDocs).toBeLessThan(STOCK_COUNT / 100);
    expect(docs.legacyRowDocs).toBe(0);
  }, 600_000);

  it("walks the whole universe back through the real read action, in provider order", async () => {
    installFetch({ stocksChunkBytes: 32 * 1024 });
    const t = convexTest(schema, modules);
    const { ctx } = actionCtx(t);
    const staged = (await catalogHandler(ctx as never, { path: "/stocks" } as never)) as {
      catalogs: { transport?: { stageId?: string } }[];
    };
    const stageId = staged.catalogs[0].transport?.stageId as string;
    expect(stageId).toBeTruthy();

    const seen: string[] = [];
    let afterSeq = -1;
    let pages = 0;
    for (;;) {
      pages += 1;
      expect(pages).toBeLessThan(200);
      const page = (await readStageHandler(ctx as never, {
        stageId,
        afterSeq,
        limit: STAGE_READ_ROWS,
      } as never)) as {
        rows: { providerInstrumentId: string; provider: string; assetClass: string }[];
        hasMore: boolean;
        nextAfterSeq: number | null;
        stagedRows: number;
        totalDiscovered: number;
        providerCount: number | null;
        rawRowsSeen: number | null;
        skippedIdentityRows: number | null;
        duplicateRows: number | null;
        completeness: string | null;
        transportState: string | null;
      };
      expect(arrayBoundViolations(page)).toEqual([]);
      expect(page.rows.length).toBeLessThanOrEqual(STAGE_READ_ROWS);
      expect(page.rows.every((row) => row.provider === "twelve-data" && row.assetClass === "equity")).toBe(true);
      seen.push(...page.rows.map((row) => row.providerInstrumentId));
      if (!page.hasMore) {
        // The stage's own record, readable with the last page.
        expect(page.stagedRows).toBe(STOCK_COUNT);
        expect(page.totalDiscovered).toBe(STOCK_COUNT);
        expect(page.providerCount).toBe(STOCK_COUNT);
        // Phase 289J — the bounded read proof states the same reconciliation.
        expect(page.rawRowsSeen).toBe(STOCK_COUNT);
        expect(page.skippedIdentityRows).toBe(0);
        expect(page.duplicateRows).toBe(0);
        expect(page.completeness).toBe("COMPLETE");
        expect(page.transportState).toBe("complete");
        expect(page.nextAfterSeq).toBe(STOCK_COUNT - 1);
        break;
      }
      afterSeq = page.nextAfterSeq as number;
    }

    expect(seen).toHaveLength(STOCK_COUNT);
    expect(new Set(seen).size).toBe(STOCK_COUNT);
    expect(seen[0]).toBe("STK0");
    expect(seen[STOCK_COUNT - 1]).toBe(`STK${STOCK_COUNT - 1}`);
  }, 600_000);

  it("bounds every read and returns the same page twice (a pure read)", async () => {
    installFetch({ stockRows: 6_000, stocksChunkBytes: 16 * 1024 });
    const t = convexTest(schema, modules);
    const { ctx } = actionCtx(t);
    const staged = (await catalogHandler(ctx as never, { path: "/stocks" } as never)) as {
      catalogs: { transport?: { stageId?: string } }[];
    };
    const stageId = staged.catalogs[0].transport?.stageId as string;

    const args = { stageId, afterSeq: 2_048, limit: 999_999 } as never;
    const first = (await readStageHandler(ctx as never, args)) as { rows: unknown[]; nextAfterSeq: number };
    const again = (await readStageHandler(ctx as never, args)) as { rows: unknown[]; nextAfterSeq: number };
    expect(first.rows).toEqual(again.rows);
    expect(first.nextAfterSeq).toBe(again.nextAfterSeq);
    // A page that starts MID-chunk still returns full pages (the cursor looks up
    // the straddling document), so no read is accidentally short.
    expect(first.rows.length).toBe(STAGE_READ_ROWS);
  }, 600_000);
});

describe("289G — one catalog's transport failure cannot erase the others", () => {
  it("keeps commodities and forex complete when the stock catalog refuses", async () => {
    installFetch({ failStocks: true });
    const t = convexTest(schema, modules);
    const { ctx } = actionCtx(t);

    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      completeness: string;
      catalogs: { path: string; completeness: string; transport?: { state: string } }[];
      instruments: { assetClass: string }[];
    };

    const byPath = new Map(result.catalogs.map((c) => [c.path, c]));
    expect(byPath.get("/stocks")?.completeness).toBe("FAILED");
    expect(byPath.get("/commodities")?.completeness).toBe("COMPLETE");
    expect(byPath.get("/forex_pairs")?.completeness).toBe("COMPLETE");
    // The successful catalogs are still delivered, with their own rows.
    expect(result.instruments.some((i) => i.assetClass === "commodity")).toBe(true);
    expect(result.instruments.some((i) => i.assetClass === "forex")).toBe(true);
    // One catalog failing does not make the run FAILED.
    expect(result.completeness).not.toBe("FAILED");
  }, 600_000);
});

describe("289G — the inline budget is shared, and a boundary crossing stages the WHOLE catalog", () => {
  it("stages a catalog as a whole, never a first-N prefix", async () => {
    installFetch({ stockRows: 4_096, stocksChunkBytes: 16 * 1024 });
    const t = convexTest(schema, modules);
    const { ctx } = actionCtx(t);

    const result = (await catalogHandler(ctx as never, {
      path: "/stocks",
      inlineLimit: 1_000,
    } as never)) as {
      instruments: { providerInstrumentId: string }[];
      catalogs: { totalDiscovered: number; transport?: { inlineRows: number; stagedRows: number; state: string } }[];
    };

    // The rows that were collected inline move ONTO the stage with the rest, so
    // the stage holds the catalog from row 0 — not from row 1001.
    expect(result.instruments).toEqual([]);
    expect(result.catalogs[0].transport).toMatchObject({ inlineRows: 0, stagedRows: 4_096, state: "complete" });
    expect(result.catalogs[0].totalDiscovered).toBe(4_096);

    const docs = await countDocs(t);
    const stored = await t.run(async ({ db }) => {
      const chunks = await db.query("discoveryStageChunks").collect();
      return chunks
        .sort((a, b) => a.seqStart - b.seqStart)
        .flatMap((chunk) => chunk.rows.map((row) => row.seq));
    });
    expect(stored).toEqual(Array.from({ length: 4_096 }, (_, i) => i));
  }, 600_000);

  it("writes batches a transport chunk cannot dictate", async () => {
    installFetch({ stockRows: 5_000, stocksChunkBytes: 512 });
    const t = convexTest(schema, modules);
    const { ctx, mutations } = actionCtx(t);
    // `inlineLimit: 0` puts the whole catalog on the staged transport — this test
    // is about the WRITE SHAPE, not about where the boundary sits.
    await catalogHandler(ctx as never, { path: "/stocks", inlineLimit: 0 } as never);
    // 5,000 rows = 4 full batches + 1 short batch + open + close (+ metadata).
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.length).toBeLessThanOrEqual(3 * Math.ceil(5_000 / STAGE_WRITE_BATCH_ROWS) + 8);
    const docs = await countDocs(t);
    expect(docs.rowsInsideChunks).toBe(5_000);
  }, 600_000);
});
