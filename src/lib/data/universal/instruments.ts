/**
 * Phase 44 — Universal Instrument Registry
 *
 * Canonical instrument identity for all supported asset classes.
 *
 * CRITICAL RULES:
 *   - Never silently substitute one instrument for another.
 *   - If no mapping exists → return null / undefined.
 *   - Mapping is deterministic and auditable.
 *   - Instrument identity survives the entire pipeline.
 */

import type {
  AssetClass,
  CanonicalInstrument,
  Exchange,
  InstrumentSubType,
  ProviderSymbolMapping,
  Region,
} from "./types";

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT REGISTRY
// ═══════════════════════════════════════════════════════════════

const INSTRUMENTS: Record<string, CanonicalInstrument> = {
  // ── Crypto ───────────────────────────────────────────────
  "BTC/USD": {
    canonical: "BTC/USD",
    displaySymbol: "BTC/USD",
    name: "Bitcoin",
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: "BTC",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["binance", "okx", "coinbase", "cme_crypto"],
    providerMappings: [
      { provider: "twelve-data", symbol: "BTC/USD", available: true },
      { provider: "coingecko", symbol: "bitcoin", available: true },
      { provider: "coinglass", symbol: "BTC", available: true },
      { provider: "defillama", symbol: "bitcoin", available: true },
      { provider: "tokenomist", symbol: "BTC", available: true },
    ],
    isActive: true,
    tags: ["layer1", "store-of-value"],
  },
  "ETH/USD": {
    canonical: "ETH/USD",
    displaySymbol: "ETH/USD",
    name: "Ethereum",
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: "ETH",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["binance", "okx", "coinbase", "cme_crypto"],
    providerMappings: [
      { provider: "twelve-data", symbol: "ETH/USD", available: true },
      { provider: "coingecko", symbol: "ethereum", available: true },
      { provider: "coinglass", symbol: "ETH", available: true },
      { provider: "defillama", symbol: "ethereum", available: true },
      { provider: "tokenomist", symbol: "ETH", available: true },
    ],
    isActive: true,
    tags: ["layer1", "smart-contract"],
  },
  "SOL/USD": {
    canonical: "SOL/USD",
    displaySymbol: "SOL/USD",
    name: "Solana",
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: "SOL",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["binance", "okx", "coinbase"],
    providerMappings: [
      { provider: "twelve-data", symbol: "SOL/USD", available: true },
      { provider: "coingecko", symbol: "solana", available: true },
      { provider: "coinglass", symbol: "SOL", available: true },
      { provider: "defillama", symbol: "solana", available: true },
      { provider: "tokenomist", symbol: "SOL", available: true },
    ],
    isActive: true,
    tags: ["layer1", "smart-contract"],
  },
  "DOGE/USD": {
    canonical: "DOGE/USD",
    displaySymbol: "DOGE/USD",
    name: "Dogecoin",
    assetClass: "crypto",
    subType: "crypto_spot",
    baseAsset: "DOGE",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["binance", "okx", "coinbase"],
    providerMappings: [
      { provider: "twelve-data", symbol: "DOGE/USD", available: true },
      { provider: "coingecko", symbol: "dogecoin", available: true },
      { provider: "coinglass", symbol: "DOGE", available: true },
      { provider: "tokenomist", symbol: "DOGE", available: true },
    ],
    isActive: true,
    tags: ["meme"],
  },

  // ── Forex ────────────────────────────────────────────────
  "EUR/USD": {
    canonical: "EUR/USD",
    displaySymbol: "EUR/USD",
    name: "Euro / US Dollar",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "EUR",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "EUR/USD", available: true },
      { provider: "alpha-vantage", symbol: "EURUSD", available: true },
    ],
    isActive: true,
    tags: ["major", "g10"],
  },
  "GBP/USD": {
    canonical: "GBP/USD",
    displaySymbol: "GBP/USD",
    name: "British Pound / US Dollar",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "GBP",
    quoteAsset: "USD",
    region: "UK",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "GBP/USD", available: true },
      { provider: "alpha-vantage", symbol: "GBPUSD", available: true },
    ],
    isActive: true,
    tags: ["major", "g10"],
  },
  "USD/JPY": {
    canonical: "USD/JPY",
    displaySymbol: "USD/JPY",
    name: "US Dollar / Japanese Yen",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "USD",
    quoteAsset: "JPY",
    region: "Japan",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "USD/JPY", available: true },
      { provider: "alpha-vantage", symbol: "USDJPY", available: true },
    ],
    isActive: true,
    tags: ["major", "g10"],
  },
  "AUD/USD": {
    canonical: "AUD/USD",
    displaySymbol: "AUD/USD",
    name: "Australian Dollar / US Dollar",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "AUD",
    quoteAsset: "USD",
    region: "Australia",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "AUD/USD", available: true },
      { provider: "alpha-vantage", symbol: "AUDUSD", available: true },
    ],
    isActive: true,
    tags: ["major", "g10", "commodity_currency"],
  },
  "USD/CAD": {
    canonical: "USD/CAD",
    displaySymbol: "USD/CAD",
    name: "US Dollar / Canadian Dollar",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "USD",
    quoteAsset: "CAD",
    region: "Global",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "USD/CAD", available: true },
      { provider: "alpha-vantage", symbol: "USDCAD", available: true },
    ],
    isActive: true,
    tags: ["major", "g10", "commodity_currency"],
  },
  "USD/CHF": {
    canonical: "USD/CHF",
    displaySymbol: "USD/CHF",
    name: "US Dollar / Swiss Franc",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "USD",
    quoteAsset: "CHF",
    region: "Europe",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "USD/CHF", available: true },
      { provider: "alpha-vantage", symbol: "USDCHF", available: true },
    ],
    isActive: true,
    tags: ["major", "g10", "safe_haven"],
  },
  "NZD/USD": {
    canonical: "NZD/USD",
    displaySymbol: "NZD/USD",
    name: "New Zealand Dollar / US Dollar",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "NZD",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "NZD/USD", available: true },
      { provider: "alpha-vantage", symbol: "NZDUSD", available: true },
    ],
    isActive: true,
    tags: ["major", "g10"],
  },
  "USD/IDR": {
    canonical: "USD/IDR",
    displaySymbol: "USD/IDR",
    name: "US Dollar / Indonesian Rupiah",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "USD",
    quoteAsset: "IDR",
    region: "Indonesia",
    exchanges: ["fx_spot"],
    providerMappings: [
      { provider: "twelve-data", symbol: "USD/IDR", available: true },
      { provider: "alpha-vantage", symbol: "USDIDR", available: true },
    ],
    isActive: true,
    tags: ["exotic", "emerging_market"],
  },

  // ── Commodity ────────────────────────────────────────────
  "XAU/USD": {
    canonical: "XAU/USD",
    displaySymbol: "XAU/USD",
    name: "Gold",
    assetClass: "commodity",
    subType: "commodity_spot",
    baseAsset: "Gold",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["COMEX"],
    providerMappings: [
      { provider: "twelve-data", symbol: "XAU/USD", available: true },
    ],
    isActive: true,
    tags: ["precious_metal", "safe_haven"],
  },
  "XAG/USD": {
    canonical: "XAG/USD",
    displaySymbol: "XAG/USD",
    name: "Silver",
    assetClass: "commodity",
    subType: "commodity_spot",
    baseAsset: "Silver",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["COMEX"],
    providerMappings: [
      { provider: "twelve-data", symbol: "XAG/USD", available: true },
    ],
    isActive: true,
    tags: ["precious_metal", "industrial_metal"],
  },
  "WTI": {
    canonical: "WTI",
    displaySymbol: "WTI Crude",
    name: "WTI Crude Oil",
    assetClass: "commodity",
    subType: "commodity_futures",
    baseAsset: "Crude Oil",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["NYMEX"],
    providerMappings: [
      { provider: "twelve-data", symbol: "WTI", available: true },
      { provider: "eia", symbol: "WTI", available: true },
    ],
    isActive: true,
    tags: ["energy", "futures"],
  },
  "BRENT": {
    canonical: "BRENT",
    displaySymbol: "Brent Crude",
    name: "Brent Crude Oil",
    assetClass: "commodity",
    subType: "commodity_futures",
    baseAsset: "Brent Crude",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["ICE"],
    providerMappings: [
      { provider: "twelve-data", symbol: "BRENT", available: true },
    ],
    isActive: true,
    tags: ["energy", "futures"],
  },
  "NGAS": {
    canonical: "NGAS",
    displaySymbol: "Natural Gas",
    name: "Natural Gas",
    assetClass: "commodity",
    subType: "commodity_futures",
    baseAsset: "Natural Gas",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["NYMEX"],
    providerMappings: [
      { provider: "twelve-data", symbol: "NGAS", available: true },
    ],
    isActive: true,
    tags: ["energy", "futures"],
  },
  "COPPER": {
    canonical: "COPPER",
    displaySymbol: "Copper",
    name: "Copper",
    assetClass: "commodity",
    subType: "commodity_futures",
    baseAsset: "Copper",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["COMEX"],
    providerMappings: [
      { provider: "twelve-data", symbol: "COPPER", available: true },
    ],
    isActive: true,
    tags: ["industrial_metal", "futures"],
  },

  // ── Equities ─────────────────────────────────────────────
  // US Equities
  AAPL: {
    canonical: "AAPL",
    displaySymbol: "AAPL",
    name: "Apple Inc.",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "AAPL",
    quoteAsset: "USD",
    region: "US",
    primaryExchange: "NASDAQ",
    exchanges: ["NASDAQ"],
    sector: "Technology",
    industry: "Consumer Electronics",
    countryCode: "US",
    providerMappings: [
      { provider: "twelve-data", symbol: "AAPL", available: true },
      { provider: "alpha-vantage", symbol: "AAPL", available: true },
    ],
    isActive: true,
    tags: ["large_cap", "tech"],
  },
  NVDA: {
    canonical: "NVDA",
    displaySymbol: "NVDA",
    name: "NVIDIA Corporation",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "NVDA",
    quoteAsset: "USD",
    region: "US",
    primaryExchange: "NASDAQ",
    exchanges: ["NASDAQ"],
    sector: "Technology",
    industry: "Semiconductors",
    countryCode: "US",
    providerMappings: [
      { provider: "twelve-data", symbol: "NVDA", available: true },
      { provider: "alpha-vantage", symbol: "NVDA", available: true },
    ],
    isActive: true,
    tags: ["large_cap", "tech", "ai"],
  },
  TSLA: {
    canonical: "TSLA",
    displaySymbol: "TSLA",
    name: "Tesla Inc.",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "TSLA",
    quoteAsset: "USD",
    region: "US",
    primaryExchange: "NASDAQ",
    exchanges: ["NASDAQ"],
    sector: "Consumer Discretionary",
    industry: "Automobile Manufacturers",
    countryCode: "US",
    providerMappings: [
      { provider: "twelve-data", symbol: "TSLA", available: true },
      { provider: "alpha-vantage", symbol: "TSLA", available: true },
    ],
    isActive: true,
    tags: ["large_cap", "ev", "tech"],
  },
  MSFT: {
    canonical: "MSFT",
    displaySymbol: "MSFT",
    name: "Microsoft Corporation",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "MSFT",
    quoteAsset: "USD",
    region: "US",
    primaryExchange: "NASDAQ",
    exchanges: ["NASDAQ"],
    sector: "Technology",
    industry: "Software",
    countryCode: "US",
    providerMappings: [
      { provider: "twelve-data", symbol: "MSFT", available: true },
      { provider: "alpha-vantage", symbol: "MSFT", available: true },
    ],
    isActive: true,
    tags: ["large_cap", "tech"],
  },
  AMZN: {
    canonical: "AMZN",
    displaySymbol: "AMZN",
    name: "Amazon.com Inc.",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "AMZN",
    quoteAsset: "USD",
    region: "US",
    primaryExchange: "NASDAQ",
    exchanges: ["NASDAQ"],
    sector: "Consumer Discretionary",
    industry: "Internet Retail",
    countryCode: "US",
    providerMappings: [
      { provider: "twelve-data", symbol: "AMZN", available: true },
      { provider: "alpha-vantage", symbol: "AMZN", available: true },
    ],
    isActive: true,
    tags: ["large_cap", "tech", "e-commerce"],
  },
  // Indonesia / IDX Equities
  BBCA: {
    canonical: "BBCA",
    displaySymbol: "BBCA",
    name: "Bank Central Asia",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "BBCA",
    quoteAsset: "IDR",
    region: "Indonesia",
    primaryExchange: "IDX",
    exchanges: ["IDX"],
    sector: "Financials",
    industry: "Banking",
    countryCode: "ID",
    providerMappings: [
      { provider: "twelve-data", symbol: "BBCA.JK", available: true },
    ],
    isActive: true,
    tags: ["idx", "banking", "large_cap"],
  },
  BBRI: {
    canonical: "BBRI",
    displaySymbol: "BBRI",
    name: "Bank Rakyat Indonesia",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "BBRI",
    quoteAsset: "IDR",
    region: "Indonesia",
    primaryExchange: "IDX",
    exchanges: ["IDX"],
    sector: "Financials",
    industry: "Banking",
    countryCode: "ID",
    providerMappings: [
      { provider: "twelve-data", symbol: "BBRI.JK", available: true },
    ],
    isActive: true,
    tags: ["idx", "banking", "large_cap"],
  },
  TLKM: {
    canonical: "TLKM",
    displaySymbol: "TLKM",
    name: "Telkom Indonesia",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "TLKM",
    quoteAsset: "IDR",
    region: "Indonesia",
    primaryExchange: "IDX",
    exchanges: ["IDX"],
    sector: "Communication Services",
    industry: "Telecom",
    countryCode: "ID",
    providerMappings: [
      { provider: "twelve-data", symbol: "TLKM.JK", available: true },
    ],
    isActive: true,
    tags: ["idx", "telecom", "large_cap"],
  },
  GOTO: {
    canonical: "GOTO",
    displaySymbol: "GOTO",
    name: "GoTo Gojek Tokopedia",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "GOTO",
    quoteAsset: "IDR",
    region: "Indonesia",
    primaryExchange: "IDX",
    exchanges: ["IDX"],
    sector: "Technology",
    industry: "Internet Services",
    countryCode: "ID",
    providerMappings: [
      { provider: "twelve-data", symbol: "GOTO.JK", available: true },
    ],
    isActive: true,
    tags: ["idx", "tech", "internet"],
  },
  BMRI: {
    canonical: "BMRI",
    displaySymbol: "BMRI",
    name: "Bank Mandiri",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "BMRI",
    quoteAsset: "IDR",
    region: "Indonesia",
    primaryExchange: "IDX",
    exchanges: ["IDX"],
    sector: "Financials",
    industry: "Banking",
    countryCode: "ID",
    providerMappings: [
      { provider: "twelve-data", symbol: "BMRI.JK", available: true },
    ],
    isActive: true,
    tags: ["idx", "banking", "large_cap"],
  },
  BBNI: {
    canonical: "BBNI",
    displaySymbol: "BBNI",
    name: "Bank Negara Indonesia",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "BBNI",
    quoteAsset: "IDR",
    region: "Indonesia",
    primaryExchange: "IDX",
    exchanges: ["IDX"],
    sector: "Financials",
    industry: "Banking",
    countryCode: "ID",
    providerMappings: [
      { provider: "twelve-data", symbol: "BBNI.JK", available: true },
    ],
    isActive: true,
    tags: ["idx", "banking", "large_cap"],
  },

  // ── Indices ──────────────────────────────────────────────
  "SPX": {
    canonical: "SPX",
    displaySymbol: "S&P 500",
    name: "S&P 500",
    assetClass: "indices",
    subType: "index_cash",
    baseAsset: "SPX",
    quoteAsset: "USD",
    region: "US",
    exchanges: ["CME"],
    providerMappings: [
      { provider: "twelve-data", symbol: "SPX", available: true },
    ],
    isActive: true,
    tags: ["us_index", "benchmark"],
  },
  "NDX": {
    canonical: "NDX",
    displaySymbol: "Nasdaq 100",
    name: "Nasdaq 100",
    assetClass: "indices",
    subType: "index_cash",
    baseAsset: "NDX",
    quoteAsset: "USD",
    region: "US",
    exchanges: ["NASDAQ"],
    providerMappings: [
      { provider: "twelve-data", symbol: "NDX", available: true },
    ],
    isActive: true,
    tags: ["us_index", "tech_index"],
  },
  "DJI": {
    canonical: "DJI",
    displaySymbol: "Dow Jones",
    name: "Dow Jones Industrial Average",
    assetClass: "indices",
    subType: "index_cash",
    baseAsset: "DJI",
    quoteAsset: "USD",
    region: "US",
    exchanges: ["NYSE"],
    providerMappings: [
      { provider: "twelve-data", symbol: "DJI", available: true },
    ],
    isActive: true,
    tags: ["us_index", "industrial"],
  },
  "IHSG": {
    canonical: "IHSG",
    displaySymbol: "IHSG / JCI",
    name: "Jakarta Composite Index",
    assetClass: "indices",
    subType: "index_cash",
    baseAsset: "IHSG",
    quoteAsset: "IDR",
    region: "Indonesia",
    exchanges: ["IDX"],
    providerMappings: [
      { provider: "twelve-data", symbol: "IHSG", available: true },
    ],
    isActive: true,
    tags: ["idx_index", "indonesia_benchmark"],
  },

  // ── Macro / Cross-Asset ──────────────────────────────────
  DXY: {
    canonical: "DXY",
    displaySymbol: "DXY",
    name: "US Dollar Index",
    assetClass: "macro",
    subType: "macro_index",
    baseAsset: "DXY",
    quoteAsset: "USD",
    region: "Global",
    exchanges: ["ICE"],
    providerMappings: [
      { provider: "twelve-data", symbol: "DXY", available: true },
    ],
    isActive: true,
    tags: ["dollar_index", "macro"],
  },
};

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Look up canonical instrument by identifier.
 * Returns undefined if not found — NEVER fabricates.
 */
