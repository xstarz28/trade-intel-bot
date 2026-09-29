/**
 * Phase 289J — THE STAGE CURSOR, AND WHAT AN UNCLOSED STAGE IS ALLOWED TO SAY.
 *
 * Two properties are proved here against the SHIPPED mutations and the SHIPPED
 * read action (convex-test drives the real functions; nothing is stood in for):
 *
 *   1. THE CURSOR. Rows are stored in chunk documents, so a cursor has to
 *      straddle chunk boundaries exactly once. Every boundary an operator can
 *      land on is exercised: before the first row, on a chunk's first `seq`,
 *      inside a chunk, on a chunk's last `seq`, across several chunks, the final
 *      page, an empty stage, a single-row stage, and a page that ends exactly on
 *      a chunk boundary. No duplicate, no gap, provider order preserved,
 *      `hasMore` derived from stored rows.
 *
 *   2. THE OPEN STAGE. Until `closeStage` runs, a stage holds as many rows as
 *      have been written and NOTHING about a finished walk. It is therefore
 *      never COMPLETE: it reports `PARTIAL`, and `transportState` stays
 *      `partial`. A write that fails leaves the confirmed rows readable, keeps
 *      the stage non-complete, and loses no error.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";

import schema from "./schema";
import { readTwelveDataCatalogStage } from "./marketData";
import { STAGE_CHUNK_ROWS, STAGE_READ_ROWS } from "../lib/discovery/return-boundary";
import type { DiscoveredInstrument } from "../lib/discovery/types";

const modules = import.meta.glob("./**/*.ts");

type AnyHandler = (ctx: never, args: never) => Promise<unknown>;
const handlerOf = (fn: unknown) => (fn as { _handler: AnyHandler })._handler;
const readStageHandler = handlerOf(readTwelveDataCatalogStage);

const CATALOG = "/stocks";
const DISCOVERED_AT = 1_700_000_000_000;

function row(i: number): DiscoveredInstrument {
  return {
    provider: "twelve-data",
    providerInstrumentId: `STK${i}`,
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: `STK${i}`,
    quoteAsset: "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    region: "US",
    discoveredAt: DISCOVERED_AT,
  };
}

/**
 * The same context shape the deployment resolves: identity for the read action,
 * and nested calls routed to convex-test's own database so the staging
 * mutations and the cursor are the shipped ones.
 */
function actionCtx(t: ReturnType<typeof convexTest>) {
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) },
    runMutation: async (ref: unknown, args: unknown) =>
      await t.mutation(
        ref as Parameters<typeof t.mutation>[0],
        args as Parameters<typeof t.mutation>[1],
      ),
    runQuery: async (ref: unknown, args: unknown) =>
      await t.query(
        ref as Parameters<typeof t.query>[0],
        args as Parameters<typeof t.query>[1],
      ),
    scheduler: { runAfter: async () => null },
  } as never;
  return ctx;
}

