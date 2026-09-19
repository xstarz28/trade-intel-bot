/**
 * Phase 158 — Correlation Keys Derived From Provider-Native Metadata
 *
 * Correlation control must work for instruments nobody hardcoded.
 *
 * The legacy `CORRELATION_CLUSTERS` list keys on canonical names such as
 * "BTC/USD". Discovery yields provider-native ids such as "BTC-USDT-SWAP",
 * so the static list silently never matched — correlation control was inert
 * for every discovered instrument.
 *
 * This module derives a correlation key from metadata the provider actually
 * reported. It is a grouping key only:
 *   - It never becomes directional evidence.
 *   - It never merges two instruments into one identity.
 *   - It never rewrites a provider-native id.
 */

import type { DiscoveredInstrument } from "./types";

/**
 * Derive a correlation grouping key from provider-native metadata.
 *
 * Groups by asset class + base asset, so BTC-USDT (spot), BTC-USDT-SWAP
 * (perp), and BTC-USD-240927 (future) all share one exposure group without
 * any hardcoded symbol list.
 */
export function deriveCorrelationKey(
  instrument: Pick<DiscoveredInstrument, "assetClass" | "baseAsset">,
): string {
  const base = instrument.baseAsset.trim().toUpperCase();
  if (!base) return `${instrument.assetClass}:UNKNOWN`;
  return `${instrument.assetClass}:${base}`;
}

/**
 * Derive a correlation key for a forex-style pair, where BOTH legs matter.
 *
 * EUR/USD and EUR/GBP share EUR exposure; the base leg is the primary group.
 */
export function deriveQuoteExposureKey(
  instrument: Pick<DiscoveredInstrument, "assetClass" | "quoteAsset">,
): string {
  const quote = instrument.quoteAsset.trim().toUpperCase();
  if (!quote) return `${instrument.assetClass}:QUOTE:UNKNOWN`;
  return `${instrument.assetClass}:QUOTE:${quote}`;
}

/**
 * Cap how many instruments from the same derived correlation group may be
 * surfaced together.
 *
 * Ordering is caller-controlled (callers pass an already-ranked list); this
 * function only enforces the cap and is deterministic.
 */
export function limitByCorrelationGroup<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
  maxPerGroup: number,
): T[] {
  if (maxPerGroup <= 0) return [];

  const counts = new Map<string, number>();
  const kept: T[] = [];

  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      // No derivable group → no correlation claim → never suppressed.
      kept.push(item);
      continue;
    }
    const seen = counts.get(key) ?? 0;
    if (seen >= maxPerGroup) continue;
    counts.set(key, seen + 1);
    kept.push(item);
  }

  return kept;
}
