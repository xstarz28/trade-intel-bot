/**
 * Convex server-side market data proxy.
 * API keys are read from environment variables, never exposed to the client.
 *
 * Phase 3A: technical calculations use the SHARED pure layer
 * (lib/data/technical.ts + lib/data/smc.ts + lib/data/mtf.ts) — the same
 * code the client would run — eliminating the previous duplicated inline
 * implementations that could drift out of sync.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { computeSmcContext } from "../lib/data/smc";
import { calculateTechnical } from "../lib/data/technical";
import { buildChain, buildMtfContext } from "../lib/data/mtf";
import { detectIctUnicorn, type ClassicPriceActionContext } from "../lib/data/classic-price-action";
import { crossAssetComparator } from "../lib/market-context";
import type { OhlcvCandle, TechnicalData, TimeframeStructureContext } from "../lib/data/market-types";
import { TwelveDataRequestBudget, type TwelveDataRequestClass } from "../lib/data/twelve-data-budget";
import { parseMarketDataTimestamp } from "../lib/data/utc-market-timestamp";
import {
  OKX_SPOT_MARKET_PROVIDER,
  OkxSpotMarketAdapter,
  normalizeOkxSpotCandles,
  toOkxSpotBar,
} from "../lib/data/crypto/okx-spot-market-adapter";

interface TdCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

function mapTimeframe(tf: string): string {
  const map: Record<string, string> = {
    M1: "1min", M5: "5min", M15: "15min",
    H1: "1h", H4: "4h", D1: "1day", W1: "1week",
  };
  return map[tf] ?? tf.toLowerCase();
}

/** Successful OHLCV snapshots shared across analyses in a warm Convex worker. */
const candleCache = new Map<string, { candles: OhlcvCandle[]; fetchedAt: number; expiresAt: number }>();
const candleInflight = new Map<string, Promise<OhlcvCandle[]>>();
const candleRateLimitBackoff = new Map<string, { message: string; retryAt: number }>();
const CANDLE_REQUEST_TIMEOUT_MS = 8_000;
const CANDLE_RATE_LIMIT_BACKOFF_MS = 60_000;
const twelveDataRequestBudget = new TwelveDataRequestBudget();

/**
 * Reserve a provider credit synchronously before starting a request. The
 * observed production key is on the 8-credit/minute tier, so primary OHLCV
 * wins over optional quotes, cross-asset probes and extra timeframe candles.
 */
function reserveTwelveDataCall(requestClass: TwelveDataRequestClass): void {
  const reservation = twelveDataRequestBudget.reserve(requestClass);
  if (!reservation.allowed) {
    throw new Error(`REQUEST_BUDGET: ${reservation.reason}; retry after ${new Date(reservation.retryAt).toISOString()}`);
  }
}
const okxSpotMarketAdapter = new OkxSpotMarketAdapter();
const OKX_PERPETUAL_MARKET_PROVIDER = "okx-perpetual-public";
const OKX_FUTURES_MARKET_PROVIDER = "okx-futures-public";
const candleProviderCache = new Map<string, string>();

function candleTtlMs(tf: string): number {
  switch (tf.toUpperCase()) {
    case "M1": return 10_000;
    case "M5": return 60_000;
    case "M15": return 45_000;
    case "H1": return 120_000;
    case "H4": return 5 * 60_000;
    case "D1": return 15 * 60_000;
    case "W1": return 60 * 60_000;
    default: return 20_000;
  }
}

/**
 * Fetch + normalize candles with bounded network time, duplicate-request coalescing,
 * short timeframe-aware caching, and a brief 429 backoff.
 * Failures never synthesize a candle series and continue to be reported to the caller.
 */
