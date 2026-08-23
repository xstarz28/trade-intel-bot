import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Resolve the current user from the auth identity.
 * Works for both email-based and anonymous/guest users.
 */
async function resolveUser(ctx: {
  auth: {
    getUserIdentity: () => Promise<{
      email?: string;
      subject: string;
    } | null>;
  };
  db: any;
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  // Try email lookup first (registered users)
  if (identity.email) {
    const byEmail = await ctx.db
      .query("users")
      .withIndex("email", (q: any) => q.eq("email", identity.email))
      .unique();
    if (byEmail) return byEmail;
  }

  // Fall back to subject lookup (anonymous / guest users)
  // In Convex Auth, identity.subject is the user's _id
  try {
    const byId = await ctx.db.get(identity.subject);
    return byId;
  } catch {
    return null;
  }
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
      .filter((q: any) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(20);
  },
});
