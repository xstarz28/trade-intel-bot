/**
 * Phase 41 — Crypto Intelligence Symbol Mapping
 *
 * Maps canonical instrument strings (e.g. "BTC/USD") to
 * provider-specific identifiers for CoinGlass, DeFiLlama, and Tokenomist.
 *
 * NON-NEGOTIABLE:
 *   - Never silently substitute instruments.
 *   - If no mapping exists → explicitly return null.
 *   - Mapping must be deterministic and auditable.
 */

// ── CoinGlass Mapping ──────────────────────────────────────────

const COINGLASS_MAP: Record<string, string> = {
  "BTC/USD": "BTC",
  "ETH/USD": "ETH",
  "SOL/USD": "SOL",
  "DOGE/USD": "DOGE",
  "XRP/USD": "XRP",
  "ADA/USD": "ADA",
  "AVAX/USD": "AVAX",
  "DOT/USD": "DOT",
  "LINK/USD": "LINK",
  "MATIC/USD": "MATIC",
  "UNI/USD": "UNI",
  "ATOM/USD": "ATOM",
  "LTC/USD": "LTC",
  "FIL/USD": "FIL",
  "APT/USD": "APT",
  "ARB/USD": "ARB",
  "OP/USD": "OP",
  "SUI/USD": "SUI",
  "NEAR/USD": "NEAR",
  "AAVE/USD": "AAVE",
};

/**
 * Map canonical instrument to CoinGlass symbol.
 * Returns null if no mapping exists (e.g. forex, stocks, commodities).
 */
export function toCoinGlassSymbol(instrument: string): string | null {
  return COINGLASS_MAP[instrument.toUpperCase()] ?? null;
}

// ── DeFiLlama Mapping ──────────────────────────────────────────

interface DefiLlamaMapping {
  /** DeFiLlama slug for the chain or protocol. */
  slug: string;
  /** Whether this is a chain-level or protocol-level query. */
  level: "chain" | "protocol";
}

const DEFILLAMA_MAP: Record<string, DefiLlamaMapping> = {
  "BTC/USD": { slug: "bitcoin", level: "chain" },
  "ETH/USD": { slug: "ethereum", level: "chain" },
  "SOL/USD": { slug: "solana", level: "chain" },
  "AVAX/USD": { slug: "avalanche", level: "chain" },
  "DOT/USD": { slug: "polkadot", level: "chain" },
  "MATIC/USD": { slug: "polygon", level: "chain" },
  "ARB/USD": { slug: "arbitrum", level: "chain" },
  "OP/USD": { slug: "optimism", level: "chain" },
  "APT/USD": { slug: "aptos", level: "chain" },
  "SUI/USD": { slug: "sui", level: "chain" },
  "NEAR/USD": { slug: "near", level: "chain" },
  "ATOM/USD": { slug: "cosmos", level: "chain" },
};

/**
 * Map canonical instrument to DeFiLlama identifier.
 * Returns null if no mapping exists.
 */
export function toDefiLlamaId(instrument: string): DefiLlamaMapping | null {
  return DEFILLAMA_MAP[instrument.toUpperCase()] ?? null;
}

// ── Tokenomist Mapping ─────────────────────────────────────────

interface TokenomistMapping {
  /** Token symbol for Tokenomist API. */
  symbol: string;
}

const TOKENOMIST_MAP: Record<string, TokenomistMapping> = {
  "BTC/USD": { symbol: "BTC" },
  "ETH/USD": { symbol: "ETH" },
  "SOL/USD": { symbol: "SOL" },
  "DOGE/USD": { symbol: "DOGE" },
  "XRP/USD": { symbol: "XRP" },
  "ADA/USD": { symbol: "ADA" },
  "AVAX/USD": { symbol: "AVAX" },
  "DOT/USD": { symbol: "DOT" },
  "LINK/USD": { symbol: "LINK" },
  "MATIC/USD": { symbol: "MATIC" },
  "UNI/USD": { symbol: "UNI" },
  "ATOM/USD": { symbol: "ATOM" },
  "LTC/USD": { symbol: "LTC" },
  "FIL/USD": { symbol: "FIL" },
  "APT/USD": { symbol: "APT" },
  "ARB/USD": { symbol: "ARB" },
  "OP/USD": { symbol: "OP" },
  "SUI/USD": { symbol: "SUI" },
  "NEAR/USD": { symbol: "NEAR" },
  "AAVE/USD": { symbol: "AAVE" },
};

/**
 * Map canonical instrument to Tokenomist symbol.
 * Returns null if no mapping exists.
 */
export function toTokenomistSymbol(instrument: string): string | null {
  return TOKENOMIST_MAP[instrument.toUpperCase()]?.symbol ?? null;
}

// ── Phase 279 — base-asset resolution ───────────────────────────
//
// The live pipeline routes crypto instruments with their EXACT provider-native
// ids ("BTC-USDT" on OKX, "BTC/USDT" via ccxt). The base asset of such an id is
// the asset itself, not a substituted symbol — so it can be resolved from the
// id's own structure. Nothing here invents a mapping: DeFiLlama resolution
// reuses the VERIFIED table above, and the Tokenomist symbol IS the base asset.

/** Split a provider-native crypto id into its base asset ("BTC-USDT" → "BTC"). */
export function baseAssetOf(instrumentRaw: string): string | null {
  const sym = instrumentRaw.trim().toUpperCase();
  const match = /^([A-Z0-9]{2,10})\s*[\/\-]\s*([A-Z0-9]{2,10})$/.exec(sym);
  return match ? match[1] : null;
}

/**
 * DeFiLlama mapping for an instrument whose base asset is already known.
 * Uses the VERIFIED table only — a token with no verified chain entry returns
 * null (the caller reports TVL unavailable rather than guessing a slug).
 */
export function toDefiLlamaIdByBaseAsset(baseAssetRaw: string): DefiLlamaMapping | null {
  const base = baseAssetRaw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(base)) return null;
  return DEFILLAMA_MAP[`${base}/USD`] ?? null;
}

/** Tokenomist symbol for an instrument whose base asset is already known. */
export function toTokenomistSymbolByBaseAsset(baseAssetRaw: string): string | null {
  const base = baseAssetRaw.trim().toUpperCase();
  return /^[A-Z0-9]{2,10}$/.test(base) ? base : null;
}

// ── Instrument Applicability ────────────────────────────────────

/**
 * Check if crypto intelligence is applicable to the given instrument.
 * Returns false for forex, stocks, commodities, indices.
 */
export function isCryptoInstrument(instrument: string): boolean {
  const sym = instrument.toUpperCase().trim();
  return (
    COINGLASS_MAP.hasOwnProperty(sym) ||
    DEFILLAMA_MAP.hasOwnProperty(sym) ||
    TOKENOMIST_MAP.hasOwnProperty(sym)
  );
}

/**
 * Get all supported crypto instruments.
 */
export function getSupportedCryptoInstruments(): string[] {
  const all = new Set([
    ...Object.keys(COINGLASS_MAP),
    ...Object.keys(DEFILLAMA_MAP),
    ...Object.keys(TOKENOMIST_MAP),
  ]);
  return Array.from(all).sort();
}