async function fetchCandles(
  symbol: string,
  tf: string,
  outputsize: number,
  apiKey: string | undefined,
  instrumentType?: string,
  requestClass: TwelveDataRequestClass = "optional",
): Promise<OhlcvCandle[]> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedTimeframe = tf.trim().toUpperCase();
  const cacheKey = normalizedSymbol + "|" + normalizedTimeframe;
  const requestKey = cacheKey + "|" + outputsize;
  const now = Date.now();
  const cached = candleCache.get(cacheKey);
  if (cached && now < cached.expiresAt && cached.candles.length >= outputsize) {
    return cached.candles.slice(-outputsize).map((candle) => ({ ...candle }));
  }

  const backoff = candleRateLimitBackoff.get(cacheKey);
  // Crypto gets a no-key OKX attempt even during Twelve Data backoff.
  if (backoff && now < backoff.retryAt && instrumentType !== "crypto") throw new Error(backoff.message);
  if (backoff && now >= backoff.retryAt) candleRateLimitBackoff.delete(cacheKey);

  const existingRequest = candleInflight.get(requestKey);
  if (existingRequest) {
    const shared = await existingRequest;
    return shared.slice(-outputsize).map((candle) => ({ ...candle }));
  }

  const request = (async (): Promise<OhlcvCandle[]> => {
    if (instrumentType === "crypto" && (normalizedSymbol.endsWith("-SWAP") || /-[0-9]{6}$/.test(normalizedSymbol))) {
      // Keep the user's selected derivatives contract as the exact data identity.
      // A failed futures/contract query must never silently turn into spot data.
      const isPerpetual = normalizedSymbol.endsWith("-SWAP");
      const provider = isPerpetual ? OKX_PERPETUAL_MARKET_PROVIDER : OKX_FUTURES_MARKET_PROVIDER;
      const response = await fetch(
        "https://www.okx.com/api/v5/market/candles?instId=" + encodeURIComponent(normalizedSymbol) +
          "&bar=" + encodeURIComponent(toOkxSpotBar(normalizedTimeframe)) +
          "&limit=" + Math.min(300, Math.max(1, Math.floor(outputsize))),
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || String(payload.code) !== "0") {
        throw new Error("OKX derivative candles unavailable for exact contract " + normalizedSymbol + ": " + String(payload?.msg ?? response.statusText));
      }
      const normalized = normalizeOkxSpotCandles(payload, outputsize);
      if (normalized.length === 0) throw new Error("OKX returned no valid candles for exact contract " + normalizedSymbol);
      const fetchedAt = Date.now();
      candleCache.set(cacheKey, {
        candles: normalized.map((candle) => ({ ...candle })),
        fetchedAt,
        expiresAt: fetchedAt + candleTtlMs(normalizedTimeframe),
      });
      candleProviderCache.set(cacheKey, provider);
      return normalized;
    }

    if (instrumentType === "crypto") {
      try {
        const normalized = await okxSpotMarketAdapter.fetchCandles(normalizedSymbol, normalizedTimeframe, outputsize);
        const fetchedAt = Date.now();
        candleCache.set(cacheKey, {
          candles: normalized.map((candle) => ({ ...candle })),
          fetchedAt,
          expiresAt: fetchedAt + candleTtlMs(normalizedTimeframe),
        });
        candleProviderCache.set(cacheKey, OKX_SPOT_MARKET_PROVIDER);
        candleRateLimitBackoff.delete(cacheKey);
        return normalized;
      } catch (okxError) {
        const okxMessage = okxError instanceof Error ? okxError.message : String(okxError);
        const activeBackoff = candleRateLimitBackoff.get(cacheKey);
        if (activeBackoff && Date.now() < activeBackoff.retryAt) {
          throw new Error("OKX Spot unavailable: " + okxMessage + "; Twelve Data backup is rate-limited: " + activeBackoff.message);
        }
        if (!apiKey) {
          throw new Error("OKX Spot unavailable: " + okxMessage + "; Twelve Data backup is unavailable because TWELVE_DATA_API_KEY is missing");
        }
      }
    }
    if (!apiKey) throw new Error("TWELVE_DATA_API_KEY is missing for this market-data request");
    reserveTwelveDataCall(requestClass);
    const url = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(normalizedSymbol) +
      "&interval=" + encodeURIComponent(mapTimeframe(normalizedTimeframe)) +
      "&outputsize=" + outputsize +
      "&timezone=UTC" +
      "&apikey=" + encodeURIComponent(apiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(CANDLE_REQUEST_TIMEOUT_MS) });
    const json = await response.json().catch(() => ({} as Record<string, any>));
    if (json && json.code) {
      throw new Error("[" + json.code + "] " + (json.message || "provider error"));
    }
    if (!response.ok) {
      throw new Error("[" + response.status + "] " + (response.statusText || "provider HTTP error"));
    }
    const values: TdCandle[] = Array.isArray(json?.values) ? json.values : [];
    if (values.length === 0) throw new Error("no candle data returned");
    const normalized = values.reverse().map((candle) => ({
      timestamp: parseMarketDataTimestamp(candle.datetime),
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.volume) || 0,
    })).filter((candle) =>
      Number.isFinite(candle.timestamp) &&
      Number.isFinite(candle.open) && Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) && Number.isFinite(candle.close),
    );
    if (normalized.length === 0) throw new Error("provider returned no valid OHLCV candles");

    const fetchedAt = Date.now();
    const previous = candleCache.get(cacheKey);
    if (!previous || normalized.length >= previous.candles.length || fetchedAt >= previous.expiresAt) {
      candleCache.set(cacheKey, {
        candles: normalized.map((candle) => ({ ...candle })),
        fetchedAt,
        expiresAt: fetchedAt + candleTtlMs(normalizedTimeframe),
      });
    }
    candleProviderCache.set(cacheKey, "twelve-data");
    candleRateLimitBackoff.delete(cacheKey);
    return normalized;
  })();

  candleInflight.set(requestKey, request);
  try {
    const result = await request;
    return result.slice(-outputsize).map((candle) => ({ ...candle }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "provider request failed";
    if (message.startsWith("[429]") || /rate.?limit|credits for the current minute/i.test(message)) {
      const retryAt = Date.now() + CANDLE_RATE_LIMIT_BACKOFF_MS;
      candleRateLimitBackoff.set(cacheKey, { message, retryAt });
      // Stop every subsequent Twelve Data request in this worker, not just
      // this symbol/timeframe; the provider quota is shared across symbols.
      twelveDataRequestBudget.markRateLimited(Date.now(), CANDLE_RATE_LIMIT_BACKOFF_MS);
    }
    throw err;
  } finally {
    if (candleInflight.get(requestKey) === request) candleInflight.delete(requestKey);
  }
}
export const fetchMarketData = action({
  args: {
    instrument: v.string(),
    instrumentType: v.union(
      v.literal("forex"),
      v.literal("crypto"),
      v.literal("stock"),
      v.literal("commodity"),
      v.literal("indices"),
    ),
    timeframe: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey && args.instrumentType !== "crypto") {
      return {
        success: false as const,
        error: "Market data provider not configured: TWELVE_DATA_API_KEY is missing. Add it in the Keys/API keys tab.",
        errorCode: "AUTH_ERROR" as const,
      };
    }

    const symbol = args.instrument.toUpperCase().trim();

    try {
      // Primary (setup) timeframe — errors classified precisely (429, auth…)
      let candles: OhlcvCandle[];
      try {
        candles = await fetchCandles(symbol, args.timeframe, 210, apiKey, args.instrumentType, "primary");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        if (msg.startsWith("[429]") || msg.startsWith("REQUEST_BUDGET:")) {
          return { success: false as const, error: `Market data request deferred to protect the Twelve Data request budget: ${msg.replace(/^REQUEST_BUDGET:\\s*/, "")}`, errorCode: "RATE_LIMIT" as const };
        }
        if (msg.startsWith("[401]") || msg.startsWith("[403]")) {
          return { success: false as const, error: `Auth error: ${msg}`, errorCode: "AUTH_ERROR" as const };
        }
        return { success: false as const, error: `API error: ${msg}`, errorCode: "API_UNAVAILABLE" as const };
      }

      // Avoid a separate Twelve Data quote request. Its free-tier credits are
      // shared with OHLCV; the last verified candle is the fallback price and
      // retains its source timestamp instead of being mislabeled as "now".
      const defaultCryptoProvider = symbol.endsWith("-SWAP")
        ? OKX_PERPETUAL_MARKET_PROVIDER
        : /-[0-9]{6}$/.test(symbol) ? OKX_FUTURES_MARKET_PROVIDER : OKX_SPOT_MARKET_PROVIDER;
      const marketProvider = candleProviderCache.get(symbol + "|" + args.timeframe) ??
        (args.instrumentType === "crypto" ? defaultCryptoProvider : "twelve-data");
      let quoteRes: Record<string, any> = {};
      if (args.instrumentType === "crypto" && marketProvider === OKX_SPOT_MARKET_PROVIDER) {
        const okxTicker = await okxSpotMarketAdapter.fetchTicker(symbol).catch(() => null);
        if (okxTicker) {
          quoteRes = {
            close: String(okxTicker.price),
            ...(okxTicker.bid !== undefined ? { bid: String(okxTicker.bid) } : {}),
            ...(okxTicker.ask !== undefined ? { ask: String(okxTicker.ask) } : {}),
          };
        }
      } else if (args.instrumentType === "crypto" &&
          (marketProvider === OKX_PERPETUAL_MARKET_PROVIDER || marketProvider === OKX_FUTURES_MARKET_PROVIDER)) {
        try {
          const response = await fetch(
            "https://www.okx.com/api/v5/market/ticker?instId=" + encodeURIComponent(symbol),
            { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) },
          );
          const payload = await response.json().catch(() => null);
          const row = payload?.data?.[0];
          const last = Number(row?.last), bid = Number(row?.bidPx), ask = Number(row?.askPx);
          if (response.ok && payload && String(payload.code) === "0" && Number.isFinite(last) && last > 0) {
            quoteRes = {
              close: String(last),
              ...(Number.isFinite(bid) && bid > 0 ? { bid: String(bid) } : {}),
              ...(Number.isFinite(ask) && ask > 0 ? { ask: String(ask) } : {}),
            };
          }
        } catch {
          // The candle series remains usable, but without a current contract quote it is delayed.
        }
      }

      const latestCandle = candles[candles.length - 1];
      const quotedPrice = Number(quoteRes.close);
      const hasLiveQuote = Number.isFinite(quotedPrice) && quotedPrice > 0;
      const price = hasLiveQuote ? quotedPrice : latestCandle.close;
      const priceTimestamp = hasLiveQuote ? Date.now() : latestCandle.timestamp;
      const bidValue = Number(quoteRes.bid);
      const askValue = Number(quoteRes.ask);
      const bid = Number.isFinite(bidValue) && bidValue > 0 ? bidValue : undefined;
      const ask = Number.isFinite(askValue) && askValue > 0 ? askValue : undefined;

      // ── Shared calculation layer (identical to client-side path) ──
      const technical = calculateTechnical(candles);
      technical.smc = computeSmcContext(candles, args.timeframe);
      const classicContext = (technical as TechnicalData & { classicContext?: ClassicPriceActionContext }).classicContext;
      if (classicContext) {
        classicContext.ictUnicorn = detectIctUnicorn(
          technical.smc.orderBlocks,
          technical.smc.fvgs,
          args.timeframe,
        );
      }

      // ── Adaptive MTF chain ─────────────────────────────────────
      // Only timeframes that actually fetch successfully enter the chain.
      // Failures (rate limits included) preserve all successful data and
      // mark the slot unavailable — nothing is ever synthesized.
      const slots = buildChain(args.timeframe);
      // One higher-timeframe series per instrument is the default on the
      // observed 8-credit/minute provider plan. Prefer the highest rung
      // (macro/structure context) and explicitly mark skipped timeframes;
      // the analysis engine must not synthesize missing candles.
      const preferredSlot =
        slots.find((slot) => slot.role === "macro") ??
        slots.find((slot) => slot.role === "structure") ??
        slots.find((slot) => slot.role === "trigger");
      const settled = await Promise.allSettled(
        slots.map((slot) => {
          // Public OKX candles do not consume the Twelve Data credit budget,
          // so crypto may use the complete available chain. For Twelve Data
          // markets only the highest HTF is fetched; remaining slots stay
          // explicitly unavailable until real candles can be fetched.
          if (args.instrumentType !== "crypto" && slot !== preferredSlot) {
            return Promise.reject(
              new Error("Not fetched: reserved Twelve Data credits for primary analyses across instruments."),
            );
          }
          return fetchCandles(
            symbol,
            slot.timeframe,
            slot.role === "trigger" ? 100 : 120,
            apiKey,
            args.instrumentType,
            "higher-timeframe",
          );
        }),
      );

      const mtfInputs = slots.map((s, i) => {
        const r = settled[i];
        return r.status === "fulfilled"
          ? { timeframe: s.timeframe, role: s.role, candles: r.value as OhlcvCandle[] }
          : {
              timeframe: s.timeframe,
              role: s.role,
              candles: null,
              error:
                r.reason instanceof Error
                  ? r.reason.message
                  : "timeframe fetch failed",
            };
      });

      // The setup slot uses the primary candles already fetched.
      mtfInputs.unshift({
        timeframe: args.timeframe,
        role: "setup" as const,
        candles,
      });

      const mtf = buildMtfContext(args.timeframe, mtfInputs);
      technical.mtf = mtf;

      // Legacy single-slot fields stay populated for backward compatibility
      // (old UI records / engine fallback paths), derived from the same MTF
      // computation — no second algorithm.
      const structureEntry = mtf.timeframes.find((t) => t.role === "structure");
      const triggerEntry = mtf.timeframes.find((t) => t.role === "trigger");
      const legacyCtx = (
        e: NonNullable<typeof structureEntry>,
      ): TimeframeStructureContext => ({
        timeframe: e.timeframe,
        structure: e.smc!.internalExternal.external.structure,
        bosDirection: e.smc!.internalExternal.external.bosDirection,
        chochDirection: e.smc!.internalExternal.external.chochDirection,
        lastSwingHigh: e.smc!.internalExternal.external.lastSwingHigh,
        lastSwingLow: e.smc!.internalExternal.external.lastSwingLow,
        dataPoints: e.smc!.internalExternal.external.dataPoints,
      });
      if (structureEntry) technical.htfContext = legacyCtx(structureEntry);
      else delete technical.htfContext;
      if (triggerEntry) technical.ltfTrigger = legacyCtx(triggerEntry);
      else delete technical.ltfTrigger;
      if (mtf.unavailable.length > 0) {
        technical.chainUnavailable = mtf.unavailable.map((u) => u.timeframe);
      } else {
        delete technical.chainUnavailable;
      }

      // Cross-asset prices are optional. The live production key returned
      // an 8-credits/minute limit, so no extra Twelve Data probe is launched
      // from a primary analysis. Missing DXY/NDX context stays explicit.
      const comparator = crossAssetComparator(args.instrumentType, symbol);
      let crossAsset: TechnicalData["crossAsset"] | undefined;
      if (comparator && comparator !== symbol.toUpperCase()) {
        crossAsset = {
          comparatorSymbol: comparator,
          timeframe: args.timeframe,
          available: false,
          unavailableReason:
            "Not fetched: provider credits are reserved for primary OHLCV and higher-timeframe market analysis; no proxy or synthetic series was substituted.",
        };
      }
      if (crossAsset) technical.crossAsset = crossAsset;

      return {
        success: true as const,
        data: {
          instrument: symbol,
          instrumentType: args.instrumentType,
          provider: marketProvider,
          fetchTimestamp: Date.now(),
          price: {
            price,
            timestamp: priceTimestamp,
            source: marketProvider,
            ...(bid !== undefined ? { bid } : {}),
            ...(ask !== undefined ? { ask } : {}),
          },
          candles,
          timeframe: args.timeframe,
          higherTimeframe: mtf.htfTimeframe,
          dataFreshness: hasLiveQuote ? "realtime" as const : "delayed" as const,
        },
        technical,
      };
    } catch (err: any) {
      return {
        success: false as const,
        error: `Market data fetch failed: ${err?.message ?? "unknown error"}`,
        errorCode: "API_UNAVAILABLE" as const,
      };
    }
  },
});