export function resolveInstrument(instrument: string): CanonicalInstrument | undefined {
  return INSTRUMENTS[instrument.toUpperCase().trim()];
}

/**
 * Get all instruments for a given asset class.
 */
export function getInstrumentsByAssetClass(assetClass: AssetClass): CanonicalInstrument[] {
  return Object.values(INSTRUMENTS).filter((i) => i.assetClass === assetClass);
}

/**
 * Get all registered instruments.
 */
export function getAllInstruments(): CanonicalInstrument[] {
  return Object.values(INSTRUMENTS);
}

/**
 * Get provider-specific symbol for a given instrument.
 * Returns null if no mapping exists — NEVER fabricates.
 */
export function getProviderSymbol(instrument: string, provider: string): string | null {
  const canonical = INSTRUMENTS[instrument.toUpperCase().trim()];
  if (!canonical) return null;
  const mapping = canonical.providerMappings.find(
    (m) => m.provider === provider && m.available,
  );
  return mapping?.symbol ?? null;
}

/**
 * Get all exchanges for a given instrument.
 */
export function getInstrumentExchanges(instrument: string): Exchange[] {
  const canonical = INSTRUMENTS[instrument.toUpperCase().trim()];
  return canonical?.exchanges ?? [];
}

/**
 * Detect asset class from a raw instrument string.
 * Uses the instrument registry when possible, falls back to heuristic detection.
 * NEVER fabricates — returns "unknown" if uncertain.
 */
