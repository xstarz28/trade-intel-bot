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
import {
  asFiniteNumber,
  asNonEmptyString,
  asRecordArray,
  asString,
  errorMessage,
  field,
  isRecord,
} from "./lib/json";

// ── Phase 178b — authoritative provider cache ───────────────────
// This module previously kept its own `Map` cache. That created split cache
// authority: the Phase 178 provenance guarantees lived in `ProviderCache`
// while the real runtime path used a private Map with different semantics.
// Both news and fundamentals now go through the ONE shared cache, which
// supplies per-dataset TTLs, single-flight dedup, observedAt preservation and
// the user-owned-data guard. Scope is per action instance — see the registry.
import { getProviderCache } from "../lib/data/provider-cache-registry";
import { envelopeAcquisition, oldestObservation } from "../lib/data/provenance-diagnostics";
import {
  isLegFailure,
  runLeg,
  summarizeLegFailures,
  ProviderHttpError,
  ProviderMalformedError,
  ProviderNativeError,
  type LegOutcome,
} from "./lib/legOutcome";

// ── Alpha Vantage API ───────────────────────────────────────────

const AV_BASE = "https://www.alphavantage.co/query";

async function avFetch(params: Record<string, string>, apiKey: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const res = await fetch(`${AV_BASE}?${qs}`, {
    // Phase 177 — HTTP deadline below the 8s alpha-vantage leg budget.
    signal: AbortSignal.timeout(7_000),
  });
  if (!res.ok) {
    // Phase 229 — HTTP-level quota/credential rejections must classify the
    // same as the JSON "Note" path; before this they were a generic error
    // that the news leg then swallowed into a neutral "unavailable" block.
    if (res.status === 429) throw new Error(`RATE_LIMIT: HTTP 429 ${res.statusText}`);
    if (res.status === 401 || res.status === 403) throw new Error(`AUTH_ERROR: HTTP ${res.status} ${res.statusText}`);
    throw new ProviderHttpError("Alpha Vantage", res.status, res.statusText);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err: unknown) {
    throw new ProviderMalformedError(`Alpha Vantage body is not JSON: ${errorMessage(err)}`);
  }
  // AV returns "Note" or "Information" on rate limits
  const note = asNonEmptyString(field(json, "Note")) ?? asNonEmptyString(field(json, "Information"));
  if (note) {
    throw new Error("RATE_LIMIT:" + note);
  }
  // AV returns "Error Message" (HTTP 200) for an invalid function/symbol or
  // an invalid key. An explicit key rejection is fatal; anything else is a
  // provider error for this leg, never an empty-but-successful dataset.
  const errMsg = asNonEmptyString(field(json, "Error Message"));
  if (errMsg) {
    if (/api\s*key/i.test(errMsg)) throw new Error("AUTH_ERROR:" + errMsg);
    throw new ProviderNativeError("Alpha Vantage error: " + errMsg);
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

/**
 * Phase 238 — a news acquisition is its data PLUS the instant the provider
 * observed it. Keeping them in one value means every block derived from the
 * articles is dated by that same read; a separate variable could drift, and
 * two clock reads for one call can (and on CI did) land in different
 * milliseconds.
 */
interface NewsAcquisition {
  articles: NewsArticle[];
  /** The cache's own record of when this data was observed. */
  observedAt: number;
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
      // Phase 229 — per-leg outcome. Fatal classes (RATE_LIMIT / AUTH_ERROR)
      // reject out of runLeg and are handled by the outer catch; everything
      // else is classified here and reported on the envelope's `error`.
      const legs: {
        news: LegOutcome<NewsAcquisition>;
        fundamentals?: LegOutcome<FundamentalData>;
      } = {
        news: { status: "unavailable", reason: "not fetched" },
      };

      {
        legs.news = await runLeg<NewsAcquisition>(async () => {
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
              // Phase 238 — ONE clock read for this acquisition. The value
              // below is both the payload's observation time and the envelope
              // evidence's `observedAt`; reading the clock twice would let the
              // two disagree, which is how the Phase 229 provenance assertion
              // (r.observedAt === r.fundamentals.timestamp) became a coin flip
              // on a loaded CI runner while passing on this quiet sandbox.
              const observedAt = Date.now();
              return {
                data: normalizeNewsFromAV(newsJson, ticker),
                // Acquisition time of the REAL provider call. A later cache
                // hit reuses this value rather than resetting it to now, so
                // evidence age keeps growing across hits.
                observedAt,
              };
            },
          );
          if (!evidence) return undefined;
          acquisitions.push(evidence.acquisition);
          observations.push(evidence.observedAt);
          // Phase 238 — the instant travels WITH the articles it belongs to.
          // Deriving the sentiment and macro blocks from `value.observedAt`
          // makes "one observation, one instant" a property of the types
          // rather than a convention two declarations have to keep in step.
          return { articles: evidence.data, observedAt: evidence.observedAt };
        });
        if (legs.news.status === "ok") {
          articles = legs.news.value.articles;
          sentiment = aggregateFromArticles(
            articles,
            "alpha-vantage",
            legs.news.value.observedAt,
          );
        }
        // A failed or empty news leg leaves `sentiment` undefined: the
        // envelope's `dataAvailable.news=false` plus `error` say why. No
        // neutral zero-score block stamped with the local clock is produced.
      }

      // Fetch fundamentals (stocks only)
      let fundamentals: FundamentalData | undefined;

      if (args.instrumentType === "stock") {
        {
          legs.fundamentals = await runLeg(async () => {
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
                // Phase 238 — the acquisition instant is read ONCE and given
                // to both the payload (`FundamentalData.timestamp`) and the
                // cache evidence (`observedAt`). They describe the same
                // provider call, so they must be the same value, not two
                // reads that happen to land in the same millisecond.
                const observedAt = Date.now();
                return {
                  data: normalizeFundamentalsFromAV(
                    overviewJson,
                    earningsJson,
                    args.instrumentType,
                    ticker,
                    observedAt,
                  ),
                  observedAt,
                };
              },
            );
            if (evidence) {
              acquisitions.push(evidence.acquisition);
              observations.push(evidence.observedAt);
            }
            return evidence?.data;
          });
          if (legs.fundamentals.status === "ok") {
            fundamentals = legs.fundamentals.value;
          }
          // A failed fundamentals leg leaves `fundamentals` undefined; the
          // reason is on the envelope `error`, not a placeholder block.
        }
      } else {
        fundamentals = {
          provider: "alpha-vantage",
          // Phase 238 — a block that was never acquired carries NO observation
          // instant. 0 is the same "no provider timestamp" sentinel the news
          // parser uses for a missing `time_published` (Phase 220): it reads
          // as UNAVAILABLE everywhere, whereas the request clock asserted an
          // observation that never happened.
          timestamp: 0,
          instrumentType: args.instrumentType,
          available: false,
          unavailableReason: `Traditional company fundamentals not applicable for ${args.instrumentType} assets.`,
        };
      }

      // Phase 229 — if EVERY fetched leg failed for a transport/provider
      // reason, that is a provider outage: report it as API_UNAVAILABLE
      // instead of a `success: true` envelope of empty blocks.
      const fetched: LegOutcome<unknown>[] = [legs.news, ...(legs.fundamentals ? [legs.fundamentals] : [])];
      const legFailures = summarizeLegFailures({
        news: legs.news,
        ...(legs.fundamentals ? { fundamentals: legs.fundamentals } : {}),
      });
      if (fetched.length > 0 && fetched.every(isLegFailure)) {
        return {
          success: false,
          dataAvailable: { news: false, fundamentals: false, macro: false },
          error: `Intelligence fetch failed: every leg failed (${legFailures})`,
          errorCode: "API_UNAVAILABLE",
        };
      }

      // Build macro context from news articles (only when the news leg
      // actually answered; a failed leg must not yield a macro block).
      const macro =
        legs.news.status === "ok"
          ? buildMacroFromArticles(
              articles,
              args.instrumentType,
              legs.news.value.observedAt,
            )
          : undefined;

      return {
        success: true,
        sentiment,
        fundamentals,
        macro,
        dataAvailable: {
          news: articles.length > 0,
          fundamentals: fundamentals?.available ?? false,
          macro: macro !== undefined && macro.confidence !== "unavailable",
        },
        // Phase 229 — partial: per-leg failure class + reason.
        ...(legFailures ? { error: legFailures } : {}),
        // `cache-reused` only when every read was reused.
        acquisition: envelopeAcquisition(acquisitions),
        observedAt: oldestObservation(observations),
      };
    } catch (err: unknown) {
      const msg = errorMessage(err) || "unknown error";
      if (msg.startsWith("RATE_LIMIT")) {
        return {
          success: false,
          dataAvailable: { news: false, fundamentals: false, macro: false },
          error: "Alpha Vantage rate limit exceeded. Try again later.",
          errorCode: "RATE_LIMIT",
        };
      }
      if (msg.startsWith("AUTH_ERROR")) {
        return {
          success: false,
          dataAvailable: { news: false, fundamentals: false, macro: false },
          error: "Alpha Vantage authentication failed.",
          errorCode: "AUTH_ERROR",
        };
      }
      return {
        success: false,
        dataAvailable: { news: false, fundamentals: false, macro: false },
        error: `Intelligence fetch failed: ${msg}`,
        errorCode: "API_UNAVAILABLE",
      };
    }
  },
});

