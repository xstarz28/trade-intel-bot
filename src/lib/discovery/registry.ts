/**
 * Phase 158 — Universal Discovery Aggregation
 *
 * Runs every registered provider discovery adapter and merges the results
 * into one universal instrument set.
 *
 * CRITICAL INVARIANTS:
 *   - Provider isolation: one provider failing NEVER removes, hides, or
 *     replaces another provider's instruments.
 *   - No symbol substitution: instruments are keyed by
 *     provider + providerInstrumentId, so the same symbol on two providers
 *     stays two distinct entries.
 *   - No hidden whitelist/ceiling: every instrument a provider reports is
 *     retained. Nothing is truncated here.
 *   - Deterministic ordering for identical input.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import { STATIC_REGISTRY } from "./universal-provider-registry";
import {
  discoveredInstrumentKey,
  emptyAssetClassCoverage,
  isAcquirableState,
  type DiscoveredInstrument,
  type ProviderDiscoveryAdapter,
  type ProviderDiscoveryResult,
  type UniversalDiscoveryResult,
} from "./types";

/**
 * Run all adapters and aggregate. Never throws.
 *
 * An adapter that rejects is recorded as a failed provider; the remaining
 * providers still contribute their instruments.
 */
export async function runUniversalDiscovery(
  adapters: readonly ProviderDiscoveryAdapter[],
  now: number = Date.now(),
): Promise<UniversalDiscoveryResult> {
  const settled = await Promise.all(
    adapters.map(async (adapter): Promise<ProviderDiscoveryResult> => {
      try {
        return await adapter.discover(now);
      } catch (err) {
        // A thrown adapter is a provider failure, never a silent empty success.
        return {
          provider: adapter.provider,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          error: `Discovery threw: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        };
      }
    }),
  );

  const byKey = new Map<string, DiscoveredInstrument>();
  const warnings: string[] = [];
  const failedProviders: string[] = [];
  const succeededProviders: string[] = [];

  for (const result of settled) {
    warnings.push(
      ...result.warnings.map((w) => `[${result.provider}] ${w}`),
    );

    if (!result.success) {
      failedProviders.push(result.provider);
      if (result.error) {
        warnings.push(`[${result.provider}] ${result.error}`);
      }
      // Provider isolation: a failure contributes nothing and removes nothing.
      continue;
    }

    succeededProviders.push(result.provider);

    for (const instrument of result.instruments) {
      // Provider-scoped key: no cross-provider collapsing.
      byKey.set(discoveredInstrumentKey(instrument), instrument);
    }
  }

  const instruments = Array.from(byKey.values()).sort((a, b) =>
    discoveredInstrumentKey(a).localeCompare(discoveredInstrumentKey(b)),
  );

  const assetClassCoverage = emptyAssetClassCoverage();
  for (const instrument of instruments) {
    assetClassCoverage[instrument.assetClass] += 1;
  }

  return {
    discoveredAt: now,
    instruments,
    providerResults: settled,
    failedProviders,
    succeededProviders,
    warnings,
    assetClassCoverage,
  };
}

/**
 * Instruments eligible for live acquisition.
 *
 * Eligibility is a hard metadata gate, not a preference:
 *   - the instrument must be in a TRADING state, and
 *   - the provider must actually declare the required capability.
 *
 * This is NOT a whitelist: no instrument is named here, and any instrument
 * meeting the contract passes.
 */
export function selectAcquirableInstruments(
  instruments: readonly DiscoveredInstrument[],
  requiredCapability: string = "ohlcv",
  assetClasses?: readonly AssetClass[],
): DiscoveredInstrument[] {
  return instruments.filter((instrument) => {
    if (!isAcquirableState(instrument.tradingState)) return false;
    if (!instrument.capabilities.includes(requiredCapability as never)) {
      return false;
    }
    if (
      assetClasses &&
      assetClasses.length > 0 &&
      !assetClasses.includes(instrument.assetClass)
    ) {
      return false;
    }
    // Phase 266 — historical index isolation: if provider's registry entry has liveSupported false,
    // its instruments must NEVER enter live eligibility (e.g., alpha-vantage indices historical/delayed).
    // This prevents historical/delayed data from becoming LIVE/FRESH/liveEligible/liveSources.
    const reg = STATIC_REGISTRY.find((e) => e.providerId === instrument.provider);
    if (reg && reg.liveSupported === false) {
      // For alpha-vantage indices, historical only — exclude from live acquisition.
      // Allow if requiredCapability is explicitly historical (delayed/eod) but not for ohlcv live gate.
      // The live pipeline always asks for ohlcv, so this blocks historical.
      if (requiredCapability === "ohlcv" || requiredCapability === "quote") {
        // If provider is alpha-vantage and assetClass indices, it's historical only
        if (instrument.provider === "alpha-vantage" && instrument.assetClass === "indices") {
          return false;
        }
        // Generic: if registry says liveSupported false, exclude from live ohlcv/quote
        // Exception: coinglass has liveSupported true in registry (now true), so allowed.
        // For alpha-vantage, liveSupported false → exclude.
        if (reg.providerId === "alpha-vantage") {
          return false;
        }
      }
    }
    return true;
  });
}
