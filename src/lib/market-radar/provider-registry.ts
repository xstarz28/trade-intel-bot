/**
 * Phase 52 — Live Provider Adapter Registry
 *
 * Connects the existing Phase 46 live provider execution system
 * to the Market Radar. Manages provider health, rate limits,
 * and instrument-to-provider routing.
 *
 * CRITICAL INVARIANTS:
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing credentials → explicit UNAVAILABLE state.
 *   - Never fabricate data when provider fails.
 *   - Never expose credentials to UI or logs.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import {
  executeLiveRequest,
  type LiveRequestParams,
  type LiveRequestResult,
  type Transport,
} from "@/lib/data/universal/live/client";
import {
  checkCredentials,
  type EnvReader,
} from "@/lib/data/universal/live/credentials";
import { type LiveStatus, isLiveStatus } from "@/lib/data/universal/live/types";
import type { RadarCandidateSource } from "@/lib/market-radar/candidate-builder";
import type { MarketSnapshot, FreshnessLevel } from "@/lib/market-radar/types";
import { assessFreshness } from "@/lib/market-radar/freshness";

// ═══════════════════════════════════════════════════════════════
// PROVIDER HEALTH STATE
// ═══════════════════════════════════════════════════════════════

export type ProviderHealthStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "AUTH_ERROR"
  | "MALFORMED_RESPONSE";

export interface ProviderHealth {
  status: ProviderHealthStatus;
  lastRequestAt: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  avgLatencyMs: number;
  cooldownUntil: number;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER ADAPTER
// ═══════════════════════════════════════════════════════════════

export interface ProviderAdapter {
  id: string;
  name: string;
  supportedAssetClasses: AssetClass[];
  capabilities: string[];
  isAvailable(readEnv?: EnvReader): boolean;
  fetch(instrument: string, assetClass: AssetClass, readEnv?: EnvReader): Promise<MarketSnapshot | null>;
  getHealth(): ProviderHealth;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT TRANSPORT
// ═══════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT_MS = 10_000;

async function defaultTransport(url: string): Promise<{ ok: boolean; status: number; json?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, status: res.status };
    try {
      const json = await res.json();
      return { ok: true, status: res.status, json };
    } catch {
      return { ok: false, status: res.status };
    }
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// ADAPTER BUILDER
// ═══════════════════════════════════════════════════════════════

function buildAdapter(
  id: string,
  name: string,
  assetClasses: AssetClass[],
  capabilities: string[],
  fetchFn: (instrument: string, assetClass: AssetClass, readEnv?: EnvReader) => Promise<MarketSnapshot | null>,
): ProviderAdapter {
  const health: ProviderHealth = {
    status: "HEALTHY",
    lastRequestAt: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    totalRequests: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    avgLatencyMs: 0,
    cooldownUntil: 0,
  };

  return {
    id,
    name,
    supportedAssetClasses: assetClasses,
    capabilities,
    isAvailable: (readEnv?: EnvReader) => {
      const cred = checkCredentials(id, readEnv);
      if (cred && cred.authRequired && !cred.available) return false;
      if (Date.now() < health.cooldownUntil) return false;
      return health.status !== "UNAVAILABLE";
    },
    fetch: async (instrument: string, assetClass: AssetClass, readEnv?: EnvReader) => {
      health.totalRequests++;
      health.lastRequestAt = Date.now();
      const t0 = Date.now();
      try {
        const result = await fetchFn(instrument, assetClass, readEnv);
        const latency = Date.now() - t0;
        health.avgLatencyMs = (health.avgLatencyMs * (health.totalRequests - 1) + latency) / health.totalRequests;
        if (result) {
          health.totalSuccesses++;
          health.lastSuccessAt = Date.now();
          health.consecutiveFailures = 0;
          health.status = "HEALTHY";
        } else {
          health.totalFailures++;
          health.lastFailureAt = Date.now();
          health.consecutiveFailures++;
          health.status = health.consecutiveFailures >= 3 ? "DEGRADED" : "HEALTHY";
        }
        return result;
      } catch (err: any) {
        const latency = Date.now() - t0;
        health.totalFailures++;
        health.lastFailureAt = Date.now();
        health.consecutiveFailures++;
        health.avgLatencyMs = (health.avgLatencyMs * (health.totalRequests - 1) + latency) / health.totalRequests;
        const msg = err?.message ?? String(err);
        if (msg.includes("429")) {
          health.status = "RATE_LIMITED";
          health.cooldownUntil = Date.now() + 60_000;
        } else if (msg.includes("abort") || msg.includes("timeout")) {
          health.status = "TIMEOUT";
        } else if (msg.includes("401") || msg.includes("403")) {
          health.status = "AUTH_ERROR";
        } else {
          health.status = health.consecutiveFailures >= 3 ? "DEGRADED" : "HEALTHY";
        }
        return null;
      }
    },
    getHealth: () => ({ ...health }),
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD TWELVE DATA ADAPTER
// ═══════════════════════════════════════════════════════════════

function buildTwelveDataAdapter(): ProviderAdapter {
  return buildAdapter(
    "twelve-data",
    "Twelve Data",
    ["crypto", "forex", "equity", "commodity", "indices"],
    ["ohlcv", "quote"],
    async (instrument, assetClass, readEnv) => {
      const cred = checkCredentials("twelve-data", readEnv);
      if (cred && !cred.available) return null;

      const apiKey = readEnv?.("TWELVE_DATA_API_KEY") ?? "";
      if (!apiKey) return null;

      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(instrument)}&interval=1h&outputsize=50&apikey=${apiKey}`;
      const res = await defaultTransport(url);
      if (!res.ok || !res.json) return null;

      const data = res.json as { values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[] };
      const values = data.values ?? [];
      if (values.length === 0) return null;

      const latest = values[0];
      const price = parseFloat(latest.close);
      if (!Number.isFinite(price) || price <= 0) return null;

      const open = parseFloat(latest.open);
      const high = parseFloat(latest.high);
      const low = parseFloat(latest.low);
      const volume = latest.volume ? parseFloat(latest.volume) : undefined;

      return {
        instrument,
        assetClass,
        price,
        change24h: values.length >= 2
          ? ((price - parseFloat(values[Math.min(24, values.length - 1)].close)) / parseFloat(values[Math.min(24, values.length - 1)].close)) * 100
          : undefined,
        volume24h: volume,
        ohlcvAvailable: true,
        availableTimeframes: ["M1", "M5", "M15", "H1", "H4", "D1", "W1"],
        provider: "twelve-data",
        observedAt: new Date(latest.datetime).getTime(),
        freshness: assessFreshness(new Date(latest.datetime).getTime(), Date.now()),
        quality: "VERIFIED",
      };
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD COINGECKO ADAPTER
// ═══════════════════════════════════════════════════════════════

function buildCoinGeckoAdapter(): ProviderAdapter {
  const COINGECKO_IDS: Record<string, string> = {
    "BTC/USD": "bitcoin",
    "ETH/USD": "ethereum",
    "SOL/USD": "solana",
    "DOGE/USD": "dogecoin",
    "XRP/USD": "ripple",
    "ADA/USD": "cardano",
    "AVAX/USD": "avalanche-2",
    "LINK/USD": "chainlink",
  };

  return buildAdapter(
    "coingecko",
    "CoinGecko",
    ["crypto"],
    ["quote"],
    async (instrument) => {
      const coinId = COINGECKO_IDS[instrument];
      if (!coinId) return null;

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
      const res = await defaultTransport(url);
      if (!res.ok || !res.json) return null;

      const data = res.json as Record<string, { usd?: number; usd_24h_change?: number }>;
      const price = data[coinId]?.usd;
      if (price === undefined || !Number.isFinite(price) || price <= 0) return null;

      return {
        instrument,
        assetClass: "crypto",
        price,
        change24h: data[coinId]?.usd_24h_change,
        ohlcvAvailable: false,
        availableTimeframes: [],
        provider: "coingecko",
        observedAt: Date.now(),
        freshness: "FRESH",
        quality: "VERIFIED",
      };
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// ADAPTER REGISTRY
// ═══════════════════════════════════════════════════════════════

const DEFAULT_ADAPTERS: ProviderAdapter[] = [
  buildTwelveDataAdapter(),
  buildCoinGeckoAdapter(),
];

let adapters: ProviderAdapter[] = [...DEFAULT_ADAPTERS];

export function getAdapters(): ProviderAdapter[] {
  return [...adapters];
}

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.push(adapter);
}

export function resetAdapters(): void {
  adapters = [...DEFAULT_ADAPTERS];
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER ROUTER
// ═══════════════════════════════════════════════════════════════

export function selectBestAdapter(
  instrument: string,
  assetClass: AssetClass,
  capability: string,
  readEnv?: EnvReader,
): ProviderAdapter | null {
  const candidates = adapters.filter(
    a =>
      a.supportedAssetClasses.includes(assetClass) &&
      a.capabilities.includes(capability) &&
      a.isAvailable(readEnv),
  );

  // Sort by health: HEALTHY first, then DEGRADED, others last
  const healthOrder: Record<ProviderHealthStatus, number> = {
    HEALTHY: 0,
    DEGRADED: 1,
    RATE_LIMITED: 2,
    TIMEOUT: 3,
    AUTH_ERROR: 4,
    UNAVAILABLE: 5,
    MALFORMED_RESPONSE: 4,
  };

  return candidates.sort((a, b) => {
    const ha = healthOrder[a.getHealth().status] ?? 5;
    const hb = healthOrder[b.getHealth().status] ?? 5;
    if (ha !== hb) return ha - hb;
    // Prefer provider with fewer requests (spread load)
    return a.getHealth().totalRequests - b.getHealth().totalRequests;
  })[0] ?? null;
}

// ═══════════════════════════════════════════════════════════════
// LIVE ACQUISITION
// ═══════════════════════════════════════════════════════════════

export interface LiveAcquisitionResult {
  instrument: string;
  assetClass: AssetClass;
  snapshot: MarketSnapshot | null;
  provider: string;
  success: boolean;
  error?: string;
  latencyMs: number;
}

/**
 * Acquire live market data for a single instrument.
 * Falls back through available providers.
 */