// ── Normalization (duplicated from client-side for Convex compat) ─

function normalizeNewsFromAV(json: unknown, relatedTicker: string): NewsArticle[] {
  const feed = field(json, "feed");
  if (!Array.isArray(feed)) return [];
  const wanted = relatedTicker.toUpperCase();

  const articles: NewsArticle[] = [];
  for (const item of asRecordArray(feed)) {
    const title = asNonEmptyString(item.title);
    const url = asNonEmptyString(item.url);
    if (!title || !url) continue;

    const tickerSentiments = asRecordArray(item.ticker_sentiment);
    const tickerSentiment = tickerSentiments.find((ts) => {
      const t = asString(ts.ticker)?.toUpperCase();
      return t !== undefined && (t === wanted || t.startsWith(wanted));
    });
    const topics = asRecordArray(item.topics);

    articles.push({
      title,
      source: asNonEmptyString(item.source) ?? "Unknown",
      url,
      // Phase 220: publishedAt is provider provenance. A missing or
      // unparseable time_published is recorded as 0 (the same "no
      // provider timestamp" sentinel the news feed already treats as
      // UNAVAILABLE), never as the local clock and never as NaN.
      publishedAt: parseAVTime(item.time_published),
      summary: asString(item.summary),
      // Phase 227: a non-numeric score is now undefined instead of NaN.
      sentimentScore:
        asFiniteNumber(tickerSentiment?.ticker_sentiment_score) ??
        asFiniteNumber(item.overall_sentiment_score),
      sentimentLabel: mapSentimentLabel(
        asString(tickerSentiment?.ticker_sentiment_label) ?? asString(item.overall_sentiment_label),
      ),
      relevanceScore: asFiniteNumber(tickerSentiment?.relevance_score),
      relatedTickers: tickerSentiments
        .map((ts) => asString(ts.ticker) ?? "")
        .filter(Boolean),
      category: asString(item.category_within_source) ?? asString(topics[0]?.topic),
    });
  }

  return articles
    .sort((a, b) => (b.relevanceScore ?? 0.5) - (a.relevanceScore ?? 0.5))
    .slice(0, 10);
}

