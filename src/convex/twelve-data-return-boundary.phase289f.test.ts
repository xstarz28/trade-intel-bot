/**
 * Phase 289F — the Twelve Data discovery RETURN BOUNDARY, at the Convex layer.
 *
 * THE DEPLOYED FAILURE THIS PINS
 * ------------------------------
 * Phase 289E removed the 512 MB action OOM by reading each catalog in its own
 * execution. The next deployed discovery answered
 *
 *   `Function marketData.js:discoverTwelveDataCatalog return value invalid:
 *    Array length is too long (143300 > maximum length 8192)`
 *
 * `page` is ignored by the provider, so `/stocks` arrives as ONE response with
 * 143300 normalized instruments, and Convex rejects any array above 8192.
 * Slicing to 8192 would present a truncated catalog as the universe, so these
 * tests drive the SHIPPED handlers (a stubbed network; a stage store that
 * mirrors `src/convex/discoveryStage.ts` — same mutations, same bounded writes,
 * same provider-order cursor) and pin the properties of the honest alternative:
 *
 *   · a catalog that cannot cross the boundary is persisted in provider order,
 *     in bounded batches, and the returned value carries a descriptor only;
 *   · the whole universe is readable back through the REAL read action, chunk
 *     by chunk, deterministically and without a duplicate;
 *   · one catalog's transport failing is that catalog's own failure, reported
 *     with its reason, and never a silently smaller universe;
 *   · the composed discovery splits ONE inline budget across catalogs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";

import {
  discoverTwelveDataCatalog,
  discoverTwelveDataInstruments,
  readTwelveDataCatalogStage,
} from "./marketData";
import { TWELVE_DATA_CATALOG_PATHS } from "../lib/discovery/twelve-data-adapter";
import {
  arrayBoundViolations,
  CONVEX_MAX_ARRAY_LENGTH,
  DISCOVERY_INLINE_LIMIT,
  STAGE_CHUNK_ROWS,
  STAGE_READ_ROWS,
  STAGE_WRITE_BATCH_ROWS,
  STAGE_WRITE_MAX_ROWS,
} from "../lib/discovery/return-boundary";

type AnyHandler = (ctx: never, args: never) => Promise<unknown>;
const handlerOf = (fn: unknown) => (fn as { _handler: AnyHandler })._handler;

const catalogHandler = handlerOf(discoverTwelveDataCatalog);
const discoveryHandler = handlerOf(discoverTwelveDataInstruments);
const readStageHandler = handlerOf(readTwelveDataCatalogStage);

const STOCK_COUNT = 143_300;

const CATALOGS: Record<string, unknown[]> = {
  "/forex_pairs": [
    { symbol: "EUR/USD", currency_group: "Major", currency_base: "Euro", currency_quote: "US Dollar" },
    { symbol: "USD/JPY", currency_group: "Major", currency_base: "US Dollar", currency_quote: "Japanese Yen" },
  ],
  "/stocks": Array.from({ length: STOCK_COUNT }, (_, i) => ({
    symbol: `STK${i}`,
    name: `Synthetic Equity ${i}`,
    currency: "USD",
    exchange: "SYNTH",
    country: "Syntheticland",
  })),
  "/commodities": [
    { symbol: "WTI/USD", name: "Crude Oil WTI Spot", category: "Energy Resource", description: "" },
  ],
  "/indices": [{ symbol: "SPX", name: "S&P 500", currency: "USD", exchange: "INDEX" }],
  "/cryptocurrencies": [{ symbol: "BTC/USD", currency_base: "Bitcoin", currency_quote: "US Dollar" }],
};

const bodyOf = (rows: unknown[]) => JSON.stringify({ status: "ok", count: rows.length, data: rows });

let fetchPaths: string[];

function installFetch(options: { throwFor?: string[] } = {}) {
  fetchPaths = [];
  const impl = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    const path = new URL(url).pathname;
    fetchPaths.push(path);
    if ((options.throwFor ?? []).includes(path)) throw new Error(`network refused for ${path}`);
    return new Response(bodyOf(CATALOGS[path] ?? []), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  globalThis.fetch = impl;
}

// ── a stage store with the semantics of `src/convex/discoveryStage.ts` ───────

interface StageDoc {
  stageId: string;
  provider: string;
  catalogPath: string;
  assetClass: string;
  stagedRows: number;
  totalDiscovered: number;
  completeness: string;
  transportState: string;
  detail?: string;
  supersededAt?: number;
}

function createStageStore(options: { failOpen?: boolean; failAppendAfterRows?: number } = {}) {
  const stages = new Map<
    string,
    {
      doc: StageDoc;
      rows: Record<string, unknown>[];
      chunks: { seqStart: number; rows: Record<string, unknown>[] }[];
    }
  >();
  const pruned: string[] = [];
  const scheduled: string[] = [];
  const writes: number[] = [];

  const runMutation = async (ref: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(ref as never);
    switch (name) {
      case "discoveryStage:openStage": {
        if (options.failOpen) throw new Error("stage store unavailable");
        const stageId = String(args.stageId);
        stages.set(stageId, {
          doc: {
            stageId,
            provider: String(args.provider),
            catalogPath: String(args.catalogPath),
            assetClass: String(args.assetClass),
            stagedRows: 0,
            totalDiscovered: 0,
            completeness: "COMPLETE",
            transportState: "partial",
          },
          rows: [],
          chunks: [],
        });
        return null;
      }
      case "discoveryStage:appendStageChunks": {
        const batch = args.rows as Record<string, unknown>[];
        writes.push(batch.length);
        if (batch.length > STAGE_WRITE_MAX_ROWS) {
          throw new Error(
            `staging batch of ${batch.length} row(s) exceeds the ${STAGE_WRITE_MAX_ROWS}-row write boundary`,
          );
        }
        const stage = stages.get(String(args.stageId));
        if (!stage) throw new Error(`unknown stage ${args.stageId}`);
        if (
          options.failAppendAfterRows !== undefined &&
          stage.rows.length >= options.failAppendAfterRows
        ) {
          throw new Error("stage store rejected the write");
        }
        // Phase 289G: the rows are stored as CHUNK documents, exactly as the
        // real mutation does — one document per STAGE_CHUNK_ROWS rows, keyed by
        // the first row's provider `seq`.
        for (let i = 0; i < batch.length; i += STAGE_CHUNK_ROWS) {
          const slice = batch.slice(i, i + STAGE_CHUNK_ROWS);
          stage.chunks.push({ seqStart: Number(slice[0].seq), rows: slice });
        }
        stage.rows.push(...batch);
        // The stage document is not patched per write (that is what lets writes
        // overlap); the count is settled by closeStage, as the real action does.
        return null;
      }
      case "discoveryStage:closeStage": {
        const stage = stages.get(String(args.stageId));
        if (stage) {
          stage.doc.stagedRows = Number(args.stagedRows);
          stage.doc.totalDiscovered = Number(args.totalDiscovered);
          stage.doc.completeness = String(args.completeness);
          stage.doc.transportState = String(args.state);
          if (args.detail !== undefined) stage.doc.detail = String(args.detail);
        }
        return null;
      }
      case "discoveryStage:supersedeOlderStages": {
        for (const stage of stages.values()) {
          if (stage.doc.catalogPath === args.catalogPath && stage.doc.stageId !== args.keepStageId) {
            if (stage.doc.supersededAt === undefined) stage.doc.supersededAt = 1;
            scheduled.push(stage.doc.stageId);
          }
        }
        return null;
      }
      case "discoveryStage:pruneStage": {
        const stageId = String(args.stageId);
        pruned.push(stageId);
        const stage = stages.get(stageId);
        if (stage) {
          // Phase 289G: pruning deletes CHUNK documents, 512 per invocation.
          const removed = stage.chunks.splice(0, 512);
          for (const chunk of removed) {
            const rows = new Set(chunk.rows.map((row) => row.seq));
            stage.rows = stage.rows.filter((row) => !rows.has(row.seq));
          }
          if (stage.chunks.length === 0) stages.delete(stageId);
        }
        return null;
      }
      default:
        throw new Error(`unexpected mutation ${name}`);
    }
  };

  const runQuery = async (ref: unknown, args: Record<string, unknown>) => {
    expect(getFunctionName(ref as never)).toBe("discoveryStage:readStageRows");
    const stage = stages.get(String(args.stageId));
    const limit = Math.max(1, Math.min(Number(args.limit), STAGE_READ_ROWS));
    const afterSeq = Number(args.afterSeq);
    // The real reader's TWO-part cursor: the straddling chunk (greatest
    // seqStart <= afterSeq) first, then the chunks that start after it.
    const chunks = (stage?.chunks ?? []).slice().sort((a, b) => a.seqStart - b.seqStart);
    const page: Record<string, unknown>[] = [];
    let hasMore = false;
    let lastSeq: number | null = null;
    const push = (rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        if (Number(row.seq) <= afterSeq) continue;
        if (page.length === limit) {
          hasMore = true;
          return;
        }
        const { stageId: _stageId, ...rest } = row as Record<string, unknown>;
        void _stageId;
        page.push(rest);
        lastSeq = Number(row.seq);
      }
    };
    const straddle = [...chunks].reverse().find((chunk) => chunk.seqStart <= afterSeq);
    if (straddle) push(straddle.rows);
    if (!hasMore) {
      // The real reader takes `ceil(limit / STAGE_CHUNK_ROWS) + 1` chunks.
      const span = Math.ceil(limit / STAGE_CHUNK_ROWS) + 1;
      let taken = 0;
      for (const chunk of chunks) {
        if (chunk.seqStart <= afterSeq) continue;
        if (taken >= span) break;
        taken += 1;
        push(chunk.rows);
        if (hasMore) break;
      }
    }
    return {
      rows: page,
      hasMore,
      nextAfterSeq: lastSeq,
      stagedRows: stage?.doc.stagedRows ?? 0,
      totalDiscovered: stage?.doc.totalDiscovered ?? 0,
      completeness: stage?.doc.completeness ?? null,
      transportState: stage?.doc.transportState ?? null,
      catalogPath: stage?.doc.catalogPath ?? null,
      provider: stage?.doc.provider ?? null,
    };
  };

  const stageOf = (catalogPath: string) =>
    [...stages.values()].find((stage) => stage.doc.catalogPath === catalogPath) ?? null;

  return { stages, pruned, scheduled, writes, runMutation, runQuery, stageOf };
}

type Store = ReturnType<typeof createStageStore>;

const identityCtx = (store: Store) => ({
  auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) },
  runMutation: store.runMutation,
  runQuery: store.runQuery,
  scheduler: { runAfter: async () => null },
});

/** The composed action's context: other executions are reached via runAction. */
function parentCtx(store: Store) {
  const inlineLimits: number[] = [];
  const paths: string[] = [];
  return {
    inlineLimits,
    paths,
    ctx: {
      auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) },
      runMutation: store.runMutation,
      runQuery: store.runQuery,
      runAction: async (ref: unknown, args: unknown) => {
        expect(getFunctionName(ref as never)).toBe("marketData:discoverTwelveDataCatalog");
        inlineLimits.push(Number((args as { inlineLimit?: number }).inlineLimit));
        paths.push(String((args as { path: string }).path));
        return catalogHandler(identityCtx(store) as never, args as never);
      },
    },
  };
}

