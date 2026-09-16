/**
 * Phase 46 — Live Provider Client
 *
 * Executes live provider requests through the Phase 45 routing engine,
 * validates every response (symbol identity, OHLC truth, quote integrity),
 * records structured diagnostics, updates provider health, and integrates
 * the instrument-isolated cache.
 *
 * CRITICAL RULES:
 *   - Transport is injectable; deterministic tests use mock transports.
 *   - LIVE_VERIFIED is only assigned for real, parsed, validated responses.
 *   - Invalid records are rejected — never repaired with fabricated values.
 *   - Diagnostics never contain credentials or secrets.
 */

import type { AssetClass, DataCapability } from "../types";
import { resolveInstrument, getProviderSymbol } from "../instruments";
import {
  routeProviderRequest,
  routeProviderNativeRequest,
  recordProviderHealth,
  resetProviderHealth,
} from "../routing-engine";
import { cacheGet, cacheSet } from "../cache";
import type {
  LiveStatus,
  OhlcvRecord,
  ProviderDiagnostic,
} from "./types";
import {
  validateOhlcvSeries,
  validateQuote,
  verifySymbolIdentityWithCandidates,
  isLiveStatus,
} from "./types";
import { checkCredentials, type EnvReader } from "./credentials";

// ═══════════════════════════════════════════════════════════════
// TRANSPORT
// ═══════════════════════════════════════════════════════════════

export interface TransportResponse {
  ok: boolean;
  status: number;
  /** Pre-parsed JSON body if available. */
  json?: unknown;
}

export type Transport = (url: string) => Promise<TransportResponse>;

// ═══════════════════════════════════════════════════════════════
// PROVIDER ENDPOINT BUILDERS (capability → URL)
// ═══════════════════════════════════════════════════════════════

interface EndpointSpec {
  buildUrl: (providerSymbol: string, params: LiveRequestParams) => string;
  extract: (
    json: unknown,
    params: LiveRequestParams & { providerSymbol?: string },
  ) => { symbol?: string | null; candles?: OhlcvRecord[]; quote?: { price: number; bid?: number; ask?: number }; fields: string[] };
}

const num = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;

const ENDPOINTS: Record<string, EndpointSpec> = {
  "twelve-data": {
    buildUrl: (sym, p) =>
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${p.timeframe ?? "1h"}&outputsize=${p.count ?? 100}`,
    extract: (json) => {
      const j = json as { values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[]; symbol?: string };
      const candles = (j.values ?? []).map((c) => ({
        timestamp: new Date(c.datetime).getTime(),
        open: num(c.open),
        high: num(c.high),
        low: num(c.low),
        close: num(c.close),
        volume: c.volume !== undefined ? num(c.volume) : undefined,
      }));
      return { symbol: j.symbol ?? null, candles, fields: ["values", "datetime", "ohlc"] };
    },
  },
  "alpha-vantage": {
    buildUrl: (sym) => `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${sym.split("/")[0]}&to_symbol=${sym.split("/")[1] ?? "USD"}&interval=60min`,
    extract: (json) => {
      const j = json as Record<string, unknown>;
      const seriesKey = Object.keys(j).find((k) => k.includes("Time Series"));
      if (!seriesKey) return { symbol: null, candles: [], fields: [] };
      const raw = j[seriesKey] as Record<string, Record<string, string>>;
      const candles = Object.entries(raw)
        .map(([datetime, o]) => ({
          timestamp: new Date(datetime + "Z").getTime(),
          open: num(o["1. open"]),
          high: num(o["2. high"]),
          low: num(o["3. low"]),
          close: num(o["4. close"]),
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
      return { symbol: null, candles, fields: ["time-series"] };
    },
  },
  coingecko: {
    buildUrl: (sym) => `https://api.coingecko.com/api/v3/simple/price?ids=${sym.toLowerCase()}&vs_currencies=usd`,
    extract: (json, p) => {
      const j = json as Record<string, { usd?: number }>;
      const id = p.providerSymbol?.toLowerCase() ?? "";
      const price = j[id]?.usd;
      return {
        symbol: price !== undefined ? id : null,
        quote: price !== undefined ? { price } : undefined,
        fields: price !== undefined ? ["price"] : [],
      };
    },
  },
  okx: {
    buildUrl: (sym) => `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(sym)}&bar=1H&limit=100`,
    extract: (json) => {
      const j = json as { data?: string[][] };
      const rows = j.data ?? [];
      // OKX returns newest-first
      const candles = [...rows]
        .reverse()
        .map((r) => ({
          timestamp: num(r[0]),
          open: num(r[1]),
          high: num(r[2]),
          low: num(r[3]),
          close: num(r[4]),
          volume: r[5] !== undefined ? num(r[5]) : undefined,
        }));
      return { symbol: null, candles, fields: ["data"] };
    },
  },
};

