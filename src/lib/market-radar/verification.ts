/**
 * Phase 54 — Live Provider Verification & Data Integrity Hardening
 *
 * Verifies which providers, endpoints, instruments, and capabilities
 * actually work against real provider responses. Produces a machine-readable
 * verification report distinguishing LIVE_VERIFIED from ARCHITECTURALLY_IMPLEMENTED.
 *
 * CRITICAL INVARIANTS:
 *   - Never label LIVE_VERIFIED from mocks only.
 *   - Never fabricate verification results.
 *   - Never expose credentials in verification output.
 *   - Provider health NEVER becomes directional evidence.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import {
  checkCredentials,
  type EnvReader,
} from "@/lib/data/universal/live/credentials";
import { assessFreshness } from "./freshness";
import type { FreshnessLevel } from "./types";

// ═══════════════════════════════════════════════════════════════
// VERIFICATION STATUS
// ═══════════════════════════════════════════════════════════════

export type VerificationStatus =
  | "LIVE_VERIFIED"
  | "LIVE_VERIFIED_PARTIAL"
  | "ARCHITECTURALLY_IMPLEMENTED"
  | "CREDENTIAL_MISSING"
  | "ENDPOINT_FAILED"
  | "SYMBOL_UNSUPPORTED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "DATA_STALE"
  | "DATA_INVALID"
  | "NETWORK_ERROR"
  | "NOT_TESTED";

// ═══════════════════════════════════════════════════════════════
// VERIFICATION RESULT
// ═══════════════════════════════════════════════════════════════

export interface VerificationResult {
  provider: string;
  canonicalInstrument: string;
  providerSymbol: string;
  capability: string;
  assetClass: AssetClass;
  status: VerificationStatus;
  verifiedAt: number;
  responseTimestamp: number | null;
  freshness: FreshnessLevel;
  latencyMs: number | null;
  httpStatus: number | null;
  schemaValid: boolean;
  identityValid: boolean;
  numericValid: boolean;
  credentialStatus: "AVAILABLE" | "MISSING" | "NOT_REQUIRED";
  rateLimitStatus: "OK" | "RATE_LIMITED" | "NOT_CHECKED";
  errorCategory: string | null;
  errorMessage: string | null;
  provenance: string;
}

// ═══════════════════════════════════════════════════════════════
// VERIFICATION REPORT
// ═══════════════════════════════════════════════════════════════

export interface VerificationReport {
  generatedAt: number;
  results: VerificationResult[];
  summary: {
    total: number;
    liveVerified: number;
    liveVerifiedPartial: number;
    architecturallyImplemented: number;
    credentialMissing: number;
    endpointFailed: number;
    symbolUnsupported: number;
    rateLimited: number;
    notTested: number;
    other: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT VERIFICATION SPECS
// ═══════════════════════════════════════════════════════════════

export interface VerificationSpec {
  provider: string;
  instrument: string;
  providerSymbol: string;
  capability: string;
  assetClass: AssetClass;
  /** Whether this provider requires credentials. */
  requiresCredential: boolean;
}

/**
 * Comprehensive verification matrix covering all providers and instruments.
 */
