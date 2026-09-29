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
import { STAGE_READ_ROWS, STAGE_WRITE_MAX_ROWS } from "../lib/discovery/return-boundary";
import type { CatalogStagingSink } from "../lib/discovery/twelve-data-adapter";

/** How many superseded rows one prune mutation removes. */
const PRUNE_BATCH_ROWS = 512;

const STAGE_ROW = v.object({
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

/** Register a stage before its first row is written. */
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
      completeness: "COMPLETE",
      transportState: "partial",
      createdAt: Date.now(),
    });
  },
});

/**
 * Write one bounded batch of rows, in provider order.
 *
 * The batch size is enforced here as well as at the call site: an oversized
 * write is rejected BEFORE the runtime has to reject the transaction, so the
 * failure names the boundary instead of surfacing as an opaque function error.
 */
export const appendStageRows = internalMutation({
  args: {
    stageId: v.string(),
    rows: v.array(STAGE_ROW),
  },
  handler: async (ctx, args) => {
    if (args.rows.length > STAGE_WRITE_MAX_ROWS) {
      throw new Error(
        `staging batch of ${args.rows.length} row(s) exceeds the ${STAGE_WRITE_MAX_ROWS}-row write boundary`,
      );
    }
    for (const row of args.rows) {
      await ctx.db.insert("discoveryStageRows", { stageId: args.stageId, ...row });
    }
    const stage = await ctx.db
      .query("discoveryStages")
      .withIndex("by_stage", (q) => q.eq("stageId", args.stageId))
      .first();
    if (stage) {
      await ctx.db.patch(stage._id, { stagedRows: stage.stagedRows + args.rows.length });
    }
  },
});

/** Settle a stage's transport truth once its walk has finished. */
export const closeStage = internalMutation({
  args: {
    stageId: v.string(),
    stagedRows: v.number(),
    totalDiscovered: v.number(),
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
 * Rows go first, a batch at a time, and the mutation reschedules itself while
 * anything remains — a 143300-row catalog is never deleted in one transaction.
 */
export const pruneStage = internalMutation({
  args: { stageId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("discoveryStageRows")
      .withIndex("by_stage", (q) => q.eq("stageId", args.stageId))
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

    const rows = await ctx.db
      .query("discoveryStageRows")
      .withIndex("by_stage_seq", (q) => q.eq("stageId", args.stageId).gt("seq", afterSeq))
      .order("asc")
      .take(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => {
      const { _id, _creationTime, stageId, ...rest } = row;
      void _id;
      void _creationTime;
      void stageId;
      return rest;
    });

    return {
      rows: page,
      hasMore,
      nextAfterSeq: page.length > 0 ? page[page.length - 1].seq : null,
      stagedRows: stage?.stagedRows ?? 0,
      totalDiscovered: stage?.totalDiscovered ?? 0,
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
      await ctx.runMutation(internal.discoveryStage.appendStageRows, { stageId, rows: payload });
    },

    async finish({ stageId, catalogPath, stagedRows, totalDiscovered, completeness, state, detail }) {
      await ctx.runMutation(internal.discoveryStage.closeStage, {
        stageId,
        stagedRows,
        totalDiscovered,
        completeness: completeness ?? "COMPLETE",
        state,
        ...(detail !== undefined ? { detail } : {}),
      });
      await ctx.runMutation(internal.discoveryStage.supersedeOlderStages, {
        catalogPath,
        keepStageId: stageId,
      });
    },
  };
}
