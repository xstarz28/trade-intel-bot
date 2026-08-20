/**
 * Alpha Vantage API response normalization.
 * Pure functions that transform raw AV responses into our normalized types.
 * These can run in Convex server-side actions or be used for type-safe testing.
 */

import type {
  NewsArticle,
  SentimentData,
  FundamentalData,
  MacroData,
} from "../intelligence-types";

// ── News / Sentiment Normalization ──────────────────────────────

export interface RawNewsFeed {
  items?: string;
  feed?: Array<{
    title?: string;
    url?: string;
    summary?: string;
    source?: string;
    overall_sentiment_score?: string;
    overall_sentiment_label?: string;
    banner_image?: string;
    category_within_source?: string;
    time_published?: string;
    topics?: Array<{
      topic?: string;
      relevance_score?: string;
    }>;
    ticker_sentiment?: Array<{
      ticker?: string;
      relevance_score?: string;
      ticker_sentiment_score?: string;
      ticker_sentiment_label?: string;
    }>;
  }>;
}

/**
 * Normalize raw Alpha Vantage NEWS_SENTIMENT feed into NewsArticle[].
 */
export function normalizeNewsArticles(
  feed: RawNewsFeed["feed"],
  relatedSymbol: string,
): NewsArticle[] {
  if (!feed || !Array.isArray(feed)) return [];

  const normalized = feed
    .filter((item) => item.title && item.url)
    .map((item) => {
      const tickerSentiment = item.ticker_sentiment?.find(
        (ts) =>
          ts.ticker?.toUpperCase() === relatedSymbol.toUpperCase().replace("/", "_") ||
          ts.ticker?.toUpperCase() === relatedSymbol.toUpperCase().replace("USD", ""),
      );

      return {
        title: item.title!,
        source: item.source || "Unknown",
        url: item.url!,
        publishedAt: item.time_published ? parseAVTime(item.time_published) : Date.now(),
        summary: item.summary,
        sentimentScore: tickerSentiment?.ticker_sentiment_score
          ? parseFloat(tickerSentiment.ticker_sentiment_score)
          : item.overall_sentiment_score
            ? parseFloat(item.overall_sentiment_score)
            : undefined,
        sentimentLabel: mapSentimentLabel(
          tickerSentiment?.ticker_sentiment_label || item.overall_sentiment_label,
        ),
        relevanceScore: tickerSentiment?.relevance_score
          ? parseFloat(tickerSentiment.relevance_score)
          : undefined,
        relatedTickers: item.ticker_sentiment?.map((ts) => ts.ticker || "").filter(Boolean),
        category: item.category_within_source || item.topics?.[0]?.topic,
      };
    });

  // Sort by relevance
  normalized.sort((a, b) => {
    const scoreA = (a.relevanceScore ?? 0.5);
    const scoreB = (b.relevanceScore ?? 0.5);
    return scoreB - scoreA;
  });

  return normalized.slice(0, 10);
}

/**
 * Aggregate news articles into a SentimentData summary.
 */
export function aggregateSentiment(
  articles: NewsArticle[],
  provider: string,
): SentimentData {
  if (articles.length === 0) {
    return {
      provider,
      timestamp: Date.now(),
      averageScore: 0,
      articleCount: 0,
      label: "neutral",
      breakdown: { positive: 0, negative: 0, neutral: 0 },
      confidence: "unavailable",
      articles: [],
    };
  }

  const withScores = articles.filter((a) => a.sentimentScore !== undefined);
  const avgScore =
    withScores.length > 0
      ? withScores.reduce((sum, a) => sum + (a.sentimentScore ?? 0), 0) / withScores.length
      : 0;

  let label: SentimentData["label"] = "neutral";
  if (avgScore > 0.15) label = "bullish";
  else if (avgScore < -0.15) label = "bearish";
  else if (withScores.length > 0) label = "mixed";

  const positive = withScores.filter((a) => (a.sentimentScore ?? 0) > 0.15).length;
  const negative = withScores.filter((a) => (a.sentimentScore ?? 0) < -0.15).length;
  const neutral = withScores.length - positive - negative;

  let confidence: SentimentData["confidence"] = "low";
  if (withScores.length >= 5) confidence = "medium";
  if (withScores.length >= 8) confidence = "high";
  if (withScores.length === 0) confidence = "unavailable";

  return {
    provider,
    timestamp: Date.now(),
    averageScore: Math.round(avgScore * 1000) / 1000,
    articleCount: withScores.length,
    label,
    breakdown: { positive, negative, neutral },
    confidence,
    articles: articles.slice(0, 5),
  };
}

