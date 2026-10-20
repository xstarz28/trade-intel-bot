/**
 * Phase 45 — Provider Routing Engine
 *
 * Capability-aware routing with:
 *   - Provider health tracking
 *   - Rate limit awareness
 *   - Fallback priority
 *   - Credential awareness
 *   - Health degradation
 *
 * CRITICAL: Provider availability NEVER becomes directional evidence.
 */

import type {
  AssetClass,
  DataCapability,
} from "./types";
import type {
  ProviderHealthRecord,
  EnhancedProviderRoute,
  ProviderStatus,
  RoutingResult,
} from "./engine-types";
import { resolveInstrument } from "./instruments";

// ═══════════════════════════════════════════════════════════════
// PROVIDER HEALTH STORE (in-memory, module-level)
// ═══════════════════════════════════════════════════════════════

const healthStore: Map<string, ProviderHealthRecord> = new Map();

function getHealthKey(providerId: string): string {
  return providerId;
}

/**
 * Record a provider health event.
 */
export function recordProviderHealth(params: {
  providerId: string;
  status: ProviderStatus;
  error?: string;
  responseTimeMs?: number;
}): void {
  const key = getHealthKey(params.providerId);
  const existing = healthStore.get(key);
  const now = Date.now();

  if (existing) {
    const consecutiveFailures =
      params.status === "UNAVAILABLE" || params.status === "DEGRADED"
        ? existing.consecutiveFailures + 1
        : 0;
    healthStore.set(key, {
      ...existing,
      lastCheckedAt: now,
      status: params.status,
      consecutiveFailures,
      lastError: params.error,
      avgResponseTimeMs: params.responseTimeMs !== undefined
        ? (existing.avgResponseTimeMs ?? params.responseTimeMs) * 0.7 + params.responseTimeMs * 0.3
        : existing.avgResponseTimeMs,
    });
  } else {
    healthStore.set(key, {
      providerId: params.providerId,
      lastCheckedAt: now,
      status: params.status,
      consecutiveFailures:
        params.status === "UNAVAILABLE" || params.status === "DEGRADED" ? 1 : 0,
      lastError: params.error,
      avgResponseTimeMs: params.responseTimeMs,
    });
  }
}

/**
 * Get health record for a provider.
 */
export function getProviderHealth(providerId: string): ProviderHealthRecord | undefined {
  return healthStore.get(getHealthKey(providerId));
}

/**
 * Reset health store (for testing).
 */
export function resetProviderHealth(): void {
  healthStore.clear();
}

/**
 * Mark provider as rate-limited with a reset timestamp.
 */
export function markRateLimited(providerId: string, resetAt: number): void {
  const key = getHealthKey(providerId);
  const existing = healthStore.get(key);
  healthStore.set(key, {
    providerId,
    lastCheckedAt: Date.now(),
    status: "RATE_LIMITED",
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
    rateLimitResetAt: resetAt,
  });
}

// ═══════════════════════════════════════════════════════════════
// ROUTING ENGINE
// ═══════════════════════════════════════════════════════════════

