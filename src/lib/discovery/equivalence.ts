/**
 * Phase 159 — Instrument Equivalence
 *
 * Answers exactly one question:
 *
 *   "Is provider B's instrument the SAME instrument as provider A's?"
 *
 * This is the gate that makes failover safe. Without it, a failover layer
 * will happily serve BTC-USDT when BTC-USD was requested and call it a
 * success — that is silent symbol substitution.
 *
 * EQUIVALENCE IS STRICT. Two instruments are the same only when their full
 * economic identity matches:
 *   - asset class      (crypto vs equity are never interchangeable)
 *   - instrument subtype (spot is NOT a perpetual is NOT a future)
 *   - base asset       (BTC ≠ ETH)
 *   - quote asset      (USDT ≠ USD — different collateral, different risk)
 *   - settlement asset when both providers report it
 *     (a linear USDT-settled contract ≠ an inverse coin-settled contract)
 *
 * Anything less strict silently changes what the user is analysing.
 */

import type { DiscoveredInstrument } from "./types";

/**
 * Provider-independent economic identity key.
 *
 * Deliberately EXCLUDES the provider, so the same instrument on two venues
 * produces the same key — that is what makes failover matching possible.
 * It still never merges the two into one identity; only the key matches.
 */
export function instrumentEquivalenceKey(
  instrument: Pick<
    DiscoveredInstrument,
    "assetClass" | "subType" | "baseAsset" | "quoteAsset"
  >,
): string {
  const base = instrument.baseAsset.trim().toUpperCase();
  const quote = instrument.quoteAsset.trim().toUpperCase();
  return `${instrument.assetClass}|${instrument.subType}|${base}|${quote}`;
}

/**
 * Strict equivalence test.
 *
 * Settlement asset is compared only when BOTH sides report it: a provider
 * that omits the field has not asserted a conflicting settlement, but two
 * providers that both report DIFFERENT settlement are not equivalent.
 */
export function areEquivalentInstruments(
  a: DiscoveredInstrument,
  b: DiscoveredInstrument,
): boolean {
  if (instrumentEquivalenceKey(a) !== instrumentEquivalenceKey(b)) {
    return false;
  }

  if (a.settleAsset && b.settleAsset) {
    return (
      a.settleAsset.trim().toUpperCase() === b.settleAsset.trim().toUpperCase()
    );
  }

  return true;
}

/**
 * Explain why two instruments are not equivalent.
 * Used so a refused failover is auditable rather than silent.
 */
export function explainEquivalenceMismatch(
  a: DiscoveredInstrument,
  b: DiscoveredInstrument,
): string | null {
  if (a.assetClass !== b.assetClass) {
    return `asset class differs (${a.assetClass} vs ${b.assetClass})`;
  }
  if (a.subType !== b.subType) {
    return `instrument subtype differs (${a.subType} vs ${b.subType})`;
  }
  if (a.baseAsset.toUpperCase() !== b.baseAsset.toUpperCase()) {
    return `base asset differs (${a.baseAsset} vs ${b.baseAsset})`;
  }
  if (a.quoteAsset.toUpperCase() !== b.quoteAsset.toUpperCase()) {
    return `quote asset differs (${a.quoteAsset} vs ${b.quoteAsset})`;
  }
  if (
    a.settleAsset &&
    b.settleAsset &&
    a.settleAsset.toUpperCase() !== b.settleAsset.toUpperCase()
  ) {
    return `settlement asset differs (${a.settleAsset} vs ${b.settleAsset})`;
  }
  return null;
}
