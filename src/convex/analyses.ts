import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Save an analysis to the user's history.
 */
export const save = mutation({
  args: {
    instrument: v.string(),
    instrumentType: v.string(),
    timeframe: v.string(),
    bias: v.string(),
    confidence: v.number(),
    technicalSummary: v.string(),
    fundamentalSummary: v.string(),
    breakdown: v.object({
      trend: v.number(),
      indicator: v.number(),
      fundamental: v.number(),
      sentiment: v.number(),
    }),
    keyLevels: v.object({
      support: v.string(),
      resistance: v.string(),
      invalidation: v.string(),
    }),
    riskNote: v.string(),
    dataCompleteness: v.string(),
    dataFlags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", identity.email))
      .unique();

    if (!user) throw new Error("User not found");

    return ctx.db.insert("analyses", {
      userId: user._id,
      instrument: args.instrument,
      instrumentType: args.instrumentType,
      timeframe: args.timeframe,
      bias: args.bias,
      confidence: args.confidence,
      technicalSummary: args.technicalSummary,
      fundamentalSummary: args.fundamentalSummary,
      breakdown: args.breakdown,
      keyLevels: args.keyLevels,
      riskNote: args.riskNote,
      dataCompleteness: args.dataCompleteness,
      dataFlags: args.dataFlags,
      timestamp: Date.now(),
    });
  },
});

/**
 * Get the user's analysis history, most recent first.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", identity.email))
      .unique();

    if (!user) return [];

    return await ctx.db
      .query("analyses")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(20);
  },
});
