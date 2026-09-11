/**
 * Phase 169 — Server-authoritative entitlement enforcement.
 *
 * Every decision here is made on the server from the database row keyed by
 * the authenticated userId. Nothing trusts a client-supplied plan, counter or
 * flag, so the free allowance cannot be reset by reloading, clearing storage,
 * opening a private window, or calling the backend directly.
 *
 * The pure rules live in `src/lib/entitlement/entitlement.ts` and are unit
 * tested exhaustively; this module is the persistence and authorization shell
 * around them.
 */

import { v } from "convex/values";
import type { GenericQueryCtx, GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  nextUsageCount,
  type Plan,
} from "../lib/entitlement/entitlement";

// ═══════════════════════════════════════════════════════════════
// AUTH RESOLUTION
// ═══════════════════════════════════════════════════════════════

async function resolveUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const email = identity.email;
  if (email) {
    const byEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (byEmail) return byEmail;
  }

  try {
    return await ctx.db.get(identity.subject as Id<"users">);
  } catch {
    return null;
  }
}

/**
 * Read the caller's entitlement row, resolving the effective plan.
 *
 * An expired Premium period degrades to GUEST here rather than at write time,
 * so a lapsed subscription cannot keep unlimited access just because no
 * mutation happened to run.
 */
async function readEntitlement(ctx: Ctx, userId: Id<"users">, now: number) {
  const row = await ctx.db
    .query("entitlements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

  const storedPlan: Plan = row?.plan === "PREMIUM" ? "PREMIUM" : "GUEST";
  const expired =
    storedPlan === "PREMIUM" &&
    typeof row?.premiumUntil === "number" &&
    row.premiumUntil <= now;

  return {
    row,
    plan: (expired ? "GUEST" : storedPlan) as Plan,
    profitSignalsUsed: row?.profitSignalsUsed ?? 0,
    premiumUntil: row?.premiumUntil,
    expired,
  };
}

// ═══════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════

/**
 * Current entitlement for the signed-in caller.
 *
 * Read-only: it never creates a row and never mutates the counter, so simply
 * loading the UI cannot consume allowance.
 */
export const getMyEntitlement = query({
  args: {},
  handler: async (ctx) => {
    const user = await resolveUser(ctx);
    if (!user) {
      // Not signed in: report the guest shape without inventing an identity.
      return {
        authenticated: false,
        plan: "GUEST" as Plan,
        profitSignalsUsed: 0,
        remaining: FREE_PROFIT_SIGNAL_LIMIT,
        limit: FREE_PROFIT_SIGNAL_LIMIT,
        allowed: false,
        upgradeRequired: false,
        reason: "UNAUTHENTICATED" as const,
      };
    }

    const now = Date.now();
    const state = await readEntitlement(ctx, user._id, now);
    const decision = evaluateEntitlement({
      plan: state.plan,
      profitSignalsUsed: state.profitSignalsUsed,
    });

    return {
      authenticated: true,
      plan: state.plan,
      profitSignalsUsed: state.profitSignalsUsed,
      // Infinity is not JSON-serializable; report null for unlimited.
      remaining: state.plan === "PREMIUM" ? null : decision.remaining,
      limit: FREE_PROFIT_SIGNAL_LIMIT,
      allowed: decision.allowed,
      upgradeRequired: decision.upgradeRequired,
      reason: decision.reason,
      premiumUntil: state.premiumUntil ?? null,
    };
  },
});

// ═══════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * DEPRECATED (Phase 174) — SUPERSEDED by
 * `api.protectedAnalysis.runProtectedAnalysis`. Do not use for gating.
 *
 * ## Why this is not a security boundary
 *
 * This mutation trusts the CLIENT to report what the engine produced. When the
 * engine also ran on the client, that was bypassable in two trivial ways:
 *
 *   1. Report `"WAIT"` → `NOT_CHARGEABLE`, nothing consumed, yet the caller
 *      still holds the real LONG/SHORT it computed locally.
 *   2. Never call this at all → nothing consumed, result still in hand.
 *
 * Neither needs special tooling; the mutation is callable from the console.
 * The fix was architectural, not another check: the engine now runs server-side
 * in `protectedAnalysis.ts`, chargeability is derived from the engine's OWN
 * output, and the directional payload is never serialized to an unentitled
 * client. See `docs/PRODUCTION-VERIFICATION.md`.
 *
 * Retained only for the existing Phase 169/172 test-suites, which pin the
 * accounting rules. It must NOT be wired into any delivery path: an actionable
 * decision may only reach a user through the protected action above.
 */
export const consumeProfitSignal = mutation({
  args: {
    /** The recommendation the engine produced, verbatim. */
    recommendation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("Unauthenticated: sign in to run an analysis.");

    const now = Date.now();
    const state = await readEntitlement(ctx, user._id, now);

    const chargeable = isProfitSignal(args.recommendation);
    const decision = evaluateEntitlement({
      plan: state.plan,
      profitSignalsUsed: state.profitSignalsUsed,
    });

    // A non-chargeable result (WAIT / NO_TRADE / insufficient) is always
    // delivered and never consumes allowance.
    if (!chargeable) {
      return {
        allowed: true,
        charged: false,
        plan: state.plan,
        remaining: state.plan === "PREMIUM" ? null : decision.remaining,
        upgradeRequired: false,
        reason: "NOT_CHARGEABLE" as const,
      };
    }

    if (!decision.allowed) {
      return {
        allowed: false,
        charged: false,
        plan: state.plan,
        remaining: 0,
        upgradeRequired: true,
        reason: decision.reason,
      };
    }

    const updated = nextUsageCount(
      { plan: state.plan, profitSignalsUsed: state.profitSignalsUsed },
      args.recommendation,
    );

    if (state.row) {
      await ctx.db.patch(state.row._id, {
        profitSignalsUsed: updated,
        // Persist the degraded plan so an expired subscription is not
        // re-evaluated as PREMIUM on every read.
        plan: state.plan,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("entitlements", {
        userId: user._id,
        plan: state.plan,
        profitSignalsUsed: updated,
        updatedAt: now,
      });
    }

    const after = evaluateEntitlement({
      plan: state.plan,
      profitSignalsUsed: updated,
    });

    return {
      allowed: true,
      charged: state.plan !== "PREMIUM",
      plan: state.plan,
      remaining: state.plan === "PREMIUM" ? null : after.remaining,
      upgradeRequired: false,
      reason: "CONSUMED" as const,
    };
  },
});

/**
 * Grant Premium to the signed-in user.
 *
 * NOTE: this is the entitlement half only. It must be called from a verified
 * payment webhook or an admin path once billing exists — it is intentionally
 * NOT wired to a client "upgrade" button, because a client-callable grant
 * would make Premium free. Until billing is integrated this stays unused by
 * the UI; see docs/PRODUCTION-VERIFICATION.md.
 */
export const grantPremium = mutation({
  args: {
    /** End of the paid period, as an epoch ms timestamp. */
    premiumUntil: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await resolveUser(ctx);
    if (!user) throw new Error("Unauthenticated.");

    // Only an admin may grant entitlement from inside the app. Payment-driven
    // grants must come through a server-verified path, not a client call.
    if (user.role !== "admin") {
      throw new Error("Not permitted: entitlement changes require verification.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        plan: "PREMIUM",
        premiumUntil: args.premiumUntil,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("entitlements", {
      userId: user._id,
      plan: "PREMIUM",
      profitSignalsUsed: 0,
      premiumUntil: args.premiumUntil,
      updatedAt: now,
    });
  },
});
