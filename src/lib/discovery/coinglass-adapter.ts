/**
 * Phase 263 — CoinGlass Discovery Closure
 *
 * Implements discovery for CoinGlass futures + spot supported-exchange-pairs.
 *
 * Official contract (docs.coinglass.com):
 *   GET https://open-api-v4.coinglass.com/api/futures/supported-exchange-pairs
 *   GET https://open-api-v4.coinglass.com/api/spot/supported-exchange-pairs
 * Response: { code:"0", msg:"success", data: { "<exchange>": [ { instrument_id, base_asset, quote_asset, settlement_currency, max_leverage, funding_interval, price_tick_size } ] } }
 * Cache every 1 minutes, single response complete list, no pagination.
 * Requires header CG-API-KEY (or cg_api_key) with COINGLASS_API_KEY env var.
 *
 * Invariants:
 * - providerInstrumentId exact native byte-for-byte instrument_id preserved.
 *   To avoid cross-exchange collision within same provider, providerInstrumentId
 *   is composed as "<exchange>:<instrument_id>" where exchange is exact native exchange key
 *   and instrument_id is exact native id. This preserves both exact native pieces
 *   while guaranteeing provider-qualified identity coinglass::<exchange>:<instrument_id>
 *   distinct from ccxt:binance::BTC/USDT etc.
 * - No substitution/fabrication.
 * - Credential failure → CREDENTIAL_REQUIRED, rate limit → RATE_LIMITED, malformed → MALFORMED_RESPONSE.
 * - Completeness COMPLETE when supported-exchange-pairs succeeds (single complete response, no pagination).
 * - Capabilities: futures → derivatives (open_interest, funding_rate, liquidations, long_short_positioning), spot → quote.
 * - TradingState TRADING (supported list is positive assertion).
 * - discoveredAt = now (provenance).
 */

import type { AssetClass, DataCapability, InstrumentSubType } from "@/lib/data/universal/types";
import type {
  DiscoveredInstrument,
  ProviderDiscoveryAdapter,
  ProviderDiscoveryResult,
  TradingState,
} from "./types";
import type { DiscoveryCompleteness, CatalogFetchReport } from "./completeness";
import { rollupCompleteness } from "./completeness";
import { checkCredentials, type EnvReader } from "@/lib/data/universal/live/credentials";

export const COINGLASS_FUTURES_URL = "https://open-api-v4.coinglass.com/api/futures/supported-exchange-pairs";
export const COINGLASS_SPOT_URL = "https://open-api-v4.coinglass.com/api/spot/supported-exchange-pairs";
export const COINGLASS_PROVIDER_ID = "coinglass";

type CoinGlassRawEntry = {
  instrument_id?: string;
  instrumentId?: string;
  base_asset?: string;
  baseAsset?: string;
  quote_asset?: string;
  quoteAsset?: string;
  settlement_currency?: string;
  settlementCurrency?: string;
  max_leverage?: number;
  maxLeverage?: number;
  funding_interval?: number;
  fundingInterval?: number;
  price_tick_size?: number;
  priceTickSize?: number;
};

type CoinGlassMap = Record<string, CoinGlassRawEntry[]>;

type TransportResult = { ok: boolean; status: number; json: unknown };

type Transport = (url: string, apiKey: string) => Promise<TransportResult>;

const FUTURES_CAPS: DataCapability[] = [
  "open_interest",
  "funding_rate",
  "liquidations",
  "long_short_positioning" as DataCapability,
  "ohlcv" as DataCapability,
];
const SPOT_CAPS: DataCapability[] = ["quote", "ohlcv"];

function normalizeField(entry: CoinGlassRawEntry): {
  instrumentId: string | undefined;
  baseAsset: string | undefined;
  quoteAsset: string | undefined;
  settleAsset: string | undefined;
  tickSize: number | undefined;
} {
  const instrumentId = entry.instrument_id ?? entry.instrumentId;
  const baseAsset = entry.base_asset ?? entry.baseAsset;
  const quoteAsset = entry.quote_asset ?? entry.quoteAsset;
  const settleAsset = entry.settlement_currency ?? entry.settlementCurrency;
  const tickSize = entry.price_tick_size ?? entry.priceTickSize;
  return { instrumentId, baseAsset, quoteAsset, settleAsset, tickSize };
}

function classifySubTypeFutures(instrumentId: string): InstrumentSubType {
  const id = instrumentId.toUpperCase();
  if (id.includes("PERP") || id.includes("UMCBL") || id.includes("DMCBL") || id.includes("PERPETUAL")) {
    return "crypto_perpetual";
  }
  if (/\d{6}/.test(id)) {
    return "crypto_futures";
  }
  return "crypto_futures";
}