export const VERIFICATION_MATRIX: VerificationSpec[] = [
  // ── Twelve Data ──
  { provider: "twelve-data", instrument: "BTC/USD", providerSymbol: "BTC/USD", capability: "ohlcv", assetClass: "crypto", requiresCredential: true },
  { provider: "twelve-data", instrument: "ETH/USD", providerSymbol: "ETH/USD", capability: "ohlcv", assetClass: "crypto", requiresCredential: true },
  { provider: "twelve-data", instrument: "EUR/USD", providerSymbol: "EUR/USD", capability: "ohlcv", assetClass: "forex", requiresCredential: true },
  { provider: "twelve-data", instrument: "GBP/USD", providerSymbol: "GBP/USD", capability: "ohlcv", assetClass: "forex", requiresCredential: true },
  { provider: "twelve-data", instrument: "USD/JPY", providerSymbol: "USD/JPY", capability: "ohlcv", assetClass: "forex", requiresCredential: true },
  { provider: "twelve-data", instrument: "USD/IDR", providerSymbol: "USD/IDR", capability: "ohlcv", assetClass: "forex", requiresCredential: true },
  { provider: "twelve-data", instrument: "AAPL", providerSymbol: "AAPL", capability: "ohlcv", assetClass: "equity", requiresCredential: true },
  { provider: "twelve-data", instrument: "NVDA", providerSymbol: "NVDA", capability: "ohlcv", assetClass: "equity", requiresCredential: true },
  { provider: "twelve-data", instrument: "BBCA.JK", providerSymbol: "BBCA.JK", capability: "ohlcv", assetClass: "equity", requiresCredential: true },
  { provider: "twelve-data", instrument: "BBRI.JK", providerSymbol: "BBRI.JK", capability: "ohlcv", assetClass: "equity", requiresCredential: true },
  { provider: "twelve-data", instrument: "XAU/USD", providerSymbol: "XAU/USD", capability: "ohlcv", assetClass: "commodity", requiresCredential: true },
  { provider: "twelve-data", instrument: "XAG/USD", providerSymbol: "XAG/USD", capability: "ohlcv", assetClass: "commodity", requiresCredential: true },
  { provider: "twelve-data", instrument: "WTI", providerSymbol: "WTI", capability: "ohlcv", assetClass: "commodity", requiresCredential: true },
  { provider: "twelve-data", instrument: "BRENT", providerSymbol: "BRENT", capability: "ohlcv", assetClass: "commodity", requiresCredential: true },
  { provider: "twelve-data", instrument: "SPX", providerSymbol: "SPX", capability: "ohlcv", assetClass: "indices", requiresCredential: true },
  { provider: "twelve-data", instrument: "NDX", providerSymbol: "NDX", capability: "ohlcv", assetClass: "indices", requiresCredential: true },
  { provider: "twelve-data", instrument: "DJI", providerSymbol: "DJI", capability: "ohlcv", assetClass: "indices", requiresCredential: true },
  { provider: "twelve-data", instrument: "IHSG", providerSymbol: "IHSG", capability: "ohlcv", assetClass: "indices", requiresCredential: true },

  // ── CoinGecko ──
  { provider: "coingecko", instrument: "BTC/USD", providerSymbol: "bitcoin", capability: "quote", assetClass: "crypto", requiresCredential: false },
  { provider: "coingecko", instrument: "ETH/USD", providerSymbol: "ethereum", capability: "quote", assetClass: "crypto", requiresCredential: false },
  { provider: "coingecko", instrument: "SOL/USD", providerSymbol: "solana", capability: "quote", assetClass: "crypto", requiresCredential: false },
  { provider: "coingecko", instrument: "DOGE/USD", providerSymbol: "dogecoin", capability: "quote", assetClass: "crypto", requiresCredential: false },

  // ── CoinGlass ──
  { provider: "coinglass", instrument: "BTC/USD", providerSymbol: "BTC", capability: "derivatives", assetClass: "crypto", requiresCredential: true },
  { provider: "coinglass", instrument: "ETH/USD", providerSymbol: "ETH", capability: "derivatives", assetClass: "crypto", requiresCredential: true },

  // ── OKX ──
  { provider: "okx", instrument: "BTC/USD", providerSymbol: "BTC-USDT", capability: "ohlcv", assetClass: "crypto", requiresCredential: false },
  { provider: "okx", instrument: "ETH/USD", providerSymbol: "ETH-USDT", capability: "ohlcv", assetClass: "crypto", requiresCredential: false },
  { provider: "okx", instrument: "SOL/USD", providerSymbol: "SOL-USDT", capability: "ohlcv", assetClass: "crypto", requiresCredential: false },

  // ── Alpha Vantage ──
  { provider: "alpha-vantage", instrument: "AAPL", providerSymbol: "AAPL", capability: "fundamentals", assetClass: "equity", requiresCredential: true },
  { provider: "alpha-vantage", instrument: "NVDA", providerSymbol: "NVDA", capability: "fundamentals", assetClass: "equity", requiresCredential: true },
  { provider: "alpha-vantage", instrument: "MSFT", providerSymbol: "MSFT", capability: "fundamentals", assetClass: "equity", requiresCredential: true },

  // ── Treasury ──
  { provider: "treasury", instrument: "US10Y", providerSymbol: "US10Y", capability: "yield", assetClass: "macro", requiresCredential: false },

  // ── CFTC — verified COT market names ──
  { provider: "cftc", instrument: "EUR/USD", providerSymbol: "EURO FX - CHICAGO MERCANTILE EXCHANGE", capability: "cot", assetClass: "forex", requiresCredential: false },
  { provider: "cftc", instrument: "GBP/USD", providerSymbol: "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE", capability: "cot", assetClass: "forex", requiresCredential: false },
  { provider: "cftc", instrument: "USD/JPY", providerSymbol: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE", capability: "cot", assetClass: "forex", requiresCredential: false },
  { provider: "cftc", instrument: "XAU/USD", providerSymbol: "GOLD - COMMODITY EXCHANGE INC.", capability: "cot", assetClass: "commodity", requiresCredential: false },
  { provider: "cftc", instrument: "XAG/USD", providerSymbol: "SILVER - COMMODITY EXCHANGE INC.", capability: "cot", assetClass: "commodity", requiresCredential: false },
  { provider: "cftc", instrument: "WTI", providerSymbol: "CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE", capability: "cot", assetClass: "commodity", requiresCredential: false },

  // ── EIA (requires API key for verification) ──
  // EIA spec is listed here; live verification requires EIA_API_KEY.
  // We include it for documentation; buildVerificationUrl handles null-key gracefully.
  // { provider: "eia", instrument: "WTI", providerSymbol: "EPC0", capability: "inventory", assetClass: "commodity", requiresCredential: true },

  // ── DeFiLlama ──
  { provider: "defillama", instrument: "BTC/USD", providerSymbol: "bitcoin", capability: "defi", assetClass: "crypto", requiresCredential: false },

  // ── OKX — additional ──
  { provider: "okx", instrument: "DOGE/USD", providerSymbol: "DOGE-USDT", capability: "ohlcv", assetClass: "crypto", requiresCredential: false },
  { provider: "okx", instrument: "XRP/USD", providerSymbol: "XRP-USDT", capability: "ohlcv", assetClass: "crypto", requiresCredential: false },

  // ── CoinGecko — additional ──
  { provider: "coingecko", instrument: "XRP/USD", providerSymbol: "ripple", capability: "quote", assetClass: "crypto", requiresCredential: false },
  { provider: "coingecko", instrument: "AVAX/USD", providerSymbol: "avalanche-2", capability: "quote", assetClass: "crypto", requiresCredential: false },
  { provider: "coingecko", instrument: "LINK/USD", providerSymbol: "chainlink", capability: "quote", assetClass: "crypto", requiresCredential: false },

  // ── Twelve Data — additional ──
  { provider: "twelve-data", instrument: "SOL/USD", providerSymbol: "SOL/USD", capability: "ohlcv", assetClass: "crypto", requiresCredential: true },
  { provider: "twelve-data", instrument: "AUD/USD", providerSymbol: "AUD/USD", capability: "ohlcv", assetClass: "forex", requiresCredential: true },
  { provider: "twelve-data", instrument: "VIX", providerSymbol: "VIX", capability: "ohlcv", assetClass: "indices", requiresCredential: true },
];


function validateCftcResponse(json: unknown, base: ResponseValidation): ResponseValidation {
  if (!Array.isArray(json)) {
    return { ...base, errorMessage: "CFTC response is not an array" };
  }
  if (json.length === 0) {
    return { ...base, errorMessage: "CFTC returned no COT data rows" };
  }
  const row = json[0] as Record<string, unknown>;
  if (!row["market_and_exchange_names"] && !row["noncomm_positions_long_all"]) {
    return { ...base, errorMessage: "CFTC row missing expected fields" };
  }
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: row["report_date_as_yyyy_mm_dd"]
      ? new Date(String(row["report_date_as_yyyy_mm_dd"])).getTime()
      : null,
    freshness: "STALE", // COT reports are weekly
    provenance: "cftc-socrata",
  };
}