/** Providers without a concrete OHLCV endpoint in this phase. */
function unsupportedEndpoint(): EndpointSpec {
  return {
    buildUrl: () => "",
    extract: () => ({ symbol: null, fields: [] }),
  };
}

function getEndpoint(providerId: string): EndpointSpec {
  return ENDPOINTS[providerId] ?? unsupportedEndpoint();
}

// ═══════════════════════════════════════════════════════════════
// LIVE REQUEST EXECUTION
// ═══════════════════════════════════════════════════════════════

export interface LiveRequestParams {
  instrument: string;
  capability: DataCapability;
  timeframe?: string;
  count?: number;
  transport: Transport;
  readEnv?: EnvReader;
  now?: number;
  /**
   * Provider-native identity discovered from that provider.
   * When supplied, this is an exact provider instrument ID and must never
   * be substituted with another symbol.
   */
  providerNative?: {
    provider: string;
    providerInstrumentId: string;
    assetClass: AssetClass;
  };
}

export interface LiveRequestResult {
  status: LiveStatus;
  instrument: string;
  capability: DataCapability;
  provider?: string;
  requestedAt: number;
  receivedAt: number | null;
  latencyMs: number | null;
  symbolUsed?: string;
  candles?: OhlcvRecord[];
  quote?: { price: number; bid?: number; ask?: number };
  failureReason?: string;
  diagnostic: ProviderDiagnostic;
}

/**
 * Execute a live provider request for an instrument/capability pair.
 * Never throws — all outcomes are classified into a LiveStatus.
 */
