/**
 * Phase 235 — Universal Provider Registry (data-driven, extensible)
 *
 * Registry is data-driven, not a giant if/else chain.
 * Provider families like CCXT discover implementations dynamically from
 * ccxt.exchanges, never from a hardcoded exchange whitelist as source of truth.
 *
 * Invariants:
 * - No hardcoded ticker whitelist.
 * - No hardcoded exchange whitelist as source of truth.
 * - Provider-native identity preserved.
 * - Discovery metadata ≠ live evidence.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { ProviderDiscoveryResult } from "./types";
import type {
  UniversalProviderAdapter,
  ProviderCapability,
  ProviderOperationalStatus,
} from "./provider-contract";
import {
  ccxtProviderId as ccxtProviderIdFromContract,
  IDX_PROVIDER_ID,
  STOCKBIT_PROVIDER_ID,
  AJAIB_PROVIDER_ID,
} from "./provider-contract";

export const ccxtProviderId = ccxtProviderIdFromContract;

// ────────────────────────────────────────────────────────────────
// STATIC PROVIDER DEFINITIONS (provider ids, not tickers)
// ────────────────────────────────────────────────────────────────

export interface RegistryEntry {
  providerId: string;
  displayName: string;
  assetClasses: AssetClass[];
  capabilities: ProviderCapability[];
  discoverySupported: boolean;
  liveSupported: boolean;
  status: ProviderOperationalStatus;
  /** For CCXT family, whether this is a dynamic family */
  isDynamicFamily?: boolean;
  /** License note */
  licenseNote?: string;
  requiresLicense?: boolean;
  requiresCredential?: boolean;
}

