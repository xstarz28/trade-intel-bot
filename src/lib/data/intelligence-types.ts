/**
 * Normalized intelligence data types for the secondary data layer.
 * Populated by Alpha Vantage for fundamentals, news, sentiment, and macro context.
 */

/** A single news article from Alpha Vantage NEWS_SENTIMENT. */
export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  publishedAt: number; // Unix ms
  summary?: string;
  sentimentScore?: number; // -1.0 to 1.0 (AV provides -1 to 1)
  sentimentLabel?: "positive" | "negative" | "neutral" | "somewhat-positive" | "somewhat-negative";
  relevanceScore?: number; // 0 to 1
  relatedTickers?: string[];
  category?: string; // e.g. "financial-markets", "technology", "earnings"
}

/** Aggregated sentiment from news articles. */
export interface SentimentData {
  provider: string;
  timestamp: number;
  /** Average sentiment score across relevant articles (-1 to 1) */
  averageScore: number;
  /** Number of articles analyzed */
  articleCount: number;
  /** Label derived from average score */
  label: "bullish" | "bearish" | "neutral" | "mixed";
  /** Breakdown by label */
  breakdown: {
    positive: number;
    negative: number;
    neutral: number;
  };
  /** Whether this sentiment has enough data to be reliable */
  confidence: "high" | "medium" | "low" | "unavailable";
  /** Source articles (top 5 most relevant) */
  articles: NewsArticle[];
}

/** Fundamental data for stocks (EPS, earnings, revenue, etc.). */
export interface FundamentalData {
  provider: string;
  timestamp: number;
  instrumentType: "stock" | "forex" | "crypto" | "commodity" | "indices";
  // Stock-specific
  symbol?: string;
  name?: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  peRatio?: number;
  pegRatio?: number;
  bookValue?: number;
  dividendPerShare?: number;
  dividendYield?: number;
  earningsPerShare?: number;
  revenuePerShare?: number;
  profitMargin?: number;
  operatingMargin?: number;
  returnOnEquity?: number;
  priceToBook?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  // Earnings data
  latestEarnings?: {
    date?: string;
    eps?: number;
    revenue?: number;
  };
  // Analyst estimates (if available)
  analystTargetPrice?: number;
  // Forex/Crypto: macro-driven summary
  macroSummary?: string;
  /** Whether this data is available for this asset class */
  available: boolean;
  /** Why it might be unavailable */
  unavailableReason?: string;
}

/** Macro/economic intelligence relevant to the instrument. */
export interface MacroData {
  provider: string;
  timestamp: number;
  /** DXY / Dollar Index trend if relevant */
  dxyTrend?: "rising" | "falling" | "stable";
  /** Key indicators relevant to this instrument */
  indicators: MacroIndicator[];
  /** Overall macro context summary */
  summary: string;
  /** Confidence in macro assessment */
  confidence: "high" | "medium" | "low" | "unavailable";
}

/** A single macro indicator. */
export interface MacroIndicator {
  name: string;
  value?: string;
  description?: string;
  relevance: "high" | "medium" | "low";
  sentiment?: "positive" | "negative" | "neutral";
}

/** Combined intelligence result returned by the Convex action. */
export interface IntelligenceResult {
  success: boolean;
  sentiment?: SentimentData;
  fundamentals?: FundamentalData;
  macro?: MacroData;
  /** Overall intelligence available */
  dataAvailable: {
    news: boolean;
    fundamentals: boolean;
    macro: boolean;
  };
  error?: string;
  errorCode?: "API_UNAVAILABLE" | "RATE_LIMIT" | "AUTH_ERROR" | "NO_DATA";
  /**
   * Phase 178d — how this result was obtained, reported by the provider
   * cache rather than inferred from timing. Diagnostics only; never a
   * substitute for the payload's own observation timestamps.
   */
  acquisition?: "observed-now" | "observed-shared" | "cache-reused";
  /** Phase 178d — original provider observation, preserved across hits. */
  observedAt?: number;
}

/** Error codes from Alpha Vantage. */
export type AlphaVantageErrorCode =
  | "API_UNAVAILABLE"
  | "RATE_LIMIT"
  | "AUTH_ERROR"
  | "NO_DATA"
  | "UNSUPPORTED";
