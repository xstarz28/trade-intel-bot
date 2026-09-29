/**
 * Phase 289F — the server-side stage for catalogs that cannot cross the Convex
 * function boundary.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 289E fixed the 512 MB action OOM by reading each provider catalog in its
 * own execution. The deployed runtime then hit the NEXT hard limit:
 *
 *   `Function marketData.js:discoverTwelveDataCatalog return value invalid:
 *    Array length is too long (143300 > maximum length 8192)`
 *
 * Twelve Data returns the whole `/stocks` catalog in one response (it ignores
 * `page`), so 143300 normalized instruments can never be carried by one function
 * call — and slicing them to 8192 would present a truncated catalog as the
 * universe, which the integrity rules forbid.
 *
 * WHAT THIS TABLE IS
 * ------------------
 * An indexed, provider-ordered copy of such a catalog. The catalog action writes
 * it in bounded batches, returns a bounded descriptor (counts + completeness +
 * stage id), and any consumer that genuinely needs the full universe walks it
 * back in chunks with `readTwelveDataCatalogStage`. Provider identity, provider
 * order (`seq`), completeness and the discovery instant are preserved exactly;
 * no row is filtered, capped or rewritten, and no query ever invents a total.
 *
 * RETENTION
 * ---------
 * A newer stage for the same catalog supersedes older ones, and the older rows
 * are deleted in bounded batches by a scheduled mutation — the dev deployment
 * does not accumulate a copy of the stock universe per discovery cycle.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  STAGE_CHUNK_ROWS,
  STAGE_READ_ROWS,
  STAGE_WRITE_MAX_ROWS,
} from "../lib/discovery/return-boundary";
import type { CatalogStagingSink } from "../lib/discovery/twelve-data-adapter";

/** How many superseded rows one prune mutation removes. */
const PRUNE_BATCH_ROWS = 512;

export const STAGE_ROW_VALIDATOR = v.object({
  seq: v.number(),
  provider: v.string(),
  providerInstrumentId: v.string(),
  assetClass: v.string(),
  subType: v.string(),
  baseAsset: v.string(),
  quoteAsset: v.string(),
  settleAsset: v.optional(v.string()),
  tradingState: v.string(),
  providerState: v.optional(v.string()),
  capabilities: v.array(v.string()),
  region: v.optional(v.string()),
  discoveredAt: v.number(),
  precisionJson: v.optional(v.string()),
});

const STAGE_STATE = v.union(
  v.literal("complete"),
  v.literal("partial"),
  v.literal("failed"),
);

/**
 * Register a stage before its first row is written.
 *
 * Phase 289J — AN OPEN STAGE IS NEVER COMPLETE. It was inserted with
 * `completeness: "COMPLETE"` before a single row had been written, which meant a
 * stage whose walk died (or never ran) could be read back as a COMPLETE catalog:
 * zero rows, complete claim. The initial state is now `PARTIAL` — semantically
 * "not yet a complete catalog" — and `closeStage` remains the ONE writer of the
 * catalog's final COMPLETE/PARTIAL/FAILED verdict, taken from the walk's own
 * result. Transport truth (`transportState`) stays a separate field and starts
 * `partial`, because no row is persisted yet.
 */
export const openStage = internalMutation({
  args: {
    stageId: v.string(),
    provider: v.string(),
    catalogPath: v.string(),
    assetClass: v.string(),
    discoveredAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("discoveryStages", {
      stageId: args.stageId,
      provider: args.provider,
      catalogPath: args.catalogPath,
      assetClass: args.assetClass,
      discoveredAt: args.discoveredAt,
      stagedRows: 0,
      totalDiscovered: 0,
      completeness: "PARTIAL",
      transportState: "partial",
      createdAt: Date.now(),
    });
  },
});

