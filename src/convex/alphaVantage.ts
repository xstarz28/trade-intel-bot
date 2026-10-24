/**
 * Convex server-side action for Alpha Vantage intelligence data.
 * Handles news/sentiment, fundamentals, and macro context.
 * All API keys are read from environment variables — never exposed to client.
 */
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import type {
  NewsArticle,
  SentimentData,
  FundamentalData,
  MacroData,
  IntelligenceResult,
} from "../lib/data/intelligence-types";
import { mapAlphaVantageFundamentalMetrics } from "../lib/data/alpha-vantage-fundamentals";

// ── Simple in-memory cache (resets per Convex action instance) ──
// For production, use Convex scheduled functions or a database cache.
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

// ── Alpha Vantage API ───────────────────────────────────────────

const AV_BASE = "https://www.alphavantage.co/query";

async function avFetch(params: Record<string, string>, apiKey: string): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res = await fetch(`${AV_BASE}?${qs}`);
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status}: ${res.statusText}`);
  }
  const payload: unknown = await res.json();
  if (!isRecord(payload)) throw new Error("Alpha Vantage returned a non-object response.");
  // AV returns "Note" or "Information" on rate limits.
  if (payload.Note || payload.Information) {
    throw new Error("RATE_LIMIT:" + String(payload.Note || payload.Information));
  }
  return payload;
}

// ── Symbol Mapping for Alpha Vantage ────────────────────────────

function mapSymbolForAV(instrument: string, instrumentType: string): string {
  const sym = instrument.toUpperCase().trim();
  if (instrumentType === "crypto") {
    // BTC/USD → BTC, ETH/USD → ETH
    return sym.split("/")[0];
  }
  if (instrumentType === "forex") {
    // EUR/USD → EURUSD
    return sym.replace("/", "");
  }
  // stocks and commodities: use as-is
  return sym;
}

function mapTickerForAV(instrument: string, instrumentType: string): string {
  const sym = instrument.toUpperCase().trim();
  if (instrumentType === "crypto") {
    return sym.split("/")[0];
  }
  if (instrumentType === "forex") {
    return sym.replace("/", "");
  }
  return sym;
}

// ── Main Action ─────────────────────────────────────────────────

export const fetchIntelligence = action({
  args: {
    instrument: v.string(),
    instrumentType: v.union(
      v.literal("forex"),
      v.literal("crypto"),
      v.literal("stock"),
      v.literal("commodity"),
      v.literal("indices"),
    ),
  },
  handler: async (_ctx, args): Promise<IntelligenceResult> => {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        dataAvailable: { news: false, fundamentals: false, macro: false },
        error:
          "Alpha Vantage not configured: ALPHA_VANTAGE_API_KEY is missing. Add it via the Convex CLI: bunx convex env set ALPHA_VANTAGE_API_KEY <your-key>",
        errorCode: "AUTH_ERROR",
      };
    }

    const avSymbol = mapSymbolForAV(args.instrument, args.instrumentType);
    const ticker = mapTickerForAV(args.instrument, args.instrumentType);

    try {
      // Fetch news sentiment (works for all asset types)
      const newsCacheKey = `news:${ticker}`;
      let articles: NewsArticle[] = [];
      let sentiment: SentimentData | undefined;

      const cachedNews = getCached<NewsArticle[]>(newsCacheKey);
      if (cachedNews) {
        articles = cachedNews;
        sentiment = aggregateFromArticles(articles, "alpha-vantage");
      } else {
        try {
          const newsJson = await avFetch(
            {
              function: "NEWS_SENTIMENT",
              tickers: ticker,
              sort: "LATEST",
              limit: "20",
            },
            apiKey,
          );
          articles = normalizeNewsFromAV(newsJson, ticker);
          setCache(newsCacheKey, articles);
          sentiment = aggregateFromArticles(articles, "alpha-vantage");
        } catch (err: unknown) {
          if (errorMessage(err).startsWith("RATE_LIMIT")) {
            return {
              success: false,
              dataAvailable: { news: false, fundamentals: false, macro: false },
              error: "Alpha Vantage rate limit exceeded. Try again later.",
              errorCode: "RATE_LIMIT",
            };
          }
          // News is non-critical — continue without it
          sentiment = {
            provider: "alpha-vantage",
            timestamp: Date.now(),
            averageScore: 0,
            articleCount: 0,
            label: "neutral",
            breakdown: { positive: 0, negative: 0, neutral: 0 },
            confidence: "unavailable",
            articles: [],
          };
        }
      }

      // Fetch fundamentals (stocks only)
      let fundamentals: FundamentalData | undefined;

      if (args.instrumentType === "stock") {
        const fundCacheKey = `fund:${ticker}`;
        const cachedFund = getCached<FundamentalData>(fundCacheKey);
        if (cachedFund) {
          fundamentals = cachedFund;
        } else {
          try {
            const [overviewJson, earningsJson] = await Promise.all([
              avFetch({ function: "OVERVIEW", symbol: avSymbol }, apiKey),
              avFetch({ function: "EARNINGS", symbol: avSymbol }, apiKey),
            ]);
            fundamentals = normalizeFundamentalsFromAV(
              overviewJson,
              earningsJson,
              args.instrumentType,
              ticker,
            );
            setCache(fundCacheKey, fundamentals);
          } catch (err: unknown) {
            if (errorMessage(err).startsWith("RATE_LIMIT")) {
              return {
                success: false,
                dataAvailable: { news: !!articles.length, fundamentals: false, macro: false },
                error: "Alpha Vantage rate limit exceeded during fundamental fetch.",
                errorCode: "RATE_LIMIT",
              };
            }
            fundamentals = {
              provider: "alpha-vantage",
              timestamp: Date.now(),
              instrumentType: args.instrumentType,
              available: false,
              unavailableReason: "Failed to fetch fundamental data.",
            };
          }
        }
      } else {
        fundamentals = {
          provider: "alpha-vantage",
          timestamp: Date.now(),
          instrumentType: args.instrumentType,
          available: false,
          unavailableReason: `Traditional company fundamentals not applicable for ${args.instrumentType} assets.`,
        };
      }

      // Build macro context from news articles
      const macro = buildMacroFromArticles(articles, args.instrumentType);

      return {
        success: true,
        sentiment,
        fundamentals,
        macro,
        dataAvailable: {
          news: articles.length > 0,
          fundamentals: fundamentals?.available ?? false,
          macro: macro.confidence !== "unavailable",
        },
      };
    } catch (err: unknown) {
      return {
        success: false,
        dataAvailable: { news: false, fundamentals: false, macro: false },
        error: `Intelligence fetch failed: ${errorMessage(err)}`,
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});

// ── Normalization (duplicated from client-side for Convex compat) ─

function normalizeNewsFromAV(json: unknown, relatedTicker: string): NewsArticle[] {
  const feedValue = isRecord(json) ? json.feed : undefined;
  const feed = Array.isArray(feedValue) ? feedValue.filter(isRecord) : [];
  const ticker = relatedTicker.toUpperCase();

  return feed
    .filter((item) => typeof item.title === "string" && typeof item.url === "string")
    .map((item): NewsArticle => {
      const tickerSentiments = Array.isArray(item.ticker_sentiment)
        ? item.ticker_sentiment.filter(isRecord)
        : [];
      const tickerSentiment = tickerSentiments.find((entry) => {
        const value = stringValue(entry.ticker)?.toUpperCase();
        return value === ticker || value?.startsWith(ticker) === true;
      });
      const sentimentScore =
        finiteNumber(tickerSentiment?.ticker_sentiment_score) ??
        finiteNumber(item.overall_sentiment_score);
      const relevanceScore = finiteNumber(tickerSentiment?.relevance_score);
      const topics = Array.isArray(item.topics) ? item.topics.filter(isRecord) : [];
      const published = stringValue(item.time_published);
      const summary = stringValue(item.summary);
      const relatedTickers = tickerSentiments
        .map((entry) => stringValue(entry.ticker) ?? "")
        .filter(Boolean);
      const sentimentLabel = mapSentimentLabel(
        stringValue(tickerSentiment?.ticker_sentiment_label) ??
        stringValue(item.overall_sentiment_label),
      );
      return {
        title: String(item.title),
        source: stringValue(item.source) || "Unknown",
        url: String(item.url),
        publishedAt: published ? parseAVTime(published) : Date.now(),
        ...(summary !== undefined ? { summary } : {}),
        ...(sentimentScore !== undefined ? { sentimentScore } : {}),
        ...(sentimentLabel !== undefined ? { sentimentLabel } : {}),
        ...(relevanceScore !== undefined ? { relevanceScore } : {}),
        ...(relatedTickers.length ? { relatedTickers } : {}),
        ...(stringValue(item.category_within_source) ?? stringValue(topics[0]?.topic)
          ? { category: stringValue(item.category_within_source) ?? stringValue(topics[0]?.topic) }
          : {}),
      };
    })
    .sort((a, b) => (b.relevanceScore ?? 0.5) - (a.relevanceScore ?? 0.5))
    .slice(0, 10);
}

function normalizeFundamentalsFromAV(
  overviewValue: unknown,
  earningsValue: unknown,
  instrumentType: string,
  symbol: string,
): FundamentalData {
  const overview = isRecord(overviewValue) ? overviewValue : undefined;
  const earnings = isRecord(earningsValue) ? earningsValue : undefined;
  const base: FundamentalData = {
    provider: "alpha-vantage",
    timestamp: Date.now(),
    instrumentType: instrumentType as FundamentalData["instrumentType"],
    symbol,
    available: false,
  };

  if (instrumentType !== "stock") {
    base.unavailableReason = `Traditional fundamentals not applicable for ${instrumentType}.`;
    return base;
  }

  const providerSymbol = stringValue(overview?.Symbol);
  if (!overview || !providerSymbol) {
    base.unavailableReason = "No fundamental data available for this symbol.";
    return base;
  }

  // Preserve the provider-returned symbol so downstream validation can reject
  // mismatched fundamentals instead of relabeling them as the requested asset.
  base.symbol = providerSymbol.trim().toUpperCase();
  base.available = true;
  base.name = stringValue(overview.Name);
  base.sector = stringValue(overview.Sector);
  base.industry = stringValue(overview.Industry);
  base.marketCap = safeNum(overview.MarketCapitalization);
  base.analystTargetPrice = safeNum(overview.AnalystTargetPrice);
  base.peRatio = safeNum(overview.PERatio);
  Object.assign(base, mapAlphaVantageFundamentalMetrics(overview));
  base.bookValue = safeNum(overview.BookValue);
  base.dividendPerShare = safeNum(overview.DividendPerShare);
  base.dividendYield = safeNum(overview.DividendYield);
  base.earningsPerShare = safeNum(overview.EPS);
  base.revenuePerShare = safeNum(overview.RevenuePerShareTTM);
  base.profitMargin = safeNum(overview.ProfitMargin);
  base.operatingMargin = safeNum(overview.OperatingMarginTTM);
  base.returnOnEquity = safeNum(overview.ReturnOnEquityTTM);
  base.priceToBook = safeNum(overview.PriceToBookRatio);
  base.fiftyTwoWeekHigh = safeNum(overview.FiftyTwoWeekHigh);
  base.fiftyTwoWeekLow = safeNum(overview.FiftyTwoWeekLow);

  const quarterly = Array.isArray(earnings?.quarterlyEarnings)
    ? earnings.quarterlyEarnings.filter(isRecord)
    : [];
  const latest = quarterly[0];
  if (latest) {
    base.latestEarnings = {
      ...(stringValue(latest.fiscalDateEnding) ? { date: stringValue(latest.fiscalDateEnding) } : {}),
      eps: safeNum(latest.reportedEPS),
      revenue: safeNum(latest.reportedRevenue),
    };
  }

  return base;
}

function buildMacroFromArticles(
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
    hawkish: { sentiment: "negative", relevance: "high" },
    dovish: { sentiment: "positive", relevance: "high" },
    recession: { sentiment: "negative", relevance: "high" },
    stimulus: { sentiment: "positive", relevance: "medium" },
    "trade deficit": { sentiment: "negative", relevance: "medium" },
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

  // DXY for forex
  let dxyTrend: MacroData["dxyTrend"] | undefined;
  if (instrumentType === "forex") {
    const dxyArticles = articles.filter(
      (a) => `${a.title} ${a.summary || ""}`.toLowerCase().includes("dollar"),
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
  const highRel = indicators.filter((i) => i.relevance === "high");
  if (highRel.length > 0) parts.push(`Key macro signals: ${highRel.map((i) => i.name).join(", ")}.`);
  const bearish = indicators.filter((i) => i.sentiment === "negative");
  const bullish = indicators.filter((i) => i.sentiment === "positive");
  if (bearish.length > bullish.length) parts.push("Macro context leans bearish.");
  else if (bullish.length > bearish.length) parts.push("Macro context leans supportive.");
  else if (indicators.length > 0) parts.push("Macro signals are mixed.");
  else parts.push("No significant macro indicators detected.");
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

function aggregateFromArticles(articles: NewsArticle[], provider: string): SentimentData {
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
      ? withScores.reduce((s, a) => s + (a.sentimentScore ?? 0), 0) / withScores.length
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

function mapSentimentLabel(label: string | undefined): NewsArticle["sentimentLabel"] {
  if (!label) return undefined;
  const l = label.toLowerCase().trim();
  if (l.includes("bullish") || l === "positive") return "positive";
  if (l.includes("bearish") || l === "negative") return "negative";
  if (l.includes("somewhat-bullish") || l === "somewhat-positive") return "somewhat-positive";
  if (l.includes("somewhat-bearish") || l === "somewhat-negative") return "somewhat-negative";
  return "neutral";
}

function parseAVTime(timeStr: string): number {
  // AV format: "20240101T120000" or "20240101T120000.000"
  try {
    const cleaned = timeStr.replace(/\.\d+$/, "");
    const y = parseInt(cleaned.slice(0, 4));
    const m = parseInt(cleaned.slice(4, 6)) - 1;
    const d = parseInt(cleaned.slice(6, 8));
    const h = parseInt(cleaned.slice(9, 11));
    const min = parseInt(cleaned.slice(11, 13));
    const s = parseInt(cleaned.slice(13, 15)) || 0;
    return new Date(y, m, d, h, min, s).getTime();
  } catch {
    return Date.now();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && (value.trim() === "" || value.trim() === "-")) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeNum(val: unknown): number | undefined {
  return finiteNumber(val);
}