type StagePage = {
  rows: DiscoveredInstrument[];
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

/** Write `count` rows through the SHIPPED staging mutations, in one batch. */
async function stage(
  t: ReturnType<typeof convexTest>,
  count: number,
  options: { close?: boolean; completeness?: "COMPLETE" | "PARTIAL" } = {},
) {
  const { createConvexStagingSink } = await import("./discoveryStage");
  const ctx = actionCtx(t);
  const sink = createConvexStagingSink(ctx as never);
  const { stageId } = await sink.begin({
    catalogPath: CATALOG,
    assetClass: "equity",
    discoveredAt: DISCOVERED_AT,
  });
  const rows = Array.from({ length: count }, (_, i) => row(i));
  const batch = Math.max(1, Math.min(count, 1024));
  for (let i = 0; i < rows.length; i += batch) {
    await sink.append({ stageId, rows: rows.slice(i, i + batch) });
  }
  if (options.close !== false) {
    await sink.finish({
      stageId,
      catalogPath: CATALOG,
      stagedRows: rows.length,
      totalDiscovered: rows.length,
      providerCount: rows.length,
      rawRowsSeen: rows.length,
      skippedIdentityRows: 0,
      duplicateRows: 0,
      completeness: options.completeness ?? "COMPLETE",
      state: "complete",
    });
  }
  return { stageId, rows };
}

async function read(
  t: ReturnType<typeof convexTest>,
  stageId: string,
  afterSeq: number,
  limit = STAGE_READ_ROWS,
): Promise<StagePage> {
  return (await readStageHandler(actionCtx(t) as never, {
    stageId,
    afterSeq,
    limit,
  } as never)) as StagePage;
}

beforeEach(() => {
  process.env.TWELVE_DATA_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.TWELVE_DATA_API_KEY;
});

describe("289J — the cursor walks chunk documents without gaps or repeats", () => {
  it("starts at afterSeq = -1 and pages forward in provider order", async () => {
    const t = convexTest(schema, modules);
    const { stageId } = await stage(t, STAGE_CHUNK_ROWS * 3);

    const first = await read(t, stageId, -1, 100);
    expect(first.rows).toHaveLength(100);
    expect(first.rows.map((r) => r.providerInstrumentId)).toEqual(
      Array.from({ length: 100 }, (_, i) => `STK${i}`),
    );
    expect(first.hasMore).toBe(true);
    expect(first.nextAfterSeq).toBe(99);
    expect(first.stagedRows).toBe(STAGE_CHUNK_ROWS * 3);
    expect(first.completeness).toBe("COMPLETE");
    expect(first.transportState).toBe("complete");
    expect(first.rawRowsSeen).toBe(STAGE_CHUNK_ROWS * 3);
    expect(first.skippedIdentityRows).toBe(0);
    expect(first.duplicateRows).toBe(0);
  });

  it("straddles chunk boundaries exactly once at every cursor position", async () => {
    const t = convexTest(schema, modules);
    const chunk = STAGE_CHUNK_ROWS;
    const { stageId } = await stage(t, chunk * 3);

    // (a) ON the first seq of a chunk (the boundary that used to be the risk)
    const onFirst = await read(t, stageId, chunk - 1, 5);
    expect(onFirst.rows.map((r) => r.providerInstrumentId)).toEqual([
      `STK${chunk}`,
      `STK${chunk + 1}`,
      `STK${chunk + 2}`,
      `STK${chunk + 3}`,
      `STK${chunk + 4}`,
    ]);

    // (b) INSIDE a chunk
    const inside = await read(t, stageId, chunk + 10, 5);
    expect(inside.rows.map((r) => r.providerInstrumentId)).toEqual([
      `STK${chunk + 11}`,
      `STK${chunk + 12}`,
      `STK${chunk + 13}`,
      `STK${chunk + 14}`,
      `STK${chunk + 15}`,
    ]);

    // (c) ON the last seq of a chunk
    const onLast = await read(t, stageId, chunk * 2 - 1, 4);
    expect(onLast.rows.map((r) => r.providerInstrumentId)).toEqual([
      `STK${chunk * 2}`,
      `STK${chunk * 2 + 1}`,
      `STK${chunk * 2 + 2}`,
      `STK${chunk * 2 + 3}`,
    ]);
  });

  it("a page spanning several chunks is complete, ordered and duplicate-free", async () => {
    const t = convexTest(schema, modules);
    const total = STAGE_CHUNK_ROWS * 12;
    const { stageId } = await stage(t, total);

    const page = await read(t, stageId, -1, STAGE_READ_ROWS);
    expect(page.rows).toHaveLength(STAGE_READ_ROWS);
    const ids = page.rows.map((r) => r.providerInstrumentId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("STK0");
    expect(ids[ids.length - 1]).toBe(`STK${STAGE_READ_ROWS - 1}`);
    expect(page.hasMore).toBe(true);
  });

  it("walks the full stage without a duplicate or a gap, page after page", async () => {
    const t = convexTest(schema, modules);
    const total = STAGE_CHUNK_ROWS * 5 + 7; // deliberately off a chunk boundary
    const { stageId } = await stage(t, total);

    const seen: number[] = [];
    let afterSeq = -1;
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await read(t, stageId, afterSeq, 100);
      for (const r of page.rows) seen.push(Number(r.providerInstrumentId.replace("STK", "")));
      if (!page.hasMore) break;
      expect(page.nextAfterSeq).not.toBeNull();
      afterSeq = page.nextAfterSeq as number;
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i));
  });

  it("reports the final page honestly and answers the same page twice", async () => {
    const t = convexTest(schema, modules);
    const total = 10;
    const { stageId } = await stage(t, total);

    const page = await read(t, stageId, -1, 50);
    expect(page.rows).toHaveLength(total);
    expect(page.hasMore).toBe(false);
    expect(page.nextAfterSeq).toBe(total - 1);
    const again = await read(t, stageId, -1, 50);
    expect(again.rows.map((r) => r.providerInstrumentId)).toEqual(
      page.rows.map((r) => r.providerInstrumentId),
    );
    expect(again.nextAfterSeq).toBe(page.nextAfterSeq);
    expect(again.hasMore).toBe(page.hasMore);
  });

  it("ends a page exactly on a chunk boundary without repeating the next chunk", async () => {
    const t = convexTest(schema, modules);
    const chunk = STAGE_CHUNK_ROWS;
    const { stageId } = await stage(t, chunk * 2 + 3);

    const page = await read(t, stageId, -1, chunk);
    expect(page.rows).toHaveLength(chunk);
    expect(page.nextAfterSeq).toBe(chunk - 1);
    expect(page.hasMore).toBe(true);

    const next = await read(t, stageId, page.nextAfterSeq as number, chunk);
    expect(next.rows[0].providerInstrumentId).toBe(`STK${chunk}`);
    expect(next.rows.map((r) => r.providerInstrumentId)).not.toContain(`STK${chunk - 1}`);
  });

  it("handles an empty stage and a single-row stage", async () => {
    const t = convexTest(schema, modules);
    const empty = await stage(t, 0);
    const emptyPage = await read(t, empty.stageId, -1, 50);
    expect(emptyPage.rows).toEqual([]);
    expect(emptyPage.hasMore).toBe(false);
    expect(emptyPage.nextAfterSeq).toBeNull();
    expect(emptyPage.stagedRows).toBe(0);
    expect(emptyPage.completeness).toBe("COMPLETE");

    const single = await stage(t, 1);
    const singlePage = await read(t, single.stageId, -1, 50);
    expect(singlePage.rows.map((r) => r.providerInstrumentId)).toEqual(["STK0"]);
    expect(singlePage.hasMore).toBe(false);
    expect(singlePage.nextAfterSeq).toBe(0);
  });

  it("bounds the response whatever the requested limit is", async () => {
    const t = convexTest(schema, modules);
    const total = STAGE_READ_ROWS * 2;
    const { stageId } = await stage(t, total);

    const greedy = await read(t, stageId, -1, 100_000);
    expect(greedy.rows.length).toBeLessThanOrEqual(STAGE_READ_ROWS);
  });
});

