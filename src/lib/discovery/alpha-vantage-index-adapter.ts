/**
 * Phase 265 — Alpha Vantage Index Catalog/Data Adapter
 *
 * Implements discovery for Alpha Vantage indices via official contract:
 *   GET https://www.alphavantage.co/query?function=INDEX_CATALOG&apikey=...
 * Response (JSON): full list of supported index symbols + long-form names
 *   e.g. [{"symbol":"SPX","name":"S&P 500"}, ...] or variant with "1. symbol"/"2. name"
 *   The provider documentation states 200+ major indices, daily/weekly/monthly OHLC
 *   via INDEX_DATA, premium requirement.
 *
 * Also implements INDEX_DATA acquisition:
 *   GET https://www.alphavantage.co/query?function=INDEX_DATA&symbol=SPX&interval=daily|weekly|monthly&apikey=...
 * Response: historical OHLC time series, e.g. {"Meta Data": {...}, "data": [{"date": "...", "open": "...", "high": "...", "low": "...", "close": "..."}]}
 *   or Time Series (Daily) mapping.
 *
 * Invariants:
 * - providerInstrumentId exact native symbol byte-for-byte preserved
 * - No hardcoded index symbol list — catalog is source of truth
 * - provider-qualified identity alpha-vantage::<symbol> distinct from other providers
 * - Credential failure → CREDENTIAL_REQUIRED, rate limit → RATE_LIMITED, malformed → MALFORMED_RESPONSE
 * - Completeness COMPLETE when catalog succeeds (single response complete list)
 * - Deterministic ordering: sort by providerInstrumentId
 * - Deduplication via provider::providerInstrumentId
 * - No synthetic candles, no timestamp fabrication, no substitution
 * - If premium required, return correct provider/configuration state (CREDENTIAL_REQUIRED/RATE_LIMITED/UNAVAILABLE)
 * - Historical semantics: index data is HISTORICAL_ONLY / DELAYED, not real-time
 */

import type { AssetClass, DataCapability, InstrumentSubType } from "@/lib/data/universal/types";
import type {
  DiscoveredInstrument,
  ProviderDiscoveryAdapter,
  ProviderDiscoveryResult,
  TradingState,
} from "./types";
import type { DiscoveryCompleteness, CatalogFetchReport } from "./completeness";
import { checkCredentials, type EnvReader } from "@/lib/data/universal/live/credentials";

export const ALPHA_VANTAGE_INDEX_CATALOG_URL = "https://www.alphavantage.co/query?function=INDEX_CATALOG";
export const ALPHA_VANTAGE_INDEX_DATA_URL = "https://www.alphavantage.co/query?function=INDEX_DATA";
export const ALPHA_VANTAGE_PROVIDER_ID = "alpha-vantage";

type TransportResult = { ok: boolean; status: number; json: unknown };
type Transport = (url: string, apiKey: string) => Promise<TransportResult>;

type RawCatalogEntry = Record<string, unknown>;

// Phase 266 — historical index isolation: INDEX_DATA is historical/delayed only, not live.
// Use correct existing capability terminology: delayed/eod for historical, quote for price, discovery for catalog.
// Keep ohlcv for backward compat with Phase265 tests that check ohlcv, but primary historical is delayed/eod.
// liveSupported must be false to prevent historical entering live eligibility.
const INDEX_CAPS: DataCapability[] = ["delayed" as DataCapability, "eod" as DataCapability, "quote" as DataCapability, "ohlcv" as DataCapability];

