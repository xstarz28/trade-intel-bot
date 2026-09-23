/**
 * Phase 159 — Multi-Provider Acquisition Failover
 *
 * A provider is not merely a price source. When provider A fails for
 * instrument X, we may retry on provider B ONLY if provider B genuinely
 * lists the SAME instrument X.
 *
 * THE RULE:
 *   Never substitute instrument A with a different instrument B and then
 *   report success. If no equivalent instrument exists on any other
 *   provider, the correct outcome is an explicit failure.
 *
 * Every failover attempt is recorded, so "which provider actually served
 * this data" is always answerable — provider identity is never laundered.
 */

import type { DiscoveredInstrument } from "./types";
import { discoveredInstrumentKey } from "./types";
import {
  areEquivalentInstruments,
  explainEquivalenceMismatch,
  instrumentEquivalenceKey,
} from "./equivalence";

// ═══════════════════════════════════════════════════════════════
// EQUIVALENCE INDEX
// ═══════════════════════════════════════════════════════════════

/**
 * Index discovered instruments by economic identity so failover candidates
 * can be found without scanning the whole universe.
 */
export function buildEquivalenceIndex(
  instruments: readonly DiscoveredInstrument[],
): Map<string, DiscoveredInstrument[]> {
  const index = new Map<string, DiscoveredInstrument[]>();

  for (const instrument of instruments) {
    const key = instrumentEquivalenceKey(instrument);
    const bucket = index.get(key);
    if (bucket) bucket.push(instrument);
    else index.set(key, [instrument]);
  }

  // Deterministic ordering within each bucket.
  for (const bucket of index.values()) {
    bucket.sort((a, b) =>
      discoveredInstrumentKey(a).localeCompare(discoveredInstrumentKey(b)),
    );
  }

  return index;
}

/**
 * Find alternative providers that list the SAME instrument.
 *
 * Candidates must:
 *   - be strictly equivalent (see equivalence.ts)
 *   - come from a different provider
 *   - be in a TRADING state
 *   - declare the required capability
 */
export function findFailoverCandidates(
  target: DiscoveredInstrument,
  index: ReadonlyMap<string, DiscoveredInstrument[]>,
  requiredCapability: string = "ohlcv",
): DiscoveredInstrument[] {
  const bucket = index.get(instrumentEquivalenceKey(target)) ?? [];

  return bucket.filter(
    (candidate) =>
      candidate.provider !== target.provider &&
      candidate.tradingState === "TRADING" &&
      candidate.capabilities.includes(requiredCapability as never) &&
      areEquivalentInstruments(target, candidate),
  );
}

// ═══════════════════════════════════════════════════════════════
// FAILOVER EXECUTION
// ═══════════════════════════════════════════════════════════════

export interface FailoverAttempt {
  provider: string;
  providerInstrumentId: string;
  success: boolean;
  error?: string;
}

export interface FailoverOutcome<T> {
  /** Whether ANY provider served the instrument. */
  success: boolean;
  /** The instrument that was actually served — always equivalent to target. */
  servedInstrument?: DiscoveredInstrument;
  /** Provider that actually served the data. */
  servedBy?: string;
  /** Payload from the successful provider. */
  value?: T;
  /** Every attempt in order, including failures. */
  attempts: FailoverAttempt[];
  /** Reason for total failure. */
  error?: string;
}

export type AttemptFn<T> = (
  instrument: DiscoveredInstrument,
) => Promise<{ success: boolean; value?: T; error?: string }>;

/**
 * Attempt acquisition on the primary provider, then on equivalent
 * instruments from other providers.
 *
 * Returns the FIRST success. If every provider fails, returns an explicit
 * failure — never a substituted instrument presented as success.
 */
export async function acquireWithFailover<T>(
  target: DiscoveredInstrument,
  index: ReadonlyMap<string, DiscoveredInstrument[]>,
  attempt: AttemptFn<T>,
  options: { requiredCapability?: string; maxProviders?: number } = {},
): Promise<FailoverOutcome<T>> {
  const { requiredCapability = "ohlcv", maxProviders = 3 } = options;
  const attempts: FailoverAttempt[] = [];

  const candidates = [
    target,
    ...findFailoverCandidates(target, index, requiredCapability),
  ].slice(0, Math.max(1, maxProviders));

  for (const candidate of candidates) {
    // Defense in depth: never attempt a non-equivalent instrument, even if
    // a caller hands us a badly built index.
    if (candidate !== target && !areEquivalentInstruments(target, candidate)) {
      continue;
    }

    let result: { success: boolean; value?: T; error?: string };
    try {
      result = await attempt(candidate);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : "attempt threw",
      };
    }

    attempts.push({
      provider: candidate.provider,
      providerInstrumentId: candidate.providerInstrumentId,
      success: result.success,
      ...(result.error ? { error: result.error } : {}),
    });

    if (result.success && result.value !== undefined) {
      return {
        success: true,
        servedInstrument: candidate,
        servedBy: candidate.provider,
        value: result.value,
        attempts,
      };
    }
  }

  return {
    success: false,
    attempts,
    error:
      attempts.length === 0
        ? "no provider available for this instrument"
        : `all ${attempts.length} provider attempt(s) failed`,
  };
}

/**
 * Audit a proposed substitution.
 *
 * Returns null when the swap is legitimate, or a human-readable reason when
 * it must be refused. Useful for asserting the rule at integration points.
 */
export function auditSubstitution(
  requested: DiscoveredInstrument,
  served: DiscoveredInstrument,
): string | null {
  if (areEquivalentInstruments(requested, served)) return null;
  const reason = explainEquivalenceMismatch(requested, served);
  return `refused substitution of ${requested.providerInstrumentId} with ${served.providerInstrumentId}: ${reason}`;
}