/**
 * Phase 238 — `observedAt` is the acquisition instant, read once by the
 * caller. This function is PURE with respect to the clock: it is one of the
 * places that stamped a second, independent "now" onto an acquisition that
 * already had one.
 */
function normalizeFundamentalsFromAV(
  overview: unknown,
  earnings: unknown,
  instrumentType: string,
  symbol: string,
  observedAt: number,
): FundamentalData {
  const base: FundamentalData = {
    provider: "alpha-vantage",
    timestamp: observedAt,
    instrumentType: instrumentType as FundamentalData["instrumentType"],
    symbol,
    available: false,
  };

  if (instrumentType !== "stock") {
    base.unavailableReason = `Traditional fundamentals not applicable for ${instrumentType}.`;
    return base;
  }

  if (!isRecord(overview) || !asNonEmptyString(overview.Symbol)) {
    base.unavailableReason = "No fundamental data available for this symbol.";
    return base;
  }

  base.available = true;
  base.name = asString(overview.Name);
  base.sector = asString(overview.Sector);
  base.industry = asString(overview.Industry);
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

  const latest = asRecordArray(field(earnings, "quarterlyEarnings"))[0];
  if (latest) {
    base.latestEarnings = {
      date: asString(latest.fiscalDateEnding),
      eps: safeNum(latest.reportedEPS),
      revenue: safeNum(latest.reportedRevenue),
    };
  }

  return base;
}

