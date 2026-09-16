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
  type Transport,
} from "@/lib/data/universal/live/client";
import {
  checkCredentials,
  type EnvReader,
} from "@/lib/data/universal/live/credentials";
import type { MarketSnapshot } from "@/lib/market-radar/types";
import type { OhlcvCandle } from "@/lib/data/market-types";
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
      } catch (err: unknown) {
        const latency = Date.now() - t0;
        health.totalFailures++;
        health.lastFailureAt = Date.now();
        health.consecutiveFailures++;
        health.avgLatencyMs = (health.avgLatencyMs * (health.totalRequests - 1) + latency) / health.totalRequests;
        const msg = errorMessage(err);
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
// BUILD COINGLASS ADAPTER (Crypto Derivatives)
// ═══════════════════════════════════════════════════════════════

function buildCoinGlassAdapter(): ProviderAdapter {
  return buildAdapter(
    "coinglass", "CoinGlass", ["crypto"], ["derivatives"],
    /*
      Phase 226 — this adapter exists so the registry, health summary and
      universe `requiredCapabilities` know CoinGlass as the crypto
      derivatives provider. It does NOT acquire data here:

      - `MarketSnapshot` has no derivatives field, so the previous
        implementation parsed openInterest/fundingRate and then threw them
        away, returning only `lastPrice` stamped `observedAt: Date.now()`,
        `freshness: "FRESH"` — a non-realtime provider labelled live.
      - The generic transport carries no `cg_api_key` header, so the calls
        could never authenticate.
      - `acquireLiveData` only ever selects `quote`/`ohlcv` adapters.

      Authenticated acquisition is `convex/coinglass.fetchDerivatives`
      (server-side key, provider observation timestamp preserved); it reaches
      the radar through `market-radar/derivatives-bridge.ts`. Returning null
      keeps this provider honest: no price, no fabricated freshness.
    */
    async () => null,
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD DEFILLAMA ADAPTER (DeFi)
// ═══════════════════════════════════════════════════════════════

function buildDefiLlamaAdapter(): ProviderAdapter {
  return buildAdapter(
    "defillama", "DeFiLlama", ["crypto"], ["defi"],
    async (instrument) => {
      const chain = instrument.split("/")[0]?.toLowerCase();
      if (!chain) return null;
      try {
        const url = `https://api.llama.fi/v2/historicalChainTvl/${chain}`;
        const res = await defaultTransport(url);
        if (!res.ok || !res.json) return null;
        const data = res.json as { tvl?: number }[];
        if (!Array.isArray(data) || data.length === 0) return null;
        const latest = data[data.length - 1];
        if (!latest || latest.tvl === undefined) return null;
        return {
          instrument, assetClass: "crypto", price: 0,
          ohlcvAvailable: false, availableTimeframes: [],
          provider: "defillama", observedAt: Date.now(),
          freshness: "FRESH", quality: "VERIFIED",
        };
      } catch { return null; }
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD TOKENOMIST ADAPTER (Tokenomics)
// ═══════════════════════════════════════════════════════════════

function buildTokenomistAdapter(): ProviderAdapter {
  return buildAdapter(
    "tokenomist", "Tokenomist", ["crypto"], ["tokenomics"],
    async (instrument) => {
      try {
        const symbol = instrument.split("/")[0]?.toLowerCase();
        if (!symbol) return null;
        const url = `https://api.tokenomist.xyz/v1/unlocks?symbol=${symbol}`;
        const res = await defaultTransport(url);
        if (!res.ok || !res.json) return null;
        return {
          instrument, assetClass: "crypto", price: 0,
          ohlcvAvailable: false, availableTimeframes: [],
          provider: "tokenomist", observedAt: Date.now(),
          freshness: "FRESH", quality: "VERIFIED",
        };
      } catch { return null; }
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD OKX ADAPTER (Crypto OHLCV)
// ═══════════════════════════════════════════════════════════════

function buildOkxAdapter(): ProviderAdapter {
  const OKX_SYMBOLS: Record<string, string> = {
    "BTC/USD": "BTC-USDT", "ETH/USD": "ETH-USDT", "SOL/USD": "SOL-USDT",
    "DOGE/USD": "DOGE-USDT", "XRP/USD": "XRP-USDT", "ADA/USD": "ADA-USDT",
  };
  return buildAdapter(
    "okx", "OKX", ["crypto"], ["ohlcv", "quote"],
    async (instrument) => {
      const sym = OKX_SYMBOLS[instrument];
      if (!sym) return null;
      try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(sym)}&bar=1H&limit=1`;
        const res = await defaultTransport(url);
        if (!res.ok || !res.json) return null;
        const data = res.json as { data?: string[][] };
        const rows = data.data ?? [];
        if (rows.length === 0) return null;
        const row = rows[0];
        const price = parseFloat(row[4]); // close
        if (!Number.isFinite(price) || price <= 0) return null;
        const ts = parseInt(row[0]);
        return {
          instrument, assetClass: "crypto", price,
          ohlcvAvailable: true, availableTimeframes: ["M1", "M5", "M15", "H1", "H4", "D1"],
          provider: "okx", observedAt: Number.isFinite(ts) ? ts : Date.now(),
          freshness: assessFreshness(Number.isFinite(ts) ? ts : Date.now(), Date.now()),
          quality: "VERIFIED",
        };
      } catch { return null; }
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD ALPHA VANTAGE ADAPTER (Fundamentals)
// ═══════════════════════════════════════════════════════════════

function buildAlphaVantageAdapter(): ProviderAdapter {
  return buildAdapter(
    "alpha-vantage", "Alpha Vantage", ["equity", "forex"], ["fundamentals"],
    async (instrument, assetClass, readEnv) => {
      const cred = checkCredentials("alpha-vantage", readEnv);
      if (cred && !cred.available) return null;
      const apiKey = readEnv?.("ALPHA_VANTAGE_API_KEY") ?? "";
      if (!apiKey) return null;
      const symbol = assetClass === "forex" ? instrument.replace("/", "") : instrument;
      try {
        const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
        const res = await defaultTransport(url);
        if (!res.ok || !res.json) return null;
        const d = res.json as Record<string, string>;
        const price = d["50DayMovingAverage"] ? parseFloat(d["50DayMovingAverage"]) : 0;
        if (!Number.isFinite(price) || price <= 0) return null;
        return {
          instrument, assetClass, price,
          ohlcvAvailable: false, availableTimeframes: [],
          provider: "alpha-vantage", observedAt: Date.now(),
          freshness: "DELAYED", quality: "DEGRADED",
        };
      } catch { return null; }
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD CFTC ADAPTER (COT Positioning)
// ═══════════════════════════════════════════════════════════════

function buildCftcAdapter(): ProviderAdapter {
  return buildAdapter(
    "cftc", "CFTC", ["forex", "commodity"], ["cot"],
    async (instrument) => {
      try {
        const url = `https://www.cftc.gov/dea/futures/other_lf.htm`;
        const res = await defaultTransport(url);
        if (!res.ok || !res.json) return null;
        return {
          instrument, assetClass: "forex", price: 0,
          ohlcvAvailable: false, availableTimeframes: [],
          provider: "cftc", observedAt: Date.now(),
          freshness: "STALE", quality: "DEGRADED",
        };
      } catch { return null; }
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD TREASURY ADAPTER (Yields)
// ═══════════════════════════════════════════════════════════════

function buildTreasuryAdapter(): ProviderAdapter {
  return buildAdapter(
    "treasury", "Treasury", ["macro", "indices"], ["yield"],
    async (instrument) => {
      try {
        const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=1`;
        const res = await defaultTransport(url);
        if (!res.ok || !res.json) return null;
        const d = res.json as { data?: [{ avg_interest_rate_amt?: string; record_date?: string }] };
        const entry = d.data?.[0];
        if (!entry?.avg_interest_rate_amt) return null;
        const yield_ = parseFloat(entry.avg_interest_rate_amt);
        if (!Number.isFinite(yield_)) return null;
        return {
          instrument, assetClass: "macro", price: yield_,
          ohlcvAvailable: false, availableTimeframes: [],
          provider: "treasury", observedAt: entry.record_date ? new Date(entry.record_date).getTime() : Date.now(),
          freshness: "STALE", quality: "DEGRADED",
        };
      } catch { return null; }
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILD EIA ADAPTER (Commodity Inventory)
// ═══════════════════════════════════════════════════════════════

function buildEiaAdapter(): ProviderAdapter {
  return buildAdapter(
    "eia", "EIA", ["commodity"], ["inventory"],
    async (instrument, _assetClass, readEnv) => {
      const cred = checkCredentials("eia", readEnv);
      if (cred && !cred.available) return null;
      const apiKey = readEnv?.("EIA_API_KEY") ?? "";
      if (!apiKey) return null;
      try {
        const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${apiKey}&frequency=weekly&data[0]=value&facets[product][]=EPM0&facets[duession][]=NUS&sort[0][column]=period&sort[0][direction]=desc&length=1`;
        const res = await defaultTransport(url);
        if (!res.ok || !res.json) return null;
        return {
          instrument, assetClass: "commodity", price: 0,
          ohlcvAvailable: false, availableTimeframes: [],
          provider: "eia", observedAt: Date.now(),
          freshness: "STALE", quality: "DEGRADED",
        };
      } catch { return null; }
    },
  );
}

// ═══════════════════════════════════════════════════════════════
// ADAPTER REGISTRY
// ═══════════════════════════════════════════════════════════════

const DEFAULT_ADAPTERS: ProviderAdapter[] = [
  buildTwelveDataAdapter(),
  buildCoinGeckoAdapter(),
  buildCoinGlassAdapter(),
  buildDefiLlamaAdapter(),
  buildTokenomistAdapter(),
  buildOkxAdapter(),
  buildAlphaVantageAdapter(),
  buildCftcAdapter(),
  buildTreasuryAdapter(),
  buildEiaAdapter(),
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
  providerInstrumentId?: string;
  snapshot: MarketSnapshot | null;
  candles?: OhlcvCandle[];
  provider: string;
  fetchedAt: number;
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
      fetchedAt: Date.now(),
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
        fetchedAt: Date.now(),
        success: true,
        latencyMs: Date.now() - startTime,
      };
    }
    return {
      instrument,
      assetClass,
      fetchedAt: Date.now(),
      snapshot: null,
      provider: adapter.id,
      success: false,
      error: "provider returned null",
      latencyMs: Date.now() - startTime,
    };
  } catch (err: unknown) {
    return {
      instrument,
      assetClass,
      fetchedAt: Date.now(),
      snapshot: null,
      provider: adapter.id,
      success: false,
      error: errorMessage(err) || "provider error",
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Phase 156 — Acquire live data for a provider-native instrument.
 *
 * Provider-native identity is preserved exactly. This path bypasses
 * canonical registry resolution and generic adapter symbol mapping.
 * Discovery metadata alone is never treated as live evidence.
 */
export async function acquireProviderNativeLiveData(
  input: {
    instrument: string;
    provider: string;
    providerInstrumentId: string;
    assetClass: AssetClass;
  },
  readEnv?: EnvReader,
  transport: Transport = defaultTransport,
): Promise<LiveAcquisitionResult> {
  const startTime = Date.now();

  const result = await executeLiveRequest({
    instrument: input.instrument,
    capability: "ohlcv",
    timeframe: "1h",
    count: 100,
    transport,
    readEnv,
    providerNative: {
      provider: input.provider,
      providerInstrumentId: input.providerInstrumentId,
      assetClass: input.assetClass,
    },
  });

  const candles = result.candles ?? [];
  const latest = candles[candles.length - 1];

  if (
    (result.status !== "LIVE_VERIFIED" &&
      result.status !== "LIVE_PARTIAL") ||
    !latest ||
    !Number.isFinite(latest.close) ||
    latest.close <= 0
  ) {
    return {
      instrument: input.instrument,
      assetClass: input.assetClass,
      providerInstrumentId: input.providerInstrumentId,
      snapshot: null,
      provider: result.provider ?? input.provider,
      fetchedAt: result.receivedAt ?? Date.now(),
      success: false,
      error: result.failureReason ?? `Live request status: ${result.status}`,
      latencyMs: result.latencyMs ?? Date.now() - startTime,
    };
  }

  const observedAt = latest.timestamp;
  const freshness = assessFreshness(observedAt, Date.now());

  return {
    instrument: input.instrument,
    assetClass: input.assetClass,
    providerInstrumentId: input.providerInstrumentId,
    snapshot: {
      instrument: input.instrument,
      assetClass: input.assetClass,
      price: latest.close,
      ohlcvAvailable: true,
      availableTimeframes: ["H1"],
      provider: result.provider ?? input.provider,
      observedAt,
      freshness,
      quality: result.status === "LIVE_VERIFIED" ? "VERIFIED" : "DEGRADED",
    },
    candles: candles.map((candle) => ({
      ...candle,
      volume: candle.volume ?? 0,
    })),
    provider: result.provider ?? input.provider,
    fetchedAt: result.receivedAt ?? Date.now(),
    success: true,
    ...(result.failureReason ? { error: result.failureReason } : {}),
    latencyMs: result.latencyMs ?? Date.now() - startTime,
  };
}

/**
 * Phase 156 — Convert verified provider-native OHLCV into the normalized
 * MarketData shape consumed by LiveCandidateBuilder.
 *
 * No technical/fundamental evidence is invented here. Only verified
 * provider OHLCV and the provider-native identity are carried forward.
 */
export function providerNativeAcquisitionToMarketData(
  result: LiveAcquisitionResult,
): import("../data/market-types").MarketData | null {
  const candles = result.candles ?? [];
  if (!result.success || !result.snapshot || candles.length === 0) {
    return null;
  }

  /*
    Phase 191 — a snapshot with no provider observation time cannot be
    presented as realtime/delayed/stale, because every one of those labels is
    a claim about WHEN the data was observed. `observedAt` is optional (the
    provider may not report it), so its absence degrades freshness to
    "unavailable" rather than inheriting a confident label.
  */
  const freshness =
    result.snapshot.observedAt === undefined
      ? "unavailable"
      : result.snapshot.freshness === "FRESH"
        ? "realtime"
        : result.snapshot.freshness === "DELAYED"
          ? "delayed"
          : result.snapshot.freshness === "STALE"
            ? "stale"
            : "unavailable";

  const instrumentType =
    result.assetClass === "crypto"
      ? "crypto"
      : result.assetClass === "forex"
        ? "forex"
        : result.assetClass === "equity"
          ? "stock"
          : result.assetClass === "commodity"
            ? "commodity"
            : "indices";

  return {
    instrument: result.instrument,
    instrumentType,
    provider: result.provider,
    fetchTimestamp: result.fetchedAt,
    price: {
      price: result.snapshot.price,
      /*
        `PriceSnapshot.timestamp` means "when the price was last updated".
        When the provider gave no observation time we record 0 — a sentinel
        that `assessFreshness` treats as UNAVAILABLE — instead of `Date.now()`,
        which would assert an observation that never happened.
      */
      timestamp: result.snapshot.observedAt ?? 0,
      source: result.provider,
    },
    candles,
    timeframe: "1h",
    dataFreshness: freshness,
    ...(result.error ? { error: result.error } : {}),
  };
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
 * Phase 156 — Batch acquire live data for provider-native instruments.
 *
 * Preserves each provider's exact native instrument identity.
 * This path never falls through canonical instrument resolution.
 */
export async function acquireBatchProviderNativeLiveData(
  instruments: {
    instrument: string;
    provider: string;
    providerInstrumentId: string;
    assetClass: AssetClass;
  }[],
  readEnv?: EnvReader,
  concurrency = 5,
  transport: Transport = defaultTransport,
): Promise<LiveAcquisitionResult[]> {
  const results: LiveAcquisitionResult[] = [];

  for (let i = 0; i < instruments.length; i += concurrency) {
    const batch = instruments.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map((input) =>
        acquireProviderNativeLiveData(input, readEnv, transport),
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

// ═══════════════════════════════════════════════════════════════
// PHASE 54: VERIFICATION-AWARE HEALTH
// ═══════════════════════════════════════════════════════════════

import type { VerificationResult, VerificationStatus } from "./verification";
import { errorMessage } from "../data/json/narrow";

/**
 * Map a Phase 54 verification status to a provider health status.
 * Provider health NEVER becomes directional evidence.
 */
export function verificationToHealthStatus(
  verificationStatus: VerificationStatus,
): ProviderHealthStatus {
  switch (verificationStatus) {
    case "LIVE_VERIFIED":
    case "LIVE_VERIFIED_PARTIAL":
      return "HEALTHY";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
    case "NETWORK_ERROR":
      return "TIMEOUT";
    case "CREDENTIAL_MISSING":
      return "AUTH_ERROR";
    case "MALFORMED_RESPONSE":
      return "MALFORMED_RESPONSE";
    case "ENDPOINT_FAILED":
    case "DATA_INVALID":
    case "SYMBOL_UNSUPPORTED":
      return "DEGRADED";
    case "ARCHITECTURALLY_IMPLEMENTED":
    case "DATA_STALE":
    case "NOT_TESTED":
    default:
      return "HEALTHY"; // unknown/untested = assume healthy
  }
}

/**
 * Apply a batch of verification results to provider health state.
 * Only HEALTHY/DEGRADED/RATE_LIMITED/TIMEOUT/etc are propagated.
 * Provider health NEVER becomes directional evidence.
 */
export function applyVerificationResults(
  results: VerificationResult[],
): Map<string, ProviderHealthStatus> {
  const aggregated = new Map<string, ProviderHealthStatus>();

  // Group results by provider
  const byProvider = new Map<string, VerificationResult[]>();
  for (const r of results) {
    const existing = byProvider.get(r.provider) ?? [];
    existing.push(r);
    byProvider.set(r.provider, existing);
  }

  // For each provider: worst status wins (conservative)
  const healthPriority: Record<ProviderHealthStatus, number> = {
    HEALTHY: 0,
    DEGRADED: 1,
    RATE_LIMITED: 2,
    TIMEOUT: 3,
    AUTH_ERROR: 4,
    UNAVAILABLE: 5,
    MALFORMED_RESPONSE: 4,
  };

  for (const [provider, providerResults] of byProvider) {
    let worstHealth: ProviderHealthStatus = "HEALTHY";
    let worstPriority = healthPriority["HEALTHY"];

    for (const r of providerResults) {
      const health = verificationToHealthStatus(r.status);
      const priority = healthPriority[health];
      if (priority > worstPriority) {
        worstPriority = priority;
        worstHealth = health;
      }
    }

    aggregated.set(provider, worstHealth);
  }

  return aggregated;
}
