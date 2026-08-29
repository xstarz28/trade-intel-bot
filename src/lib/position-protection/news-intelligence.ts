/**
 * Phase 85 — News Intelligence Engine
 *
 * Deterministic news interpretation layer that consumes externally supplied
 * REAL news items and maps them to instrument relevance and position impact.
 *
 * Pure functions — no side effects, no network calls.
 * News items must be supplied from real providers; this module never fabricates headlines.
 */

import type { PositionSide } from "./types";

// ═══════════════════════════════════════════════════════════════
// NEWS CATEGORY
// ═══════════════════════════════════════════════════════════════

export type NewsCategory =
  | "CENTRAL_BANK"
  | "INFLATION"
  | "EMPLOYMENT"
  | "GDP"
  | "GEOPOLITICAL"
  | "REGULATION"
  | "ETF"
  | "CRYPTO_SPECIFIC"
  | "COMMODITY"
  | "FOREX"
  | "COMPANY"
  | "FUNDAMENTAL"
  | "MARKET_STRUCTURE"
  | "OTHER";

// ═══════════════════════════════════════════════════════════════
// NEWS ITEM (normalized from any provider)
// ═══════════════════════════════════════════════════════════════

export interface NewsItem {
  /** Unique identifier (provider-specific or deduped hash). */
  id: string;
  /** Timestamp (ms epoch). */
  timestamp: number;
  /** Source/provider name. */
  source: string;
  /** Headline text. */
  headline: string;
  /** Optional summary/body. */
  summary?: string;
  /** Optional article URL. */
  url?: string;
  /** Instruments this news relates to. */
  relatedInstruments: string[];
  /** Asset class. */
  assetClass: "crypto" | "forex" | "commodity" | "macro" | "equity" | "other";
  /** Category. */
  category: NewsCategory;
  /** Sentiment/direction if deterministically classifiable. */
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
  /** Impact strength if deterministically classifiable. */
  impactStrength: "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  /** Freshness classification. */
  freshness: "FRESH" | "RECENT" | "STALE" | "UNAVAILABLE";
  /** Source mode. */
  sourceMode: "LIVE" | "STALE" | "UNAVAILABLE";
}

// ═══════════════════════════════════════════════════════════════
// RELEVANCE
// ═══════════════════════════════════════════════════════════════

export type RelevanceLevel = "DIRECT" | "HIGH" | "MODERATE" | "LOW" | "IRRELEVANT" | "UNKNOWN";

export interface NewsRelevance {
  /** Instrument the news is relevant to. */
  instrument: string;
  /** Relevance level. */
  relevance: RelevanceLevel;
  /** Why it is relevant. */
  reason: string;
  /** Position impact direction. */
  positionImpact: "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "INSUFFICIENT";
}

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT RELEVANCE MAPPING
// ═══════════════════════════════════════════════════════════════

/** Keywords that map to specific instruments/classes. */
const INSTRUMENT_KEYWORDS: Record<string, string[]> = {
  "BTC": ["bitcoin", "btc", "btc/usdt", "btc/usd", "bitcoin etf"],
  "BTC/USDT": ["bitcoin", "btc", "btc/usdt", "btc/usd", "bitcoin etf"],
  "BTC/USD": ["bitcoin", "btc", "btc/usd", "btc/usdt", "bitcoin etf"],
  "ETH": ["ethereum", "eth", "eth/usdt", "eth/usd", "ether"],
  "ETH/USDT": ["ethereum", "eth", "eth/usdt", "eth/usd", "ether"],
  "ETH/USD": ["ethereum", "eth", "eth/usd", "eth/usdt", "ether"],
  "SOL": ["solana", "sol", "sol/usdt", "sol/usd"],
  "SOL/USDT": ["solana", "sol", "sol/usdt", "sol/usd"],
  "SOL/USD": ["solana", "sol", "sol/usd", "sol/usdt"],
  "DOGE": ["dogecoin", "doge", "doge/usdt", "doge/usd"],
  "DOGE/USDT": ["dogecoin", "doge", "doge/usdt", "doge/usd"],
  "DOGE/USD": ["dogecoin", "doge", "doge/usd", "doge/usdt"],
  "EUR/USD": ["ecb", "euro", "eur/usd", "eurozone"],
  "GBP/USD": ["boe", "gbp", "sterling", "gbp/usd", "pound"],
  "USD/JPY": ["boj", "jpy", "yen", "usd/jpy", "japan"],
  "AUD/USD": ["rba", "aud", "aussie", "aud/usd", "australia"],
  "USD/CAD": ["boc", "cad", "loonie", "usd/cad", "canada"],
  "XAU/USD": ["gold", "xau/usd", "xau", "precious metal"],
  "VIX": ["vix", "volatility index", "fear gauge"],
};

const ASSET_CLASS_KEYWORDS: Record<string, string[]> = {
  "crypto": ["bitcoin", "ethereum", "solana", "dogecoin", "crypto", "defi", "nft", "web3", "blockchain", "staking", "halving"],
  "forex": ["forex", "currency", "dollar", "euro", "yen", "sterling", "forex pair"],
  "commodity": ["gold", "silver", "oil", "commodity", "xau", "xag", "wti"],
  "macro": ["fed", "interest rate", "inflation", "cpi", "employment", "nfp", "gdp", "treasury", "yield", "central bank"],
};

