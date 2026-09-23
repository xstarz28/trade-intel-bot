/**
 * Normalized crypto derivatives data types.
 * Provider-agnostic: any derivatives data source maps into these types.
 */

/** Open Interest snapshot. */
export interface OpenInterestData {
  current: number;
  /** 1h change percentage if available */
  change1h?: number;
  /** 4h change percentage if available */
  change4h?: number;
  /** 24h change percentage if available */
  change24h?: number;
  /** Exchange breakdown if available */
  exchanges?: Array<{
    name: string;
    openInterest: number;
  }>;
}

/** Funding rate data. */
export interface FundingRateData {
  /** Current funding rate (e.g. 0.0001 = 0.01%) */
  currentRate: number;
  /** Annualized equivalent */
  annualizedRate?: number;
  /** OI-weighted average if available */
  weightedRate?: number;
  /** Exchange-level rates if available */
  exchanges?: Array<{
    name: string;
    rate: number;
  }>;
}

/** Long/short positioning data. */
export interface LongShortData {
  /** Global long/short account ratio (>1 = more longs) */
  accountRatio?: number;
  /** Top trader long/short ratio if available */
  topTraderRatio?: number;
  /** Taker buy/sell volume ratio */
  takerRatio?: number;
}

/** Liquidation data. */
export interface LiquidationData {
  /** Total liquidation volume in USD over recent window */
  totalVolume?: number;
  /** Long liquidation volume */
  longVolume?: number;
  /** Short liquidation volume */
  shortVolume?: number;
  /** Dominant side of liquidations */
  dominantSide?: "longs" | "shorts" | "balanced";
  /** Time window description */
  window?: string;
}

/** Combined derivatives intelligence for a crypto instrument. */
export interface CryptoDerivativesData {
  provider: string;
  symbol: string;
  timestamp: number;
  freshness: "realtime" | "delayed" | "stale" | "unavailable";

  openInterest?: OpenInterestData;
  fundingRate?: FundingRateData;
  longShort?: LongShortData;
  liquidations?: LiquidationData;

  /** Which datasets are actually available */
  availability: {
    openInterest: boolean;
    fundingRate: boolean;
    longShort: boolean;
    liquidations: boolean;
  };

  /** Overall confidence based on data completeness */
  confidence: "high" | "medium" | "low" | "unavailable";

  /** Derivatives-based interpretation summary */
  interpretation?: string;

  error?: string;
}

/** Result wrapper for the Convex action. */
export interface DerivativesResult {
  success: boolean;
  data?: CryptoDerivativesData;
  error?: string;
  errorCode?: "API_UNAVAILABLE" | "RATE_LIMIT" | "AUTH_ERROR" | "UNSUPPORTED_ASSET" | "NO_DATA";
  /**
   * Phase 178d — how this result was obtained, reported by the provider
   * cache. Diagnostics only; never a substitute for the payload's own
   * observation timestamp.
   */
  acquisition?: "observed-now" | "observed-shared" | "cache-reused";
  /** Phase 178d — original provider observation time, preserved across hits. */
  observedAt?: number;
}