// Provider profiles — same as Phase 44 but used by the routing engine
interface ProviderSpec {
  id: string;
  name: string;
  authRequired: boolean;
  credentialsAvailable: boolean;
  rateLimitPerMinute?: number;
  timeoutMs: number;
  assetClasses: AssetClass[];
  capabilities: { capability: DataCapability; quality: string; assetClasses: AssetClass[] }[];
  priority: number; // lower = higher priority for same capability
}

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: "twelve-data", name: "Twelve Data", authRequired: true, credentialsAvailable: true,
    rateLimitPerMinute: 800, timeoutMs: 15000, priority: 10,
    assetClasses: ["crypto", "forex", "equity", "commodity", "indices"],
    capabilities: [
      { capability: "ohlcv", quality: "FULL", assetClasses: ["crypto", "forex", "equity", "commodity", "indices"] },
      { capability: "quote", quality: "FULL", assetClasses: ["crypto", "forex", "equity", "commodity", "indices"] },
    ],
  },
  {
    id: "alpha-vantage", name: "Alpha Vantage", authRequired: true, credentialsAvailable: true,
    rateLimitPerMinute: 5, timeoutMs: 20000, priority: 20,
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
    id: "coingecko", name: "CoinGecko", authRequired: false, credentialsAvailable: true,
    rateLimitPerMinute: 30, timeoutMs: 15000, priority: 15,
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "quote", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "tokenomics", quality: "PARTIAL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "coinglass", name: "CoinGlass", authRequired: true, credentialsAvailable: false,
    rateLimitPerMinute: 60, timeoutMs: 15000, priority: 5,
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "open_interest", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "funding_rate", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "liquidations", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "long_short_positioning", quality: "FULL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "defillama", name: "DeFiLlama", authRequired: false, credentialsAvailable: true,
    rateLimitPerMinute: 30, timeoutMs: 15000, priority: 15,
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "tvl", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "defi_fees", quality: "FULL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "tokenomist", name: "Tokenomist", authRequired: false, credentialsAvailable: true,
    rateLimitPerMinute: 30, timeoutMs: 15000, priority: 15,
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "tokenomics", quality: "FULL", assetClasses: ["crypto"] },
    ],
  },
  {
    id: "tickatlas", name: "TickAtlas", authRequired: true, credentialsAvailable: false,
    rateLimitPerMinute: 60, timeoutMs: 15000, priority: 10,
    assetClasses: ["forex", "equity", "commodity", "crypto"],
    capabilities: [
      { capability: "economic_calendar", quality: "FULL", assetClasses: ["forex", "equity", "commodity", "crypto"] },
    ],
  },
  {
    id: "treasury", name: "US Treasury", authRequired: false, credentialsAvailable: true,
    rateLimitPerMinute: 10, timeoutMs: 20000, priority: 5,
    assetClasses: ["macro", "forex"],
    capabilities: [
      { capability: "yield_curves", quality: "FULL", assetClasses: ["macro", "forex"] },
      { capability: "interest_rates", quality: "FULL", assetClasses: ["macro", "forex"] },
    ],
  },
  {
    id: "cftc", name: "CFTC", authRequired: false, credentialsAvailable: true,
    rateLimitPerMinute: 5, timeoutMs: 30000, priority: 5,
    assetClasses: ["forex", "commodity", "indices"],
    capabilities: [
      { capability: "cot_positioning", quality: "FULL", assetClasses: ["forex", "commodity", "indices"] },
    ],
  },
  {
    id: "eia", name: "EIA", authRequired: true, credentialsAvailable: false,
    rateLimitPerMinute: 5, timeoutMs: 20000, priority: 5,
    assetClasses: ["commodity"],
    capabilities: [
      { capability: "inventory", quality: "FULL", assetClasses: ["commodity"] },
      { capability: "supply_demand", quality: "PARTIAL", assetClasses: ["commodity"] },
    ],
  },
  {
    id: "okx", name: "OKX", authRequired: false, credentialsAvailable: true,
    rateLimitPerMinute: 60, timeoutMs: 15000, priority: 20,
    assetClasses: ["crypto"],
    capabilities: [
      { capability: "ohlcv", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "quote", quality: "FULL", assetClasses: ["crypto"] },
      { capability: "order_book", quality: "PARTIAL", assetClasses: ["crypto"] },
    ],
  },
];

/**
 * Compute provider status for a given routing context.
 */
function computeProviderStatus(
  spec: ProviderSpec,
  capability: DataCapability,
  assetClass: AssetClass,
): ProviderStatus {
  // Check if provider supports this asset class
  if (!spec.assetClasses.includes(assetClass)) return "UNSUPPORTED";

  // Check if provider has this capability for this asset class
  const hasCapability = spec.capabilities.some(
    (c) => c.capability === capability && c.assetClasses.includes(assetClass),
  );
  if (!hasCapability) return "UNSUPPORTED";

  // Check health
  const health = healthStore.get(spec.id);
  if (health) {
    if (health.status === "RATE_LIMITED") {
      if (health.rateLimitResetAt && health.rateLimitResetAt > Date.now()) {
        return "RATE_LIMITED";
      }
      // Rate limit expired — treat as available
    }
    if (health.status === "DEGRADED" && health.consecutiveFailures >= 3) {
      return "DEGRADED";
    }
    if (health.status === "UNAVAILABLE") {
      return "UNAVAILABLE";
    }
  }

  // Check credentials
  if (spec.authRequired && !spec.credentialsAvailable) return "UNAVAILABLE";

  return "AVAILABLE";
}