export function detectAssetClass(instrument: string): AssetClass | "unknown" {
  const canonical = INSTRUMENTS[instrument.toUpperCase().trim()];
  if (canonical) return canonical.assetClass;

  // Fallback heuristics for unregistered instruments
  const sym = instrument.toUpperCase().trim();
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(sym)) {
    // Check crypto before forex
    const cryptoPrefixes = [
      "BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "DOT", "MATIC",
      "LINK", "UNI", "ATOM", "LTC", "BCH", "FIL", "APT", "ARB", "OP",
      "SUI", "NEAR", "AAVE", "MKR", "SNX", "CRV",
    ];
    const base = sym.split("/")[0];
    if (cryptoPrefixes.includes(base)) return "crypto";
    if (/^XAU|^XAG|^XPD|^XPT/.test(base)) return "commodity";
    return "forex";
  }
  if (/^[A-Z]{1,5}$/.test(sym)) return "equity";
  return "unknown";
}

/**
 * Check if an instrument is a crypto instrument.
 */
export function isCryptoInstrument(instrument: string): boolean {
  return detectAssetClass(instrument) === "crypto";
}

/**
 * Get all instrument canonical identifiers.
 */
export function getAllInstrumentIds(): string[] {
  return Object.keys(INSTRUMENTS);
}
