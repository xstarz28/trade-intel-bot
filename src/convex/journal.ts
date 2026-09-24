/**
 * Phase 31 — CONVEX JOURNAL mutations & queries.
 *
 * Server-side journal persistence using the existing auth model.
 * Journal records are user-scoped. Analysis snapshots are immutable.
 * Never trust client-provided ownership fields.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveUser } from "./lib/authUser";
import type { Doc } from "./_generated/dataModel";


// ── Create ───────────────────────────────────────────────────────
// Phase 262 — adds provider-native identity preservation

export const create = mutation({
  args: {
    instrument: v.string(),
    instrumentType: v.string(),
    timeframe: v.string(),
    style: v.string(),
    provider: v.optional(v.string()),
    providerInstrumentId: v.optional(v.string()),
    assetClass: v.optional(v.string()),
    title: v.optional(v.string()),
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
    status: v.optional(v.string()),
    entry: v.optional(v.number()),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    riskReward: v.optional(v.number()),
    positionSize: v.optional(v.number()),
    notionalValue: v.optional(v.number()),
    entryReason: v.optional(v.string()),
    thesisAtEntry: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    const now = Date.now();
    const status = args.status ?? "PLANNED";

    // Validate initial status
    if (!["PLANNED", "WAITING", "NO_TRADE"].includes(status)) {
      throw new Error(`Invalid initial status: ${status}`);
    }

    return ctx.db.insert("journal", {
      userId: user._id,
      instrument: args.instrument,
      instrumentType: args.instrumentType,
      timeframe: args.timeframe,
      style: args.style,
      provider: args.provider,
      providerInstrumentId: args.providerInstrumentId,
      assetClass: args.assetClass,
      title: args.title,
      analysisSnapshot: args.analysisSnapshot,
      status,
      entry: args.entry,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      riskReward: args.riskReward,
      positionSize: args.positionSize,
      notionalValue: args.notionalValue,
      entryReason: args.entryReason,
      thesisAtEntry: args.thesisAtEntry,
      notes: args.notes,
      timestamps: { createdAt: now, updatedAt: now },
    });
  },
});

// ── Update Status (Lifecycle) ────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  PLANNED: ["OPEN", "CANCELLED", "INVALIDATED"],
  OPEN: ["CLOSED", "INVALIDATED"],
  WAITING: ["PLANNED", "CANCELLED"],
};

export const transition = mutation({
  args: {
    journalId: v.id("journal"),
    newStatus: v.string(),
    exitPrice: v.optional(v.number()),
    pnl: v.optional(v.number()),
    pnlPercent: v.optional(v.number()),
    outcome: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    const entry = await ctx.db.get(args.journalId);
    if (!entry) throw new Error("Journal entry not found");
    if (entry.userId !== user._id) throw new Error("Not authorized");

    const allowed = VALID_TRANSITIONS[entry.status] ?? [];
    if (!allowed.includes(args.newStatus)) {
      throw new Error(`Invalid transition: ${entry.status} → ${args.newStatus}`);
    }

    const now = Date.now();
    // Phase 227 — typed patch. `db.patch` has no dotted-path semantics; the
    // previous dotted-key write (hidden behind an untyped record) created a
    // literal top-level field and never updated the nested updatedAt.
    const update: Partial<Doc<"journal">> = {
      status: args.newStatus,
      timestamps: { ...entry.timestamps, updatedAt: now },
    };

    if (args.newStatus === "CLOSED") {
      update.closedAt = now;
      if (args.exitPrice !== undefined) update.exitPrice = args.exitPrice;
      if (args.pnl !== undefined) update.pnl = args.pnl;
      if (args.pnlPercent !== undefined) update.pnlPercent = args.pnlPercent;
      if (args.outcome !== undefined) update.outcome = args.outcome;
    }

    await ctx.db.patch(args.journalId, update);
    return args.journalId;
  },
});

// ── Update Fields ────────────────────────────────────────────────

export const updateFields = mutation({
  args: {
    journalId: v.id("journal"),
    entry: v.optional(v.number()),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    riskReward: v.optional(v.number()),
    positionSize: v.optional(v.number()),
    notionalValue: v.optional(v.number()),
    entryReason: v.optional(v.string()),
    thesisAtEntry: v.optional(v.string()),
    confirmationObserved: v.optional(v.string()),
    invalidationObserved: v.optional(v.string()),
    whatWentRight: v.optional(v.string()),
    whatWentWrong: v.optional(v.string()),
    lessons: v.optional(v.string()),
    notes: v.optional(v.string()),
    title: v.optional(v.string()),
    provider: v.optional(v.string()),
    providerInstrumentId: v.optional(v.string()),
    assetClass: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    const entry = await ctx.db.get(args.journalId);
    if (!entry) throw new Error("Journal entry not found");
    if (entry.userId !== user._id) throw new Error("Not authorized");

    const { journalId: _journalId, ...fields } = args;
    // Only include defined fields. `fields` is exactly the validated optional
    // journal columns, so the filtered object is a Partial<Doc<"journal">>
    // by construction — no string-keyed bag.
    const defined = Object.fromEntries(
      Object.entries(fields).filter(([, val]) => val !== undefined),
    ) as Partial<typeof fields>;
    const update: Partial<Doc<"journal">> = {
      ...defined,
      timestamps: { ...entry.timestamps, updatedAt: Date.now() },
    };

    await ctx.db.patch(args.journalId, update);
    return args.journalId;
  },
});

// ── Delete ───────────────────────────────────────────────────────

export const remove = mutation({
  args: { journalId: v.id("journal") },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("User not authenticated");

    const entry = await ctx.db.get(args.journalId);
    if (!entry) throw new Error("Journal entry not found");
    if (entry.userId !== user._id) throw new Error("Not authorized");

    await ctx.db.delete(args.journalId);
  },
});

// ── Queries ──────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("journal")
      .withIndex("by_user_journal", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);
  },
});

export const getByInstrument = query({
  args: { instrument: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("journal")
      .withIndex("by_instrument", (q) =>
        q.eq("userId", user._id).eq("instrument", args.instrument)
      )
      .order("desc")
      .take(50);
  },
});

export const getByStatus = query({
  args: { status: v.string() },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("journal")
      .withIndex("by_status", (q) =>
        q.eq("userId", user._id).eq("status", args.status)
      )
      .order("desc")
      .take(50);
  },
});

export const get = query({
  args: { journalId: v.id("journal") },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) return null;

    const entry = await ctx.db.get(args.journalId);
    if (!entry || entry.userId !== user._id) return null;
    return entry;
  },
});
