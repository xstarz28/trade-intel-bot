/**
 * Phase 235 — Universal Provider Contract
 *
 * Extensible adapter contract so Xstarz Analysis is not architecturally
 * bound to Twelve Data + OKX. Any provider that genuinely lists instruments
 * can be added without changing the engine core.
 *
 * Invariants (must never be violated):
 * - No hardcoded ticker whitelist.
 * - No hardcoded exchange whitelist as source of truth (CCXT uses ccxt.exchanges).
 * - No symbol substitution/alias.
 * - Discovery metadata ≠ live evidence.
 * - Historical/EOD/delayed never labeled live.
 * - Provider failure explicit.
 * - Credentials only via server-side credential mechanism.
 * - Providers requiring license but without credential → UNAVAILABLE / REQUIRES_LICENSE, not fake-success.
 * - No scraping private/mobile/internal endpoints.
 * - Preserve Phase 234 completeness semantics.
 * - Discovery scalable; no full-live acquisition during discovery.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type {
  DiscoveredInstrument,
  ProviderDiscoveryResult,
} from "./types";
import type { DiscoveryCompleteness } from "./completeness";

// ────────────────────────────────────────────────────────────────
// CAPABILITIES
// ────────────────────────────────────────────────────────────────

export type ProviderCapability =
  | "discovery"
  | "ohlcv"
  | "quote"
  | "order_book"
  | "trades"
  | "derivatives"
  | "funding"
  | "open_interest"
  | "liquidations"
  | "news"
  | "fundamentals"
  | "corporate_actions"
  | "on_chain"
  | "macro"
  | "tvl"
  | "economic_calendar"
  | "yield_curve"
  | "inventory"
  | "eod"
  | "delayed"
  | "realtime";

export type ProviderLiveCapability = Exclude<ProviderCapability, "discovery">;

// ────────────────────────────────────────────────────────────────
// STATUS
// ────────────────────────────────────────────────────────────────

export type ProviderOperationalStatus =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "REQUIRES_LICENSE"
  | "REQUIRES_CREDENTIAL"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "PARTIAL"
  | "FAILED";

// ────────────────────────────────────────────────────────────────
// PROVIDER ADAPTER
// ────────────────────────────────────────────────────────────────

export interface ProviderMetadata {
  providerId: string;
  displayName: string;
  assetClasses: AssetClass[];
  capabilities: ProviderCapability[];
  /** Whether this provider needs license/credential for live data */
  requiresLicense?: boolean;
  requiresCredential?: boolean;
  /** Human-readable note about licensing */
  licenseNote?: string;
  /** Whether discovery is supported */
  discoverySupported: boolean;
  /** Whether live acquisition is supported */
  liveSupported: boolean;
}

export interface UniversalProviderAdapter {
  /** Exact provider id, e.g. "twelve-data", "okx", "ccxt:binance", "dexscreener", "geckoterminal", "idx" */
  providerId: string;
  /** Display name for UI */
  displayName: string;
  /** Asset classes this adapter can genuinely discover */
  assetClasses: AssetClass[];
  /** Capabilities this provider genuinely supports */
  capabilities: ProviderCapability[];
  /** Current operational status */
  status: ProviderOperationalStatus;
  /** Whether discovery is implemented */
  discoverySupported: boolean;
  /** Whether live acquisition is implemented */
  liveSupported: boolean;

  /** Discovery — must never throw, failures returned explicitly */
  discover?: (now: number) => Promise<ProviderDiscoveryResult>;

  /** Optional: classify failure for UI */
  classifyFailure?: (error: unknown) => ProviderOperationalStatus;
}

// ────────────────────────────────────────────────────────────────
// DEX / ON-CHAIN IDENTITY
// ────────────────────────────────────────────────────────────────

export interface DexPoolIdentity {
  chain: string;
  network?: string;
  dex: string;
  poolAddress: string;
  pairAddress?: string;
  baseTokenAddress: string;
  quoteTokenAddress: string;
  baseSymbol: string;
  quoteSymbol: string;
  providerNativeId: string;
}

// ────────────────────────────────────────────────────────────────
// IDX
// ────────────────────────────────────────────────────────────────

export type IdxMarketDataLevel = "EOD" | "DELAYED" | "REALTIME";

export interface IdxProviderStatus {
  level: IdxMarketDataLevel;
  status: ProviderOperationalStatus;
  requiresLicense: boolean;
  note: string;
}

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────

export function isLiveCapability(cap: ProviderCapability): boolean {
  return cap !== "discovery";
}

export function providerSupports(
  adapter: UniversalProviderAdapter,
  capability: ProviderCapability,
): boolean {
  return adapter.capabilities.includes(capability);
}

export function providerSupportsAssetClass(
  adapter: UniversalProviderAdapter,
  assetClass: AssetClass,
): boolean {
  return adapter.assetClasses.includes(assetClass);
}

/**
 * Provider id helpers — preserve exact native identity, never canonicalize.
 * Example: "ccxt:binance" + "BTC/USDT" stays distinct from "okx::BTC-USDT"
 */
export function ccxtProviderId(exchangeId: string): string {
  return `ccxt:${exchangeId}`;
}

export function parseCcxtProviderId(providerId: string): string | null {
  if (!providerId.startsWith("ccxt:")) return null;
  return providerId.slice(5);
}

/**
 * DEX provider ids are fixed, but pool identity is dynamic.
 * Pool A/B and Pool C/D are NOT same instrument even if token pair same.
 */
export function dexProviderId(source: "dexscreener" | "geckoterminal"): string {
  return source;
}

/**
 * IDX provider id is fixed, but instruments are discovered.
 */
export const IDX_PROVIDER_ID = "idx";
export const STOCKBIT_PROVIDER_ID = "stockbit";
export const AJAIB_PROVIDER_ID = "ajaib";

// ────────────────────────────────────────────────────────────────
// COMPLETENESS PRESERVATION (Phase 234)
// ────────────────────────────────────────────────────────────────

export type { DiscoveryCompleteness };
export type { ProviderDiscoveryResult, DiscoveredInstrument };

/**
 * Convert legacy ProviderDiscoveryAdapter to UniversalProviderAdapter
 * so old adapters keep working inside new registry.
 */
export function legacyToUniversal(
  legacy: {
    provider: string;
    assetClasses: AssetClass[];
    discover: (now: number) => Promise<ProviderDiscoveryResult>;
  },
  opts: {
    displayName: string;
    capabilities: ProviderCapability[];
    discoverySupported?: boolean;
    liveSupported?: boolean;
    status?: ProviderOperationalStatus;
  },
): UniversalProviderAdapter {
  return {
    providerId: legacy.provider,
    displayName: opts.displayName,
    assetClasses: legacy.assetClasses,
    capabilities: opts.capabilities,
    status: opts.status ?? "AVAILABLE",
    discoverySupported: opts.discoverySupported ?? true,
    liveSupported: opts.liveSupported ?? true,
    discover: legacy.discover,
  };
}
