/**
 * Phase 187 — durable, distributed OTP resend limiting.
 *
 * ## Why this replaces the in-memory limiter
 *
 * Phase 185 shipped a `Map` in module scope. That bounds abuse *per action
 * instance*. Convex runs many instances, so an attacker whose requests land
 * on different instances gets a fresh allowance from each one — the counters
 * never meet. This module moves the authoritative state into the database,
 * where every instance observes the same row.
 *
 * ## Why a table rather than a rate-limiter component
 *
 * `@convex-dev/rate-limiter` would be the idiomatic choice, but installing a
 * component requires `convex.config.ts` plus a codegen run against a real
 * deployment, and the control plane is unreachable from this environment
 * (Phase 186). A single table needs no codegen: `dataModel.d.ts` derives its
 * types from `schema.ts` directly. This is the smallest mechanism that is
 * actually available, and it is swappable later without touching call sites.
 *
 * ## Atomicity — the entire point of this module
 *
 * Convex mutations are serializable transactions with optimistic concurrency
 * control. Two concurrent `consumeResendAllowance` calls for the same
 * identity conflict on the same row; one commits, the other is retried at a
 * fresh timestamp and then *observes the committed write*. So the check and
 * the record happen in one indivisible step.
 *
 * This only holds because check-and-record live in ONE mutation. A `check`
 * query followed by a separate `record` mutation would reintroduce exactly
 * the double-spend this phase exists to remove — the gap between them is not
 * transactional. Do not split this.
 *
 * ## Privacy
 *
 * The table never stores an email address, only a SHA-256 hash of the
 * normalised address. Being honest about what that buys: the space of email
 * addresses is small enough to brute-force, so the hash is not a secrecy
 * guarantee against a determined attacker with the table contents. It does
 * mean the table is not a readable mailing list, and that diagnostics and
 * logs can reference an identity without carrying the address itself.
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  appendSend,
  decideResend,
  isExpired,
  normaliseIdentifier,
  pruneTimestamps,
  RESEND_COOLDOWN_MS,
  type ThrottleRejectionReason,
} from "./lib/abuseLimiterPolicy";

/**
 * Hash an identifier for storage.
 *
 * Uses Web Crypto, which is available in the Convex runtime.
 */
export async function hashIdentifier(identifier: string): Promise<string> {
  const normalised = normaliseIdentifier(identifier);
  const data = new TextEncoder().encode(normalised);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ConsumeResult {
  allowed: boolean;
  reason?: ThrottleRejectionReason;
  retryAfterMs: number;
}

/**
 * Atomically check the resend allowance for an identity and, if permitted,
 * consume it.
 *
 * Internal: it is never exposed on the public API surface, so a client cannot
 * call it to probe whether an address recently requested a code (§13).
 */
export const consumeResendAllowance = internalMutation({
  args: {
    /** SHA-256 of the normalised identifier. Never the address itself. */
    identityHash: v.string(),
    /** Injected by tests; defaults to now. */
    now: v.optional(v.number()),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    retryAfterMs: v.number(),
  }),
  handler: async (ctx, args): Promise<ConsumeResult> => {
    const now = args.now ?? Date.now();

    const existing = await ctx.db
      .query("otpResendBuckets")
      .withIndex("by_identity", (q) => q.eq("identityHash", args.identityHash))
      .unique();

    const stored = existing?.sendTimestamps ?? [];
    const live = pruneTimestamps(stored, now);
    const decision = decideResend(live, now);

    if (!decision.allowed) {
      // A rejected request must not extend the cooldown, or a client retrying
      // in a loop would lock itself out indefinitely. Nothing is written.
      return {
        allowed: false,
        reason: decision.reason,
        retryAfterMs: decision.retryAfterMs,
      };
    }

    const updated = appendSend(live, now);

    if (existing) {
      await ctx.db.patch(existing._id, {
        sendTimestamps: updated,
        lastSendAt: now,
      });
    } else {
      await ctx.db.insert("otpResendBuckets", {
        identityHash: args.identityHash,
        sendTimestamps: updated,
        lastSendAt: now,
      });
    }

    return { allowed: true, retryAfterMs: 0 };
  },
});

/**
 * Delete buckets whose retention window has fully elapsed.
 *
 * Expiry is already enforced on read by {@link pruneTimestamps}, so this is
 * storage hygiene, not a security control — a row that survives longer than
 * intended cannot grant extra allowance, it can only waste space. Safe to run
 * on a cron, or never.
 */
export const purgeExpiredBuckets = internalMutation({
  args: {
    now: v.optional(v.number()),
    /** Bound the work per invocation so this cannot become a long transaction. */
    limit: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(args.limit ?? 200, 1000);

    const candidates = await ctx.db.query("otpResendBuckets").take(limit);

    let deleted = 0;
    for (const row of candidates) {
      if (isExpired(row.lastSendAt, now)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});

export { RESEND_COOLDOWN_MS };
