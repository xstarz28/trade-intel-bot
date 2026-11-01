/**
 * Phase 91 — Persistent Historical Intelligence (Upgraded)
 *
 * Convex functions for persisting/retrieving intelligence snapshots and events.
 * All queries/mutations are user-scoped. Position ownership is verified.
 *
 * Phase 91 additions:
 * - Auto-pruning after snapshot/event saves
 * - Deduplication guard on event saves (same timestamp+eventType+description)
 * - Deterministic event identity for merge safety
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MAX_SNAPSHOTS = 50;
const MAX_EVENTS = 100;

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
// RETENTION ENFORCEMENT
// ═══════════════════════════════════════════════════════════════

/** Enforce retention limits for a position. Server-side only. */
async function enforceRetention(
  ctx: { db: any },
  userId: string,
  positionId: string,
): Promise<number> {
  let pruned = 0;

  // Prune snapshots
  const snapshots = await ctx.db
    .query("historicalSnapshots")
    .withIndex("by_user_position_ts", (q: any) =>
      q.eq("userId", userId).eq("positionId", positionId),
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
      q.eq("userId", userId).eq("positionId", positionId),
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
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT PERSISTENCE
// ═══════════════════════════════════════════════════════════════

/** Persist a new intelligence snapshot + auto-prune. */
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

    const id = await ctx.db.insert("historicalSnapshots", {
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

    // Auto-enforce retention after save
    await enforceRetention(ctx, user._id, args.positionId);

    return id;
  },
});

// ═══════════════════════════════════════════════════════════════
// EVENT PERSISTENCE (with dedup guard)
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic event identity for deduplication.
 * Same timestamp + eventType + description = same event.
 */
function eventIdentity(e: {
  timestamp: number;
  eventType: string;
  description: string;
}): string {
  return `${e.timestamp}|${e.eventType}|${e.description}`;
}

/** Persist historical intelligence events (batch) with dedup + auto-prune. */
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

    // Fetch existing event identities for dedup
    const existingEvents = await ctx.db
      .query("historicalEvents")
      .withIndex("by_user_position_ts", (q: any) =>
        q.eq("userId", user._id).eq("positionId", args.positionId),
      )
      .order("desc")
      .take(100);

    const existingIds = new Set(
      existingEvents.map((e: any) => eventIdentity({
        timestamp: e.timestamp,
        eventType: e.eventType,
        description: e.description,
      })),
    );

    const ids: string[] = [];
    for (const event of args.events) {
      // Dedup: skip if event identity already exists
      if (existingIds.has(eventIdentity(event))) continue;

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

    // Auto-enforce retention after save
    await enforceRetention(ctx, user._id, args.positionId);

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
// RETENTION / PRUNING (explicit call)
// ═══════════════════════════════════════════════════════════════

/** Prune old snapshots beyond the retention limit. */
export const pruneHistory = mutation({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return 0;

    const owns = await verifyPositionOwnership(ctx, user._id, args.positionId);
    if (!owns) return 0;

    return enforceRetention(ctx, user._id, args.positionId);
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


// ═══════════════════════════════════════════════════════════════
// POINT-IN-TIME FUNDAMENTAL OBSERVATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Persist historical earnings events only when the provider supplies a valid
 * public report date. Fiscal period end is stored separately and is never used
 * as a substitute for the market-availability date.
 *
 * First-seen EPS/revenue values are immutable. Repeat fetches update only the
 * retrieval timestamp, preventing silent restatement of historical observations.
 */
export const persistFundamentalObservations = internalMutation({
  args: {
    provider: v.string(),
    instrument: v.string(),
    retrievedAt: v.number(),
    observations: v.array(v.object({
      fiscalPeriodEnd: v.optional(v.string()),
      reportedDate: v.string(),
      eps: v.optional(v.number()),
      revenue: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    const seen = new Set<string>();

    for (const observation of args.observations) {
      const identity = `${observation.reportedDate}|${observation.fiscalPeriodEnd ?? ""}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      const existing = await ctx.db
        .query("fundamentalObservations")
        .withIndex("by_provider_instrument_reported_date", (q) =>
          q.eq("provider", args.provider)
            .eq("instrument", args.instrument)
            .eq("reportedDate", observation.reportedDate),
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          lastRetrievedAt: Math.max(existing.lastRetrievedAt, args.retrievedAt),
        });
        continue;
      }

      await ctx.db.insert("fundamentalObservations", {
        provider: args.provider,
        instrument: args.instrument,
        fiscalPeriodEnd: observation.fiscalPeriodEnd,
        reportedDate: observation.reportedDate,
        eps: observation.eps,
        revenue: observation.revenue,
        firstObservedAt: args.retrievedAt,
        lastRetrievedAt: args.retrievedAt,
      });
      inserted += 1;
    }

    return { inserted, received: args.observations.length };
  },
});

/** Internal chronological history for future point-in-time evaluation. */
export const listFundamentalObservations = internalQuery({
  args: {
    instrument: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(500, Math.floor(args.limit ?? 250)));
    return await ctx.db
      .query("fundamentalObservations")
      .withIndex("by_instrument_reported_date", (q) => q.eq("instrument", args.instrument))
      .order("asc")
      .take(limit);
  },
});
