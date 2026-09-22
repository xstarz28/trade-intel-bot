/**
 * Phase 165 — Provider Discovery Capability Classification
 *
 * A provider that returns nothing is NOT the same as a provider that has no
 * discovery API, which is NOT the same as a provider whose key is missing,
 * which is NOT the same as one that is rate limited. Collapsing these into a
 * single "unavailable" hides the difference between "the market really has
 * nothing" and "we could not look".
 *
 * This module keeps those states distinct and, crucially, refuses to claim
 * that a canonical registry constitutes "discovered" instruments. A provider
 * with NO_DISCOVERY_API can still be USED for acquisition — we simply cannot
 * say we enumerated its market.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { EnvReader } from "@/lib/data/universal/live/credentials";
import { checkCredentials } from "@/lib/data/universal/live/credentials";

// ═══════════════════════════════════════════════════════════════
// STATUS VOCABULARY
// ═══════════════════════════════════════════════════════════════

export type DiscoveryCapabilityStatus =
  /** Provider exposes a real instrument-enumeration endpoint that we implement. */
  | "SUPPORTED_DISCOVERY"
  /** Provider genuinely has no instrument-enumeration API. Not a failure. */
  | "NO_DISCOVERY_API"
  /** We implement discovery and credentials exist, but the call did not succeed. */
  | "CONFIGURED_BUT_UNAVAILABLE"
  /** Provider rejected our credentials. */
  | "AUTH_FAILED"
  /** Provider throttled us. Retryable; NOT evidence of an empty market. */
  | "RATE_LIMITED"
  /** Discovery is implemented but required credentials are absent. */
  | "NOT_CONFIGURED"
  /** Implemented and configured, but never exercised against the live venue. */
  | "RUNTIME_UNVERIFIED";

/**
 * Statuses that mean "this provider's market was actually enumerated".
 * Everything else must NOT be presented as discovered coverage.
 */
export function isDiscoveryProven(status: DiscoveryCapabilityStatus): boolean {
  return status === "SUPPORTED_DISCOVERY";
}

/**
 * Statuses that represent a genuine problem worth surfacing.
 * NO_DISCOVERY_API is intentionally excluded: it is a fact about the
 * provider, not a fault.
 */
