/**
 * Phase 174 — the protected decision-delivery boundary.
 *
 * ## The vulnerability this closes
 *
 * Phase 169 made the entitlement *counter* server-authoritative. It did not
 * make the *decision* server-authoritative, and that distinction was the
 * whole hole:
 *
 *   1. `runAnalysis()` ran in the browser. The directional decision existed
 *      client-side the moment it was computed — before any mutation ran.
 *   2. `consumeProfitSignal({ recommendation })` trusted the client to report
 *      what the engine produced.
 *
 * So a caller could report `"WAIT"` (→ `NOT_CHARGEABLE`, nothing consumed) and
 * still hold the LONG, or simply never call the mutation. This required no
 * special tooling: the mutation is callable from the browser console, and the
 * engine's logic ships in the bundle.
 *
 * Adding another client-side check would have been theatre. The only real fix
 * is to stop producing the protected payload on the client:
 *
 *   client sends INPUTS  →  server runs the engine  →  server reads its OWN
 *   entitlement row  →  server decides  →  either the full result or a locked
 *   stub crosses the wire.
 *
 * The directional recommendation, trade plan and sizing for an exhausted guest
 * are therefore never serialized to that client at all. There is nothing in
 * the response to un-hide, and nothing in devtools to read.
 *
 * ## Why an action + internal mutation
 *
 * The engine calls `Date.now()`, so it is not deterministic and cannot run
 * inside a Convex mutation's sandbox. It runs in an **action**; the counter is
 * incremented by an **internal mutation**, which keeps the read-modify-write
 * atomic under Convex's serializable OCC. The internal mutation is not part of
 * the public API surface, so it is not callable by a client.
 *
 * ## Ordering
 *
 * Entitlement is consumed *before* the result is returned. If the consume step
 * fails, nothing is delivered — the boundary fails closed.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { runAnalysis } from "@/lib/analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import {
  gateDecision,
  type LockedDecisionPayload,
} from "@/lib/entitlement/decision-gate";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  evaluateEntitlement,
  isProfitSignal,
  nextUsageCount,
  type Plan,
} from "@/lib/entitlement/entitlement";

// ═══════════════════════════════════════════════════════════════
// INTERNAL: atomic entitlement resolution + consumption
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve the caller's plan and, when the decision is actionable and allowed,
 * consume exactly one unit — atomically.
 *
 * `chargeable` is computed by the *caller in this file* from the engine's own
 * output. It is never accepted from outside Convex: this is an
 * `internalMutation`, absent from the public `api` object.
 *
 * Returns the entitlement verdict; the action decides what to deliver.
 */
/** Entitlement verdict produced by {@link resolveAndConsume}. */
export interface ConsumeVerdict {
  plan: Plan;
  allowed: boolean;
  charged: boolean;
  remaining: number | null;
  upgradeRequired: boolean;
  reason:
    | "NOT_CHARGEABLE"
    | "CONSUMED"
    | "PREMIUM"
    | "WITHIN_FREE_ALLOWANCE"
    | "FREE_ALLOWANCE_EXHAUSTED";
}