beforeEach(() => {
  process.env.TWELVE_DATA_API_KEY = "test-key";
  installFetch();
});
afterEach(() => {
  delete process.env.TWELVE_DATA_API_KEY;
});

describe("289F — one catalog execution stays inside the return boundary", () => {
  it("stages a 143300-instrument catalog instead of returning it", async () => {
    const store = createStageStore();
    const result = (await catalogHandler(identityCtx(store) as never, {
      path: "/stocks",
    } as never)) as {
      instruments: unknown[];
      catalogs: {
        path: string;
        completeness: string;
        totalDiscovered: number;
        transport?: { mode: string; state: string; stagedRows: number; stageId?: string };
      }[];
      totalDiscovered: number;
      completeness: string;
    };

    // Convex rejects any array above 8192 elements: nothing here may cross it.
    expect(arrayBoundViolations(result)).toEqual([]);
    // The response carries a descriptor, not a first-N prefix of the catalog.
    expect(result.instruments).toEqual([]);
    expect(result.totalDiscovered).toBe(STOCK_COUNT);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.catalogs[0].transport).toMatchObject({
      mode: "staged",
      state: "complete",
      stagedRows: STOCK_COUNT,
    });
    expect(result.catalogs[0].transport?.stageId).toBeTruthy();
    // The provider was asked for ONE catalog only.
    expect(fetchPaths).toEqual(["/stocks"]);

    // Every write stayed inside the staging write boundary, and the sum of the
    // batches is the provider's real count — no row was skipped or truncated.
    expect(store.writes.every((n) => n <= STAGE_WRITE_BATCH_ROWS)).toBe(true);
    expect(store.writes.reduce((sum, n) => sum + n, 0)).toBe(STOCK_COUNT);
    const stage = store.stageOf("/stocks");
    expect(stage?.doc.stagedRows).toBe(STOCK_COUNT);
    expect(stage?.doc.transportState).toBe("complete");
    expect(stage?.doc.completeness).toBe("COMPLETE");
  });

  it("keeps the whole universe readable through the real read action, in provider order", async () => {
    const store = createStageStore();
    const staged = (await catalogHandler(identityCtx(store) as never, {
      path: "/stocks",
    } as never)) as { catalogs: { transport?: { stageId?: string } }[] };
    const stageId = staged.catalogs[0].transport?.stageId as string;

    const seen: string[] = [];
    let afterSeq = -1;
    for (let page = 0; page < 200; page += 1) {
      const chunk = (await readStageHandler(identityCtx(store) as never, {
        stageId,
        afterSeq,
        limit: STAGE_READ_ROWS,
      } as never)) as {
        rows: { providerInstrumentId: string; provider: string; assetClass: string }[];
        hasMore: boolean;
        nextAfterSeq: number | null;
        stagedRows: number;
      };
      expect(arrayBoundViolations(chunk)).toEqual([]);
      expect(chunk.rows.length).toBeLessThanOrEqual(STAGE_READ_ROWS);
      // Provider-native identity survives the stage round trip.
      expect(chunk.rows.every((row) => row.provider === "twelve-data" && row.assetClass === "equity")).toBe(true);
      seen.push(...chunk.rows.map((row) => row.providerInstrumentId));
      if (!chunk.hasMore) {
        expect(chunk.nextAfterSeq).toBe(STOCK_COUNT - 1);
        expect(chunk.stagedRows).toBe(STOCK_COUNT);
        break;
      }
      afterSeq = chunk.nextAfterSeq as number;
    }

    expect(seen).toHaveLength(STOCK_COUNT);
    expect(new Set(seen).size).toBe(STOCK_COUNT);
    expect(seen[0]).toBe("STK0");
    expect(seen[STOCK_COUNT - 1]).toBe(`STK${STOCK_COUNT - 1}`);
  });

  it("bounds every read and returns the same page twice (a pure read)", async () => {
    const store = createStageStore();
    const staged = (await catalogHandler(identityCtx(store) as never, {
      path: "/stocks",
    } as never)) as { catalogs: { transport?: { stageId?: string } }[] };
    const stageId = staged.catalogs[0].transport?.stageId as string;

    const first = (await readStageHandler(identityCtx(store) as never, {
      stageId,
      afterSeq: -1,
      limit: 999_999,
    } as never)) as { rows: { providerInstrumentId: string }[]; nextAfterSeq: number };
    expect(first.rows.length).toBe(STAGE_READ_ROWS);
    expect(STAGE_READ_ROWS).toBeLessThan(CONVEX_MAX_ARRAY_LENGTH);

    const again = (await readStageHandler(identityCtx(store) as never, {
      stageId,
      afterSeq: -1,
      limit: STAGE_READ_ROWS,
    } as never)) as { rows: { providerInstrumentId: string }[]; nextAfterSeq: number };
    expect(again.rows).toEqual(first.rows);
    expect(again.nextAfterSeq).toBe(first.nextAfterSeq);

    // A stage that does not exist is empty and says so — nothing is invented.
    const missing = (await readStageHandler(identityCtx(store) as never, {
      stageId: "no-such-stage",
      afterSeq: -1,
      limit: 10,
    } as never)) as { rows: unknown[]; stagedRows: number; hasMore: boolean };
    expect(missing.rows).toEqual([]);
    expect(missing.stagedRows).toBe(0);
    expect(missing.hasMore).toBe(false);
  });

  it("stops staging at the failure, keeps the rows already written and names it", async () => {
    const store = createStageStore({ failAppendAfterRows: 512 });
    const result = (await catalogHandler(identityCtx(store) as never, {
      path: "/stocks",
      inlineLimit: 0,
    } as never)) as {
      catalogs: { completeness: string; totalDiscovered: number; transport?: { mode: string; state: string; stagedRows: number; detail?: string } }[];
      warnings: string[];
      totalDiscovered: number;
    };

    const catalog = result.catalogs[0];
    // The provider walk finished — the CATALOG is complete...
    expect(catalog.completeness).toBe("COMPLETE");
    expect(catalog.totalDiscovered).toBe(STOCK_COUNT);
    // ...while the TRANSPORT reports exactly how much of it is available.
    //
    // Phase 289G: the rows that reached the store are counted in FULL BATCHES —
    // the batch size is a measured constant, not whatever a transport chunk
    // happened to contain — so the confirmed count is one full batch (1024).
    expect(catalog.transport?.mode).toBe("staged");
    expect(catalog.transport?.state).toBe("partial");
    expect(catalog.transport?.stagedRows).toBe(STAGE_WRITE_BATCH_ROWS);
    expect(catalog.transport?.stagedRows).toBe(1024);
    expect(result.warnings.join(" ")).toContain("/stocks: staged transport partial");
    // The universe size is still the provider's real count.
    expect(result.totalDiscovered).toBe(STOCK_COUNT);
  });

  it("reports an unopenable stage as that catalog's transport failure, never as a short catalog", async () => {
    const store = createStageStore({ failOpen: true });
    const result = (await catalogHandler(identityCtx(store) as never, {
      path: "/stocks",
      inlineLimit: 0,
    } as never)) as {
      instruments: unknown[];
      catalogs: { completeness: string; totalDiscovered: number; transport?: { state: string; detail?: string } }[];
      warnings: string[];
    };

    expect(result.instruments).toEqual([]);
    expect(result.catalogs[0].transport?.state).toBe("failed");
    expect(result.catalogs[0].transport?.detail).toContain("staging could not be opened");
    expect(result.catalogs[0].totalDiscovered).toBe(STOCK_COUNT);
    expect(result.warnings.join(" ")).toContain("/stocks: staged transport failed");
  });
});

