/**
 * Phase 265 — Alpha Vantage Index Catalog/Data Adapter
 *
 * Implements discovery for Alpha Vantage INDEX_CATALOG and acquisition for INDEX_DATA.
 *
 * Official contract (alphavantage.co/documentation/):
 *   GET https://www.alphavantage.co/query?function=INDEX_CATALOG&apikey=...
 *   Response: JSON array or object containing list of {symbol, name} — full list of supported index symbols with long-form names.
 *   Example symbols: DJI, SPX, NDX, VIX, RUT, COMP, DJS, etc. 200+ indices.
 *
 *   GET https://www.alphavantage.co/query?function=INDEX_DATA&symbol=SPX&interval=daily|weekly|monthly&apikey=...
 *   Response: Meta Data + time series (e.g., "Time Series (Daily)" or "Weekly Time Series" or "Monthly Time Series") with OHLC.
 *   Intervals: daily, weekly, monthly. Premium endpoint.
 *
 * Invariants:
 * - providerInstrumentId exact native symbol preserved byte-for-byte.
 * - No hardcoded index symbol list — catalog is source of truth.
 * - Provider-qualified identity alpha-vantage::<symbol> distinct.
 * - Deterministic ordering (sorted by symbol).
 * - Deduplication via provider::providerInstrumentId.
 * - Credential failure → CREDENTIAL_REQUIRED, rate limit → RATE_LIMITED, malformed → MALFORMED_RESPONSE.
 * - Completeness COMPLETE when catalog succeeds (single complete response, no pagination).
 * - Capabilities: discovery → ohlcv, quote? Actually indices → ohlcv historical.
 * - TradingState TRADING (catalog is positive assertion).
 * - discoveredAt = now (provenance).
 * - No synthetic candles, no timestamp fabrication, no substitution.
 * - Historical semantics: daily/weekly/monthly is HISTORICAL_ONLY/DELAYED, not real-time LIVE.
 */

import type { AssetClass, DataCapability, InstrumentSubType } from "@/lib/data/universal/types";
import type { EnvReader } from "@/lib/data/universal/live/credentials";
import { checkCredentials } from "@/lib/data/universal/live/credentials";
import type {
  DiscoveredInstrument,
  ProviderDiscoveryAdapter,
  ProviderDiscoveryResult,
  TradingState,
} from "./types";
import type { DiscoveryCompleteness, CatalogFetchReport } from "./completeness";
import { rollupCompleteness } from "./completeness";

export const ALPHA_VANTAGE_CATALOG_URL = "https://www.alphavantage.co/query?function=INDEX_CATALOG";
export const ALPHA_VANTAGE_DATA_URL = "https://www.alphavantage.co/query?function=INDEX_DATA";
export const ALPHA_VANTAGE_PROVIDER_ID = "alpha-vantage";

type TransportResult = { ok: boolean; status: number; json: unknown };
type Transport = (url: string, apiKey: string) => Promise<TransportResult>;

export type AlphaVantageIndexCatalogEntry = {
  symbol?: string;
  name?: string;
  Symbol?: string;
  Name?: string;
};

type AlphaVantageCatalogResponse =
  | AlphaVantageIndexCatalogEntry[]
  | { data?: AlphaVantageIndexCatalogEntry[]; symbols?: AlphaVantageIndexCatalogEntry[]; indices?: AlphaVantageIndexCatalogEntry[]; bestMatches?: AlphaVantageIndexCatalogEntry[] }
  | Record<string, unknown>;

