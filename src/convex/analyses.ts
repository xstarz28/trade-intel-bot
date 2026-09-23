import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUser } from "./lib/authUser";

/**
 * Resolve the current user from the auth identity.
 * Works for both email-based and anonymous/guest users.
 */

/**
 * Save an analysis to the user's history.
 * Phase 252 — preserve exact provider-native identity.
 */
export const save = mutation({
  args: {
    instrument: v.string(),
    instrumentType: v.string(),
    timeframe: v.string(),
    bias: v.string(),
    confidence: v.number(),
    recommendation: v.optional(v.string()), // LONG | SHORT | NO_TRADE
    conviction: v.optional(v.string()), // High | Medium | Low (trades only)
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
    provider: v.optional(v.string()),
    providerInstrumentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not found");

    return ctx.db.insert("analyses", {
      userId: user._id,
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
      provider: args.provider,
      providerInstrumentId: args.providerInstrumentId,
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
    const user = await resolveUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("analyses")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(20);
  },
});