function defaultTransport(fetchImpl: typeof fetch = fetch): Transport {
  return async (url: string, apiKey: string): Promise<TransportResult> => {
    // Alpha Vantage uses apikey query param, not header, but we accept both
    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = url.includes("apikey=") ? url : `${url}${separator}apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(fullUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    return { ok: res.ok, status: res.status, json };
  };
}

function extractSymbol(entry: RawCatalogEntry): string | undefined {
  // Try multiple possible keys, including Alpha Vantage's "1. symbol" style
  const candidates = [
    entry["symbol"],
    entry["Symbol"],
    entry["index_symbol"],
    entry["IndexSymbol"],
    entry["1. symbol"],
    entry["1. Symbol"],
    (entry as any)["symbol"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  // If entry is string itself (unlikely), use it
  if (typeof entry === "string" && (entry as string).trim().length > 0) {
    return (entry as string).trim();
  }
  return undefined;
}

function extractName(entry: RawCatalogEntry): string | undefined {
  const candidates = [
    entry["name"],
    entry["Name"],
    entry["long_name"],
    entry["longName"],
    entry["description"],
    entry["2. name"],
    entry["2. Name"],
    entry["index_name"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function extractCatalogArray(json: unknown): RawCatalogEntry[] | null {
  if (!json) return null;
  // Direct array
  if (Array.isArray(json)) {
    return json as RawCatalogEntry[];
  }
  if (typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;

  // Check common wrapper keys
  const wrapperKeys = ["data", "indexes", "indices", "bestMatches", "matches", "results", "catalog", "symbols"];
  for (const key of wrapperKeys) {
    const val = obj[key];
    if (Array.isArray(val)) {
      return val as RawCatalogEntry[];
    }
  }

  // If object itself looks like a map of symbol -> name, convert
  // e.g. {"SPX": "S&P 500", "DJI": "Dow Jones"}
  const values = Object.values(obj);
  if (values.length > 0 && values.every((v) => typeof v === "string")) {
    // Convert map to array
    return Object.entries(obj).map(([symbol, name]) => ({ symbol, name: name as string }));
  }

  // If object has many keys that are not meta, and each value is object with symbol/name, treat values as array
  // e.g. {"Meta Data": {...}, "data": [...]} already handled, but also check if top-level is dict of entries
  // Fallback: if object contains at least one key that looks like an index symbol and value contains name
  // We try to collect all entries that have symbol-like keys
  // For safety, if we find any array inside nested, return it
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0) {
      // Check if array elements look like catalog entries (have symbol)
      const first = v[0] as any;
      if (first && typeof first === "object" && (first.symbol || first["1. symbol"] || first.name || first["2. name"])) {
        return v as RawCatalogEntry[];
      }
    }
  }

  return null;
}

function isAuthError(json: unknown, status: number): boolean {
  if (status === 401 || status === 403) return true;
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  const msg = (
    (obj["Error Message"] as string) ||
    (obj["error"] as string) ||
    (obj["Note"] as string) ||
    (obj["Information"] as string) ||
    ""
  ).toLowerCase();
  return msg.includes("api key") || msg.includes("apikey") || msg.includes("invalid") && msg.includes("key") || msg.includes("premium") && msg.includes("subscription") === false ? false : msg.includes("api key");
}

function isRateLimit(json: unknown, status: number): boolean {
  if (status === 429) return true;
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  const note = ((obj["Note"] as string) || (obj["Information"] as string) || "").toLowerCase();
  return note.includes("rate") || note.includes("frequency") || note.includes("call per minute") || note.includes("thank you for using alpha vantage");
}

function isPremiumRequired(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  const info = ((obj["Information"] as string) || (obj["Note"] as string) || (obj["Error Message"] as string) || "").toLowerCase();
  // Premium endpoints return Information about premium
  return info.includes("premium") && (info.includes("subscribe") || info.includes("plan") || info.includes("endpoint"));
}

export interface AlphaVantageIndexCatalogEntry {
  symbol: string;
  name: string;
}

export async function discoverAlphaVantageIndexes(
  now: number,
  opts: {
    transport?: Transport;
    readEnv?: EnvReader;
    fetchImpl?: typeof fetch;
    catalogUrl?: string;
  } = {},
): Promise<ProviderDiscoveryResult> {
  const readEnv = opts.readEnv ?? (() => undefined);
  const cred = checkCredentials(ALPHA_VANTAGE_PROVIDER_ID, readEnv);
  if (cred && cred.authRequired && !cred.available) {
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: `CREDENTIAL_REQUIRED: Required credentials not configured: ${cred.missingEnvVarNames.join(", ") || "ALPHA_VANTAGE_API_KEY"}`,
    };
  }
  const apiKey = readEnv("ALPHA_VANTAGE_API_KEY")?.trim() ?? "";
  if (!apiKey) {
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: "CREDENTIAL_REQUIRED: Required credentials not configured: ALPHA_VANTAGE_API_KEY",
    };
  }

  const transport = opts.transport ?? defaultTransport(opts.fetchImpl);
  const catalogUrl = opts.catalogUrl ?? ALPHA_VANTAGE_INDEX_CATALOG_URL;

  const warnings: string[] = [];
  const instruments: DiscoveredInstrument[] = [];
  const seen = new Set<string>();

  try {
    const res = await transport(catalogUrl, apiKey);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings,
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `CREDENTIAL_REQUIRED: HTTP ${res.status}`,
        };
      }
      if (res.status === 429) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings,
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `RATE_LIMITED: HTTP ${res.status}`,
        };
      }
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        success: false,
        discoveredAt: now,
        instruments: [],
        warnings,
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
        error: `MALFORMED_RESPONSE: HTTP ${res.status}`,
      };
    }

    const json = res.json;
    if (!json) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        success: false,
        discoveredAt: now,
        instruments: [],
        warnings,
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
        error: "MALFORMED_RESPONSE: empty body",
      };
    }

    // Check for auth / rate limit / premium in body even when HTTP 200
    if (typeof json === "object" && json !== null) {
      const obj = json as Record<string, unknown>;
      const errMsg = (obj["Error Message"] as string) || "";
      const note = (obj["Note"] as string) || "";
      const info = (obj["Information"] as string) || "";
      const combined = `${errMsg} ${note} ${info}`.toLowerCase();

      if (combined.includes("api key") || combined.includes("apikey") || combined.includes("invalid") && combined.includes("key")) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings,
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `CREDENTIAL_REQUIRED: ${errMsg || note || info || "auth failed"}`,
        };
      }
      if (combined.includes("rate") || combined.includes("frequency") || combined.includes("call per minute") || combined.includes("thank you for using alpha vantage")) {
        // Check if premium required vs rate limit
        if (combined.includes("premium")) {
          return {
            provider: ALPHA_VANTAGE_PROVIDER_ID,
            success: false,
            discoveredAt: now,
            instruments: [],
            warnings,
            completeness: "FAILED",
            pagesFetched: 0,
            totalDiscovered: 0,
            error: `CREDENTIAL_REQUIRED: Premium required — ${info || note || errMsg}`,
          };
        }
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings,
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `RATE_LIMITED: ${note || info || errMsg}`,
        };
      }
      if (combined.includes("premium") && (combined.includes("subscribe") || combined.includes("plan") || combined.includes("endpoint"))) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings,
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `CREDENTIAL_REQUIRED: Premium required — ${info || note || errMsg}`,
        };
      }
    }

    const catalogArray = extractCatalogArray(json);
    if (!catalogArray) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        success: false,
        discoveredAt: now,
        instruments: [],
        warnings,
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
        error: "MALFORMED_RESPONSE: data field missing or not array",
      };
    }

    if (catalogArray.length === 0) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        success: true,
        discoveredAt: now,
        instruments: [],
        warnings: [...warnings, "catalog empty — no indices returned"],
        completeness: "COMPLETE",
        pagesFetched: 1,
        totalDiscovered: 0,
        catalogs: [
          {
            path: "/query?function=INDEX_CATALOG",
            assetClass: "indices",
            completeness: "COMPLETE",
            pagesFetched: 1,
            totalDiscovered: 0,
          },
        ],
      };
    }

    for (const raw of catalogArray) {
      if (!raw || typeof raw !== "object") {
        warnings.push(`skipped non-object catalog entry`);
        continue;
      }
      const symbol = extractSymbol(raw as RawCatalogEntry);
      if (!symbol) {
        warnings.push(`skipped entry missing symbol: ${JSON.stringify(raw).slice(0, 100)}`);
        continue;
      }
      const exactSymbol = symbol; // exact native byte-for-byte
      const key = `${ALPHA_VANTAGE_PROVIDER_ID}::${exactSymbol}`;
      if (seen.has(key)) {
        warnings.push(`duplicate index ${exactSymbol} skipped`);
        continue;
      }
      const name = extractName(raw as RawCatalogEntry) ?? exactSymbol;

      // For indices, baseAsset = symbol, quoteAsset = USD (or POINT), but we preserve exact symbol
      // Use index_cash subtype, TRADING state, capabilities ohlcv/quote
      const inst: DiscoveredInstrument = {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        providerInstrumentId: exactSymbol,
        assetClass: "indices" as AssetClass,
        subType: "index_cash" as InstrumentSubType,
        baseAsset: exactSymbol.toUpperCase(),
        quoteAsset: "USD",
        tradingState: "TRADING" as TradingState,
        capabilities: [...INDEX_CAPS],
        region: "US",
        discoveredAt: now,
      };
      // Preserve long-form name via region? No, but we can store in warning? Actually we need to preserve name somewhere.
      // We will keep name in a custom field via precision? No, we should keep it as part of instrument? The contract doesn't have name field, but we can use region or keep via warning.
      // For now, we store name as part of providerInstrumentId? No. We will keep it in a separate map, but for discovery we only need symbol.
      // However, to satisfy requirement of long-form name, we will include it in the instrument's baseAsset? No.
      // We will attach name via a custom property in a way that doesn't break contract: use region as name? Better to store as part of instrument via extension.
      // Since DiscoveredInstrument doesn't have name, we will keep it in warnings or as part of region? Let's keep it in a separate field via (inst as any).name = name for internal use, but still providerInstrumentId exact.
      (inst as any).name = name;
      instruments.push(inst);
      seen.add(key);
    }

    // Deterministic ordering
    instruments.sort((a, b) => a.providerInstrumentId.localeCompare(b.providerInstrumentId));

    const catalogs: CatalogFetchReport[] = [
      {
        path: "/query?function=INDEX_CATALOG",
        assetClass: "indices",
        completeness: "COMPLETE" as DiscoveryCompleteness,
        pagesFetched: 1,
        totalDiscovered: instruments.length,
      },
    ];

    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      success: true,
      discoveredAt: now,
      instruments,
      warnings,
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: instruments.length,
      catalogs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("rate_limit") || lower.includes("429") || lower.includes("rate limit") || lower.includes("frequency")) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        success: false,
        discoveredAt: now,
        instruments: [],
        warnings,
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
        error: `RATE_LIMITED: ${msg}`,
      };
    }
    if (lower.includes("auth") || lower.includes("401") || lower.includes("403") || lower.includes("credential") || lower.includes("api key")) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        success: false,
        discoveredAt: now,
        instruments: [],
        warnings,
        completeness: "FAILED",
        pagesFetched: 0,
        totalDiscovered: 0,
        error: `CREDENTIAL_REQUIRED: ${msg}`,
      };
    }
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings,
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: `MALFORMED_RESPONSE: ${msg}`,
    };
  }
}

// ────────────────────────────────────────────────────────────────
// INDEX_DATA
// ────────────────────────────────────────────────────────────────

export type AlphaVantageInterval = "daily" | "weekly" | "monthly";

export interface AlphaVantageIndexCandle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number; // ms, provider-observed from date
  observedAt: number; // when we observed it
}

export interface AlphaVantageIndexDataResult {
  provider: string;
  symbol: string;
  interval: AlphaVantageInterval;
  success: boolean;
  candles: AlphaVantageIndexCandle[];
  warnings: string[];
  error?: string;
  freshness: "DELAYED" | "STALE" | "FRESH";
  timestampProvenance: "PROVIDER_OBSERVED" | "APPLICATION_RECEIPT";
  completeness: DiscoveryCompleteness;
}

function parseNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractCandles(json: unknown, now: number): { candles: AlphaVantageIndexCandle[]; warnings: string[] } | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const warnings: string[] = [];
  const candles: AlphaVantageIndexCandle[] = [];

  // Format 1: { "data": [ { "date": "2024-01-01", "open": "123", ... } ] }
  const dataField = obj["data"];
  if (Array.isArray(dataField)) {
    for (const entry of dataField) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const date = (e["date"] as string) || (e["time"] as string) || (e["timestamp"] as string);
      if (!date) {
        warnings.push("skipped candle missing date");
        continue;
      }
      const open = parseNumber(e["open"] ?? e["1. open"] ?? (e as any)["open"]);
      const high = parseNumber(e["high"] ?? e["2. high"]);
      const low = parseNumber(e["low"] ?? e["3. low"]);
      const close = parseNumber(e["close"] ?? e["4. close"]);
      if (open === null || high === null || low === null || close === null) {
        warnings.push(`skipped candle ${date} missing OHLC`);
        continue;
      }
      // Numerical validation
      if (high < low || high < open || high < close || low > open || low > close) {
        warnings.push(`candle ${date} OHLC inconsistent but kept: high ${high} low ${low}`);
      }
      const ts = Date.parse(date);
      if (!Number.isFinite(ts)) {
        warnings.push(`skipped candle ${date} invalid timestamp`);
        continue;
      }
      candles.push({ date, open, high, low, close, timestamp: ts, observedAt: now });
    }
    // Sort deterministic by timestamp
    candles.sort((a, b) => a.timestamp - b.timestamp);
    return { candles, warnings };
  }

  // Format 2: Time Series mapping like { "Time Series (Daily)": { "2024-01-01": { "1. open": "...", ... } } }
  const timeSeriesKeys = Object.keys(obj).filter((k) => k.toLowerCase().includes("time series"));
  for (const tsKey of timeSeriesKeys) {
    const series = obj[tsKey];
    if (!series || typeof series !== "object") continue;
    const seriesObj = series as Record<string, unknown>;
    for (const [dateStr, candleRaw] of Object.entries(seriesObj)) {
      if (!candleRaw || typeof candleRaw !== "object") continue;
      const cr = candleRaw as Record<string, unknown>;
      const open = parseNumber(cr["1. open"] ?? cr["open"]);
      const high = parseNumber(cr["2. high"] ?? cr["high"]);
      const low = parseNumber(cr["3. low"] ?? cr["low"]);
      const close = parseNumber(cr["4. close"] ?? cr["close"]);
      if (open === null || high === null || low === null || close === null) {
        warnings.push(`skipped candle ${dateStr} missing OHLC`);
        continue;
      }
      const ts = Date.parse(dateStr);
      if (!Number.isFinite(ts)) {
        warnings.push(`skipped candle ${dateStr} invalid timestamp`);
        continue;
      }
      candles.push({ date: dateStr, open, high, low, close, timestamp: ts, observedAt: now });
    }
    candles.sort((a, b) => a.timestamp - b.timestamp);
    return { candles, warnings };
  }

  return null;
}

export async function fetchAlphaVantageIndexData(
  symbol: string,
  interval: AlphaVantageInterval,
  now: number,
  opts: {
    transport?: Transport;
    readEnv?: EnvReader;
    fetchImpl?: typeof fetch;
    dataUrl?: string;
  } = {},
): Promise<AlphaVantageIndexDataResult> {
  const readEnv = opts.readEnv ?? (() => undefined);
  const cred = checkCredentials(ALPHA_VANTAGE_PROVIDER_ID, readEnv);
  if (cred && cred.authRequired && !cred.available) {
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      success: false,
      candles: [],
      warnings: [],
      error: `CREDENTIAL_REQUIRED: Required credentials not configured: ${cred.missingEnvVarNames.join(", ") || "ALPHA_VANTAGE_API_KEY"}`,
      freshness: "DELAYED",
      timestampProvenance: "APPLICATION_RECEIPT",
      completeness: "FAILED",
    };
  }
  const apiKey = readEnv("ALPHA_VANTAGE_API_KEY")?.trim() ?? "";
  if (!apiKey) {
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      success: false,
      candles: [],
      warnings: [],
      error: "CREDENTIAL_REQUIRED: Required credentials not configured: ALPHA_VANTAGE_API_KEY",
      freshness: "DELAYED",
      timestampProvenance: "APPLICATION_RECEIPT",
      completeness: "FAILED",
    };
  }

  if (!["daily", "weekly", "monthly"].includes(interval)) {
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      success: false,
      candles: [],
      warnings: [],
      error: `MALFORMED_RESPONSE: Invalid interval ${interval}, expected daily|weekly|monthly`,
      freshness: "DELAYED",
      timestampProvenance: "APPLICATION_RECEIPT",
      completeness: "FAILED",
    };
  }

  const transport = opts.transport ?? defaultTransport(opts.fetchImpl);
  const baseUrl = opts.dataUrl ?? ALPHA_VANTAGE_INDEX_DATA_URL;
  const url = `${baseUrl}&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;

  try {
    const res = await transport(url, apiKey);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          symbol,
          interval,
          success: false,
          candles: [],
          warnings: [],
          error: `CREDENTIAL_REQUIRED: HTTP ${res.status}`,
          freshness: "DELAYED",
          timestampProvenance: "APPLICATION_RECEIPT",
          completeness: "FAILED",
        };
      }
      if (res.status === 429) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          symbol,
          interval,
          success: false,
          candles: [],
          warnings: [],
          error: `RATE_LIMITED: HTTP ${res.status}`,
          freshness: "DELAYED",
          timestampProvenance: "APPLICATION_RECEIPT",
          completeness: "FAILED",
        };
      }
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        success: false,
        candles: [],
        warnings: [],
        error: `MALFORMED_RESPONSE: HTTP ${res.status}`,
        freshness: "DELAYED",
        timestampProvenance: "APPLICATION_RECEIPT",
        completeness: "FAILED",
      };
    }

    const json = res.json;
    if (!json) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        success: false,
        candles: [],
        warnings: [],
        error: "MALFORMED_RESPONSE: empty body",
        freshness: "DELAYED",
        timestampProvenance: "APPLICATION_RECEIPT",
        completeness: "FAILED",
      };
    }

    // Check for auth / rate limit / premium in body
    if (typeof json === "object" && json !== null) {
      const obj = json as Record<string, unknown>;
      const errMsg = (obj["Error Message"] as string) || "";
      const note = (obj["Note"] as string) || "";
      const info = (obj["Information"] as string) || "";
      const combined = `${errMsg} ${note} ${info}`.toLowerCase();

      if (combined.includes("api key") || combined.includes("apikey")) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          symbol,
          interval,
          success: false,
          candles: [],
          warnings: [],
          error: `CREDENTIAL_REQUIRED: ${errMsg || note || info}`,
          freshness: "DELAYED",
          timestampProvenance: "APPLICATION_RECEIPT",
          completeness: "FAILED",
        };
      }
      if (combined.includes("premium")) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          symbol,
          interval,
          success: false,
          candles: [],
          warnings: [],
          error: `CREDENTIAL_REQUIRED: Premium required — ${info || note || errMsg}`,
          freshness: "DELAYED",
          timestampProvenance: "APPLICATION_RECEIPT",
          completeness: "FAILED",
        };
      }
      if (combined.includes("rate") || combined.includes("frequency") || combined.includes("call per minute") || combined.includes("thank you for using alpha vantage")) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          symbol,
          interval,
          success: false,
          candles: [],
          warnings: [],
          error: `RATE_LIMITED: ${note || info || errMsg}`,
          freshness: "DELAYED",
          timestampProvenance: "APPLICATION_RECEIPT",
          completeness: "FAILED",
        };
      }
    }

    const extracted = extractCandles(json, now);
    if (!extracted) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        success: false,
        candles: [],
        warnings: [],
        error: "MALFORMED_RESPONSE: could not extract candles",
        freshness: "DELAYED",
        timestampProvenance: "APPLICATION_RECEIPT",
        completeness: "FAILED",
      };
    }

    // Historical semantics: index data is delayed/historical, not real-time
    // Freshness is DELAYED, provenance PROVIDER_OBSERVED (date from provider)
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      success: true,
      candles: extracted.candles,
      warnings: extracted.warnings,
      freshness: "DELAYED",
      timestampProvenance: "PROVIDER_OBSERVED",
      completeness: extracted.candles.length > 0 ? "COMPLETE" : "FAILED",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("rate") || lower.includes("429") || lower.includes("frequency")) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        success: false,
        candles: [],
        warnings: [],
        error: `RATE_LIMITED: ${msg}`,
        freshness: "DELAYED",
        timestampProvenance: "APPLICATION_RECEIPT",
        completeness: "FAILED",
      };
    }
    if (lower.includes("auth") || lower.includes("401") || lower.includes("403") || lower.includes("credential") || lower.includes("api key")) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        success: false,
        candles: [],
        warnings: [],
        error: `CREDENTIAL_REQUIRED: ${msg}`,
        freshness: "DELAYED",
        timestampProvenance: "APPLICATION_RECEIPT",
        completeness: "FAILED",
      };
    }
    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      success: false,
      candles: [],
      warnings: [],
      error: `MALFORMED_RESPONSE: ${msg}`,
      freshness: "DELAYED",
      timestampProvenance: "APPLICATION_RECEIPT",
      completeness: "FAILED",
    };
  }
}