/**
 * Phase 238 — derived from `articles`, so it is stamped with the instant the
 * articles were OBSERVED (`observedAt`), passed in by the caller. The local
 * clock would date the macro block later than the news it is derived from.
 */
function buildMacroFromArticles(
  articles: NewsArticle[],
  instrumentType: string,
  observedAt: number,
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
    timestamp: observedAt,
    dxyTrend,
    indicators: indicators.slice(0, 10),
    summary: parts.join(" "),
    confidence,
  };
}

/**
 * Phase 238 — `observedAt` is the news acquisition instant (the cache's own
 * record, preserved across hits). Same rule as `buildMacroFromArticles`: a
 * block derived from an observation is dated by that observation.
 */
function aggregateFromArticles(
  articles: NewsArticle[],
  provider: string,
  observedAt: number,
): SentimentData {
  if (articles.length === 0) {
    return {
      provider,
      timestamp: observedAt,
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
    timestamp: observedAt,
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

/**
 * Parse an Alpha Vantage time ("20240101T120000" or "20240101T120000.000").
 * Returns 0 when the field is absent or does not parse to a finite, positive
 * time — 0 means "provider gave no usable publication time" and is never
 * confused with an observation. The local clock is never substituted.
 */
function parseAVTime(timeStr: unknown): number {
  if (typeof timeStr !== "string" || timeStr.length < 13) return 0;
  const cleaned = timeStr.replace(/\.\d+$/, "");
  if (!/^\d{8}T\d{4,6}$/.test(cleaned)) return 0;
  const y = parseInt(cleaned.slice(0, 4));
  const m = parseInt(cleaned.slice(4, 6)) - 1;
  const d = parseInt(cleaned.slice(6, 8));
  const h = parseInt(cleaned.slice(9, 11));
  const min = parseInt(cleaned.slice(11, 13));
  const s = parseInt(cleaned.slice(13, 15)) || 0;
  const ms = new Date(y, m, d, h, min, s).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** AV emits numbers as strings, with "-", "None" or "" for missing. */
function safeNum(val: unknown): number | undefined {
  return asFiniteNumber(val);
}


// ── Phase 265 — Index Catalog/Data ─────────────────────────────────

type IndexCatalogRawEntry = Record<string, unknown>;

function extractIndexSymbol(entry: IndexCatalogRawEntry): string | null {
  const candidates = [
    entry["symbol"],
    entry["Symbol"],
    entry["1. symbol"],
    entry["1. Symbol"],
    entry["index_symbol"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

function extractIndexName(entry: IndexCatalogRawEntry, fallback: string): string {
  const candidates = [
    entry["name"],
    entry["Name"],
    entry["2. name"],
    entry["long_name"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return fallback;
}

function extractIndexCatalogArray(json: unknown): IndexCatalogRawEntry[] | null {
  if (Array.isArray(json)) {
    return json.filter((x) => x !== null && typeof x === "object") as IndexCatalogRawEntry[];
  }
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const keys = ["data", "indexes", "indices", "bestMatches", "matches", "results", "catalog"];
    for (const k of keys) {
      const v = obj[k];
      if (Array.isArray(v)) {
        return v.filter((x) => x !== null && typeof x === "object") as IndexCatalogRawEntry[];
      }
    }
    const vals = Object.values(obj);
    if (vals.length > 0 && vals.every((v) => typeof v === "string")) {
      return Object.entries(obj).map(([symbol, name]) => ({ symbol, name: name as string }));
    }
  }
  return null;
}

function parseIndexNumber(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export const fetchIndexCatalog = action({
  args: {},
  handler: async (ctx) => {
    await requireIdentity(ctx);
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "ALPHA_VANTAGE_API_KEY missing",
        errorCode: "CREDENTIAL_REQUIRED",
        instruments: [],
      };
    }
    try {
      const json = await avFetch({ function: "INDEX_CATALOG" }, apiKey);
      const rawArray = extractIndexCatalogArray(json);

      if (!rawArray) {
        return {
          success: false,
          error: "MALFORMED_RESPONSE: catalog array missing",
          errorCode: "MALFORMED_RESPONSE",
          instruments: [],
        };
      }

      const instruments: Array<{
        provider: string;
        providerInstrumentId: string;
        assetClass: "indices";
        subType: "index_cash";
        baseAsset: string;
        quoteAsset: string;
        tradingState: "TRADING";
        capabilities: readonly ["ohlcv", "quote"];
        region: string;
        discoveredAt: number;
        name: string;
      }> = [];
      const seen = new Set<string>();

      for (const raw of rawArray) {
        const symbol = extractIndexSymbol(raw);
        if (!symbol) continue;
        const exactSymbol = symbol;
        const key = `${"alpha-vantage"}::${exactSymbol}`;
        if (seen.has(key)) continue;
        const name = extractIndexName(raw, exactSymbol);
        instruments.push({
          provider: "alpha-vantage",
          providerInstrumentId: exactSymbol,
          assetClass: "indices",
          subType: "index_cash",
          baseAsset: exactSymbol.toUpperCase(),
          quoteAsset: "USD",
          tradingState: "TRADING",
          capabilities: ["ohlcv", "quote"] as const,
          region: "US",
          discoveredAt: Date.now(),
          name,
        });
        seen.add(key);
      }

      instruments.sort((a, b) => a.providerInstrumentId.localeCompare(b.providerInstrumentId));

      const hasDXY = instruments.some((i) => i.providerInstrumentId.toUpperCase() === "DXY");

      return {
        success: true,
        instruments,
        hasDXY,
        count: instruments.length,
        freshness: "FRESH",
        timestampProvenance: "PROVIDER_OBSERVED",
        completeness: "COMPLETE",
      };
    } catch (err: unknown) {
      const msg = errorMessage(err) || "unknown";
      if (msg.includes("RATE_LIMIT")) {
        return { success: false, error: msg, errorCode: "RATE_LIMITED", instruments: [] };
      }
      if (msg.includes("AUTH_ERROR") || msg.toLowerCase().includes("api key")) {
        return { success: false, error: msg, errorCode: "CREDENTIAL_REQUIRED", instruments: [] };
      }
      if (msg.toLowerCase().includes("premium")) {
        return { success: false, error: msg, errorCode: "CREDENTIAL_REQUIRED", instruments: [], premiumRequired: true };
      }
      return { success: false, error: msg, errorCode: "UNAVAILABLE", instruments: [] };
    }
  },
});

export const fetchIndexData = action({
  args: {
    symbol: v.string(),
    interval: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "ALPHA_VANTAGE_API_KEY missing",
        errorCode: "CREDENTIAL_REQUIRED",
        candles: [],
      };
    }
    const symbol = args.symbol.trim();
    if (!symbol) {
      return { success: false, error: "symbol required", errorCode: "MALFORMED_RESPONSE", candles: [] };
    }
    try {
      const json = await avFetch({ function: "INDEX_DATA", symbol, interval: args.interval }, apiKey);

      const now = Date.now();
      const candles: Array<{ date: string; open: number; high: number; low: number; close: number; timestamp: number; observedAt: number }> = [];
      const warnings: string[] = [];

      if (json && typeof json === "object") {
        const obj = json as Record<string, unknown>;
        const dataField = obj["data"];
        if (Array.isArray(dataField)) {
          for (const entry of dataField) {
            if (!entry || typeof entry !== "object") continue;
            const e = entry as Record<string, unknown>;
            const dateVal = e["date"];
            const timeVal = e["time"];
            const date = typeof dateVal === "string" ? dateVal : typeof timeVal === "string" ? timeVal : "";
            if (!date) {
              warnings.push("skipped candle missing date");
              continue;
            }
            const open = parseIndexNumber(e["open"] ?? e["1. open"]);
            const high = parseIndexNumber(e["high"] ?? e["2. high"]);
            const low = parseIndexNumber(e["low"] ?? e["3. low"]);
            const close = parseIndexNumber(e["close"] ?? e["4. close"]);
            if (open === null || high === null || low === null || close === null) {
              warnings.push(`skipped ${date} missing OHLC`);
              continue;
            }
            const ts = Date.parse(date);
            if (!Number.isFinite(ts)) {
              warnings.push(`skipped ${date} invalid timestamp`);
              continue;
            }
            candles.push({ date, open, high, low, close, timestamp: ts, observedAt: now });
          }
        } else {
          const tsKeys = Object.keys(obj).filter((k) => k.toLowerCase().includes("time series"));
          for (const tsKey of tsKeys) {
            const series = obj[tsKey];
            if (!series || typeof series !== "object") continue;
            const seriesObj = series as Record<string, unknown>;
            for (const [dateStr, raw] of Object.entries(seriesObj)) {
              if (!raw || typeof raw !== "object") continue;
              const cr = raw as Record<string, unknown>;
              const open = parseIndexNumber(cr["1. open"] ?? cr["open"]);
              const high = parseIndexNumber(cr["2. high"] ?? cr["high"]);
              const low = parseIndexNumber(cr["3. low"] ?? cr["low"]);
              const close = parseIndexNumber(cr["4. close"] ?? cr["close"]);
              if (open === null || high === null || low === null || close === null) {
                warnings.push(`skipped ${dateStr} missing OHLC`);
                continue;
              }
              const ts = Date.parse(dateStr);
              if (!Number.isFinite(ts)) {
                warnings.push(`skipped ${dateStr} invalid timestamp`);
                continue;
              }
              candles.push({ date: dateStr, open, high, low, close, timestamp: ts, observedAt: now });
            }
          }
        }
      }

      candles.sort((a, b) => a.timestamp - b.timestamp);

      return {
        success: true,
        symbol,
        interval: args.interval,
        candles,
        warnings,
        count: candles.length,
        freshness: "DELAYED",
        timestampProvenance: "PROVIDER_OBSERVED",
        completeness: candles.length > 0 ? "COMPLETE" : "FAILED",
        isHistorical: true,
      };
    } catch (err: unknown) {
      const msg = errorMessage(err) || "unknown";
      if (msg.includes("RATE_LIMIT")) {
        return { success: false, error: msg, errorCode: "RATE_LIMITED", candles: [] };
      }
      if (msg.includes("AUTH_ERROR") || msg.toLowerCase().includes("api key")) {
        return { success: false, error: msg, errorCode: "CREDENTIAL_REQUIRED", candles: [] };
      }
      if (msg.toLowerCase().includes("premium")) {
        return { success: false, error: msg, errorCode: "CREDENTIAL_REQUIRED", candles: [], premiumRequired: true };
      }
      return { success: false, error: msg, errorCode: "UNAVAILABLE", candles: [] };
    }
  },
});