// ═══════════════════════════════════════════════════════════════
// RELEVANCE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Classify news relevance to a specific instrument.
 * Position-aware: same news produces different impact for LONG vs SHORT.
 */
export function classifyNewsRelevance(
  item: NewsItem,
  instrument: string,
  side: PositionSide,
): NewsRelevance {
  const normalizedInstrument = instrument.toUpperCase().replace(/\s+/g, "");
  const headlineLower = item.headline.toLowerCase();
  const summaryLower = (item.summary ?? "").toLowerCase();
  const combined = `${headlineLower} ${summaryLower}`;

  // Direct instrument match
  const instrumentKeywords = INSTRUMENT_KEYWORDS[normalizedInstrument] ?? [];
  const directMatch = instrumentKeywords.some(kw => combined.includes(kw.toLowerCase()));

  if (directMatch) {
    return {
      instrument,
      relevance: "DIRECT",
      reason: `Headline directly references ${instrument}`,
      positionImpact: classifySentimentImpact(item.sentiment, side),
    };
  }

  // Check related instruments
  if (item.relatedInstruments.some(ri => ri.toUpperCase().replace(/\s+/g, "") === normalizedInstrument)) {
    return {
      instrument,
      relevance: "DIRECT",
      reason: `News explicitly tagged as related to ${instrument}`,
      positionImpact: classifySentimentImpact(item.sentiment, side),
    };
  }

  // Macro/Central bank news affects all instruments in that class
  if (item.category === "CENTRAL_BANK" || item.category === "INFLATION" || item.category === "EMPLOYMENT" || item.category === "GDP") {
    const assetClass = getAssetClass(instrument);
    if (assetClass === "forex" || assetClass === "commodity" || assetClass === "macro") {
      return {
        instrument,
        relevance: "MODERATE",
        reason: `Macro event (${item.category}) may affect ${assetClass} instruments`,
        positionImpact: classifySentimentImpact(item.sentiment, side),
      };
    }
    if (assetClass === "crypto") {
      return {
        instrument,
        relevance: "LOW",
        reason: `Macro event (${item.category}) has indirect crypto impact`,
        positionImpact: classifySentimentImpact(item.sentiment, side),
      };
    }
  }

  // Geopolitical affects risk assets
  if (item.category === "GEOPOLITICAL") {
    return {
      instrument,
      relevance: "MODERATE",
      reason: "Geopolitical event may affect risk assets broadly",
      positionImpact: classifySentimentImpact(item.sentiment, side),
    };
  }

  // Regulation affects specific asset classes
  if (item.category === "REGULATION" || item.category === "ETF") {
    const assetClass = getAssetClass(instrument);
    if (assetClass === "crypto" && combined.includes("crypto")) {
      return {
        instrument,
        relevance: "HIGH",
        reason: "Crypto regulation/ETF news",
        positionImpact: classifySentimentImpact(item.sentiment, side),
      };
    }
  }

  // Check asset class keyword overlap
  for (const [ac, keywords] of Object.entries(ASSET_CLASS_KEYWORDS)) {
    if (keywords.some(kw => combined.includes(kw))) {
      const instrumentClass = getAssetClass(instrument);
      if (ac === instrumentClass) {
        return {
          instrument,
          relevance: "LOW",
          reason: `General ${ac} news — indirect relevance`,
          positionImpact: classifySentimentImpact(item.sentiment, side),
        };
      }
    }
  }

  return {
    instrument,
    relevance: "IRRELEVANT",
    reason: "No keyword match for this instrument",
    positionImpact: "INSUFFICIENT",
  };
}

// ═══════════════════════════════════════════════════════════════
// SENTIMENT → POSITION IMPACT
// ═══════════════════════════════════════════════════════════════

function classifySentimentImpact(
  sentiment: NewsItem["sentiment"],
  side: PositionSide,
): "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "INSUFFICIENT" {
  if (sentiment === "UNKNOWN") return "INSUFFICIENT";
  if (sentiment === "NEUTRAL") return "NEUTRAL";

  // BULLISH sentiment: supports LONG, conflicts with SHORT
  // BEARISH sentiment: supports SHORT, conflicts with LONG
  const isLong = side === "LONG";
  if (sentiment === "BULLISH") {
    return isLong ? "SUPPORTING" : "CONFLICTING";
  }
  if (sentiment === "BEARISH") {
    return isLong ? "CONFLICTING" : "SUPPORTING";
  }
  return "NEUTRAL";
}

// ═══════════════════════════════════════════════════════════════
// UTILITY: ASSET CLASS DETECTION
// ═══════════════════════════════════════════════════════════════

