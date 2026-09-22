/**
 * Phase 158 — Discovery Runtime Adapters
 *
 * Bridges the pure discovery pipeline to the Convex actions used at runtime.
 *
 * This is the ONLY place that knows which providers currently have a live
 * discovery + acquisition path. Adding a provider means adding an adapter
 * here — not adding symbols to a static list anywhere.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { LiveCandidateSource } from "@/lib/liveCandidateBuilder";
import { providerNativeAcquisitionToMarketData } from "@/lib/market-radar/provider-registry";
import { deriveCorrelationKey } from "./correlation";
import type { NativeAcquisitionResult } from "./pipeline";
import {
  mapOkxTradingState,
  normalizeOkxInstrument,
} from "./okx-adapter";
import type { DiscoveredInstrument, ProviderDiscoveryResult } from "./types";

export { mapOkxTradingState };

/** Shape returned by the `okx.discoverOkxInstruments` Convex action. */
interface OkxDiscoveryActionResult {
  success: boolean;
  discoveredAt: number;
  warnings: string[];
  error?: string;
  completeness?: "COMPLETE" | "PARTIAL" | "FAILED";
  pagesFetched?: number;
  totalDiscovered?: number;
  instruments: {
    instId: string;
    instType: string;
    baseAsset: string;
    quoteAsset: string;
    settleAsset?: string;
    subType: DiscoveredInstrument["subType"];
    state?: string;
    tickSize?: number;
    lotSize?: number;
    minSize?: number;
  }[];
}

/**
 * Normalize the Twelve Data discovery action into the universal contract.
 * Provider-native symbols are preserved exactly; extra catalog fields are dropped.
 * Preserves Phase 234 completeness semantics.
 */
export function normalizeTwelveDataDiscoveryAction(
  result: ProviderDiscoveryResult,
): ProviderDiscoveryResult {
  return {
    provider: "twelve-data",
    success: result.success,
    discoveredAt: result.discoveredAt,
    instruments: (result.instruments ?? []).map((row) => ({
      ...row,
      provider: "twelve-data",
      providerInstrumentId: row.providerInstrumentId,
    })),
    warnings: result.warnings ?? [],
    completeness: result.completeness,
    pagesFetched: result.pagesFetched,
    totalDiscovered: result.totalDiscovered,
    catalogs: result.catalogs,
    ...(result.error ? { error: result.error } : {}),
  };
}

export function normalizeGenericDiscoveryAction(
  result: ProviderDiscoveryResult,
): ProviderDiscoveryResult {
  return {
    provider: result.provider,
    success: result.success,
    discoveredAt: result.discoveredAt,
    instruments: result.instruments ?? [],
    warnings: result.warnings ?? [],
    completeness: result.completeness,
    pagesFetched: result.pagesFetched,
    totalDiscovered: result.totalDiscovered,
    catalogs: result.catalogs,
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Normalize the OKX discovery action. Native instIds are preserved exactly. */
export function normalizeOkxDiscoveryAction(
  result: OkxDiscoveryActionResult,
): ProviderDiscoveryResult {
  const completeness = result.completeness;
  return {
    provider: "okx",
    success: result.success,
    discoveredAt: result.discoveredAt,
    instruments: result.instruments.map((row) =>
      normalizeOkxInstrument(row, result.discoveredAt),
    ),
    warnings: result.warnings ?? [],
    ...(completeness ? { completeness } : {}),
    ...(result.pagesFetched !== undefined ? { pagesFetched: result.pagesFetched } : {}),
    ...(result.totalDiscovered !== undefined
      ? { totalDiscovered: result.totalDiscovered }
      : { totalDiscovered: result.instruments.length }),
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Shape returned by the `okx.acquireOkxNativeLiveDataBatch` Convex action. */
interface NativeAcquisitionActionResult {
  instrument: string;
  assetClass: AssetClass;
  providerInstrumentId?: string;
  provider: string;
  success: boolean;
  snapshot: { observedAt: number } | null;
  candles?: unknown[];
  error?: string;
}

/**
 * Convert raw acquisition action results into pipeline outcomes.
 *
 * Only results that produce verified market data become live sources.
 * Everything else is an explicit failure — never a fabricated snapshot.
 */
export function toAcquisitionResults(
  batch: readonly DiscoveredInstrument[],
  raw: readonly NativeAcquisitionActionResult[],
): NativeAcquisitionResult[] {
  // Index the batch by native id so results map back to their exact instrument.
  const byNativeId = new Map(
    batch.map((instrument) => [instrument.providerInstrumentId, instrument]),
  );

  const results: NativeAcquisitionResult[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const nativeId = item.providerInstrumentId ?? item.instrument;
    const discovered = byNativeId.get(nativeId);

    // A result we never requested is ignored rather than trusted.
    if (!discovered) continue;
    seen.add(nativeId);

    const marketData = item.success
      ? providerNativeAcquisitionToMarketData(item as never)
      : null;

    if (!item.success || !marketData || !item.snapshot) {
      results.push({
        provider: discovered.provider,
        providerInstrumentId: discovered.providerInstrumentId,
        assetClass: discovered.assetClass,
        success: false,
        // Carry the provider's real reason so the degraded scan is auditable.
        error:
          item.error ??
          (item.success
            ? "provider reported success but returned no usable snapshot"
            : "acquisition failed"),
      });
      continue;
    }

    const source: LiveCandidateSource = {
      // Exact provider-native identity — never canonicalized.
      instrument: discovered.providerInstrumentId,
      assetClass: discovered.assetClass,
      providerNative: {
        provider: discovered.provider,
        providerInstrumentId: discovered.providerInstrumentId,
      },
      correlationKey: deriveCorrelationKey(discovered),
      // Region as the PROVIDER reported it during discovery. Absent when the
      // provider did not say — never guessed from the symbol name.
      ...(discovered.region ? { region: discovered.region } : {}),
      marketData,
    };

    results.push({
      provider: discovered.provider,
      providerInstrumentId: discovered.providerInstrumentId,
      assetClass: discovered.assetClass,
      success: true,
      source,
      observedAt: item.snapshot.observedAt,
    });
  }

  // Anything requested but never answered is an explicit failure.
  for (const instrument of batch) {
    if (seen.has(instrument.providerInstrumentId)) continue;
    results.push({
      provider: instrument.provider,
      providerInstrumentId: instrument.providerInstrumentId,
      assetClass: instrument.assetClass,
      success: false,
      error: "provider returned no result for this instrument",
    });
  }

  return results;
}