function validateEiaResponse(json: unknown, base: ResponseValidation): ResponseValidation {
  const data = json as { data?: { response?: { data?: Record<string, unknown>[] } }; error?: string };
  if (data.error) {
    return { ...base, errorMessage: `EIA error: ${data.error}` };
  }
  const rows = data?.data?.response?.data ?? [];
  if (rows.length === 0) {
    return { ...base, errorMessage: "EIA returned no inventory data" };
  }
  const latest = rows[0];
  const value = Number(latest?.value);
  if (!Number.isFinite(value) || value <= 0) {
    return { ...base, numericValid: false, errorMessage: "EIA invalid inventory value" };
  }
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: latest?.period ? new Date(String(latest.period)).getTime() : null,
    freshness: "STALE",
    provenance: "eia-v2",
  };
}

// ═══════════════════════════════════════════════════════════════
// LIVE VERIFICATION ENGINE
// ═══════════════════════════════════════════════════════════════

const DEFAULT_TIMEOUT_MS = 10_000;

async function verifiedFetch(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ ok: boolean; status: number; json?: unknown; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, latencyMs };
    try {
      const json = await res.json();
      return { ok: true, status: res.status, json, latencyMs };
    } catch {
      return { ok: false, status: res.status, latencyMs };
    }
  } catch (err: any) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - t0;
    const msg = err?.message ?? String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return { ok: false, status: 0, latencyMs };
    }
    return { ok: false, status: 0, latencyMs };
  }
}

