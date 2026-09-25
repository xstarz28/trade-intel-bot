/**
 * Phase 41 — CRYPTO INTELLIGENCE & FUNDAMENTAL DATA ARCHITECTURE
 *
 * Normalized types for crypto-specific intelligence data.
 * Provider-agnostic: any crypto data source maps into these types.
 *
 * CRITICAL DESIGN:
 *   1. This module is INFORMATIONAL ONLY — it cannot modify
 *      bias, conviction, gates, trade plan, or recommendation.
 *   2. Provider availability NEVER becomes directional evidence.
 *   3. Missing data remains neutral — never bearish or bullish.
 *   4. No synthetic fundamentals, no fabricated values.
 *   5. Every evidence item has explicit source attribution.
 *   6. Dependency groups enable double-counting detection.
 */

// ── Evidence Model ──────────────────────────────────────────────

export type CryptoEvidenceCategory =
  | "DERIVATIVES"
  | "DEFI_FUNDAMENTAL"
  | "TOKENOMICS"
  | "ON_CHAIN"
  | "LIQUIDITY"
  | "SUPPLY_DYNAMICS";

export type CryptoEvidenceDirection =
  | "SUPPORTING"
  | "CONFLICTING"
  | "NEUTRAL"
  | "UNAVAILABLE";

export type CryptoEvidenceStrength =
  | "STRONG"
  | "MODERATE"
  | "WEAK"
  | "UNKNOWN";

export type CryptoEvidenceQuality =
  | "VERIFIED"
  | "DEGRADED"
  | "STALE"
  | "INSUFFICIENT"
  | "UNAVAILABLE";

export type CryptoDependencyGroup =
  | "DERIVATIVES_OI"
  | "DERIVATIVES_FUNDING"
  | "DERIVATIVES_LIQUIDATION"
  | "DERIVATIVES_POSITIONING"
  | "DEFI_TVL"
  | "DEFI_FEES_REVENUE"
  | "DEFI_STABLECOIN"
  | "DEFI_PROTOCOL"
  | "TOKENOMICS_SUPPLY"
  | "TOKENOMICS_UNLOCK"
  | "ON_CHAIN_ACTIVITY";

export interface CryptoEvidenceItem {
  /** Provider name (e.g. "CoinGlass", "DeFiLlama", "Tokenomist"). */
  source: string;
  /** High-level category. */
  category: CryptoEvidenceCategory;
  /** Direction relative to the current thesis. */
  direction: CryptoEvidenceDirection;
  /** Strength of the evidence signal. */
  strength: CryptoEvidenceStrength;
  /** Data quality assessment. */
  quality: CryptoEvidenceQuality;
  /** Freshness of the underlying data. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Dependency group for double-counting detection. */
  dependencyGroup: CryptoDependencyGroup;
  /** Human-readable explanation of what this evidence means. */
  explanation: string;
  /** Whether this provider is actually available for this instrument. */
  providerAvailable: boolean;
}

// ── Derivatives Context ─────────────────────────────────────────

export interface DerivativesIntelligence {
  /** Provider name. */
  provider: string;
  /** Observed timestamp. */
  observedAt: number;
  /** Data freshness classification. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Data quality assessment. */
  quality: "VERIFIED" | "DEGRADED" | "STALE" | "INSUFFICIENT" | "UNAVAILABLE";
  /** Whether this provider is available for this instrument. */
  available: boolean;
  /** Failure reason if unavailable. */
  failureReason?: string;

  // Open Interest
  openInterest?: {
    current: number;
    change1h?: number;
    change24h?: number;
    /** Whether OI data is reliable for this instrument. */
    reliable: boolean;
  };

  // Funding Rate
  fundingRate?: {
    currentRate: number;
    annualizedRate?: number;
    /** Whether funding is extreme (>0.01% or <-0.01%). */
    isExtreme: boolean;
    /** Whether funding data is reliable. */
    reliable: boolean;
  };

  // Liquidation Context
  liquidation?: {
    totalVolume?: number;
    longVolume?: number;
    shortVolume?: number;
    dominantSide?: "longs" | "shorts" | "balanced";
    /** Whether liquidation data is reliable. */
    reliable: boolean;
  };

  // Long/Short Positioning
  positioning?: {
    accountRatio?: number;
    topTraderRatio?: number;
    takerRatio?: number;
    /** Whether positioning data is reliable. */
    reliable: boolean;
  };

  /** Number of sub-datasets actually available. */
  availableDatasets: number;
  /** Total sub-datasets attempted. */
  totalDatasets: number;
}

// ── DeFi Fundamental Context ────────────────────────────────────

export interface DeFiIntelligence {
  /** Provider name (DeFiLlama). */
  provider: string;
  /** Observed timestamp. */
  observedAt: number;
  /** Data freshness classification. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Data quality assessment. */
  quality: "VERIFIED" | "DEGRADED" | "STALE" | "INSUFFICIENT" | "UNAVAILABLE";
  /** Whether this provider is available for this instrument. */
  available: boolean;
  /** Failure reason if unavailable. */
  failureReason?: string;

  // TVL
  tvl?: {
    current: number;
    /** TVL change over available period. */
    change7d?: number;
    change30d?: number;
    /** Whether TVL data is reliable. */
    reliable: boolean;
  };

