/**
 * Phase 44 — Universal Multi-Asset Intelligence Foundation
 *
 * Core type system for:
 *   1. Canonical instrument identity
 *   2. Provider capability model
 *   3. Provider routing
 *   4. Universal evidence standardization
 *   5. Asset-class intelligence contracts
 *   6. Dependency group / double-counting prevention
 *
 * CRITICAL DESIGN:
 *   - This module is INFORMATIONAL ONLY — it cannot modify bias, conviction,
 *     gates, trade plan, or recommendation.
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data remains missing — never fabricated.
 *   - Stale data remains stale — never presented as fresh.
 *   - One instrument cannot silently substitute another.
 *   - One provider cannot silently replace another provider's semantic role.
 */

// ═══════════════════════════════════════════════════════════════
// 1. UNIVERSAL INSTRUMENT IDENTITY
// ═══════════════════════════════════════════════════════════════

export type AssetClass =
  | "crypto"
  | "forex"
  | "equity"
  | "commodity"
  | "indices"
  | "macro";

export type InstrumentSubType =
  // Crypto
  | "crypto_spot"
  | "crypto_perpetual"
  | "crypto_futures"
  // Forex
  | "forex_spot"
  | "forex_cfd"
  | "forex_futures"
  // Equity
  | "equity_common"
  | "equity_preferred"
  | "equity_etf"
  // Commodity
  | "commodity_spot"
  | "commodity_futures"
  // Indices
  | "index_cash"
  | "index_futures"
  // Macro
  | "macro_yield"
  | "macro_rate"
  | "macro_index";

export type Region =
  | "US"
  | "Europe"
  | "UK"
  | "Japan"
  | "China"
  | "Indonesia"
  | "India"
  | "Australia"
  | "Korea"
  | "Brazil"
  | "Global"
  | "Unknown";

export type Exchange =
  // Crypto
  | "binance"
  | "okx"
  | "coinbase"
  | "bybit"
  | "cme_crypto"
  // Equity
  | "NYSE"
  | "NASDAQ"
  | "IDX"
  | "LSE"
  | "HKEX"
  | "TSE"
  | "SSE"
  | "NSE"
  | "ASX"
  // Commodity
  | "NYMEX"
  | "COMEX"
  | "CBOT"
  | "ICE"
  // Forex
  | "fx_spot"
  // Indices
  | "CME"
  | "EUREX";

export interface ProviderSymbolMapping {
  /** Provider name. */
  provider: string;
  /** Provider-specific symbol. */
  symbol: string;
  /** Whether this mapping is currently active / credentials available. */
  available: boolean;
}

export interface CanonicalInstrument {
  /** Canonical identifier, e.g. "BTC/USD", "AAPL", "EUR/USD", "XAU/USD". */
  canonical: string;
  /** Display symbol (may differ from canonical for readability). */
  displaySymbol: string;
  /** Human-readable name. */
  name: string;
  /** Primary asset class. */
  assetClass: AssetClass;
  /** Sub-type for finer classification. */
  subType: InstrumentSubType;
  /** Base asset (e.g. "BTC", "EUR", "AAPL", "Gold"). */
  baseAsset: string;
  /** Quote / currency (e.g. "USD", "IDR", "USDT"). */
  quoteAsset: string;
  /** Region where this instrument primarily trades. */
  region: Region;
  /** Primary exchange / venue when known. */
  primaryExchange?: Exchange;
  /** All known exchanges / venues. */
  exchanges: Exchange[];
  /** Sector for equities (e.g. "Technology", "Financials"). */
  sector?: string;
  /** Industry for equities (e.g. "Software", "Banking"). */
  industry?: string;
  /** Country for equities (ISO code). */
  countryCode?: string;
  /** Provider-specific symbol mappings. */
  providerMappings: ProviderSymbolMapping[];
  /** Whether this instrument is actively mapped to any provider. */
  isActive: boolean;
  /** Metadata tags for flexible classification. */
  tags: string[];
}

// ═══════════════════════════════════════════════════════════════
// 2. PROVIDER CAPABILITY MODEL
// ═══════════════════════════════════════════════════════════════

export type DataCapability =
  // Price / OHLCV
  | "ohlcv"
  | "quote"
  | "order_book"
  | "tick_data"
  // Derivatives
  | "open_interest"
  | "funding_rate"
  | "liquidations"
  | "long_short_positioning"
  | "options_data"
  // Fundamentals
  | "earnings"
  | "financial_statements"
  | "valuation"
  | "dividends"
  | "corporate_actions"
  | "analyst_estimates"
  // Macro
  | "macroeconomic_data"
  | "interest_rates"
  | "yield_curves"
  | "cot_positioning"
  | "economic_calendar"
  | "news"
  | "sentiment"
  // Commodity
  | "inventory"
  | "supply_demand"
  | "futures_structure"
  // DeFi / On-chain
  | "tvl"
  | "defi_fees"
  | "on_chain_analytics"
  | "tokenomics"
  // Cross-asset
  | "dxy"
  | "correlation"
  | "risk_regime";