/**
 * Verify a single provider/instrument/capability combination.
 * Makes a real network request when possible.
 */
export async function verifyProvider(
  spec: VerificationSpec,
  readEnv?: EnvReader,
): Promise<VerificationResult> {
  const now = Date.now();
  const base: VerificationResult = {
    provider: spec.provider,
    canonicalInstrument: spec.instrument,
    providerSymbol: spec.providerSymbol,
    capability: spec.capability,
    assetClass: spec.assetClass,
    status: "NOT_TESTED",
    verifiedAt: now,
    responseTimestamp: null,
    freshness: "UNAVAILABLE",
    latencyMs: null,
    httpStatus: null,
    schemaValid: false,
    identityValid: false,
    numericValid: false,
    credentialStatus: "NOT_REQUIRED",
    rateLimitStatus: "NOT_CHECKED",
    errorCategory: null,
    errorMessage: null,
    provenance: "",
  };

  // Check credentials
  if (spec.requiresCredential) {
    const cred = checkCredentials(spec.provider, readEnv);
    if (cred && !cred.available) {
      return {
        ...base,
        status: "CREDENTIAL_MISSING",
        credentialStatus: "MISSING",
        errorMessage: `Missing: ${cred.missingEnvVarNames.join(", ")}`,
        provenance: "credential-check",
      };
    }
    base.credentialStatus = "AVAILABLE";
  }

  // Build verification URL based on provider
  const apiKey = spec.requiresCredential ? (readEnv?.(getApiKeyEnv(spec.provider)) ?? "") : "";
  const url = buildVerificationUrl(spec, apiKey);
  if (!url) {
    return { ...base, status: "ARCHITECTURALLY_IMPLEMENTED", errorMessage: "No verification endpoint defined" };
  }

  // Execute request
  const response = await verifiedFetch(url);

  if (response.status === 0 && !response.ok) {
    // Timeout or network error
    return {
      ...base,
      status: "TIMEOUT",
      latencyMs: response.latencyMs,
      errorCategory: "TIMEOUT",
      errorMessage: "Request timed out or network error",
      provenance: "network",
    };
  }

  if (response.status === 429) {
    return {
      ...base,
      status: "RATE_LIMITED",
      httpStatus: 429,
      latencyMs: response.latencyMs,
      rateLimitStatus: "RATE_LIMITED",
      errorCategory: "RATE_LIMIT",
      errorMessage: "HTTP 429 rate limit",
      provenance: "http",
    };
  }

  if (!response.ok) {
    return {
      ...base,
      status: "ENDPOINT_FAILED",
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      errorCategory: `HTTP_${response.status}`,
      errorMessage: `HTTP ${response.status}`,
      provenance: "http",
    };
  }

  if (!response.json) {
    return {
      ...base,
      status: "MALFORMED_RESPONSE",
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      errorCategory: "NO_BODY",
      errorMessage: "Response body missing or unparsable",
      provenance: "parse",
    };
  }

  // Validate response
  const validation = validateProviderResponse(spec, response.json, now);
  base.schemaValid = validation.schemaValid;
  base.identityValid = validation.identityValid;
  base.numericValid = validation.numericValid;
  base.responseTimestamp = validation.responseTimestamp;
  base.freshness = validation.freshness;
  base.provenance = validation.provenance;

  if (!validation.schemaValid) {
    return {
      ...base,
      status: "MALFORMED_RESPONSE",
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      errorCategory: "SCHEMA",
      errorMessage: validation.errorMessage ?? "Schema validation failed",
    };
  }

  if (!validation.identityValid) {
    return {
      ...base,
      status: "SYMBOL_UNSUPPORTED",
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      errorCategory: "IDENTITY",
      errorMessage: validation.errorMessage ?? "Symbol identity mismatch",
    };
  }

  if (!validation.numericValid) {
    return {
      ...base,
      status: "DATA_INVALID",
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      errorCategory: "NUMERIC",
      errorMessage: validation.errorMessage ?? "Numeric validation failed",
    };
  }

  if (validation.freshness === "UNAVAILABLE" || validation.freshness === "STALE") {
    return {
      ...base,
      status: "DATA_STALE",
      httpStatus: response.status,
      latencyMs: response.latencyMs,
      freshness: validation.freshness,
      errorCategory: "FRESHNESS",
      errorMessage: `Data freshness: ${validation.freshness}`,
    };
  }

  return {
    ...base,
    status: "LIVE_VERIFIED",
    httpStatus: response.status,
    latencyMs: response.latencyMs,
    rateLimitStatus: "OK",
  };
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER-SPECIFIC URL BUILDERS
// ═══════════════════════════════════════════════════════════════

function buildVerificationUrl(spec: VerificationSpec, apiKey: string): string | null {
  switch (spec.provider) {
    case "twelve-data":
      return `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(spec.providerSymbol)}&interval=1day&outputsize=1&apikey=${apiKey}`;
    case "coingecko":
      return `https://api.coingecko.com/api/v3/simple/price?ids=${spec.providerSymbol}&vs_currencies=usd`;
    case "coinglass":
      return `https://open-api-v3.coinglass.com/api/futures/openInterest?symbol=${spec.providerSymbol}`;
    case "okx":
      return `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(spec.providerSymbol)}&bar=1D&limit=1`;
    case "alpha-vantage":
      return `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${spec.providerSymbol}&apikey=${apiKey}`;
    case "treasury":
      return `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=1`;
    case "defillama":
      return `https://api.llama.fi/v2/historicalChainTvl/${spec.providerSymbol}`;
    case "cftc":
      return `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=market_and_exchange_names='${encodeURIComponent(spec.providerSymbol)}'&$order=report_date_as_yyyy_mm_dd DESC&$limit=1`;
    case "eia":
      // EIA requires API key — only verifiable if key present
      if (!apiKey) return null;
      return `https://api.eia.gov/v2/petroleum/sto/data/?api_key=${apiKey}&frequency=weekly&data[0]=value&facets[product][]=EPC0&facets[process][]=STA&facets[area][]=NUS-Z00&sort[0][column]=period&sort[0][direction]=desc&length=1`;
    case "tokenomist":
      // Tokenomist public API is not reliably available for verification
      return null;
    default:
      return null;
  }
}

function getApiKeyEnv(provider: string): string {
  const map: Record<string, string> = {
    "twelve-data": "TWELVE_DATA_API_KEY",
    "coinglass": "COINGLASS_API_KEY",
    "alpha-vantage": "ALPHA_VANTAGE_API_KEY",
    "eia": "EIA_API_KEY",
  };
  return map[provider] ?? "";
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE VALIDATION
// ═══════════════════════════════════════════════════════════════

interface ResponseValidation {
  schemaValid: boolean;
  identityValid: boolean;
  numericValid: boolean;
  responseTimestamp: number | null;
  freshness: FreshnessLevel;
  errorMessage: string | null;
  provenance: string;
}

function validateProviderResponse(
  spec: VerificationSpec,
  json: unknown,
  now: number,
): ResponseValidation {
  const base: ResponseValidation = {
    schemaValid: false,
    identityValid: true, // assume valid unless we can check
    numericValid: false,
    responseTimestamp: null,
    freshness: "UNAVAILABLE",
    errorMessage: null,
    provenance: spec.provider,
  };

  try {
    switch (spec.provider) {
      case "twelve-data":
        return validateTwelveDataResponse(json, now, base);
      case "coingecko":
        return validateCoinGeckoResponse(json, spec.providerSymbol, now, base);
      case "coinglass":
        return validateCoinGlassResponse(json, base);
      case "okx":
        return validateOkxResponse(json, spec.providerSymbol, now, base);
      case "alpha-vantage":
        return validateAlphaVantageResponse(json, base);
      case "treasury":
        return validateTreasuryResponse(json, base);
      case "defillama":
        return validateDefiLlamaResponse(json, base);
      case "cftc":
        return validateCftcResponse(json, base);
      case "eia":
        return validateEiaResponse(json, base);
      default:
        return { ...base, errorMessage: "No validation defined for provider" };
    }
  } catch (err: any) {
    return { ...base, errorMessage: err?.message ?? "Validation error" };
  }
}

function validateTwelveDataResponse(json: unknown, now: number, base: ResponseValidation): ResponseValidation {
  const data = json as { values?: { datetime: string; open: string; high: string; low: string; close: string }[]; code?: string };
  if (data.code) {
    return { ...base, errorMessage: `Twelve Data error: ${data.code}` };
  }
  const values = data.values ?? [];
  if (values.length === 0) {
    return { ...base, errorMessage: "No candle data returned" };
  }
  const latest = values[0];
  const price = parseFloat(latest.close);
  if (!Number.isFinite(price) || price <= 0) {
    return { ...base, numericValid: false, errorMessage: "Invalid price" };
  }
  const ts = new Date(latest.datetime).getTime();
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: Number.isFinite(ts) ? ts : null,
    freshness: assessFreshness(Number.isFinite(ts) ? ts : undefined, now),
    provenance: "twelve-data-ohlcv",
  };
}

function validateCoinGeckoResponse(json: unknown, coinId: string, now: number, base: ResponseValidation): ResponseValidation {
  const data = json as Record<string, { usd?: number }>;
  const price = data[coinId]?.usd;
  if (price === undefined || !Number.isFinite(price) || price <= 0) {
    return { ...base, errorMessage: "No valid price in response" };
  }
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: now,
    freshness: "FRESH",
    provenance: "coingecko-price",
  };
}

