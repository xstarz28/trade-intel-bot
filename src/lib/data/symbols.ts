/**
 * Symbol normalization: converts user-facing instrument strings into
 * provider-specific API symbols and vice-versa.
 */

/** Detect asset class from the instrument string. */
export function detectAssetClass(instrument: string): string {
  const sym = instrument.toUpperCase().trim();

  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(sym)) return "forex";

  const cryptoPrefixes = [
    "BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "DOT", "MATIC",
    "LINK", "UNI", "ATOM", "LTC", "BCH", "FIL", "APT", "ARB", "OP",
    "SUI", "NEAR", "AAVE", "MKR", "SNX", "CRV",
  ];
  const base = sym.replace(/\/USD(T)?$/, "").replace(/[- ]/g, "");
  if (cryptoPrefixes.includes(base)) return "crypto";

  if (/^XAU|^XAG|^XPD|^XPT/.test(sym)) return "commodity";

  if (/^[A-Z]{1,5}$/.test(sym)) return "stock";

  if (sym.includes("/")) return "forex";

  return "stock";
}

/** Normalize user input to a standard instrument string. */
export function normalizeInstrument(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-]/g, "/");
}

/** Convert a normalized instrument string to a Twelve Data API symbol. */
export function toProviderSymbol(instrument: string, instrumentType: string): string {
  const sym = instrument.toUpperCase().trim();
  switch (instrumentType) {
    case "crypto": return sym;
    case "forex": return sym;
    case "stock": return sym.replace(/\//g, "");
    case "commodity": return sym;
    case "indices": return sym.replace(/\//g, "");
    default: return sym;
  }
}

/** Convert a normalized instrument string to CoinGecko API ID. */
export function toCoinGeckoId(instrument: string): string | null {
  const map: Record<string, string> = {
    "BTC/USD": "bitcoin", "ETH/USD": "ethereum", "SOL/USD": "solana",
    "XRP/USD": "ripple", "DOGE/USD": "dogecoin", "ADA/USD": "cardano",
    "AVAX/USD": "avalanche-2", "DOT/USD": "polkadot", "LINK/USD": "chainlink",
    "UNI/USD": "uniswap", "MATIC/USD": "matic-network", "ATOM/USD": "cosmos",
    "LTC/USD": "litecoin", "FIL/USD": "filecoin",
  };
  return map[instrument.toUpperCase()] ?? null;
}

/** Get a human-readable label for an instrument. */
export function getInstrumentLabel(instrument: string): string {
  const labels: Record<string, string> = {
    "EUR/USD": "Euro / US Dollar", "GBP/USD": "British Pound / US Dollar",
    "USD/JPY": "US Dollar / Japanese Yen", "BTC/USD": "Bitcoin",
    "ETH/USD": "Ethereum", "SOL/USD": "Solana", "XAU/USD": "Gold",
    "AAPL": "Apple Inc.",
  };
  return labels[instrument.toUpperCase()] ?? instrument.toUpperCase();
}
