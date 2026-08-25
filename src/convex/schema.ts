import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Trading analysis history
    analyses: defineTable({
      userId: v.id("users"),
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
      // Intelligence layer (Alpha Vantage)
      sentimentSummary: v.optional(v.string()),
      sentimentScore: v.optional(v.number()),
      macroSummary: v.optional(v.string()),
      derivativesSummary: v.optional(v.string()),
      calendarSummary: v.optional(v.string()),
      timestamp: v.number(),
    }).index("by_user", ["userId", "timestamp"]),

    // Phase 31 — Trade journal entries
    journal: defineTable({
      userId: v.id("users"),
      instrument: v.string(),
      instrumentType: v.string(),
      timeframe: v.string(),
      style: v.string(),
      // Immutable analysis snapshot
      analysisSnapshot: v.object({
        analysisId: v.string(),
        decision: v.string(),
        bias: v.string(),
        conviction: v.optional(v.string()),
        confidence: v.number(),
        scenario: v.optional(v.string()),
        marketRegime: v.optional(v.string()),
        marketPhase: v.optional(v.string()),
        continuationQuality: v.optional(v.string()),
        fundamentalAlignment: v.optional(v.string()),
        actionability: v.optional(v.string()),
        forwardPrimaryPath: v.optional(v.string()),
        forwardAlternatePath: v.optional(v.string()),
        keyLevels: v.optional(v.object({
          support: v.string(),
          resistance: v.string(),
          invalidation: v.string(),
        })),
        technicalSummary: v.string(),
        fundamentalSummary: v.string(),
        dataCompleteness: v.string(),
        decisionFingerprint: v.optional(v.string()),
      }),
      // Mutable trade info
      status: v.string(),
      entry: v.optional(v.number()),
      stopLoss: v.optional(v.number()),
      takeProfit: v.optional(v.number()),
      riskReward: v.optional(v.number()),
      positionSize: v.optional(v.number()),
      notionalValue: v.optional(v.number()),
      // Outcome
      exitPrice: v.optional(v.number()),
      pnl: v.optional(v.number()),
      pnlPercent: v.optional(v.number()),
      outcome: v.optional(v.string()),
      closedAt: v.optional(v.number()),
      // Review
      entryReason: v.optional(v.string()),
      thesisAtEntry: v.optional(v.string()),
      confirmationObserved: v.optional(v.string()),
      invalidationObserved: v.optional(v.string()),
      whatWentRight: v.optional(v.string()),
      whatWentWrong: v.optional(v.string()),
      lessons: v.optional(v.string()),
      notes: v.optional(v.string()),
      timestamps: v.object({
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    }).index("by_user_journal", ["userId", "timestamps"]) // userId + createdAt
      .index("by_instrument", ["userId", "instrument"]) // filter by instrument
      .index("by_status", ["userId", "status"]) // filter by status
  },
  {
    schemaValidation: false,
  },
);

export default schema;