export const STATIC_REGISTRY: RegistryEntry[] = [
  {
    providerId: "twelve-data",
    displayName: "Twelve Data",
    assetClasses: ["forex", "equity", "commodity", "indices", "crypto"],
    capabilities: ["discovery", "ohlcv", "quote"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
    requiresCredential: true,
  },
  {
    providerId: "okx",
    displayName: "OKX",
    assetClasses: ["crypto"],
    capabilities: ["discovery", "ohlcv", "quote", "order_book"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
  },
  {
    providerId: "ccxt",
    displayName: "CCXT (dynamic CEX/DEX backbone)",
    assetClasses: ["crypto"],
    capabilities: ["discovery", "ohlcv", "quote", "order_book", "trades"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
    isDynamicFamily: true,
  },
  {
    providerId: "dexscreener",
    displayName: "DexScreener",
    assetClasses: ["crypto"],
    capabilities: ["discovery", "on_chain", "quote"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
  },
  {
    providerId: "geckoterminal",
    displayName: "GeckoTerminal",
    assetClasses: ["crypto"],
    capabilities: ["discovery", "on_chain", "quote", "ohlcv"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
  },
  {
    providerId: IDX_PROVIDER_ID,
    displayName: "IDX (Indonesia Stock Exchange)",
    assetClasses: ["equity", "indices"],
    capabilities: ["discovery", "eod", "delayed", "realtime", "fundamentals", "corporate_actions"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
    requiresLicense: true,
    licenseNote:
      "IDX real-time requires official licensed datafeed. Public metadata discoverable, market-data acquisition requires license.",
  },
  {
    providerId: STOCKBIT_PROVIDER_ID,
    displayName: "Stockbit",
    assetClasses: ["equity"],
    capabilities: ["realtime", "delayed", "eod", "fundamentals"],
    discoverySupported: false,
    liveSupported: false,
    status: "REQUIRES_LICENSE",
    requiresLicense: true,
    licenseNote:
      "Stockbit real-time Live Datafeed requires paid access and authorized API. No private/mobile endpoint scraping.",
  },
  {
    providerId: AJAIB_PROVIDER_ID,
    displayName: "Ajaib",
    assetClasses: ["equity"],
    capabilities: ["realtime", "delayed", "eod"],
    discoverySupported: false,
    liveSupported: false,
    status: "REQUIRES_LICENSE",
    requiresLicense: true,
    licenseNote:
      "Ajaib market data requires authorized access. No private endpoint scraping.",
  },
  {
    providerId: "coingecko",
    displayName: "CoinGecko",
    assetClasses: ["crypto"],
    capabilities: ["quote", "fundamentals"],
    discoverySupported: false,
    liveSupported: true,
    status: "AVAILABLE",
  },
  {
    providerId: "coinglass",
    displayName: "CoinGlass",
    assetClasses: ["crypto"],
    capabilities: ["discovery", "derivatives", "funding", "open_interest", "liquidations"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
    requiresCredential: true,
  },
  {
    providerId: "alpha-vantage",
    displayName: "Alpha Vantage",
    assetClasses: ["indices", "equity", "forex"],
    capabilities: ["discovery", "ohlcv", "quote", "fundamentals", "news"],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE",
    requiresCredential: true,
  },
];

// ────────────────────────────────────────────────────────────────
// DYNAMIC CCXT DISCOVERY
// ────────────────────────────────────────────────────────────────

let cachedCcxtExchanges: string[] | null = null;

export function getAvailableCcxtExchangesDynamic(): string[] {
  if (cachedCcxtExchanges) return cachedCcxtExchanges;
  try {
    // Dynamic import via require to avoid bundling all exchanges in client
    // In Node (Convex), ccxt.exchanges is the registry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ccxt = require("ccxt") as { exchanges?: string[] };
    const list = ccxt.exchanges ?? [];
    // Filter out obviously non-public or deprecated? Keep all that ccxt reports.
    // Source of truth is ccxt.exchanges, not a manual list.
    cachedCcxtExchanges = [...list].sort();
    return cachedCcxtExchanges;
  } catch {
    // CCXT not available in this runtime (e.g. browser) → empty, not fake-success
    return [];
  }
}

export function expandCcxtFamily(): RegistryEntry[] {
  const exchanges = getAvailableCcxtExchangesDynamic();
  return exchanges.map((exId) => ({
    providerId: ccxtProviderId(exId),
    displayName: `${exId} via CCXT`,
    assetClasses: ["crypto"] as AssetClass[],
    capabilities: ["discovery", "ohlcv", "quote", "order_book", "trades"] as ProviderCapability[],
    discoverySupported: true,
    liveSupported: true,
    status: "AVAILABLE" as ProviderOperationalStatus,
  }));
}

export function getFullRegistry(): RegistryEntry[] {
  const base = [...STATIC_REGISTRY];
  // Expand CCXT family dynamically, but keep base "ccxt" entry as family marker
  const dynamic = expandCcxtFamily();
  // Avoid duplicate if ccxt family not available
  return [...base, ...dynamic];
}

export function getRegistryByAssetClass(assetClass: AssetClass): RegistryEntry[] {
  return getFullRegistry().filter((e) => e.assetClasses.includes(assetClass));
}

export function getRegistryByCapability(cap: ProviderCapability): RegistryEntry[] {
  return getFullRegistry().filter((e) => e.capabilities.includes(cap));
}

// ────────────────────────────────────────────────────────────────
// UNIVERSAL ADAPTER REGISTRY (runtime adapters)
// ────────────────────────────────────────────────────────────────

const adapterMap = new Map<string, UniversalProviderAdapter>();

export function registerUniversalAdapter(adapter: UniversalProviderAdapter): void {
  adapterMap.set(adapter.providerId, adapter);
}

export function getUniversalAdapter(providerId: string): UniversalProviderAdapter | undefined {
  return adapterMap.get(providerId);
}

export function getAllUniversalAdapters(): UniversalProviderAdapter[] {
  return Array.from(adapterMap.values());
}

export function clearUniversalAdapters(): void {
  adapterMap.clear();
}

export function getAdaptersByAssetClass(assetClass: AssetClass): UniversalProviderAdapter[] {
  return getAllUniversalAdapters().filter((a) => a.assetClasses.includes(assetClass));
}

export function getAdaptersSupporting(cap: ProviderCapability): UniversalProviderAdapter[] {
  return getAllUniversalAdapters().filter((a) => a.capabilities.includes(cap));
}

// ────────────────────────────────────────────────────────────────
// DISCOVERY AGGREGATION (uses UniversalProviderAdapter)
// ────────────────────────────────────────────────────────────────

import {
  discoveredInstrumentKey,
  emptyAssetClassCoverage,
  type UniversalDiscoveryResult,
} from "./types";

export async function runUniversalDiscoveryV2(
  adapters: readonly UniversalProviderAdapter[],
  now: number = Date.now(),
): Promise<UniversalDiscoveryResult> {
  const settled = await Promise.all(
    adapters.map(async (adapter): Promise<ProviderDiscoveryResult> => {
      if (!adapter.discover || !adapter.discoverySupported) {
        return {
          provider: adapter.providerId,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `Discovery not supported for ${adapter.providerId}: ${adapter.status}`,
        };
      }
      try {
        return await adapter.discover(now);
      } catch (err) {
        return {
          provider: adapter.providerId,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `Discovery threw: ${err instanceof Error ? err.message : "unknown error"}`,
        };
      }
    }),
  );

  const byKey = new Map<string, import("./types").DiscoveredInstrument>();
  const warnings: string[] = [];
  const failedProviders: string[] = [];
  const succeededProviders: string[] = [];

  for (const result of settled) {
    warnings.push(...result.warnings.map((w) => `[${result.provider}] ${w}`));
    if (!result.success) {
      failedProviders.push(result.provider);
      if (result.error) warnings.push(`[${result.provider}] ${result.error}`);
      continue;
    }
    succeededProviders.push(result.provider);
    for (const inst of result.instruments) {
      byKey.set(discoveredInstrumentKey(inst), inst);
    }
  }

  const instruments = Array.from(byKey.values()).sort((a, b) =>
    discoveredInstrumentKey(a).localeCompare(discoveredInstrumentKey(b)),
  );

  const assetClassCoverage = emptyAssetClassCoverage();
  for (const inst of instruments) {
    assetClassCoverage[inst.assetClass] += 1;
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
