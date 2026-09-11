/**
 * Convex server-side action for CoinGlass V4 crypto derivatives data.
 * Handles open interest, funding rate, long/short ratio, and liquidations.
 * All API keys are read from environment variables — never exposed to client.
 */
"use node";

import { action } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";
import { v } from "convex/values";
import type {
  CryptoDerivativesData,
  DerivativesResult,
  OpenInterestData,
  FundingRateData,
  LongShortData,
  LiquidationData,
} from "../lib/data/derivatives-types";

// ── Phase 178b — authoritative provider cache ───────────────────
// Replaces this module's private Map cache. Derivatives are keyed on the FULL
// provider-native instrument (not the truncated base symbol), so BTC/USDT,
// BTC/USD and BTC-USDT-SWAP can never share an entry.
import { getProviderCache } from "../lib/data/provider-cache-registry";

// ── CoinGlass API ───────────────────────────────────────────────

const CG_BASE = "https://open-api-v3.coinglass.com/api";

async function cgFetch(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${CG_BASE}${path}`, {
    // Phase 177 — HTTP deadline below the 8s coinglass leg budget.
    signal: AbortSignal.timeout(7_000),
    headers: {
      accept: "application/json",
      cg_api_key: apiKey,
    },
  });
  if (!res.ok) {
    throw new Error(`CoinGlass HTTP ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  // CoinGlass V3/V4 wraps in { code, msg, data }
  if (json.code && json.code !== "0" && json.code !== 0) {
    const msg = json.msg || "Unknown CoinGlass error";
    if (String(json.code) === "429" || msg.toLowerCase().includes("rate")) {
      throw new Error("RATE_LIMIT:" + msg);
    }
    if (String(json.code) === "401" || String(json.code) === "403") {
      throw new Error("AUTH_ERROR:" + msg);
    }
    throw new Error(`CoinGlass error ${json.code}: ${msg}`);
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
  args: {
    instrument: v.string(),
  },
  handler: async (ctx, args): Promise<DerivativesResult> => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(ctx);

    const apiKey = process.env.COINGLASS_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "CoinGlass not configured: COINGLASS_API_KEY is missing. Add it via: bunx convex env set COINGLASS_API_KEY <your-key>",
        errorCode: "AUTH_ERROR",
      };
    }

    const symbol = mapSymbolForCG(args.instrument);

    try {
      // Phase 178b — the ENTIRE acquisition runs inside the cache fetcher, so
      // a hit skips all four upstream calls and 20 concurrent callers collapse
      // to one acquisition instead of four-per-caller.
      const evidence = await getProviderCache().fetch<CryptoDerivativesData>(
        {
          provider: "coinglass",
          dataset: "derivatives",
          instrument: args.instrument,
          instrumentType: "crypto",
          qualifier: symbol,
        },
        async () => {
      // Fetch all datasets in parallel
      const [oiResult, fundingResult, lsResult, liqResult] = await Promise.allSettled([
        fetchOpenInterest(symbol, apiKey),
        fetchFundingRate(symbol, apiKey),
        fetchLongShort(symbol, apiKey),
        fetchLiquidations(symbol, apiKey),
      ]);

      const openInterest = oiResult.status === "fulfilled" ? oiResult.value : undefined;
      const fundingRate = fundingResult.status === "fulfilled" ? fundingResult.value : undefined;
      const longShort = lsResult.status === "fulfilled" ? lsResult.value : undefined;
      const liquidations = liqResult.status === "fulfilled" ? liqResult.value : undefined;

      // Phase 178b — a provider failure must THROW out of the cache fetcher.
      // Returning an error envelope here would let `ProviderCache` store a
      // 429 as if it were evidence. Throwing leaves the cache untouched; the
      // catch below turns it back into the action's error envelope.
      for (const result of [oiResult, fundingResult, lsResult, liqResult]) {
        if (result.status === "rejected" && String(result.reason?.message).startsWith("RATE_LIMIT")) {
          throw new Error("RATE_LIMIT: CoinGlass rate limit exceeded.");
        }
        if (result.status === "rejected" && String(result.reason?.message).startsWith("AUTH_ERROR")) {
          throw new Error("AUTH_ERROR: CoinGlass authentication failed.");
        }
      }

      // Determine availability
      const availability = {
        openInterest: !!openInterest,
        fundingRate: !!fundingRate,
        longShort: !!longShort,
        liquidations: !!liquidations,
      };

      const availableCount = Object.values(availability).filter(Boolean).length;
      let confidence: CryptoDerivativesData["confidence"] = "unavailable";
      if (availableCount >= 3) confidence = "high";
      else if (availableCount >= 2) confidence = "medium";
      else if (availableCount >= 1) confidence = "low";

      // Generate interpretation
      const interpretation = generateInterpretation(openInterest, fundingRate, longShort, liquidations);

      const data: CryptoDerivativesData = {
        provider: "coinglass",
        symbol,
        timestamp: Date.now(),
        freshness: "delayed", // CoinGlass free tier is not realtime
        openInterest,
        fundingRate,
        longShort,
        liquidations,
        availability,
        confidence,
        interpretation,
      };

          return { data, observedAt: data.timestamp };
        },
      );
      if (!evidence) {
        return {
          success: false,
          error: "CoinGlass returned no derivatives data.",
          errorCode: "NO_DATA",
        };
      }
      // The payload is returned verbatim on a hit, so `data.timestamp` stays
      // the ORIGINAL provider observation time — never reset to now.
      return {
        success: true,
        data: evidence.data,
        // Phase 178d — reported by the cache, not inferred from timing.
        acquisition: evidence.acquisition,
        observedAt: evidence.observedAt,
      };
    } catch (err: any) {
      // Phase 178b — preserve the original classification that the fetcher
      // threw. Collapsing a 429 into API_UNAVAILABLE would lose the
      // rate-limit signal Phase 177 depends on.
      const msg = String(err?.message ?? "unknown error");
      if (msg.startsWith("RATE_LIMIT")) {
        return {
          success: false,
          error: "CoinGlass rate limit exceeded.",
          errorCode: "RATE_LIMIT",
        };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return {
          success: false,
          error: "CoinGlass authentication failed.",
          errorCode: "AUTH_ERROR",
        };
      }
      return {
        success: false,
        error: `Derivatives fetch failed: ${msg}`,
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});

