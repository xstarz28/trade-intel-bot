/**
 * Phase 157/158 — Live Discovery Lifecycle
 *
 * Governs how a discovered instrument moves between states across scan
 * cycles, and — critically — when its LIVE data may be dropped.
 *
 * CRITICAL INVARIANTS:
 *   - A failed acquisition NEVER deletes a previously good live source.
 *     Data ages out on its own timestamp; a network error is not evidence
 *     that the last known snapshot was wrong.
 *   - Data is dropped ONLY when it has aged past the retention window
 *     (genuinely expired), never merely because a refresh failed.
 *   - Delisting is a POSITIVE signal: an instrument is only retired when a
 *     SUCCESSFUL discovery no longer lists it. A discovery FAILURE never
 *     retires anything.
 *   - Discovery metadata alone is never live data. An instrument that has
 *     been discovered but never acquired has no snapshot and is not live.
 */

import type { DiscoveredInstrument } from "./types";
import { discoveredInstrumentKey } from "./types";

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE STATE
// ═══════════════════════════════════════════════════════════════

export type DiscoveryLifecycleState =
  /** Listed by the provider; no live data acquired yet. Metadata only. */
  | "DISCOVERED"
  /** Live data acquired and still within its retention window. */
  | "LIVE"
  /** Previously live; last refresh failed but retained data is still valid. */
  | "REFRESH_FAILED"
  /** Retained data aged out. No live data. */
  | "EXPIRED"
  /** A successful discovery no longer lists this instrument. */
  | "DELISTED";

export interface TrackedInstrument {
  instrument: DiscoveredInstrument;
  state: DiscoveryLifecycleState;
  /** Observation time of the newest successfully acquired data. */
  lastLiveAt: number | null;
  /** Last time an acquisition attempt succeeded. */
  lastSuccessAt: number | null;
  /** Last time an acquisition attempt failed. */
  lastFailureAt: number | null;
  /** Consecutive failed acquisition attempts. */
  consecutiveFailures: number;
  /** Last successful discovery that listed this instrument. */
  lastSeenInDiscoveryAt: number;
}

export interface LifecycleConfig {
  /**
   * How long acquired data stays usable after its observation timestamp.
   * Past this, the instrument is EXPIRED regardless of failure history.
   */
  retentionMs: number;
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  // 24h matches the point at which freshness assessment reports UNAVAILABLE.
  retentionMs: 24 * 60 * 60_000,
};

// ═══════════════════════════════════════════════════════════════
// DISCOVERY RECONCILIATION
// ═══════════════════════════════════════════════════════════════

export interface ReconcileInput {
  /** Current tracked instruments, keyed by discoveredInstrumentKey. */
  tracked: ReadonlyMap<string, TrackedInstrument>;
  /** Instruments from the latest discovery cycle. */
  discovered: readonly DiscoveredInstrument[];
  /**
   * Providers whose discovery SUCCEEDED this cycle. Only these providers'
   * instruments may be retired for absence.
   */
  succeededProviders: readonly string[];
  now: number;
}

/**
 * Merge a discovery cycle into tracked state.
 *
 * New instruments are added as DISCOVERED (metadata only — not live).
 * Existing instruments keep their live data and lifecycle state.
 * Instruments absent from a SUCCESSFUL provider discovery become DELISTED.
 * Instruments of a FAILED provider are untouched.
 */
export function reconcileDiscovery(
  input: ReconcileInput,
): Map<string, TrackedInstrument> {
  const { tracked, discovered, succeededProviders, now } = input;
  const next = new Map<string, TrackedInstrument>();
  const succeeded = new Set(succeededProviders);
  const discoveredKeys = new Set(
    discovered.map((instrument) => discoveredInstrumentKey(instrument)),
  );

  // Carry forward everything already tracked.
  for (const [key, entry] of tracked) {
    const providerSucceeded = succeeded.has(entry.instrument.provider);
    const stillListed = discoveredKeys.has(key);

    if (providerSucceeded && !stillListed) {
      // Positive delisting signal: provider answered and omitted it.
      next.set(key, { ...entry, state: "DELISTED" });
      continue;
    }

    // Provider failed, or instrument still listed → retain untouched.
    // A discovery failure must never mutate lifecycle state.
    next.set(key, entry);
  }

  // Add/refresh instruments reported this cycle.
  for (const instrument of discovered) {
    const key = discoveredInstrumentKey(instrument);
    const existing = next.get(key);

    if (!existing) {
      next.set(key, {
        instrument,
        // Metadata only — discovery is never live evidence.
        state: "DISCOVERED",
        lastLiveAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        lastSeenInDiscoveryAt: now,
      });
      continue;
    }

    // Refresh metadata and re-list a previously delisted instrument.
    next.set(key, {
      ...existing,
      instrument,
      state: existing.state === "DELISTED" ? relistState(existing) : existing.state,
      lastSeenInDiscoveryAt: now,
    });
  }

  return next;
}

function relistState(entry: TrackedInstrument): DiscoveryLifecycleState {
  // A re-listed instrument returns to whatever its data actually supports.
  if (entry.lastLiveAt === null) return "DISCOVERED";
  return entry.consecutiveFailures > 0 ? "REFRESH_FAILED" : "LIVE";
}

// ═══════════════════════════════════════════════════════════════
// ACQUISITION OUTCOME
// ═══════════════════════════════════════════════════════════════