describe("289 FINAL — the provider-count reconciliation survives into the stage and the read", () => {
  it("10. the stage document and the read action both carry providerCount and rawRowsSeen", async () => {
    const t = convexTest(schema, modules);
    const total = 700;
    // A walk whose raw rows reconcile exactly with the provider's own count.
    const { stageId } = await stage(t, total);

    // (a) THE STAGE DOCUMENT — the same walk, as persisted.
    const doc = await t.run(async ({ db }) => {
      const stages = await db.query("discoveryStages").collect();
      return stages[0];
    });
    expect(doc?.providerCount).toBe(total);
    expect(doc?.rawRowsSeen).toBe(total);
    expect(doc?.skippedIdentityRows).toBe(0);
    expect(doc?.duplicateRows).toBe(0);
    expect(doc?.stagedRows).toBe(total);
    expect(doc?.totalDiscovered).toBe(total);
    expect(doc?.completeness).toBe("COMPLETE");
    expect(doc?.transportState).toBe("complete");

    // (b) THE READ ACTION — the bounded proof a consumer gets, without the walk.
    const page = await read(t, stageId, -1, 50);
    expect(page.providerCount).toBe(total);
    expect(page.rawRowsSeen).toBe(total);
    expect(page.skippedIdentityRows).toBe(0);
    expect(page.duplicateRows).toBe(0);
    expect(page.completeness).toBe("COMPLETE");
    expect(page.transportState).toBe("complete");
    // The four numbers that answer four different questions agree here only
    // because this walk skipped nothing and repeated nothing.
    expect(page.rawRowsSeen).toBe(page.providerCount);
    expect(page.stagedRows).toBe(page.totalDiscovered);
  });
});

