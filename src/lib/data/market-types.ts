/**
 * Normalized market data types shared between Convex backend and frontend.
 * Every provider response is mapped into these types before reaching the
 * analysis engine.
 */

export interface OhlcvCandle {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** The primary price snapshot with freshness metadata. */
export interface PriceSnapshot {
  price: number;
  timestamp: number; // Unix ms — when the price was last updated
  source: string; // e.g. "twelve-data"
  bid?: number;
  ask?: number;
}

/** Normalized market data returned by any provider. */
export interface MarketData {
  instrument: string; // Normalized symbol, e.g. "EUR/USD"
  instrumentType: "forex" | "crypto" | "stock" | "commodity" | "indices";
  provider: string;
  fetchTimestamp: number; // When this data was fetched
  price: PriceSnapshot;
  candles: OhlcvCandle[];
  timeframe: string;
  higherTimeframeCandles?: OhlcvCandle[]; // D1 for structural context
  higherTimeframe?: string;
  dataFreshness: "realtime" | "delayed" | "stale" | "unavailable";
  error?: string; // If something went partial
}

/** Structural summary of one timeframe, used for HTF/LTF comparison. */
export interface TimeframeStructureContext {
  timeframe: string;
  structure: "HH/HL" | "LH/LL" | "range" | "unknown";
  bosDirection: "bullish" | "bearish" | "none";
  chochDirection: "bullish" | "bearish" | "none";
  lastSwingHigh?: number;
  lastSwingLow?: number;
  dataPoints: number;
}

/** Technical indicators derived from OHLCV data. */
export interface TechnicalData {
  // Moving averages
  sma50?: number;
  sma100?: number;
  sma200?: number;

  // RSI
  rsi14?: number;
  rsiDivergence?: "bullish" | "bearish" | "none";

  // MACD
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;

  // Market structure
  swingHighs: number[];
  swingLows: number[];
  structure: "HH/HL" | "LH/LL" | "range" | "unknown";
  bosDirection?: "bullish" | "bearish" | "none";
  chochDirection?: "bullish" | "bearish" | "none";

  // Support / Resistance from swing points
  supportLevels: number[];
  resistanceLevels: number[];

  // Fibonacci retracement from last major swing
  fibLevels?: {
    level236: number;
    level382: number;
    level500: number;
    level618: number;
    level786: number;
  };

  // Volume analysis
  avgVolume20?: number;
  volumeTrend: "increasing" | "decreasing" | "stable" | "unknown";

  // Volatility
  atr14?: number;
  dailyRange?: number; // High - Low of latest candle
  dataPoints: number; // How many candles were used

  // Higher-timeframe structural context (e.g. D1 when analyzing H4)
  htfContext?: TimeframeStructureContext;
}

/** What the Convex action returns. */
export interface MarketDataResult {
  success: boolean;
  data?: MarketData;
  technical?: TechnicalData;
  error?: string;
  errorCode?: "API_UNAVAILABLE" | "UNSUPPORTED_INSTRUMENT" | "INSUFFICIENT_DATA" | "RATE_LIMIT" | "AUTH_ERROR";
}
