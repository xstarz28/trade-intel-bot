/**
 * Phase 90 — Persistent Historical Intelligence
 *
 * Convex functions for persisting/retrieving intelligence snapshots and events.
 * All queries/mutations are user-scoped. Position ownership is verified.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ═══════════════════════════════════════════════════════════════
// AUTH RESOLUTION
// ═══════════════════════════════════════════════════════════════

async function resolveUser(ctx: {
  auth: { getUserIdentity: () => Promise<{ email?: string; subject: string } | null> };
  db: any;
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  if (identity.email) {
    const byEmail = await ctx.db
      .query("users")
      .withIndex("email", (q: any) => q.eq("email", identity.email))
      .unique();
    if (byEmail) return byEmail;
  }
  try {
    return await ctx.db.get(identity.subject);
  } catch {
    return null;
  }
}

/** Verify the user owns this position. */
async function verifyPositionOwnership(
  ctx: { db: any },
  userId: string,
  positionId: string,
): Promise<boolean> {
  const position = await ctx.db
    .query("monitoredPositions")
    .withIndex("by_user_position", (q: any) =>
      q.eq("userId", userId).eq("positionId", positionId),
    )
    .unique();
  return !!position;
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT PERSISTENCE
// ═══════════════════════════════════════════════════════════════

/** Persist a new intelligence snapshot. */
export const saveSnapshot = mutation({
  args: {
    positionId: v.string(),
    instrument: v.string(),
    side: v.string(),
    timestamp: v.number(),
    thesisState: v.string(),
    evidenceQuality: v.string(),
    marketRegime: v.string(),
    h1Trend: v.string(),
    m15Trend: v.string(),
    m5Trend: v.string(),
    mtfAlignment: v.string(),
    momentum: v.string(),
    volatility: v.string(),
    structure: v.string(),
    supportingCount: v.number(),
    conflictingCount: v.number(),
    invalidationCondition: v.string(),
    watchNext: v.string(),
    dataAvailability: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) throw new Error("Position not found for user");

    return ctx.db.insert("historicalSnapshots", {
      userId: user._id,
      positionId: args.positionId,
      instrument: args.instrument,
      side: args.side,
      timestamp: args.timestamp,
      thesisState: args.thesisState,
      evidenceQuality: args.evidenceQuality,
      marketRegime: args.marketRegime,
      h1Trend: args.h1Trend,
      m15Trend: args.m15Trend,
      m5Trend: args.m5Trend,
      mtfAlignment: args.mtfAlignment,
      momentum: args.momentum,
      volatility: args.volatility,
      structure: args.structure,
      supportingCount: args.supportingCount,
      conflictingCount: args.conflictingCount,
      invalidationCondition: args.invalidationCondition,
      watchNext: args.watchNext,
      dataAvailability: args.dataAvailability,
    });
  },
});

// ═══════════════════════════════════════════════════════════════
// EVENT PERSISTENCE
// ═══════════════════════════════════════════════════════════════

/** Persist historical intelligence events (batch). */
export const saveEvents = mutation({
  args: {
    positionId: v.string(),
    instrument: v.string(),
    side: v.string(),
    events: v.array(
      v.object({
        timestamp: v.number(),
        eventType: v.string(),
        description: v.string(),
        previousState: v.string(),
        currentState: v.string(),
        category: v.string(),
        strength: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) throw new Error("Position not found for user");

    const ids: string[] = [];
    for (const event of args.events) {
      const id = await ctx.db.insert("historicalEvents", {
        userId: user._id,
        positionId: args.positionId,
        instrument: args.instrument,
        side: args.side,
        timestamp: event.timestamp,
        eventType: event.eventType,
        description: event.description,
        previousState: event.previousState,
        currentState: event.currentState,
        category: event.category,
        strength: event.strength,
      });
      ids.push(id);
    }
    return ids;
  },
});

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

/** Get the latest snapshot for a position. */
export const getLatestSnapshot = query({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return null;

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) return null;

    const snapshots = await ctx.db
      .query("historicalSnapshots")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .take(1);

    return snapshots[0] ?? null;
  },
});

/** Get the previous snapshot for a position (second most recent). */
export const getPreviousSnapshot = query({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return null;

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) return null;

    const snapshots = await ctx.db
      .query("historicalSnapshots")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .take(2);

    return snapshots[1] ?? null;
  },
});

/** Get events for a position ordered chronologically (newest first). */
export const getEvents = query({
  args: {
    positionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return [];

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) return [];

    const limit = Math.min(args.limit ?? 100, 100);
    return await ctx.db
      .query("historicalEvents")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .take(limit);
  },
});

/** Get complete historical timeline (latest 2 snapshots + bounded events). */
export const getHistoricalTimeline = query({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return null;

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) return null;

    // Get latest 2 snapshots
    const snapshots = await ctx.db
      .query("historicalSnapshots")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .take(2);

    // Get bounded events (newest first)
    const events = await ctx.db
      .query("historicalEvents")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .take(100);

    return {
      positionId: args.positionId,
      latestSnapshot: snapshots[0] ?? null,
      previousSnapshot: snapshots[1] ?? null,
      events,
    };
  },
});

// ═══════════════════════════════════════════════════════════════
// RETENTION / PRUNING
// ═══════════════════════════════════════════════════════════════

const MAX_SNAPSHOTS = 50;
const MAX_EVENTS = 100;

/** Prune old snapshots beyond the retention limit. */
export const pruneHistory = mutation({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return 0;

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) return 0;

    let pruned = 0;

    // Prune snapshots
    const snapshots = await ctx.db
      .query("historicalSnapshots")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .collect();

    if (snapshots.length > MAX_SNAPSHOTS) {
      const toDelete = snapshots.slice(MAX_SNAPSHOTS);
      for (const s of toDelete) {
        await ctx.db.delete(s._id);
        pruned++;
      }
    }

    // Prune events
    const events = await ctx.db
      .query("historicalEvents")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .collect();

    if (events.length > MAX_EVENTS) {
      const toDelete = events.slice(MAX_EVENTS);
      for (const e of toDelete) {
        await ctx.db.delete(e._id);
        pruned++;
      }
    }

    return pruned;
  },
});

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════

/** Delete all historical data for a position. Called on position removal. */
export const deleteHistoryForPosition = mutation({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return 0;

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) return 0;

    let deleted = 0;

    // Delete snapshots
    const snapshots = await ctx.db
      .query("historicalSnapshots")
      .withIndex("by_user_position", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .collect();

    for (const s of snapshots) {
      await ctx.db.delete(s._id);
      deleted++;
    }

    // Delete events
    const events = await ctx.db
      .query("historicalEvents")
      .withIndex("by_user_position", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .collect();

    for (const e of events) {
      await ctx.db.delete(e._id);
      deleted++;
    }

    return deleted;
  },
});
