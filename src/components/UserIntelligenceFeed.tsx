/**
 * Phase 88 — User Intelligence Feed Component
 *
 * Displays a personalized, position-aware intelligence feed.
 * Shows only news relevant to the user's monitored instruments.
 * Each item shows instrument, side, headline, relevance, and position impact.
 */

import React from "react";
import { useI18n } from "@/lib/i18n";
import { mapTrendLabel, mapFreshness, mapAvailability, mapSide, mapPositionImpact } from "@/lib/i18n/enum-mapping";
import {
  Newspaper,
  Zap,
} from "lucide-react";
import type {
  UserIntelligenceFeed as FeedType,
  FeedItem,
  FeedStats,
  CrossPositionCatalyst,
} from "@/lib/position-protection/user-intelligence-feed";
import { computeFeedStats } from "@/lib/position-protection/user-intelligence-feed";

// ═══════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════

interface UserIntelligenceFeedProps {
  /** The computed feed. */
  feed: FeedType | null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export function UserIntelligenceFeed({ feed }: UserIntelligenceFeedProps) {
  const { t, txi } = useI18n();
  if (!feed || feed.availability === "UNAVAILABLE") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Newspaper className="size-3.5 text-primary" />
          <span className="text-xs font-mono font-bold text-foreground">{t.intelligence.feedHeader}</span>
        </div>
        <div className="border border-border/30 rounded-lg p-4 text-center">
          <p className="text-[10px] font-mono text-muted-foreground/60">
            {feed?.description ?? `${t.protection.noPositions} ${t.protection.noPositionsHint}`}
          </p>
        </div>
      </div>
    );
  }

  const stats = computeFeedStats(feed);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="size-3.5 text-primary" />
          <span className="text-xs font-mono font-bold text-foreground">{t.intelligence.feedHeader}</span>
          {feed.items.length > 0 && (
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {feed.items.length}
            </span>
          )}
        </div>
        <FeedStatsBar stats={stats} />
      </div>

      {/* Cross-position catalysts */}
      {feed.crossPositionCatalysts.length > 0 && (
        <CrossPositionAlert catalysts={feed.crossPositionCatalysts} />
      )}

      {/* Feed items */}
      {feed.items.length === 0 ? (
        <div className="border border-border/30 rounded-lg p-4 text-center">
          <p className="text-[10px] font-mono text-muted-foreground/60">
            {t.intelligence.feedNoMaterialNews}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {feed.items.map((item) => (
            <FeedItemCard key={item.newsId} item={item} />
          ))}
        </div>
      )}

      {/* Instruments without news */}
      {stats.instrumentsWithoutNews.length > 0 && (
        <div className="text-[8px] font-mono text-muted-foreground/40 px-1">
          {txi("intelligence.feedNoRelevantNews", { list: stats.instrumentsWithoutNews.join(", ") })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FEED ITEM CARD
// ═══════════════════════════════════════════════════════════════

function FeedItemCard({ item }: { item: FeedItem }) {
  const { t } = useI18n();
  const isMultiPosition = item.positionImpacts.length > 1;

  return (
    <div className="border border-border/30 rounded-lg px-3 py-2 hover:bg-muted/20 transition-colors">
      {/* Position tags */}
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        {item.positionImpacts.map((pi, i) => (
          <PositionTag key={i} impact={pi} />
        ))}
        {isMultiPosition && (
          <span className="text-[7px] font-mono px-1 py-0.5 rounded bg-amber-500/10 text-amber-400">
            MULTI
          </span>
        )}
      </div>

      {/* Headline */}
      <div className="text-[10px] font-mono text-foreground/80 leading-relaxed mb-1">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline-offset-2 hover:underline">
            {item.headline}
          </a>
        ) : (
          item.headline
        )}
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-2 text-[8px] font-mono text-muted-foreground/60">
        <span>{item.source}</span>
        <span>·</span>
        <FreshnessBadge freshness={item.freshness} />
        <span>·</span>
        <SourceModeBadge mode={item.sourceMode} />
        {item.sentiment !== "UNKNOWN" && item.sentiment !== "NEUTRAL" && (
          <>
            <span>·</span>
            <span className={item.sentiment === "BULLISH" ? "text-emerald-400/60" : "text-red-400/60"}>
              {mapTrendLabel(item.sentiment, t)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// POSITION TAG
// ═══════════════════════════════════════════════════════════════

function PositionTag({ impact }: { impact: import("@/lib/position-protection/user-intelligence-feed").PositionImpact }) {
  const { t } = useI18n();
  const sideColor = impact.side === "LONG"
    ? "text-emerald-400 bg-emerald-500/10"
    : "text-red-400 bg-red-500/10";

  const impactColor =
    impact.positionImpact === "SUPPORTING" ? "text-emerald-400" :
    impact.positionImpact === "CONFLICTING" ? "text-red-400" :
    impact.positionImpact === "NEUTRAL" ? "text-muted-foreground" :
    "text-muted-foreground/40";

  return (
    <span className={`inline-flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded ${sideColor}`}>
      <span className="font-semibold">{impact.instrument}</span>
      <span>{mapSide(impact.side, t)}</span>
      <span className={`${impactColor} ml-0.5`}>· {mapPositionImpact(impact.positionImpact, t)}</span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// CROSS-POSITION ALERT
// ═══════════════════════════════════════════════════════════════

function CrossPositionAlert({ catalysts }: { catalysts: CrossPositionCatalyst[] }) {
  const { t } = useI18n();
  return (
    <div className="border border-amber-500/20 bg-amber-500/5 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Zap className="size-2.5 text-amber-400" />
        <span className="text-[9px] font-mono font-semibold text-amber-400">
          {t.intelligence.catalystHeader}
        </span>
      </div>
      {catalysts.map((c, i) => (
        <div key={i} className="text-[8px] font-mono text-muted-foreground/80">
          {c.description}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FEED STATS BAR
// ═══════════════════════════════════════════════════════════════

function FeedStatsBar({ stats }: { stats: FeedStats }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5 text-[8px] font-mono">
      {stats.supportingCount > 0 && (
        <span className="text-emerald-400/60">{stats.supportingCount} {t.intelligence.supporting}</span>
      )}
      {stats.conflictingCount > 0 && (
        <span className="text-red-400/60">{stats.conflictingCount} {t.intelligence.conflicting}</span>
      )}
      {stats.neutralCount > 0 && (
        <span className="text-muted-foreground/40">{stats.neutralCount} {t.intelligence.neutral}</span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS / SOURCE MODE BADGES
// ═══════════════════════════════════════════════════════════════

function FreshnessBadge({ freshness }: { freshness: string }) {
  const { t } = useI18n();
  const color =
    freshness === "FRESH" ? "text-emerald-400/60" :
    freshness === "RECENT" ? "text-blue-400/60" :
    freshness === "STALE" ? "text-amber-400/60" :
    "text-muted-foreground/40";
  return <span className={color}>{mapFreshness(freshness, t)}</span>;
}

function SourceModeBadge({ mode }: { mode: string }) {
  const { t } = useI18n();
  const color =
    mode === "LIVE" ? "text-emerald-400/60" :
    mode === "STALE" ? "text-amber-400/60" :
    "text-muted-foreground/40";
  return <span className={color}>{mapAvailability(mode, t)}</span>;
}
