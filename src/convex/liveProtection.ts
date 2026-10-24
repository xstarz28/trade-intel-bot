/**
 * Phase 75 — Live Protection Market Data
 *
 * Convex server-side action that fetches REAL market data from free/available
 * providers and normalizes it into ProviderQuoteData for the protection pipeline.
 *
 * Crypto quotes: CoinGecko (Demo API key when configured), with public Binance Spot fallback for exact USDT pairs.
 * TwelveData free tier: limited forex (EUR/USD with demo key if configured)
 *
 * NO FABRICATION. NO FAKE DATA. REAL HTTP REQUESTS ONLY.
 * NO AUTO-EXECUTION. INFORMATIONAL PROTECTION ONLY.
 */
"use node";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}


import { action } from "./_generated/server";
import { v } from "convex/values";
import { normalizeTwelveDataQuotePayload, normalizeYahooFinanceQuotePayload } from "./provider-quote-validation";

// ═══════════════════════════════════════════════════════════════
// COINGECKO — AUTHENTICATED WHEN CONFIGURED, RATE-LIMIT-AWARE FALLBACK
// ═══════════════════════════════════════════════════════════════

/** CoinGecko coin ID mapping from common trading symbols */
const COINGECKO_IDS: Record<string, string> = {
  "BTC/USDT": "bitcoin",
  "BTC/USD": "bitcoin",
  "ETH/USDT": "ethereum",
  "ETH/USD": "ethereum",
  "SOL/USDT": "solana",
  "SOL/USD": "solana",
  "DOGE/USDT": "dogecoin",
  "DOGE/USD": "dogecoin",
  "BNB/USDT": "binancecoin",
  "XRP/USDT": "ripple",
  "ADA/USDT": "cardano",
  "AVAX/USDT": "avalanche-2",
  "DOT/USDT": "polkadot",
  "LINK/USDT": "chainlink",
  "MATIC/USDT": "matic-network",
  "UNI/USDT": "uniswap",
};

type CryptoPriceResult = {
  instrument: string;
  coinId: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  marketCap?: number;
  timestamp: number;
  success: boolean;
  provider: "CoinGecko" | "BinanceSpot";
  error?: string;
};

const COINGECKO_CACHE_TTL_MS = 15_000;
const COINGECKO_BACKOFF_DEFAULT_MS = 30_000;
const coingeckoPriceCache = new Map<string, CryptoPriceResult>();
let coingeckoRateLimitedUntil = 0;

function failedCryptoResult(
  instrument: string,
  coinId: string,
  error: string,
  provider: CryptoPriceResult["provider"] = "CoinGecko",
): CryptoPriceResult {
  return {
    instrument, coinId, price: 0, timestamp: Date.now(), success: false, provider, error,
  };
}