/**
 * Phase 4 — live FX rate snapshots for quote→account position sizing.
 * Fetches BOTH the direct pair (FROM/TO) and the inverse pair (TO/FROM).
 * Either may fail independently; the pure resolver in lib/risk/fx.ts
 * decides which usable snapshot to apply. No rates are ever invented here.
 */
export const fetchFxRate = action({
  args: { from: v.string(), to: v.string() },
  handler: async (_ctx, args) => {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return { success: false as const, error: "TWELVE_DATA_API_KEY missing" };
    }
    const from = args.from.toUpperCase();
    const to = args.to.toUpperCase();
    if (from === to) return { success: false as const, error: "same currency — no conversion needed" };
    let requestBudgetError: string | undefined;

    const fetchPair = async (
      pair: string,
    ): Promise<{ rate: number; timestamp: number; source: string; pair: string } | null> => {
      try {
        reserveTwelveDataCall("optional");
        const res = await fetch(
          `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(pair)}&apikey=${apiKey}`,
          { signal: AbortSignal.timeout(4_000) },
        ).then((r) => r.json());
        if (!res || res.code || res.close === undefined) return null;
        const rate = parseFloat(res.close);
        if (!Number.isFinite(rate) || rate <= 0) return null;
        return { rate, timestamp: Date.now(), source: "twelve-data", pair };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("REQUEST_BUDGET:")) {
          requestBudgetError = err.message.replace(/^REQUEST_BUDGET:\\s*/, "");
        }
        return null;
      }
    };

    // Parallel — a failing leg never blocks or corrupts the other.
    const [direct, inverse] = await Promise.all([
      fetchPair(`${from}/${to}`),
      fetchPair(`${to}/${from}`),
    ]);

    if (!direct && !inverse) {
      return {
        success: false as const,
        error: requestBudgetError
          ? `FX quote request skipped to protect the market-analysis quota: ${requestBudgetError}`
          : `no FX quote available for ${from}/${to} from the provider`,
      };
    }
    return { success: true as const, direct, inverse };
  },
});