export async function acquireLiveData(
  instrument: string,
  assetClass: AssetClass,
  readEnv?: EnvReader,
): Promise<LiveAcquisitionResult> {
  const startTime = Date.now();

  // Try primary capability first
  const adapter = selectBestAdapter(instrument, assetClass, "quote", readEnv)
    ?? selectBestAdapter(instrument, assetClass, "ohlcv", readEnv);

  if (!adapter) {
    return {
      instrument,
      assetClass,
      snapshot: null,
      provider: "none",
      success: false,
      error: "no available provider for this instrument",
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const snapshot = await adapter.fetch(instrument, assetClass, readEnv);
    if (snapshot) {
      return {
        instrument,
        assetClass,
        snapshot,
        provider: adapter.id,
        success: true,
        latencyMs: Date.now() - startTime,
      };
    }
    return {
      instrument,
      assetClass,
      snapshot: null,
      provider: adapter.id,
      success: false,
      error: "provider returned null",
      latencyMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      instrument,
      assetClass,
      snapshot: null,
      provider: adapter.id,
      success: false,
      error: err?.message ?? "provider error",
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Batch acquire live data for multiple instruments.
 */
export async function acquireBatchLiveData(
  instruments: { instrument: string; assetClass: AssetClass }[],
  readEnv?: EnvReader,
  concurrency = 5,
): Promise<LiveAcquisitionResult[]> {
  const results: LiveAcquisitionResult[] = [];
  for (let i = 0; i < instruments.length; i += concurrency) {
    const batch = instruments.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(({ instrument, assetClass }) =>
        acquireLiveData(instrument, assetClass, readEnv),
      ),
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Get provider health summary for UI.
 */
export function getProviderHealthSummary(): {
  provider: string;
  status: ProviderHealthStatus;
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
}[] {
  return adapters.map(a => {
    const h = a.getHealth();
    return {
      provider: a.id,
      status: h.status,
      totalRequests: h.totalRequests,
      successRate: h.totalRequests > 0 ? h.totalSuccesses / h.totalRequests : 0,
      avgLatencyMs: h.avgLatencyMs,
    };
  });
}