/**
 * Write one bounded batch of rows, in provider order — as CHUNK documents.
 *
 * Phase 289G. This used to insert one document per row. Convex charges per
 * document write, and the deployed 289F run's own numbers put that path at
 * >=1,110 rows/s (33,289 rows staged before the 30 s transport budget expired),
 * i.e. ~124,000 document writes for the stock catalog. Measured in this
 * repository against this exact mutation, one document per row costs ~40,000
 * rows/s of pure write work versus ~63,000-73,500 rows/s for chunk documents,
 * so the same 124,000-row catalog costs ~485 short writes instead of 124,000
 * document writes.
 *
 * A chunk is an ordered run of rows in the SAME shape. Nothing about a row
 * changes: `seq` (the provider order) is still assigned per row, one row is
 * still one identity, and the chunk only decides how many rows travel in one
 * document. The batch size is enforced here as well as at the call site: an
 * oversized write is rejected BEFORE the runtime has to, so the failure names
 * the boundary instead of surfacing as an opaque function error.
 */
export const appendStageChunks = internalMutation({
  args: {
    stageId: v.string(),
    rows: v.array(STAGE_ROW_VALIDATOR),
  },
  handler: async (ctx, args) => {
    if (args.rows.length > STAGE_WRITE_MAX_ROWS) {
      throw new Error(
        `staging batch of ${args.rows.length} row(s) exceeds the ${STAGE_WRITE_MAX_ROWS}-row write boundary`,
      );
    }
    for (let i = 0; i < args.rows.length; i += STAGE_CHUNK_ROWS) {
      const slice = args.rows.slice(i, i + STAGE_CHUNK_ROWS);
      await ctx.db.insert("discoveryStageChunks", {
        stageId: args.stageId,
        // The first row's provider `seq`: the index key a cursor walks with.
        seqStart: slice[0].seq,
        rows: slice,
      });
    }
    // NOTE: the stage document is NOT patched here. Several bounded writes may
    // be in flight for the same stage (that is what lets the provider read run
    // at full speed), and a shared counter would make them contend. The
    // authoritative count is written ONCE by `closeStage`, from the rows this
    // action confirmed — and an unclosed stage reports `transportState:
    // "partial"`, which is exactly what it is.
  },
});

/** Settle a stage's transport truth once its walk has finished. */
export const closeStage = internalMutation({
  args: {
    stageId: v.string(),
    stagedRows: v.number(),
    totalDiscovered: v.number(),
    /** Phase 289G — the provider's own count, when it reported one. */
    providerCount: v.optional(v.number()),
    /** Phase 289J — the walk's raw accounting, carried onto the stage. */
    rawRowsSeen: v.optional(v.number()),
    skippedIdentityRows: v.optional(v.number()),
    duplicateRows: v.optional(v.number()),
    completeness: v.union(v.literal("COMPLETE"), v.literal("PARTIAL"), v.literal("FAILED")),
    state: STAGE_STATE,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stage = await ctx.db
      .query("discoveryStages")
      .withIndex("by_stage", (q) => q.eq("stageId", args.stageId))
      .first();
    if (!stage) return;
    await ctx.db.patch(stage._id, {
      stagedRows: args.stagedRows,
      totalDiscovered: args.totalDiscovered,
      completeness: args.completeness,
      transportState: args.state,
      ...(args.detail !== undefined ? { detail: args.detail } : { detail: undefined }),
      ...(args.providerCount !== undefined ? { providerCount: args.providerCount } : {}),
      ...(args.rawRowsSeen !== undefined ? { rawRowsSeen: args.rawRowsSeen } : {}),
      ...(args.skippedIdentityRows !== undefined
        ? { skippedIdentityRows: args.skippedIdentityRows }
        : {}),
      ...(args.duplicateRows !== undefined ? { duplicateRows: args.duplicateRows } : {}),
      closedAt: Date.now(),
    });
  },
});

/**
 * Supersede every older stage of the same catalog and schedule its cleanup.
 *
 * Only the newest stage of a catalog is served; the older copies are deleted in
 * bounded batches so a repeated discovery cycle cannot grow the deployment
 * without limit.
 */