function defaultTransport(fetchImpl: typeof fetch = fetch): Transport {
  return async (url: string, apiKey: string): Promise<TransportResult> => {
    const res = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "CG-API-KEY": apiKey,
        cg_api_key: apiKey,
      },
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

function extractDataMap(json: unknown): CoinGlassMap | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const dataField = obj.data;
  if (dataField && typeof dataField === "object" && !Array.isArray(dataField)) {
    return dataField as CoinGlassMap;
  }
  if (!Array.isArray(obj) && Object.values(obj).every((v) => Array.isArray(v))) {
    return obj as CoinGlassMap;
  }
  return null;
}

function errorFromResponse(json: unknown, status: number): { code: string; msg: string } | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const code = obj.code !== undefined ? String(obj.code) : String(status);
  const msg = typeof obj.msg === "string" ? obj.msg : "";
  if (code !== "0" && code !== "200" && code !== String(status)) {
    if (code !== "0" && code !== "") {
      return { code, msg };
    }
  }
  if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many")) {
    return { code: "429", msg };
  }
  if (msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("api key") || msg.toLowerCase().includes("unauthorized")) {
    return { code: "401", msg };
  }
  return null;
}

export async function discoverCoinGlassMarkets(
  now: number,
  opts: {
    transport?: Transport;
    readEnv?: EnvReader;
    fetchImpl?: typeof fetch;
    futuresUrl?: string;
    spotUrl?: string;
  } = {},
): Promise<ProviderDiscoveryResult> {
  const readEnv = opts.readEnv ?? (() => undefined);
  const cred = checkCredentials(COINGLASS_PROVIDER_ID, readEnv);
  if (cred && cred.authRequired && !cred.available) {
    return {
      provider: COINGLASS_PROVIDER_ID,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: `CREDENTIAL_REQUIRED: Required credentials not configured: ${cred.missingEnvVarNames.join(", ") || "COINGLASS_API_KEY"}`,
    };
  }
  const apiKey = readEnv("COINGLASS_API_KEY")?.trim() ?? "";
  if (!apiKey) {
    return {
      provider: COINGLASS_PROVIDER_ID,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings: [],
      completeness: "FAILED",
      pagesFetched: 0,
      totalDiscovered: 0,
      error: "CREDENTIAL_REQUIRED: Required credentials not configured: COINGLASS_API_KEY",
    };
  }

  const transport = opts.transport ?? defaultTransport(opts.fetchImpl);
  const futuresUrl = opts.futuresUrl ?? COINGLASS_FUTURES_URL;
  const spotUrl = opts.spotUrl ?? COINGLASS_SPOT_URL;

  const warnings: string[] = [];
  const instruments: DiscoveredInstrument[] = [];
  const seen = new Set<string>();
  const catalogs: CatalogFetchReport[] = [];
  const completenessParts: DiscoveryCompleteness[] = [];
  let pagesFetched = 0;

  async function fetchCatalog(
    url: string,
    label: "futures" | "spot",
  ): Promise<{ success: boolean; map?: CoinGlassMap; error?: string; status?: number }> {
    try {
      const res = await transport(url, apiKey);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { success: false, error: `CREDENTIAL_REQUIRED: HTTP ${res.status}`, status: res.status };
        }
        if (res.status === 429) {
          return { success: false, error: `RATE_LIMITED: HTTP ${res.status}`, status: res.status };
        }
        if (res.json && typeof res.json === "object") {
          const bodyErr = errorFromResponse(res.json, res.status);
          if (bodyErr) {
            const lowerMsg = bodyErr.msg.toLowerCase();
            const code = bodyErr.code;
            if (code === "429" || lowerMsg.includes("rate")) {
              return { success: false, error: `RATE_LIMITED: ${bodyErr.msg || "rate limit"}`, status: 429 };
            }
            if (code === "401" || code === "403" || lowerMsg.includes("auth") || lowerMsg.includes("api key")) {
              return { success: false, error: `CREDENTIAL_REQUIRED: ${bodyErr.msg || "auth failed"}`, status: 401 };
            }
          }
        }
        return { success: false, error: `MALFORMED_RESPONSE: HTTP ${res.status}`, status: res.status };
      }
      const json = res.json;
      if (!json) {
        return { success: false, error: "MALFORMED_RESPONSE: empty body", status: res.status };
      }
      if (typeof json === "object" && json !== null) {
        const obj = json as Record<string, unknown>;
        const code = obj.code;
        if (code !== undefined && code !== null && code !== "" && code !== "0" && code !== 0) {
          const msg = typeof obj.msg === "string" ? obj.msg : "unknown error";
          const codeStr = String(code);
          const lower = msg.toLowerCase();
          if (codeStr === "429" || lower.includes("rate")) {
            return { success: false, error: `RATE_LIMITED: ${msg}`, status: 429 };
          }
          if (codeStr === "401" || codeStr === "403" || lower.includes("auth") || lower.includes("key")) {
            return { success: false, error: `CREDENTIAL_REQUIRED: ${msg}`, status: 401 };
          }
          return { success: false, error: `MALFORMED_RESPONSE: code ${codeStr}: ${msg}`, status: res.status };
        }
      }
      const map = extractDataMap(json);
      if (!map) {
        return { success: false, error: "MALFORMED_RESPONSE: data field missing or not map", status: res.status };
      }
      return { success: true, map, status: res.status };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes("rate_limit") || lower.includes("429") || lower.includes("rate limit")) {
        return { success: false, error: `RATE_LIMITED: ${msg}`, status: 429 };
      }
      if (lower.includes("auth_error") || lower.includes("401") || lower.includes("403") || lower.includes("credential")) {
        return { success: false, error: `CREDENTIAL_REQUIRED: ${msg}`, status: 401 };
      }
      return { success: false, error: `MALFORMED_RESPONSE: ${msg}`, status: 0 };
    }
  }

  const [futuresRes, spotRes] = await Promise.all([
    fetchCatalog(futuresUrl, "futures"),
    fetchCatalog(spotUrl, "spot"),
  ]);

  if (futuresRes.success && futuresRes.map) {
    pagesFetched += 1;
    completenessParts.push("COMPLETE");
    let discoveredInCatalog = 0;
    for (const [exchange, pairs] of Object.entries(futuresRes.map)) {
      if (!Array.isArray(pairs)) {
        warnings.push(`[${exchange}] futures pairs not array, skipped`);
        continue;
      }
      for (const raw of pairs) {
        const { instrumentId, baseAsset, quoteAsset, settleAsset, tickSize } = normalizeField(raw);
        if (!instrumentId || typeof instrumentId !== "string" || instrumentId.trim().length === 0) {
          warnings.push(`[${exchange}] futures entry missing instrument_id, skipped`);
          continue;
        }
        const exactInstrumentId = instrumentId;
        const providerInstrumentId = `${exchange}:${exactInstrumentId}`;
        const key = `${COINGLASS_PROVIDER_ID}::${providerInstrumentId}`;
        if (seen.has(key)) {
          warnings.push(`[${exchange}] duplicate futures ${exactInstrumentId} skipped`);
          continue;
        }
        if (!baseAsset || !quoteAsset) {
          warnings.push(`[${exchange}] ${exactInstrumentId} missing base/quote, skipped`);
          continue;
        }
        const subType = classifySubTypeFutures(exactInstrumentId);
        const inst: DiscoveredInstrument = {
          provider: COINGLASS_PROVIDER_ID,
          providerInstrumentId,
          assetClass: "crypto" as AssetClass,
          subType,
          baseAsset: baseAsset.toUpperCase(),
          quoteAsset: quoteAsset.toUpperCase(),
          ...(settleAsset ? { settleAsset: settleAsset.toUpperCase() } : {}),
          tradingState: "TRADING" as TradingState,
          capabilities: [...FUTURES_CAPS],
          ...(tickSize !== undefined ? { precision: { tickSize } } : {}),
          region: exchange,
          discoveredAt: now,
        };
        instruments.push(inst);
        seen.add(key);
        discoveredInCatalog += 1;
      }
    }
    catalogs.push({
      path: "/api/futures/supported-exchange-pairs",
      assetClass: "crypto",
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: discoveredInCatalog,
    });
  } else {
    const errMsg = futuresRes.error ?? "unknown";
    warnings.push(`futures catalog failed: ${errMsg}`);
    const comp: DiscoveryCompleteness = "FAILED";
    completenessParts.push(comp);
    catalogs.push({
      path: "/api/futures/supported-exchange-pairs",
      assetClass: "crypto",
      completeness: comp,
      pagesFetched: 0,
      totalDiscovered: 0,
      failedPage: 1,
    });
  }

  if (spotRes.success && spotRes.map) {
    pagesFetched += 1;
    completenessParts.push("COMPLETE");
    let discoveredInCatalog = 0;
    for (const [exchange, pairs] of Object.entries(spotRes.map)) {
      if (!Array.isArray(pairs)) {
        warnings.push(`[${exchange}] spot pairs not array, skipped`);
        continue;
      }
      for (const raw of pairs) {
        const { instrumentId, baseAsset, quoteAsset, settleAsset, tickSize } = normalizeField(raw);
        if (!instrumentId || typeof instrumentId !== "string" || instrumentId.trim().length === 0) {
          warnings.push(`[${exchange}] spot entry missing instrument_id, skipped`);
          continue;
        }
        const exactInstrumentId = instrumentId;
        const providerInstrumentId = `${exchange}:${exactInstrumentId}`;
        const key = `${COINGLASS_PROVIDER_ID}::${providerInstrumentId}`;
        if (seen.has(key)) {
          warnings.push(`[${exchange}] duplicate spot ${exactInstrumentId} skipped`);
          continue;
        }
        if (!baseAsset || !quoteAsset) {
          warnings.push(`[${exchange}] ${exactInstrumentId} missing base/quote, skipped`);
          continue;
        }
        const inst: DiscoveredInstrument = {
          provider: COINGLASS_PROVIDER_ID,
          providerInstrumentId,
          assetClass: "crypto" as AssetClass,
          subType: "crypto_spot" as InstrumentSubType,
          baseAsset: baseAsset.toUpperCase(),
          quoteAsset: quoteAsset.toUpperCase(),
          ...(settleAsset ? { settleAsset: settleAsset.toUpperCase() } : {}),
          tradingState: "TRADING" as TradingState,
          capabilities: [...SPOT_CAPS],
          ...(tickSize !== undefined ? { precision: { tickSize } } : {}),
          region: exchange,
          discoveredAt: now,
        };
        instruments.push(inst);
        seen.add(key);
        discoveredInCatalog += 1;
      }
    }
    catalogs.push({
      path: "/api/spot/supported-exchange-pairs",
      assetClass: "crypto",
      completeness: "COMPLETE",
      pagesFetched: 1,
      totalDiscovered: discoveredInCatalog,
    });
  } else {
    const errMsg = spotRes.error ?? "unknown";
    warnings.push(`spot catalog failed: ${errMsg}`);
    const comp: DiscoveryCompleteness = "FAILED";
    completenessParts.push(comp);
    catalogs.push({
      path: "/api/spot/supported-exchange-pairs",
      assetClass: "crypto",
      completeness: comp,
      pagesFetched: 0,
      totalDiscovered: 0,
      failedPage: 1,
    });
  }

  const overallCompleteness = rollupCompleteness(completenessParts);

  if (instruments.length === 0) {
    const futErr = futuresRes.error ?? "";
    const spotErr = spotRes.error ?? "";
    const combined = [futErr, spotErr].filter(Boolean).join("; ");
    const isRate = combined.includes("RATE_LIMITED");
    const isCred = combined.includes("CREDENTIAL_REQUIRED");
    const errorCode = isRate ? "RATE_LIMITED" : isCred ? "CREDENTIAL_REQUIRED" : "MALFORMED_RESPONSE";
    return {
      provider: COINGLASS_PROVIDER_ID,
      success: false,
      discoveredAt: now,
      instruments: [],
      warnings,
      completeness: "FAILED",
      pagesFetched,
      totalDiscovered: 0,
      catalogs,
      error: `${errorCode}: CoinGlass discovery failed — ${combined || "no instruments"}`,
    };
  }

  const success = overallCompleteness !== "FAILED";
  const dominantError =
    !success
      ? "FAILED"
      : overallCompleteness === "PARTIAL"
        ? `PARTIAL: ${warnings.slice(0, 3).join("; ")}`
        : undefined;

  return {
    provider: COINGLASS_PROVIDER_ID,
    success,
    discoveredAt: now,
    instruments,
    warnings,
    completeness: overallCompleteness,
    pagesFetched,
    totalDiscovered: instruments.length,
    catalogs,
    ...(dominantError && overallCompleteness !== "COMPLETE" ? { error: dominantError } : {}),
  };
}

export function createCoinGlassDiscoveryAdapter(
  fetchImpl: typeof fetch = fetch,
  readEnv: EnvReader = () => undefined,
): ProviderDiscoveryAdapter {
  return {
    provider: COINGLASS_PROVIDER_ID,
    assetClasses: ["crypto" as AssetClass],
    async discover(now: number): Promise<ProviderDiscoveryResult> {
      try {
        return await discoverCoinGlassMarkets(now, { fetchImpl, readEnv });
      } catch (err) {
        return {
          provider: COINGLASS_PROVIDER_ID,
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

export function createCoinGlassUniversalAdapter(
  fetchImpl: typeof fetch = fetch,
  readEnv: EnvReader = () => undefined,
) {
  const legacy = createCoinGlassDiscoveryAdapter(fetchImpl, readEnv);
  return {
    providerId: COINGLASS_PROVIDER_ID,
    displayName: "CoinGlass",
    assetClasses: ["crypto" as AssetClass],
    capabilities: ["discovery", "derivatives", "funding", "open_interest", "liquidations"] as any,
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