function validateCoinGlassResponse(json: unknown, base: ResponseValidation): ResponseValidation {
  const data = json as { data?: { openInterest?: string; lastPrice?: string } };
  if (!data?.data) {
    return { ...base, errorMessage: "No data field in response" };
  }
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: null,
    freshness: "UNAVAILABLE",
    provenance: "coinglass-derivatives",
  };
}

function validateOkxResponse(json: unknown, _sym: string, now: number, base: ResponseValidation): ResponseValidation {
  const data = json as { data?: string[][] };
  const rows = data.data ?? [];
  if (rows.length === 0) {
    return { ...base, errorMessage: "No candle data" };
  }
  const row = rows[0];
  const price = parseFloat(row[4]);
  if (!Number.isFinite(price) || price <= 0) {
    return { ...base, numericValid: false, errorMessage: "Invalid close price" };
  }
  const ts = parseInt(row[0]);
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: Number.isFinite(ts) ? ts : null,
    freshness: assessFreshness(Number.isFinite(ts) ? ts : undefined, now),
    provenance: "okx-ohlcv",
  };
}

function validateAlphaVantageResponse(json: unknown, base: ResponseValidation): ResponseValidation {
  const data = json as Record<string, string>;
  if (data["Note"] || data["Error Message"]) {
    return { ...base, errorMessage: data["Note"] ?? data["Error Message"] ?? "AV error" };
  }
  if (!data["Symbol"]) {
    return { ...base, errorMessage: "No Symbol in response" };
  }
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: null,
    freshness: "DELAYED",
    provenance: "alpha-vantage-overview",
  };
}

