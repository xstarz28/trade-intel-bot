import type { SentimentData, FundamentalData, MacroData } from "@/lib/data/intelligence-types";
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import type { EconomicCalendarData } from "@/lib/data/calendar-types";

export type InstrumentType = "forex" | "crypto" | "stock" | "commodity" | "indices";

export type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4" | "D1" | "W1";

export type DirectionalBias = "Bullish" | "Bearish" | "Neutral";

export type FactorScore = -2 | -1 | 0 | 1 | 2;

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
}

export interface AnalysisResult {
  id: string;
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  bias: DirectionalBias;
  confidence: number; // 0-100
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