export type CapabilityQuality =
  | "FULL"
  | "PARTIAL"
  | "DEGRADED"
  | "UNAVAILABLE";

export interface ProviderCapability {
  /** Data capability this provider supports. */
  capability: DataCapability;
  /** Quality level for this capability. */
  quality: CapabilityQuality;
  /** Asset classes this capability covers for this provider. */
  assetClasses: AssetClass[];
  /** Specific instruments covered (empty = not instrument-specific). */
  instruments?: string[];
  /** Max freshness in milliseconds (e.g. 60000 = 1 minute). */
  maxFreshnessMs?: number;
}

export interface ProviderProfile {
  /** Provider unique identifier. */
  id: string;
  /** Provider display name. */
  name: string;
  /** Capabilities this provider declares. */
  capabilities: ProviderCapability[];
  /** Authentication requirement. */
  authRequired: boolean;
  /** Whether credentials are currently configured. */
  credentialsAvailable: boolean;
  /** Rate limit: max requests per minute (if known). */
  rateLimitPerMinute?: number;
  /** Timeout in milliseconds for API calls. */
  timeoutMs: number;
  /** Retry configuration. */
  retryConfig: {
    maxRetries: number;
    backoffMs: number;
  };
  /** Asset classes this provider serves. */
  assetClasses: AssetClass[];
}

// ═══════════════════════════════════════════════════════════════
// 3. PROVIDER ROUTING
// ═══════════════════════════════════════════════════════════════

export interface ProviderRoute {
  /** Provider ID. */
  providerId: string;
  /** Provider name. */
  providerName: string;
  /** Capability to be served. */
  capability: DataCapability;
  /** Route quality assessment. */
  quality: CapabilityQuality;
  /** Whether this route's credentials are available. */
  credentialsAvailable: boolean;
  /** Estimated freshness. */
  maxFreshnessMs?: number;
}