export async function executeLiveRequest(params: LiveRequestParams): Promise<LiveRequestResult> {
  const now = params.now ?? Date.now();
  const requestedAt = now;

  const finish = (
    status: LiveStatus,
    extra: Partial<LiveRequestResult> & { failureReason?: string },
  ): LiveRequestResult => {
    const result: LiveRequestResult = {
      status,
      instrument: params.instrument,
      capability: params.capability,
      requestedAt,
      receivedAt: extra.receivedAt ?? Date.now(),
      latencyMs: extra.latencyMs ?? null,
      provider: extra.provider,
      symbolUsed: extra.symbolUsed,
      candles: extra.candles,
      quote: extra.quote,
      failureReason: extra.failureReason,
      diagnostic: {
        provider: extra.provider ?? "none",
        instrument: params.instrument,
        capability: params.capability,
        status,
        latencyMs: extra.latencyMs ?? null,
        cacheHit: false,
        fallbackUsed: false,
        providerSymbol: extra.symbolUsed,
        freshness: isLiveStatus(status) ? "FRESH" : "UNAVAILABLE",
        quality: status === "LIVE_VERIFIED" ? "VERIFIED" : "UNAVAILABLE",
        failureReason: extra.failureReason,
        fieldsParsed: extra.candles || extra.quote ? ["validated"] : [],
      },
    };
    return result;
  };

  // 1. Resolve identity.
  // Canonical registry remains the normal path. A provider-native identity
  // is allowed only when explicitly supplied for that same provider.
  const canonical = resolveInstrument(params.instrument);

  if (!canonical && !params.providerNative) {
    return finish("UNAVAILABLE", {
      failureReason: `Instrument "${params.instrument}" is not registered in the universal registry.`,
    });
  }

  // Provider-native identities bypass canonical registry resolution ONLY for
  // the explicitly supplied provider. They never enter the generic router.
  if (params.providerNative) {
    const providerId = params.providerNative.provider;
    const providerSymbol = params.providerNative.providerInstrumentId;

    const cred = checkCredentials(providerId, params.readEnv);
    if (cred && !cred.available && cred.authRequired) {
      return finish("CREDENTIAL_MISSING", {
        provider: providerId,
        symbolUsed: providerSymbol,
        failureReason: `Required credentials not configured: ${cred.missingEnvVarNames.join(", ")}.`,
      });
    }

    // Provider-native capability routing must happen BEFORE any HTTP request.
    // This prevents unsupported native requests from reaching a provider at all.
    const nativeRoute = routeProviderNativeRequest(
      providerId,
      params.capability,
      params.providerNative.assetClass,
    );

    if (!nativeRoute) {
      return finish("UNSUPPORTED", {
        provider: providerId,
        symbolUsed: providerSymbol,
        failureReason:
          `Provider "${providerId}" does not support capability "${params.capability}" ` +
          `for provider-native instrument "${providerSymbol}".`,
      });
    }

    if (
      nativeRoute.healthStatus === "UNAVAILABLE" ||
      nativeRoute.healthStatus === "UNSUPPORTED"
    ) {
      return finish("UNAVAILABLE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        failureReason:
          `Provider "${providerId}" is currently unavailable for native ` +
          `capability "${params.capability}".`,
      });
    }

    const endpoint = getEndpoint(providerId);
    if (!endpoint.buildUrl(providerSymbol, params)) {
      return finish("UNSUPPORTED", {
        provider: providerId,
        symbolUsed: providerSymbol,
        failureReason: `Provider "${providerId}" has no live endpoint for "${params.capability}" in this phase.`,
      });
    }

    const url = endpoint.buildUrl(providerSymbol, params);
    const t0 = Date.now();

    let response: TransportResponse;
    try {
      response = await params.transport(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return finish("NETWORK_UNAVAILABLE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs: Date.now() - t0,
        receivedAt: Date.now(),
        failureReason: `Network failure: ${msg}`,
      });
    }

    const latencyMs = Date.now() - t0;

    if (response.status === 429) {
      return finish("RATE_LIMITED", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason: "Provider responded HTTP 429 (rate limit).",
      });
    }

    if (!response.ok) {
      return finish("PROVIDER_ERROR", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason: `Provider responded HTTP ${response.status}.`,
      });
    }

    // Provider-native requests are deliberately isolated from the generic
    // canonical router. The request above has already been executed using
    // the exact provider-native instrument ID.
    //
    // Parse and validate the response using the same provider endpoint
    // contract, without resolving/substituting the instrument through the
    // universal registry.
    if (response.json === undefined || response.json === null) {
      return finish("PROVIDER_ERROR", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason: "Provider returned an empty response body.",
      });
    }

    const nativeEndpoint = getEndpoint(providerId);
    const parsed = nativeEndpoint.extract(response.json, {
      ...params,
      providerSymbol,
    });

    if (!parsed.symbol && !parsed.candles?.length && !parsed.quote) {
      return finish("MALFORMED_RESPONSE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason: "Provider response contained no recognizable market data.",
      });
    }

    if (parsed.symbol !== undefined && parsed.symbol !== null) {
      const identityCheck = verifySymbolIdentityWithCandidates(
        params.instrument,
        parsed.symbol,
        [providerSymbol],
      );
      if (!identityCheck.passed) {
        return finish("MALFORMED_RESPONSE", {
          provider: providerId,
          symbolUsed: providerSymbol,
          latencyMs,
          receivedAt: Date.now(),
          failureReason: `Identity mismatch: ${identityCheck.reason}. No substitution was performed.`,
        });
      }
    }

    if (parsed.quote) {
      const qv = validateQuote(parsed.quote, { now });
      if (!qv.valid) {
        return finish("MALFORMED_RESPONSE", {
          provider: providerId,
          symbolUsed: providerSymbol,
          latencyMs,
          receivedAt: Date.now(),
          failureReason: `Quote failed validation: ${qv.issues.join("; ")}`,
        });
      }

      recordProviderHealth({
        providerId,
        status: "AVAILABLE",
        responseTimeMs: latencyMs,
      });

      cacheSet(
        {
          instrument: params.instrument,
          capability: params.capability,
          providerId,
        },
        parsed.quote,
        "FRESH",
      );

      return finish("LIVE_VERIFIED", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        quote: parsed.quote,
      });
    }

    if (parsed.candles) {
      if (parsed.candles.length === 0) {
        return finish("MALFORMED_RESPONSE", {
          provider: providerId,
          symbolUsed: providerSymbol,
          latencyMs,
          receivedAt: Date.now(),
          failureReason: "Provider returned zero usable records.",
        });
      }

      const validation = validateOhlcvSeries(parsed.candles, { now });
      const accepted = parsed.candles.filter(
        (_, i) => !validation.rejectedIndices.includes(i),
      );

      if (validation.valid) {
        recordProviderHealth({
          providerId,
          status: "AVAILABLE",
          responseTimeMs: latencyMs,
        });

        cacheSet(
          {
            instrument: params.instrument,
            capability: params.capability,
            providerId,
          },
          accepted,
          "FRESH",
        );

        return finish("LIVE_VERIFIED", {
          provider: providerId,
          symbolUsed: providerSymbol,
          latencyMs,
          candles: accepted,
        });
      }

      if (accepted.length > 0) {
        recordProviderHealth({
          providerId,
          status: "DEGRADED",
          error: "partial invalid records",
        });

        return finish("LIVE_PARTIAL", {
          provider: providerId,
          symbolUsed: providerSymbol,
          latencyMs,
          candles: accepted,
          failureReason:
            `${validation.rejectedCount} of ${validation.totalRecords} records rejected: ` +
            `${validation.issues.map((i) => i.reason).join(", ")}.`,
        });
      }

      return finish("MALFORMED_RESPONSE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason:
          `All ${validation.totalRecords} records failed validation.`,
      });
    }

    return finish("MALFORMED_RESPONSE", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs,
      receivedAt: Date.now(),
      failureReason: "No recognizable market data payload in response.",
    });
  }

  // 2. Canonical routing remains unchanged for registry instruments.
  const route = canonical
    ? routeProviderRequest(params.instrument, params.capability)
    : {
        routes: [],
        bestRoute: undefined,
        available: true,
        unavailableReason: undefined,
      };

  const best = route.bestRoute;
  if (!best && canonical) {
    const anyUnsupported =
      route.routes.length > 0 && route.routes.every((r) => r.healthStatus === "UNSUPPORTED");
    if (anyUnsupported || route.routes.length === 0) {
      return finish("UNSUPPORTED", {
        failureReason:
          route.unavailableReason ??
          `No provider supports "${params.capability}" for "${params.instrument}".`,
      });
    }
    const rateLimited = route.routes.some((r) => r.healthStatus === "RATE_LIMITED");
    if (rateLimited) {
      return finish("RATE_LIMITED", { failureReason: "All candidate providers are rate-limited." });
    }
    const credMissing = route.routes.some(
      (r) => r.healthStatus === "UNAVAILABLE" && !r.credentialsAvailable,
    );
    return finish(credMissing ? "CREDENTIAL_MISSING" : "UNAVAILABLE", {
      failureReason: route.unavailableReason ?? "No available route.",
    });
  }

  if (!best) {
    return finish("UNAVAILABLE", {
      failureReason: "No available provider route.",
    });
  }

  const providerId = best.providerId;

  // 3. Check credentials explicitly (names only, never values)
  const cred = checkCredentials(providerId, params.readEnv);
  if (cred && !cred.available && cred.authRequired) {
    recordProviderHealth({ providerId, status: "UNAVAILABLE", error: "credentials missing" });
    return finish("CREDENTIAL_MISSING", {
      provider: providerId,
      failureReason: `Required credentials not configured: ${cred.missingEnvVarNames.join(", ")}.`,
    });
  }

  // 4. Resolve provider symbol — never substitute instruments
  const providerSymbol = getProviderSymbol(params.instrument, providerId);
  if (!providerSymbol) {
    return finish("UNSUPPORTED", {
      provider: providerId,
      failureReason: `No provider symbol mapping for "${params.instrument}" on "${providerId}".`,
    });
  }

  // 5. Build endpoint
  const endpoint = getEndpoint(providerId);
  if (!endpoint.buildUrl(providerSymbol, params)) {
    return finish("UNSUPPORTED", {
      provider: providerId,
      symbolUsed: providerSymbol,
      failureReason: `Provider "${providerId}" has no live endpoint for "${params.capability}" in this phase.`,
    });
  }
  const url = endpoint.buildUrl(providerSymbol, params);

  // 6. Execute request through injectable transport
  let response: TransportResponse;
  const t0 = Date.now();
  try {
    response = await params.transport(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordProviderHealth({ providerId, status: "DEGRADED", error: msg });
    return finish("NETWORK_UNAVAILABLE", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs: Date.now() - t0,
      receivedAt: Date.now(),
      failureReason: `Network failure: ${msg}`,
    });
  }
  const latencyMs = Date.now() - t0;

  // 7. Classify HTTP outcome
  if (response.status === 429) {
    recordProviderHealth({ providerId, status: "RATE_LIMITED", error: "HTTP 429" });
    return finish("RATE_LIMITED", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs,
      receivedAt: Date.now(),
      failureReason: "Provider responded HTTP 429 (rate limit).",
    });
  }
  if (!response.ok) {
    recordProviderHealth({
      providerId,
      status: "DEGRADED",
      error: `HTTP ${response.status}`,
      responseTimeMs: latencyMs,
    });
    return finish("PROVIDER_ERROR", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs,
      receivedAt: Date.now(),
      failureReason: `Provider responded HTTP ${response.status}.`,
    });
  }

  // 8. Parse body
  if (response.json === undefined || response.json === null) {
    return finish("MALFORMED_RESPONSE", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs,
      receivedAt: Date.now(),
      failureReason: "Response body missing or unparsable.",
    });
  }

  // 9. Extract data
  let extracted: ReturnType<EndpointSpec["extract"]>;
  try {
    extracted = endpoint.extract(response.json, { ...params, providerSymbol });
  } catch {
    return finish("MALFORMED_RESPONSE", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs,
      receivedAt: Date.now(),
      failureReason: "Failed to extract data from provider response structure.",
    });
  }

  // 10. Verify symbol identity when the provider echoes one
  if (extracted.symbol !== undefined && extracted.symbol !== null) {
    if (!canonical) {
      return finish("UNAVAILABLE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason:
          "Canonical instrument identity is required for the generic provider route.",
      });
    }
    const identityCheck = verifySymbolIdentityWithCandidates(
      params.instrument,
      extracted.symbol,
      [providerSymbol, canonical.displaySymbol],
    );
    if (!identityCheck.passed) {
      return finish("MALFORMED_RESPONSE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason: `Identity mismatch: ${identityCheck.reason}`,
      });
    }
  }

  // 11. Validate payloads
  if (extracted.quote) {
    const qv = validateQuote(extracted.quote, { now });
    if (!qv.valid) {
      return finish("MALFORMED_RESPONSE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason: `Quote failed validation: ${qv.issues.join("; ")}`,
      });
    }
    recordProviderHealth({ providerId, status: "AVAILABLE", responseTimeMs: latencyMs });
    cacheSet(
      { instrument: params.instrument, capability: params.capability, providerId },
      extracted.quote,
      "FRESH",
    );
    return finish("LIVE_VERIFIED", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs,
      quote: extracted.quote,
    });
  }

  if (extracted.candles) {
    if (extracted.candles.length === 0) {
      return finish("MALFORMED_RESPONSE", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        receivedAt: Date.now(),
        failureReason: "Provider returned zero usable records.",
      });
    }
    const validation = validateOhlcvSeries(extracted.candles, { now });
    const accepted = extracted.candles.filter(
      (_, i) => !validation.rejectedIndices.includes(i),
    );

    if (validation.valid) {
      recordProviderHealth({ providerId, status: "AVAILABLE", responseTimeMs: latencyMs });
      cacheSet(
        { instrument: params.instrument, capability: params.capability, providerId },
        accepted,
        "FRESH",
      );
      return finish("LIVE_VERIFIED", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        candles: accepted,
      });
    }
    if (accepted.length > 0) {
      recordProviderHealth({ providerId, status: "DEGRADED", error: "partial invalid records" });
      return finish("LIVE_PARTIAL", {
        provider: providerId,
        symbolUsed: providerSymbol,
        latencyMs,
        candles: accepted,
        failureReason: `${validation.rejectedCount} of ${validation.totalRecords} records rejected: ${validation.issues.map((i) => i.reason).join(", ")}.`,
      });
    }
    return finish("MALFORMED_RESPONSE", {
      provider: providerId,
      symbolUsed: providerSymbol,
      latencyMs,
      receivedAt: Date.now(),
      failureReason: `All ${validation.totalRecords} records failed validation.`,
    });
  }

  return finish("MALFORMED_RESPONSE", {
    provider: providerId,
    symbolUsed: providerSymbol,
    latencyMs,
    receivedAt: Date.now(),
    failureReason: "No recognizable market data payload in response.",
  });
}

/**
 * Read from cache with explicit stale metadata. Stale values are returned
 * flagged as stale — never relabeled fresh.
 */
export function readCachedOrUnavailable<T>(
  instrument: string,
  capability: DataCapability,
  providerId: string,
): { hit: boolean; stale: boolean; data?: T; cachedAt?: number } {
  const entry = cacheGet<T>({ instrument, capability, providerId });
  if (!entry) return { hit: false, stale: false };
  return { hit: true, stale: entry.isStale, data: entry.data, cachedAt: entry.cachedAt };
}

/** Reset live-layer side effects (routing health + cache) for tests. */
export function resetLiveState(): void {
  resetProviderHealth();
}