describe("289F — the composed discovery under one shared inline budget", () => {
  it("stages only what does not fit, and keeps the response inside the boundary", async () => {
    const store = createStageStore();
    const { ctx, inlineLimits, paths } = parentCtx(store);
    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      success: boolean;
      instruments: { providerInstrumentId: string; assetClass: string }[];
      catalogs: {
        path: string;
        completeness: string;
        totalDiscovered: number;
        transport?: { mode: string; state: string };
      }[];
      totalDiscovered: number;
      warnings: string[];
    };

    expect(arrayBoundViolations(result)).toEqual([]);
    expect(result.instruments.length).toBeLessThanOrEqual(DISCOVERY_INLINE_LIMIT);
    // No first-N prefix of the stock catalog is smuggled into the response.
    expect(result.instruments.some((i) => i.assetClass === "equity")).toBe(false);
    const stocks = result.catalogs.find((c) => c.path === "/stocks");
    expect(stocks).toMatchObject({
      completeness: "COMPLETE",
      totalDiscovered: STOCK_COUNT,
      transport: { mode: "staged", state: "complete" },
    });
    // The other catalogs still arrive inline, in provider order and untouched.
    expect(result.instruments.map((i) => i.providerInstrumentId)).toEqual([
      "EUR/USD",
      "USD/JPY",
      "WTI/USD",
      "SPX",
      "BTC/USD",
    ]);
    // The provider's real universe is the reported total.
    expect(result.totalDiscovered).toBe(STOCK_COUNT + 5);
    // Every catalog was attempted, in the adapter's order, inside ONE budget.
    expect(paths).toEqual([...TWELVE_DATA_CATALOG_PATHS]);
    expect(inlineLimits.length).toBe(TWELVE_DATA_CATALOG_PATHS.length);
    expect(Math.max(...inlineLimits)).toBeLessThanOrEqual(DISCOVERY_INLINE_LIMIT);
    for (let i = 1; i < inlineLimits.length; i += 1) {
      expect(inlineLimits[i]).toBeLessThanOrEqual(inlineLimits[i - 1]);
    }
    expect(inlineLimits[2]).toBeLessThan(inlineLimits[0]);
  });

  it("keeps a catalog that cannot be read reportable without erasing the others", async () => {
    installFetch({ throwFor: ["/stocks"] });
    const store = createStageStore();
    const { ctx } = parentCtx(store);
    const result = (await discoveryHandler(ctx as never, {} as never)) as {
      success: boolean;
      instruments: { providerInstrumentId: string }[];
      catalogs: { path: string; completeness: string; transport?: { state: string } }[];
      completeness: string;
      totalDiscovered: number;
    };

    expect(result.success).toBe(true);
    expect(result.instruments.map((i) => i.providerInstrumentId)).toEqual([
      "EUR/USD",
      "USD/JPY",
      "WTI/USD",
      "SPX",
      "BTC/USD",
    ]);
    const stocks = result.catalogs.find((c) => c.path === "/stocks");
    expect(stocks).toMatchObject({ completeness: "FAILED", transport: { state: "failed" } });
    expect(result.completeness).toBe("PARTIAL");
    expect(result.totalDiscovered).toBe(5);
  });
});
