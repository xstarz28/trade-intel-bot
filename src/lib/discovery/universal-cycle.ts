/**
 * Universal discovery → acquisition routing.
 *
 * Dashboard (and tests) use this instead of hard-wiring a single provider
 * into the live opportunity scanner. Adding a provider means registering
 * a discoverer and an acquirer — never appending symbols to a list.
 *
 * Invariants:
 *   - provider-native ids are never rewritten;
 *   - a failed provider contributes no instruments and no fake opportunities;
 *   - two providers listing the same display name stay two identities;
 *   - discovery metadata is not live evidence;
 *   - only verified acquisition results become live sources (handled by
 *     the pipeline / toAcquisitionResults).
 */

import type { AssetClass } from "@/lib/data/universal/types";
import {
  discoveredInstrumentKey,
  type DiscoveredInstrument,
  type ProviderDiscoveryResult,
} from "./types";
import type { NativeAcquisitionResult } from "./pipeline";

export interface MergedDiscovery {
  discovered: DiscoveredInstrument[];
  succeededProviders: string[];
  discoveryErrors: string[];
  providerResults: ProviderDiscoveryResult[];
}

/**
 * Merge per-provider discovery outcomes.
 *
 * Failures are reported, never turned into empty-success catalogs.
 * Identities are keyed by provider + native id so nothing collapses.
 */
export function mergeDiscoveryResults(
  results: readonly ProviderDiscoveryResult[],
): MergedDiscovery {
  const byKey = new Map<string, DiscoveredInstrument>();
  const succeededProviders: string[] = [];
  const discoveryErrors: string[] = [];

  for (const result of results) {
    if (!result.success) {
      discoveryErrors.push(
        `${result.provider}: ${result.error ?? "discovery failed"}`,
      );
      continue;
    }
    succeededProviders.push(result.provider);
    for (const instrument of result.instruments) {
      if (!instrument.provider || !instrument.providerInstrumentId) continue;
      byKey.set(discoveredInstrumentKey(instrument), instrument);
    }
  }

  const discovered = Array.from(byKey.values()).sort((a, b) =>
    discoveredInstrumentKey(a).localeCompare(discoveredInstrumentKey(b)),
  );

  return {
    discovered,
    succeededProviders,
    discoveryErrors,
    providerResults: [...results],
  };
}

export type ProviderAcquireFn = (
  items: readonly DiscoveredInstrument[],
) => Promise<NativeAcquisitionResult[]>;

/**
 * Route a mixed-provider acquisition batch to the matching acquirer.
 *
 * An instrument whose provider has no registered acquirer fails explicitly
 * — it is never rewritten onto another provider's symbol.
 */
export async function acquireDiscoveredBatch(
  batch: readonly DiscoveredInstrument[],
  acquireByProvider: Readonly<Record<string, ProviderAcquireFn>>,
): Promise<NativeAcquisitionResult[]> {
  const groups = new Map<string, DiscoveredInstrument[]>();
  for (const item of batch) {
    const list = groups.get(item.provider) ?? [];
    list.push(item);
    groups.set(item.provider, list);
  }

  const out: NativeAcquisitionResult[] = [];
  for (const [provider, items] of groups) {
    const acquire = acquireByProvider[provider];
    if (!acquire) {
      for (const item of items) {
        out.push({
          provider,
          providerInstrumentId: item.providerInstrumentId,
          assetClass: item.assetClass,
          success: false,
          error: `no acquisition path registered for provider ${provider}`,
        });
      }
      continue;
    }

    try {
      out.push(...(await acquire(items)));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "acquisition threw";
      for (const item of items) {
        out.push({
          provider,
          providerInstrumentId: item.providerInstrumentId,
          assetClass: item.assetClass,
          success: false,
          error: reason,
        });
      }
    }
  }
  return out;
}

/** Wrap a thrown/rejected discovery call as an explicit provider failure. */
export function discoveryFailure(
  provider: string,
  now: number,
  error: unknown,
): ProviderDiscoveryResult {
  return {
    provider,
    success: false,
    discoveredAt: now,
    instruments: [],
    warnings: [],
    error: error instanceof Error ? error.message : "discovery failed",
  };
}

export function assetClassToInstrumentType(
  assetClass: AssetClass,
): "forex" | "crypto" | "stock" | "commodity" | "indices" {
  if (assetClass === "equity") return "stock";
  if (assetClass === "macro") return "indices";
  return assetClass;
}
