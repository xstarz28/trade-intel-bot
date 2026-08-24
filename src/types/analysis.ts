import type { SentimentData, FundamentalData, MacroData } from "@/lib/data/intelligence-types";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import type { EconomicCalendarData } from "@/lib/data/calendar-types";

export type InstrumentType = "forex" | "crypto" | "stock" | "commodity" | "indices";

export type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4" | "D1" | "W1";

export type DirectionalBias = "Bullish" | "Bearish" | "Neutral";

export type FactorScore = -2 | -1 | 0 | 1 | 2;

/** Actionable recommendation. The engine may actively refuse to trade. */
export type Recommendation = "LONG" | "SHORT" | "NO_TRADE";

/** Qualitative conviction — reflects actual confluence strength, NOT accuracy.
 *  Only present when recommendation is LONG or SHORT. */
export type ConvictionLevel = "High" | "Medium" | "Low";

/** A trade plan whose every level is market-derived. Absent for NO_TRADE. */
export interface TradePlan {
  direction: "long" | "short";
  entry: string;
  entryBasis: string;
  stopLoss: string;
  /** Where the stop comes from — e.g. "nearest swing low (structural)" */
  slBasis: string;
  takeProfit: string;
  tpBasis: string;
  riskReward: number;
  // ── Phase 3A multi-timeframe context (present when MTF data exists) ──
  /** Direction of the highest available HTF, e.g. "D1 bullish external structure". */
  htfBias?: string;
  /** Timeframe whose structure produced the setup. */
  setupTimeframe?: string;
  /** Timeframe whose trigger refined the entry. */
  triggerTimeframe?: string;
}

/** Higher-timeframe vs lower-timeframe relationship. */
export interface HtfAlignment {
  htfTimeframe: string;
  htfStructure: "HH/HL" | "LH/LL" | "range" | "unknown";
  state:
    | "aligned"
    | "counter_trend"
    | "htf_unknown"
    | "ltf_unclear";
}

/** Compact MTF summary surfaced on the result for UI transparency. */
export interface MtfSummary {
  alignment:
    | "ALIGNED_BULLISH"
    | "ALIGNED_BEARISH"
    | "MIXED"
    | "COUNTER_TREND"
    | "INSUFFICIENT_DATA";
  /** Timeframes actually used, highest first. */
  chainUsed: string[];
  /** Chain slots that could not be fetched — never synthesized. */
  unavailable: { timeframe: string; reason: string }[];
  /** Highest available HTF direction. */
  htfBias: "long" | "short" | "none";
  setupTimeframe: string;
  triggerTimeframe?: string;
}

export interface BiasBreakdown {
  trend: FactorScore;
  indicator: FactorScore;
  fundamental: FactorScore;
  sentiment: FactorScore;
}

export interface KeyLevels {
  support: string;
  resistance: string;
  invalidation: string;
}

export interface AnalysisInput {
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  // Optional user-supplied data (fallback when auto-fetch is unavailable)
  currentPrice?: string;
  recentHigh?: string;
  recentLow?: string;
  newsContext?: string;
  economicEvents?: string;
  fundingRate?: string;
  openInterest?: string;
  // Auto-fetched market data (preferred over manual inputs)
  marketData?: import("@/lib/data/market-types").MarketData;
  technicalData?: import("@/lib/data/market-types").TechnicalData;
  // Secondary intelligence layer (Alpha Vantage)
  sentimentData?: SentimentData;
  fundamentalData?: FundamentalData;
  macroData?: MacroData;
  // Crypto derivatives layer (CoinGlass)
  derivativesData?: CryptoDerivativesData;
  // Economic calendar layer (Trading Economics)
  calendarData?: EconomicCalendarData;
  // ── Phase 3B: risk model inputs (all optional; sizing stays unavailable
  // unless every required piece is genuinely provided) ──
  /** Account equity in account currency, user-provided. */
  accountEquity?: number;
  /** Risk per trade as a fraction of equity (e.g. 0.01 = 1%). User-chosen. */
  riskPercent?: number;
  /** Provider/broker instrument specification. Sizing is impossible without it. */
  instrumentSpec?: import("@/lib/risk").InstrumentSpec;
  /** Explicit account currency (e.g. "USD", "EUR"). Never assumed.
   *  When omitted, sizing stays denominated in the quote currency. */
  accountCurrency?: string;
  /** Live provider FX snapshots for quote→account conversion (Phase 4).
   *  direct = QUOTE/ACCOUNT pair, inverse = ACCOUNT/QUOTE pair. */
  fxRates?: {
    direct?: import("@/lib/risk").FxRateSnapshot;
    inverse?: import("@/lib/risk").FxRateSnapshot;
  };
}

export interface AnalysisResult {
  id: string;
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  bias: DirectionalBias;
  confidence: number; // 0-100 — evidence strength score
  /** Actionable decision — may be NO_TRADE even when bias is directional. */
  recommendation: Recommendation;
  /** Qualitative conviction; undefined for NO_TRADE (never forced into Low). */
  conviction?: ConvictionLevel;
  /** Explicit reasons why the setup was rejected. Empty for valid setups. */
  noTradeReasons: string[];
  /** Market-derived trade plan; ALWAYS undefined for NO_TRADE (state integrity). */
  tradePlan?: TradePlan;
  /** HTF vs LTF relationship used in the decision. */
  htfAlignment?: HtfAlignment;
  /** Adaptive multi-timeframe summary (Phase 3A) when MTF data exists. */
  mtfSummary?: MtfSummary;
  /** Phase 5 — multi-evidence market regime (UNKNOWN when evidence is thin). */
  marketRegime?: import("@/lib/market-context").MarketRegimeInfo;
  /** Phase 5 — explicit setup classification (context/evidence, not a UI label). */
  setupClassification?: import("@/lib/market-context").SetupClassificationInfo;
  /** Phase 5 — cross-layer contradictions with severity. */
  keyContradictions?: import("@/lib/market-context").ContradictionItem[];
  /** Position sizing — present ONLY for LONG/SHORT AND fully computable
   *  from real user inputs + a complete InstrumentSpec. Never fabricated. */
  positionSizing?: import("@/lib/risk").PositionSizingResult;
  technicalSummary: string;
  fundamentalSummary: string;
  breakdown: BiasBreakdown;
  keyLevels: KeyLevels;
  riskNote: string;
  dataCompleteness: "full" | "partial" | "limited";
  dataFlags: string[];
  timestamp: number;
  // Market data metadata
  priceSnapshot?: import("@/lib/data/market-types").PriceSnapshot;
  technicalData?: import("@/lib/data/market-types").TechnicalData;
  dataSource?: string;
  // Intelligence layer metadata
  sentimentData?: SentimentData;
  fundamentalData?: FundamentalData;
  macroData?: MacroData;
  // Crypto derivatives metadata
  derivativesData?: CryptoDerivativesData;
  // Economic calendar metadata
  calendarData?: EconomicCalendarData;
}