// ── Fundamental Data Normalization ──────────────────────────────

export interface RawOverview {
  Symbol?: string;
  Name?: string;
  Sector?: string;
  Industry?: string;
  MarketCapitalization?: string;
  PERatio?: string;
  PEGRatio?: string;
  BookValue?: string;
  DividendPerShare?: string;
  DividendYield?: string;
  EPS?: string;
  RevenuePerShareTTM?: string;
  ProfitMargin?: string;
  OperatingMarginTTM?: string;
  ReturnOnEquityTTM?: string;
  PriceToBookRatio?: string;
  FiftyTwoWeekHigh?: string;
  FiftyTwoWeekLow?: string;
}

export interface RawEarnings {
  annualEarnings?: Array<{
    fiscalDateEnding?: string;
    reportedEPS?: string;
  }>;
  quarterlyEarnings?: Array<{
    fiscalDateEnding?: string;
    reportedDate?: string;
    reportedEPS?: string;
    reportedRevenue?: string;
  }>;
}

/**
 * Normalize Alpha Vantage OVERVIEW + EARNINGS into FundamentalData.
 */
export function normalizeFundamentals(
  overview: RawOverview | null,
  earnings: RawEarnings | null,
  instrumentType: string,
  symbol: string,
): FundamentalData {
  const base: FundamentalData = {
    provider: "alpha-vantage",
    timestamp: Date.now(),
    instrumentType: instrumentType as FundamentalData["instrumentType"],
    symbol,
    available: false,
  };

  if (instrumentType !== "stock") {
    base.unavailableReason = `Traditional company fundamentals not applicable for ${instrumentType} assets.`;
    return base;
  }

  if (!overview || !overview.Symbol) {
    base.unavailableReason = "Fundamental data not available for this symbol.";
    return base;
  }

  base.available = true;
  base.name = overview.Name;
  base.sector = overview.Sector;
  base.industry = overview.Industry;
  base.marketCap = safeNumber(overview.MarketCapitalization);
  base.peRatio = safeNumber(overview.PERatio);
  base.pegRatio = safeNumber(overview.PEGRatio);
  base.bookValue = safeNumber(overview.BookValue);
  base.dividendPerShare = safeNumber(overview.DividendPerShare);
  base.dividendYield = safeNumber(overview.DividendYield);
  base.earningsPerShare = safeNumber(overview.EPS);
  base.revenuePerShare = safeNumber(overview.RevenuePerShareTTM);
  base.profitMargin = safeNumber(overview.ProfitMargin);
  base.operatingMargin = safeNumber(overview.OperatingMarginTTM);
  base.returnOnEquity = safeNumber(overview.ReturnOnEquityTTM);
  base.priceToBook = safeNumber(overview.PriceToBookRatio);
  base.fiftyTwoWeekHigh = safeNumber(overview.FiftyTwoWeekHigh);
  base.fiftyTwoWeekLow = safeNumber(overview.FiftyTwoWeekLow);

  if (earnings?.quarterlyEarnings?.length) {
    const latest = earnings.quarterlyEarnings[0];
    base.latestEarnings = {
      date: latest.fiscalDateEnding,
      eps: safeNumber(latest.reportedEPS),
      revenue: safeNumber(latest.reportedRevenue),
    };
  }

  return base;
}

// ── Macro Data Normalization ────────────────────────────────────

/**
 * Build macro context from news articles and available indicators.
 */