export interface AcquisitionOutcome {
  key: string;
  success: boolean;
  /** Observation timestamp of acquired data (required when success). */
  observedAt?: number;
}

/**
 * Apply acquisition outcomes to tracked state.
 *
 * Success  → LIVE, failure counter reset.
 * Failure  → REFRESH_FAILED if usable data is retained; the retained data and
 *            its timestamp are PRESERVED. Never deleted here.
 */
export function applyAcquisitionOutcomes(
  tracked: ReadonlyMap<string, TrackedInstrument>,
  outcomes: readonly AcquisitionOutcome[],
  now: number,
): Map<string, TrackedInstrument> {
  const next = new Map(tracked);

  for (const outcome of outcomes) {
    const entry = next.get(outcome.key);
    if (!entry) continue;

    if (outcome.success && outcome.observedAt !== undefined) {
      next.set(outcome.key, {
        ...entry,
        state: "LIVE",
        // Never move the observation timestamp backwards.
        lastLiveAt: Math.max(entry.lastLiveAt ?? 0, outcome.observedAt),
        lastSuccessAt: now,
        consecutiveFailures: 0,
      });
      continue;
    }

    // FAILURE PATH — retained data survives.
    next.set(outcome.key, {
      ...entry,
      state: entry.lastLiveAt === null ? "DISCOVERED" : "REFRESH_FAILED",
      lastLiveAt: entry.lastLiveAt,
      lastFailureAt: now,
      consecutiveFailures: entry.consecutiveFailures + 1,
    });
  }

  return next;
}

// ═══════════════════════════════════════════════════════════════
// EXPIRY
// ═══════════════════════════════════════════════════════════════

/**
 * Expire instruments whose retained data has aged out.
 *
 * Expiry is driven ONLY by data age, never by failure count. This is what
 * keeps "acquisition failed" from silently destroying valid state.
 */
export function expireStaleInstruments(
  tracked: ReadonlyMap<string, TrackedInstrument>,
  now: number,
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
): Map<string, TrackedInstrument> {
  const next = new Map<string, TrackedInstrument>();

  for (const [key, entry] of tracked) {
    if (entry.lastLiveAt === null) {
      next.set(key, entry);
      continue;
    }

    const age = now - entry.lastLiveAt;
    if (age > config.retentionMs && entry.state !== "DELISTED") {
      next.set(key, { ...entry, state: "EXPIRED" });
      continue;
    }

    next.set(key, entry);
  }

  return next;
}

/**
 * Keys whose live data must be dropped from the scanner.
 *
 * Only EXPIRED (aged out) and DELISTED (positively removed by the provider)
 * qualify. REFRESH_FAILED explicitly does NOT.
 */
export function keysToEvict(
  tracked: ReadonlyMap<string, TrackedInstrument>,
): string[] {
  const evict: string[] = [];
  for (const [key, entry] of tracked) {
    if (entry.state === "EXPIRED" || entry.state === "DELISTED") {
      evict.push(key);
    }
  }
  return evict.sort();
}

/** Instruments whose retained live data is still valid for scanning. */
export function liveEligibleInstruments(
  tracked: ReadonlyMap<string, TrackedInstrument>,
  now?: number,
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
): TrackedInstrument[] {
  return Array.from(tracked.values()).filter((entry) =>
    isRetentionEligible(entry, now, config),
  );
}

// ────────────────────────────────────────────────────────────────
// Phase 243 — explicit eligibility predicates (centralized, deterministic)
// ────────────────────────────────────────────────────────────────

/**
 * Retention eligibility — does this instrument have usable retained data
 * that has not yet expired by age and has not been delisted?
 *
 * This is the ONLY place that decides whether a tracked instrument may stay
 * in the scanner's live set. It does NOT decide horizon-specific freshness
 * (FRESH/DELAYED/STALE) — that is gated later by assessFreshness +
 * checkFreshnessEligibility.
 *
 * Truth table:
 * - DISCOVERED (lastLiveAt null) → never eligible
 * - EXPIRED / DELISTED → never eligible
 * - LIVE / REFRESH_FAILED with lastLiveAt != null and age <= retentionMs → eligible
 * - If now is undefined, age check is skipped (legacy path) but state check remains.
 */
export function isRetentionEligible(
  entry: TrackedInstrument,
  now?: number,
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
): boolean {
  if (!entry) return false;
  if (entry.lastLiveAt === null) return false;
  if (entry.state !== "LIVE" && entry.state !== "REFRESH_FAILED") return false;
  if (now !== undefined) {
    const age = now - entry.lastLiveAt;
    if (age < 0) return false;
    if (age > config.retentionMs) return false;
  }
  return true;
}

export function isExpiredByRetention(
  entry: TrackedInstrument,
  now: number,
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
): boolean {
  if (entry.lastLiveAt === null) return false;
  if (entry.state === "DELISTED") return false;
  return now - entry.lastLiveAt > config.retentionMs;
}

export function isDiscoveryOnly(entry: TrackedInstrument): boolean {
  return entry.state === "DISCOVERED" || entry.lastLiveAt === null;
}

export function isLiveState(entry: TrackedInstrument): boolean {
  return entry.state === "LIVE";
}

export function isRefreshFailedState(entry: TrackedInstrument): boolean {
  return entry.state === "REFRESH_FAILED";
}

export function isExpiredState(entry: TrackedInstrument): boolean {
  return entry.state === "EXPIRED";
}

export function isDelistedState(entry: TrackedInstrument): boolean {
  return entry.state === "DELISTED";
}
