import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeNewsArticles,
  aggregateSentiment,
  normalizeFundamentals,
  buildMacroContext,
} from "./normalize";
import type { NewsArticle } from "../intelligence-types";

// ── News Normalization ──────────────────────────────────────────

describe("normalizeNewsArticles", () => {
  const mockFeed = [
    {
      title: "Bitcoin rallies past $70k",
      url: "https://example.com/1",
      summary: "Bitcoin surged past $70,000 on institutional buying",
      source: "CoinDesk",
      overall_sentiment_score: "0.45",
      overall_sentiment_label: "Somewhat-Bullish",
      category_within_source: "crypto",
      ticker_sentiment: [
        { ticker: "BTC", relevance_score: "0.92", ticker_sentiment_score: "0.6", ticker_sentiment_label: "Bullish" },
      ],
    },
    {
      title: "Fed signals rate pause",
      url: "https://example.com/2",
      summary: "Federal Reserve hints at pausing rate hikes",
      source: "Reuters",
      overall_sentiment_score: "0.1",
      overall_sentiment_label: "Neutral",
      category_within_source: "economy",
      ticker_sentiment: [],
    },
    {
      title: "Crypto regulation concerns",
      url: "https://example.com/3",
      summary: "SEC tightens crypto oversight",
      source: "Bloomberg",
      overall_sentiment_score: "-0.3",
      overall_sentiment_label: "Somewhat-Bearish",
      ticker_sentiment: [
        { ticker: "BTC", relevance_score: "0.7", ticker_sentiment_score: "-0.25", ticker_sentiment_label: "Somewhat-Bearish" },
      ],
    },
  ];

  it("normalizes articles with ticker-specific sentiment", () => {
    const articles = normalizeNewsArticles(mockFeed, "BTC");
    expect(articles.length).toBe(3);
    const btcArticle = articles.find((a) => a.title.includes("Bitcoin"));
    expect(btcArticle).toBeDefined();
    expect(btcArticle!.sentimentScore).toBe(0.6);
    expect(btcArticle!.sentimentLabel).toBe("positive");
    expect(btcArticle!.relevanceScore).toBe(0.92);
  });

  it("sorts by relevance score", () => {
    const articles = normalizeNewsArticles(mockFeed, "BTC");
    // BTC-specific article should be first due to high relevance
    expect(articles[0].title).toContain("Bitcoin");
  });

  it("returns empty array for null/undefined feed", () => {
    expect(normalizeNewsArticles(undefined, "BTC")).toEqual([]);
  });

  it("filters out articles without title or url", () => {
    const feed = [
      { title: "Good article", url: "https://example.com" },
      { url: "https://example.com/no-title" }, // missing title
      { title: "No URL" }, // missing url
    ];
    const articles = normalizeNewsArticles(feed, "BTC");
    expect(articles.length).toBe(1);
    expect(articles[0].title).toBe("Good article");
  });

  it("caps at 10 articles", () => {
    const feed = Array.from({ length: 15 }, (_, i) => ({
      title: `Article ${i}`,
      url: `https://example.com/${i}`,
      source: "Source",
    }));
    const articles = normalizeNewsArticles(feed, "BTC");
    expect(articles.length).toBe(10);
  });
});

// ── Sentiment Aggregation ───────────────────────────────────────

