/**
 * Convex server-side action for CoinGlass V4 crypto derivatives data.
 * Handles open interest, funding rate, long/short ratio, and liquidations.
 * All API keys are read from environment variables — never exposed to client.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import type {
  CryptoDerivativesData,
  DerivativesResult,
  OpenInterestData,
  FundingRateData,
  LongShortData,
  LiquidationData,
} from "../lib/data/derivatives-types";
import { DeFiLlamaAdapter } from "../lib/data/crypto/defillama-adapter";
import { TokenomistAdapter, parseTokenomistResult } from "../lib/data/crypto/tokenomist-adapter";
import { PatternPlusUnlockAdapter } from "../lib/data/crypto/patternplus-unlocks-adapter";
import { BinancePublicDerivativesAdapter } from "../lib/data/crypto/binance-derivatives-adapter";
import { BybitPublicDerivativesAdapter } from "../lib/data/crypto/bybit-derivatives-adapter";
import { OkxPublicDerivativesAdapter } from "../lib/data/crypto/okx-derivatives-adapter";

// ── In-memory cache (10 min TTL) ────────────────────────────────
const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 10 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any, ttlMs = CACHE_TTL): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── CoinGlass API ───────────────────────────────────────────────

const CG_BASE = "https://open-api-v4.coinglass.com/api";
const COINGLASS_REQUEST_TIMEOUT_MS = 6_500;
const binanceFallback = new BinancePublicDerivativesAdapter();
const bybitFallback = new BybitPublicDerivativesAdapter();
const okxFallback = new OkxPublicDerivativesAdapter();
const BINANCE_FALLBACK_CACHE_TTL = 60 * 1000;

async function fetchPublicDerivativesFallback(instrument: string): Promise<{ data: CryptoDerivativesData | null; error: string }> {
  const [binanceResult, bybitResult, okxResult] = await Promise.allSettled([
    binanceFallback.fetch(instrument),
    bybitFallback.fetch(instrument),
    okxFallback.fetch(instrument),
  ]);
  const binanceData = binanceResult.status === "fulfilled" ? binanceResult.value : null;
  const bybitData = bybitResult.status === "fulfilled" ? bybitResult.value : null;
  const okxData = okxResult.status === "fulfilled" ? okxResult.value : null;
  const describe = (name: string, result: PromiseSettledResult<CryptoDerivativesData | null>) =>
    result.status === "rejected"
      ? name + ": " + (result.reason instanceof Error ? result.reason.message : String(result.reason))
      : result.value
        ? ""
        : name + ": unsupported instrument or no usable datasets";
  return {
    data: binanceData ?? bybitData ?? okxData ?? null,
    error: [
      describe("Binance public", binanceResult),
      describe("Bybit public", bybitResult),
      describe("OKX public", okxResult),
    ].filter(Boolean).join(" | "),
  };
}

async function cgFetch(path: string, apiKey: string): Promise<any> {
  const res = await fetch(CG_BASE + path, {
    headers: {
      accept: "application/json",
      "CG-API-KEY": apiKey,
    },
    signal: AbortSignal.timeout(COINGLASS_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMIT:CoinGlass HTTP 429: " + res.statusText);
    if (res.status === 401 || res.status === 403) {
      throw new Error("AUTH_ERROR:CoinGlass HTTP " + res.status + ": " + res.statusText);
    }
    throw new Error("CoinGlass HTTP " + res.status + ": " + res.statusText);
  }
  const json = await res.json();
  // CoinGlass V4 wraps successful responses in { code: "0", msg, data }.
  if (json.code !== undefined && String(json.code) !== "0") {
    const msg = String(json.msg || "Unknown CoinGlass error");
    if (String(json.code) === "429" || msg.toLowerCase().includes("rate")) {
      throw new Error("RATE_LIMIT:" + msg);
    }
    if (["401", "403"].includes(String(json.code)) || /auth|api.?key|permission/i.test(msg)) {
      throw new Error("AUTH_ERROR:" + msg);
    }
    throw new Error("CoinGlass error " + json.code + ": " + msg);
  }
  return json.data ?? json;
}

// ── Symbol mapping ──────────────────────────────────────────────

function mapSymbolForCG(instrument: string): string {
  // BTC/USD → BTC, ETH/USD → ETH
  const sym = instrument.toUpperCase().trim();
  return sym.split("/")[0];
}

// ── Main Action ─────────────────────────────────────────────────

export const fetchDerivatives = action({
  args: { instrument: v.string() },
  handler: async (_ctx, args): Promise<DerivativesResult> => {
    const apiKey = process.env.COINGLASS_API_KEY;
    const symbol = mapSymbolForCG(args.instrument);
    // Start Tokenomist concurrently so it cannot serialize CoinGlass requests.
    const tokenomicsPromise = fetchTokenomics(args.instrument);

    try {
      const cacheKey = "deriv:" + symbol;
      const cached = getCached<CryptoDerivativesData>(cacheKey);
      if (cached) {
        return { success: true, data: cached, tokenomics: await tokenomicsPromise };
      }

      if (!apiKey) {
        const [tokenomics, fallback] = await Promise.all([
          tokenomicsPromise,
          fetchPublicDerivativesFallback(args.instrument),
        ]);
        if (fallback.data) {
          setCache(cacheKey, fallback.data, BINANCE_FALLBACK_CACHE_TTL);
          return {
            success: true,
            data: fallback.data,
            tokenomics,
            error: "CoinGlass API key is not configured; using " + fallback.data.provider + " as a labeled fallback.",
            errorCode: "AUTH_ERROR",
          };
        }
        return {
          success: Boolean(tokenomics.available),
          tokenomics,
          error: "CoinGlass API key is not configured. Public derivatives fallbacks failed: " + fallback.error,
          errorCode: "AUTH_ERROR",
        };
      }

      const [settled, tokenomics] = await Promise.all([
        Promise.allSettled([
          fetchOpenInterest(symbol, apiKey),
          fetchFundingRate(symbol, apiKey),
          fetchLongShort(symbol, apiKey),
          fetchLiquidations(symbol, apiKey),
        ]),
        tokenomicsPromise,
      ]);
      const oiResult = settled[0];
      const fundingResult = settled[1];
      const lsResult = settled[2];
      const liqResult = settled[3];
      const openInterest = oiResult.status === "fulfilled" ? oiResult.value : undefined;
      const fundingRate = fundingResult.status === "fulfilled" ? fundingResult.value : undefined;
      const longShort = lsResult.status === "fulfilled" ? lsResult.value : undefined;
      const liquidations = liqResult.status === "fulfilled" ? liqResult.value : undefined;

      const availability = {
        openInterest: !!openInterest,
        fundingRate: !!fundingRate,
        longShort: !!longShort,
        liquidations: !!liquidations,
      };
      const availableCount = Object.values(availability).filter(Boolean).length;

      if (availableCount === 0) {
        const reasons = [oiResult, fundingResult, lsResult, liqResult]
          .filter((result) => result.status === "rejected")
          .map((result) => String((result as PromiseRejectedResult).reason?.message || ""));
        const authError = reasons.find((message) => message.startsWith("AUTH_ERROR:"));
        const rateLimit = reasons.find((message) => message.startsWith("RATE_LIMIT:"));
        const errorCode: DerivativesResult["errorCode"] = authError
          ? "AUTH_ERROR"
          : rateLimit
            ? "RATE_LIMIT"
            : "NO_DATA";
        const error = authError
          ? "CoinGlass authentication failed. Check COINGLASS_API_KEY and API v4 permissions."
          : rateLimit
            ? "CoinGlass rate limit exceeded."
            : reasons[0] || "CoinGlass returned no usable derivatives data.";
        const fallback = await fetchPublicDerivativesFallback(args.instrument);
        if (fallback.data) {
          setCache(cacheKey, fallback.data, BINANCE_FALLBACK_CACHE_TTL);
          return {
            success: true,
            data: fallback.data,
            tokenomics,
            error: error + " Using " + fallback.data.provider + " fallback.",
            errorCode,
          };
        }
        return {
          success: Boolean(tokenomics.available),
          tokenomics,
          error: error + " Public derivatives fallbacks failed: " + fallback.error,
          errorCode,
        };
      }

      let confidence: CryptoDerivativesData["confidence"] = "low";
      if (availableCount >= 3) confidence = "high";
      else if (availableCount >= 2) confidence = "medium";

      const data: CryptoDerivativesData = {
        provider: "coinglass",
        symbol,
        timestamp: Date.now(),
        freshness: "delayed",
        openInterest,
        fundingRate,
        longShort,
        liquidations,
        availability,
        confidence,
        interpretation: generateInterpretation(openInterest, fundingRate, longShort, liquidations),
      };
      // Only cache responses containing real provider data.
      setCache(cacheKey, data);
      return { success: true, data, tokenomics };
    } catch (err: any) {
      const tokenomics = await tokenomicsPromise;
      return {
        success: Boolean(tokenomics?.available),
        tokenomics,
        error: err instanceof Error ? err.message : "CoinGlass request failed.",
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});

// ── Tokenomics providers: Tokenomist when configured, public PatternPlus fallback ──
const tokenomistAdapter = new TokenomistAdapter(undefined, process.env.TOKENOMIST_API_KEY);
const patternPlusUnlockAdapter = new PatternPlusUnlockAdapter();
const tokenomicsCache = new Map<string, {
  data: import("../lib/data/crypto/types").TokenomicsIntelligence;
  expiresAt: number;
}>();
const TOKENOMICS_TTL = 30 * 60 * 1000;

function unavailableTokenomics(
  reason: string,
  provider = "PatternPlus",
  observedAt = Date.now(),
): import("../lib/data/crypto/types").TokenomicsIntelligence {
  return {
    provider,
    observedAt,
    freshness: "UNAVAILABLE",
    quality: "UNAVAILABLE",
    available: false,
    failureReason: reason,
    availableDatasets: 0,
    totalDatasets: 2,
  };
}

async function fetchTokenomics(instrument: string): Promise<import("../lib/data/crypto/types").TokenomicsIntelligence> {
  const key = instrument.trim().toUpperCase();
  const cached = tokenomicsCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  if (cached) tokenomicsCache.delete(key);

  let tokenomistFailure: string | undefined;
  if (process.env.TOKENOMIST_API_KEY?.trim()) {
    try {
      const result = await tokenomistAdapter.fetch(key);
      if (result?.success && result.data && typeof result.data === "object") {
        const normalized = parseTokenomistResult(
          result.data as Record<string, any>,
          key,
          result.observedAt ?? Date.now(),
        );
        if (normalized.available) {
          tokenomicsCache.set(key, { data: normalized, expiresAt: Date.now() + TOKENOMICS_TTL });
          return normalized;
        }
      }
      tokenomistFailure = [result?.errorCode, result?.error].filter(Boolean).join(": ") ||
        "Tokenomist did not return usable tokenomics.";
    } catch (err) {
      tokenomistFailure = err instanceof Error ? err.message : "Tokenomist request failed.";
    }
  }

  // The public feed is rebuilt daily and cached across instrument lookups.
  // Missing records remain unavailable; they are never interpreted as zero unlocks.
  try {
    const fallback = await patternPlusUnlockAdapter.fetch(key);
    const result = !fallback.available && tokenomistFailure
      ? {
          ...fallback,
          failureReason: "Tokenomist fallback failed (" + tokenomistFailure + "); " +
            (fallback.failureReason ?? "PatternPlus has no usable record."),
        }
      : fallback;
    tokenomicsCache.set(key, { data: result, expiresAt: Date.now() + TOKENOMICS_TTL });
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "PatternPlus fallback request failed.";
    const result = unavailableTokenomics(
      tokenomistFailure ? "Tokenomist unavailable (" + tokenomistFailure + "); PatternPlus: " + reason : reason,
      "PatternPlus",
    );
    tokenomicsCache.set(key, { data: result, expiresAt: Date.now() + TOKENOMICS_TTL });
    return result;
  }
}

// ── DeFi fundamentals (server-side; public DeFiLlama endpoints) ──
const defiLlamaAdapter = new DeFiLlamaAdapter();
const DEFI_LLAMA_CACHE_TTL = 10 * 60 * 1000;
const defiLlamaCache = new Map<string, {
  data: Record<string, any>;
  provider: string;
  observedAt: number;
  expiresAt: number;
}>();

export const fetchDeFiLlamaFundamentals = action({
  args: {
    instrument: v.string(),
  },
  handler: async (_ctx, args) => {
    const instrument = args.instrument.trim().toUpperCase();
    const cached = defiLlamaCache.get(instrument);
    if (cached && Date.now() < cached.expiresAt) {
      return {
        success: true as const,
        data: cached.data,
        provider: cached.provider,
        observedAt: cached.observedAt,
      };
    }
    if (cached) defiLlamaCache.delete(instrument);

    try {
      const result = await defiLlamaAdapter.fetch(instrument);
      if (!result) {
        return {
          success: false as const,
          error: "DeFiLlama does not support this instrument.",
          errorCode: "UNSUPPORTED_ASSET" as const,
        };
      }
      if (!result.success || !result.data || typeof result.data !== "object") {
        return {
          success: false as const,
          error: result.error ?? "DeFiLlama returned no usable data.",
          errorCode: result.errorCode ?? "NO_DATA",
        };
      }

      const normalized = {
        success: true as const,
        data: result.data as Record<string, any>,
        provider: result.provider,
        observedAt: result.observedAt,
      };
      defiLlamaCache.set(instrument, {
        ...normalized,
        expiresAt: Date.now() + DEFI_LLAMA_CACHE_TTL,
      });
      return normalized;
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : "DeFiLlama request failed.",
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});

// ── Individual Fetchers (CoinGlass API v4) ────────────────────────

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchOpenInterest(symbol: string, apiKey: string): Promise<OpenInterestData | undefined> {
  const data = await cgFetch("/futures/open-interest/exchange-list?symbol=" + encodeURIComponent(symbol), apiKey);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const latest = rows.find((item: any) => String(item.exchange || "").toLowerCase() === "all") ?? rows[0];
  const current = finiteNumber(latest?.open_interest_usd);
  if (current === undefined || current <= 0) return undefined;
  const change1h = finiteNumber(latest?.open_interest_change_percent_1h);
  const change24h = finiteNumber(latest?.open_interest_change_percent_24h);
  return {
    current,
    ...(change1h !== undefined ? { change1h } : {}),
    ...(change24h !== undefined ? { change24h } : {}),
  };
}

async function fetchFundingRate(symbol: string, apiKey: string): Promise<FundingRateData | undefined> {
  const data = await cgFetch("/futures/funding-rate/exchange-list?symbol=" + encodeURIComponent(symbol), apiKey);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const item = rows.find((row: any) => String(row.symbol || "").toUpperCase() === symbol.toUpperCase()) ?? rows[0];
  const exchanges = Array.isArray(item?.stablecoin_margin_list) ? item.stablecoin_margin_list : [];
  const actualRates = exchanges
    .map((entry: any) => ({
      name: String(entry.exchange || "unknown"),
      rawRate: finiteNumber(entry.funding_rate),
      intervalHours: finiteNumber(entry.funding_rate_interval) ?? 8,
    }))
    .filter((entry: any) => entry.rawRate !== undefined);
  if (actualRates.length === 0) return undefined;

  // CoinGlass v4 funding_rate is percentage units (0.0073 means 0.0073%).
  const selected = actualRates.find((entry: any) => entry.name.toLowerCase() === "binance") ?? actualRates[0];
  const currentRate = selected.rawRate! / 100;
  return {
    currentRate,
    annualizedRate: currentRate * (24 / Math.max(1, selected.intervalHours)) * 365,
    exchanges: actualRates.map((entry: any) => ({ name: entry.name, rate: entry.rawRate! / 100 })),
  };
}

async function fetchLongShort(symbol: string, apiKey: string): Promise<LongShortData | undefined> {
  // 4h remains compatible with entry-level API plans.
  const pair = symbol + "USDT";
  const path = "/futures/global-long-short-account-ratio/history?exchange=Binance&symbol=" +
    encodeURIComponent(pair) + "&interval=4h&limit=1";
  const data = await cgFetch(path, apiKey);
  const points = Array.isArray(data) ? data : data ? [data] : [];
  const latest = points[points.length - 1];
  const ratio = finiteNumber(latest?.global_account_long_short_ratio);
  if (ratio === undefined || ratio <= 0) return undefined;
  return { accountRatio: ratio };
}

async function fetchLiquidations(symbol: string, apiKey: string): Promise<LiquidationData | undefined> {
  // 4h is supported across current plans; amounts are in USD by provider definition.
  const path = "/futures/liquidation/aggregated-history?exchange_list=Binance%2COKX%2CBybit&symbol=" +
    encodeURIComponent(symbol) + "&interval=4h&limit=1";
  const data = await cgFetch(path, apiKey);
  const points = Array.isArray(data) ? data : data ? [data] : [];
  const latest = points[points.length - 1];
  if (!latest) return undefined;
  const longVol = finiteNumber(latest.aggregated_long_liquidation_usd);
  const shortVol = finiteNumber(latest.aggregated_short_liquidation_usd);
  if (longVol === undefined && shortVol === undefined) return undefined;
  const longs = longVol ?? 0;
  const shorts = shortVol ?? 0;
  return {
    longVolume: longs,
    shortVolume: shorts,
    totalVolume: longs + shorts,
    dominantSide: longs > shorts * 1.5 ? "longs" : shorts > longs * 1.5 ? "shorts" : "balanced",
    window: "4h",
  };
}

// ── Interpretation Generator ────────────────────────────────────

function generateInterpretation(
  oi: OpenInterestData | undefined,
  fr: FundingRateData | undefined,
  ls: LongShortData | undefined,
  liq: LiquidationData | undefined,
): string {
  const parts: string[] = [];

  // Funding rate interpretation
  if (fr) {
    const rate = fr.currentRate;
    if (rate > 0.001) {
      parts.push(`Highly positive funding (${(rate * 100).toFixed(3)}%) indicates crowded longs — elevated reversal/liquidation risk.`);
    } else if (rate > 0.0005) {
      parts.push(`Moderately positive funding (${(rate * 100).toFixed(3)}%) — longs paying shorts, market leans bullish but watch for overcrowding.`);
    } else if (rate < -0.001) {
      parts.push(`Highly negative funding (${(rate * 100).toFixed(3)}%) indicates crowded shorts — potential squeeze risk.`);
    } else if (rate < -0.0005) {
      parts.push(`Moderately negative funding (${(rate * 100).toFixed(3)}%) — shorts paying longs, market leans bearish but watch for squeeze.`);
    } else {
      parts.push(`Neutral funding rate (${(rate * 100).toFixed(4)}%) — balanced positioning.`);
    }
  }

  // OI interpretation (in context)
  if (oi) {
    if (oi.change1h !== undefined) {
      if (oi.change1h > 2) {
        parts.push(`OI rising +${oi.change1h.toFixed(1)}% (1h) — new positions opening, conviction increasing.`);
      } else if (oi.change1h < -2) {
        parts.push(`OI declining ${oi.change1h.toFixed(1)}% (1h) — positions closing, conviction fading.`);
      }
    }
  }

  // Long/short interpretation
  if (ls) {
    if (ls.accountRatio !== undefined) {
      if (ls.accountRatio > 1.5) {
        parts.push(`Long/short ratio ${ls.accountRatio.toFixed(2)} — retail heavily long, contrarian bearish risk.`);
      } else if (ls.accountRatio < 0.67) {
        parts.push(`Long/short ratio ${ls.accountRatio.toFixed(2)} — retail heavily short, contrarian bullish risk.`);
      }
    }
    if (ls.topTraderRatio !== undefined) {
      if (ls.topTraderRatio > 1.2) {
        parts.push(`Top traders lean long (${ls.topTraderRatio.toFixed(2)}).`);
      } else if (ls.topTraderRatio < 0.83) {
        parts.push(`Top traders lean short (${ls.topTraderRatio.toFixed(2)}).`);
      }
    }
  }

  // Liquidation interpretation
  if (liq && liq.dominantSide) {
    if (liq.dominantSide === "longs") {
      parts.push(`Long liquidations dominating — downside pressure, but may signal near-term capitulation.`);
    } else if (liq.dominantSide === "shorts") {
      parts.push(`Short liquidations dominating — upside pressure, potential short squeeze in progress.`);
    }
  }

  return parts.join(" ");
}
