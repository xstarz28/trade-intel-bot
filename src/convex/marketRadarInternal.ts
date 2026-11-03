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
import type { RadarCandidateSource } from "../lib/market-radar/candidate-builder";

const GLOBAL_SCOPE = "global";
const SOURCE_LIMIT = 300;
const INSTRUMENT_SOURCE_LIMIT = 10;
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
        candidateCacheVersion: existing.candidateCacheVersion ?? 0,
        lastRankedAt: existing.lastRankedAt ?? 0,
        metrics: existing.metrics,
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
      candidateCacheVersion: 0,
    });
    return {
      claimed: true as const,
      cursor: 0,
      previousResults: [],
      lastScanAt: 0,
      candidateCacheVersion: 0,
    };
  },
});

export const listAllSources = internalQuery({
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

export const listSourcesForInstrument = internalQuery({
  args: { instrument: v.string() },
  handler: async (ctx, { instrument }): Promise<LiveCandidateSource[]> => {
    const rows = await ctx.db
      .query("marketRadarSources")
      .withIndex("by_instrument", (q) => q.eq("instrument", instrument))
      .order("desc")
      .take(INSTRUMENT_SOURCE_LIMIT);
    return rows.map((row) => row.payload as LiveCandidateSource);
  },
});

export const listRadarCandidates = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ key: string; payload: RadarCandidateSource }>> => {
    const rows = await ctx.db
      .query("marketRadarCandidates")
      .withIndex("by_updated_at")
      .order("desc")
      .take(SOURCE_LIMIT);
    return rows.map((row) => ({
      key: row.key,
      payload: row.payload as RadarCandidateSource,
    }));
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
    candidateUpdates: v.array(v.object({
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

    for (const update of args.candidateUpdates) {
      const existing = await ctx.db
        .query("marketRadarCandidates")
        .withIndex("by_key", (q) => q.eq("key", update.key))
        .unique();
      if (existing) await ctx.db.patch(existing._id, update);
      else await ctx.db.insert("marketRadarCandidates", update);
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
      candidateCacheVersion: 1,
    };
    if (state) await ctx.db.patch(state._id, patch);
    else await ctx.db.insert("marketRadarState", { scope: GLOBAL_SCOPE, ...patch });
    return {
      savedSources: args.updates.length,
      savedCandidates: args.candidateUpdates.length,
      lastScanAt: args.lastScanAt,
    };
  },
});

export const releaseScan = internalMutation({
  args: { now: v.number(), cursor: v.number(), error: v.string() },
  handler: async (ctx, { now, cursor, error }) => {
    const state = await ctx.db
      .query("marketRadarState")
      .withIndex("by_scope", (q) => q.eq("scope", GLOBAL_SCOPE))
      .unique();
    if (!state) return;
    await ctx.db.patch(state._id, {
      cursor,
      leaseUntil: 0,
      errors: [error.slice(0, 500)],
      updatedAt: now,
    });
  },
});
