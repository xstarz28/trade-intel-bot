/**
 * Internal storage and lease operations for the persistent market scanner.
 * Kept separate from the scheduled action module to avoid recursive Convex API
 * type inference through self-referencing function references.
 */
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { LiveCandidateSource } from "../lib/liveCandidateBuilder";

const GLOBAL_SCOPE = "global";
const SOURCE_LIMIT = 300;
const LEASE_MS = 120_000;

export const claimScan = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const existing = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();

    if (existing && existing.leaseUntil > now) {
      return { claimed: false as const };
    }

    const leaseUntil = now + LEASE_MS;
    if (existing) {
      await ctx.db.patch(existing._id, { leaseUntil, updatedAt: now });
      return {
        claimed: true as const,
        cursor: existing.cursor,
        previousResults: existing.results,
        lastScanAt: existing.lastScanAt,
      };
    }

    await ctx.db.insert("marketRadarState", {
      scope: GLOBAL_SCOPE,
      cursor: 0,
      leaseUntil,
      results: [],
      diffs: [],
      metrics: {},
      errors: [],
      lastScanAt: 0,
      updatedAt: now,
    });
    return {
      claimed: true as const,
      cursor: 0,
      previousResults: [],
      lastScanAt: 0,
    };
  },
});

export const listSources = internalQuery({
  args: {},
  handler: async (ctx): Promise<LiveCandidateSource[]> => {
    const rows = await ctx.db
      .query("marketRadarSources")
      .withIndex("by_updated_at")
      .order("desc")
      .take(SOURCE_LIMIT);
    return rows.map((row) => row.payload as LiveCandidateSource);
  },
});

export const persistScan = internalMutation({
  args: {
    updates: v.array(v.object({
      key: v.string(),
      instrument: v.string(),
      timeframe: v.string(),
      assetClass: v.string(),
      payload: v.any(),
      updatedAt: v.number(),
    })),
    cursor: v.number(),
    results: v.any(),
    diffs: v.any(),
    metrics: v.any(),
    errors: v.array(v.string()),
    lastScanAt: v.number(),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      const existing = await ctx.db
        .query("marketRadarSources")
        .withIndex("by_key", (q) => q.eq("key", update.key))
        .unique();
      if (existing) await ctx.db.patch(existing._id, update);
      else await ctx.db.insert("marketRadarSources", update);
    }

    const state = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();
    const patch = {
      cursor: args.cursor,
      leaseUntil: 0,
      results: args.results,
      diffs: args.diffs,
      metrics: args.metrics,
      errors: args.errors.slice(0, 20),
      lastScanAt: args.lastScanAt,
      updatedAt: args.lastScanAt,
    };
    if (state) await ctx.db.patch(state._id, patch);
    else await ctx.db.insert("marketRadarState", { scope: GLOBAL_SCOPE, ...patch });
    return { savedSources: args.updates.length, lastScanAt: args.lastScanAt };
  },
});

export const releaseScan = internalMutation({
  args: { now: v.number(), error: v.string() },
  handler: async (ctx, { now, error }) => {
    const state = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();
    if (!state) return;
    await ctx.db.patch(state._id, {
      leaseUntil: 0,
      errors: [error.slice(0, 500)],
      updatedAt: now,
    });
  },
});
