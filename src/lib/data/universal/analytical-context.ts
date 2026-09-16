/**
 * Phase 55 — Universal Analytical Context
 *
 * Standardized analytical context model for all asset classes.
 * Provides deep, multi-dimensional context that is genuinely comparable
 * across crypto, forex, equities, commodities, indices, and macro.
 *
 * CRITICAL INVARIANTS:
 *   - This module is INFORMATIONAL ONLY.
 *   - It CANNOT modify bias, conviction, gates, trade plan, or recommendation.
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data remains missing — never fabricated.
 *   - Every analytical statement has explainable supporting evidence.
 *   - Every data point has explicit source attribution.
 */

import type { AssetClass, EvidenceCategory, EvidenceDirection, EvidenceQuality, FreshnessState, UniversalEvidenceItem } from "./types";

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

export type MarketRegime =
  | "TRENDING"
  | "RANGING"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "RISK_ON"
  | "RISK_OFF"
  | "TRANSITION"
  | "UNKNOWN";

export type VolatilityRegime = "HIGH" | "LOW" | "NORMAL" | "UNKNOWN";

export type TrendRegime = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";

// ═══════════════════════════════════════════════════════════════
// MARKET STRUCTURE CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface MarketStructureContext {
  trend: TrendRegime;
  momentum: "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN";
  volatilityRegime: VolatilityRegime;
  rangeExpansion: "RANGE" | "EXPANSION" | "UNKNOWN";
  /** Human-readable description of structure state. */
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON RELEVANCE
// ═══════════════════════════════════════════════════════════════

export type HorizonRelevance =
  | "PRIMARY"    // Directly relevant to this horizon
  | "SECONDARY"  // Indirectly relevant
  | "MINIMAL"    // Low relevance
  | "UNKNOWN";   // Cannot determine

// ═══════════════════════════════════════════════════════════════
// ANALYTICAL DIMENSION
// ═══════════════════════════════════════════════════════════════

export interface AnalyticalDimension {
  /** Dimension name (e.g. "rate_differential", "valuation", "inventory"). */
  name: string;
  /** Category for evidence grouping. */
  category: EvidenceCategory;
  /** Source provider. */
  source: string;
  /** Data quality. */
  quality: EvidenceQuality;
  /** Data freshness. */
  freshness: FreshnessState;
  /** Horizon relevance. */
  horizonRelevance: HorizonRelevance;
  /** Analytical explanation — ONLY if data exists. */
  explanation: string;
  /** Whether data is available for this dimension. */
  available: boolean;
  /** Dependency group for double-counting detection. */
  dependencyGroup: string;
}

// ═══════════════════════════════════════════════════════════════
// ASSET-CLASS ANALYTICAL DEPTH
// ═══════════════════════════════════════════════════════════════

export interface CryptoAnalyticalDepth {
  instrument: string;
  assetClass: "crypto";
  assembledAt: number;