export const supersedeOlderStages = internalMutation({
  args: { catalogPath: v.string(), keepStageId: v.string() },
  handler: async (ctx, args) => {
    const stages = await ctx.db
      .query("discoveryStages")
      .withIndex("by_path", (q) => q.eq("catalogPath", args.catalogPath))
      .collect();
    for (const stage of stages) {
      if (stage.stageId === args.keepStageId) continue;
      if (stage.supersededAt === undefined) {
        await ctx.db.patch(stage._id, { supersededAt: Date.now() });
      }
      await ctx.scheduler.runAfter(0, internal.discoveryStage.pruneStage, {
        stageId: stage.stageId,
      });
    }
  },
});

/**
 * Delete one superseded stage, bounded per invocation.
 *
 * Chunk documents go first, a batch at a time, and the mutation reschedules
 * itself while anything remains — a 143300-row catalog is never deleted in one
 * transaction. (Phase 289G: the rows live in chunk documents, so deleting 485
 * of them clears 124000 rows.)
 */
export const pruneStage = internalMutation({
  args: { stageId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("discoveryStageChunks")
      .withIndex("by_stage_seq", (q) => q.eq("stageId", args.stageId))
      .take(PRUNE_BATCH_ROWS);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === PRUNE_BATCH_ROWS) {
      await ctx.scheduler.runAfter(0, internal.discoveryStage.pruneStage, {
        stageId: args.stageId,
      });
      return;
    }
    const stages = await ctx.db
      .query("discoveryStages")
      .withIndex("by_stage", (q) => q.eq("stageId", args.stageId))
      .collect();
    for (const stage of stages) {
      await ctx.db.delete(stage._id);
    }
  },
});

/**
 * One bounded, provider-ordered page of a staged catalog.
 *
 * The cursor is the provider row's own `seq`: re-reading the same page returns
 * the same rows in the same order (a pure read — it cannot duplicate or reorder
 * anything), and `hasMore` comes from the stored rows, never from a guess.
 *
 * Phase 289G — rows are stored in CHUNK documents, so the cursor has two parts:
 *
 *   1. one lookup for the chunk that may STRADDLE `afterSeq` (the chunk with the
 *      greatest `seqStart <= afterSeq`, served by the `by_stage_seq` range), then
 *   2. the chunks that start after `afterSeq`, read forward in index order.
 *
 * The straddle lookup reads at most ONE document, so a page never depends on how
 * far into the catalog it is. Chunk order IS provider order (a chunk's
 * `seqStart` is its first row's `seq`), and the rows inside a chunk are already
 * ordered, so the walk is deterministic and duplicate-free.
 */
export const readStageRows = internalQuery({
  args: {
    stageId: v.string(),
    afterSeq: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit), STAGE_READ_ROWS));
    const afterSeq = Number.isFinite(args.afterSeq) ? Math.floor(args.afterSeq) : -1;

    const stage = await ctx.db
      .query("discoveryStages")
      .withIndex("by_stage", (q) => q.eq("stageId", args.stageId))
      .first();

    type StoredRow = (typeof STAGE_ROW_VALIDATOR)["type"];
    const page: StoredRow[] = [];
    let hasMore = false;
    let lastSeq: number | null = null;

    const straddle = await ctx.db
      .query("discoveryStageChunks")
      .withIndex("by_stage_seq", (q) =>
        q.eq("stageId", args.stageId).lte("seqStart", afterSeq),
      )
      .order("desc")
      .first();
    if (straddle) {
      for (const row of straddle.rows) {
        if (row.seq <= afterSeq) continue;
        if (page.length === limit) {
          hasMore = true;
          break;
        }
        page.push(row);
        lastSeq = row.seq;
      }
    }

    if (!hasMore) {
      /**
       * How many chunks a full page can span, derived from the stored chunk
       * size (never a fixed guess): `ceil(limit / STAGE_CHUNK_ROWS)`, plus ONE
       * extra chunk so `hasMore` is answered from real rows instead of assumed.
       */
      const chunksPerPage = Math.ceil(limit / STAGE_CHUNK_ROWS) + 1;
      const forward = await ctx.db
        .query("discoveryStageChunks")
        .withIndex("by_stage_seq", (q) =>
          q.eq("stageId", args.stageId).gt("seqStart", afterSeq),
        )
        .order("asc")
        .take(chunksPerPage);
      for (let i = 0; i < forward.length && !hasMore; i += 1) {
        for (const row of forward[i].rows) {
          if (page.length === limit) {
            hasMore = true;
            break;
          }
          page.push(row);
          lastSeq = row.seq;
        }
      }
    }

    return {
      rows: page,
      hasMore,
      nextAfterSeq: lastSeq,
      stagedRows: stage?.stagedRows ?? 0,
      totalDiscovered: stage?.totalDiscovered ?? 0,
      providerCount: stage?.providerCount ?? null,
      rawRowsSeen: stage?.rawRowsSeen ?? null,
      skippedIdentityRows: stage?.skippedIdentityRows ?? null,
      duplicateRows: stage?.duplicateRows ?? null,
      completeness: stage?.completeness ?? null,
      transportState: stage?.transportState ?? null,
      catalogPath: stage?.catalogPath ?? null,
      provider: stage?.provider ?? null,
    };
  },
});