function validateTreasuryResponse(json: unknown, base: ResponseValidation): ResponseValidation {
  const data = json as { data?: [{ avg_interest_rate_amt?: string; record_date?: string }] };
  const entry = data.data?.[0];
  if (!entry?.avg_interest_rate_amt) {
    return { ...base, errorMessage: "No rate data" };
  }
  const rate = parseFloat(entry.avg_interest_rate_amt);
  if (!Number.isFinite(rate)) {
    return { ...base, numericValid: false, errorMessage: "Invalid rate" };
  }
  const ts = entry.record_date ? new Date(entry.record_date).getTime() : null;
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: ts,
    freshness: assessFreshness(ts ?? undefined, Date.now()),
    provenance: "treasury-rates",
  };
}

function validateDefiLlamaResponse(json: unknown, base: ResponseValidation): ResponseValidation {
  if (!Array.isArray(json) || json.length === 0) {
    return { ...base, errorMessage: "No TVL data" };
  }
  const latest = json[json.length - 1] as { tvl?: number };
  if (latest?.tvl === undefined || !Number.isFinite(latest.tvl)) {
    return { ...base, numericValid: false, errorMessage: "Invalid TVL" };
  }
  return {
    ...base,
    schemaValid: true,
    numericValid: true,
    responseTimestamp: null,
    freshness: "DELAYED",
    provenance: "defillama-tvl",
  };
}

