/**
 * Phase 187 — abuse-limiter policy.
 *
 * Pure decision logic for the durable OTP resend limiter. The storage layer
 * (`src/convex/otpLimiter.ts`) owns reading and writing the row inside a
 * single Convex mutation; this module owns *what the answer should be* given
 * a bucket's contents.
 *
 * Splitting it this way is deliberate: the policy can be exhaustively tested
 * without a database, and the mutation stays short enough to audit for
 * atomicity by eye. The mutation must remain the ONLY writer — a second
 * writer would reintroduce the read-then-write race this phase removes.
 *
 * ## Privacy
 *
 * The limiter never stores an email address. It stores a SHA-256 hash of the
 * normalised address, which is enough to count per-identity while keeping the
 * table useless as a user list if it were ever dumped. See `hashIdentifier`
 * in the storage module for why a plain hash is honest about its limits here.
 */

/* ------------------------------------------------------------------ *
 * Policy constants
 * ------------------------------------------------------------------ */

/**
 * Minimum gap between two sends to the same identity.
 *
 * 60s is the value Phase 185 chose and Phase 187 re-examined rather than
 * inherited. The trade-off:
 *
 * - Shorter (15-30s) meaningfully helps nobody: mail delivery itself takes
 *   seconds, so a user who has not received a code in 20s usually still will.
 * - Longer (5min) punishes the common legitimate case — a typo'd address, or
 *   a code that genuinely landed in spam — and drives support load.
 *
 * 60s is long enough that automated resend-bombing is pointless and short
 * enough that a stuck user recovers without feeling punished.
 */
export const RESEND_COOLDOWN_MS = 60_000;

/**
 * Maximum sends to one identity within {@link RESEND_WINDOW_MS}.
 *
 * Five is a deliberate compromise. A legitimate user rarely needs more than
 * two or three in an hour (first send, one resend, one after fixing a typo).
 * Allowing five absorbs a bad-luck case without letting a single address
 * become a sustained outbound mail source: the hourly ceiling is what
 * actually protects the sending domain's reputation, because the 60s cooldown
 * alone would still permit 60 messages per hour.
 */
export const MAX_SENDS_PER_WINDOW = 5;

/** Rolling window for {@link MAX_SENDS_PER_WINDOW}. */
export const RESEND_WINDOW_MS = 60 * 60 * 1000;

/**
 * How long a bucket row is kept after its last send before it may be
 * reclaimed. Two windows, so a row is never collected while it can still
 * affect a decision.
 */
export const BUCKET_RETENTION_MS = RESEND_WINDOW_MS * 2;

/* ------------------------------------------------------------------ *
 * Decision
 * ------------------------------------------------------------------ */

export type ThrottleRejectionReason = "cooldown" | "window_exceeded";

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; reason: ThrottleRejectionReason; retryAfterMs: number };

/**
 * Drop timestamps that have aged out of the rolling window.
 *
 * Pruning on read is what keeps the stored array bounded without a scheduled
 * job: a bucket can never hold more than MAX_SENDS_PER_WINDOW live entries.
 */
export function pruneTimestamps(timestamps: readonly number[], now: number): number[] {
  const cutoff = now - RESEND_WINDOW_MS;
  return timestamps.filter((t) => t > cutoff);
}

/**
 * Decide whether another send is permitted for this identity.
 *
 * `timestamps` must already be pruned by {@link pruneTimestamps}.
 */
export function decideResend(timestamps: readonly number[], now: number): ThrottleDecision {
  if (timestamps.length === 0) return { allowed: true };

  const mostRecent = Math.max(...timestamps);
  const sinceLast = now - mostRecent;

  // Cooldown is checked first so the user-facing message names the shorter,
  // more actionable wait when both limits would apply.
  if (sinceLast < RESEND_COOLDOWN_MS) {
    return {
      allowed: false,
      reason: "cooldown",
      retryAfterMs: RESEND_COOLDOWN_MS - sinceLast,
    };
  }

  if (timestamps.length >= MAX_SENDS_PER_WINDOW) {
    const oldest = Math.min(...timestamps);
    // The window frees a slot when the oldest send ages out.
    const retryAfterMs = Math.max(1, oldest + RESEND_WINDOW_MS - now);
    return { allowed: false, reason: "window_exceeded", retryAfterMs };
  }

  return { allowed: true };
}

/**
 * Apply a successful send to a bucket, returning the new timestamp list.
 *
 * Pure: the caller persists the result. Keeping the append here means the
 * "check" and "record" halves cannot drift apart, which is how the Phase 185
 * in-memory version was mutation-tested into being wrong once.
 */
export function appendSend(timestamps: readonly number[], now: number): number[] {
  return [...pruneTimestamps(timestamps, now), now];
}

/** Normalise an identifier so casing or padding cannot evade the limiter. */
export function normaliseIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/**
 * Whether a bucket whose last send was at `lastSendAt` may be reclaimed.
 */
export function isExpired(lastSendAt: number, now: number): boolean {
  return now - lastSendAt > BUCKET_RETENTION_MS;
}