// ── Individual Fetchers ─────────────────────────────────────────

async function fetchOpenInterest(symbol: string, apiKey: string): Promise<OpenInterestData | undefined> {
  try {
    const data = await cgFetch(`/futures/openInterest/chart?symbol=${symbol}&interval=1h&limit=2`, apiKey);
    if (!data) return undefined;

    // CoinGlass returns an array of data points or a single object
    const points = Array.isArray(data) ? data : [data];
    if (points.length === 0) return undefined;

    const latest = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : null;

    const current = parseFloat(latest.openInterest || latest.value || "0");
    if (current === 0) return undefined;

    const result: OpenInterestData = { current };

    if (previous) {
      const prev = parseFloat(previous.openInterest || previous.value || "0");
      if (prev > 0) {
        result.change1h = Math.round(((current - prev) / prev) * 10000) / 100;
      }
    }

    return result;
  } catch {
    return undefined;
  }
}

async function fetchFundingRate(symbol: string, apiKey: string): Promise<FundingRateData | undefined> {
  try {
    const data = await cgFetch(`/futures/fundingRate/current?symbol=${symbol}`, apiKey);
    if (!data) return undefined;

    // CoinGlass returns { data: [...] } or a single object
    const items = Array.isArray(data) ? data : [data];
    if (items.length === 0) return undefined;

    // Find the entry for our symbol
    const entry = items.find((item: any) =>
      item.symbol === symbol || item.symbol?.includes(symbol),
    ) || items[0];

    const rate = parseFloat(entry.data?.currentRate || entry.currentRate || entry.data || "0");
    if (isNaN(rate)) return undefined;

    const result: FundingRateData = {
      currentRate: rate,
      annualizedRate: rate * 3 * 365, // 3 funding periods per day * 365 days
    };

    // OI-weighted rate if available
    if (entry.data?.predictedRate) {
      result.weightedRate = parseFloat(entry.data.predictedRate);
    }

    // Exchange-level rates
    if (entry.data?.exchangeList && Array.isArray(entry.data.exchangeList)) {
      result.exchanges = entry.data.exchangeList.map((ex: any) => ({
        name: ex.exchange || ex.name || "unknown",
        rate: parseFloat(ex.data?.currentRate || ex.rate || "0"),
      })).filter((ex: any) => !isNaN(ex.rate));
    }

    return result;
  } catch {
    return undefined;
  }
}

async function fetchLongShort(symbol: string, apiKey: string): Promise<LongShortData | undefined> {
  try {
    const data = await cgFetch(`/futures/longShort/chart?symbol=${symbol}&interval=1h&limit=1`, apiKey);
    if (!data) return undefined;

    const points = Array.isArray(data) ? data : [data];
    if (points.length === 0) return undefined;

    const latest = points[points.length - 1];
    const result: LongShortData = {};

    // Account ratio
    if (latest.longShortRatio !== undefined || latest.data?.longShortRatio !== undefined) {
      result.accountRatio = parseFloat(latest.longShortRatio || latest.data?.longShortRatio || "0");
    }

    // Top trader ratio
    if (latest.topTraderLongShortRatio !== undefined || latest.data?.topTraderLongShortRatio !== undefined) {
      result.topTraderRatio = parseFloat(latest.topTraderLongShortRatio || latest.data?.topTraderLongShortRatio || "0");
    }

    // Taker ratio
    if (latest.takerBuySellRatio !== undefined || latest.data?.takerBuySellRatio !== undefined) {
      result.takerRatio = parseFloat(latest.takerBuySellRatio || latest.data?.takerBuySellRatio || "0");
    }

    if (result.accountRatio === undefined && result.topTraderRatio === undefined && result.takerRatio === undefined) {
      return undefined;
    }

    return result;
  } catch {
    return undefined;
  }
}

async function fetchLiquidations(symbol: string, apiKey: string): Promise<LiquidationData | undefined> {
  try {
    const data = await cgFetch(`/futures/liquidation/v2/history?symbol=${symbol}&interval=1h&limit=1`, apiKey);
    if (!data) return undefined;

    const points = Array.isArray(data) ? data : [data];
    if (points.length === 0) return undefined;

    const latest = points[points.length - 1];
    const result: LiquidationData = {};

    const longVol = parseFloat(latest.longLiquidation || latest.data?.longLiquidation || "0");
    const shortVol = parseFloat(latest.shortLiquidation || latest.data?.shortLiquidation || "0");

    if (longVol > 0 || shortVol > 0) {
      result.longVolume = longVol;
      result.shortVolume = shortVol;
      result.totalVolume = longVol + shortVol;
      if (longVol > shortVol * 1.5) result.dominantSide = "longs";
      else if (shortVol > longVol * 1.5) result.dominantSide = "shorts";
      else result.dominantSide = "balanced";
    }

    if (result.totalVolume === undefined || result.totalVolume === 0) {
      return undefined;
    }

    return result;
  } catch {
    return undefined;
  }
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