/** Public exchange fallback for exact USDT spot pairs; never invents USD/USDT equivalence. */
async function fetchBinanceSpotFallback(
  instruments: Array<{ instrument: string; coinId: string }>,
): Promise<Map<string, CryptoPriceResult>> {
  const eligible = instruments.filter(({ instrument }) => instrument.endsWith("/USDT"));
  if (eligible.length === 0) return new Map();

  const symbolToInstrument = new Map<string, { instrument: string; coinId: string }>(
    eligible.map(({ instrument, coinId }) => [
      instrument.replace("/", ""),
      { instrument, coinId },
    ] as const),
  );
  const symbols = [...symbolToInstrument.keys()];
  try {
    const url = "https://api.binance.com/api/v3/ticker/price?symbols=" +
      encodeURIComponent(JSON.stringify(symbols));
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return new Map();
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return new Map();

    const results = new Map<string, CryptoPriceResult>();
    const timestamp = Date.now();
    for (const item of payload) {
      if (!isRecord(item) || typeof item.symbol !== "string") continue;
      const mapped = symbolToInstrument.get(item.symbol);
      const price = typeof item.price === "string" ? Number(item.price) : item.price;
      if (!mapped || typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
      const result: CryptoPriceResult = {
        instrument: mapped.instrument,
        coinId: mapped.coinId,
        price,
        timestamp,
        success: true,
        provider: "BinanceSpot",
      };
      results.set(mapped.instrument, result);
      coingeckoPriceCache.set(mapped.instrument, result);
    }
    return results;
  } catch {
    return new Map();
  }
}

const coingeckoInflightRequests = new Map<string, Promise<CryptoPriceResult[]>>();

/** Coalesce concurrent identical batches so a burst of protection polls shares one provider request. */
async function fetchCoingeckoPrices(instruments: string[]): Promise<CryptoPriceResult[]> {
  const batchKey = [...new Set(instruments.map((instrument) => instrument.toUpperCase().trim()))]
    .sort()
    .join("|");
  const existing = coingeckoInflightRequests.get(batchKey);
  if (existing) return (await existing).map((result) => ({ ...result }));

  const request = fetchCoingeckoPricesUnshared(instruments);
  coingeckoInflightRequests.set(batchKey, request);
  try {
    return (await request).map((result) => ({ ...result }));
  } finally {
    if (coingeckoInflightRequests.get(batchKey) === request) {
      coingeckoInflightRequests.delete(batchKey);
    }
  }
}

/** Fetch real crypto prices; authenticate when a CoinGecko Demo key is configured and fail over on rate limits. */
async function fetchCoingeckoPricesUnshared(
  instruments: string[],
): Promise<CryptoPriceResult[]> {
  const idMap = instruments.map((inst) => ({
    instrument: inst.toUpperCase().trim(),
    coinId: COINGECKO_IDS[inst.toUpperCase().trim()] ?? null,
  }));
  const validCoins = idMap.filter(
    (coin): coin is { instrument: string; coinId: string } => coin.coinId !== null,
  );
  const unknownResults = idMap
    .filter((coin) => coin.coinId === null)
    .map((coin) => failedCryptoResult(
      coin.instrument, "unknown", `Unknown CoinGecko coin for ${coin.instrument}`,
    ));
  if (validCoins.length === 0) return unknownResults;

  const now = Date.now();
  const cached = validCoins.map((coin) => coingeckoPriceCache.get(coin.instrument));
  if (cached.every((result) => result && now - result.timestamp <= COINGECKO_CACHE_TTL_MS)) {
    return [...cached.filter((result): result is CryptoPriceResult => result !== undefined), ...unknownResults];
  }

  if (now < coingeckoRateLimitedUntil) {
    const fallback = await fetchBinanceSpotFallback(validCoins);
    const results = validCoins.map((coin) => fallback.get(coin.instrument) ??
      failedCryptoResult(
        coin.instrument, coin.coinId,
        `CoinGecko rate limited; retry after ${new Date(coingeckoRateLimitedUntil).toISOString()} and no valid Binance Spot fallback was available`,
      ));
    return [...results, ...unknownResults];
  }

  const coinIds = [...new Set(validCoins.map((coin) => coin.coinId))].join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinIds)}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true`;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const demoApiKey = process.env.COINGECKO_DEMO_API_KEY?.trim();
    if (demoApiKey) headers["x-cg-demo-api-key"] = demoApiKey;

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const retryDelay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1_000, 5 * 60_000)
        : COINGECKO_BACKOFF_DEFAULT_MS;
      coingeckoRateLimitedUntil = Date.now() + retryDelay;
      const fallback = await fetchBinanceSpotFallback(validCoins);
      const results = validCoins.map((coin) => fallback.get(coin.instrument) ??
        failedCryptoResult(
          coin.instrument, coin.coinId,
          `CoinGecko HTTP 429; provider backoff until ${new Date(coingeckoRateLimitedUntil).toISOString()}; Binance Spot fallback unavailable`,
        ));
      return [...results, ...unknownResults];
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 120);
      const fallback = await fetchBinanceSpotFallback(validCoins);
      const results = validCoins.map((coin) => fallback.get(coin.instrument) ??
        failedCryptoResult(coin.instrument, coin.coinId, `CoinGecko HTTP ${response.status}: ${detail || "provider error"}`));
      return [...results, ...unknownResults];
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return [...validCoins.map((coin) =>
        failedCryptoResult(coin.instrument, coin.coinId, "CoinGecko returned a malformed response")), ...unknownResults];
    }

    const fetchedAt = Date.now();
    const results = validCoins.map((coin): CryptoPriceResult => {
      const quote = payload[coin.coinId];
      if (!isRecord(quote) || typeof quote.usd !== "number" ||
          !Number.isFinite(quote.usd) || quote.usd <= 0) {
        return failedCryptoResult(coin.instrument, coin.coinId, `No valid price data for ${coin.coinId}`);
      }
      const result: CryptoPriceResult = {
        instrument: coin.instrument,
        coinId: coin.coinId,
        price: quote.usd,
        ...(typeof quote.usd_24h_change === "number" && Number.isFinite(quote.usd_24h_change)
          ? { change24h: quote.usd_24h_change } : {}),
        ...(typeof quote.usd_24h_vol === "number" && Number.isFinite(quote.usd_24h_vol)
          ? { volume24h: quote.usd_24h_vol } : {}),
        ...(typeof quote.usd_market_cap === "number" && Number.isFinite(quote.usd_market_cap)
          ? { marketCap: quote.usd_market_cap } : {}),
        timestamp: fetchedAt,
        success: true,
        provider: "CoinGecko",
      };
      coingeckoPriceCache.set(coin.instrument, result);
      return result;
    });
    return [...results, ...unknownResults];
  } catch (error: unknown) {
    const fallback = await fetchBinanceSpotFallback(validCoins);
    const results = validCoins.map((coin) => fallback.get(coin.instrument) ??
      failedCryptoResult(coin.instrument, coin.coinId, `CoinGecko request failed: ${errorMessage(error)}; Binance Spot fallback unavailable`));
    return [...results, ...unknownResults];
  }
}

// ═══════════════════════════════════════════════════════════════
// TWELVEDATA — FREE TIER (needs demo key at minimum)
// ═══════════════════════════════════════════════════════════════

/** Fetch a single forex/commodity quote from TwelveData with rate-limit retry */
async function fetchTwelveDataQuote(
  symbol: string,
  apiKey: string,
  retries = 2,
): Promise<{
  instrument: string;
  price: number;
  bid?: number;
  ask?: number;
  timestamp: number;
  success: boolean;
  error?: string;
}> {
  const failure = (error: string) => ({
    instrument: symbol,
    price: 0,
    timestamp: Date.now(),
    success: false as const,
    error,
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const json: unknown = await res.json();

      if (res.status === 429 || (isRecord(json) && Number(json.code) === 429)) {
        // Rate limited — back off and retry
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
      }

      if (!res.ok) {
        return failure(`TwelveData HTTP ${res.status}`);
      }

      const normalized = normalizeTwelveDataQuotePayload(json);
      if (!normalized.success) {
        return failure(normalized.error);
      }

      return {
        instrument: symbol,
        price: normalized.price,
        ...(normalized.bid !== undefined ? { bid: normalized.bid } : {}),
        ...(normalized.ask !== undefined ? { ask: normalized.ask } : {}),
        timestamp: normalized.timestamp,
        success: true,
      };
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      // Avoid returning raw fetch errors, which can contain the credentialed URL.
      return failure("TwelveData request failed");
    }
  }
  // Unreachable but satisfies TS
  return failure("Unexpected retry exhaustion");
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED LIVE QUOTE ACTION
// ═══════════════════════════════════════════════════════════════

export interface LiveQuoteResult {
  instrument: string;
  assetClass: string;
  price: number;
  bid?: number;
  ask?: number;
  change24h?: number;
  volume24h?: number;
  timestamp: number;
  /** The provider that actually returned data. */
  provider: string;
  /** The provider that routing preferred (may differ from actual). */
  primaryProvider: string;
  /** Whether fallback was used. */
  fallbackUsed: boolean;
  /** Reason for fallback if used. */
  fallbackReason?: string;
  sourceMode: "LIVE" | "SIMULATED" | "STALE" | "UNAVAILABLE";
  success: boolean;
  error?: string;
}

/** Yahoo Finance — free, no key needed — for VIX and other macro instruments */
async function fetchYahooFinanceQuote(
  symbol: string,
): Promise<{
  instrument: string;
  price: number;
  timestamp: number;
  success: boolean;
  error?: string;
}> {
  try {
    // Yahoo Finance symbol mapping
    const yahooMap: Record<string, string> = {
      "VIX": "^VIX",
      "DXY": "DX-Y.NYB",
      "US10Y": "^TNX",
      "US2Y": "^IRX",
      "US500": "^GSPC",
      "US30": "^DJI",
      "US100": "^IXIC",
      "WTI": "CL=F",
      "CL": "CL=F",
    };
    const yahooSymbol = yahooMap[symbol.toUpperCase().trim()] ?? symbol;

    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!res.ok) {
      return {
        instrument: symbol,
        price: 0,
        timestamp: Date.now(),
        success: false,
        error: `Yahoo Finance HTTP ${res.status}`,
      };
    }

    const data: unknown = await res.json();
    const normalized = normalizeYahooFinanceQuotePayload(data);
    if (!normalized.success) {
      return {
        instrument: symbol,
        price: 0,
        timestamp: Date.now(),
        success: false,
        error: normalized.error,
      };
    }

    return {
      instrument: symbol,
      price: normalized.price,
      timestamp: normalized.timestamp,
      success: true,
    };
  } catch (err: unknown) {
    return {
      instrument: symbol,
      price: 0,
      timestamp: Date.now(),
      success: false,
      error: `Yahoo Finance request failed: ${errorMessage(err)}`,
    };
  }
}

/** Detect asset class from instrument symbol */
function detectAssetClass(instrument: string): string {
  const s = instrument.toUpperCase().trim();
  if (s.endsWith("/USDT") || s.endsWith("/BTC") || s.endsWith("/ETH")) return "crypto";
  if (/^(BTC|ETH|SOL|DOGE|BNB|XRP|ADA|AVAX|DOT|LINK|MATIC|UNI)[/-]/.test(s)) return "crypto";
  if (/^(XAU|XAG|WTI|BRENT|GOLD|SILVER)/.test(s)) return "commodity";
  if (/^(DXY|VIX|US\d+Y|WTI|CL$)/.test(s)) return "macro";
  if (s.includes("/") && s.split("/").every((p) => /^[A-Z]{3}$/.test(p))) return "forex";
  return "crypto"; // default
}

/**
 * Phase 75 — fetch live protection quote.
 * Routes to CoinGecko for crypto (free, no key).
 * Routes to TwelveData for forex/commodity (needs key).
 * Returns normalized LiveQuoteResult for the protection pipeline.
 */
export const fetchLiveProtectionQuote = action({
  args: {
    instruments: v.array(v.string()),
  },
  handler: async (_ctx, args): Promise<LiveQuoteResult[]> => {
    const results: LiveQuoteResult[] = [];
    const now = Date.now();

    // Classify instruments by asset class
    const cryptoInstruments: string[] = [];
    const forexInstruments: string[] = [];
    const commodityInstruments: string[] = [];

    for (const inst of args.instruments) {
      const cls = detectAssetClass(inst);
      if (cls === "crypto") cryptoInstruments.push(inst);
      else if (cls === "forex") forexInstruments.push(inst);
      else if (cls === "commodity") commodityInstruments.push(inst);
      else if (cls === "macro") { /* handled separately below */ }
      else forexInstruments.push(inst); // unknown → try forex
    }

    // ── CoinGecko batch (crypto, free, no key) ──
    if (cryptoInstruments.length > 0) {
      const coingeckoResults = await fetchCoingeckoPrices(cryptoInstruments);
      for (const r of coingeckoResults) {
        // The route registry prefers OKX, but this action currently queries CoinGecko
        // and uses Binance Spot only when CoinGecko fails or is rate-limited.
        results.push({
          instrument: r.instrument,
          assetClass: "crypto",
          price: r.price,
          ...(r.change24h !== undefined ? { change24h: r.change24h } : {}),
          ...(r.volume24h !== undefined ? { volume24h: r.volume24h } : {}),
          timestamp: r.timestamp,
          provider: r.provider,
          primaryProvider: "OKX",
          fallbackUsed: true,
          fallbackReason: r.provider === "BinanceSpot"
            ? "OKX quote route is not called by this action; CoinGecko failed or was rate-limited, so Binance public spot fallback was used"
            : "OKX quote route is not called by this action; CoinGecko supplied the quote",
          sourceMode: r.success ? "LIVE" : "UNAVAILABLE",
          success: r.success,
          error: r.error,
        });
      }
    }

    // ── Yahoo Finance (macro, free, no key) ──
    const macroInstruments: string[] = [];
    for (const inst of args.instruments) {
      const cls = detectAssetClass(inst);
      if (cls === "macro") macroInstruments.push(inst);
    }

    if (macroInstruments.length > 0) {
      for (const inst of macroInstruments) {
        const r = await fetchYahooFinanceQuote(inst);
        results.push({
          instrument: r.instrument,
          assetClass: "macro",
          price: r.price,
          timestamp: r.timestamp,
          provider: "YahooFinance",
          primaryProvider: "YahooFinance",
          fallbackUsed: false,
          sourceMode: r.success ? "LIVE" : "UNAVAILABLE",
          success: r.success,
          error: r.error,
        });
      }
    }

    // ── TwelveData (forex/commodity, needs API key) ──
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    const tdInstruments = [...forexInstruments, ...commodityInstruments];

    if (tdInstruments.length > 0) {
      if (apiKey) {
        // Fetch sequentially with deliberate stagger to respect rate limits.
        // Free tier allows ~8 requests/min. With 6 instruments,
        // we space requests 1.5s apart to stay within budget.
        const TWELVEDATA_STAGGER_MS = 1_500;
        for (let i = 0; i < tdInstruments.length; i++) {
          const inst = tdInstruments[i];
          if (i > 0) {
            await new Promise((r) => setTimeout(r, TWELVEDATA_STAGGER_MS));
          }
          const r = await fetchTwelveDataQuote(inst, apiKey);
          results.push({
            instrument: r.instrument,
            assetClass: detectAssetClass(inst),
            price: r.price,
            ...(r.bid !== undefined ? { bid: r.bid } : {}),
            ...(r.ask !== undefined ? { ask: r.ask } : {}),
            timestamp: r.timestamp,
            provider: "TwelveData",
            primaryProvider: "TwelveData",
            fallbackUsed: false,
            sourceMode: r.success ? "LIVE" : "UNAVAILABLE",
            success: r.success,
            error: r.error,
          });
        }
      } else {
        // No key — report as unavailable, never fabricate
        for (const inst of tdInstruments) {
          results.push({
            instrument: inst,
            assetClass: detectAssetClass(inst),
            price: 0,
            timestamp: now,
            provider: "TwelveData",
            primaryProvider: "TwelveData",
            fallbackUsed: false,
            sourceMode: "UNAVAILABLE",
            success: false,
            error: "TWELVE_DATA_API_KEY not configured — add it in Keys/API keys tab",
          });
        }
      }
    }

    return results;
  },
});

// ═══════════════════════════════════════════════════════════════
// OHLCV CANDLE FETCHING (TwelveData)
// ═══════════════════════════════════════════════════════════════

interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OHLCVResult {
  instrument: string;
  timeframe: string;
  candles: OHLCVCandle[];
  sourceMode: "LIVE" | "UNAVAILABLE";
  provider: string;
  success: boolean;
  error?: string;
}

/** TwelveData symbol for OHLCV (TwelveData uses different symbols for crypto) */
function tdOHLCVSymbol(instrument: string): string {
  // TwelveData uses BTC/USD not BTC/USDT for crypto OHLCV
  const map: Record<string, string> = {
    "BTC/USDT": "BTC/USD",
    "ETH/USDT": "ETH/USD",
    "SOL/USDT": "SOL/USD",
    "DOGE/USDT": "DOGE/USD",
    "EUR/USD": "EUR/USD",
    "GBP/USD": "GBP/USD",
    "USD/JPY": "USD/JPY",
    "AUD/USD": "AUD/USD",
    "USD/CAD": "USD/CAD",
    "XAU/USD": "XAU/USD",
  };
  return map[instrument] ?? instrument;
}

/** Map our timeframe to TwelveData interval */
function tdTimeframe(tf: string): string {
  const map: Record<string, string> = {
    M5: "5min",
    M15: "15min",
    H1: "1h",
    H4: "4h",
    D1: "1day",
  };
  return map[tf] ?? "15min";
}

async function fetchTwelveDataOHLCV(
  instrument: string,
  timeframe: string,
  apiKey: string,
  outputsize = 50,
): Promise<OHLCVResult> {
  try {
    const symbol = tdOHLCVSymbol(instrument);
    const interval = tdTimeframe(timeframe);
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (res.status === 429) {
      return {
        instrument,
        timeframe,
        candles: [],
        sourceMode: "UNAVAILABLE",
        provider: "TwelveData",
        success: false,
        error: "Rate limited (429)",
      };
    }

    if (!res.ok) {
      return {
        instrument,
        timeframe,
        candles: [],
        sourceMode: "UNAVAILABLE",
        provider: "TwelveData",
        success: false,
        error: `HTTP ${res.status}`,
      };
    }

    const payload: unknown = await res.json();
    const data = isRecord(payload) ? payload : null;

    if (!data || data.status === "error" || !Array.isArray(data.values)) {
      return {
        instrument,
        timeframe,
        candles: [],
        sourceMode: "UNAVAILABLE",
        provider: "TwelveData",
        success: false,
        error: typeof data?.message === "string" ? data.message : "No data",
      };
    }

    const candles: OHLCVCandle[] = [];
    for (const v of data.values.filter(isRecord)) {
      const open = Number.parseFloat(String(v.open ?? ""));
      const high = Number.parseFloat(String(v.high ?? ""));
      const low = Number.parseFloat(String(v.low ?? ""));
      const close = Number.parseFloat(String(v.close ?? ""));
      const volume = Number.parseFloat(String(v.volume ?? "0"));

      // Validate candle
      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
      if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;

      candles.push({
        timestamp: new Date(String(v.datetime ?? "")).getTime(),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      });
    }

    // Sort ascending by timestamp
    candles.sort((a, b) => a.timestamp - b.timestamp);

    return {
      instrument,
      timeframe,
      candles,
      sourceMode: candles.length > 0 ? "LIVE" : "UNAVAILABLE",
      provider: "TwelveData",
      success: candles.length > 0,
    };
  } catch (err: unknown) {
    return {
      instrument,
      timeframe,
      candles: [],
      sourceMode: "UNAVAILABLE",
      provider: "TwelveData",
      success: false,
      error: errorMessage(err) || "Fetch failed",
    };
  }
}

/**
 * Fetch OHLCV candles for multiple instruments and timeframes.
 * Respects TwelveData rate limits with staggered sequential fetching.
 */
export const fetchOHLCVCandles = action({
  args: {
    instruments: v.array(v.string()),
    timeframes: v.array(v.string()),
    outputsize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<OHLCVResult[]> => {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return args.instruments.map((inst) => ({
        instrument: inst,
        timeframe: args.timeframes[0] ?? "M15",
        candles: [],
        sourceMode: "UNAVAILABLE" as const,
        provider: "TwelveData",
        success: false,
        error: "TWELVE_DATA_API_KEY not configured",
      }));
    }

    const results: OHLCVResult[] = [];
    const outputsize = args.outputsize ?? 50;

    // Fetch sequentially with stagger to respect rate limits
    for (const inst of args.instruments) {
      for (const tf of args.timeframes) {
        // Small delay between requests
        await new Promise((r) => setTimeout(r, 1_200));
        const result = await fetchTwelveDataOHLCV(inst, tf, apiKey, outputsize);
        results.push(result);
      }
    }

    return results;
  },
});
