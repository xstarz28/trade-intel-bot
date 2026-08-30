/**
 * Phase 98 — Notification Preferences Convex Persistence
 *
 * User-scoped, authenticated CRUD for notification preferences.
 * One preference record per user. Safe defaults when no record exists.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const VALID_SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const VALID_CATEGORIES = [
  "THESIS", "REGIME", "TREND", "STRUCTURE", "MOMENTUM", "VOLATILITY",
  "EVIDENCE", "NEWS", "MACRO", "CROSS_ASSET", "PORTFOLIO", "DATA_QUALITY", "SYSTEM",
];
const VALID_SCOPES = ["POSITION", "INSTRUMENT", "PORTFOLIO", "GLOBAL"];

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

/** Get preferences for authenticated user. Returns defaults if no record exists. */
export const getPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) {
      return {
        minimumSeverity: "INFO",
        enabledCategories: [] as string[],
        enabledScopes: [] as string[],
        mutedRuleIds: [] as string[],
        enabledInstruments: [] as string[],
        mutedInstruments: [] as string[],
        showReadNotifications: true,
        showDismissedNotifications: false,
      };
    }

    const record = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .first();

    if (!record) {
      return {
        minimumSeverity: "INFO",
        enabledCategories: [] as string[],
        enabledScopes: [] as string[],
        mutedRuleIds: [] as string[],
        enabledInstruments: [] as string[],
        mutedInstruments: [] as string[],
        showReadNotifications: true,
        showDismissedNotifications: false,
      };
    }

    return {
      minimumSeverity: record.minimumSeverity,
      enabledCategories: record.enabledCategories,
      enabledScopes: record.enabledScopes,
      mutedRuleIds: record.mutedRuleIds,
      enabledInstruments: record.enabledInstruments,
      mutedInstruments: record.mutedInstruments,
      showReadNotifications: record.showReadNotifications,
      showDismissedNotifications: record.showDismissedNotifications,
    };
  },
});

// ═══════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════

/** Save preferences (create or update). One record per user. */
export const savePreferences = mutation({
  args: {
    minimumSeverity: v.string(),
    enabledCategories: v.array(v.string()),
    enabledScopes: v.array(v.string()),
    mutedRuleIds: v.array(v.string()),
    enabledInstruments: v.array(v.string()),
    mutedInstruments: v.array(v.string()),
    showReadNotifications: v.boolean(),
    showDismissedNotifications: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    // Validate
    if (!VALID_SEVERITIES.includes(args.minimumSeverity)) {
      throw new Error(`Invalid severity: ${args.minimumSeverity}`);
    }
    for (const cat of args.enabledCategories) {
      if (!VALID_CATEGORIES.includes(cat)) throw new Error(`Invalid category: ${cat}`);
    }
    for (const scope of args.enabledScopes) {
      if (!VALID_SCOPES.includes(scope)) throw new Error(`Invalid scope: ${scope}`);
    }
    if (args.mutedRuleIds.length > 100) throw new Error("Too many muted rules");
    if (args.mutedInstruments.length > 100) throw new Error("Too many muted instruments");
    if (args.enabledInstruments.length > 100) throw new Error("Too many enabled instruments");

    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        minimumSeverity: args.minimumSeverity,
        enabledCategories: args.enabledCategories,
        enabledScopes: args.enabledScopes,
        mutedRuleIds: args.mutedRuleIds,
        enabledInstruments: args.enabledInstruments,
        mutedInstruments: args.mutedInstruments,
        showReadNotifications: args.showReadNotifications,
        showDismissedNotifications: args.showDismissedNotifications,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("notificationPreferences", {
        userId: userId as any,
        minimumSeverity: args.minimumSeverity,
        enabledCategories: args.enabledCategories,
        enabledScopes: args.enabledScopes,
        mutedRuleIds: args.mutedRuleIds,
        enabledInstruments: args.enabledInstruments,
        mutedInstruments: args.mutedInstruments,
        showReadNotifications: args.showReadNotifications,
        showDismissedNotifications: args.showDismissedNotifications,
        updatedAt: now,
      });
    }
  },
});

/** Reset preferences to defaults */
export const resetPreferences = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