  // Fees & Revenue
  fees?: {
    dailyFees?: number;
    /** Fee-derived estimate kept for the legacy display path. */
    dailyRevenue?: number;
    /** Phase 281 — provider-reported protocol revenue (24h), when supplied. */
    revenue24h?: number;
    /** Phase 281 — the provider's own fee change over its 7/30-day window (%). */
    feeChange7d?: number;
    feeChange30d?: number;
    /** Whether fee data is reliable. */
    reliable: boolean;
  };

  // Stablecoin Context
  stablecoins?: {
    /** Total stablecoin market cap relevant to this chain/protocol. */
    totalMcap?: number;
    /** Change in stablecoin supply. */
    supplyChange?: number;
    /** Whether stablecoin data is reliable. */
    reliable: boolean;
  };

  // Protocol Activity
  protocol?: {
    /** Daily active users if available. */
    dailyActiveUsers?: number;
    /** Daily transactions if available. */
    dailyTransactions?: number;
    /** Whether protocol data is reliable. */
    reliable: boolean;
  };

  /** Number of sub-datasets actually available. */
  availableDatasets: number;
  /** Total sub-datasets attempted. */
  totalDatasets: number;
}

// ── Tokenomics Context ──────────────────────────────────────────

export interface TokenomicsIntelligence {
  /** Provider name (Tokenomist). */
  provider: string;
  /** Observed timestamp. */
  observedAt: number;
  /** Data freshness classification. */
  freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
  /** Data quality assessment. */
  quality: "VERIFIED" | "DEGRADED" | "STALE" | "INSUFFICIENT" | "UNAVAILABLE";
  /** Whether this provider is available for this instrument. */
  available: boolean;
  /** Failure reason if unavailable. */
  failureReason?: string;

  // Supply
  supply?: {
    circulatingSupply?: number;
    totalSupply?: number;
    /** Circulating as percentage of total. */
    circulatingPercent?: number;
    /** Whether supply data is reliable. */
    reliable: boolean;
  };

  // Unlocks
  unlocks?: {
    /** Number of upcoming unlock events in next 30 days. */
    upcomingCount30d: number;
    /** Total tokens to be unlocked in next 30 days. */
    upcomingValue30d?: number;
    /** Unlock as percentage of circulating supply. */
    unlockPercentOfCirculating?: number;
    /** Whether unlock data is reliable. */
    reliable: boolean;
    /** Human-readable summary of upcoming unlocks. */
    summary?: string;
  };

  /** Number of sub-datasets actually available. */
  availableDatasets: number;
  /** Total sub-datasets attempted. */
  totalDatasets: number;
}

// ── Combined Crypto Intelligence Context ────────────────────────

export interface CryptoIntelligenceContext {
  /** Canonical instrument (e.g. "BTC/USD"). Never substituted. */
  instrument: string;
  /** Always "crypto" for this context. */
  instrumentType: "crypto";
  /** Overall timestamp of intelligence assembly. */
  assembledAt: number;

  // Sub-contexts
  derivatives?: DerivativesIntelligence;
  defi?: DeFiIntelligence;
  tokenomics?: TokenomicsIntelligence;

  // Evidence derived from all sub-contexts
  evidence: CryptoEvidenceItem[];

  // Overall quality assessment
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: "VERIFIED" | "DEGRADED" | "STALE" | "INSUFFICIENT" | "UNAVAILABLE";

  // Missing information
  missingInformation: string[];

  // Data flags
  dataFlags: string[];

  // Informational summary (for analyst display)
  analystSummary: string;
}

// ── Provider Adapter Interface ──────────────────────────────────

/**
 * Clean provider abstraction so future providers can be added
 * without modifying the decision engine.
 */
export interface CryptoIntelligenceProvider {
  /** Provider name. */
  readonly name: string;

  /**
   * Check if this provider supports the given instrument.
   * Returns false for non-crypto instruments.
   */
  supportsInstrument(instrument: string): boolean;

  /**
   * Fetch intelligence for the given instrument.
   * Returns null if the provider is unavailable or the instrument is unsupported.
   * Never throws — all errors are captured in the result.
   */
  fetch(instrument: string): Promise<CryptoIntelligenceProviderResult | null>;
}

export interface CryptoIntelligenceProviderResult {
  success: boolean;
  provider: string;
  observedAt: number;
  data?: unknown;
  error?: string;
  errorCode?: "API_UNAVAILABLE" | "RATE_LIMIT" | "AUTH_ERROR" | "UNSUPPORTED_ASSET" | "NO_DATA" | "NETWORK_ERROR";
}

// ── OnChain Analytics Provider Interface (Future) ───────────────

/**
 * Architectural anticipation for Dune / Bubblemaps.
 * NOT implemented in Phase 41 — interface only.
 */
export interface OnChainAnalyticsProvider {
  readonly name: string;
  supportsInstrument(instrument: string): boolean;
  fetch(instrument: string): Promise<OnChainAnalyticsResult | null>;
}

export interface OnChainAnalyticsResult {
  success: boolean;
  provider: string;
  observedAt: number;
  data?: unknown;
  error?: string;
}

/**
 * Architectural anticipation for wallet distribution providers.
 * NOT implemented in Phase 41 — interface only.
 */
export interface WalletDistributionProvider {
  readonly name: string;
  supportsInstrument(instrument: string): boolean;
  fetch(instrument: string): Promise<WalletDistributionResult | null>;
}

export interface WalletDistributionResult {
  success: boolean;
  provider: string;
  observedAt: number;
  data?: unknown;
  error?: string;
}