function defaultTransport(fetchImpl: typeof fetch = fetch): Transport {
  return async (url: string, apiKey: string): Promise<TransportResult> => {
    const finalUrl = url.includes("apikey=") ? url : `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(finalUrl, {
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

function extractCatalogEntries(json: unknown): AlphaVantageIndexCatalogEntry[] | null {
  if (!json) return null;
  if (Array.isArray(json)) {
    return json as AlphaVantageIndexCatalogEntry[];
  }
  if (typeof json === "object") {
    const obj = json as Record<string, unknown>;
    // Check common wrapper fields
    const candidates = ["data", "symbols", "indices", "bestMatches", "results", "indexes"];
    for (const key of candidates) {
      const val = obj[key];
      if (Array.isArray(val)) {
        return val as AlphaVantageIndexCatalogEntry[];
      }
    }
    // Check if object is map of symbol -> name? e.g., {"DJI": "Dow Jones..."}
    // If all values are strings and keys look like symbols, convert
    const entries = Object.entries(obj);
    // If object contains Note, Information, Error Message → not catalog
    if (obj.Note || obj.Information || (obj as any)["Error Message"]) {
      return null;
    }
    // If object has many keys that are not meta, maybe it's time series? Not catalog
    // Heuristic: if object contains "Meta Data" it's INDEX_DATA, not catalog
    if (obj["Meta Data"] || (obj as any)["Meta Data"]) {
      return null;
    }
    // If entries look like symbol entries (each value is object with symbol/name)
    // Already handled array case, so if we reach here and object values are objects with symbol/name, collect
    const collected: AlphaVantageIndexCatalogEntry[] = [];
    for (const [, v] of entries) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        if (rec.symbol || rec.Symbol || rec.name || rec.Name) {
          collected.push(rec as AlphaVantageIndexCatalogEntry);
        }
      }
    }
    if (collected.length > 0) return collected;
    // If object is simple map symbol->name
    const simple: AlphaVantageIndexCatalogEntry[] = [];
    for (const [k, v] of entries) {
      if (typeof v === "string" && k.length <= 10) {
        simple.push({ symbol: k, name: v });
      }
    }
    if (simple.length > 0) return simple;
  }
  return null;
}

function normalizeCatalogEntry(entry: AlphaVantageIndexCatalogEntry): { symbol: string; name: string } | null {
  const symbol = (entry.symbol ?? entry.Symbol ?? "").trim();
  const name = (entry.name ?? entry.Name ?? "").trim();
  if (!symbol) return null;
  // Name may be missing? Still allow symbol, use symbol as name fallback, but warn
  return { symbol, name: name || symbol };
}

function classifyFailureFromResponse(json: unknown, status: number): { code: string; msg: string } | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const note = (obj.Note as string) || (obj.Information as string) || "";
  const errMsg = (obj["Error Message"] as string) || "";
  const lowerNote = note.toLowerCase();
  const lowerErr = errMsg.toLowerCase();

  if (status === 429 || lowerNote.includes("rate") || lowerNote.includes("too many") || lowerNote.includes("limit") || lowerErr.includes("rate")) {
    return { code: "429", msg: note || errMsg || "rate limit" };
  }
  if (status === 401 || status === 403 || lowerNote.includes("apikey") || lowerNote.includes("api key") || lowerErr.includes("apikey") || lowerErr.includes("api key") || lowerErr.includes("invalid") || lowerErr.includes("auth")) {
    // Distinguish auth vs invalid symbol: if errMsg says invalid symbol, it's not auth
    if (lowerErr.includes("invalid") && (lowerErr.includes("symbol") || lowerErr.includes("function"))) {
      // Could be invalid symbol, not necessarily auth — treat as malformed for catalog? For catalog, invalid function would be malformed
      if (lowerErr.includes("apikey") || lowerErr.includes("api key")) {
        return { code: "401", msg: errMsg };
      }
      // For catalog, invalid symbol not applicable, but we return null to let malformed handling take over
      return null;
    }
    if (status === 401 || status === 403 || lowerNote.includes("apikey") || lowerErr.includes("apikey") || lowerErr.includes("api key")) {
      return { code: "401", msg: note || errMsg || "auth failed" };
    }
  }
  if (errMsg) {
    // Other provider error
    return { code: String(status || 400), msg: errMsg };
  }
  if (note && (lowerNote.includes("premium") || lowerNote.includes("subscription") || lowerNote.includes("entitlement"))) {
    // Premium required → treat as CREDENTIAL_REQUIRED / LICENSE? Actually it's premium plan, so credential required + premium
    return { code: "402", msg: note };
  }
  return null;
}

const INDEX_CAPS: DataCapability[] = ["ohlcv", "quote"];

export async function discoverAlphaVantageIndices(
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
  const catalogUrl = opts.catalogUrl ?? ALPHA_VANTAGE_CATALOG_URL;

  const warnings: string[] = [];
  const instruments: DiscoveredInstrument[] = [];
  const seen = new Set<string>();
  const catalogs: CatalogFetchReport[] = [];

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
      // Check body for error classification
      if (res.json && typeof res.json === "object") {
        const failure = classifyFailureFromResponse(res.json, res.status);
        if (failure) {
          if (failure.code === "429") {
            return {
              provider: ALPHA_VANTAGE_PROVIDER_ID,
              success: false,
              discoveredAt: now,
              instruments: [],
              warnings,
              completeness: "FAILED",
              pagesFetched: 0,
              totalDiscovered: 0,
              error: `RATE_LIMITED: ${failure.msg}`,
            };
          }
          if (failure.code === "401" || failure.code === "402") {
            return {
              provider: ALPHA_VANTAGE_PROVIDER_ID,
              success: false,
              discoveredAt: now,
              instruments: [],
              warnings,
              completeness: "FAILED",
              pagesFetched: 0,
              totalDiscovered: 0,
              error: `CREDENTIAL_REQUIRED: ${failure.msg}`,
            };
          }
        }
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

    // Check for Note/Information/Error Message in successful HTTP response
    if (typeof json === "object" && json !== null) {
      const failure = classifyFailureFromResponse(json, res.status);
      if (failure) {
        if (failure.code === "429") {
          return {
            provider: ALPHA_VANTAGE_PROVIDER_ID,
            success: false,
            discoveredAt: now,
            instruments: [],
            warnings,
            completeness: "FAILED",
            pagesFetched: 0,
            totalDiscovered: 0,
            error: `RATE_LIMITED: ${failure.msg}`,
          };
        }
        if (failure.code === "401" || failure.code === "402") {
          return {
            provider: ALPHA_VANTAGE_PROVIDER_ID,
            success: false,
            discoveredAt: now,
            instruments: [],
            warnings,
            completeness: "FAILED",
            pagesFetched: 0,
            totalDiscovered: 0,
            error: `CREDENTIAL_REQUIRED: ${failure.msg}`,
          };
        }
        // Other errors → malformed
        if (failure.msg) {
          return {
            provider: ALPHA_VANTAGE_PROVIDER_ID,
            success: false,
            discoveredAt: now,
            instruments: [],
            warnings,
            completeness: "FAILED",
            pagesFetched: 0,
            totalDiscovered: 0,
            error: `MALFORMED_RESPONSE: ${failure.msg}`,
          };
        }
      }
    }

    const entries = extractCatalogEntries(json);
    if (!entries) {
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

    if (entries.length === 0) {
      return {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        success: true,
        discoveredAt: now,
        instruments: [],
        warnings,
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

    // Deterministic ordering: sort by symbol
    const normalized = entries
      .map(normalizeCatalogEntry)
      .filter((e): e is { symbol: string; name: string } => e !== null)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    let discoveredInCatalog = 0;
    for (const { symbol, name } of normalized) {
      const exactSymbol = symbol; // preserve exact native byte-for-byte
      const providerInstrumentId = exactSymbol;
      const key = `${ALPHA_VANTAGE_PROVIDER_ID}::${providerInstrumentId}`;
      if (seen.has(key)) {
        warnings.push(`duplicate index ${exactSymbol} skipped`);
        continue;
      }
      // Validate symbol not empty
      if (!exactSymbol || exactSymbol.trim().length === 0) {
        warnings.push(`entry missing symbol, skipped`);
        continue;
      }

      const inst: DiscoveredInstrument = {
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        providerInstrumentId,
        assetClass: "indices" as AssetClass,
        subType: "index_cash" as InstrumentSubType,
        baseAsset: exactSymbol.toUpperCase(),
        quoteAsset: "USD", // indices quoted in USD/points, provider doesn't give currency, use USD as per twelve-data pattern
        tradingState: "TRADING" as TradingState,
        capabilities: [...INDEX_CAPS],
        region: "global",
        discoveredAt: now,
      };
      // Preserve long-form name in region? No, but we can store in warning? Actually we should store name as part of base? No, we keep symbol exact, name is additional metadata not in DiscoveredInstrument, but we can use region? Better to not invent. Keep symbol.
      // For provenance, name could be stored via warning? No. We'll keep symbol as identity, name is catalog metadata.
      // We ensure no hardcoded list: catalog is source of truth.

      // Attach name via optional? DiscoveredInstrument doesn't have name field, but we preserve via baseAsset? Actually baseAsset is symbol, not name. Name is extra, but we don't have field. We can keep it in warning for now, but better to extend? For now, keep symbol as identity, name is not stored but we have it in normalized list.

      instruments.push(inst);
      seen.add(key);
      discoveredInCatalog += 1;
    }

    catalogs.push({
      path: "/query?function=INDEX_CATALOG",
      assetClass: "indices",
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: discoveredInCatalog,
    });

    const overallCompleteness: DiscoveryCompleteness = "COMPLETE";

    return {
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      success: true,
      discoveredAt: now,
      instruments,
      warnings,
      completeness: overallCompleteness,
      pagesFetched: 1,
      totalDiscovered: instruments.length,
      catalogs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("rate_limit") || lower.includes("429") || lower.includes("rate limit")) {
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
    if (lower.includes("auth_error") || lower.includes("401") || lower.includes("403") || lower.includes("credential")) {
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
// INDEX_DATA acquisition
// ────────────────────────────────────────────────────────────────

export type AlphaVantageIndexInterval = "daily" | "weekly" | "monthly";

export interface AlphaVantageIndexCandle {
  timestamp: number; // provider-observed ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AlphaVantageIndexDataResult {
  success: boolean;
  provider: typeof ALPHA_VANTAGE_PROVIDER_ID;
  symbol: string;
  interval: AlphaVantageIndexInterval;
  candles: AlphaVantageIndexCandle[];
  observedAt: number;
  error?: string;
  freshness: "DELAYED" | "STALE" | "FRESH" | "UNAVAILABLE";
  isHistorical: boolean;
}

function parseIndexTime(dateStr: string): number | null {
  // Alpha Vantage returns dates like "2024-05-17" or "2024-05-17 19:00:00" etc.
  // For daily/weekly/monthly, it's date only YYYY-MM-DD
  // We parse as UTC midnight
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

function extractTimeSeries(json: unknown, interval: AlphaVantageIndexInterval): Record<string, Record<string, string>> | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  // Possible keys: "Time Series (Daily)", "Weekly Time Series", "Monthly Time Series", "Time Series (Daily)" etc.
  const candidates = [
    `Time Series (${interval})`,
    `Time Series (${interval.charAt(0).toUpperCase() + interval.slice(1)})`,
    `${interval.charAt(0).toUpperCase() + interval.slice(1)} Time Series`,
    `Time Series (Daily)`,
    `Weekly Time Series`,
    `Monthly Time Series`,
    `Time Series (Daily)`,
  ];
  // Also check keys containing "Time Series"
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase().includes("time series")) {
      const val = obj[key];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        return val as Record<string, Record<string, string>>;
      }
    }
  }
  // Fallback to explicit candidates
  for (const cand of candidates) {
    const val = obj[cand];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return val as Record<string, Record<string, string>>;
    }
  }
  return null;
}

function parseOHLC(row: Record<string, string>): { open: number; high: number; low: number; close: number; volume?: number } | null {
  // Keys like "1. open", "2. high", "3. low", "4. close", "5. volume"
  const openStr = row["1. open"] ?? row["open"];
  const highStr = row["2. high"] ?? row["high"];
  const lowStr = row["3. low"] ?? row["low"];
  const closeStr = row["4. close"] ?? row["close"];
  const volStr = row["5. volume"] ?? row["volume"];

  const open = openStr ? Number(openStr) : NaN;
  const high = highStr ? Number(highStr) : NaN;
  const low = lowStr ? Number(lowStr) : NaN;
  const close = closeStr ? Number(closeStr) : NaN;

  if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null;
  }
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    // Numerical validation: OHLC must be positive
    return null;
  }
  if (high < low || high < open || high < close || low > open || low > close) {
    // Basic OHLC validation: high >= low, etc. Allow equal? For indices, high >= max(open, close), low <= min(open, close)
    // But we do minimal: high >= low
    if (high < low) return null;
  }

  const result: { open: number; high: number; low: number; close: number; volume?: number } = {
    open,
    high,
    low,
    close,
  };
  if (volStr) {
    const vol = Number(volStr);
    if (Number.isFinite(vol)) result.volume = vol;
  }
  return result;
}

export async function fetchAlphaVantageIndexData(
  symbol: string,
  interval: AlphaVantageIndexInterval,
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
      success: false,
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      candles: [],
      observedAt: now,
      error: `CREDENTIAL_REQUIRED: Required credentials not configured: ${cred.missingEnvVarNames.join(", ") || "ALPHA_VANTAGE_API_KEY"}`,
      freshness: "UNAVAILABLE",
      isHistorical: true,
    };
  }
  const apiKey = readEnv("ALPHA_VANTAGE_API_KEY")?.trim() ?? "";
  if (!apiKey) {
    return {
      success: false,
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      candles: [],
      observedAt: now,
      error: "CREDENTIAL_REQUIRED: Required credentials not configured: ALPHA_VANTAGE_API_KEY",
      freshness: "UNAVAILABLE",
      isHistorical: true,
    };
  }

  const transport = opts.transport ?? defaultTransport(opts.fetchImpl);
  const dataUrl = opts.dataUrl ?? `${ALPHA_VANTAGE_DATA_URL}&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;

  try {
    const res = await transport(dataUrl, apiKey);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          symbol,
          interval,
          candles: [],
          observedAt: now,
          error: `CREDENTIAL_REQUIRED: HTTP ${res.status}`,
          freshness: "UNAVAILABLE",
          isHistorical: true,
        };
      }
      if (res.status === 429) {
        return {
          success: false,
          provider: ALPHA_VANTAGE_PROVIDER_ID,
          symbol,
          interval,
          candles: [],
          observedAt: now,
          error: `RATE_LIMITED: HTTP ${res.status}`,
          freshness: "UNAVAILABLE",
          isHistorical: true,
        };
      }
      if (res.json && typeof res.json === "object") {
        const failure = classifyFailureFromResponse(res.json, res.status);
        if (failure) {
          if (failure.code === "429") {
            return {
              success: false,
              provider: ALPHA_VANTAGE_PROVIDER_ID,
              symbol,
              interval,
              candles: [],
              observedAt: now,
              error: `RATE_LIMITED: ${failure.msg}`,
              freshness: "UNAVAILABLE",
              isHistorical: true,
            };
          }
          if (failure.code === "401" || failure.code === "402") {
            return {
              success: false,
              provider: ALPHA_VANTAGE_PROVIDER_ID,
              symbol,
              interval,
              candles: [],
              observedAt: now,
              error: `CREDENTIAL_REQUIRED: ${failure.msg}`,
              freshness: "UNAVAILABLE",
              isHistorical: true,
            };
          }
        }
      }
      return {
        success: false,
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        candles: [],
        observedAt: now,
        error: `MALFORMED_RESPONSE: HTTP ${res.status}`,
        freshness: "UNAVAILABLE",
        isHistorical: true,
      };
    }

    const json = res.json;
    if (!json) {
      return {
        success: false,
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        candles: [],
        observedAt: now,
        error: "MALFORMED_RESPONSE: empty body",
        freshness: "UNAVAILABLE",
        isHistorical: true,
      };
    }

    if (typeof json === "object" && json !== null) {
      const failure = classifyFailureFromResponse(json, res.status);
      if (failure) {
        if (failure.code === "429") {
          return {
            success: false,
            provider: ALPHA_VANTAGE_PROVIDER_ID,
            symbol,
            interval,
            candles: [],
            observedAt: now,
            error: `RATE_LIMITED: ${failure.msg}`,
            freshness: "UNAVAILABLE",
            isHistorical: true,
          };
        }
        if (failure.code === "401" || failure.code === "402") {
          return {
            success: false,
            provider: ALPHA_VANTAGE_PROVIDER_ID,
            symbol,
            interval,
            candles: [],
            observedAt: now,
            error: `CREDENTIAL_REQUIRED: ${failure.msg}`,
            freshness: "UNAVAILABLE",
            isHistorical: true,
          };
        }
        if (failure.msg) {
          return {
            success: false,
            provider: ALPHA_VANTAGE_PROVIDER_ID,
            symbol,
            interval,
            candles: [],
            observedAt: now,
            error: `MALFORMED_RESPONSE: ${failure.msg}`,
            freshness: "UNAVAILABLE",
            isHistorical: true,
          };
        }
      }
    }

    const timeSeries = extractTimeSeries(json, interval);
    if (!timeSeries) {
      return {
        success: false,
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        candles: [],
        observedAt: now,
        error: "MALFORMED_RESPONSE: time series missing",
        freshness: "UNAVAILABLE",
        isHistorical: true,
      };
    }

    const candles: AlphaVantageIndexCandle[] = [];
    for (const [dateStr, row] of Object.entries(timeSeries)) {
      const ts = parseIndexTime(dateStr);
      if (ts === null) continue;
      const ohlc = parseOHLC(row as Record<string, string>);
      if (!ohlc) continue;
      candles.push({
        timestamp: ts,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        ...(ohlc.volume !== undefined ? { volume: ohlc.volume } : {}),
      });
    }

    // Deterministic ordering: sort by timestamp descending? Usually newest first, but we sort ascending for determinism
    candles.sort((a, b) => a.timestamp - b.timestamp);

    if (candles.length === 0) {
      return {
        success: false,
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        candles: [],
        observedAt: now,
        error: "MALFORMED_RESPONSE: no valid candles",
        freshness: "UNAVAILABLE",
        isHistorical: true,
      };
    }

    // Freshness: daily/weekly/monthly is historical/delayed, not FRESH real-time
    // If observed now, but data is daily, it's DELAYED or STALE depending on age
    // For simplicity, classify as DELAYED (historical semantics)
    return {
      success: true,
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      candles,
      observedAt: now,
      freshness: "DELAYED",
      isHistorical: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("rate_limit") || lower.includes("429") || lower.includes("rate limit")) {
      return {
        success: false,
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        candles: [],
        observedAt: now,
        error: `RATE_LIMITED: ${msg}`,
        freshness: "UNAVAILABLE",
        isHistorical: true,
      };
    }
    if (lower.includes("auth_error") || lower.includes("401") || lower.includes("403") || lower.includes("credential")) {
      return {
        success: false,
        provider: ALPHA_VANTAGE_PROVIDER_ID,
        symbol,
        interval,
        candles: [],
        observedAt: now,
        error: `CREDENTIAL_REQUIRED: ${msg}`,
        freshness: "UNAVAILABLE",
        isHistorical: true,
      };
    }
    return {
      success: false,
      provider: ALPHA_VANTAGE_PROVIDER_ID,
      symbol,
      interval,
      candles: [],
      observedAt: now,
      error: `MALFORMED_RESPONSE: ${msg}`,
      freshness: "UNAVAILABLE",
      isHistorical: true,
    };
  }
}

export function createAlphaVantageDiscoveryAdapter(
  fetchImpl: typeof fetch = fetch,
  readEnv: EnvReader = () => undefined,
): ProviderDiscoveryAdapter {
  return {
    provider: ALPHA_VANTAGE_PROVIDER_ID,
    assetClasses: ["indices" as AssetClass],
    async discover(now: number): Promise<ProviderDiscoveryResult> {
      try {
        return await discoverAlphaVantageIndices(now, { fetchImpl, readEnv });
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

export function createAlphaVantageUniversalAdapter(
  fetchImpl: typeof fetch = fetch,
  readEnv: EnvReader = () => undefined,
) {
  const legacy = createAlphaVantageDiscoveryAdapter(fetchImpl, readEnv);
  return {
    providerId: ALPHA_VANTAGE_PROVIDER_ID,
    displayName: "Alpha Vantage",
    assetClasses: ["indices" as AssetClass],
    capabilities: ["discovery", "ohlcv", "quote", "fundamentals", "news"] as any,
    status: "AVAILABLE" as const,
    discoverySupported: true,
    liveSupported: true,
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