/**
 * Route a request for a given instrument and capability.
 * Returns all candidate routes sorted by priority.
 */
export function routeProviderRequest(
  instrument: string,
  capability: DataCapability,
): RoutingResult {
  const canonical = resolveInstrument(instrument);
  const now = Date.now();

  if (!canonical) {
    return {
      instrument,
      assetClass: "macro" as AssetClass, // fallback — instrument not found
      capability,
      routes: [],
      available: false,
      unavailableReason: `Instrument "${instrument}" is not registered.`,
      routedAt: now,
    };
  }

  const assetClass = canonical.assetClass;
  const routes: EnhancedProviderRoute[] = [];

  for (const spec of PROVIDER_SPECS) {
    const status = computeProviderStatus(spec, capability, assetClass);
    if (status === "UNSUPPORTED") continue;

    const health = healthStore.get(spec.id);
    const quality = spec.capabilities.find(
      (c) => c.capability === capability && c.assetClasses.includes(assetClass),
    )?.quality ?? "UNAVAILABLE";

    routes.push({
      providerId: spec.id,
      providerName: spec.name,
      capability,
      quality: quality as any,
      credentialsAvailable: spec.authRequired ? spec.credentialsAvailable : true,
      maxFreshnessMs: undefined,
      healthStatus: status,
      avgResponseTimeMs: health?.avgResponseTimeMs,
      consecutiveFailures: health?.consecutiveFailures ?? 0,
    });
  }

  // Sort: AVAILABLE > DEGRADED > RATE_LIMITED > UNSUPPORTED > UNAVAILABLE, then by priority
  const statusOrder: Record<ProviderStatus, number> = {
    AVAILABLE: 0,
    DEGRADED: 1,
    RATE_LIMITED: 2,
    SUPPORTED: 3,
    UNAVAILABLE: 4,
    UNSUPPORTED: 5,
  };
  routes.sort((a, b) => {
    const sa = statusOrder[a.healthStatus];
    const sb = statusOrder[b.healthStatus];
    if (sa !== sb) return sa - sb;
    const pa = PROVIDER_SPECS.find((p) => p.id === a.providerId)?.priority ?? 100;
    const pb = PROVIDER_SPECS.find((p) => p.id === b.providerId)?.priority ?? 100;
    return pa - pb;
  });

  const bestRoute = routes.find((r) => r.healthStatus === "AVAILABLE");
  const anyAvailable = routes.some(
    (r) => r.healthStatus === "AVAILABLE" || r.healthStatus === "DEGRADED",
  );

  return {
    instrument,
    assetClass,
    capability,
    routes,
    bestRoute,
    available: anyAvailable,
    unavailableReason: !anyAvailable
      ? `No provider available for "${capability}" on "${instrument}" (${assetClass}).`
      : undefined,
    routedAt: now,
  };
}

/**
 * Phase 152 — Route a provider-native instrument without requiring
 * registration in the universal canonical instrument registry.
 *
 * This path is metadata/capability routing only. It never substitutes
 * the provider-native instrument ID and never creates directional evidence.
 */
export function routeProviderNativeRequest(
  providerId: string,
  capability: DataCapability,
  assetClass: AssetClass,
): EnhancedProviderRoute | undefined {
  const spec = PROVIDER_SPECS.find((p) => p.id === providerId);
  if (!spec) return undefined;

  const status = computeProviderStatus(spec, capability, assetClass);
  if (status === "UNSUPPORTED") return undefined;

  const health = healthStore.get(spec.id);
  const quality =
    spec.capabilities.find(
      (c) =>
        c.capability === capability &&
        c.assetClasses.includes(assetClass),
    )?.quality ?? "UNAVAILABLE";

  return {
    providerId: spec.id,
    providerName: spec.name,
    capability,
    quality: quality as any,
    credentialsAvailable: spec.authRequired
      ? spec.credentialsAvailable
      : true,
    maxFreshnessMs: undefined,
    healthStatus: status,
    avgResponseTimeMs: health?.avgResponseTimeMs,
    consecutiveFailures: health?.consecutiveFailures ?? 0,
  };
}

/**
 * Get all registered provider specs.
 */
export function getAllProviderSpecs(): ProviderSpec[] {
  return [...PROVIDER_SPECS];
}