export function isDiscoveryFault(status: DiscoveryCapabilityStatus): boolean {
  return (
    status === "CONFIGURED_BUT_UNAVAILABLE" ||
    status === "AUTH_FAILED" ||
    status === "RATE_LIMITED"
  );
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER DISCOVERY PROFILES
// ═══════════════════════════════════════════════════════════════

export interface ProviderDiscoveryProfile {
  provider: string;
  /** Whether WE have implemented an enumeration adapter for this provider. */
  discoveryImplemented: boolean;
  /** Whether the PROVIDER exposes an enumeration endpoint at all. */
  providerHasDiscoveryApi: boolean;
  /** Asset classes this provider can enumerate, when it can enumerate. */
  discoverableAssetClasses: AssetClass[];
  /**
   * Why this provider cannot enumerate, when it cannot. Documents the real
   * reason so nobody "fixes" it by inventing a fake catalog later.
   */
  note?: string;
}

/**
 * Ground truth about each provider's discovery ability.
 *
 * Deliberately conservative: a provider is only marked as having a discovery
 * API when it genuinely publishes an instrument catalog we can enumerate.
 * Data-enrichment providers (funding rates, COT, inventories, yields) do NOT
 * enumerate tradable instruments and are marked accordingly — their data is
 * analytical context attached to instruments discovered elsewhere.
 *
 * Phase 235 — universal expansion adds ccxt family, dexscreener, geckoterminal,
 * idx, stockbit, ajaib.
 */
export const PROVIDER_DISCOVERY_PROFILES: ProviderDiscoveryProfile[] = [
  {
    provider: "okx",
    discoveryImplemented: true,
    providerHasDiscoveryApi: true,
    discoverableAssetClasses: ["crypto"],
  },
  {
    provider: "twelve-data",
    discoveryImplemented: true,
    providerHasDiscoveryApi: true,
    discoverableAssetClasses: ["forex", "equity", "commodity", "indices", "crypto"],
  },
  {
    provider: "ccxt",
    discoveryImplemented: true,
    providerHasDiscoveryApi: true,
    discoverableAssetClasses: ["crypto"],
    note: "Dynamic CEX/DEX backbone via CCXT fetchMarkets(), exchanges discovered from ccxt.exchanges registry.",
  },
  {
    provider: "dexscreener",
    discoveryImplemented: true,
    providerHasDiscoveryApi: true,
    discoverableAssetClasses: ["crypto"],
    note: "DEX pairs via DexScreener public API, pool identity = chain:dex:poolAddress.",
  },
  {
    provider: "geckoterminal",
    discoveryImplemented: true,
    providerHasDiscoveryApi: true,
    discoverableAssetClasses: ["crypto"],
    note: "On-chain pools via GeckoTerminal API, networks discovered dynamically, pools paginated.",
  },
  {
    provider: "idx",
    discoveryImplemented: true,
    providerHasDiscoveryApi: true,
    discoverableAssetClasses: ["equity", "indices"],
    note: "IDX public metadata discoverable, realtime requires licensed datafeed (REQUIRES_LICENSE).",
  },
  {
    provider: "stockbit",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: ["equity"],
    note: "Stockbit Live Datafeed requires paid access, no private endpoint scraping. REQUIRES_LICENSE.",
  },
  {
    provider: "ajaib",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: ["equity"],
    note: "Ajaib requires authorized access, no private endpoint scraping. REQUIRES_LICENSE.",
  },
  {
    provider: "coingecko",
    discoveryImplemented: false,
    providerHasDiscoveryApi: true,
    discoverableAssetClasses: ["crypto"],
    note:
      "Publishes a coin list, but our integration is quote-only and its ids " +
      "are coin-level, not tradable instrument ids. Enumerating it would " +
      "imply tradable coverage we cannot acquire.",
  },
  {
    provider: "alpha-vantage",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "Search endpoint only; no full instrument catalog.",
  },
  {
    provider: "coinglass",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "Derivatives analytics for instruments discovered elsewhere.",
  },
  {
    provider: "defillama",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "Protocol TVL/fees; not tradable instruments.",
  },
  {
    provider: "tokenomist",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "Token supply metadata; not tradable instruments.",
  },
  {
    provider: "tickatlas",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "Economic calendar; not tradable instruments.",
  },
  {
    provider: "treasury",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "Yield-curve series; macro context, not tradable instruments.",
  },
  {
    provider: "cftc",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "COT positioning reports; not tradable instruments.",
  },
  {
    provider: "eia",
    discoveryImplemented: false,
    providerHasDiscoveryApi: false,
    discoverableAssetClasses: [],
    note: "Energy inventories; not tradable instruments.",
  },
];

export function getDiscoveryProfile(
  provider: string,
): ProviderDiscoveryProfile | undefined {
  const exact = PROVIDER_DISCOVERY_PROFILES.find((p) => p.provider === provider);
  if (exact) return exact;
  if (provider.startsWith("ccxt:")) {
    return PROVIDER_DISCOVERY_PROFILES.find((p) => p.provider === "ccxt");
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════
// STATIC CLASSIFICATION (no network)
// ═══════════════════════════════════════════════════════════════

export interface ProviderDiscoveryStatus {
  provider: string;
  status: DiscoveryCapabilityStatus;
  /** Asset classes genuinely enumerable by this provider. */
  assetClasses: AssetClass[];
  /** Human-readable explanation. Never a claim of coverage. */
  detail: string;
  /** Credential env var names (never values) still required. */
  missingEnvVarNames?: string[];
}

/**
 * Classify a provider WITHOUT calling it.
 *
 * The best outcome available from static inspection is RUNTIME_UNVERIFIED:
 * we can prove an adapter exists and credentials are present, but only a
 * real call proves discovery works. This function never returns
 * SUPPORTED_DISCOVERY for that reason.
 */
export function classifyProviderDiscovery(
  provider: string,
  readEnv?: EnvReader,
): ProviderDiscoveryStatus {
  const profile = getDiscoveryProfile(provider);

  if (!profile) {
    return {
      provider,
      status: "NO_DISCOVERY_API",
      assetClasses: [],
      detail: "Unknown provider; no discovery profile registered.",
    };
  }

  if (!profile.providerHasDiscoveryApi || !profile.discoveryImplemented) {
    return {
      provider,
      status: "NO_DISCOVERY_API",
      assetClasses: [],
      detail:
        profile.note ??
        "Provider does not expose an instrument-enumeration endpoint.",
    };
  }

  const cred = checkCredentials(provider, readEnv);
  if (cred && cred.authRequired && !cred.available) {
    return {
      provider,
      status: "NOT_CONFIGURED",
      assetClasses: profile.discoverableAssetClasses,
      detail: `Discovery implemented but credentials are missing: ${cred.missingEnvVarNames.join(", ")}.`,
      missingEnvVarNames: cred.missingEnvVarNames,
    };
  }

  return {
    provider,
    status: "RUNTIME_UNVERIFIED",
    assetClasses: profile.discoverableAssetClasses,
    detail:
      "Discovery implemented and credentials present, but not yet exercised " +
      "against the live provider in this process.",
  };
}

/** Classify every registered provider. */
export function classifyAllProviders(
  readEnv?: EnvReader,
): ProviderDiscoveryStatus[] {
  return PROVIDER_DISCOVERY_PROFILES.map((p) =>
    classifyProviderDiscovery(p.provider, readEnv),
  );
}

// ═══════════════════════════════════════════════════════════════
// RUNTIME CLASSIFICATION (from an actual attempt)
// ═══════════════════════════════════════════════════════════════

/**
 * Upgrade a static classification using the outcome of a REAL discovery call.
 *
 * This is the only path that can produce SUPPORTED_DISCOVERY, and it does so
 * only when the provider actually returned instruments.
 */
export function classifyFromDiscoveryResult(
  provider: string,
  result: {
    success: boolean;
    instrumentCount: number;
    error?: string;
    httpStatus?: number;
  },
  readEnv?: EnvReader,
): ProviderDiscoveryStatus {
  const base = classifyProviderDiscovery(provider, readEnv);

  // A provider with no discovery API cannot be upgraded by any result.
  if (base.status === "NO_DISCOVERY_API") return base;

  if (result.success && result.instrumentCount > 0) {
    return {
      ...base,
      status: "SUPPORTED_DISCOVERY",
      detail: `Enumerated ${result.instrumentCount} instrument(s).`,
    };
  }

  const message = (result.error ?? "").toLowerCase();
  const status = result.httpStatus;

  if (status === 401 || status === 403 || /unauthor|forbidden|invalid api key|apikey/.test(message)) {
    return {
      ...base,
      status: "AUTH_FAILED",
      detail: result.error ?? `Provider rejected credentials (HTTP ${status}).`,
    };
  }

  if (status === 429 || /rate limit|too many requests|throttl/.test(message)) {
    return {
      ...base,
      status: "RATE_LIMITED",
      detail: result.error ?? "Provider rate limited this request.",
    };
  }

  if (base.status === "NOT_CONFIGURED") return base;

  return {
    ...base,
    status: "CONFIGURED_BUT_UNAVAILABLE",
    detail:
      result.error ??
      (result.success
        ? "Provider responded successfully but enumerated no instruments."
        : "Discovery call did not succeed."),
  };
}

/**
 * Summarise which asset classes have a PROVEN discovery source.
 *
 * Only SUPPORTED_DISCOVERY counts. An asset class covered solely by a
 * provider that is rate limited or unconfigured is reported as NOT covered,
 * because we did not actually enumerate it.
 */
export function provenDiscoveryCoverage(
  statuses: readonly ProviderDiscoveryStatus[],
): Record<string, string[]> {
  const coverage: Record<string, string[]> = {};
  for (const s of statuses) {
    if (!isDiscoveryProven(s.status)) continue;
    for (const assetClass of s.assetClasses) {
      (coverage[assetClass] ??= []).push(s.provider);
    }
  }
  return coverage;
}
