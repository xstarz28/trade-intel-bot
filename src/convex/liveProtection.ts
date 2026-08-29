/**
 * Phase 75 — Live Protection Market Data
 *
 * Convex server-side action that fetches REAL market data from free/available
 * providers and normalizes it into ProviderQuoteData for the protection pipeline.
 *
 * CoinGecko: free, no API key needed — crypto (BTC, ETH, SOL, DOGE, etc.)
 * TwelveData free tier: limited forex (EUR/USD with demo key if configured)
 *
 * NO FABRICATION. NO FAKE DATA. REAL HTTP REQUESTS ONLY.
 * NO AUTO-EXECUTION. INFORMATIONAL PROTECTION ONLY.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════
// COINGECKO — FREE, NO KEY NEEDED
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

/** Fetch real prices from CoinGecko — batch endpoint, no key needed */
async function fetchCoingeckoPrices(
  instruments: string[],
): Promise<
  Array<{
    instrument: string;
    coinId: string;
    price: number;
    change24h: number;
    volume24h: number;
    marketCap: number;
    timestamp: number;
    success: boolean;
    error?: string;
  }>
> {
  // Map instruments to CoinGecko IDs
  const idMap = instruments.map((inst) => ({
    instrument: inst.toUpperCase().trim(),
    coinId: COINGECKO_IDS[inst.toUpperCase().trim()] ?? null,
  }));

  // Filter to known coins
  const validCoins = idMap.filter((c) => c.coinId !== null);
  if (validCoins.length === 0) {
    return idMap.map((c) => ({
      instrument: c.instrument,
      coinId: c.coinId ?? "unknown",
      price: 0,
      change24h: 0,
      volume24h: 0,
      marketCap: 0,
      timestamp: Date.now(),
      success: false,
      error: `Unknown CoinGecko coin for ${c.instrument}`,
    }));
  }

  const coinIds = validCoins.map((c) => c.coinId!).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown");
      return validCoins.map((c) => ({
        instrument: c.instrument,
        coinId: c.coinId!,
        price: 0,
        change24h: 0,
        volume24h: 0,
        marketCap: 0,
        timestamp: Date.now(),
        success: false,
        error: `CoinGecko HTTP ${res.status}: ${errorText.slice(0, 100)}`,
      }));
    }

    const data = await res.json();
    const now = Date.now();

    return validCoins.map((c) => {
      const coinData = data[c.coinId!];
      if (!coinData || typeof coinData.usd !== "number") {
        return {
          instrument: c.instrument,
          coinId: c.coinId!,
          price: 0,
          change24h: 0,
          volume24h: 0,
          marketCap: 0,
          timestamp: now,
          success: false,
          error: `No price data for ${c.coinId}`,
        };
      }

      const price = coinData.usd;
      if (!Number.isFinite(price) || price <= 0) {
        return {
          instrument: c.instrument,
          coinId: c.coinId!,
          price: 0,
          change24h: 0,
          volume24h: 0,
          marketCap: 0,
          timestamp: now,
          success: false,
          error: `Invalid price for ${c.coinId}: ${price}`,
        };
      }

      return {
        instrument: c.instrument,
        coinId: c.coinId!,
        price,
        change24h: typeof coinData.usd_24h_change === "number" ? coinData.usd_24h_change : 0,
        volume24h: typeof coinData.usd_24h_vol === "number" ? coinData.usd_24h_vol : 0,
        marketCap: typeof coinData.usd_market_cap === "number" ? coinData.usd_market_cap : 0,
        timestamp: now,
        success: true,
      };
    });
  } catch (err: any) {
    return validCoins.map((c) => ({
      instrument: c.instrument,
      coinId: c.coinId!,
      price: 0,
      change24h: 0,
      volume24h: 0,
      marketCap: 0,
      timestamp: Date.now(),
      success: false,
      error: `CoinGecko request failed: ${err?.message ?? "unknown"}`,
    }));
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
  bid: number;
  ask: number;
  timestamp: number;
  success: boolean;
  error?: string;
}> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const json = await res.json();

      if (json.code === 429) {
        // Rate limited — back off and retry
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
      }

      if (json.code) {
        return {
          instrument: symbol,
          price: 0,
          bid: 0,
          ask: 0,
          timestamp: Date.now(),
          success: false,
          error: `TwelveData [${json.code}]: ${json.message ?? "provider error"}`,
        };
      }

      const price = parseFloat(json.close);
      if (!Number.isFinite(price) || price <= 0) {
        return {
          instrument: symbol,
          price: 0,
          bid: 0,
          ask: 0,
          timestamp: Date.now(),
          success: false,
          error: `Invalid price: ${json.close}`,
        };
      }

      return {
        instrument: symbol,
        price,
        bid: parseFloat(json.bid ?? "0") || price,
        ask: parseFloat(json.ask ?? "0") || price,
        timestamp: Date.now(),
        success: true,
      };
    } catch (err: any) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return {
        instrument: symbol,
        price: 0,
        bid: 0,
        ask: 0,
        timestamp: Date.now(),
        success: false,
        error: `TwelveData request failed: ${err?.message ?? "unknown"}`,
      };
    }
  }
  // Unreachable but satisfies TS
  return {
    instrument: symbol,
    price: 0,
    bid: 0,
    ask: 0,
    timestamp: Date.now(),
    success: false,
    error: "Unexpected retry exhaustion",
  };
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

/** Detect asset class from instrument symbol */
function detectAssetClass(instrument: string): string {
  const s = instrument.toUpperCase().trim();
  if (s.endsWith("/USDT") || s.endsWith("/BTC") || s.endsWith("/ETH")) return "crypto";
  if (/^(BTC|ETH|SOL|DOGE|BNB|XRP|ADA|AVAX|DOT|LINK|MATIC|UNI)[\/\-]/.test(s)) return "crypto";
  if (/^(XAU|XAG|WTI|BRENT|GOLD|SILVER)/.test(s)) return "commodity";
  if (/^(DXY|VIX|US\d+Y)/.test(s)) return "macro";
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
      else forexInstruments.push(inst); // fallback
    }

    // ── CoinGecko batch (crypto, free, no key) ──
    if (cryptoInstruments.length > 0) {
      const coingeckoResults = await fetchCoingeckoPrices(cryptoInstruments);
      for (const r of coingeckoResults) {
        // OKX is the preferred primary provider for crypto,
        // but CoinGecko is used as fallback (free, no key needed)
        results.push({
          instrument: r.instrument,
          assetClass: "crypto",
          price: r.price,
          change24h: r.change24h,
          volume24h: r.volume24h,
          timestamp: r.timestamp,
          provider: "CoinGecko",
          primaryProvider: "OKX",
          fallbackUsed: true,
          fallbackReason: "OKX API key not configured — CoinGecko used as free fallback",
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
        // Fetch sequentially to respect rate limits
        for (const inst of tdInstruments) {
          const r = await fetchTwelveDataQuote(inst, apiKey);
          results.push({
            instrument: r.instrument,
            assetClass: detectAssetClass(inst),
            price: r.price,
            bid: r.bid,
            ask: r.ask,
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