export interface RouteResult {
  /** Instrument that was routed. */
  instrument: string;
  /** Asset class of the instrument. */
  assetClass: AssetClass;
  /** Requested capability. */
  capability: DataCapability;
  /** Available routes, sorted by quality descending. */
  routes: ProviderRoute[];
  /** Whether any route was found. */
  available: boolean;
  /** Reason if no route found. */
  unavailableReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// 4. UNIVERSAL EVIDENCE MODEL
// ═══════════════════════════════════════════════════════════════

export type EvidenceDirection =
  | "SUPPORTING"
  | "CONFLICTING"
  | "NEUTRAL"
  | "UNAVAILABLE";

export type EvidenceStrength =
  | "STRONG"
  | "MODERATE"
  | "WEAK"
  | "UNKNOWN";

export type EvidenceQuality =
  | "VERIFIED"
  | "DEGRADED"
  | "STALE"
  | "INSUFFICIENT"
  | "UNAVAILABLE";

export type FreshnessState =
  | "FRESH"
  | "DELAYED"
  | "STALE"
  | "UNAVAILABLE";

export type EvidenceCategory =
  // Cross-asset
  | "MACRO"
  | "CROSS_ASSET"
  | "RISK_REGIME"
  // Price / structure
  | "PRICE_ACTION"
  | "MARKET_STRUCTURE"
  | "LIQUIDITY"
  // Derivatives
  | "DERIVATIVES"
  | "POSITIONING"
  // Fundamentals
  | "FUNDAMENTALS"
  | "VALUATION"
  | "EARNINGS"
  // Commodity
  | "INVENTORY"
  | "SUPPLY_DEMAND"
  | "FUTURES_STRUCTURE"
  // Forex
  | "RATES"
  | "CARRY"
  | "MONETARY_POLICY"
  // Crypto-specific
  | "DEFI_FUNDAMENTAL"
  | "TOKENOMICS"
  | "ON_CHAIN";

/**
 * Dependency groups enable double-counting detection.
 * Evidence items sharing the same dependency group originate from
 * the same underlying data source/observation and must NOT be counted
 * as independent evidence.
 */
export type DependencyGroup =
  // Derivatives
  | "DERIVATIVES_OI"
  | "DERIVATIVES_FUNDING"
  | "DERIVATIVES_LIQUIDATION"
  | "DERIVATIVES_POSITIONING"
  // DeFi
  | "DEFI_TVL"
  | "DEFI_FEES_REVENUE"
  | "DEFI_STABLECOIN"
  | "DEFI_PROTOCOL"
  // Tokenomics
  | "TOKENOMICS_SUPPLY"
  | "TOKENOMICS_UNLOCK"
  // On-chain
  | "ON_CHAIN_ACTIVITY"
  // Forex / Macro
  | "MACRO_RATES"
  | "MACRO_YIELD_CURVE"
  | "MACRO_COT"
  | "MACRO_CALENDAR"
  | "MACRO_ECONOMIC_DATA"
  // Equity
  | "EQUITY_EARNINGS"
  | "EQUITY_FINANCIAL_STATEMENTS"
  | "EQUITY_VALUATION"
  | "EQUITY_DIVIDENDS"
  // Commodity
  | "COMMODITY_INVENTORY"
  | "COMMODITY_SUPPLY_DEMAND"
  | "COMMODITY_FUTURES_STRUCTURE"
  | "COMMODITY_COT";

export interface UniversalEvidenceItem {
  /** Source provider name. */
  source: string;
  /** High-level category. */
  category: EvidenceCategory;
  /** Direction relative to the current thesis. */
  direction: EvidenceDirection;
  /** Strength of the evidence signal. */
  strength: EvidenceStrength;
  /** Data quality assessment. */
  quality: EvidenceQuality;
  /** Freshness of the underlying data. */
  freshness: FreshnessState;
  /** Dependency group for double-counting detection. */
  dependencyGroup: DependencyGroup;
  /** Human-readable explanation. */
  explanation: string;
  /** Whether the provider is actually available for this instrument. */
  providerAvailable: boolean;
  /** Asset class this evidence pertains to. */
  assetClass: AssetClass;
  /** Instrument this evidence pertains to (canonical). */
  instrument: string;
}

// ═══════════════════════════════════════════════════════════════
// 5. ASSET-CLASS INTELLIGENCE CONTRACTS
// ═══════════════════════════════════════════════════════════════

/** Common intelligence metadata shared across all asset classes. */
export interface IntelligenceMeta {
  /** Provider name. */
  provider: string;
  /** When this data was observed. */
  observedAt: number;
  /** Freshness classification. */
  freshness: FreshnessState;
  /** Quality assessment. */
  quality: EvidenceQuality;
  /** Whether data is available. */
  available: boolean;
  /** Failure reason if unavailable. */
  failureReason?: string;
  /** Number of sub-datasets actually available. */
  availableDatasets: number;
  /** Total sub-datasets attempted. */
  totalDatasets: number;
}

// ── Forex Intelligence ──────────────────────────────────────

export interface ForexIntelligenceContext {
  instrument: string;
  instrumentType: "forex";
  assembledAt: number;

  // Interest rate / central bank context
  rates?: IntelligenceMeta & {
    baseCurrencyRate?: number;
    quoteCurrencyRate?: number;
    rateDifferential?: number;
    carryContext?: string;
    monetaryPolicySummary?: string;
  };

  // Yield differential
  yields?: IntelligenceMeta & {
    baseYield?: number;
    quoteYield?: number;
    yieldDifferential?: number;
    yieldCurveContext?: string;
  };

  // COT positioning
  positioning?: IntelligenceMeta & {
    nonCommercialNet?: number;
    commercialNet?: number;
    changeInNonCommercial?: number;
    positioningContext?: string;
  };

  // Macro calendar
  macro?: IntelligenceMeta & {
    upcomingEvents?: { name: string; date: string; impact: string }[];
    macroContext?: string;
  };

  // Cross-asset (DXY, risk regime)
  crossAsset?: IntelligenceMeta & {
    dxyTrend?: "rising" | "falling" | "stable";
    riskRegime?: "risk_on" | "risk_off" | "neutral" | "unknown";
    crossAssetContext?: string;
  };

  evidence: UniversalEvidenceItem[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  analystSummary: string;
}

// ── Equity Intelligence Context ─────────────────────────────

export interface EquityIntelligenceContext {
  instrument: string;
  instrumentType: "equity";
  assembledAt: number;

  // Company fundamentals
  fundamentals?: IntelligenceMeta & {
    marketCap?: number;
    peRatio?: number;
    pegRatio?: number;
    priceToBook?: number;
    evToEbitda?: number;
    revenueGrowth?: number;
    earningsGrowth?: number;
    profitMargin?: number;
    operatingMargin?: number;
    returnOnEquity?: number;
    dividendYield?: number;
  };

  // Earnings
  earnings?: IntelligenceMeta & {
    latestEarnings?: { date: string; eps?: number; revenue?: number };
    upcomingEarnings?: { date: string; estimate?: number };
    earningsSurprise?: number;
    earningsContext?: string;
  };