function getAssetClass(instrument: string): string {
  const i = instrument.toUpperCase();
  if (i.includes("BTC") || i.includes("ETH") || i.includes("SOL") || i.includes("DOGE")) return "crypto";
  if (i.includes("XAU") || i.includes("XAG") || i.includes("OIL")) return "commodity";
  if (i.includes("VIX")) return "macro";
  if (i.includes("/")) return "forex";
  return "other";
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

export function classifyNewsFreshness(
  timestamp: number,
  now: number,
): NewsItem["freshness"] {
  const ageMs = now - timestamp;
  const ageMinutes = ageMs / 60_000;
  if (ageMinutes < 60) return "FRESH";       // < 1 hour
  if (ageMinutes < 360) return "RECENT";     // < 6 hours
  if (ageMinutes < 1440) return "STALE";     // < 24 hours
  return "STALE";
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Deduplicate news items by headline similarity.
 * Keeps the most recent item for each unique headline.
 */
export function deduplicateNews(items: NewsItem[]): NewsItem[] {
  const seen = new Map<string, NewsItem>();

  for (const item of items) {
    const normalizedHeadline = item.headline
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120); // use first 120 chars as key

    const existing = seen.get(normalizedHeadline);
    if (!existing || item.timestamp > existing.timestamp) {
      seen.set(normalizedHeadline, item);
    }
  }

  return Array.from(seen.values());
}

// ═══════════════════════════════════════════════════════════════
// NEWS SYNTHESIS
// ═══════════════════════════════════════════════════════════════

export interface NewsSynthesis {
  /** All relevant items for this instrument, sorted by relevance then time. */
  relevantItems: NewsRelevance[];
  /** Count by position impact. */
  supportingCount: number;
  conflictingCount: number;
  neutralCount: number;
  insufficientCount: number;
  /** Overall news stance for this instrument + position. */
  newsStance: "SUPPORTING" | "CONFLICTING" | "MIXED" | "NEUTRAL" | "INSUFFICIENT";
  /** Availability. */
  availability: "AVAILABLE" | "LIMITED" | "UNAVAILABLE";
  /** Description. */
  description: string;
}

/**
 * Synthesize all news items for a given instrument and position.
 * Returns a deterministic summary of news impact.
 */
export function synthesizeNews(
  items: NewsItem[],
  instrument: string,
  side: PositionSide,
): NewsSynthesis {
  if (items.length === 0) {
    return {
      relevantItems: [],
      supportingCount: 0,
      conflictingCount: 0,
      neutralCount: 0,
      insufficientCount: 0,
      newsStance: "INSUFFICIENT",
      availability: "UNAVAILABLE",
      description: "No news data available for analysis.",
    };
  }

  // Deduplicate
  const deduplicated = deduplicateNews(items);

  // Classify relevance
  const relevanceResults = deduplicated
    .map(item => classifyNewsRelevance(item, instrument, side))
    .filter(r => r.relevance !== "IRRELEVANT" && r.relevance !== "UNKNOWN");

  // Sort by relevance weight then timestamp
  const relevanceWeight: Record<string, number> = { DIRECT: 5, HIGH: 4, MODERATE: 3, LOW: 2, IRRELEVANT: 0, UNKNOWN: 0 };
  relevanceResults.sort((a, b) => {
    const wDiff = (relevanceWeight[b.relevance] ?? 0) - (relevanceWeight[a.relevance] ?? 0);
    if (wDiff !== 0) return wDiff;
    return 0; // stable order
  });

  const supportingCount = relevanceResults.filter(r => r.positionImpact === "SUPPORTING").length;
  const conflictingCount = relevanceResults.filter(r => r.positionImpact === "CONFLICTING").length;
  const neutralCount = relevanceResults.filter(r => r.positionImpact === "NEUTRAL").length;
  const insufficientCount = relevanceResults.filter(r => r.positionImpact === "INSUFFICIENT").length;

  let newsStance: NewsSynthesis["newsStance"];
  let description: string;

  if (supportingCount > 0 && conflictingCount > 0) {
    newsStance = "MIXED";
    description = `Mixed news: ${supportingCount} supporting, ${conflictingCount} conflicting for ${side} ${instrument}.`;
  } else if (supportingCount > 0) {
    newsStance = "SUPPORTING";
    description = `News context supports ${side} ${instrument} (${supportingCount} relevant items).`;
  } else if (conflictingCount > 0) {
    newsStance = "CONFLICTING";
    description = `News context conflicts with ${side} ${instrument} (${conflictingCount} relevant items).`;
  } else if (neutralCount > 0) {
    newsStance = "NEUTRAL";
    description = `News context is neutral for ${side} ${instrument}.`;
  } else {
    newsStance = "INSUFFICIENT";
    description = "Available news has insufficient relevance for position analysis.";
  }

  const availability = relevanceResults.length > 0 ? "AVAILABLE" : "LIMITED";

  return {
    relevantItems: relevanceResults,
    supportingCount,
    conflictingCount,
    neutralCount,
    insufficientCount,
    newsStance,
    availability,
    description,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAX RESULTS
// ═══════════════════════════════════════════════════════════════

/** Maximum news items to retain per synthesis to bound memory. */
export const MAX_NEWS_ITEMS = 50;

/** Filter and bound news items before synthesis. */
export function boundNewsItems(items: NewsItem[]): NewsItem[] {
  return deduplicateNews(items).slice(0, MAX_NEWS_ITEMS);
}