export function buildMacroContext(
  articles: NewsArticle[],
  instrumentType: string,
): MacroData {
  const indicators: MacroData["indicators"] = [];

  const macroKeywords: Record<string, { sentiment: "positive" | "negative" | "neutral"; relevance: "high" | "medium" | "low" }> = {
    inflation: { sentiment: "negative", relevance: "high" },
    "rate hike": { sentiment: "negative", relevance: "high" },
    "rate cut": { sentiment: "positive", relevance: "high" },
    gdp: { sentiment: "positive", relevance: "high" },
    employment: { sentiment: "positive", relevance: "medium" },
    unemployment: { sentiment: "negative", relevance: "medium" },
    "consumer price": { sentiment: "negative", relevance: "high" },
    "retail sales": { sentiment: "positive", relevance: "medium" },
    "federal reserve": { sentiment: "neutral", relevance: "high" },
    fed: { sentiment: "neutral", relevance: "high" },
    hawkish: { sentiment: "negative", relevance: "high" },
    dovish: { sentiment: "positive", relevance: "high" },
    "trade deficit": { sentiment: "negative", relevance: "medium" },
    "bond yield": { sentiment: "neutral", relevance: "medium" },
    recession: { sentiment: "negative", relevance: "high" },
    stimulus: { sentiment: "positive", relevance: "medium" },
    quantitative: { sentiment: "neutral", relevance: "high" },
  };

  const seen = new Set<string>();

  for (const article of articles) {
    const text = `${article.title} ${article.summary || ""}`.toLowerCase();
    for (const [kw, meta] of Object.entries(macroKeywords)) {
      if (text.includes(kw) && !seen.has(kw)) {
        seen.add(kw);
        indicators.push({
          name: kw.charAt(0).toUpperCase() + kw.slice(1),
          description: article.title,
          relevance: meta.relevance,
          sentiment: meta.sentiment,
        });
      }
    }
  }

  // For forex, check DXY mentions
  let dxyTrend: MacroData["dxyTrend"] | undefined;
  if (instrumentType === "forex") {
    const dxyArticles = articles.filter(
      (a) =>
        `${a.title} ${a.summary || ""}`.toLowerCase().includes("dollar") ||
        `${a.title} ${a.summary || ""}`.toLowerCase().includes("dxy"),
    );
    if (dxyArticles.length > 0) {
      const pos = dxyArticles.filter((a) => (a.sentimentScore ?? 0) > 0.1).length;
      const neg = dxyArticles.filter((a) => (a.sentimentScore ?? 0) < -0.1).length;
      if (pos > neg + 1) dxyTrend = "rising";
      else if (neg > pos + 1) dxyTrend = "falling";
      else dxyTrend = "stable";
    }
  }

  const parts: string[] = [];
  if (indicators.length > 0) {
    const highRel = indicators.filter((ind) => ind.relevance === "high");
    if (highRel.length > 0) parts.push(`Key macro signals: ${highRel.map((ind) => ind.name).join(", ")}.`);
    const bearish = indicators.filter((ind) => ind.sentiment === "negative");
    const bullish = indicators.filter((ind) => ind.sentiment === "positive");
    if (bearish.length > bullish.length) parts.push("Macro context leans bearish.");
    else if (bullish.length > bearish.length) parts.push("Macro context leans supportive.");
    else parts.push("Macro signals are mixed.");
  } else {
    parts.push("No significant macro indicators detected.");
  }
  if (dxyTrend) parts.push(`USD trend: ${dxyTrend}.`);

  let confidence: MacroData["confidence"] = "low";
  if (indicators.length >= 3) confidence = "medium";
  if (indicators.length >= 5) confidence = "high";
  if (articles.length === 0) confidence = "unavailable";

  return {
    provider: "alpha-vantage",
    timestamp: Date.now(),
    dxyTrend,
    indicators: indicators.slice(0, 10),
    summary: parts.join(" "),
    confidence,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function safeNumber(val: string | undefined): number | undefined {
  if (val === undefined || val === null || val === "" || val === "-") return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

function mapSentimentLabel(
  label: string | undefined,
): NewsArticle["sentimentLabel"] {
  if (!label) return undefined;
  const l = label.toLowerCase().trim();
  if (l.includes("bullish") || l === "positive") return "positive";
  if (l.includes("bearish") || l === "negative") return "negative";
  if (l.includes("somewhat-bullish") || l === "somewhat-positive") return "somewhat-positive";
  if (l.includes("somewhat-bearish") || l === "somewhat-negative") return "somewhat-negative";
  return "neutral";
}

function parseAVTime(timeStr: string): number {
  try {
    const cleaned = timeStr.replace(/\.\d+$/, "");
    const y = parseInt(cleaned.slice(0, 4));
    const mo = parseInt(cleaned.slice(4, 6)) - 1;
    const d = parseInt(cleaned.slice(6, 8));
    const h = parseInt(cleaned.slice(9, 11));
    const min = parseInt(cleaned.slice(11, 13));
    const s = parseInt(cleaned.slice(13, 15)) || 0;
    return new Date(y, mo, d, h, min, s).getTime();
  } catch {
    return Date.now();
  }
}