  // Sector / industry
  sector?: {
    sector: string;
    industry?: string;
    sectorContext?: string;
  };

  // Valuation
  valuation?: IntelligenceMeta & {
    intrinsicValue?: number;
    relativeValuation?: "undervalued" | "fair" | "overvalued" | "unknown";
    valuationContext?: string;
  };

  // Corporate actions
  corporateActions?: IntelligenceMeta & {
    recentDividends?: { date: string; amount: number }[];
    recentBuybacks?: boolean;
    dilutionRisk?: "low" | "moderate" | "high" | "unknown";
    corporateActionsContext?: string;
  };

  evidence: UniversalEvidenceItem[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  analystSummary: string;
}

// ── Commodity Intelligence Context ──────────────────────────

export interface CommodityIntelligenceContext {
  instrument: string;
  instrumentType: "commodity";
  assembledAt: number;

  // Inventory
  inventory?: IntelligenceMeta & {
    currentInventory?: number;
    changeWeekly?: number;
    changeVsExpected?: number;
    inventoryContext?: string;
  };

  // Supply / demand
  supplyDemand?: IntelligenceMeta & {
    production?: number;
    consumption?: number;
    surplus?: number;
    supplyDemandContext?: string;
  };

  // Futures structure
  futuresStructure?: IntelligenceMeta & {
    structure?: "contango" | "backwardation" | "flat" | "unknown";
    frontMonthPrice?: number;
    backMonthPrice?: number;
    rollYield?: number;
    structureContext?: string;
  };

  // COT positioning
  positioning?: IntelligenceMeta & {
    managedMoneyNet?: number;
    commercialNet?: number;
    changeInManagedMoney?: number;
    positioningContext?: string;
  };

  // Seasonality
  seasonality?: IntelligenceMeta & {
    seasonalPattern?: string;
    seasonalContext?: string;
  };

  // Macro influence
  macroInfluence?: IntelligenceMeta & {
    dollarContext?: string;
    geopoliticalContext?: string;
    macroInfluenceContext?: string;
  };

  evidence: UniversalEvidenceItem[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  analystSummary: string;
}

// ── Cross-Asset / Macro Intelligence Context ────────────────

export interface CrossAssetIntelligenceContext {
  assembledAt: number;

  // DXY
  dxy?: IntelligenceMeta & {
    value?: number;
    trend?: "rising" | "falling" | "stable";
  };

  // Treasury yields
  treasury?: IntelligenceMeta & {
    twoYear?: number;
    tenYear?: number;
    thirtyYear?: number;
    yieldCurve?: "normal" | "inverted" | "flat" | "unknown";
    realYield10y?: number;
  };

  // Global risk regime
  riskRegime?: IntelligenceMeta & {
    regime?: "risk_on" | "risk_off" | "transitioning" | "unknown";
    indicators?: string[];
    regimeContext?: string;
  };

  // Central bank policy
  centralBanks?: IntelligenceMeta & {
    fedContext?: string;
    ecbContext?: string;
    bojContext?: string;
    pbocContext?: string;
    policyContext?: string;
  };

  // Global liquidity
  globalLiquidity?: IntelligenceMeta & {
    m2Trend?: "expanding" | "contracting" | "stable" | "unknown";
    liquidityContext?: string;
  };

  evidence: UniversalEvidenceItem[];
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  overallQuality: EvidenceQuality;
  missingInformation: string[];
  analystSummary: string;
}

// ═══════════════════════════════════════════════════════════════
// 6. UNIFIED INTELLIGENCE CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * The universal intelligence context that wraps asset-class-specific
 * intelligence into a common interface for the analysis engine.
 *
 * This does NOT replace the existing CryptoIntelligenceContext —
 * it provides a universal entry point for any asset class.
 */
export interface UniversalIntelligenceContext {
  /** Canonical instrument. */
  instrument: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** When this context was assembled. */
  assembledAt: number;

  /** Asset-class-specific intelligence (exactly one present). */
  forex?: ForexIntelligenceContext;
  equity?: EquityIntelligenceContext;
  commodity?: CommodityIntelligenceContext;
  crossAsset?: CrossAssetIntelligenceContext;

  /** All evidence items aggregated across sub-contexts. */
  evidence: UniversalEvidenceItem[];

  /** Overall availability. */
  overallAvailability: "FULL" | "PARTIAL" | "MINIMAL" | "UNAVAILABLE";
  /** Overall quality. */
  overallQuality: EvidenceQuality;

  /** Missing information across all sub-contexts. */
  missingInformation: string[];

  /** Data flags (e.g. double-counting warnings). */
  dataFlags: string[];

  /** Analyst-facing summary. */
  analystSummary: string;
}
