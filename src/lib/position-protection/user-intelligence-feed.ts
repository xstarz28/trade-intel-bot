/**
 * Phase 88 — User Intelligence Feed Engine
 *
 * Derives a personalized intelligence feed from the user's registered positions.
 * Filters real news items to only those relevant to the user's instruments.
 * Preserves position-aware impact interpretation.
 *
 * Pure functions — no side effects, no network calls.
 */

import type { PositionSide } from "./types";
import type { NewsItem, NewsRelevance, RelevanceLevel } from "./news-intelligence";
import { classifyNewsRelevance, classifyNewsFreshness, deduplicateNews } from "./news-intelligence";

// ═══════════════════════════════════════════════════════════════
// USER POSITION
// ═══════════════════════════════════════════════════════════════

export interface UserPosition {
  /** Instrument symbol (e.g., "BTC/USDT"). */
  instrument: string;
  /** Position side. */
  side: PositionSide;
  /** Asset class. */
  assetClass: string;
}

// ═══════════════════════════════════════════════════════════════
// FEED ITEM
// ═══════════════════════════════════════════════════════════════

export interface FeedItem {
  /** Unique news item id. */
  newsId: string;
  /** Headline. */
  headline: string;
  /** Source/provider. */
  source: string;
  /** Timestamp. */
  timestamp: number;
  /** Freshness. */
  freshness: "FRESH" | "RECENT" | "STALE" | "UNAVAILABLE";
  /** Source mode. */
  sourceMode: "LIVE" | "STALE" | "UNAVAILABLE";
  /** Sentiment. */
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
  /** This item's relevance for each affected position. */
  positionImpacts: PositionImpact[];
  /** Relevance level (highest across all positions). */
  relevance: RelevanceLevel;
  /** Impact strength. */
  impactStrength: "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  /** URL if available. */
  url?: string;
}

