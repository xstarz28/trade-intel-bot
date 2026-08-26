/**
 * Phase 44 — Provider Capability Model & Routing
 *
 * Each provider declares what it can actually provide.
 * Routing determines which provider can serve a given capability
 * for a given instrument.
 *
 * CRITICAL RULES:
 *   - Provider availability NEVER becomes directional evidence.
 *   - If no provider supports a capability → explicit UNAVAILABLE.
 *   - Never fabricate a fallback.
 *   - Never silently substitute one provider for another's semantic role.
 */

import type {
  AssetClass,
  CanonicalInstrument,
  CapabilityQuality,
  DataCapability,
  ProviderCapability,
  ProviderProfile,
  ProviderRoute,
  RouteResult,
} from "./types";
import { resolveInstrument, getProviderSymbol } from "./instruments";

// ═══════════════════════════════════════════════════════════════
// PROVIDER PROFILES
// ═══════════════════════════════════════════════════════════════

const PROVIDER_PROFILES: ProviderProfile[] = [
  {
    id: "twelve-data",
    name: "Twelve Data",
    authRequired: true,
    credentialsAvailable: true, // configured in env
    rateLimitPerMinute: 800,
    timeoutMs: 15000,
    retryConfig: { maxRetries: 2, backoffMs: 1000 },
    assetClasses: ["crypto", "forex", "equity", "commodity", "indices"],
    capabilities: [
      { capability: "ohlcv", quality: "FULL", assetClasses: ["crypto", "forex", "equity", "commodity", "indices"] },
      { capability: "quote", quality: "FULL", assetClasses: ["crypto", "forex", "equity", "commodity", "indices"] },
    ],
  },
  {
    id: "alpha-vantage",
    name: "Alpha Vantage",
    authRequired: true,
    credentialsAvailable: true,
    rateLimitPerMinute: 5,
    timeoutMs: 20000,
    retryConfig: { maxRetries: 1, backoffMs: 5000 },
    assetClasses: ["forex", "equity"],
    capabilities: [
      { capability: "ohlcv", quality: "FULL", assetClasses: ["forex", "equity"] },
      { capability: "earnings", quality: "FULL", assetClasses: ["equity"] },
      { capability: "financial_statements", quality: "FULL", assetClasses: ["equity"] },
      { capability: "valuation", quality: "PARTIAL", assetClasses: ["equity"] },
      { capability: "news", quality: "FULL", assetClasses: ["forex", "equity"] },
      { capability: "sentiment", quality: "PARTIAL", assetClasses: ["forex", "equity"] },
      { capability: "macroeconomic_data", quality: "PARTIAL", assetClasses: ["forex"] },
    ],
  },
  {
    id: "coingecko",
    name: "CoinGecko",
    authRequired: false,
    credentialsAvailable: true,
    rateLimitPerMinute: 30,
    timeoutMs: 15000,
    retryConfig: { maxRetries: 2, backoffMs: 2000 },
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "quote", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "tokenomics", quality: "PARTIAL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "coinglass",
    name: "CoinGlass",
    authRequired: true,
    credentialsAvailable: false, // requires user-provided key
    rateLimitPerMinute: 60,
    timeoutMs: 15000,
    retryConfig: { maxRetries: 2, backoffMs: 1000 },
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "open_interest", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "funding_rate", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "liquidations", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "long_short_positioning", quality: "FULL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "defillama",
    name: "DeFiLlama",
    authRequired: false,
    credentialsAvailable: true,
    rateLimitPerMinute: 30,
    timeoutMs: 15000,
    retryConfig: { maxRetries: 2, backoffMs: 2000 },
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "tvl", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "defi_fees", quality: "FULL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "tokenomist",
    name: "Tokenomist",
    authRequired: false,
    credentialsAvailable: true,
    rateLimitPerMinute: 30,
    timeoutMs: 15000,
    retryConfig: { maxRetries: 2, backoffMs: 2000 },
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "tokenomics", quality: "FULL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "tickatlas",
    name: "TickAtlas",
    authRequired: true,
    credentialsAvailable: false,
    rateLimitPerMinute: 60,
    timeoutMs: 15000,
    retryConfig: { maxRetries: 2, backoffMs: 1000 },
    assetClasses: ["forex", "equity", "commodity", "crypto"],
    capabilities: [
      { capability: "economic_calendar", quality: "FULL", assetClasses: ["forex", "equity", "commodity", "crypto"] },
    ],
  },
  {
    id: "treasury",
    name: "US Treasury",
    authRequired: false,
    credentialsAvailable: true,
    rateLimitPerMinute: 10,
    timeoutMs: 20000,
    retryConfig: { maxRetries: 2, backoffMs: 3000 },
    assetClasses: ["macro", "forex"],
    capabilities: [
      { capability: "yield_curves", quality: "FULL", assetClasses: ["macro", "forex"] },
      { capability: "interest_rates", quality: "FULL", assetClasses: ["macro", "forex"] },
    ],
  },
  {
    id: "cftc",
    name: "CFTC",
    authRequired: false,
    credentialsAvailable: true,
    rateLimitPerMinute: 5,
    timeoutMs: 30000,
    retryConfig: { maxRetries: 2, backoffMs: 5000 },
    assetClasses: ["forex", "commodity", "indices"],
    capabilities: [
      { capability: "cot_positioning", quality: "FULL", assetClasses: ["forex", "commodity", "indices"] },
    ],
  },
  {
    id: "eia",
    name: "EIA",
    authRequired: true,
    credentialsAvailable: false,
    rateLimitPerMinute: 5,
    timeoutMs: 20000,
    retryConfig: { maxRetries: 1, backoffMs: 5000 },
    assetClasses: ["commodity"],
    capabilities: [
      { capability: "inventory", quality: "FULL", assetClasses: ["commodity"] },
      { capability: "supply_demand", quality: "PARTIAL", assetClasses: ["commodity"] },
    ],
  },
  {
    id: "okx",
    name: "OKX",
    authRequired: false,
    credentialsAvailable: true,
    rateLimitPerMinute: 60,
    timeoutMs: 15000,
    retryConfig: { maxRetries: 2, backoffMs: 1000 },
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "ohlcv", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "quote", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "order_book", quality: "PARTIAL", assetClasses: ["crypto"] },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════════════

/**
 * Find all providers that can serve a given capability for a given instrument.
 * Returns routes sorted by quality descending.
 */
export function findProviderRoutes(
  instrument: string,
  capability: DataCapability,
): RouteResult {
  const canonical = resolveInstrument(instrument);
  const assetClass = canonical?.assetClass ?? "unknown";

  if (assetClass === "unknown") {
    return {
      instrument,
      assetClass: "unknown" as AssetClass,
      capability,
      routes: [],
      available: false,
      unavailableReason: `Instrument "${instrument}" is not registered in the universal instrument registry.`,
    };
  }

  const routes: ProviderRoute[] = [];

  for (const provider of PROVIDER_PROFILES) {
    // Check if provider supports this asset class
    if (!provider.assetClasses.includes(assetClass)) continue;

    // Check if provider has the requested capability
    const providerCap = provider.capabilities.find(
      (c) => c.capability === capability && c.assetClasses.includes(assetClass),
    );
    if (!providerCap) continue;

    // Check if provider has a mapping for this specific instrument
    const symbol = getProviderSymbol(instrument, provider.id);

    routes.push({
      providerId: provider.id,
      providerName: provider.name,
      capability,
      quality: symbol ? providerCap.quality : "UNAVAILABLE",
      credentialsAvailable: provider.credentialsAvailable,
      maxFreshnessMs: providerCap.maxFreshnessMs,
    });
  }

  // Sort by quality: FULL > PARTIAL > DEGRADED > UNAVAILABLE
  const qualityOrder: Record<CapabilityQuality, number> = {
    FULL: 0,
    PARTIAL: 1,
    DEGRADED: 2,
    UNAVAILABLE: 3,
  };
  routes.sort((a, b) => qualityOrder[a.quality] - qualityOrder[b.quality]);

  const availableRoutes = routes.filter((r) => r.quality !== "UNAVAILABLE" && r.credentialsAvailable);

  return {
    instrument,
    assetClass,
    capability,
    routes,
    available: availableRoutes.length > 0,
    unavailableReason: availableRoutes.length === 0
      ? `No provider with available credentials supports "${capability}" for "${instrument}" (${assetClass}).`
      : undefined,
  };
}

/**
 * Get all providers registered in the system.
 */
export function getAllProviders(): ProviderProfile[] {
  return [...PROVIDER_PROFILES];
}

/**
 * Get a specific provider profile.
 */
export function getProviderProfile(providerId: string): ProviderProfile | undefined {
  return PROVIDER_PROFILES.find((p) => p.id === providerId);
}

/**
 * Get all capabilities declared for a given asset class across all providers.
 */
export function getCapabilitiesForAssetClass(assetClass: AssetClass): DataCapability[] {
  const caps = new Set<DataCapability>();
  for (const provider of PROVIDER_PROFILES) {
    if (!provider.assetClasses.includes(assetClass)) continue;
    for (const cap of provider.capabilities) {
      if (cap.assetClasses.includes(assetClass)) {
        caps.add(cap.capability);
      }
    }
  }
  return Array.from(caps);
}

/**
 * Check if a specific provider supports a specific capability for an instrument.
 */
export function providerSupportsCapability(
  providerId: string,
  capability: DataCapability,
  instrument: string,
): boolean {
  const provider = PROVIDER_PROFILES.find((p) => p.id === providerId);
  if (!provider) return false;

  const canonical = resolveInstrument(instrument);
  if (!canonical) return false;

  return provider.assetClasses.includes(canonical.assetClass) &&
    provider.capabilities.some(
      (c) => c.capability === capability && c.assetClasses.includes(canonical.assetClass),
    );
}
