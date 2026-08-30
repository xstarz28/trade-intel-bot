/**
 * Phase 93 — Custom Alert Rules Convex Persistence
 *
 * User-scoped, authenticated CRUD for alert rules and alert history.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ═══════════════════════════════════════════════════════════════
// RULES CRUD
// ═══════════════════════════════════════════════════════════════

/** List all rules for the authenticated user */
export const listRules = query({
  args: {},
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) return [];
    return await ctx.db
      .query("alertRules")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .collect();
  },
});

/** Create a new alert rule */
export const createRule = mutation({
  args: {
    ruleId: v.string(),
    name: v.string(),
    enabled: v.boolean(),
    scope: v.string(),
    instrument: v.optional(v.string()),
    positionId: v.optional(v.string()),
    condition: v.string(),
    severity: v.string(),
    cooldownMs: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    // Count existing rules
    const existing = await ctx.db
      .query("alertRules")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .collect();

    if (existing.length >= 50) {
      throw new Error("Maximum 50 rules per user");
    }

    const now = Date.now();
    await ctx.db.insert("alertRules", {
      userId: userId as any,
      ruleId: args.ruleId,
      name: args.name,
      enabled: args.enabled,
      scope: args.scope,
      instrument: args.instrument,
      positionId: args.positionId,
      condition: args.condition,
      severity: args.severity,
      cooldownMs: args.cooldownMs,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update an existing rule */
export const updateRule = mutation({
  args: {
    ruleId: v.string(),
    name: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    severity: v.optional(v.string()),
    cooldownMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    const rules = await ctx.db
      .query("alertRules")
      .withIndex("by_user_rule", (q) =>
        q.eq("userId", userId as any).eq("ruleId", args.ruleId),
      )
      .first();

    if (!rules) throw new Error("Rule not found");

    await ctx.db.patch(rules._id, {
      ...(args.name !== undefined && { name: args.name }),
      ...(args.enabled !== undefined && { enabled: args.enabled }),
      ...(args.severity !== undefined && { severity: args.severity }),
      ...(args.cooldownMs !== undefined && { cooldownMs: args.cooldownMs }),
      updatedAt: Date.now(),
    });
  },
});

/** Delete a rule */
export const deleteRule = mutation({
  args: { ruleId: v.string() },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    const rule = await ctx.db
      .query("alertRules")
      .withIndex("by_user_rule", (q) =>
        q.eq("userId", userId as any).eq("ruleId", args.ruleId),
      )
      .first();

    if (!rule) throw new Error("Rule not found");
    await ctx.db.delete(rule._id);

    // Also clean up alert history for this rule
    const alerts = await ctx.db
      .query("ruleAlertHistory")
      .withIndex("by_user_rule", (q) =>
        q.eq("userId", userId as any).eq("ruleId", args.ruleId),
      )
      .collect();

    for (const alert of alerts) {
      await ctx.db.delete(alert._id);
    }
  },
});

// ═══════════════════════════════════════════════════════════════
// ALERT HISTORY
// ═══════════════════════════════════════════════════════════════

/** Get recent alerts for the user */
export const getRecentAlerts = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) return [];
    const limit = Math.min(args.limit ?? 50, 100);
    return await ctx.db
      .query("ruleAlertHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .order("desc")
      .take(limit);
  },
});

/** Persist a triggered alert */
export const saveAlert = mutation({
  args: {
    alertId: v.string(),
    ruleId: v.string(),
    ruleName: v.string(),
    positionId: v.optional(v.string()),
    instrument: v.optional(v.string()),
    condition: v.string(),
    severity: v.string(),
    description: v.string(),
    previousState: v.optional(v.string()),
    currentState: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    await ctx.db.insert("ruleAlertHistory", {
      userId: userId as any,
      alertId: args.alertId,
      ruleId: args.ruleId,
      ruleName: args.ruleName,
      positionId: args.positionId,
      instrument: args.instrument,
      condition: args.condition,
      severity: args.severity,
      description: args.description,
      previousState: args.previousState,
      currentState: args.currentState,
      timestamp: args.timestamp,
    });
  },
});

/** Delete all alerts for the user (cleanup) */
export const clearAlerts = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) throw new Error("Authentication required");

    const alerts = await ctx.db
      .query("ruleAlertHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId as any))
      .collect();

    for (const alert of alerts) {
      await ctx.db.delete(alert._id);
    }
  },
});