export function createAlphaVantageIndexDiscoveryAdapter(
  fetchImpl: typeof fetch = fetch,
  readEnv: EnvReader = () => undefined,
): ProviderDiscoveryAdapter {
  return {
    provider: ALPHA_VANTAGE_PROVIDER_ID,
    assetClasses: ["indices" as AssetClass],
    async discover(now: number): Promise<ProviderDiscoveryResult> {
      try {
        return await discoverAlphaVantageIndexes(now, { fetchImpl, readEnv });
      } catch (err) {
        return {
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          success: false,
          discoveredAt: now,
          instruments: [],
          warnings: [],
          completeness: "FAILED",
          pagesFetched: 0,
          totalDiscovered: 0,
          error: `MALFORMED_RESPONSE: ${err instanceof Error ? err.message : "unknown error"}`,
        };
      }
    },
  };
}

export function createAlphaVantageIndexUniversalAdapter(
  fetchImpl: typeof fetch = fetch,
  readEnv: EnvReader = () => undefined,
) {
  const legacy = createAlphaVantageIndexDiscoveryAdapter(fetchImpl, readEnv);
  return {
    providerId: ALPHA_VANTAGE_PROVIDER_ID,
    displayName: "Alpha Vantage",
    assetClasses: ["indices" as AssetClass],
    // Phase 266 — historical isolation: INDEX_DATA is DELAYED/HISTORICAL, not LIVE.
    // Capabilities use correct terminology: discovery + delayed/eod + quote (ohlcv kept for backward compat but liveSupported false)
    capabilities: ["discovery", "delayed", "eod", "quote", "ohlcv"] as any,
    status: "AVAILABLE" as const,
    discoverySupported: true,
    liveSupported: false,
    discover: legacy.discover,
    classifyFailure: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("CREDENTIAL_REQUIRED") || msg.includes("AUTH")) return "REQUIRES_CREDENTIAL";
      if (msg.includes("RATE_LIMITED") || msg.includes("429")) return "RATE_LIMITED";
      if (msg.includes("LICENSE")) return "REQUIRES_LICENSE";
      return "FAILED";
    },
  };
}
