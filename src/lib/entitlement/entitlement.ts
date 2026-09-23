/**
 * Phase 169 — Entitlement model (pure logic).
 *
 * Product rule: a guest may consume a small, fixed number of *profit signals*
 * (analyses that produce an actionable BUY/SELL recommendation). After that
 * the product requires Premium. A guest must never become permanent free
 * access.
 *
 * Design constraints this module exists to satisfy:
 *
 *  - **Server-authoritative.** The counter lives in the database keyed by
 *    userId. Nothing here reads localStorage, cookies or any client value, so
 *    a reload, a storage reset, a private window or a second client cannot
 *    resurrect a consumed quota.
 *  - **Only actionable signals are charged.** WAIT / NO_TRADE / insufficient
 *    evidence must stay free, otherwise the pricing model would quietly push
 *    the engine toward manufacturing recommendations — exactly the behaviour
 *    the analysis integrity rules forbid.
 *  - **Fail closed on ambiguity, open on absence of a decision.** An unknown
 *    recommendation string is not treated as a profit signal (it is not
 *    evidence of one), but an exhausted quota is always enforced.
 *
 * This file is intentionally free of Convex imports so the rules can be
 * tested exhaustively without a database.
 */

/** Persisted on the `entitlements` row. OWNER is never stored. */
export type StoredPlan = "GUEST" | "PREMIUM";

/**
 * Effective plan for this request.
 *
 * OWNER is a server-side overlay from an authenticated principal. It is not
 * a client flag, not `users.role`, and not a value written to the entitlements
 * table.
 */
export type Plan = StoredPlan | "OWNER";

/** Number of free profit signals a guest may consume, in total, ever. */
export const FREE_PROFIT_SIGNAL_LIMIT = 2;

/**
 * Recommendation values that represent an actionable profit signal.
 *
 * Deliberately an allowlist: a value we do not recognise is NOT charged.
 */
const ACTIONABLE = new Set(["BUY", "SELL", "LONG", "SHORT"]);

/**
 * Values that explicitly represent "no actionable trade". Listed for clarity
 * and so a rename upstream surfaces here as a test failure rather than
 * silently starting to bill users.
 */
const NON_ACTIONABLE = new Set([
  "WAIT",
  "NO_TRADE",
  "NO TRADE",
  "HOLD",
  "AVOID",
  "INSUFFICIENT_DATA",
  "UNAVAILABLE",
]);

/**
 * Does this recommendation consume a free profit signal?
 *
 * Only a clearly actionable direction counts. Anything else — including
 * undefined, empty, or an unrecognised future value — is free.
 */
export function isProfitSignal(recommendation: string | null | undefined): boolean {
  if (typeof recommendation !== "string") return false;
  const normalized = recommendation.trim().toUpperCase();
  if (normalized.length === 0) return false;
  if (NON_ACTIONABLE.has(normalized)) return false;
  return ACTIONABLE.has(normalized);
}

export interface EntitlementState {
  plan: Plan;
  /** Profit signals consumed so far. Never decremented by client action. */
  profitSignalsUsed: number;
}

export interface EntitlementDecision {
  /** May the caller receive an actionable profit signal right now? */
  allowed: boolean;
  /** Remaining free profit signals (0 for an exhausted guest). */
  remaining: number;
  /** Machine-readable reason, for UI copy and for tests. */
  reason:
    | "PREMIUM"
    | "OWNER"
    | "WITHIN_FREE_ALLOWANCE"
    | "FREE_ALLOWANCE_EXHAUSTED";
  /** True when the UI should present the upgrade path. */
  upgradeRequired: boolean;
}

/** PREMIUM and OWNER never consume the free counter. */
export function isUnlimitedPlan(plan: Plan): boolean {
  return plan === "PREMIUM" || plan === "OWNER";
}

/** OWNER is an overlay. The stored row stays GUEST or PREMIUM. */
export function overlayOwnerPlan(plan: StoredPlan, isOwner: boolean): Plan {
  return isOwner ? "OWNER" : plan;
}

export function storedPlanFrom(plan: string | undefined): StoredPlan {
  return plan === "PREMIUM" ? "PREMIUM" : "GUEST";
}

/** Clamp a possibly-corrupt stored counter into a sane range. */
function safeUsed(used: number | null | undefined): number {
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return 0;
  return Math.floor(used);
}

/**
 * Decide whether an actionable profit signal may be delivered.
 *
 * Premium and OWNER are unlimited. A guest is allowed strictly fewer than
 * FREE_PROFIT_SIGNAL_LIMIT consumptions.
 */
export function evaluateEntitlement(
  state: EntitlementState,
): EntitlementDecision {
  if (isUnlimitedPlan(state.plan)) {
    return {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      reason: state.plan === "OWNER" ? "OWNER" : "PREMIUM",
      upgradeRequired: false,
    };
  }

  const used = safeUsed(state.profitSignalsUsed);
  const remaining = Math.max(0, FREE_PROFIT_SIGNAL_LIMIT - used);

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      reason: "FREE_ALLOWANCE_EXHAUSTED",
      upgradeRequired: true,
    };
  }

  return {
    allowed: true,
    remaining,
    reason: "WITHIN_FREE_ALLOWANCE",
    upgradeRequired: false,
  };
}

/**
 * Next counter value after delivering a result.
 *
 * Only actionable signals increment, and only for guests. This is pure so the
 * caller (a Convex mutation) can persist it atomically.
 */
export function nextUsageCount(
  state: EntitlementState,
  recommendation: string | null | undefined,
): number {
  const used = safeUsed(state.profitSignalsUsed);
  if (isUnlimitedPlan(state.plan)) return used;
  if (!isProfitSignal(recommendation)) return used;
  // Never exceed the limit in storage, so a race cannot inflate the number
  // into something the UI would render oddly.
  return Math.min(used + 1, FREE_PROFIT_SIGNAL_LIMIT);
}

/**
 * Redact an actionable recommendation the caller is not entitled to.
 *
 * The analysis still runs and non-actionable context is preserved — the user
 * is told a signal exists and how to unlock it, rather than being shown a
 * fabricated WAIT. Presenting a locked BUY as a WAIT would corrupt the
 * decision record.
 */
export interface LockedSignal {
  locked: true;
  reason: "FREE_ALLOWANCE_EXHAUSTED";
  upgradeRequired: true;
}

export function lockSignal(): LockedSignal {
  return {
    locked: true,
    reason: "FREE_ALLOWANCE_EXHAUSTED",
    upgradeRequired: true,
  };
}
