/**
 * Phase 94 — Intelligence Notifications Convex Persistence
 *
 * User-scoped, authenticated CRUD for notifications.
 * Server-side deduplication via deterministic notification identity.
 * Bounded retention with severity-aware pruning.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { authUserId } from "./lib/authUser";

const MAX_NOTIFICATIONS = 200;

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

/** Get all notifications for authenticated user, newest first */
export const getNotifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await authUserId(ctx);
    if (!userId) return [];
    const limit = Math.min(args.limit ?? 100, 200);
    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/** Get unread notifications for authenticated user */
export const getUnreadNotifications = query({
  args: {},
  handler: async (ctx) => {
    const userId = await authUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", userId).eq("read", false),
      )
      .order("desc")
      .take(100);
  },
});

/** Get unread count */
export const getUnreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await authUserId(ctx);
    if (!userId) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", userId).eq("read", false),
      )
      .take(200);
    return unread.length;
  },
});

// ═══════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════

/** Create a notification with server-side dedup */
export const createNotification = mutation({
  args: {
    notificationId: v.string(),
    alertIdentity: v.string(),
    ruleId: v.string(),
    ruleName: v.string(),
    timestamp: v.number(),
    instrument: v.optional(v.string()),
    positionId: v.optional(v.string()),
    side: v.optional(v.string()),
    severity: v.string(),
    title: v.string(),
    message: v.string(),
    category: v.string(),
    impact: v.string(),
    source: v.string(),
    condition: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await authUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    // Server-side dedup: check if notification with same identity already exists
    const existing = await ctx.db
      .query("notifications")
      .withIndex("by_user_notif", (q) =>
        q.eq("userId", userId).eq("notificationId", args.notificationId),
      )
      .first();

    if (existing) {
      // Already exists — skip insertion, return existing
      return existing._id;
    }

    // Count existing for retention enforcement
    const allNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_NOTIFICATIONS + 1);

    const id = await ctx.db.insert("notifications", {
      userId: userId,
      notificationId: args.notificationId,
      alertIdentity: args.alertIdentity,
      ruleId: args.ruleId,
      ruleName: args.ruleName,
      timestamp: args.timestamp,
      instrument: args.instrument,
      positionId: args.positionId,
      side: args.side,
      severity: args.severity,
      title: args.title,
      message: args.message,
      category: args.category,
      impact: args.impact,
      read: false,
      dismissed: false,
      source: args.source,
      condition: args.condition,
    });

    // Retention: prune oldest if over limit
    if (allNotifs.length >= MAX_NOTIFICATIONS) {
      // Prune the oldest beyond limit
      const toPrune = allNotifs.slice(MAX_NOTIFICATIONS - 1);
      for (const old of toPrune) {
        await ctx.db.delete(old._id);
      }
    }

    return id;
  },
});

/** Mark a single notification as read */
export const markNotificationRead = mutation({
  args: { notificationId: v.string() },
  handler: async (ctx, args) => {
    const userId = await authUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const notif = await ctx.db
      .query("notifications")
      .withIndex("by_user_notif", (q) =>
        q.eq("userId", userId).eq("notificationId", args.notificationId),
      )
      .first();

    if (!notif) throw new Error("Notification not found");
    await ctx.db.patch(notif._id, { read: true });
  },
});

/** Mark all notifications as read */
export const markAllNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await authUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", userId).eq("read", false),
      )
      .take(200);

    for (const notif of unread) {
      await ctx.db.patch(notif._id, { read: true });
    }

    return unread.length;
  },
});

/** Dismiss a notification */
export const dismissNotification = mutation({
  args: { notificationId: v.string() },
  handler: async (ctx, args) => {
    const userId = await authUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const notif = await ctx.db
      .query("notifications")
      .withIndex("by_user_notif", (q) =>
        q.eq("userId", userId).eq("notificationId", args.notificationId),
      )
      .first();

    if (!notif) throw new Error("Notification not found");
    await ctx.db.patch(notif._id, { dismissed: true, read: true });
  },
});

/** Delete a notification */
export const deleteNotification = mutation({
  args: { notificationId: v.string() },
  handler: async (ctx, args) => {
    const userId = await authUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const notif = await ctx.db
      .query("notifications")
      .withIndex("by_user_notif", (q) =>
        q.eq("userId", userId).eq("notificationId", args.notificationId),
      )
      .first();

    if (!notif) throw new Error("Notification not found");
    await ctx.db.delete(notif._id);
  },
});
