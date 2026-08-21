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
      timestamp: v.number(),
    }).index("by_user", ["userId", "timestamp"])
  },
  {
    schemaValidation: false,
  },
);

export default schema;
