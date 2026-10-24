/**
 * Phase 59 — Provider Stream Adapters
 *
 * Registers known provider streaming capabilities.
 * Uses real provider architecture from Phase 52/53.
 * Does NOT fake WebSocket support for REST-only providers.
 *
 * Pure functions and data — no side effects.
 */

import type { StreamConfig } from "./types";

// ═══════════════════════════════════════════════════════════════
// PROVIDER CAPABILITY REGISTRY
// ═══════════════════════════════════════════════════════════════

export type StreamCapability =
  | "REALTIME_QUOTES"
  | "REALTIME_OHLCV"
  | "REALTIME_ORDERBOOK"
  | "REALTIME_FUNDING"
  | "REALTIME_OI"
  | "REALTIME_LIQUIDATION"
  | "POLLED_ONLY";

export interface ProviderStreamProfile {
  /** Provider name. */
  provider: string;
  /** Supported stream capabilities. */
  capabilities: StreamCapability[];
  /** Whether WebSocket is supported. */
  websocketSupported: boolean;
  /** REST polling fallback available. */
  pollingFallback: boolean;
  /** Max concurrent subscriptions. */
  maxSubscriptions: number;
  /** Rate limit (requests per minute for polling). */
  rateLimitPerMinute: number;
  /** Supported asset classes. */
  assetClasses: string[];
  /** Required env var for credentials (never exposed). */
  credentialEnvVars: string[];
  /** Default config. */
  defaultConfig: Partial<StreamConfig>;
}

// ═══════════════════════════════════════════════════════════════
// KNOWN PROVIDER PROFILES
// ═══════════════════════════════════════════════════════════════

const PROVIDER_PROFILES: ProviderStreamProfile[] = [
  {
    provider: "OKX",
    capabilities: ["REALTIME_QUOTES", "REALTIME_OHLCV", "REALTIME_ORDERBOOK"],
    websocketSupported: true,
    pollingFallback: true,
    maxSubscriptions: 50,
    rateLimitPerMinute: 60,
    assetClasses: ["crypto"],
    credentialEnvVars: ["OKX_API_KEY"],
    defaultConfig: {
      heartbeatIntervalMs: 15_000,
      staleThresholdMs: 30_000,
      maxBackoffMs: 16_000,
    },
  },
  {
    provider: "TwelveData",
    capabilities: ["REALTIME_QUOTES", "REALTIME_OHLCV"],
    websocketSupported: true,
    pollingFallback: true,
    maxSubscriptions: 8,
    rateLimitPerMinute: 800,
    assetClasses: ["forex", "equity", "commodity", "indices"],
    credentialEnvVars: ["TWELVE_DATA_API_KEY"],
    defaultConfig: {
      heartbeatIntervalMs: 30_000,
      staleThresholdMs: 60_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "CoinGlass",
    capabilities: ["REALTIME_FUNDING", "REALTIME_OI", "REALTIME_LIQUIDATION"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 20,
    rateLimitPerMinute: 60,
    assetClasses: ["crypto"],
    credentialEnvVars: ["COINGLASS_API_KEY"],
    defaultConfig: {
      heartbeatIntervalMs: 60_000,
      staleThresholdMs: 120_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "CoinGecko",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 30,
    assetClasses: ["crypto"],
    credentialEnvVars: [],
    defaultConfig: {
      heartbeatIntervalMs: 60_000,
      staleThresholdMs: 300_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "AlphaVantage",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 5,
    assetClasses: ["forex", "equity", "commodity"],
    credentialEnvVars: ["ALPHA_VANTAGE_API_KEY"],
    defaultConfig: {
      heartbeatIntervalMs: 120_000,
      staleThresholdMs: 600_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "DeFiLlama",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 30,
    assetClasses: ["crypto"],
    credentialEnvVars: [],
    defaultConfig: {
      heartbeatIntervalMs: 300_000,
      staleThresholdMs: 600_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "Treasury",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 10,
    assetClasses: ["macro"],
    credentialEnvVars: [],
    defaultConfig: {
      heartbeatIntervalMs: 300_000,
      staleThresholdMs: 3_600_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "CFTC",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 5,
    assetClasses: ["commodity", "forex", "indices"],
    credentialEnvVars: [],
    defaultConfig: {
      heartbeatIntervalMs: 86_400_000,
      staleThresholdMs: 86_400_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "EIA",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 5,
    assetClasses: ["commodity"],
    credentialEnvVars: ["EIA_API_KEY"],
    defaultConfig: {
      heartbeatIntervalMs: 86_400_000,
      staleThresholdMs: 86_400_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "Tokenomist",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 10,
    assetClasses: ["crypto"],
    credentialEnvVars: [],
    defaultConfig: {
      heartbeatIntervalMs: 3_600_000,
      staleThresholdMs: 3_600_000,
      maxBackoffMs: 30_000,
    },
  },
  {
    provider: "TickAtlas",
    capabilities: ["POLLED_ONLY"],
    websocketSupported: false,
    pollingFallback: true,
    maxSubscriptions: 0,
    rateLimitPerMinute: 10,
    assetClasses: ["macro"],
    credentialEnvVars: [],
    defaultConfig: {
      heartbeatIntervalMs: 300_000,
      staleThresholdMs: 600_000,
      maxBackoffMs: 30_000,
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// REGISTRY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/** Get provider profile by name. */
export function getProviderProfile(provider: string): ProviderStreamProfile | undefined {
  return PROVIDER_PROFILES.find(p => p.provider === provider);
}

/** Get all provider profiles that support a given asset class. */
export function getProvidersForAssetClass(assetClass: string): ProviderStreamProfile[] {
  return PROVIDER_PROFILES.filter(p => p.assetClasses.includes(assetClass));
}

/** Get providers that support real-time streaming for an asset class. */
export function getStreamProvidersForAssetClass(assetClass: string): ProviderStreamProfile[] {
  return PROVIDER_PROFILES.filter(
    p => p.assetClasses.includes(assetClass) && p.websocketSupported,
  );
}

/** Get providers that support a specific capability. */
export function getProvidersForCapability(capability: StreamCapability): ProviderStreamProfile[] {
  return PROVIDER_PROFILES.filter(p => p.capabilities.includes(capability));
}

/** Check if a provider is available (has a registered profile).
 *  Credential validation happens server-side in Convex actions. */
export function isProviderAvailable(provider: string): boolean {
  return getProviderProfile(provider) !== undefined;
}

/** Build default stream config for a provider. */
export function buildStreamConfig(
  provider: string,
  instruments: string[],
): StreamConfig {
  const profile = getProviderProfile(provider);
  return {
    provider,
    instruments,
    maxReconnectAttempts: 10,
    heartbeatIntervalMs: profile?.defaultConfig.heartbeatIntervalMs ?? 30_000,
    staleThresholdMs: profile?.defaultConfig.staleThresholdMs ?? 60_000,
    requestTimeoutMs: 15_000,
    maxBackoffMs: profile?.defaultConfig.maxBackoffMs ?? 30_000,
  };
}

/** Get recommended poll interval for a provider (ms). */
export function getPollIntervalMs(provider: string): number {
  const profile = getProviderProfile(provider);
  if (!profile) return 60_000;
  if (profile.capabilities.includes("POLLED_ONLY")) {
    // Respect rate limit
    return Math.max(60_000 / profile.rateLimitPerMinute, 1_000);
  }
  return 5_000; // WebSocket providers get a health-check poll
}

/** All registered providers. */
export function getAllProviders(): ProviderStreamProfile[] {
  return [...PROVIDER_PROFILES];
}