/**
 * The action-side sink: provider rows in, bounded mutations out.
 *
 * `seq` is assigned here, monotonically, in the order the provider returned the
 * rows — which is what makes a chunk walk deterministic and duplicate-free.
 */
export function createConvexStagingSink(ctx: ActionCtx): CatalogStagingSink {
  let seq = 0;
  return {
    async begin({ catalogPath, assetClass, discoveredAt }) {
      const stageId = `${catalogPath}|${discoveredAt}|${Math.random().toString(36).slice(2, 10)}`;
      seq = 0;
      await ctx.runMutation(internal.discoveryStage.openStage, {
        stageId,
        provider: "twelve-data",
        catalogPath,
        assetClass,
        discoveredAt,
      });
      return { stageId };
    },

    async append({ stageId, rows }) {
      const payload = rows.map((row) => {
        const mapped = {
          seq,
          provider: row.provider,
          providerInstrumentId: row.providerInstrumentId,
          assetClass: row.assetClass as string,
          subType: row.subType as string,
          baseAsset: row.baseAsset,
          quoteAsset: row.quoteAsset,
          ...(row.settleAsset !== undefined ? { settleAsset: row.settleAsset } : {}),
          tradingState: row.tradingState as string,
          ...(row.providerState !== undefined ? { providerState: row.providerState } : {}),
          capabilities: [...row.capabilities] as string[],
          ...(row.region !== undefined ? { region: row.region } : {}),
          discoveredAt: row.discoveredAt,
          ...(row.precision !== undefined
            ? { precisionJson: JSON.stringify(row.precision) }
            : {}),
        };
        seq += 1;
        return mapped;
      });
      await ctx.runMutation(internal.discoveryStage.appendStageChunks, { stageId, rows: payload });
    },

    async finish({
      stageId,
      catalogPath,
      stagedRows,
      totalDiscovered,
      providerCount,
      rawRowsSeen,
      skippedIdentityRows,
      duplicateRows,
      completeness,
      state,
      detail,
    }) {
      await ctx.runMutation(internal.discoveryStage.closeStage, {
        stageId,
        stagedRows,
        totalDiscovered,
        // Phase 289J — a walk that produced no verdict is NOT complete. This
        // fallback used to be "COMPLETE", so an unknown outcome read back as a
        // complete catalog; the honest default is PARTIAL.
        completeness: completeness ?? "PARTIAL",
        state,
        ...(detail !== undefined ? { detail } : {}),
        ...(providerCount !== undefined ? { providerCount } : {}),
        ...(rawRowsSeen !== undefined ? { rawRowsSeen } : {}),
        ...(skippedIdentityRows !== undefined ? { skippedIdentityRows } : {}),
        ...(duplicateRows !== undefined ? { duplicateRows } : {}),
      });
      await ctx.runMutation(internal.discoveryStage.supersedeOlderStages, {
        catalogPath,
        keepStageId: stageId,
      });
    },
  };
}
