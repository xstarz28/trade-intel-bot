/**
 * Phase 51 — Multi-Asset Instrument Universe
 *
 * Defines the complete instrument universe across all asset classes.
 * Extensible without modifying the radar engine.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { UniverseEntry } from "./types";

// ═══════════════════════════════════════════════════════════════
// DEFAULT UNIVERSE
// ═══════════════════════════════════════════════════════════════

const REFRESH = {
  CRITICAL: 60_000,        // 1 min — scalping
  HIGH: 5 * 60_000,        // 5 min — intraday
  MODERATE: 30 * 60_000,   // 30 min — swing
  LOW: 4 * 60 * 60_000,    // 4 hours — investing
};

export const DEFAULT_UNIVERSE: UniverseEntry[] = [
  // ── Crypto ──
  { instrument: "BTC/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote", "derivatives"], priority: 1, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "ETH/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote", "derivatives"], priority: 2, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "SOL/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 3, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "DOGE/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 4, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "XRP/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 5, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "ADA/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 6, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "AVAX/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 7, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "LINK/USD", assetClass: "crypto", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 8, refreshIntervalMs: REFRESH.MODERATE },

  // ── Forex — Majors ──
  { instrument: "EUR/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 10, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "GBP/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 11, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "USD/JPY", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 12, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "AUD/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 13, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "USD/CAD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 14, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "USD/CHF", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 15, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "NZD/USD", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 16, refreshIntervalMs: REFRESH.MODERATE },

  // ── Forex — Exotic ──
  { instrument: "USD/IDR", assetClass: "forex", region: "asia", requiredCapabilities: ["ohlcv", "quote"], priority: 20, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "USD/SGD", assetClass: "forex", region: "asia", requiredCapabilities: ["ohlcv", "quote"], priority: 21, refreshIntervalMs: REFRESH.LOW },
  { instrument: "USD/MXN", assetClass: "forex", region: "latam", requiredCapabilities: ["ohlcv", "quote"], priority: 22, refreshIntervalMs: REFRESH.LOW },
  { instrument: "EUR/GBP", assetClass: "forex", region: "europe", requiredCapabilities: ["ohlcv", "quote"], priority: 23, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "EUR/JPY", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 24, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "GBP/JPY", assetClass: "forex", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 25, refreshIntervalMs: REFRESH.MODERATE },

  // ── US Equities ──
  { instrument: "AAPL", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 30, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "MSFT", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 31, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "NVDA", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 32, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "TSLA", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 33, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "AMZN", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 34, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "GOOGL", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 35, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "META", assetClass: "equity", region: "us", requiredCapabilities: ["ohlcv", "quote", "fundamentals"], priority: 36, refreshIntervalMs: REFRESH.MODERATE },

  // ── IDX Equities (Indonesia) ──
  { instrument: "BBCA", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 40, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "BBRI", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 41, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "TLKM", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 42, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "BMRI", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 43, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "BBNI", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 44, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "GOTO", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 45, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "ASII", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 46, refreshIntervalMs: REFRESH.LOW },
  { instrument: "UNVR", assetClass: "equity", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 47, refreshIntervalMs: REFRESH.LOW },

  // ── Commodities ──
  { instrument: "XAU/USD", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 50, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "XAG/USD", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 51, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "WTI", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote", "eia", "cot"], priority: 52, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "BRENT", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote", "cot"], priority: 53, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "NGAS", assetClass: "commodity", region: "us", requiredCapabilities: ["ohlcv", "quote", "eia"], priority: 54, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "COPPER", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 55, refreshIntervalMs: REFRESH.LOW },
  { instrument: "PLAT", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 56, refreshIntervalMs: REFRESH.LOW },
  { instrument: "PALL", assetClass: "commodity", region: "global", requiredCapabilities: ["ohlcv", "quote"], priority: 57, refreshIntervalMs: REFRESH.LOW },

  // ── Indices ──
  { instrument: "SPX", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv", "quote"], priority: 60, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "NDX", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv", "quote"], priority: 61, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "DJI", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv", "quote"], priority: 62, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "RUT", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv", "quote"], priority: 63, refreshIntervalMs: REFRESH.LOW },
  { instrument: "VIX", assetClass: "indices", region: "us", requiredCapabilities: ["ohlcv", "quote"], priority: 64, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "IHSG", assetClass: "indices", region: "idx", requiredCapabilities: ["ohlcv", "quote"], priority: 70, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "NIFTY50", assetClass: "indices", region: "asia", requiredCapabilities: ["ohlcv", "quote"], priority: 71, refreshIntervalMs: REFRESH.LOW },
  { instrument: "NIKKEI", assetClass: "indices", region: "asia", requiredCapabilities: ["ohlcv", "quote"], priority: 72, refreshIntervalMs: REFRESH.LOW },
  { instrument: "DAX", assetClass: "indices", region: "europe", requiredCapabilities: ["ohlcv", "quote"], priority: 73, refreshIntervalMs: REFRESH.LOW },
  { instrument: "FTSE", assetClass: "indices", region: "europe", requiredCapabilities: ["ohlcv", "quote"], priority: 74, refreshIntervalMs: REFRESH.LOW },

  // ── Macro ──
  { instrument: "DXY", assetClass: "macro", region: "global", requiredCapabilities: ["quote"], priority: 80, refreshIntervalMs: REFRESH.HIGH },
  { instrument: "US10Y", assetClass: "macro", region: "us", requiredCapabilities: ["quote", "treasury"], priority: 81, refreshIntervalMs: REFRESH.MODERATE },
  { instrument: "US2Y", assetClass: "macro", region: "us", requiredCapabilities: ["quote", "treasury"], priority: 82, refreshIntervalMs: REFRESH.MODERATE },
];

// ═══════════════════════════════════════════════════════════════
// CORRELATION CLUSTERS
// ═══════════════════════════════════════════════════════════════

export interface CorrelationClusterDef {
  id: string;
  instruments: string[];
  relationship: string;
  maxDisplay: number;
}

export const CORRELATION_CLUSTERS: CorrelationClusterDef[] = [
  { id: "btc-eth", instruments: ["BTC/USD", "ETH/USD"], relationship: "highly correlated crypto L1s", maxDisplay: 2 },
  { id: "crypto-l2", instruments: ["SOL/USD", "AVAX/USD", "ADA/USD"], relationship: "alt-L1 crypto cluster", maxDisplay: 2 },
  { id: "dxy-eurusd", instruments: ["DXY", "EUR/USD"], relationship: "inverse dollar/EUR", maxDisplay: 2 },
  { id: "oil", instruments: ["WTI", "BRENT"], relationship: "highly correlated crude grades", maxDisplay: 1 },
  { id: "precious", instruments: ["XAU/USD", "XAG/USD", "PLAT", "PALL"], relationship: "precious metals cluster", maxDisplay: 2 },
  { id: "us-index", instruments: ["SPX", "NDX", "DJI"], relationship: "US large-cap indices", maxDisplay: 2 },
  { id: "idx-bank", instruments: ["BBCA", "BBRI", "BMRI", "BBNI"], relationship: "Indonesian banking sector", maxDisplay: 2 },
  { id: "us-yields", instruments: ["US10Y", "US2Y"], relationship: "US yield curve", maxDisplay: 2 },
];

// ═══════════════════════════════════════════════════════════════
// UNIVERSE QUERIES
// ═══════════════════════════════════════════════════════════════

export function getUniverse(
  assetClasses?: AssetClass[],
  regions?: string[],
): UniverseEntry[] {
  let result = DEFAULT_UNIVERSE;
  if (assetClasses && assetClasses.length > 0) {
    result = result.filter(e => assetClasses.includes(e.assetClass));
  }
  if (regions && regions.length > 0) {
    result = result.filter(e => e.region && regions.includes(e.region));
  }
  return result;
}

export function getInstrumentEntry(instrument: string): UniverseEntry | undefined {
  return DEFAULT_UNIVERSE.find(e => e.instrument === instrument);
}

export function getClusterForInstrument(instrument: string) {
  return CORRELATION_CLUSTERS.find(c => c.instruments.includes(instrument));
}

export function getClusterInstruments(clusterId: string): string[] {
  const cluster = CORRELATION_CLUSTERS.find(c => c.id === clusterId);
  return cluster ? [...cluster.instruments] : [];
}