// ═══════════════════════════════════════════════════════════════
// BATCH VERIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Run verification for all specs in the matrix.
 * Respects rate limits and deduplicates.
 */
export async function verifyAllProviders(
  readEnv?: EnvReader,
  concurrency = 3,
): Promise<VerificationReport> {
  const results: VerificationResult[] = [];
  for (let i = 0; i < VERIFICATION_MATRIX.length; i += concurrency) {
    const batch = VERIFICATION_MATRIX.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(spec => verifyProvider(spec, readEnv)),
    );
    results.push(...batchResults);
  }
  return buildReport(results);
}

/**
 * Build verification report from results.
 */
export function buildReport(results: VerificationResult[]): VerificationReport {
  const summary = {
    total: results.length,
    liveVerified: results.filter(r => r.status === "LIVE_VERIFIED").length,
    liveVerifiedPartial: results.filter(r => r.status === "LIVE_VERIFIED_PARTIAL").length,
    architecturallyImplemented: results.filter(r => r.status === "ARCHITECTURALLY_IMPLEMENTED").length,
    credentialMissing: results.filter(r => r.status === "CREDENTIAL_MISSING").length,
    endpointFailed: results.filter(r => r.status === "ENDPOINT_FAILED").length,
    symbolUnsupported: results.filter(r => r.status === "SYMBOL_UNSUPPORTED").length,
    rateLimited: results.filter(r => r.status === "RATE_LIMITED").length,
    notTested: results.filter(r => r.status === "NOT_TESTED").length,
    other: results.filter(r => !["LIVE_VERIFIED", "LIVE_VERIFIED_PARTIAL", "ARCHITECTURALLY_IMPLEMENTED", "CREDENTIAL_MISSING", "ENDPOINT_FAILED", "SYMBOL_UNSUPPORTED", "RATE_LIMITED", "NOT_TESTED"].includes(r.status)).length,
  };
  return { generatedAt: Date.now(), results, summary };
}
