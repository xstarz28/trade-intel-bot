/**
 * Phase 187 — test harness for the durable OTP limiter.
 *
 * A real Convex deployment is unavailable (Phase 186), so these tests cannot
 * exercise the actual database. This harness models the part that matters:
 *
 *  1. **Shared state.** One store backs every ctx handed out, so two
 *     "instances" observe the same allowance — the exact property the
 *     in-memory Map lacked.
 *  2. **Serializable mutations.** Convex mutations on a conflicting row do
 *     not interleave. The harness serialises calls through a promise chain,
 *     so a concurrent burst sees committed state rather than a stale read.
 *
 * The logic under test is the REAL policy module, not a reimplementation:
 * only storage is faked. If `abuseLimiterPolicy` is mutated, these tests
 * fail.
 *
 * Honesty: this is Evidence C. It proves the algorithm is correct under
 * serializable execution. It does NOT prove Convex's durability or its
 * real contention behaviour — that stays BLOCKED until Evidence D.
 */

import {
  appendSend,
  decideResend,
  isExpired,
  normaliseIdentifier,
  pruneTimestamps,
} from "../abuseLimiterPolicy";

export interface StubRow {
  identityHash: string;
  sendTimestamps: number[];
  lastSendAt: number;
}

export interface ConsumeArgs {
  identityHash: string;
  now?: number;
}

export interface ConsumeResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs: number;
}

/** Hash identical to the production one, so tests exercise real key derivation. */
export async function hashIdentifierForTest(identifier: string): Promise<string> {
  const data = new TextEncoder().encode(normaliseIdentifier(identifier));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface DurableLimiterStub {
  /** An ActionCtx-shaped object accepted by `sendVerificationRequest`. */
  ctx: { runMutation: (ref: unknown, args: ConsumeArgs) => Promise<ConsumeResult> };
  /** A second ctx sharing the same store — models another Convex instance. */
  newInstanceCtx: () => DurableLimiterStub["ctx"];
  /** Rows currently stored. */
  rows: () => StubRow[];
  /** Number of mutation invocations, for contention/cost assertions. */
  callCount: () => number;
  /** Force the next N mutation calls to throw, to test fail-closed behaviour. */
  failNext: (count: number) => void;
  /** Drop expired rows, mirroring `purgeExpiredBuckets`. */
  purge: (now: number) => number;
  /** Discard all state, modelling total loss of the backing store. */
  wipe: () => void;
}

/**
 * Build a stub whose `runMutation` behaves like
 * `otpLimiter.consumeResendAllowance` under serializable isolation.
 */
export function makeDurableLimiterStub(): DurableLimiterStub {
  const store = new Map<string, StubRow>();
  let calls = 0;
  let failures = 0;

  // Convex mutations touching the same row are serializable. Chaining on a
  // single promise reproduces that: no two handlers observe the same
  // pre-state, so a correct implementation cannot double-spend and a broken
  // one still can.
  let tail: Promise<unknown> = Promise.resolve();

  const runMutation = (_ref: unknown, args: ConsumeArgs): Promise<ConsumeResult> => {
    const result = tail.then(async () => {
      calls += 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error("simulated limiter storage failure");
      }

      const now = args.now ?? Date.now();
      const existing = store.get(args.identityHash);
      const live = pruneTimestamps(existing?.sendTimestamps ?? [], now);
      const decision = decideResend(live, now);

      if (!decision.allowed) {
        return {
          allowed: false,
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        } satisfies ConsumeResult;
      }

      const updated = appendSend(live, now);
      store.set(args.identityHash, {
        identityHash: args.identityHash,
        sendTimestamps: updated,
        lastSendAt: now,
      });
      return { allowed: true, retryAfterMs: 0 } satisfies ConsumeResult;
    });

    // Keep the chain alive even when a call rejects, or one simulated failure
    // would wedge every later call in the test.
    tail = result.catch(() => undefined);
    return result;
  };

  return {
    ctx: { runMutation },
    newInstanceCtx: () => ({ runMutation }),
    rows: () => [...store.values()].map((r) => ({ ...r, sendTimestamps: [...r.sendTimestamps] })),
    callCount: () => calls,
    failNext: (count: number) => {
      failures = count;
    },
    purge: (now: number) => {
      let deleted = 0;
      for (const [key, row] of [...store.entries()]) {
        if (isExpired(row.lastSendAt, now)) {
          store.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    },
    wipe: () => store.clear(),
  };
}