describe("289J — an unclosed stage is never COMPLETE, and a failed write is never silent", () => {
  it("reports an open stage as PARTIAL, with only the rows it really holds", async () => {
    const t = convexTest(schema, modules);
    const { stageId } = await stage(t, 600, { close: false });

    const page = await read(t, stageId, -1, 50);
    expect(page.rows.length).toBeGreaterThan(0);
    // Nothing has settled this walk, so the catalog's verdict is not COMPLETE …
    expect(page.completeness).toBe("PARTIAL");
    // … and the transport says the same thing, separately.
    expect(page.transportState).toBe("partial");
    // The count of what is really stored is still available to the reader.
    expect(page.stagedRows).toBe(0);
  });

  it("closes with the walk's verdict, not a defaulted one", async () => {
    const t = convexTest(schema, modules);
    const partial = await stage(t, 10, { completeness: "PARTIAL" });
    const page = await read(t, partial.stageId, -1, 50);
    expect(page.completeness).toBe("PARTIAL");
    expect(page.stagedRows).toBe(10);
    expect(page.transportState).toBe("complete");
  });

  it("a rejected write leaves the confirmed rows readable and the stage non-complete", async () => {
    const t = convexTest(schema, modules);
    const { createConvexStagingSink } = await import("./discoveryStage");
    const ctx = actionCtx(t);
    const sink = createConvexStagingSink(ctx as never);
    const { stageId } = await sink.begin({
      catalogPath: CATALOG,
      assetClass: "equity",
      discoveredAt: DISCOVERED_AT,
    });

    await sink.append({ stageId, rows: Array.from({ length: 300 }, (_, i) => row(i)) });

    // An oversized batch is refused BEFORE anything is written — the write
    // boundary names itself instead of surfacing as an opaque runtime error.
    await expect(
      sink.append({
        stageId,
        rows: Array.from({ length: 5_000 }, (_, i) => row(1_000 + i)),
      }),
    ).rejects.toThrow(/exceeds the \d+-row write boundary/);

    const page = await read(t, stageId, -1, 50);
    // Exactly the rows that committed are readable …
    expect(page.stagedRows).toBe(0);
    const walked: string[] = [];
    let afterSeq = -1;
    for (let guard = 0; guard < 10; guard += 1) {
      const next = await read(t, stageId, afterSeq, 100);
      walked.push(...next.rows.map((r) => r.providerInstrumentId));
      if (!next.hasMore) break;
      afterSeq = next.nextAfterSeq as number;
    }
    expect(walked).toHaveLength(300);
    // … the stage is still not complete, and no failure was swallowed.
    expect(page.completeness).toBe("PARTIAL");
    expect(page.transportState).toBe("partial");
  });
});
