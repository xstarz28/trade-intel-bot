/**
 * Phase 60 — Position Protection Convex Functions
 *
 * Server-side persistence for monitored positions, alert history, and stream cursors.
 * All functions require authentication and enforce user-scoped access.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUser } from "./lib/authUser";

// ═══════════════════════════════════════════════════════════════
// AUTH RESOLUTION
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// MONITORED POSITIONS
// ═══════════════════════════════════════════════════════════════

/** Save or update a monitored position state. */
export const savePosition = mutation({
  args: {
    positionId: v.string(),
    instrument: v.string(),
    side: v.string(),
    entryPrice: v.number(),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    leverage: v.optional(v.number()),
    horizon: v.string(),
    openedAt: v.number(),
    peakPrice: v.optional(v.number()),
    peakProfit: v.optional(v.number()),
    currentSeverity: v.string(),
    lifecycleState: v.string(),
    monitoringLifecycle: v.string(),
    lastUpdateAt: v.number(),
    lastAlertAt: v.number(),
    consecutiveSameSeverity: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    // Check if position already exists for this user
    const existing = await ctx.db
      .query("monitoredPositions")
      .withIndex("by_user_position", (q) =>
        q.eq("userId", user._id).eq("positionId", args.positionId)
      )
      .unique();

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        instrument: args.instrument,
        side: args.side,
        entryPrice: args.entryPrice,
        stopLoss: args.stopLoss,
        takeProfit: args.takeProfit,
        leverage: args.leverage,
        horizon: args.horizon,
        openedAt: args.openedAt,
        peakPrice: args.peakPrice,
        peakProfit: args.peakProfit,
        currentSeverity: args.currentSeverity,
        lifecycleState: args.lifecycleState,
        monitoringLifecycle: args.monitoringLifecycle,
        lastUpdateAt: args.lastUpdateAt,
        lastAlertAt: args.lastAlertAt,
        consecutiveSameSeverity: args.consecutiveSameSeverity,
      });
      return existing._id;
    }

    // Insert new
    return ctx.db.insert("monitoredPositions", {
      userId: user._id,
      positionId: args.positionId,
      instrument: args.instrument,
      side: args.side,
      entryPrice: args.entryPrice,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      leverage: args.leverage,
      horizon: args.horizon,
      openedAt: args.openedAt,
      peakPrice: args.peakPrice,
      peakProfit: args.peakProfit,
      currentSeverity: args.currentSeverity,
      lifecycleState: args.lifecycleState,
      monitoringLifecycle: args.monitoringLifecycle,
      lastUpdateAt: args.lastUpdateAt,
      lastAlertAt: args.lastAlertAt,
      consecutiveSameSeverity: args.consecutiveSameSeverity,
    });
  },
});

/** Get a monitored position by positionId. */
export const getPosition = query({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return null;

    return await ctx.db
      .query("monitoredPositions")
      .withIndex("by_user_position", (q) =>
        q.eq("userId", user._id).eq("positionId", args.positionId)
      )
      .unique();
  },
});

/** List all active (MONITORING) positions for the current user. */
export const listActivePositions = query({
  args: {},
  handler: async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("monitoredPositions")
      .withIndex("by_user_lifecycle", (q) =>
        q.eq("userId", user._id).eq("monitoringLifecycle", "MONITORING")
      )
      .collect();
  },
});

/** Delete a monitored position (close/cleanup). */
export const deletePosition = mutation({
  args: { positionId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    const existing = await ctx.db
      .query("monitoredPositions")
      .withIndex("by_user_position", (q) =>
        q.eq("userId", user._id).eq("positionId", args.positionId)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

// ═══════════════════════════════════════════════════════════════
// ALERT HISTORY
// ═══════════════════════════════════════════════════════════════

/** Save a protection alert to history. */
export const saveAlert = mutation({
  args: {
    alertId: v.string(),
    positionId: v.string(),
    instrument: v.string(),
    severity: v.string(),
    notificationPriority: v.string(),
    reason: v.string(),
    action: v.string(),
    timestamp: v.number(),
    acknowledged: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    return ctx.db.insert("alertHistory", {
      userId: user._id,
      alertId: args.alertId,
      positionId: args.positionId,
      instrument: args.instrument,
      severity: args.severity,
      notificationPriority: args.notificationPriority,
      reason: args.reason,
      action: args.action,
      timestamp: args.timestamp,
      acknowledged: args.acknowledged,
    });
  },
});

/** List alert history for a position. */
export const listAlerts = query({
  args: {
    positionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;
    return await ctx.db
      .query("alertHistory")
      .withIndex("by_user_position_alerts", (q) =>
        q.eq("userId", user._id).eq("positionId", args.positionId)
      )
      .order("desc")
      .take(limit);
  },
});

/** Acknowledge an alert by its alertId. */
export const acknowledgeAlert = mutation({
  args: { alertId: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    // Find the alert — we need to scan since we only have position-based index
    const allAlerts = await ctx.db
      .query("alertHistory")
      .withIndex("by_user_alerts", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(500);

    const alert = allAlerts.find((a) => a.alertId === args.alertId);
    if (alert) {
      await ctx.db.patch(alert._id, { acknowledged: true });
      return true;
    }
    return false;
  },
});

// ═══════════════════════════════════════════════════════════════
// STREAM CURSORS
// ═══════════════════════════════════════════════════════════════

/** Save a stream event cursor for reconciliation. */
export const saveCursor = mutation({
  args: {
    provider: v.string(),
    instrument: v.string(),
    lastEventId: v.string(),
    lastTimestamp: v.number(),
    lastSequence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    // Upsert: find THIS USER's cursor for this provider/instrument.
    // The lookup must be user-scoped; a provider/instrument-only query can
    // match another user's row and overwrite it.
    const existing = await ctx.db
      .query("streamCursors")
      .withIndex("by_user_provider_instrument", (q) =>
        q
          .eq("userId", user._id)
          .eq("provider", args.provider)
          .eq("instrument", args.instrument)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastEventId: args.lastEventId,
        lastTimestamp: args.lastTimestamp,
        lastSequence: args.lastSequence,
      });
      return existing._id;
    }

    return ctx.db.insert("streamCursors", {
      userId: user._id,
      provider: args.provider,
      instrument: args.instrument,
      lastEventId: args.lastEventId,
      lastTimestamp: args.lastTimestamp,
      lastSequence: args.lastSequence,
    });
  },
});

/** Get a stream cursor. */
export const getCursor = query({
  args: {
    provider: v.string(),
    instrument: v.string(),
  },
  handler: async (ctx, args) => {
    // Requires authentication and returns only the caller's own cursor.
    // Previously this had no auth check and queried by provider/instrument
    // alone, so one user could read another user's stream position.
    const user = await resolveUser(ctx);
    if (!user) return null;

    return await ctx.db
      .query("streamCursors")
      .withIndex("by_user_provider_instrument", (q) =>
        q
          .eq("userId", user._id)
          .eq("provider", args.provider)
          .eq("instrument", args.instrument)
      )
      .unique();
  },
});
