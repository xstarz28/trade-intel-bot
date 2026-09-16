/**
 * Phase 79 — Universal Instrument Registry
 *
 * Maps all supported instruments to their asset class, primary/fallback providers,
 * display metadata, and trading characteristics. Deterministic — no side effects.
 */

export type AssetClass = "crypto" | "forex" | "commodity" | "macro";

export interface InstrumentInfo {
  /** Canonical instrument symbol. */
  symbol: string;
  /** Display name. */
  displayName: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** Primary provider. */
  primaryProvider: string;
  /** Fallback provider. */
  fallbackProvider: string;
  /** Number of decimal places for display. */
  displayDecimals: number;
  /** Typical daily volatility as percentage. */
  typicalVolatilityPct: number;
  /** Whether this is a 24/7 market. */
  alwaysOpen: boolean;
  /** Risk tier for alert thresholds. */
  riskTier: "STANDARD" | "HIGH" | "EXTREME";
}

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const INSTRUMENTS: Record<string, InstrumentInfo> = {
  // Crypto
  "BTC/USDT": {
    symbol: "BTC/USDT",
    displayName: "Bitcoin",
    assetClass: "crypto",
    primaryProvider: "OKX",
    fallbackProvider: "CoinGecko",
    displayDecimals: 2,
    typicalVolatilityPct: 3.0,
    alwaysOpen: true,
    riskTier: "STANDARD",
  },
  "ETH/USDT": {
    symbol: "ETH/USDT",
    displayName: "Ethereum",
    assetClass: "crypto",
    primaryProvider: "OKX",
    fallbackProvider: "CoinGecko",
    displayDecimals: 2,
    typicalVolatilityPct: 4.0,
    alwaysOpen: true,
    riskTier: "STANDARD",
  },
  "SOL/USDT": {
    symbol: "SOL/USDT",
    displayName: "Solana",
    assetClass: "crypto",
    primaryProvider: "OKX",
    fallbackProvider: "CoinGecko",
    displayDecimals: 2,
    typicalVolatilityPct: 6.0,
    alwaysOpen: true,
    riskTier: "HIGH",
  },
  "DOGE/USDT": {
    symbol: "DOGE/USDT",
    displayName: "Dogecoin",
    assetClass: "crypto",
    primaryProvider: "OKX",
    fallbackProvider: "CoinGecko",
    displayDecimals: 5,
    typicalVolatilityPct: 8.0,
    alwaysOpen: true,
    riskTier: "EXTREME",
  },

  // Forex
  "EUR/USD": {
    symbol: "EUR/USD",
    displayName: "Euro / US Dollar",
    assetClass: "forex",
    primaryProvider: "TwelveData",
    fallbackProvider: "TwelveData",
    displayDecimals: 5,
    typicalVolatilityPct: 0.5,
    alwaysOpen: false,
    riskTier: "STANDARD",
  },
  "GBP/USD": {
    symbol: "GBP/USD",
    displayName: "British Pound / US Dollar",
    assetClass: "forex",
    primaryProvider: "TwelveData",
    fallbackProvider: "TwelveData",
    displayDecimals: 5,
    typicalVolatilityPct: 0.6,
    alwaysOpen: false,
    riskTier: "STANDARD",
  },
  "USD/JPY": {
    symbol: "USD/JPY",
    displayName: "US Dollar / Japanese Yen",
    assetClass: "forex",
    primaryProvider: "TwelveData",
    fallbackProvider: "TwelveData",
    displayDecimals: 3,
    typicalVolatilityPct: 0.5,
    alwaysOpen: false,
    riskTier: "STANDARD",
  },
  "AUD/USD": {
    symbol: "AUD/USD",
    displayName: "Australian Dollar / US Dollar",
    assetClass: "forex",
    primaryProvider: "TwelveData",
    fallbackProvider: "TwelveData",
    displayDecimals: 5,
    typicalVolatilityPct: 0.6,
    alwaysOpen: false,
    riskTier: "STANDARD",
  },
  "USD/CAD": {
    symbol: "USD/CAD",
    displayName: "US Dollar / Canadian Dollar",
    assetClass: "forex",
    primaryProvider: "TwelveData",
    fallbackProvider: "TwelveData",
    displayDecimals: 5,
    typicalVolatilityPct: 0.4,
    alwaysOpen: false,
    riskTier: "STANDARD",
  },

  // Commodity
  "XAU/USD": {
    symbol: "XAU/USD",
    displayName: "Gold",
    assetClass: "commodity",
    primaryProvider: "TwelveData",
    fallbackProvider: "TwelveData",
    displayDecimals: 2,
    typicalVolatilityPct: 1.2,
    alwaysOpen: false,
    riskTier: "STANDARD",
  },

  // Macro
  "VIX": {
    symbol: "VIX",
    displayName: "CBOE Volatility Index",
    assetClass: "macro",
    primaryProvider: "YahooFinance",
    fallbackProvider: "YahooFinance",
    displayDecimals: 2,
    typicalVolatilityPct: 10.0,
    alwaysOpen: false,
    riskTier: "HIGH",
  },
};

// ═══════════════════════════════════════════════════════════════
// LOOKUP FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/** Get full instrument info. Returns undefined if unknown. */
export function getInstrumentInfo(symbol: string): InstrumentInfo | undefined {
  return INSTRUMENTS[symbol];
}

/** Get asset class for a symbol. Returns "crypto" as default for unknown. */
export function detectAssetClass(symbol: string): AssetClass {
  return INSTRUMENTS[symbol]?.assetClass ?? "crypto";
}

/** Check if a symbol is a supported instrument. */
export function isSupportedInstrument(symbol: string): boolean {
  return symbol in INSTRUMENTS;
}

/** Get all supported instrument symbols. */
export function getAllInstruments(): string[] {
  return Object.keys(INSTRUMENTS);
}

/** Get instruments by asset class. */
export function getInstrumentsByClass(assetClass: AssetClass): string[] {
  return Object.values(INSTRUMENTS)
    .filter((i) => i.assetClass === assetClass)
    .map((i) => i.symbol);
}

/** Format price for display based on instrument. */
/**
 * Marker rendered when a price is not a usable number.
 *
 * Matches the convention already used across the decision surfaces: an
 * explicit em dash means "no value", which is honest, rather than "NaN",
 * "∞" or a fabricated 0.00 that reads like a real price.
 */
export const PRICE_UNAVAILABLE = "—";

export function formatInstrumentPrice(
  symbol: string,
  price: number | null | undefined,
): string {
  // A non-finite or non-positive price is not evidence of a price. Rendering
  // NaN/Infinity leaks an internal failure into the UI, and rendering 0.00000
  // is worse: it looks like a real quote and can be read as a real level.
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return PRICE_UNAVAILABLE;
  }

  const info = INSTRUMENTS[symbol];
  if (info) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: info.displayDecimals,
      maximumFractionDigits: info.displayDecimals,
    });
  }
  // Default: auto-detect decimal places
  if (price < 1) return price.toFixed(5);
  if (price < 100) return price.toFixed(2);
  return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Get all instruments for a given set of symbols. */
export function resolveInstrumentRegistry(
  symbols: string[],
): InstrumentInfo[] {
  return symbols
    .map((s) => INSTRUMENTS[s])
    .filter((i): i is InstrumentInfo => i !== undefined);
}
