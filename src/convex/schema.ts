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
      // Phase 252 — preserve exact provider-native identity
      provider: v.optional(v.string()),
      providerInstrumentId: v.optional(v.string()),
    }).index("by_user", ["userId", "timestamp"]),

    // Phase 31 — Trade journal entries — Phase 262 adds provider-native identity
    journal: defineTable({
      userId: v.id("users"),
      instrument: v.string(),
      instrumentType: v.string(),
      timeframe: v.string(),
      style: v.string(),
      // Phase 262 — preserve provider-native identity for distinguishable references
      provider: v.optional(v.string()),
      providerInstrumentId: v.optional(v.string()),
      assetClass: v.optional(v.string()),
      title: v.optional(v.string()),
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
      .index("by_status", ["userId", "status"]),

    // Phase 60 — Monitored positions for profit protection
    monitoredPositions: defineTable({
      userId: v.id("users"),
      positionId: v.string(),
      instrument: v.string(),
      side: v.string(), // LONG | SHORT
      entryPrice: v.number(),
      stopLoss: v.optional(v.number()),
      takeProfit: v.optional(v.number()),
      leverage: v.optional(v.number()),
      horizon: v.string(), // SCALPING | INTRADAY | SWING | INVESTING
      openedAt: v.number(),
      peakPrice: v.optional(v.number()),
      peakProfit: v.optional(v.number()),
      currentSeverity: v.string(), // NONE | WATCH | CAUTION | HIGH_RISK | INVALIDATED
      lifecycleState: v.string(), // MONITORING | WATCH | CAUTION | HIGH_RISK | INVALIDATED | RECOVERED
      monitoringLifecycle: v.string(), // REGISTERED | MONITORING | PAUSED | CLOSED
      lastUpdateAt: v.number(),
      lastAlertAt: v.number(),
      consecutiveSameSeverity: v.number(),
    })
      .index("by_user_position", ["userId", "positionId"])
      .index("by_user_instrument", ["userId", "instrument"])
      .index("by_user_lifecycle", ["userId", "monitoringLifecycle"]),

    // Phase 60 — Alert history for position protection
    alertHistory: defineTable({
      userId: v.id("users"),
      alertId: v.string(),
      positionId: v.string(),
      instrument: v.string(),
      severity: v.string(), // NONE | WATCH | CAUTION | HIGH_RISK | INVALIDATED
      notificationPriority: v.string(), // INFO | WARNING | URGENT | CRITICAL
      reason: v.string(),
      action: v.string(),
      timestamp: v.number(),
      acknowledged: v.boolean(),
    })
      .index("by_user_alerts", ["userId", "timestamp"])
      .index("by_user_position_alerts", ["userId", "positionId", "timestamp"]),

    // Phase 60 — Stream event cursors for reconciliation
    streamCursors: defineTable({
      userId: v.id("users"),
      provider: v.string(),
      instrument: v.string(),
      lastEventId: v.string(),
      lastTimestamp: v.number(),
      lastSequence: v.optional(v.number()),
    })
      // User-scoped lookup. The cursor rows carry a userId, so the index must
      // include it — otherwise a provider/instrument lookup can return another
      // user's row.
      .index("by_user_provider_instrument", ["userId", "provider", "instrument"])
      .index("by_provider_instrument", ["provider", "instrument"]),

    // Phase 90 — Historical intelligence snapshots
    historicalSnapshots: defineTable({
      userId: v.id("users"),
      positionId: v.string(),
      instrument: v.string(),
      side: v.string(),
      timestamp: v.number(),
      thesisState: v.string(),
      evidenceQuality: v.string(),
      marketRegime: v.string(),
      h1Trend: v.string(),
      m15Trend: v.string(),
      m5Trend: v.string(),
      mtfAlignment: v.string(),
      momentum: v.string(),
      volatility: v.string(),
      structure: v.string(),
      supportingCount: v.number(),
      conflictingCount: v.number(),
      invalidationCondition: v.string(),
      watchNext: v.string(),
      dataAvailability: v.string(),
    })
      .index("by_user_position", ["userId", "positionId"])
      .index("by_user_position_ts", ["userId", "positionId", "timestamp"]),

    // Phase 93 — Custom alert rules
    alertRules: defineTable({
      userId: v.id("users"),
      ruleId: v.string(),
      name: v.string(),
      enabled: v.boolean(),
      scope: v.string(), // POSITION | INSTRUMENT | PORTFOLIO | GLOBAL
      instrument: v.optional(v.string()),
      positionId: v.optional(v.string()),
      condition: v.string(),
      severity: v.string(), // INFO | LOW | MEDIUM | HIGH | CRITICAL
      cooldownMs: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_rule", ["userId", "ruleId"]),

    // Phase 93 — Custom rule alert history
    ruleAlertHistory: defineTable({
      userId: v.id("users"),
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
    })
      .index("by_user", ["userId", "timestamp"])
      .index("by_user_rule", ["userId", "ruleId", "timestamp"]),

    // Phase 94 — Intelligence notifications
    notifications: defineTable({
      userId: v.id("users"),
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
      read: v.boolean(),
      dismissed: v.boolean(),
      source: v.string(),
      condition: v.string(),
    })
      .index("by_user", ["userId", "timestamp"])
      .index("by_user_read", ["userId", "read", "timestamp"])
      .index("by_user_notif", ["userId", "notificationId"]),

    // Phase 98 — Notification preferences
    notificationPreferences: defineTable({
      userId: v.id("users"),
      minimumSeverity: v.string(),
      enabledCategories: v.array(v.string()),
      enabledScopes: v.array(v.string()),
      mutedRuleIds: v.array(v.string()),
      enabledInstruments: v.array(v.string()),
      mutedInstruments: v.array(v.string()),
      showReadNotifications: v.boolean(),
      showDismissedNotifications: v.boolean(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"]),

    // Phase 90 — Historical intelligence events
    historicalEvents: defineTable({
      userId: v.id("users"),
      positionId: v.string(),
      instrument: v.string(),
      side: v.string(),
      timestamp: v.number(),
      eventType: v.string(),
      description: v.string(),
      previousState: v.string(),
      currentState: v.string(),
      category: v.string(),
      strength: v.string(),
    })
      .index("by_user_position", ["userId", "positionId"])
      .index("by_user_position_ts", ["userId", "positionId", "timestamp"]),

    // Phase 99 — Runtime health snapshots
    runtimeHealthSnapshots: defineTable({
      userId: v.id("users"),
      timestamp: v.number(),
      overallStatus: v.string(),
      components: v.array(v.object({
        component: v.string(),
        status: v.string(),
        lastSuccessAt: v.optional(v.number()),
        lastFailureAt: v.optional(v.number()),
        lastAttemptAt: v.optional(v.number()),
        consecutiveFailures: v.number(),
        message: v.string(),
        source: v.optional(v.string()),
        dataAgeMs: v.optional(v.number()),
        freshness: v.string(),
      })),
      intelligenceCycleStatus: v.string(),
      alertPipelineStatus: v.string(),
      persistenceStatus: v.string(),
      providerAvailability: v.record(v.string(), v.string()),
      staleComponents: v.array(v.string()),
      unavailableComponents: v.array(v.string()),
    })
      .index("by_user", ["userId", "timestamp"]),

    // Phase 169 — Commercial entitlement.
    //
    // Server-authoritative. The free-signal counter MUST live here rather
    // than in localStorage: a client-side counter is reset by a reload, a
    // private window, clearing storage, or simply calling the backend
    // directly, which would make the free tier effectively unlimited.
    //
    // One row per user, created lazily on first use.
    entitlements: defineTable({
      userId: v.id("users"),
      /** "GUEST" | "PREMIUM" — resolved server-side, never sent by the client. */
      plan: v.string(),
      /** Actionable profit signals consumed. Monotonic; never decremented. */
      profitSignalsUsed: v.number(),
      /** When the current Premium period ends, if any. */
      premiumUntil: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    /**
     * Phase 187 — durable OTP resend limiting.
     *
     * Authoritative across every Convex instance, which the previous
     * in-memory Map could not be. Written by exactly one mutation
     * (`otpLimiter.consumeResendAllowance`) so check-and-record stay atomic.
     *
     * Stores a SHA-256 hash of the normalised email, never the address.
     */
    otpResendBuckets: defineTable({
      /** SHA-256 hex of the normalised identifier. */
      identityHash: v.string(),
      /** Send times inside the rolling window; pruned on every read. */
      sendTimestamps: v.array(v.number()),
      /** Most recent send, used for retention/cleanup. */
      lastSendAt: v.number(),
    }).index("by_identity", ["identityHash"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
