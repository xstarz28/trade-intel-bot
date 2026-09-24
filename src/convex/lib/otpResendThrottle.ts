/**
 * Resend throttling for OTP delivery.
 *
 * ## SUPERSEDED IN PHASE 187 — NOT ON THE AUTHORITATIVE PATH
 *
 * The live limiter is now `src/convex/otpLimiter.ts`, backed by the
 * `otpResendBuckets` table, because the per-process design below could not
 * bound abuse across Convex instances.
 *
 * This module is retained only because its unit tests still document the
 * windowing semantics the durable policy reuses. **Do not re-wire it into
 * `auth/emailOtp.ts`** — doing so would silently restore per-instance
 * counters, and the Phase 187 suite asserts it is absent from that file.
 *
 * ## FROZEN — Phase 270
 *
 * The email-OTP provider was retired in Phase 270. This module stays
 * untouched as a documentation artifact of the windowing policy; it must
 * not gain callers.
 *
 * Convex Auth rate-limits *failed verification attempts*. It does not limit
 * how often a code can be **requested**. Those are different abuses:
 *
 * - Unlimited verification attempts = brute-forcing a code.
 * - Unlimited *sends* = using this deployment to mail-bomb a third party, and
 *   burning the sending reputation of the Xstarz domain while doing it.
 *
 * Only the second is unaddressed upstream, so only the second is implemented
 * here. This is intentionally a small, pure, in-memory limiter rather than a
 * new database table: adding persistent auth state would create a second
 * source of truth next to Convex Auth's own tables.
 *
 * ## Scope — read this before relying on it
 *
 * This limiter is **in-memory and per-process**. A Convex action instance is
 * not a singleton, so state is NOT shared across instances.
 *
 * What it does: bounds repeated sends per instance, which stops casual abuse
 * from a single caller and protects the sending domain's reputation.
 *
 * What it explicitly does **not** do: it does **not prevent distributed
 * abuse**. An attacker whose requests land on different action instances, or
 * who spreads requests across many addresses, is not stopped by this. It is
 * NOT a complete anti-abuse system.
 *
 * Closing that gap needs shared durable state (a Convex table or a rate-limit
 * component) and is Phase 187. The call sites here will not need to change
 * when that lands — only the storage behind `checkResendAllowed` /
 * `recordResend`.
 */

/** Minimum gap between two sends to the same address. */
export const RESEND_COOLDOWN_MS = 60_000;

/** Maximum sends to one address within the rolling window. */
export const MAX_SENDS_PER_WINDOW = 5;

/** Rolling window for {@link MAX_SENDS_PER_WINDOW}. */
export const RESEND_WINDOW_MS = 60 * 60 * 1000;

/** Entries older than this are evicted so the map cannot grow unbounded. */
const EVICTION_AGE_MS = RESEND_WINDOW_MS * 2;

/** Hard cap on tracked addresses, so a flood of unique addresses cannot OOM. */
const MAX_TRACKED_IDENTIFIERS = 10_000;

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "window_exceeded"; retryAfterMs: number };

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

/** Addresses are case-insensitive in practice; normalise so casing cannot evade. */
export function normaliseIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function checkResendAllowed(identifier: string, now: number = Date.now()): ThrottleDecision {
  const key = normaliseIdentifier(identifier);
  const bucket = buckets.get(key);
  if (bucket === undefined) return { allowed: true };

  const recent = bucket.timestamps.filter((t) => now - t < RESEND_WINDOW_MS);
  if (recent.length === 0) return { allowed: true };

  const last = recent[recent.length - 1];
  const sinceLast = now - last;
  if (sinceLast < RESEND_COOLDOWN_MS) {
    return { allowed: false, reason: "cooldown", retryAfterMs: RESEND_COOLDOWN_MS - sinceLast };
  }

  if (recent.length >= MAX_SENDS_PER_WINDOW) {
    const oldest = recent[0];
    return {
      allowed: false,
      reason: "window_exceeded",
      retryAfterMs: Math.max(0, RESEND_WINDOW_MS - (now - oldest)),
    };
  }

  return { allowed: true };
}

/** Record a send. Call only after delivery is actually attempted. */
export function recordResend(identifier: string, now: number = Date.now()): void {
  const key = normaliseIdentifier(identifier);
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < RESEND_WINDOW_MS);
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  evictStale(now);
}

function evictStale(now: number): void {
  if (buckets.size <= MAX_TRACKED_IDENTIFIERS) {
    for (const [key, bucket] of buckets) {
      const newest = bucket.timestamps[bucket.timestamps.length - 1] ?? 0;
      if (now - newest > EVICTION_AGE_MS) buckets.delete(key);
    }
    return;
  }
  // Over the cap: drop the least recently used entries.
  const entries = [...buckets.entries()].sort((a, b) => {
    const an = a[1].timestamps[a[1].timestamps.length - 1] ?? 0;
    const bn = b[1].timestamps[b[1].timestamps.length - 1] ?? 0;
    return an - bn;
  });
  const excess = buckets.size - MAX_TRACKED_IDENTIFIERS;
  for (let i = 0; i < excess; i++) buckets.delete(entries[i][0]);
}

/** Test-only. Never call from production code. */
export function resetResendThrottleForTests(): void {
  buckets.clear();
}