  // Derivatives regime
  oiRegime?: {
    level: "HIGH" | "LOW" | "NORMAL" | "UNKNOWN";
    trend: "RISING" | "FALLING" | "STABLE" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  fundingRegime?: {
    level: "EXTREME_POSITIVE" | "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "EXTREME_NEGATIVE" | "UNKNOWN";
    annualizedRate?: number;
    available: boolean;
    description: string;
  };

  liquidationContext?: {
    asymmetry: "LONG_DOMINANT" | "SHORT_DOMINANT" | "BALANCED" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // Spot/derivatives divergence
  spotDerivativesDivergence?: {
    exists: boolean;
    available: boolean;
    description: string;
  };

  // DeFi fundamental
  tvlTrend?: {
    direction: "GROWING" | "DECLINING" | "STABLE" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  feesRevenueTrend?: {
    direction: "GROWING" | "DECLINING" | "STABLE" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // Tokenomics
  supplyPressure?: {
    level: "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  unlockPressure?: {
    level: "HIGH" | "MODERATE" | "LOW" | "NONE" | "UNKNOWN";
    upcomingCount30d?: number;
    available: boolean;
    description: string;
  };

  // Market context
  btcCorrelation?: {
    correlation?: number;
    regime: "HIGH_CORRELATED" | "LOW_CORRELATED" | "INVERSE" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  marketDominance?: {
    btcDominance?: number;
    trend: "RISING" | "FALLING" | "STABLE" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // Evidence
  dimensions: AnalyticalDimension[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  missingInformation: string[];
}

export interface ForexAnalyticalDepth {
  instrument: string;
  assetClass: "forex";
  assembledAt: number;

  // Rate differential
  rateDifferential?: {
    baseRate?: number;
    quoteRate?: number;
    differential?: number;
    trend: "WIDENING" | "NARROWING" | "STABLE" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // Yield differential
  yieldDifferential?: {
    twoYearDifferential?: number;
    tenYearDifferential?: number;
    realYieldDifferential?: number;
    available: boolean;
    description: string;
  };

  // Central bank regime
  centralBankRegime?: {
    baseCentralBank: string;
    quoteCentralBank: string;
    baseBias: "HAWKISH" | "DOVISH" | "NEUTRAL" | "CHANGING" | "UNKNOWN";
    quoteBias: "HAWKISH" | "DOVISH" | "NEUTRAL" | "CHANGING" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // COT positioning
  cotContext?: {
    netNonCommercial?: number;
    changeInPositioning?: number;
    extremeLevel?: "EXTREME_LONG" | "EXTREME_SHORT" | "NEUTRAL" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // DXY context
  dxyContext?: {
    trend: "RISING" | "FALLING" | "STABLE" | "UNKNOWN";
    regime: MarketRegime;
    available: boolean;
    description: string;
  };

  // Macro sensitivity
  macroSensitivity?: {
    keyDrivers: string[];
    upcomingEvents: { name: string; date: string; impact: string }[];
    available: boolean;
    description: string;
  };

  // Evidence
  dimensions: AnalyticalDimension[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  missingInformation: string[];
}

export interface EquityAnalyticalDepth {
  instrument: string;
  assetClass: "equity";
  assembledAt: number;

  // Valuation
  valuation?: {
    peRatio?: number;
    forwardPE?: number;
    pbRatio?: number;
    evToEbitda?: number;
    marketCap?: number;
    relativeValuation: "UNDERVALUED" | "FAIR" | "OVERVALUED" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // Growth
  growth?: {
    revenueGrowth?: number;
    earningsGrowth?: number;
    epsGrowth?: number;
    available: boolean;
    description: string;
  };

  // Profitability
  profitability?: {
    grossMargin?: number;
    operatingMargin?: number;
    netMargin?: number;
    roe?: number;
    available: boolean;
    description: string;
  };

  // Balance sheet
  balanceSheet?: {
    debtToEquity?: number;
    cash?: number;
    debt?: number;
    freeCashFlow?: number;
    available: boolean;
    description: string;
  };

  // Earnings
  earnings?: {
    lastEarningsDate?: string;
    nextEarningsDate?: string;
    lastEPS?: number;
    epsSurprise?: number;
    revenueSurprise?: number;
    available: boolean;
    description: string;
  };

  // Corporate actions
  corporateActions?: {
    dividendYield?: number;
    recentBuybacks?: boolean;
    dilutionRisk: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // Sector context
  sectorContext?: {
    sector: string;
    industry?: string;
    sectorRelativePerformance?: number;
    available: boolean;
    description: string;
  };

  // Evidence
  dimensions: AnalyticalDimension[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  missingInformation: string[];
}

export interface CommodityAnalyticalDepth {
  instrument: string;
  assetClass: "commodity";
  assembledAt: number;

  // Inventory
  inventory?: {
    currentInventory?: number;
    changeWeekly?: number;
    changeVsExpected?: number;
    historicalContext?: string;
    available: boolean;
    description: string;
  };

  // Supply/demand
  supplyDemand?: {
    production?: number;
    consumption?: number;
    surplus?: number;
    available: boolean;
    description: string;
  };

  // Futures structure
  futuresStructure?: {
    structure: "CONTANGO" | "BACKWARDATION" | "FLAT" | "UNKNOWN";
    curveSlope?: number;
    frontBackSpread?: number;
    available: boolean;
    description: string;
  };

  // COT
  cotContext?: {
    managedMoneyNet?: number;
    commercialNet?: number;
    changeInPositioning?: number;
    extremeLevel?: "EXTREME_LONG" | "EXTREME_SHORT" | "NEUTRAL" | "UNKNOWN";
    available: boolean;
    description: string;
  };

  // Seasonality
  seasonality?: {
    seasonalTendency?: string;
    currentSeasonalPosition?: string;
    available: boolean;
    description: string;
  };

  // Dollar sensitivity
  dollarSensitivity?: {
    dxyTrend: "RISING" | "FALLING" | "STABLE" | "UNKNOWN";
    historicalCorrelation?: number;
    available: boolean;
    description: string;
  };

  // Cross-commodity
  crossCommodity?: {
    relationships: { instrument: string; relationship: string; strength: string }[];
    available: boolean;
  };

  // Evidence
  dimensions: AnalyticalDimension[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  missingInformation: string[];
}

export interface IndexAnalyticalDepth {
  instrument: string;
  assetClass: "indices";
  assembledAt: number;

  marketStructure?: {
    trend: TrendRegime;
    momentum: "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN";
    volatilityRegime: VolatilityRegime;
    rangeExpansion: "RANGE" | "EXPANSION" | "UNKNOWN";
    description: string;
  };
  volatility?: {
    currentVolatility?: number;
    avgVolatility?: number;
    regime: VolatilityRegime;
    vixRelationship?: string;
    available: boolean;
    description: string;
  };
  breadth?: {
    advanceDecline?: number;
    newHighsNewLows?: number;
    breadthStrength?: "STRONG" | "MODERATE" | "WEAK" | "DIVERGENCE" | "UNKNOWN";
    available: boolean;
    description: string;
  };
  valuation?: {
    pe?: number;
    forwardPE?: number;
    earningsYield?: number;
    regime: "ELEVATED" | "MODERATE" | "DEPRESSED" | "UNKNOWN";
    available: boolean;
    description: string;
  };
  yieldSensitivity?: {
    level: "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
    available: boolean;
    description: string;
  };
  macroSensitivity?: {
    us10YCorrelation?: string;
    dxyCorrelation?: string;
    vixInverseCorrelation?: string;
    available: boolean;
    description: string;
  };
  crossMarket?: {
    spxVsNdx?: string;
    spxVsDji?: string;
    ihsgVsGlobal?: string;
    available: boolean;
    description: string;
  };
  riskRegime?: MarketRegime;

  dimensions: AnalyticalDimension[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  missingInformation: string[];
}

export interface MacroAnalyticalDepth {
  instrument: string;
  assetClass: "macro";
  assembledAt: number;

  trend?: TrendRegime;
  momentum?: "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN";

  yieldCurve?: {
    shape: "STEEPENING" | "FLATTENING" | "INVERTED" | "POSITIVE_SLOPE" | "UNKNOWN";
    spread?: number;
    tenYearYield?: number;
    twoYearYield?: number;
    available: boolean;
    description: string;
  };
  realYield?: {
    tenYearRealYield?: number;
    available: boolean;
    description: string;
  };
  centralBank?: {
    fedBias: "HAWKISH" | "DOVISH" | "NEUTRAL" | "SHIFTING" | "UNKNOWN";
    ecbBias: "HAWKISH" | "DOVISH" | "NEUTRAL" | "SHIFTING" | "UNKNOWN";
    bojBias: "HAWKISH" | "DOVISH" | "NEUTRAL" | "SHIFTING" | "UNKNOWN";
    available: boolean;
    description: string;
  };
  globalLiquidity?: {
    trend: "EXPANDING" | "CONTRACTING" | "STABLE" | "UNKNOWN";
    m2Change?: number;
    available: boolean;
    description: string;
  };
  macroEvents?: {
    upcomingEvents: { name: string; date: string; impact: string; region?: string }[];
    available: boolean;
    description: string;
  };
  macroRegime?: {
    regime: MarketRegime;
    description: string;
  };
  riskRegime?: MarketRegime;
  dxyContext?: {
    trend: TrendRegime;
    description: string;
  };

  dimensions: AnalyticalDimension[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  missingInformation: string[];
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL ANALYTICAL CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface UniversalAnalyticalContext {
  instrument: string;
  assetClass: AssetClass;
  assembledAt: number;

  // Asset-class-specific analytical depth (exactly one present)
  crypto?: CryptoAnalyticalDepth;
  forex?: ForexAnalyticalDepth;
  equity?: EquityAnalyticalDepth;
  commodity?: CommodityAnalyticalDepth;
  index?: IndexAnalyticalDepth;
  macro?: MacroAnalyticalDepth;

  // Cross-cutting
  marketRegime?: MarketRegime;
  overallDimensions: AnalyticalDimension[];

  // Evidence
  allEvidence: UniversalEvidenceItem[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  missingInformation: string[];

  // Data flags
  dataFlags: string[];

  // Analyst summary
  analystSummary: string;
}

// ═══════════════════════════════════════════════════════════════
// RELATIVE VALUE
// ═══════════════════════════════════════════════════════════════

export interface RelativeValueContext {
  instrument: string;
  assetClass: AssetClass;
  assembledAt: number;

  comparisons: RelativeValueComparison[];
  overallDescription: string;
  available: boolean;
}

export interface RelativeValueComparison {
  targetInstrument: string;
  relationship: string;
  strength: "STRONG" | "MODERATE" | "WEAK" | "UNKNOWN";
  direction: EvidenceDirection;
  explanation: string;
  available: boolean;
  dependencyGroup: string;
}
