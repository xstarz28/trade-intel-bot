/**
 * Phase 110 — Fundamental Regime & Macro Transmission Engine
 *
 * Deterministic, evidence-first fundamental analysis layer.
 * Pure functions — no side effects, no network calls.
 * Reuses existing MacroContext, CrossAssetContext, NewsItem, NewsRelevance.
 * No fabricated data. No probability claims. No auto-execution.
 */

import type { MacroContext, CrossAssetContext, RiskRegime } from "./multi-dimensional-intelligence";
import type { NewsItem, NewsRelevance } from "./news-intelligence";
import type { FundamentalDataPoint, EconomicEvent } from "./fundamental-intelligence";
import type { TreasuryData } from "../../lib/data/treasury";

// ═══════════════════════════════════════════════════════════════
// DOMAIN TYPES
// ═══════════════════════════════════════════════════════════════

export type DimensionAvailability = "AVAILABLE" | "UNAVAILABLE" | "INSUFFICIENT_EVIDENCE";
export type EvidenceDirection = "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "UNAVAILABLE";
export type AssetClass = "GOLD" | "SILVER" | "CRYPTO" | "FOREX" | "EQUITIES" | "OIL" | "COMMODITIES";

export type InflationRegime =
  | "DISINFLATIONARY"
  | "STABLE"
  | "RISING"
  | "HIGH"
  | "ACCELERATING"
  | "INSUFFICIENT_DATA";

export type InflationDriver = "DEMAND_DRIVEN" | "SUPPLY_DRIVEN" | "MIXED" | "INSUFFICIENT_DATA";

export type InflationExpectationSurprise = "ABOVE_EXPECTATION" | "BELOW_EXPECTATION" | "IN_LINE" | "UNAVAILABLE";

export type PolicyRateRegime = "EASING" | "NEUTRAL" | "TIGHTENING" | "RESTRICTIVE" | "TRANSITIONING" | "INSUFFICIENT_DATA";

/**
 * Structured inflation observation from actual economic data.
 * All fields optional — missing data is explicitly UNAVAILABLE, never fabricated.
 */
export interface InflationObservation {
  /** Actual released value (e.g., CPI YoY 3.2%). */
  actual?: number | null;
  /** Previous released value. */
  previous?: number | null;
  /** Forecast/consensus value. */
  forecast?: number | null;
  /** Metric name (e.g., "CPI YoY", "Core PCE MoM"). */
  metric?: string | null;
  /** Data availability. */
  availability: DimensionAvailability;
}

/**
 * Structured policy-rate observation.
 * Distinguished from US10Y (market yield) — this is the central bank policy rate.
 */
export interface PolicyRateObservation {
  /** Current policy rate value (e.g., 5.25%). */
  current?: number | null;
  /** Previous policy rate value. */
  previous?: number | null;
  /** Expected/forecast policy rate. */
  forecast?: number | null;
  /** Rate decision classification if available. */
  decision?: "RATE_HIKE" | "RATE_CUT" | "HOLD" | "UNKNOWN" | null;
  /** Data availability. */
  availability: DimensionAvailability;
}

/**
 * Structured growth observation from economic calendar events.
 * Uses GDP, PMI, ISM, retail sales, and other growth indicators.
 */
export interface GrowthObservation {
  /** GDP actual value (if available). */
  gdpActual?: number | null;
  /** GDP previous value. */
  gdpPrevious?: number | null;
  /** GDP forecast. */
  gdpForecast?: number | null;
  /** PMI actual value (if available). */
  pmiActual?: number | null;
  /** PMI previous value. */
  pmiPrevious?: number | null;
  /** ISM actual value (if available). */
  ismActual?: number | null;
  /** ISM previous value. */
  ismPrevious?: number | null;
  /** Retail sales actual (if available). */
  retailSalesActual?: number | null;
  /** Retail sales previous. */
  retailSalesPrevious?: number | null;
  /** Number of growth indicators available. */
  dataPointCount: number;
  /** Data availability. */
  availability: DimensionAvailability;
}

/**
 * Structured employment observation from economic calendar events.
 * Uses NFP, unemployment rate, and other labor indicators.
 */
export interface EmploymentObservation {
  /** NFP/Non-Farm Payrolls actual (in thousands). */
  nfpActual?: number | null;
  /** NFP previous. */
  nfpPrevious?: number | null;
  /** NFP forecast. */
  nfpForecast?: number | null;
  /** Unemployment rate actual (%). */
  unemploymentActual?: number | null;
  /** Unemployment previous. */
  unemploymentPrevious?: number | null;
  /** Unemployment forecast. */
  unemploymentForecast?: number | null;
  /** Data availability. */
  availability: DimensionAvailability;
}

/**
 * Structured consumer confidence observation.
 */
export interface ConsumerConfidenceObservation {
  /** Consumer confidence actual. */
  actual?: number | null;
  /** Consumer confidence previous. */
  previous?: number | null;
  /** Consumer confidence forecast. */
  forecast?: number | null;
  /** Data availability. */
  availability: DimensionAvailability;
}

export type RateRegime =
  | "EASING"
  | "NEUTRAL"
  | "TIGHTENING"
  | "RESTRICTIVE"
  | "TRANSITIONING"
  | "INSUFFICIENT_DATA";

export type RealYieldRegime =
  | "REAL_YIELD_RISING"
  | "REAL_YIELD_FALLING"
  | "REAL_YIELD_STABLE"
  | "UNAVAILABLE";

export type CurrencyRegime =
  | "STRENGTHENING"
  | "WEAKENING"
  | "STABLE"
  | "VOLATILE"
  | "UNAVAILABLE";

export type LiquidityRegime =
  | "EASY"
  | "NEUTRAL"
  | "TIGHTENING"
  | "STRESS"
  | "UNAVAILABLE";

export type GrowthRegime =
  | "EXPANDING"
  | "SLOWING"
  | "CONTRACTING"
  | "RECOVERING"
  | "UNAVAILABLE";

export type EnergyRegime =
  | "SUPPLY_DISRUPTION"
  | "DEMAND_DRIVEN"
  | "BALANCED"
  | "OIL_SHOCK"
  | "UNAVAILABLE";

export type GeopoliticalRegime =
  | "LOW"
  | "ELEVATED"
  | "HIGH"
  | "ESCALATING"
  | "DE_ESCALATING"
  | "INSUFFICIENT_DATA";

export type OverallRegime =
  | "RISK_ON"
  | "RISK_OFF"
  | "MIXED"
  | "STRESSED"
  | "RECOVERY"
  | "INSUFFICIENT_DATA";

export interface FundamentalDimension {
  name: string;
  status: DimensionAvailability;
  description: string;
}

export interface FundamentalEvidence {
  dimension: string;
  direction: EvidenceDirection;
  description: string;
  source: string;
}

export interface FundamentalRegime {
  /** Overall macro regime classification. */
  overallRegime: OverallRegime;
  /** Individual dimension statuses. */
  dimensions: FundamentalDimension[];
  /** Inflation regime. */
  inflationRegime: InflationRegime;
  /** Inflation driver classification. */
  inflationDriver: InflationDriver;
  /** Rate regime. */
  rateRegime: RateRegime;
  /** Real yield regime. */
  realYieldRegime: RealYieldRegime;
  /** Currency regime (USD). */
  currencyRegime: CurrencyRegime;
  /** Liquidity regime. */
  liquidityRegime: LiquidityRegime;
  /** Growth regime. */
  growthRegime: GrowthRegime;
  /** Employment regime (from structured economic data). */
  employmentRegime: "STRONG" | "STABLE" | "WEAKENING" | "STRESSED" | "UNAVAILABLE";
  /** Consumer confidence regime (from structured economic data). */
  consumerConfidenceRegime: "STRONG" | "STABLE" | "WEAKENING" | "UNAVAILABLE";
  /** Energy regime. */
  energyRegime: EnergyRegime;
  /** Geopolitical regime. */
  geopoliticalRegime: GeopoliticalRegime;
  /** Inflation expectation surprise (derived from actual vs forecast). */
  inflationExpectationSurprise: InflationExpectationSurprise;
  /** Policy-rate regime (central bank rate, separate from US10Y market yield). */
  policyRateRegime: PolicyRateRegime;
  /** Number of structured economic data points available. */
  structuredDataPointCount: number;
  /** Number of economic calendar events available. */
  economicEventCount: number;
  /** Available dimension count. */
  availableDimensionCount: number;
  /** Unavailable dimension count. */
  unavailableDimensionCount: number;
  /** Data quality overall. */
  dataQuality: DimensionAvailability;
  /** When this regime was generated. */
  generatedAt: number;
}