describe("aggregateSentiment", () => {
  it("aggregates bullish sentiment from multiple articles", () => {
    const articles: NewsArticle[] = [
      { title: "A", source: "X", url: "a", publishedAt: Date.now(), sentimentScore: 0.4, relevanceScore: 0.8 },
      { title: "B", source: "X", url: "b", publishedAt: Date.now(), sentimentScore: 0.3, relevanceScore: 0.7 },
      { title: "C", source: "X", url: "c", publishedAt: Date.now(), sentimentScore: 0.5, relevanceScore: 0.9 },
    ];
    const result = aggregateSentiment(articles, "test-provider");
    expect(result.label).toBe("bullish");
    expect(result.averageScore).toBeGreaterThan(0);
    expect(result.articleCount).toBe(3);
    expect(result.confidence).toBe("low"); // < 5 articles
  });

  it("aggregates bearish sentiment", () => {
    const articles: NewsArticle[] = [
      { title: "A", source: "X", url: "a", publishedAt: Date.now(), sentimentScore: -0.4 },
      { title: "B", source: "X", url: "b", publishedAt: Date.now(), sentimentScore: -0.6 },
      { title: "C", source: "X", url: "c", publishedAt: Date.now(), sentimentScore: -0.3 },
    ];
    const result = aggregateSentiment(articles, "test-provider");
    expect(result.label).toBe("bearish");
    expect(result.averageScore).toBeLessThan(0);
  });

  it("returns unavailable for empty articles", () => {
    const result = aggregateSentiment([], "test-provider");
    expect(result.confidence).toBe("unavailable");
    expect(result.articleCount).toBe(0);
    expect(result.label).toBe("neutral");
  });

  it("upgrades confidence with more articles", () => {
    const articles: NewsArticle[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Article ${i}`,
      source: "X",
      url: `a${i}`,
      publishedAt: Date.now(),
      sentimentScore: 0.3,
    }));
    const result = aggregateSentiment(articles, "test-provider");
    expect(result.confidence).toBe("high"); // >= 8 articles
  });

  it("uses medium confidence with 5-7 articles", () => {
    const articles: NewsArticle[] = Array.from({ length: 6 }, (_, i) => ({
      title: `Article ${i}`,
      source: "X",
      url: `a${i}`,
      publishedAt: Date.now(),
      sentimentScore: 0.3,
    }));
    const result = aggregateSentiment(articles, "test-provider");
    expect(result.confidence).toBe("medium");
  });
});

// ── Fundamental Normalization ───────────────────────────────────

describe("normalizeFundamentals", () => {
  it("normalizes stock fundamentals from overview + earnings", () => {
    const overview = {
      Symbol: "AAPL",
      Name: "Apple Inc.",
      Sector: "Technology",
      Industry: "Consumer Electronics",
      MarketCapitalization: "3000000000000",
      PERatio: "28.5",
      EPS: "6.42",
      ProfitMargin: "0.265",
      FiftyTwoWeekHigh: "199.62",
      FiftyTwoWeekLow: "164.08",
    };
    const earnings = {
      quarterlyEarnings: [
        { fiscalDateEnding: "2024-03-31", reportedEPS: "1.53", reportedRevenue: "90750000000" },
      ],
    };

    const result = normalizeFundamentals(overview, earnings, "stock", "AAPL");
    expect(result.available).toBe(true);
    expect(result.name).toBe("Apple Inc.");
    expect(result.sector).toBe("Technology");
    expect(result.peRatio).toBe(28.5);
    expect(result.earningsPerShare).toBe(6.42);
    expect(result.profitMargin).toBe(0.265);
    expect(result.fiftyTwoWeekHigh).toBe(199.62);
    expect(result.latestEarnings?.eps).toBe(1.53);
  });

  it("marks non-stock assets as unavailable", () => {
    const result = normalizeFundamentals(null, null, "forex", "EURUSD");
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toContain("not applicable");
  });

  it("marks missing overview as unavailable", () => {
    const result = normalizeFundamentals(null, null, "stock", "XYZ");
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toContain("not available");
  });

  it("handles missing fields gracefully", () => {
    const overview = { Symbol: "TEST", Name: "Test Corp" };
    const result = normalizeFundamentals(overview, null, "stock", "TEST");
    expect(result.available).toBe(true);
    expect(result.peRatio).toBeUndefined();
    expect(result.marketCap).toBeUndefined();
  });
});

// ── Macro Context ───────────────────────────────────────────────

describe("buildMacroContext", () => {
  it("extracts macro indicators from news articles", () => {
    const articles: NewsArticle[] = [
      { title: "Inflation rises to 3.2%", source: "X", url: "a", publishedAt: Date.now(), summary: "Consumer price index increased" },
      { title: "Fed signals rate cut", source: "X", url: "b", publishedAt: Date.now(), summary: "Federal Reserve dovish tone" },
    ];
    const result = buildMacroContext(articles, "forex");
    expect(result.indicators.length).toBeGreaterThan(0);
    expect(result.summary).toContain("macro");
  });

  it("detects DXY trend for forex", () => {
    const articles: NewsArticle[] = [
      { title: "Dollar strength continues", source: "X", url: "a", publishedAt: Date.now(), summary: "USD index rising", sentimentScore: 0.3 },
      { title: "Dollar hits new high", source: "X", url: "b", publishedAt: Date.now(), summary: "Dollar gains on employment data", sentimentScore: 0.2 },
    ];
    const result = buildMacroContext(articles, "forex");
    expect(result.dxyTrend).toBeDefined();
  });

  it("returns unavailable confidence for empty articles", () => {
    const result = buildMacroContext([], "stock");
    expect(result.confidence).toBe("unavailable");
    expect(result.indicators.length).toBe(0);
  });

  it("upgrades confidence with more indicators", () => {
    const articles: NewsArticle[] = [
      { title: "Inflation data released", source: "X", url: "a", publishedAt: Date.now(), summary: "CPI report shows inflation" },
      { title: "GDP growth slows", source: "X", url: "b", publishedAt: Date.now(), summary: "GDP report shows slowdown" },
      { title: "Employment numbers strong", source: "X", url: "c", publishedAt: Date.now(), summary: "Job market remains solid" },
      { title: "Recession fears grow", source: "X", url: "d", publishedAt: Date.now(), summary: "Economists warn of recession" },
      { title: "Trade deficit widens", source: "X", url: "e", publishedAt: Date.now(), summary: "Trade balance deteriorates" },
    ];
    const result = buildMacroContext(articles, "forex");
    expect(result.confidence).toBe("high"); // >= 5 indicators
  });
});

// ── Error Handling ──────────────────────────────────────────────

describe("error handling", () => {
  it("handles malformed news feed gracefully", () => {
    const articles = normalizeNewsArticles([{ title: "", url: "" }], "BTC");
    expect(articles.length).toBe(0);
  });

  it("handles articles with no sentiment scores", () => {
    const articles: NewsArticle[] = [
      { title: "A", source: "X", url: "a", publishedAt: Date.now() },
    ];
    const result = aggregateSentiment(articles, "test");
    expect(result.averageScore).toBe(0);
    // No articles have scores → withScores.length === 0 → unavailable
    expect(result.confidence).toBe("unavailable");
  });
});

// ── Cache Behavior ──────────────────────────────────────────────

describe("caching behavior", () => {
  it("normalizeNewsArticles is pure (no side effects)", () => {
    const feed = [{ title: "Test", url: "https://test.com", source: "Test" }];
    const result1 = normalizeNewsArticles(feed, "BTC");
    const result2 = normalizeNewsArticles(feed, "BTC");
    expect(result1).toEqual(result2);
  });
});