export const resolveAndConsume = internalMutation({
  args: {
    userId: v.id("users"),
    /** Derived server-side from the engine result. Not a client assertion. */
    chargeable: v.boolean(),
  },
  handler: async (ctx, args): Promise<ConsumeVerdict> => {
    const now = Date.now();

    const row = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    const storedPlan: Plan = row?.plan === "PREMIUM" ? "PREMIUM" : "GUEST";
    const expired =
      storedPlan === "PREMIUM" &&
      typeof row?.premiumUntil === "number" &&
      row.premiumUntil <= now;
    const plan: Plan = expired ? "GUEST" : storedPlan;
    const used = row?.profitSignalsUsed ?? 0;

    const decision = evaluateEntitlement({ plan, profitSignalsUsed: used });

    // Non-chargeable output never touches the counter.
    if (!args.chargeable) {
      return {
        plan,
        allowed: true,
        charged: false,
        remaining: plan === "PREMIUM" ? null : decision.remaining,
        upgradeRequired: false,
        reason: "NOT_CHARGEABLE" as const,
      };
    }

    if (!decision.allowed) {
      // Persist a degraded plan so an expired subscription is not re-evaluated
      // as PREMIUM forever, even though nothing is consumed here.
      if (row && expired) {
        await ctx.db.patch(row._id, { plan, updatedAt: now });
      }
      return {
        plan,
        allowed: false,
        charged: false,
        remaining: 0,
        upgradeRequired: true,
        reason: decision.reason,
      };
    }

    const updated = nextUsageCount({ plan, profitSignalsUsed: used }, "LONG");

    if (row) {
      await ctx.db.patch(row._id, {
        profitSignalsUsed: updated,
        plan,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("entitlements", {
        userId: args.userId,
        plan,
        profitSignalsUsed: updated,
        updatedAt: now,
      });
    }

    const after = evaluateEntitlement({ plan, profitSignalsUsed: updated });

    return {
      plan,
      allowed: true,
      charged: plan !== "PREMIUM",
      remaining: plan === "PREMIUM" ? null : after.remaining,
      upgradeRequired: false,
      reason: "CONSUMED" as const,
    };
  },
});

/** Resolve the signed-in user id, or null. Mirrors entitlements.ts. */
export const resolveCallerId = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users"> | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const email = identity.email;
    if (email) {
      const byEmail = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (byEmail) return byEmail._id;
    }

    try {
      const byId = await ctx.db.get(identity.subject as Id<"users">);
      return byId?._id ?? null;
    } catch {
      return null;
    }
  },
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC: run an analysis behind the entitlement boundary
// ═══════════════════════════════════════════════════════════════

/**
 * Run the decision engine server-side and return only what the caller is
 * entitled to receive.
 *
 * The client supplies *inputs* (instrument, timeframe, market data). It does
 * not supply — and cannot influence — the recommendation, the chargeability
 * determination, the plan, or the remaining allowance.
 */
/** Response shape of {@link runProtectedAnalysis}. */
export interface ProtectedAnalysisResponse {
  status: "UNAUTHENTICATED" | "DELIVERED" | "LOCKED";
  entitlement: {
    authenticated: boolean;
    plan: Plan;
    remaining: number | null;
    limit: number;
    upgradeRequired: boolean;
    charged?: boolean;
    reason?: string;
  };
  result: Record<string, unknown> | LockedDecisionPayload | null;
}

export const runProtectedAnalysis = action({
  args: {
    /**
     * Analysis inputs. Typed as `any` at the Convex boundary because
     * `AnalysisInput` is a large structural type with many optional provider
     * payloads; it is validated by the engine itself, which degrades
     * explicitly on missing data rather than fabricating it.
     */
    input: v.any(),
  },
  handler: async (ctx, args): Promise<ProtectedAnalysisResponse> => {
    const userId: Id<"users"> | null = await ctx.runMutation(
      internal.protectedAnalysis.resolveCallerId,
      {},
    );

    if (!userId) {
      // Fail closed. No engine run, no payload.
      return {
        status: "UNAUTHENTICATED" as const,
        entitlement: {
          authenticated: false,
          plan: "GUEST" as Plan,
          remaining: FREE_PROFIT_SIGNAL_LIMIT,
          limit: FREE_PROFIT_SIGNAL_LIMIT,
          upgradeRequired: false,
        },
        result: null,
      };
    }

    // 1. Run the engine on the SERVER. This is the only place the directional
    //    decision is produced for a delivery path.
    const engineResult = runAnalysis(args.input as AnalysisInput) as unknown as Record<
      string,
      unknown
    >;

    // 2. Chargeability comes from the engine's own output.
    const chargeable = isProfitSignal(
      typeof engineResult.recommendation === "string"
        ? engineResult.recommendation
        : undefined,
    );

    // 3. Consume atomically BEFORE delivering anything.
    const verdict: ConsumeVerdict = await ctx.runMutation(
      internal.protectedAnalysis.resolveAndConsume,
      { userId, chargeable },
    );

    // 4. Redact if not entitled.
    const gated = gateDecision({
      result: engineResult,
      entitlement: { allowed: verdict.allowed },
    });

    return {
      status: gated.status,
      entitlement: {
        authenticated: true,
        plan: verdict.plan,
        remaining: verdict.remaining,
        limit: FREE_PROFIT_SIGNAL_LIMIT,
        upgradeRequired: verdict.upgradeRequired,
        charged: verdict.charged,
        reason: verdict.reason,
      },
      result: gated.result,
    };
  },
});