export interface AssetFundamentalContext {
  /** Asset class. */
  asset: AssetClass;
  /** Fundamental assessment. */
  fundamentalAssessment: EvidenceDirection;
  /** Supporting evidence items. */
  supportingEvidence: FundamentalEvidence[];
  /** Conflicting evidence items. */
  conflictingEvidence: FundamentalEvidence[];
  /** Neutral evidence items. */
  neutralEvidence: FundamentalEvidence[];
  /** Unavailable dimensions. */
  unavailableDimensions: string[];
  /** Dominant macro drivers. */
  dominantMacroDrivers: string[];
  /** Conflicting macro drivers. */
  conflictingMacroDrivers: string[];
  /** Transmission explanation. */
  transmissionExplanation: string;
  /** What could change the assessment. */
  whatCouldChangeAssessment: string[];
  /** What to monitor. */
  whatToMonitor: string[];
  /** Data quality. */
  dataQuality: DimensionAvailability;
}

export interface TechnicalFundamentalAlignment {
  technicalDirection: EvidenceDirection;
  fundamentalDirection: EvidenceDirection;
  alignment: "BOTH_SUPPORTING" | "BOTH_CONFLICTING" | "TECHNICAL_SUPPORTING_FUNDAMENTAL_CONFLICTING" | "TECHNICAL_CONFLICTING_FUNDAMENTAL_SUPPORTING" | "INSUFFICIENT_DATA";
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// INPUT MODEL
// ═══════════════════════════════════════════════════════════════

export interface FundamentalRegimeInput {
  /** Existing macro context from multi-dimensional intelligence. */
  macroContext?: MacroContext | null;
  /** Existing cross-asset context. */
  crossAssetContext?: CrossAssetContext | null;
  /** News items related to the instrument/portfolio. */
  newsItems?: NewsItem[];
  /** News relevance assessments. */
  newsRelevance?: NewsRelevance[];
  /** VIX level (redundant with macroContext but provided for direct access). */
  vixLevel?: number | null;
  /** USD index if available. */
  usdIndex?: number | null;
  /** DXY trend description if available. */
  dxyTrend?: string | null;
  /** Oil price if available. */
  oilPrice?: number | null;
  /** Oil change description if available. */
  oilChange?: string | null;
  /** Gold price (for gold-specific analysis). */
  goldPrice?: number | null;
  /** US 10Y yield level if available. */
  us10yYield?: number | null;
  /** US 10Y yield 24h change (bps) if available. */
  us10yChange?: number | null;
  /** Bond yield description if available. */
  bondYieldDescription?: string | null;
  /** Real yield description if available. */
  realYieldDescription?: string | null;
  /** Inflation description if available. */
  inflationDescription?: string | null;
  /** Rate description if available. */
  rateDescription?: string | null;
  /** Growth description if available. */
  growthDescription?: string | null;
  /** Liquidity description if available. */
  liquidityDescription?: string | null;
  /** Geopolitical description if available. */
  geopoliticalDescription?: string | null;
  /** Structured economic data points (CPI, PCE, etc.) from existing providers. */
  fundamentalDataPoints?: FundamentalDataPoint[];
  /** Economic calendar events (FOMC, CPI release, etc.). */
  economicEvents?: EconomicEvent[];
  /** Structured inflation observation (actual/previous/forecast). */
  inflationObservation?: InflationObservation;
  /** Structured policy-rate observation (separate from US10Y market yield). */
  policyRateObservation?: PolicyRateObservation;
  /** Treasury yield context (nominal + real/TIPS from home.treasury.gov). */
  treasuryContext?: TreasuryData;
  /** Structured growth observation from economic events. */
  growthObservation?: GrowthObservation;
  /** Structured employment observation from economic events. */
  employmentObservation?: EmploymentObservation;
  /** Structured consumer confidence observation. */
  consumerConfidenceObservation?: ConsumerConfidenceObservation;
}

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC INSTRUMENT → ASSET CLASS MAPPING
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic instrument-to-asset-class mapping.
 * Conservative — unknown instruments return "COMMODITIES" as fallback
 * since that is the broadest safe classification.
 * Pure function.
 */
export function mapInstrumentToAssetClass(instrument: string): AssetClass {
  const sym = instrument.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");

  // GOLD
  if (sym === "XAUUSD" || sym === "XAU" || sym.includes("GOLD")) return "GOLD";

  // SILVER
  if (sym === "XAGUSD" || sym === "XAG" || sym.includes("SILVER")) return "SILVER";

  // OIL — check before generic commodities
  if (sym === "USOIL" || sym === "WTI" || sym === "CL" || sym.includes("CRUDE")) return "OIL";
  if (sym === "UKOIL" || sym === "BRENT" || sym.includes("BRENT")) return "OIL";

  // CRYPTO
  if (sym === "BTCUSD" || sym === "BTC" || sym === "XBTUSD" || sym === "XBT") return "CRYPTO";
  if (sym === "ETHUSD" || sym === "ETH" || sym === "ETHUSDT") return "CRYPTO";
  if (sym.includes("USD") && (sym.startsWith("BTC") || sym.startsWith("ETH") ||
      sym.startsWith("SOL") || sym.startsWith("DOGE") || sym.startsWith("XRP") ||
      sym.startsWith("ADA") || sym.startsWith("AVAX") || sym.startsWith("DOT"))) return "CRYPTO";

  // FOREX — major pairs
  if (/^(EUR|GBP|JPY|CHF|AUD|NZD|CAD|USD)[A-Z]{3}$/.test(sym)) return "FOREX";
  if (/^[A-Z]{6}$/.test(sym) && (sym.includes("USD") || sym.includes("EUR") || sym.includes("GBP") || sym.includes("JPY"))) return "FOREX";

  // EQUITIES — common equity tickers
  if (/^[A-Z]{1,5}$/.test(sym) && !sym.includes("USD") && !sym.includes("EUR")) {
    // Could be an equity ticker — check common patterns
    // Equities are typically 1-5 letter US tickers
    return "EQUITIES";
  }

  // Fallback
  return "COMMODITIES";
}

// ═══════════════════════════════════════════════════════════════
// BUILD FUNDAMENTAL INPUT FROM POSITION INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

/**
 * Build FundamentalRegimeInput from available PositionIntelligence data.
 * Only passes through data that actually exists — never fabricates.
 * Pure function.
 */
export function buildFundamentalInputFromPositionIntel(intel: {
  instrument: string;
  assetClass: string;
  shortTermContext?: string;
  mediumTermContext?: string;
  volatilityContext?: string;
  evidence?: Array<{ category: string; description: string; direction: string }>;
},
options: {
  newsItems?: NewsItem[];
  newsRelevance?: NewsRelevance[];
  macroContext?: MacroContext | null;
  crossAssetContext?: CrossAssetContext | null;
  /** Numeric macro observations from live market infrastructure. */
  macroObservations?: {
    dxy?: { value: number; change24h?: number } | null;
    us10y?: { value: number; change24h?: number } | null;
    wti?: { value: number; change24h?: number } | null;
  } | null;
  /** Structured economic data points from existing providers. */
  fundamentalDataPoints?: FundamentalDataPoint[];
  /** Economic calendar events from existing providers. */
  economicEvents?: EconomicEvent[];
  /** Structured inflation observation (actual/previous/forecast). */
  inflationObservation?: InflationObservation;
  /** Structured policy-rate observation (central bank rate). */
  policyRateObservation?: PolicyRateObservation;
  /** Treasury yield context (nominal + real/TIPS from home.treasury.gov). */
  treasuryContext?: TreasuryData;
  /** Structured growth observation from economic events. */
  growthObservation?: GrowthObservation;
  /** Structured employment observation from economic events. */
  employmentObservation?: EmploymentObservation;
  /** Structured consumer confidence observation. */
  consumerConfidenceObservation?: ConsumerConfidenceObservation;
} = {},
): FundamentalRegimeInput {
  const input: FundamentalRegimeInput = {};

  // Pass through numeric macro observations (Observed: actual market values)
  if (options.macroObservations) {
    if (options.macroObservations.dxy) {
      input.usdIndex = options.macroObservations.dxy.value;
      if (options.macroObservations.dxy.change24h !== undefined) {
        const chg = options.macroObservations.dxy.change24h;
        input.dxyTrend = chg > 0.3 ? "DXY strengthening" : chg < -0.3 ? "DXY weakening" : "DXY stable";
      }
    }
    if (options.macroObservations.us10y) {
      input.us10yYield = options.macroObservations.us10y.value;
      input.us10yChange = options.macroObservations.us10y.change24h ?? null;
      // Derive bond yield description from numeric observation
      if (!input.bondYieldDescription) {
        const y = options.macroObservations.us10y.value;
        input.bondYieldDescription = `US 10Y yield at ${y.toFixed(2)}%`;
      }
    }
    if (options.macroObservations.wti) {
      input.oilPrice = options.macroObservations.wti.value;
      if (options.macroObservations.wti.change24h !== undefined) {
        const chg = options.macroObservations.wti.change24h;
        input.oilChange = chg > 2 ? "Oil price rising significantly" : chg < -2 ? "Oil price declining" : "Oil price stable balanced";
      }
    }
  }

  // Pass through macro context if available
  if (options.macroContext) {
    input.macroContext = options.macroContext;
    input.vixLevel = options.macroContext.vixLevel;
    // VIX narrative may contain macro context clues
    if (options.macroContext.narrative) {
      const narr = options.macroContext.narrative.toLowerCase();
      if (narr.includes("liquidity") || narr.includes("monetary conditions")) {
        input.liquidityDescription = options.macroContext.narrative;
      }
      if (narr.includes("geopolit") || narr.includes("conflict") || narr.includes("sanction")) {
        input.geopoliticalDescription = options.macroContext.narrative;
      }
    }
  }

  // Pass through cross-asset context if available
  if (options.crossAssetContext) {
    input.crossAssetContext = options.crossAssetContext;
  }

  // Pass through news items if available
  if (options.newsItems && options.newsItems.length > 0) {
    input.newsItems = options.newsItems;
  }
  if (options.newsRelevance && options.newsRelevance.length > 0) {
    input.newsRelevance = options.newsRelevance;
  }

  // Pass through structured economic data (OBSERVED from providers)
  if (options.fundamentalDataPoints && options.fundamentalDataPoints.length > 0) {
    input.fundamentalDataPoints = options.fundamentalDataPoints;
  }
  if (options.economicEvents && options.economicEvents.length > 0) {
    input.economicEvents = options.economicEvents;
  }
  if (options.inflationObservation) {
    input.inflationObservation = options.inflationObservation;
  }
  if (options.policyRateObservation) {
    input.policyRateObservation = options.policyRateObservation;
  }
  if (options.treasuryContext && options.treasuryContext.available) {
    input.treasuryContext = options.treasuryContext;
  }
  // Pass through structured growth/employment/consumer observations
  if (options.growthObservation) input.growthObservation = options.growthObservation;
  if (options.employmentObservation) input.employmentObservation = options.employmentObservation;
  if (options.consumerConfidenceObservation) input.consumerConfidenceObservation = options.consumerConfidenceObservation;

  // Extract context descriptions from intelligence where available
  // These are OBSERVED — derived from the existing intelligence engine
  if (intel.shortTermContext) {
    // Short-term context may contain trend/volatility info
    const ctx = intel.shortTermContext.toLowerCase();
    if (ctx.includes("inflation") || ctx.includes("price pressure") || ctx.includes("cost")) {
      input.inflationDescription = intel.shortTermContext;
    }
    if (ctx.includes("rate") || ctx.includes("yield") || ctx.includes("monetary")) {
      input.rateDescription = intel.shortTermContext;
    }
  }

  if (intel.mediumTermContext) {
    const ctx = intel.mediumTermContext.toLowerCase();
    if (ctx.includes("growth") || ctx.includes("expansion") || ctx.includes("contraction") || ctx.includes("recession")) {
      input.growthDescription = intel.mediumTermContext;
    }
    if (ctx.includes("liquidity") || ctx.includes("monetary conditions")) {
      input.liquidityDescription = intel.mediumTermContext;
    }
    if (ctx.includes("geopolit") || ctx.includes("conflict") || ctx.includes("sanction")) {
      input.geopoliticalDescription = intel.mediumTermContext;
    }
  }

  // Extract inflation observations from fundamental data points if not explicitly provided
  if (!input.inflationObservation && input.fundamentalDataPoints && input.fundamentalDataPoints.length > 0) {
    const inflationDP = input.fundamentalDataPoints.find(
      (dp) => dp.category === "INFLATION" && (dp.metric.toLowerCase().includes("cpi") || dp.metric.toLowerCase().includes("pce") || dp.metric.toLowerCase().includes("inflation")),
    );
    if (inflationDP) {
      const actual = typeof inflationDP.value === "number" ? inflationDP.value : null;
      const previous = typeof inflationDP.previous === "number" ? inflationDP.previous : null;
      const forecast = typeof inflationDP.expected === "number" ? inflationDP.expected : null;
      input.inflationObservation = {
        actual,
        previous,
        forecast,
        metric: inflationDP.metric,
        availability: actual !== null ? "AVAILABLE" : "UNAVAILABLE",
      };
    }
  }

  // Extract policy-rate observations from economic events if not explicitly provided
  if (!input.policyRateObservation && input.economicEvents && input.economicEvents.length > 0) {
    const rateEvent = input.economicEvents.find(
      (e) => e.name.toLowerCase().includes("rate") || e.name.toLowerCase().includes("fomc") || e.name.toLowerCase().includes("central bank"),
    );
    if (rateEvent) {
      const actual = typeof rateEvent.previous === "number" ? rateEvent.previous : null;
      const forecast = typeof rateEvent.expected === "number" ? rateEvent.expected : null;
      input.policyRateObservation = {
        current: actual,
        previous: null,
        forecast,
        decision: null,
        availability: actual !== null ? "AVAILABLE" : "UNAVAILABLE",
      };
    }
  }

  // If no descriptions were extracted, leave them undefined (UNAVAILABLE)
  return input;
}

// ═══════════════════════════════════════════════════════════════
// BUILD FUNDAMENTAL REGIME
// ═══════════════════════════════════════════════════════════════

/**
 * Build a deterministic fundamental regime from available data sources.
 * Pure function — no side effects.
 */
export function buildFundamentalRegime(
  input: FundamentalRegimeInput,
  now: number = Date.now(),
): FundamentalRegime {
  const dimensions: FundamentalDimension[] = [];

  // ─── VIX / Risk Sentiment ───
  const vix = input.vixLevel ?? input.macroContext?.vixLevel ?? null;
  if (vix !== null && vix > 0) {
    dimensions.push({
      name: "RISK_SENTIMENT",
      status: "AVAILABLE",
      description: `VIX at ${vix.toFixed(1)}`,
    });
  } else {
    dimensions.push({
      name: "RISK_SENTIMENT",
      status: "UNAVAILABLE",
      description: "VIX data unavailable",
    });
  }

  // ─── Inflation ───
  if (input.inflationDescription) {
    dimensions.push({
      name: "INFLATION",
      status: "AVAILABLE",
      description: input.inflationDescription,
    });
  } else {
    dimensions.push({
      name: "INFLATION",
      status: "UNAVAILABLE",
      description: "Inflation data unavailable",
    });
  }

  // ─── Interest Rates / Central Bank ───
  if (input.rateDescription) {
    dimensions.push({
      name: "INTEREST_RATES",
      status: "AVAILABLE",
      description: input.rateDescription,
    });
  } else {
    dimensions.push({
      name: "INTEREST_RATES",
      status: "UNAVAILABLE",
      description: "Interest rate data unavailable",
    });
  }

  // ─── Real Yields ───
  if (input.realYieldDescription) {
    dimensions.push({
      name: "REAL_YIELDS",
      status: "AVAILABLE",
      description: input.realYieldDescription,
    });
  } else {
    dimensions.push({
      name: "REAL_YIELDS",
      status: "UNAVAILABLE",
      description: "Real yield data unavailable",
    });
  }

  // ─── Currency / USD ───
  if (input.dxyTrend || input.usdIndex !== null && input.usdIndex !== undefined) {
    const desc = input.dxyTrend ?? `USD index: ${input.usdIndex}`;
    dimensions.push({
      name: "CURRENCY_STRENGTH",
      status: "AVAILABLE",
      description: desc,
    });
  } else {
    dimensions.push({
      name: "CURRENCY_STRENGTH",
      status: "UNAVAILABLE",
      description: "USD/DXY data unavailable",
    });
  }

  // ─── Liquidity ───
  if (input.liquidityDescription) {
    dimensions.push({
      name: "LIQUIDITY",
      status: "AVAILABLE",
      description: input.liquidityDescription,
    });
  } else {
    dimensions.push({
      name: "LIQUIDITY",
      status: "UNAVAILABLE",
      description: "Liquidity data unavailable",
    });
  }

  // ─── Growth ───
  if (input.growthDescription) {
    dimensions.push({
      name: "GROWTH",
      status: "AVAILABLE",
      description: input.growthDescription,
    });
  } else {
    dimensions.push({
      name: "GROWTH",
      status: "UNAVAILABLE",
      description: "Growth data unavailable",
    });
  }

  // ─── Energy / Oil ───
  if (input.oilChange || input.oilPrice !== null && input.oilPrice !== undefined) {
    const desc = input.oilChange ?? `Oil: ${input.oilPrice}`;
    dimensions.push({
      name: "ENERGY",
      status: "AVAILABLE",
      description: desc,
    });
  } else {
    dimensions.push({
      name: "ENERGY",
      status: "UNAVAILABLE",
      description: "Energy data unavailable",
    });
  }

  // ─── Geopolitical ───
  if (input.geopoliticalDescription) {
    dimensions.push({
      name: "GEOPOLITICAL_RISK",
      status: "AVAILABLE",
      description: input.geopoliticalDescription,
    });
  } else {
    dimensions.push({
      name: "GEOPOLITICAL_RISK",
      status: "UNAVAILABLE",
      description: "Geopolitical data unavailable",
    });
  }

  // ─── Cross-Asset ───
  if (input.crossAssetContext) {
    dimensions.push({
      name: "CROSS_ASSET",
      status: input.crossAssetContext.positionImpact !== "UNAVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
      description: `Correlation: ${input.crossAssetContext.correlationState}`,
    });
  } else {
    dimensions.push({
      name: "CROSS_ASSET",
      status: "UNAVAILABLE",
      description: "Cross-asset data unavailable",
    });
  }

  // ─── News / Events ───
  const newsCount = input.newsItems?.length ?? 0;
  if (newsCount > 0) {
    dimensions.push({
      name: "NEWS_EVENTS",
      status: "AVAILABLE",
      description: `${newsCount} news item(s) available`,
    });
  } else {
    dimensions.push({
      name: "NEWS_EVENTS",
      status: "UNAVAILABLE",
      description: "No news data available",
    });
  }

  // ─── Structured Economic Data ───
  const structuredDataCount = input.fundamentalDataPoints?.length ?? 0;
  if (structuredDataCount > 0) {
    dimensions.push({
      name: "STRUCTURED_ECONOMIC_DATA",
      status: "AVAILABLE",
      description: `${structuredDataCount} structured economic data point(s) available`,
    });
  } else {
    dimensions.push({
      name: "STRUCTURED_ECONOMIC_DATA",
      status: "UNAVAILABLE",
      description: "No structured economic data available",
    });
  }

  // ─── Economic Calendar Events ───
  const economicEventCount = input.economicEvents?.length ?? 0;
  if (economicEventCount > 0) {
    dimensions.push({
      name: "ECONOMIC_EVENTS",
      status: "AVAILABLE",
      description: `${economicEventCount} economic event(s) available`,
    });
  } else {
    dimensions.push({
      name: "ECONOMIC_EVENTS",
      status: "UNAVAILABLE",
      description: "No economic calendar events available",
    });
  }

  // ─── Classify regimes ───
  const inflationRegime = classifyInflation(input.inflationDescription, input.inflationObservation);
  const inflationDriver = classifyInflationDriver(input.inflationDescription);
  const inflationExpectationSurprise = classifyInflationExpectationSurprise(input.inflationObservation);
  const rateRegime = classifyRateRegime(input.rateDescription, input.us10yYield, input.us10yChange);
  const policyRateRegime = classifyPolicyRateRegime(input.policyRateObservation);
  const realYieldRegime = classifyRealYieldRegime(input.realYieldDescription, input.us10yChange, input.inflationDescription, input.inflationObservation, input.treasuryContext);
  const currencyRegime = classifyCurrencyRegime(input.dxyTrend, input.usdIndex);
  const liquidityRegime = classifyLiquidityRegime(input.liquidityDescription);
  const growthRegime = classifyGrowthRegime(input.growthDescription, input.growthObservation);
  const employmentRegime = classifyEmploymentRegime(input.employmentObservation);
  const consumerConfidenceRegime = classifyConsumerConfidence(input.consumerConfidenceObservation);
  const energyRegime = classifyEnergyRegime(input.oilChange, input.oilPrice);
  const geopoliticalRegime = classifyGeopoliticalRegime(input.geopoliticalDescription);

  const availableDimensionCount = dimensions.filter((d) => d.status === "AVAILABLE").length;
  const unavailableDimensionCount = dimensions.filter((d) => d.status !== "AVAILABLE").length;
  const totalDimensions = dimensions.length;

  const dataQuality: DimensionAvailability =
    availableDimensionCount >= totalDimensions * 0.6
      ? "AVAILABLE"
      : availableDimensionCount >= totalDimensions * 0.3
        ? "INSUFFICIENT_EVIDENCE"
        : "UNAVAILABLE";

  const overallRegime = classifyOverallRegime(
    vix,
    input.macroContext?.riskRegime,
    liquidityRegime,
    growthRegime,
    geopoliticalRegime,
    dataQuality,
  );

  const structuredDataPointCount = input.fundamentalDataPoints?.length ?? 0;
  const economicEventCountFinal = input.economicEvents?.length ?? 0;

  return {
    overallRegime,
    dimensions,
    inflationRegime,
    inflationDriver,
    inflationExpectationSurprise,
    rateRegime,
    policyRateRegime,
    realYieldRegime,
    currencyRegime,
    liquidityRegime,
    growthRegime,
    employmentRegime,
    consumerConfidenceRegime,
    energyRegime,
    geopoliticalRegime,
    structuredDataPointCount,
    economicEventCount: economicEventCountFinal,
    availableDimensionCount,
    unavailableDimensionCount,
    dataQuality,
    generatedAt: now,
  };
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFIERS
// ═══════════════════════════════════════════════════════════════

/**
 * Classify inflation regime.
 * Structured data takes precedence when available (OBSERVED).
 * Falls back to text-based classification (DERIVED from intelligence keywords).
 */
function classifyInflation(
  desc: string | null | undefined,
  obs?: InflationObservation,
): InflationRegime {
  // Structured data precedence (OBSERVED)
  if (obs && obs.availability === "AVAILABLE" && obs.actual !== null && obs.actual !== undefined) {
    // Use actual vs previous for trend — absolute pp change since CPI is already a percentage
    if (obs.previous !== null && obs.previous !== undefined && typeof obs.actual === "number" && typeof obs.previous === "number") {
      const ppDiff = obs.actual - obs.previous;
      if (ppDiff < -0.3) return "DISINFLATIONARY";
      if (ppDiff > 1.0) return "ACCELERATING";
      if (ppDiff > 0.2) return "RISING";
      // Small change → classify by absolute level
    }
    // Absolute level classification (CPI YoY %)
    if (typeof obs.actual === "number") {
      if (obs.actual >= 5) return "HIGH";
      if (obs.actual >= 3) return "RISING";
      if (obs.actual >= 1.5) return "STABLE";
      return "DISINFLATIONARY";
    }
  }
  // Text-based fallback (backward compatible)
  if (desc) {
    const lower = desc.toLowerCase();
    if (lower.includes("disinflat")) return "DISINFLATIONARY";
    if (lower.includes("accelerat")) return "ACCELERATING";
    if (lower.includes("high") || lower.includes("elevated")) return "HIGH";
    if (lower.includes("rising") || lower.includes("increasing")) return "RISING";
    if (lower.includes("stable") || lower.includes("moderate") || lower.includes("target")) return "STABLE";
  }
  return "INSUFFICIENT_DATA";
}

function classifyInflationDriver(desc: string | null | undefined): InflationDriver {
  if (!desc) return "INSUFFICIENT_DATA";
  const lower = desc.toLowerCase();
  if (lower.includes("supply") && lower.includes("demand")) return "MIXED";
  if (lower.includes("supply")) return "SUPPLY_DRIVEN";
  if (lower.includes("demand")) return "DEMAND_DRIVEN";
  return "INSUFFICIENT_DATA";
}

function classifyRateRegime(
  desc: string | null | undefined,
  us10yYield: number | null | undefined,
  us10yChange: number | null | undefined,
): RateRegime {
  // Text-based classification (backward compatible)
  if (desc) {
    const lower = desc.toLowerCase();
    if (lower.includes("easing") || lower.includes("cut") || lower.includes("dovish")) return "EASING";
    if (lower.includes("tightening") || lower.includes("hike") || lower.includes("hiking") || lower.includes("hawkish")) return "TIGHTENING";
    if (lower.includes("restrictive") || lower.includes("above neutral")) return "RESTRICTIVE";
    if (lower.includes("transition")) return "TRANSITIONING";
    if (lower.includes("neutral") || lower.includes("steady")) return "NEUTRAL";
  }
  // Numeric US10Y classification (Observed: nominal yield change direction)
  if (us10yChange !== null && us10yChange !== undefined) {
    // yield change in bps: positive = rising yields = tightening pressure
    if (us10yChange > 5) return "TIGHTENING";
    if (us10yChange < -5) return "EASING";
    return "NEUTRAL";
  }
  // Has yield level but no change — can only confirm availability
  if (us10yYield !== null && us10yYield !== undefined && us10yYield > 0) {
    return "NEUTRAL"; // Has value but no directional info
  }
  return "INSUFFICIENT_DATA";
}

/**
 * Classify real-yield regime.
 * Real yield = nominal yield - inflation expectations.
 * Derives direction from US10Y change + inflation regime where possible.
 * Never fabricates: returns UNAVAILABLE when evidence is insufficient.
 */
/**
 * Classify real-yield regime.
 * Real yield = nominal yield - inflation expectations.
 * Uses structured inflation data when available for more precise derivation.
 */
function classifyRealYieldRegime(
  desc: string | null | undefined,
  us10yChange: number | null | undefined,
  inflationDesc: string | null | undefined,
  inflationObs?: InflationObservation,
  treasuryData?: TreasuryData,
): RealYieldRegime {
  // OBSERVED: Actual TIPS real-yield data from Treasury feed (takes precedence)
  if (treasuryData && treasuryData.available && treasuryData.latest.real) {
    const real10Y = treasuryData.latest.real.real["10Y"];
    const prevReal = treasuryData.previous?.real?.real["10Y"];
    if (real10Y !== undefined) {
      if (prevReal !== undefined) {
        const realDiff = real10Y - prevReal;
        if (realDiff > 0.03) return "REAL_YIELD_RISING";
        if (realDiff < -0.03) return "REAL_YIELD_FALLING";
        return "REAL_YIELD_STABLE";
      }
      // Has real yield but no previous — can only confirm availability
      return "REAL_YIELD_STABLE";
    }
  }
  // DERIVED with structured inflation data (more precise)
  // Uses absolute pp change since CPI is a percentage
  if (us10yChange !== null && us10yChange !== undefined && inflationObs && inflationObs.availability === "AVAILABLE" && inflationObs.actual !== null && inflationObs.actual !== undefined && inflationObs.previous !== null && inflationObs.previous !== undefined && typeof inflationObs.actual === "number" && typeof inflationObs.previous === "number") {
    const inflationDirection = inflationObs.actual - inflationObs.previous;
    // Nominal yield rising + inflation falling → real yields rising
    if (us10yChange > 3 && inflationDirection < -0.2) return "REAL_YIELD_RISING";
    // Nominal yield falling + inflation rising → real yields falling
    if (us10yChange < -3 && inflationDirection > 0.2) return "REAL_YIELD_FALLING";
    // Both moving same direction → ambiguous
    return "UNAVAILABLE";
  }
  // Text-based classification (backward compatible fallback)
  if (desc) {
    const lower = desc.toLowerCase();
    if (lower.includes("rising") || lower.includes("increasing")) return "REAL_YIELD_RISING";
    if (lower.includes("falling") || lower.includes("declining") || lower.includes("dropping")) return "REAL_YIELD_FALLING";
    if (lower.includes("stable") || lower.includes("flat")) return "REAL_YIELD_STABLE";
  }
  // DERIVED: nominal yield change + inflation text → real-yield pressure
  if (us10yChange !== null && us10yChange !== undefined && inflationDesc) {
    const inflLower = inflationDesc.toLowerCase();
    const isFallingInflation = inflLower.includes("disinflat") || inflLower.includes("falling") || inflLower.includes("declining");
    const isStableInflation = inflLower.includes("stable") || inflLower.includes("moderate") || inflLower.includes("target");
    const isRisingInflation = inflLower.includes("rising") || inflLower.includes("increasing") || inflLower.includes("accelerat") || inflLower.includes("high") || inflLower.includes("elevated");
    if (us10yChange > 3 && (isStableInflation || isFallingInflation)) return "REAL_YIELD_RISING";
    if (us10yChange < -3 && (isStableInflation || isRisingInflation)) return "REAL_YIELD_FALLING";
    return "UNAVAILABLE";
  }
  return "UNAVAILABLE";
}

function classifyCurrencyRegime(
  dxyTrend: string | null | undefined,
  usdIndex: number | null | undefined,
): CurrencyRegime {
  if (dxyTrend) {
    const lower = dxyTrend.toLowerCase();
    if (lower.includes("strength") || lower.includes("rising") || lower.includes("appreciat")) return "STRENGTHENING";
    if (lower.includes("weak") || lower.includes("falling") || lower.includes("declin")) return "WEAKENING";
    if (lower.includes("volatile")) return "VOLATILE";
    if (lower.includes("stable")) return "STABLE";
  }
  if (usdIndex !== null && usdIndex !== undefined && usdIndex > 0) {
    return "STABLE"; // Has a value but no trend info
  }
  return "UNAVAILABLE";
}

function classifyLiquidityRegime(desc: string | null | undefined): LiquidityRegime {
  if (!desc) return "UNAVAILABLE";
  const lower = desc.toLowerCase();
  if (lower.includes("tighten")) return "TIGHTENING";
  if (lower.includes("stress") || lower.includes("crisis")) return "STRESS";
  if (lower.includes("easy") || lower.includes("expansion") || lower.includes("loose")) return "EASY";
  if (lower.includes("neutral") || lower.includes("normal")) return "NEUTRAL";
  return "UNAVAILABLE";
}

/**
 * Classify growth regime.
 * Uses structured GrowthObservation when available (OBSERVED data takes precedence).
 * Falls back to text-based classification.
 */
function classifyGrowthRegime(
  desc: string | null | undefined,
  growthObs?: GrowthObservation,
): GrowthRegime {
  // OBSERVED: Structured growth data from economic calendar events
  if (growthObs && growthObs.availability === "AVAILABLE" && growthObs.dataPointCount > 0) {
    // PMI/ISM: >50 = expansion, <50 = contraction
    const pmiVal = growthObs.pmiActual ?? growthObs.ismActual;
    const pmiPrev = growthObs.pmiPrevious ?? growthObs.ismPrevious;
    if (pmiVal !== null && pmiVal !== undefined && typeof pmiVal === "number") {
      if (pmiVal >= 55) return "EXPANDING";
      if (pmiVal >= 50 && pmiPrev !== null && pmiPrev !== undefined && typeof pmiPrev === "number") {
        if (pmiVal > pmiPrev) return "EXPANDING"; // Improving
        if (pmiVal < pmiPrev) return "SLOWING"; // Still >50 but decelerating
        return "EXPANDING";
      }
      if (pmiVal >= 50) return "EXPANDING";
      if (pmiVal >= 45) return "SLOWING";
      return "CONTRACTING";
    }
    // GDP: positive = expanding, negative = contracting
    if (growthObs.gdpActual !== null && growthObs.gdpActual !== undefined && typeof growthObs.gdpActual === "number") {
      if (growthObs.gdpActual > 3) return "EXPANDING";
      if (growthObs.gdpActual > 0) return "EXPANDING";
      if (growthObs.gdpActual > -1) return "SLOWING";
      return "CONTRACTING";
    }
  }
  // Text-based fallback
  if (desc) {
    const lower = desc.toLowerCase();
    if (lower.includes("contract") || lower.includes("recession")) return "CONTRACTING";
    if (lower.includes("slow")) return "SLOWING";
    if (lower.includes("recover")) return "RECOVERING";
    if (lower.includes("expand") || lower.includes("grow") || lower.includes("strong")) return "EXPANDING";
  }
  return "UNAVAILABLE";
}

/**
 * Classify employment regime.
 * Uses structured EmploymentObservation when available.
 * DERIVED from actual provider data — never fabricated.
 */
function classifyEmploymentRegime(
  obs?: EmploymentObservation,
): "STRONG" | "STABLE" | "WEAKENING" | "STRESSED" | "UNAVAILABLE" {
  if (!obs || obs.availability !== "AVAILABLE") return "UNAVAILABLE";

  // NFP: >200k = strong, 100-200k = stable, <100k = weakening, negative = stressed
  if (obs.nfpActual !== null && obs.nfpActual !== undefined && typeof obs.nfpActual === "number") {
    if (obs.nfpActual >= 200) return "STRONG";
    if (obs.nfpActual >= 100) return "STABLE";
    if (obs.nfpActual >= 0) return "WEAKENING";
    return "STRESSED";
  }

  // Unemployment: <4% = strong, 4-5% = stable, 5-6% = weakening, >6% = stressed
  if (obs.unemploymentActual !== null && obs.unemploymentActual !== undefined && typeof obs.unemploymentActual === "number") {
    if (obs.unemploymentActual < 4) return "STRONG";
    if (obs.unemploymentActual < 5) return "STABLE";
    if (obs.unemploymentActual < 6) return "WEAKENING";
    return "STRESSED";
  }

  return "UNAVAILABLE";
}

/**
 * Classify consumer confidence.
 * DERIVED from actual provider data.
 */
function classifyConsumerConfidence(
  obs?: ConsumerConfidenceObservation,
): "STRONG" | "STABLE" | "WEAKENING" | "UNAVAILABLE" {
  if (!obs || obs.availability !== "AVAILABLE") return "UNAVAILABLE";
  if (obs.actual !== null && obs.actual !== undefined && typeof obs.actual === "number") {
    if (obs.actual >= 110) return "STRONG";
    if (obs.actual >= 90) return "STABLE";
    return "WEAKENING";
  }
  return "UNAVAILABLE";
}

function classifyEnergyRegime(
  oilChange: string | null | undefined,
  oilPrice: number | null | undefined,
): EnergyRegime {
  if (oilChange) {
    const lower = oilChange.toLowerCase();
    if (lower.includes("shock") || lower.includes("spike") || lower.includes("surge")) return "OIL_SHOCK";
    if (lower.includes("disrupt") || lower.includes("supply cut")) return "SUPPLY_DISRUPTION";
    if (lower.includes("demand")) return "DEMAND_DRIVEN";
    if (lower.includes("balanced") || lower.includes("stable")) return "BALANCED";
  }
  if (oilPrice !== null && oilPrice !== undefined && oilPrice > 0) {
    return "BALANCED"; // Has a value but no event
  }
  return "UNAVAILABLE";
}

function classifyGeopoliticalRegime(desc: string | null | undefined): GeopoliticalRegime {
  if (!desc) return "INSUFFICIENT_DATA";
  const lower = desc.toLowerCase();
  if (lower.includes("de-escalat") || lower.includes("ceasefire") || lower.includes("peace")) return "DE_ESCALATING";
  if (lower.includes("escalat") || lower.includes("war") || lower.includes("conflict")) return "ESCALATING";
  if (lower.includes("high") || lower.includes("severe") || lower.includes("critical")) return "HIGH";
  if (lower.includes("elevated") || lower.includes("moderate")) return "ELEVATED";
  if (lower.includes("low") || lower.includes("calm")) return "LOW";
  return "INSUFFICIENT_DATA";
}

/**
 * Classify inflation expectation surprise from structured data.
 * DERIVED — not an observation itself, but a comparison of observation vs expectation.
 * No probability claims. Only ABOVE/BELOW/IN_LINE/UNAVAILABLE.
 */
function classifyInflationExpectationSurprise(
  obs?: InflationObservation,
): InflationExpectationSurprise {
  if (!obs || obs.availability !== "AVAILABLE") return "UNAVAILABLE";
  if (obs.actual === null || obs.actual === undefined || obs.forecast === null || obs.forecast === undefined) return "UNAVAILABLE";
  if (typeof obs.actual !== "number" || typeof obs.forecast !== "number") return "UNAVAILABLE";
  const diff = obs.actual - obs.forecast;
  const threshold = Math.abs(obs.forecast) * 0.005; // 0.5% relative threshold
  if (diff > threshold) return "ABOVE_EXPECTATION";
  if (diff < -threshold) return "BELOW_EXPECTATION";
  return "IN_LINE";
}

/**
 * Classify central bank policy-rate regime.
 * This is DISTINCT from US10Y (market yield).
 * Policy rate = central bank decision. US10Y = market-priced yield.
 */
function classifyPolicyRateRegime(obs?: PolicyRateObservation): PolicyRateRegime {
  if (!obs || obs.availability !== "AVAILABLE") return "INSUFFICIENT_DATA";
  // Use explicit decision classification if available (OBSERVED)
  if (obs.decision === "RATE_HIKE") return "TIGHTENING";
  if (obs.decision === "RATE_CUT") return "EASING";
  if (obs.decision === "HOLD") return "NEUTRAL";
  // Derive from rate change direction (DERIVED)
  if (obs.current !== null && obs.current !== undefined && obs.previous !== null && obs.previous !== undefined && typeof obs.current === "number" && typeof obs.previous === "number") {
    const diff = obs.current - obs.previous;
    if (diff > 0.1) return "TIGHTENING";
    if (diff < -0.1) return "EASING";
    return "NEUTRAL";
  }
  // Has value but no directional info
  if (obs.current !== null && obs.current !== undefined) return "NEUTRAL";
  return "INSUFFICIENT_DATA";
}

function classifyOverallRegime(
  vix: number | null,
  riskRegime: RiskRegime | undefined,
  liquidity: LiquidityRegime,
  growth: GrowthRegime,
  geopolitical: GeopoliticalRegime,
  dataQuality: DimensionAvailability,
): OverallRegime {
  if (dataQuality === "UNAVAILABLE") return "INSUFFICIENT_DATA";

  // Use existing MacroContext risk regime as primary signal
  if (riskRegime === "RISK_OFF") return "RISK_OFF";
  if (riskRegime === "RISK_ON") {
    // Check for stress/growth override
    if (liquidity === "STRESS") return "STRESSED";
    if (growth === "CONTRACTING") return "STRESSED";
    return "RISK_ON";
  }

  // Override based on individual regimes
  if (liquidity === "STRESS" || growth === "CONTRACTING") return "STRESSED";
  if (geopolitical === "ESCALATING" || geopolitical === "HIGH") return "STRESSED";
  if (growth === "RECOVERING") return "RECOVERY";

  return "MIXED";
}

// ═══════════════════════════════════════════════════════════════
// ASSET TRANSMISSION
// ═══════════════════════════════════════════════════════════════

/**
 * Build fundamental context for a specific asset class.
 * Pure function — deterministic transmission mapping.
 */
export function buildAssetFundamentalContext(
  asset: AssetClass,
  regime: FundamentalRegime,
): AssetFundamentalContext {
  const supporting: FundamentalEvidence[] = [];
  const conflicting: FundamentalEvidence[] = [];
  const neutral: FundamentalEvidence[] = [];
  const unavailable: string[] = [];
  const dominant: string[] = [];
  const conflictingDrivers: string[] = [];

  const transmissions = getAssetTransmissions(asset);

  for (const tx of transmissions) {
    const dir = tx.evaluate(regime);
    const evidence: FundamentalEvidence = {
      dimension: tx.dimension,
      direction: dir,
      description: tx.describe(regime),
      source: tx.source,
    };

    switch (dir) {
      case "SUPPORTING":
        supporting.push(evidence);
        dominant.push(tx.dimension);
        break;
      case "CONFLICTING":
        conflicting.push(evidence);
        conflictingDrivers.push(tx.dimension);
        break;
      case "NEUTRAL":
        neutral.push(evidence);
        break;
      case "UNAVAILABLE":
        unavailable.push(tx.dimension);
        break;
    }
  }

  // Determine overall assessment
  let fundamentalAssessment: EvidenceDirection;
  if (regime.dataQuality === "UNAVAILABLE") {
    fundamentalAssessment = "UNAVAILABLE";
  } else if (conflicting.length > supporting.length) {
    fundamentalAssessment = "CONFLICTING";
  } else if (supporting.length > conflicting.length) {
    fundamentalAssessment = "SUPPORTING";
  } else {
    fundamentalAssessment = "NEUTRAL";
  }

  const whatCouldChange = buildWhatCouldChange(asset, regime);
  const whatToMonitor = buildWhatToMonitor(asset, regime);

  return {
    asset,
    fundamentalAssessment,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    neutralEvidence: neutral,
    unavailableDimensions: unavailable,
    dominantMacroDrivers: dominant,
    conflictingMacroDrivers: conflictingDrivers,
    transmissionExplanation: buildTransmissionExplanation(asset, supporting, conflicting),
    whatCouldChangeAssessment: whatCouldChange,
    whatToMonitor,
    dataQuality: regime.dataQuality,
  };
}

// ═══════════════════════════════════════════════════════════════
// TRANSMISSION RULES PER ASSET
// ═══════════════════════════════════════════════════════════════

interface TransmissionRule {
  dimension: string;
  source: string;
  evaluate: (r: FundamentalRegime) => EvidenceDirection;
  describe: (r: FundamentalRegime) => string;
}

function getAssetTransmissions(asset: AssetClass): TransmissionRule[] {
  switch (asset) {
    case "GOLD":
      return goldTransmissions();
    case "SILVER":
      return silverTransmissions();
    case "CRYPTO":
      return cryptoTransmissions();
    case "FOREX":
      return forexTransmissions();
    case "EQUITIES":
      return equitiesTransmissions();
    case "OIL":
      return oilTransmissions();
    case "COMMODITIES":
      return commodityTransmissions();
    default:
      return [];
  }
}

function goldTransmissions(): TransmissionRule[] {
  return [
    {
      dimension: "Real Yields",
      source: "MACRO",
      evaluate: (r) => {
        if (r.realYieldRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.realYieldRegime === "REAL_YIELD_FALLING" ? "SUPPORTING" :
               r.realYieldRegime === "REAL_YIELD_RISING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.realYieldRegime === "REAL_YIELD_FALLING"
        ? "Falling real yields are supportive for non-yielding stores of value"
        : r.realYieldRegime === "REAL_YIELD_RISING"
          ? "Rising real yields create headwinds for gold"
          : "Real yields are stable — neutral for gold",
    },
    {
      dimension: "Currency (USD)",
      source: "MACRO",
      evaluate: (r) => {
        if (r.currencyRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.currencyRegime === "WEAKENING" ? "SUPPORTING" :
               r.currencyRegime === "STRENGTHENING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.currencyRegime === "WEAKENING"
        ? "Weakening USD is supportive for gold priced in dollars"
        : r.currencyRegime === "STRENGTHENING"
          ? "Strengthening USD creates headwinds for gold"
          : "USD is stable — neutral for gold",
    },
    {
      dimension: "Inflation",
      source: "MACRO",
      evaluate: (r) => {
        if (r.inflationRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return (r.inflationRegime === "RISING" || r.inflationRegime === "HIGH" || r.inflationRegime === "ACCELERATING")
          ? "SUPPORTING" : "NEUTRAL";
      },
      describe: (r) => (r.inflationRegime === "RISING" || r.inflationRegime === "HIGH")
        ? "Elevated inflation supports gold as an inflation hedge"
        : "Inflation is not elevated — limited gold-specific signal",
    },
    {
      dimension: "Geopolitical Risk",
      source: "NEWS",
      evaluate: (r) => {
        if (r.geopoliticalRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return (r.geopoliticalRegime === "ESCALATING" || r.geopoliticalRegime === "HIGH")
          ? "SUPPORTING" : "NEUTRAL";
      },
      describe: (r) => (r.geopoliticalRegime === "ESCALATING" || r.geopoliticalRegime === "HIGH")
        ? "Elevated geopolitical risk supports safe-haven demand for gold"
        : "Geopolitical risk is not elevated — limited safe-haven signal",
    },
    {
      dimension: "Risk Sentiment",
      source: "MACRO",
      evaluate: (r) => {
        if (r.overallRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return r.overallRegime === "RISK_OFF" ? "SUPPORTING" :
               r.overallRegime === "RISK_ON" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.overallRegime === "RISK_OFF"
        ? "Risk-off environment supports safe-haven gold demand"
        : r.overallRegime === "RISK_ON"
          ? "Risk-on environment reduces safe-haven demand for gold"
          : "Mixed risk environment — limited directional signal for gold",
    },
  ];
}

function silverTransmissions(): TransmissionRule[] {
  return [
    {
      dimension: "Gold Relationship",
      source: "CROSS_ASSET",
      evaluate: (r) => r.dataQuality === "UNAVAILABLE" ? "UNAVAILABLE" : "NEUTRAL",
      describe: () => "Silver partially tracks gold but with higher volatility — relationship is context-dependent",
    },
    {
      dimension: "Growth",
      source: "MACRO",
      evaluate: (r) => {
        if (r.growthRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.growthRegime === "EXPANDING" ? "SUPPORTING" :
               r.growthRegime === "CONTRACTING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.growthRegime === "EXPANDING"
        ? "Industrial demand from growth supports silver"
        : r.growthRegime === "CONTRACTING"
          ? "Contracting growth reduces industrial silver demand"
          : "Growth conditions are neutral for silver",
    },
    {
      dimension: "Currency (USD)",
      source: "MACRO",
      evaluate: (r) => {
        if (r.currencyRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.currencyRegime === "WEAKENING" ? "SUPPORTING" :
               r.currencyRegime === "STRENGTHENING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.currencyRegime === "WEAKENING"
        ? "Weakening USD is supportive for silver"
        : r.currencyRegime === "STRENGTHENING"
          ? "Strengthening USD creates headwinds for silver"
          : "USD is stable — neutral for silver",
    },
  ];
}

function cryptoTransmissions(): TransmissionRule[] {
  return [
    {
      dimension: "Liquidity",
      source: "MACRO",
      evaluate: (r) => {
        if (r.liquidityRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.liquidityRegime === "EASY" ? "SUPPORTING" :
               r.liquidityRegime === "STRESS" || r.liquidityRegime === "TIGHTENING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.liquidityRegime === "EASY"
        ? "Easy monetary conditions are supportive for risk assets including crypto"
        : r.liquidityRegime === "STRESS"
          ? "Liquidity stress creates headwinds for crypto"
          : "Liquidity conditions are neutral for crypto",
    },
    {
      dimension: "Risk Sentiment",
      source: "MACRO",
      evaluate: (r) => {
        if (r.overallRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return r.overallRegime === "RISK_ON" ? "SUPPORTING" :
               r.overallRegime === "RISK_OFF" || r.overallRegime === "STRESSED" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.overallRegime === "RISK_ON"
        ? "Risk-on environment is supportive for crypto"
        : r.overallRegime === "RISK_OFF" || r.overallRegime === "STRESSED"
          ? "Risk-off environment creates headwinds for crypto"
          : "Mixed risk environment — limited directional signal for crypto",
    },
    {
      dimension: "Real Yields",
      source: "MACRO",
      evaluate: (r) => {
        if (r.realYieldRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.realYieldRegime === "REAL_YIELD_FALLING" ? "SUPPORTING" :
               r.realYieldRegime === "REAL_YIELD_RISING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.realYieldRegime === "REAL_YIELD_FALLING"
        ? "Falling real yields reduce the opportunity cost of holding non-yielding crypto"
        : r.realYieldRegime === "REAL_YIELD_RISING"
          ? "Rising real yields increase the opportunity cost of holding crypto"
          : "Real yields are neutral for crypto",
    },
    {
      dimension: "Currency (USD)",
      source: "MACRO",
      evaluate: (r) => {
        if (r.currencyRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.currencyRegime === "WEAKENING" ? "SUPPORTING" :
               r.currencyRegime === "STRENGTHENING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.currencyRegime === "WEAKENING"
        ? "Weakening USD can be supportive for crypto"
        : r.currencyRegime === "STRENGTHENING"
          ? "Strengthening USD creates headwinds for crypto"
          : "USD is stable — neutral for crypto",
    },
  ];
}

function forexTransmissions(): TransmissionRule[] {
  return [
    {
      dimension: "Interest Rate Differential",
      source: "MACRO",
      evaluate: (r) => {
        if (r.rateRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return "NEUTRAL"; // Requires relative comparison, not absolute
      },
      describe: () => "Rate regime is available but forex requires relative rate comparison — context-dependent",
    },
    {
      dimension: "Growth Differential",
      source: "MACRO",
      evaluate: (r) => {
        if (r.growthRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return "NEUTRAL"; // Requires relative comparison
      },
      describe: () => "Growth regime is available but forex requires relative growth comparison",
    },
  ];
}

function equitiesTransmissions(): TransmissionRule[] {
  return [
    {
      dimension: "Interest Rates",
      source: "MACRO",
      evaluate: (r) => {
        if (r.rateRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return r.rateRegime === "TIGHTENING" || r.rateRegime === "RESTRICTIVE" ? "CONFLICTING" :
               r.rateRegime === "EASING" ? "SUPPORTING" : "NEUTRAL";
      },
      describe: (r) => r.rateRegime === "TIGHTENING"
        ? "Tightening monetary policy compresses equity valuations"
        : r.rateRegime === "EASING"
          ? "Easing monetary policy supports equity valuations"
          : "Rate regime is neutral for equities",
    },
    {
      dimension: "Growth",
      source: "MACRO",
      evaluate: (r) => {
        if (r.growthRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.growthRegime === "EXPANDING" ? "SUPPORTING" :
               r.growthRegime === "CONTRACTING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.growthRegime === "EXPANDING"
        ? "Expanding growth supports corporate earnings"
        : r.growthRegime === "CONTRACTING"
          ? "Contracting growth pressures corporate earnings"
          : "Growth conditions are neutral for equities",
    },
    {
      dimension: "Risk Sentiment",
      source: "MACRO",
      evaluate: (r) => {
        if (r.overallRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return r.overallRegime === "RISK_ON" ? "SUPPORTING" :
               r.overallRegime === "RISK_OFF" || r.overallRegime === "STRESSED" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.overallRegime === "RISK_ON"
        ? "Risk-on environment supports equity risk appetite"
        : r.overallRegime === "RISK_OFF"
          ? "Risk-off environment reduces equity risk appetite"
          : "Risk conditions are mixed for equities",
    },
    {
      dimension: "Liquidity",
      source: "MACRO",
      evaluate: (r) => {
        if (r.liquidityRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.liquidityRegime === "EASY" ? "SUPPORTING" :
               r.liquidityRegime === "STRESS" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.liquidityRegime === "EASY"
        ? "Easy liquidity conditions support equity markets"
        : r.liquidityRegime === "STRESS"
          ? "Liquidity stress creates headwinds for equities"
          : "Liquidity conditions are neutral for equities",
    },
  ];
}

function oilTransmissions(): TransmissionRule[] {
  return [
    {
      dimension: "Energy Supply",
      source: "MACRO",
      evaluate: (r) => {
        if (r.energyRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.energyRegime === "SUPPLY_DISRUPTION" || r.energyRegime === "OIL_SHOCK" ? "SUPPORTING" :
               r.energyRegime === "BALANCED" ? "NEUTRAL" : "NEUTRAL";
      },
      describe: (r) => r.energyRegime === "SUPPLY_DISRUPTION"
        ? "Supply disruption creates upward oil price pressure"
        : r.energyRegime === "OIL_SHOCK"
          ? "Oil shock conditions create strong upward price pressure"
          : "Energy supply conditions are balanced",
    },
    {
      dimension: "Growth",
      source: "MACRO",
      evaluate: (r) => {
        if (r.growthRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.growthRegime === "EXPANDING" ? "SUPPORTING" :
               r.growthRegime === "CONTRACTING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.growthRegime === "EXPANDING"
        ? "Expanding growth supports energy demand"
        : r.growthRegime === "CONTRACTING"
          ? "Contracting growth reduces energy demand"
          : "Growth conditions are neutral for oil",
    },
    {
      dimension: "Geopolitical Risk",
      source: "NEWS",
      evaluate: (r) => {
        if (r.geopoliticalRegime === "INSUFFICIENT_DATA") return "UNAVAILABLE";
        return (r.geopoliticalRegime === "ESCALATING" || r.geopoliticalRegime === "HIGH")
          ? "SUPPORTING" : "NEUTRAL";
      },
      describe: (r) => (r.geopoliticalRegime === "ESCALATING" || r.geopoliticalRegime === "HIGH")
        ? "Geopolitical risk in energy-producing regions supports oil prices"
        : "Geopolitical risk is not elevated for energy markets",
    },
    {
      dimension: "Currency (USD)",
      source: "MACRO",
      evaluate: (r) => {
        if (r.currencyRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.currencyRegime === "WEAKENING" ? "SUPPORTING" :
               r.currencyRegime === "STRENGTHENING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.currencyRegime === "WEAKENING"
        ? "Weakening USD supports nominal commodity prices"
        : r.currencyRegime === "STRENGTHENING"
          ? "Strengthening USD creates headwinds for oil"
          : "USD is stable — neutral for oil",
    },
  ];
}

function commodityTransmissions(): TransmissionRule[] {
  return [
    {
      dimension: "Growth",
      source: "MACRO",
      evaluate: (r) => {
        if (r.growthRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.growthRegime === "EXPANDING" ? "SUPPORTING" :
               r.growthRegime === "CONTRACTING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.growthRegime === "EXPANDING"
        ? "Expanding growth supports commodity demand"
        : r.growthRegime === "CONTRACTING"
          ? "Contracting growth reduces commodity demand"
          : "Growth conditions are neutral for commodities",
    },
    {
      dimension: "Currency (USD)",
      source: "MACRO",
      evaluate: (r) => {
        if (r.currencyRegime === "UNAVAILABLE") return "UNAVAILABLE";
        return r.currencyRegime === "WEAKENING" ? "SUPPORTING" :
               r.currencyRegime === "STRENGTHENING" ? "CONFLICTING" : "NEUTRAL";
      },
      describe: (r) => r.currencyRegime === "WEAKENING"
        ? "Weakening USD supports commodity prices"
        : r.currencyRegime === "STRENGTHENING"
          ? "Strengthening USD creates headwinds for commodities"
          : "USD is stable — neutral for commodities",
    },
  ];
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function buildTransmissionExplanation(
  asset: AssetClass,
  supporting: FundamentalEvidence[],
  conflicting: FundamentalEvidence[],
): string {
  if (supporting.length === 0 && conflicting.length === 0) {
    return `No strong fundamental signal for ${asset} from available macro data.`;
  }
  const parts: string[] = [];
  if (supporting.length > 0) {
    parts.push(`${supporting.length} factor(s) support the asset`);
  }
  if (conflicting.length > 0) {
    parts.push(`${conflicting.length} factor(s) conflict with the asset`);
  }
  return parts.join(". ") + ".";
}

function buildWhatCouldChange(asset: AssetClass, regime: FundamentalRegime): string[] {
  const items: string[] = [];
  if (regime.inflationRegime === "INSUFFICIENT_DATA") {
    items.push("Inflation data becoming available could shift the fundamental picture");
  }
  if (regime.realYieldRegime === "UNAVAILABLE") {
    items.push("Real yield data becoming available would clarify the transmission picture");
  }
  if (regime.overallRegime === "INSUFFICIENT_DATA") {
    items.push("Additional macro data would improve regime classification");
  }
  if (regime.geopoliticalRegime === "ESCALATING" || regime.geopoliticalRegime === "HIGH") {
    items.push("Geopolitical de-escalation could shift safe-haven dynamics");
  }
  return items;
}

function buildWhatToMonitor(asset: AssetClass, regime: FundamentalRegime): string[] {
  const items: string[] = [];
  if (regime.rateRegime === "TRANSITIONING") {
    items.push("Central bank policy transition — monitor for rate direction clarity");
  }
  if (regime.inflationRegime === "ACCELERATING" || regime.inflationRegime === "RISING") {
    items.push("Inflation trajectory — monitor for persistence or reversal");
  }
  if (regime.liquidityRegime === "STRESS") {
    items.push("Liquidity conditions — monitor for stress escalation or recovery");
  }
  if (regime.geopoliticalRegime === "ESCALATING") {
    items.push("Geopolitical developments — monitor for escalation or de-escalation");
  }
  if (items.length === 0) {
    items.push("Continue monitoring macro regime for meaningful changes");
  }
  return items;
}

/**
 * Determine technical vs fundamental alignment.
 */
export function assessTechnicalFundamentalAlignment(
  technicalDirection: EvidenceDirection,
  fundamentalDirection: EvidenceDirection,
): TechnicalFundamentalAlignment {
  let alignment: TechnicalFundamentalAlignment["alignment"];
  let description: string;

  if (technicalDirection === "UNAVAILABLE" || fundamentalDirection === "UNAVAILABLE") {
    alignment = "INSUFFICIENT_DATA";
    description = "Insufficient data to determine technical/fundamental alignment";
  } else if (technicalDirection === "SUPPORTING" && fundamentalDirection === "SUPPORTING") {
    alignment = "BOTH_SUPPORTING";
    description = "Both technical and fundamental evidence support the position";
  } else if (technicalDirection === "CONFLICTING" && fundamentalDirection === "CONFLICTING") {
    alignment = "BOTH_CONFLICTING";
    description = "Both technical and fundamental evidence conflict with the position";
  } else if (technicalDirection === "SUPPORTING" && fundamentalDirection === "CONFLICTING") {
    alignment = "TECHNICAL_SUPPORTING_FUNDAMENTAL_CONFLICTING";
    description = "Technical structure supports the position while fundamental conditions create headwinds";
  } else if (technicalDirection === "CONFLICTING" && fundamentalDirection === "SUPPORTING") {
    alignment = "TECHNICAL_CONFLICTING_FUNDAMENTAL_SUPPORTING";
    description = "Technical structure conflicts with the position while fundamental conditions are supportive";
  } else {
    alignment = "INSUFFICIENT_DATA";
    description = "Mixed or neutral signals from both technical and fundamental analysis";
  }

  return {
    technicalDirection,
    fundamentalDirection,
    alignment,
    description,
  };
}
