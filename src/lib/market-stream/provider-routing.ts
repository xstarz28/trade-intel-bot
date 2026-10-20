/**
 * Phase 65 — Provider Routing
 *
 * Deterministic routing from instrument/asset class to the best available provider.
 * Includes fallback chain when primary provider fails.
 *
 * Pure functions — no side effects.
 * Never fabricates provider availability.
 */

import {
  getProviderProfile,
  getPollIntervalMs,
  type ProviderStreamProfile,
} from "./provider-adapters";
import type { DataSourceMode } from "./live-market-bridge";

// ═══════════════════════════════════════════════════════════════
// ROUTING RESULT
// ═══════════════════════════════════════════════════════════════

export interface ProviderRoute {
  /** Selected provider name. */
  provider: string;
  /** Why this provider was selected. */
  reason: string;
  /** Polling interval in ms. */
  pollIntervalMs: number;
  /** Provider capabilities. */
  capabilities: string[];
  /** Provider mode. */
  mode: DataSourceMode;
  /** Data freshness expectation. */
  freshness: "LIVE" | "DELAYED" | "SLOW";
  /** Required credentials that may be missing. */
  requiredCredentials: string[];
}

export interface RoutingResult {
  /** Primary route. */
  primary: ProviderRoute | null;
  /** Fallback routes in priority order. */
  fallbacks: ProviderRoute[];
  /** All available providers for this instrument. */
  available: ProviderRoute[];
  /** Routing reason. */
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT → ASSET CLASS MAPPING
// ═══════════════════════════════════════════════════════════════

const INSTRUMENT_ASSET_CLASS: Record<string, string> = {
  // Crypto
  "BTC/USDT": "crypto",
  "ETH/USDT": "crypto",
  "SOL/USDT": "crypto",
  "BNB/USDT": "crypto",
  "XRP/USDT": "crypto",
  "DOGE/USDT": "crypto",
  "ADA/USDT": "crypto",
  "AVAX/USDT": "crypto",
  "DOT/USDT": "crypto",
  "LINK/USDT": "crypto",
  "MATIC/USDT": "crypto",
  "UNI/USDT": "crypto",
  // Forex
  "EUR/USD": "forex",
  "GBP/USD": "forex",
  "USD/JPY": "forex",
  "AUD/USD": "forex",
  "USD/CHF": "forex",
  "USD/CAD": "forex",
  "NZD/USD": "forex",
  "EUR/GBP": "forex",
  "EUR/JPY": "forex",
  "GBP/JPY": "forex",
  // Commodities
  "XAU/USD": "commodity",
  "XAG/USD": "commodity",
  "WTI/USD": "commodity",
  "BRENT/USD": "commodity",
  // Indices
  "US500": "indices",
  "US30": "indices",
  "US100": "indices",
  "DE40": "indices",
  "UK100": "indices",
  "JP225": "indices",
  "IHSG": "indices",
  // Macro
  "DXY": "macro",
  "US10Y": "macro",
  "US2Y": "macro",
  "VIX": "macro",
};

// ═══════════════════════════════════════════════════════════════
// ASSET CLASS → PROVIDER PRIORITY
// ═══════════════════════════════════════════════════════════════

const ASSET_CLASS_PROVIDER_PRIORITY: Record<string, string[]> = {
  crypto: ["OKX", "TwelveData", "CoinGecko"],
  forex: ["TwelveData", "AlphaVantage"],
  equity: ["TwelveData", "AlphaVantage"],
  commodity: ["TwelveData", "AlphaVantage"],
  indices: ["TwelveData", "AlphaVantage"],
  macro: ["Treasury", "TickAtlas"],
};

// ═══════════════════════════════════════════════════════════════
// ROUTING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Detect asset class from instrument symbol.
 */
export function detectAssetClass(instrument: string): string {
  const normalized = instrument.toUpperCase().trim();

  // Direct lookup
  if (INSTRUMENT_ASSET_CLASS[normalized]) {
    return INSTRUMENT_ASSET_CLASS[normalized];
  }

  // Pattern-based detection. Recognize common crypto bases explicitly before
  // considering fiat pairs (e.g. BTC/USD must never be routed as forex).
  if (/^(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX|DOT|LINK|MATIC|UNI)\/(USD|USDT|USDC|BTC|ETH)$/.test(normalized) ||
      normalized.endsWith("/USDT") || normalized.endsWith("/USDC") ||
      normalized.endsWith("/BTC") || normalized.endsWith("/ETH")) {
    return "crypto";
  }
  if (normalized.includes("/")) {
    const parts = normalized.split("/");
    const fiatCurrencies = new Set([
      "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD",
      "CNY", "CNH", "HKD", "SGD", "INR", "IDR", "KRW", "THB",
      "MYR", "PHP", "VND", "TRY", "MXN", "ZAR", "SEK", "NOK",
      "DKK", "PLN", "CZK", "HUF", "ILS", "AED", "SAR",
    ]);
    if (parts.length === 2 && parts.every(p => fiatCurrencies.has(p))) {
      return "forex";
    }
  }
  if (/^(BBCA|BBRI|TLKM|BMRI|BBNI|GOTO|IDX)/.test(normalized)) {
    return "equity";
  }
  if (/^(XAU|XAG|WTI|BRENT|GOLD|SILVER|CRUDE|OIL)/.test(normalized)) {
    return "commodity";
  }
  if (/^(US|DE|UK|JP|FR|EU)\d/.test(normalized) || normalized === "IHSG") {
    return "indices";
  }
  if (/^(DXY|US\d+Y|VIX|TNX)/.test(normalized)) {
    return "macro";
  }

  // Unknown symbols must not silently select a crypto provider. The caller can
  // supply an explicit assetClassOverride when the symbol is ambiguous.
  return "unknown";
}

/**
 * Route an instrument to the best provider.
 */
export function routeInstrument(
  instrument: string,
  assetClassOverride?: string,
  availableProviders?: Set<string>,
): RoutingResult {
  const assetClass = assetClassOverride ?? detectAssetClass(instrument);
  const priorities = ASSET_CLASS_PROVIDER_PRIORITY[assetClass] ?? [];

  const allRoutes: ProviderRoute[] = [];

  for (const providerName of priorities) {
    const profile = getProviderProfile(providerName);
    if (!profile) continue;
    if (!profile.assetClasses.includes(assetClass)) continue;
    if (availableProviders && !availableProviders.has(providerName)) continue;

    const route = buildRoute(profile, assetClass);
    allRoutes.push(route);
  }

  const primary = allRoutes.length > 0 ? allRoutes[0] : null;
  const fallbacks = allRoutes.slice(1);

  return {
    primary,
    fallbacks,
    available: allRoutes,
    reason: primary
      ? `Routed to ${primary.provider} for ${assetClass} instrument.`
      : `No available provider for ${assetClass} instrument "${instrument}".`,
  };
}

/**
 * Get the best fallback provider when primary fails.
 */
export function getFallbackRoute(
  routing: RoutingResult,
  failedProvider: string,
): ProviderRoute | null {
  // Check fallbacks
  for (const fb of routing.fallbacks) {
    if (fb.provider !== failedProvider) {
      return fb;
    }
  }
  return null;
}

/**
 * Build a route for a specific provider profile.
 */
function buildRoute(
  profile: ProviderStreamProfile,
  assetClass: string,
): ProviderRoute {
  const pollInterval = getPollIntervalMs(profile.provider);
  // This route currently configures polling (mode below is POLLING), so a
  // provider's WebSocket capability alone is not evidence that this instrument
  // is being consumed over a live socket. Report the actual route's cadence.
  const freshness: ProviderRoute["freshness"] =
    pollInterval <= 60_000 ? "DELAYED" : "SLOW";

  return {
    provider: profile.provider,
    reason: `${profile.provider} supports ${assetClass} (${profile.capabilities.join(", ")})`,
    pollIntervalMs: pollInterval,
    capabilities: profile.capabilities,
    mode: "POLLING",
    freshness,
    requiredCredentials: profile.credentialEnvVars,
  };
}

/**
 * Check whether a provider is recognized by the routing registry.
 * This does not validate credentials: secrets are checked server-side in Convex actions.
 */
export function checkProviderCredentials(provider: string): boolean {
  return getProviderProfile(provider) !== undefined;
}

/**
 * Get all instruments that need polling for a set of active positions.
 */
export function getActiveInstruments(
  positions: Array<{ instrument: string; side: string }>,
): Map<string, { instrument: string; assetClass: string; route: ProviderRoute | null }> {
  const result = new Map<string, { instrument: string; assetClass: string; route: ProviderRoute | null }>();

  for (const pos of positions) {
    const normalized = pos.instrument.toUpperCase().trim();
    if (result.has(normalized)) continue;

    const routing = routeInstrument(normalized);
    result.set(normalized, {
      instrument: normalized,
      assetClass: detectAssetClass(normalized),
      route: routing.primary,
    });
  }

  return result;
}