export interface PositionImpact {
  instrument: string;
  side: PositionSide;
  relevance: RelevanceLevel;
  positionImpact: "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "INSUFFICIENT";
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// USER INTELLIGENCE FEED
// ═══════════════════════════════════════════════════════════════

export interface UserIntelligenceFeed {
  /** All feed items, sorted by priority. */
  items: FeedItem[];
  /** Number of unique news items. */
  uniqueNewsCount: number;
  /** Number of monitored instruments. */
  monitoredInstruments: string[];
  /** Cross-position catalysts (news affecting multiple positions). */
  crossPositionCatalysts: CrossPositionCatalyst[];
  /** Availability. */
  availability: "AVAILABLE" | "LIMITED" | "UNAVAILABLE";
  /** Description. */
  description: string;
}

export interface CrossPositionCatalyst {
  /** Headline. */
  headline: string;
  /** Number of positions affected. */
  affectedPositions: number;
  /** Instruments affected. */
  instruments: string[];
  /** Description. */
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// FEED BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build a user-specific intelligence feed from real news items and the user's positions.
 * One news item may map to multiple positions.
 * Returns items sorted by priority (relevance × freshness).
 */
export function buildUserIntelligenceFeed(
  newsItems: NewsItem[],
  positions: UserPosition[],
  now: number = Date.now(),
): UserIntelligenceFeed {
  if (positions.length === 0) {
    return {
      items: [],
      uniqueNewsCount: 0,
      monitoredInstruments: [],
      crossPositionCatalysts: [],
      availability: "UNAVAILABLE",
      description: "No positions being monitored.",
    };
  }

  if (newsItems.length === 0) {
    return {
      items: [],
      uniqueNewsCount: 0,
      monitoredInstruments: [...new Set(positions.map(p => p.instrument))],
      crossPositionCatalysts: [],
      availability: "UNAVAILABLE",
      description: "No relevant news available.",
    };
  }

  // Deduplicate news
  const deduplicated = deduplicateNews(newsItems);

  // Build feed items
  const feedItems: FeedItem[] = [];

  for (const item of deduplicated) {
    const positionImpacts: PositionImpact[] = [];

    for (const pos of positions) {
      const relevance = classifyNewsRelevance(item, pos.instrument, pos.side);
      if (relevance.relevance === "IRRELEVANT" || relevance.relevance === "UNKNOWN") {
        continue;
      }
      positionImpacts.push({
        instrument: pos.instrument,
        side: pos.side,
        relevance: relevance.relevance,
        positionImpact: relevance.positionImpact,
        reason: relevance.reason,
      });
    }

    // Only include items relevant to at least one position
    if (positionImpacts.length === 0) continue;

    // Highest relevance across all positions
    const relevanceOrder: Record<string, number> = { DIRECT: 5, HIGH: 4, MODERATE: 3, LOW: 2 };
    const maxRelevance = positionImpacts.reduce(
      (max, pi) => Math.max(max, relevanceOrder[pi.relevance] ?? 0),
      0,
    );
    const bestRelevance = (Object.entries(relevanceOrder).find(([, v]) => v === maxRelevance)?.[0] ?? "LOW") as RelevanceLevel;

    feedItems.push({
      newsId: item.id,
      headline: item.headline,
      source: item.source,
      timestamp: item.timestamp,
      freshness: item.freshness,
      sourceMode: item.sourceMode,
      sentiment: item.sentiment,
      positionImpacts,
      relevance: bestRelevance,
      impactStrength: item.impactStrength,
      url: item.url,
    });
  }

  // Sort by priority: relevance → freshness → timestamp
  feedItems.sort((a, b) => {
    const relevanceOrder: Record<string, number> = { DIRECT: 5, HIGH: 4, MODERATE: 3, LOW: 2, IRRELEVANT: 0, UNKNOWN: 0 };
    const freshnessOrder: Record<string, number> = { FRESH: 4, RECENT: 3, STALE: 2, UNAVAILABLE: 1 };

    const rDiff = (relevanceOrder[b.relevance] ?? 0) - (relevanceOrder[a.relevance] ?? 0);
    if (rDiff !== 0) return rDiff;

    const fDiff = (freshnessOrder[b.freshness] ?? 0) - (freshnessOrder[a.freshness] ?? 0);
    if (fDiff !== 0) return fDiff;

    return b.timestamp - a.timestamp; // newest first
  });

  // Cross-position catalysts
  const crossPositionCatalysts = findCrossPositionCatalysts(feedItems);

  const instruments = [...new Set(positions.map(p => p.instrument))];
  const availability = feedItems.length > 0 ? "AVAILABLE" : "LIMITED";
  const description = feedItems.length > 0
    ? `${feedItems.length} relevant news items across ${instruments.length} monitored instruments.`
    : "No material news for monitored instruments.";

  return {
    items: feedItems,
    uniqueNewsCount: deduplicated.length,
    monitoredInstruments: instruments,
    crossPositionCatalysts,
    availability,
    description,
  };
}

// ═══════════════════════════════════════════════════════════════
// CROSS-POSITION CATALYSTS
// ═══════════════════════════════════════════════════════════════

function findCrossPositionCatalysts(items: FeedItem[]): CrossPositionCatalyst[] {
  const catalysts: CrossPositionCatalyst[] = [];

  for (const item of items) {
    if (item.positionImpacts.length >= 2) {
      const instruments = [...new Set(item.positionImpacts.map(pi => pi.instrument))];
      catalysts.push({
        headline: item.headline,
        affectedPositions: item.positionImpacts.length,
        instruments,
        description: `Relevant across ${instruments.length} monitored positions: ${instruments.join(", ")}.`,
      });
    }
  }

  return catalysts;
}

// ═══════════════════════════════════════════════════════════════
// FEED SIZE BOUNDS
// ═══════════════════════════════════════════════════════════════

/** Maximum feed items to prevent unbounded growth. */
export const MAX_FEED_ITEMS = 50;

/** Bound the feed to prevent memory issues. */
export function boundFeed(feed: UserIntelligenceFeed): UserIntelligenceFeed {
  return {
    ...feed,
    items: feed.items.slice(0, MAX_FEED_ITEMS),
  };
}

// ═══════════════════════════════════════════════════════════════
// USER POSITION EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract unique user positions from monitored state.
 * Deduplicates by instrument (keeps first occurrence).
 */
export function extractUserPositions(
  registeredPositions: Array<{ instrument: string; side: "LONG" | "SHORT" }>,
): UserPosition[] {
  const seen = new Set<string>();
  const positions: UserPosition[] = [];

  for (const pos of registeredPositions) {
    if (seen.has(pos.instrument)) continue;
    seen.add(pos.instrument);
    positions.push({
      instrument: pos.instrument,
      side: pos.side,
      assetClass: inferAssetClass(pos.instrument),
    });
  }

  return positions;
}

function inferAssetClass(instrument: string): string {
  const i = instrument.toUpperCase();
  if (i.includes("BTC") || i.includes("ETH") || i.includes("SOL") || i.includes("DOGE")) return "crypto";
  if (i.includes("XAU") || i.includes("XAG")) return "commodity";
  if (i.includes("VIX")) return "macro";
  if (i.includes("/")) return "forex";
  return "other";
}

// ═══════════════════════════════════════════════════════════════
// FEED STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface FeedStats {
  totalItems: number;
  supportingCount: number;
  conflictingCount: number;
  neutralCount: number;
  instrumentsWithNews: number;
  instrumentsWithoutNews: string[];
}

export function computeFeedStats(feed: UserIntelligenceFeed): FeedStats {
  const instrumentsWithNews = new Set<string>();
  const instrumentsWithNoNews = new Set(feed.monitoredInstruments);

  let supportingCount = 0;
  let conflictingCount = 0;
  let neutralCount = 0;

  for (const item of feed.items) {
    for (const pi of item.positionImpacts) {
      instrumentsWithNews.add(pi.instrument);
      instrumentsWithNoNews.delete(pi.instrument);
      if (pi.positionImpact === "SUPPORTING") supportingCount++;
      else if (pi.positionImpact === "CONFLICTING") conflictingCount++;
      else neutralCount++;
    }
  }

  return {
    totalItems: feed.items.length,
    supportingCount,
    conflictingCount,
    neutralCount,
    instrumentsWithNews: instrumentsWithNews.size,
    instrumentsWithoutNews: [...instrumentsWithNoNews],
  };
}
