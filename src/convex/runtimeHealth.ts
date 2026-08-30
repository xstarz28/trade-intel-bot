/**
 * Phase 99 — Runtime Health Convex Persistence
 *
 * User-scoped, authenticated CRUD for runtime health snapshots.
 * Bounded history with automatic pruning.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const MAX_HEALTH_HISTORY = 100;

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

/** Get the latest runtime health snapshot for the authenticated user. */
export const getLatestRuntimeHealth = query({
  args: {},
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) return null;

    const record = await ctx.db
      .query("runtimeHealthSnapshots")
      .withIndex("by_user", (q: any) => q.eq("userId", userId as any))
      .order("desc")
      .first();

    return record ?? null;
  },
});

/** Get recent runtime health history for the authenticated user. */
export const getRuntimeHealthHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) return [];

    const limit = Math.min(args.limit ?? 20, MAX_HEALTH_HISTORY);

    return await ctx.db
      .query("runtimeHealthSnapshots")
      .withIndex("by_user", (q: any) => q.eq("userId", userId as any))
      .order("desc")
      .take(limit);
  },
});

// ═══════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════

/** Save a runtime health snapshot. Server-side dedup + retention enforcement. */
export const saveRuntimeHealth = mutation({
  args: {
    timestamp: v.number(),
    overallStatus: v.string(),
    components: v.array(v.object({
      component: v.string(),
      status: v.string(),
      lastSuccessAt: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
      lastAttemptAt: v.optional(v.number()),
      consecutiveFailures: v.number(),
      message: v.string(),
      source: v.optional(v.string()),
      dataAgeMs: v.optional(v.number()),
      freshness: v.string(),
    })),
    intelligenceCycleStatus: v.string(),
    alertPipelineStatus: v.string(),
    persistenceStatus: v.string(),
    providerAvailability: v.record(v.string(), v.string()),
    staleComponents: v.array(v.string()),
    unavailableComponents: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    // Dedup: skip if a snapshot with same timestamp already exists
    const existing = await ctx.db
      .query("runtimeHealthSnapshots")
      .withIndex("by_user", (q: any) => q.eq("userId", userId as any))
      .order("desc")
      .first();

    if (existing && existing.timestamp === args.timestamp) {
      return existing._id;
    }

    const id = await ctx.db.insert("runtimeHealthSnapshots", {
      userId: userId as any,
      timestamp: args.timestamp,
      overallStatus: args.overallStatus,
      components: args.components,
      intelligenceCycleStatus: args.intelligenceCycleStatus,
      alertPipelineStatus: args.alertPipelineStatus,
      persistenceStatus: args.persistenceStatus,
      providerAvailability: args.providerAvailability,
      staleComponents: args.staleComponents,
      unavailableComponents: args.unavailableComponents,
    });

    // Enforce retention: keep newest MAX_HEALTH_HISTORY
    const allSnapshots = await ctx.db
      .query("runtimeHealthSnapshots")
      .withIndex("by_user", (q: any) => q.eq("userId", userId as any))
      .order("desc")
      .take(MAX_HEALTH_HISTORY + 10);

    if (allSnapshots.length > MAX_HEALTH_HISTORY) {
      const toDelete = allSnapshots.slice(MAX_HEALTH_HISTORY);
      for (const snap of toDelete) {
        await ctx.db.delete(snap._id);
      }
    }

    return id;
  },
});

/** Delete all runtime health data for the authenticated user. */
export const deleteAllRuntimeHealth = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    const records = await ctx.db
      .query("runtimeHealthSnapshots")
      .withIndex("by_user", (q: any) => q.eq("userId", userId as any))
      .collect();

    let deleted = 0;
    for (const r of records) {
      await ctx.db.delete(r._id);
      deleted++;
    }
    return deleted;
  },
});
