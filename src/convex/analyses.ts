import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";

const MAX_ANALYSIS_HISTORY = 100;

async function resolveUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  return await getAuthUserId(ctx);
}

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
    recommendation: v.optional(v.string()),
    conviction: v.optional(v.string()),
    noTradeReasons: v.optional(v.array(v.string())),
    riskReward: v.optional(v.number()),
    tradingStyle: v.optional(v.string()),
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
    price: v.optional(v.number()),
    dataSource: v.optional(v.string()),
    sentimentSummary: v.optional(v.string()),
    sentimentScore: v.optional(v.number()),
    macroSummary: v.optional(v.string()),
    derivativesSummary: v.optional(v.string()),
    calendarSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await resolveUser(ctx);
    if (!userId) throw new Error("User not found");

    const id = await ctx.db.insert("analyses", {
      userId,
      instrument: args.instrument,
      instrumentType: args.instrumentType,
      timeframe: args.timeframe,
      bias: args.bias,
      confidence: args.confidence,
      recommendation: args.recommendation,
      conviction: args.conviction,
      noTradeReasons: args.noTradeReasons,
      riskReward: args.riskReward,
      tradingStyle: args.tradingStyle,
      technicalSummary: args.technicalSummary,
      fundamentalSummary: args.fundamentalSummary,
      breakdown: args.breakdown,
      keyLevels: args.keyLevels,
      riskNote: args.riskNote,
      dataCompleteness: args.dataCompleteness,
      dataFlags: args.dataFlags,
      price: args.price,
      dataSource: args.dataSource,
      sentimentSummary: args.sentimentSummary,
      sentimentScore: args.sentimentScore,
      macroSummary: args.macroSummary,
      derivativesSummary: args.derivativesSummary,
      calendarSummary: args.calendarSummary,
      timestamp: Date.now(),
    });

    const history = await ctx.db
      .query("analyses")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_ANALYSIS_HISTORY + 1);
    for (const old of history.slice(MAX_ANALYSIS_HISTORY)) {
      await ctx.db.delete(old._id);
    }

    return id;
  },
});

/**
 * Get the user's analysis history, most recent first.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await resolveUser(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("analyses")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});
