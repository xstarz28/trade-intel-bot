/**
 * Convex server-side action for Alpha Vantage intelligence data.
 * Handles news/sentiment, fundamentals, and macro context.
 * All API keys are read from environment variables — never exposed to client.
 */
"use node";

import { action } from "./_generated/server";
import { requireIdentity } from "./lib/requireIdentity";
import { v } from "convex/values";
import type {
  NewsArticle,
  SentimentData,
  FundamentalData,
  MacroData,
  IntelligenceResult,
} from "../lib/data/intelligence-types";

// ── Phase 178b — authoritative provider cache ───────────────────
// This module previously kept its own `Map` cache. That created split cache
// authority: the Phase 178 provenance guarantees lived in `ProviderCache`
// while the real runtime path used a private Map with different semantics.
// Both news and fundamentals now go through the ONE shared cache, which
// supplies per-dataset TTLs, single-flight dedup, observedAt preservation and
// the user-owned-data guard. Scope is per action instance — see the registry.
import { getProviderCache } from "../lib/data/provider-cache-registry";
import { combineAcquisitions, oldestObservation } from "../lib/data/provenance-diagnostics";

// ── Alpha Vantage API ───────────────────────────────────────────

const AV_BASE = "https://www.alphavantage.co/query";

async function avFetch(params: Record<string, string>, apiKey: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res = await fetch(`${AV_BASE}?${qs}`, {
    // Phase 177 — HTTP deadline below the 8s alpha-vantage leg budget.
    signal: AbortSignal.timeout(7_000),
  });
  if (!res.ok) {
    throw new Error(`Alpha Vantage HTTP ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  // AV returns "Note" or "Information" on rate limits
  if (json.Note || json.Information) {
    throw new Error("RATE_LIMIT:" + (json.Note || json.Information));
  }
  return json;
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
  handler: async (ctx, args): Promise<IntelligenceResult> => {
    // Requires a signed-in identity: this action spends a server-side API key.
    await requireIdentity(ctx);

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
      // Fetch news sentiment (works for all asset types).
      // Phase 178b — served through the authoritative cache. The key carries
      // provider + dataset + native instrument + asset class, so a crypto
      // symbol and an identically-named equity ticker cannot collide. A hit
      // performs no HTTP call and consumes no quota; concurrent misses on the
      // same key collapse to one acquisition via single-flight.
      let articles: NewsArticle[] = [];
      let sentiment: SentimentData | undefined;
      // Phase 178d — record how each cache read resolved so the action can
      // report one honest mode instead of implying a fresh observation.
      const acquisitions: Array<"observed-now" | "observed-shared" | "cache-reused"> = [];
      const observations: number[] = [];

      {
        try {
          const evidence = await getProviderCache().fetch<NewsArticle[]>(
            {
              provider: "alpha-vantage",
              dataset: "news-sentiment",
              instrument: args.instrument,
              instrumentType: args.instrumentType,
              qualifier: ticker,
            },
            async () => {
              const newsJson = await avFetch(
                {
                  function: "NEWS_SENTIMENT",
                  tickers: ticker,
                  sort: "LATEST",
                  limit: "20",
                },
                apiKey,
              );
              return {
                data: normalizeNewsFromAV(newsJson, ticker),
                // Acquisition time of the REAL provider call. A later cache
                // hit reuses this value rather than resetting it to now, so
                // evidence age keeps growing across hits.
                observedAt: Date.now(),
              };
            },
          );
          articles = evidence?.data ?? [];
          if (evidence) {
            acquisitions.push(evidence.acquisition);
            observations.push(evidence.observedAt);
          }
          sentiment = aggregateFromArticles(articles, "alpha-vantage");
        } catch (err: any) {
          if (String(err?.message).startsWith("RATE_LIMIT")) {
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
        {
          try {
            // Phase 178b — distinct dataset, therefore a distinct cache key:
            // news and fundamentals for the same ticker never share an entry.
            const evidence = await getProviderCache().fetch<FundamentalData>(
              {
                provider: "alpha-vantage",
                dataset: "fundamentals",
                instrument: args.instrument,
                instrumentType: args.instrumentType,
                qualifier: ticker,
              },
              async () => {
                const [overviewJson, earningsJson] = await Promise.all([
                  avFetch({ function: "OVERVIEW", symbol: avSymbol }, apiKey),
                  avFetch({ function: "EARNINGS", symbol: avSymbol }, apiKey),
                ]);
                return {
                  data: normalizeFundamentalsFromAV(
                    overviewJson,
                    earningsJson,
                    args.instrumentType,
                    ticker,
                  ),
                  observedAt: Date.now(),
                };
              },
            );
            fundamentals = evidence?.data;
            if (evidence) {
              acquisitions.push(evidence.acquisition);
              observations.push(evidence.observedAt);
            }
          } catch (err: any) {
            if (String(err?.message).startsWith("RATE_LIMIT")) {
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
        // `cache-reused` only when every read was reused.
        acquisition: combineAcquisitions(acquisitions),
        observedAt: oldestObservation(observations),
      };
    } catch (err: any) {
      return {
        success: false,
        dataAvailable: { news: false, fundamentals: false, macro: false },
        error: `Intelligence fetch failed: ${err?.message ?? "unknown error"}`,
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});

// ── Normalization (duplicated from client-side for Convex compat) ─

function normalizeNewsFromAV(json: any, relatedTicker: string): NewsArticle[] {
  const feed = json?.feed;
  if (!feed || !Array.isArray(feed)) return [];

  return feed
    .filter((item: any) => item.title && item.url)
    .map((item: any) => {
      const tickerSentiment = item.ticker_sentiment?.find(
        (ts: any) =>
          ts.ticker?.toUpperCase() === relatedTicker.toUpperCase() ||
          ts.ticker?.toUpperCase().startsWith(relatedTicker.toUpperCase()),
      );
      return {
        title: item.title,
        source: item.source || "Unknown",
        url: item.url,
        publishedAt: item.time_published
          ? parseAVTime(item.time_published)
          : Date.now(),
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
        relatedTickers: item.ticker_sentiment?.map((ts: any) => ts.ticker || "").filter(Boolean),
        category: item.category_within_source || item.topics?.[0]?.topic,
      };
    })
    .sort((a: NewsArticle, b: NewsArticle) => {
      const scoreA = (a.relevanceScore ?? 0.5);
      const scoreB = (b.relevanceScore ?? 0.5);
      return scoreB - scoreA;
    })
    .slice(0, 10);
}

function normalizeFundamentalsFromAV(
  overview: any,
  earnings: any,
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
    base.unavailableReason = `Traditional fundamentals not applicable for ${instrumentType}.`;
    return base;
  }

  if (!overview || !overview.Symbol) {
    base.unavailableReason = "No fundamental data available for this symbol.";
    return base;
  }

  base.available = true;
  base.name = overview.Name;
  base.sector = overview.Sector;
  base.industry = overview.Industry;
  base.marketCap = safeNum(overview.MarketCapitalization);
  base.peRatio = safeNum(overview.PERatio);
  base.pegRatio = safeNum(overview.PEGRatio);
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

  if (earnings?.quarterlyEarnings?.length) {
    const latest = earnings.quarterlyEarnings[0];
    base.latestEarnings = {
      date: latest.fiscalDateEnding,
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

function safeNum(val: string | undefined): number | undefined {
  if (val === undefined || val === null || val === "" || val === "-") return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}
