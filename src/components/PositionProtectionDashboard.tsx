/**
 * Phase 61 — Position Protection Dashboard
 *
 * End-to-end position protection integration:
 * - Position registration form
 * - Real-time monitoring panels per position
 * - Alert history
 * - Toast notifications on state transitions
 * - Persistence via Convex
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */
import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import {
  mapSide,
  mapAvailability,
  mapMarketState,
  mapTrendLabel,
  mapSeverity,
  mapHorizon,
} from "@/lib/i18n/enum-mapping";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Plus,
  Trash2,
  Bell,
  BellOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PositionRegistrationForm } from "./PositionRegistrationForm";
import { PositionProtectionPanel } from "./PositionProtectionPanel";
import {
  usePositionProtection,
  type PositionRegistration,
  type MonitoredPositionState,
} from "@/lib/position-protection/use-position-protection";
import { evaluateProtection } from "@/lib/position-protection/protection-engine";
import { type LiveInstrumentState } from "@/lib/position-protection/use-live-protection-polling";
import type { AlertSeverity } from "@/lib/position-protection/types";
import {
  type PositionIntelligence,
} from "@/lib/position-protection/market-intelligence-analyzer";
import { usePositionIntelligence } from "@/lib/position-protection/use-position-intelligence";
import { getInstrumentInfo, formatInstrumentPrice } from "@/lib/position-protection/instrument-registry";
import { MarketOverviewPanel } from "./MarketOverviewPanel";
import { IntelligenceDashboard } from "./IntelligenceDashboard";
import {
  buildTimeline,
  createSnapshot,
  type HistoricalTimeline,
} from "@/lib/position-protection/historical-intelligence";
import { UserIntelligenceFeed } from "./UserIntelligenceFeed";
import { PortfolioIntelligenceView } from "./PortfolioIntelligence";
import { CustomAlertRulesPanel } from "./CustomAlertRulesPanel";
import { NotificationCenter } from "./NotificationCenter";
import { RuntimeHealthDashboard } from "./RuntimeHealthDashboard";
import { TraderWorkspace, PositionDetail } from "./TraderWorkspace";
import {
  createHealthEventBuffer,
  recordProviderResult,
  shouldPersistFromBuffer,
  markPersisted,
  buildSnapshotFromBuffer,
  type HealthEventBuffer,
} from "@/lib/position-protection/health-event-buffer";
import {
  evaluateAlertRuntimeBridge,
  buildInitialStateStore,
  removePositionTriggerRecords,
  cleanStaleInstrumentState,
  cleanStaleRuleTriggerRecords,
  type PreviousStateStore,
} from "@/lib/position-protection/alert-runtime-bridge";
import type { RuleTriggerRecord } from "@/lib/position-protection/alert-rule-engine";
import { generatePortfolioIntelligence } from "@/lib/position-protection/portfolio-intelligence";
import type { AlertDiagnosticEvent } from "@/lib/position-protection/alert-observability";
import { applyDiagnosticRetention, MAX_DIAGNOSTIC_EVENTS } from "@/lib/position-protection/alert-observability";
import {
  buildUserIntelligenceFeed,
  boundFeed,
  type UserIntelligenceFeed as FeedType,
} from "@/lib/position-protection/user-intelligence-feed";
import { useMacroContextData } from "@/lib/position-protection/use-macro-context-data";
import {
  classifyNewsFreshness,
  type NewsItem,
} from "@/lib/position-protection/news-intelligence";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import {
  decidePersistence,
  snapshotToArgs,
  eventsToArgs,
  reconstructTimeline,
  mergeTimelineEvents,
  mergeSnapshots,
  snapshotIdentity,
  isSnapshotStale,
  type PersistedSnapshot,
  type PersistedEvent,
} from "@/lib/position-protection/persistent-history-engine";
import { type OHLCVHealthEvent } from "@/lib/position-protection/use-ohlcv-data";

// ═══════════════════════════════════════════════════════════════
// SEVERITY → TOAST CONFIG
// ═══════════════════════════════════════════════════════════════

const SEVERITY_TOAST: Record<
  AlertSeverity,
  { icon: React.ReactNode; className: string; duration: number }
> = {
  NONE: {
    icon: <CheckCircle className="size-4" />,
    className: "",
    duration: 3000,
  },
  WATCH: {
    icon: <Bell className="size-4 text-blue-400" />,
    className: "border-blue-500/30",
    duration: 5000,
  },
  CAUTION: {
    icon: <AlertTriangle className="size-4 text-amber-400" />,
    className: "border-amber-500/30",
    duration: 8000,
  },
  HIGH_RISK: {
    icon: <AlertTriangle className="size-4 text-orange-400" />,
    className: "border-orange-500/30 bg-orange-500/5",
    duration: 12000,
  },
  INVALIDATED: {
    icon: <Trash2 className="size-4 text-red-400" />,
    className: "border-red-500/30 bg-red-500/5",
    duration: 0, // persistent
  },
};

// ═══════════════════════════════════════════════════════════════
// POSITION CARD
// ═══════════════════════════════════════════════════════════════

function PositionCard({
  state,
  livePrice,
  intelligence,
  onRemove,
}: {
  state: MonitoredPositionState;
  livePrice?: LiveInstrumentState;
  intelligence?: PositionIntelligence;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const { position, alert, monitoringStatus, giveback, lastUpdateAt, peakProfit } = state;

  // Generate a default alert if none exists yet
  const effectiveAlert = alert ?? evaluateProtection({
    position: {
      instrument: position.instrument,
      assetClass: "crypto",
      side: position.side,
      entryPrice: position.entryPrice,
      currentPrice: position.entryPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit,
      leverage: position.leverage,
      openedAt: position.openedAt,
      horizon: position.horizon,
    },
    evidence: { price: position.entryPrice },
    now: Date.now(),
  }).alert;

  const instrumentInfo = getInstrumentInfo(position.instrument);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      <div className="relative">
        {/* Live price + intelligence header */}
        <div className="flex items-center justify-between gap-2 mb-1 px-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-semibold text-foreground">
              {instrumentInfo?.displayName ?? position.instrument}
            </span>
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
              position.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
            }`}>
              {mapSide(position.side, t)}
            </span>
          </div>
          {livePrice && (
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-mono font-bold ${
                livePrice.sourceMode === "LIVE" ? "text-foreground" :
                livePrice.sourceMode === "STALE" ? "text-amber-400" :
                "text-muted-foreground"
              }`}>
                {livePrice.sourceMode === "LIVE" && livePrice.price > 0
                  ? formatInstrumentPrice(position.instrument, livePrice.price)
                  : mapAvailability(livePrice.sourceMode, t)}
              </span>
              <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                livePrice.sourceMode === "LIVE"
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-muted-foreground bg-muted/30"
              }`}>
                {livePrice.sourceMode === "LIVE" ? t.status.live : mapAvailability(livePrice.sourceMode, t)}
              </span>
              <span className="text-[8px] font-mono text-muted-foreground/50">
                {livePrice.provider}
              </span>
            </div>
          )}
        </div>

        {/* Intelligence + MTF summary line */}
        {intelligence && intelligence.dataQuality !== "INSUFFICIENT" && (
          <div className="flex items-center gap-2 px-1 mb-1 flex-wrap">
            {/* OHLCV Regime */}
            {intelligence.ohlcvRegime && intelligence.ohlcvRegime !== "INSUFFICIENT_DATA" && (
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                intelligence.ohlcvRegime === "TRENDING_UP" ? "text-emerald-400 bg-emerald-500/10" :
                intelligence.ohlcvRegime === "TRENDING_DOWN" ? "text-red-400 bg-red-500/10" :
                intelligence.ohlcvRegime === "VOLATILE" ? "text-amber-400 bg-amber-500/10" :
                intelligence.ohlcvRegime === "PULLBACK" ? "text-blue-400 bg-blue-500/10" :
                "text-muted-foreground bg-muted/30"
              }`}>
                {mapMarketState(intelligence.ohlcvRegime, t)}
              </span>
            )}
            {/* MTF trend badges */}
            {intelligence.h1Analysis && intelligence.h1Analysis.trend !== "UNKNOWN" && (
              <span className={`text-[8px] font-mono ${
                intelligence.h1Analysis.trend === "BULLISH" ? "text-emerald-400" :
                intelligence.h1Analysis.trend === "BEARISH" ? "text-red-400" : "text-muted-foreground"
              }`}>
                H1:{mapTrendLabel(intelligence.h1Analysis.trend, t)}
              </span>
            )}
            {intelligence.m15Analysis && intelligence.m15Analysis.trend !== "UNKNOWN" && (
              <span className={`text-[8px] font-mono ${
                intelligence.m15Analysis.trend === "BULLISH" ? "text-emerald-400" :
                intelligence.m15Analysis.trend === "BEARISH" ? "text-red-400" : "text-muted-foreground"
              }`}>
                M15:{mapTrendLabel(intelligence.m15Analysis.trend, t)}
              </span>
            )}
            {intelligence.m5Analysis && intelligence.m5Analysis.trend !== "UNKNOWN" && (
              <span className={`text-[8px] font-mono ${
                intelligence.m5Analysis.trend === "BULLISH" ? "text-emerald-400" :
                intelligence.m5Analysis.trend === "BEARISH" ? "text-red-400" : "text-muted-foreground"
              }`}>
                M5:{mapTrendLabel(intelligence.m5Analysis.trend, t)}
              </span>
            )}
            {!intelligence.ohlcvRegime && (
              <span className="text-[9px] font-mono text-muted-foreground">
                {mapMarketState(intelligence.marketState, t)}
              </span>
            )}
          </div>
        )}

        <PositionProtectionPanel
          alert={effectiveAlert}
          monitoringStatus={monitoringStatus}
          giveback={giveback ?? undefined}
          lastUpdateAt={lastUpdateAt}
          peakProfit={peakProfit}
        />
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-2 right-12 h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
          onClick={onRemove}
          title={t.protection.removeFromMonitoring}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════

export function PositionProtectionDashboard() {
  const { t, tx, txi } = useI18n();
  const {
    positions,
    registerPosition: registerPos,
    removePosition: removePos,
    ingestEvent,
    persistenceAvailable,
    persistenceDegraded,
  } = usePositionProtection();

  // ─── Shared Position Intelligence ───────────────────────
  // Single derivation of the per-position intelligence map, shared with the
  // investor workspace so the intelligence engine is never run twice by
  // different surfaces for the same positions. Keyed strictly by positionId.
  const {
    intelligenceMap,
    monitoredInstruments,
    livePrices,
    ohlcv,
    isPolling,
    successfulPolls,
    lastError,
  } = usePositionIntelligence(positions, {
    onLiveEvent: (events) => {
      // Feed real market events into the protection pipeline
      for (const event of events) {
        ingestEvent(event);
      }
    },
    onOHLCVHealthEvent: useCallback((event: OHLCVHealthEvent) => {
      healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
        component: event.component,
        source: event.source,
        operation: event.operation,
        success: event.success,
        durationMs: event.durationMs,
        error: event.error,
        message: event.message,
      });
    }, []),
  });
  const [activeTab, setActiveTab] = useState<"workspace" | "positions" | "feed" | "portfolio" | "intelligence" | "alerts" | "market" | "notifications" | "system">("workspace");
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Map<string, HistoricalTimeline>>(new Map());
  const [showForm, setShowForm] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const prevAlertsRef = useRef<Map<string, AlertSeverity>>(new Map());

  // ─── Phase 100: Record market data health from actual polling results ──
  useEffect(() => {
    if (livePrices.size === 0) return;

    const buf = healthBufferRef.current;
    for (const [, state] of livePrices) {
      if (state.success && state.price > 0) {
        healthBufferRef.current = recordProviderResult(buf, {
          component: "MARKET_DATA",
          source: state.provider,
          operation: `Price fetch: ${state.instrument}`,
          success: true,
        });
      } else if (!state.success) {
        healthBufferRef.current = recordProviderResult(buf, {
          component: "MARKET_DATA",
          source: state.provider,
          operation: `Price fetch: ${state.instrument}`,
          success: false,
          error: state.error,
          message: state.error,
        });
      }
    }
  }, [livePrices]);

  // ─── Phase 90: Convex Historical Intelligence Persistence ──
  const saveSnapshotMut = useMutation(api.historicalIntelligence.saveSnapshot);
  const saveEventsMut = useMutation(api.historicalIntelligence.saveEvents);
  const deleteHistoryMut = useMutation(api.historicalIntelligence.deleteHistoryForPosition);

  // ─── Shared Macro Context Data ───────────────────────────
  // Treasury yields + economic calendar are fetched once per mounted
  // instance here and shared with the investor workspace (the surfaces are
  // mutually exclusive tabs — no duplicate fetches can occur).
  const { treasuryData, calendarData, userPositions } = useMacroContextData(positions);

  // Fetch news for each unique instrument via Convex action
  const [feedNews, setFeedNews] = useState<Map<string, NewsItem[]>>(new Map());
  const fetchIntelligence = useAction(api.alphaVantage.fetchIntelligence);

  // Fetch news for user's instruments (rate-limit safe: one at a time)
  useEffect(() => {
    if (userPositions.length === 0) return;

    let cancelled = false;
    const instruments = [...new Set(userPositions.map(p => p.instrument))];

    async function fetchNews() {
      for (const instrument of instruments) {
        if (cancelled) break;
        try {
          const assetClass = userPositions.find(p => p.instrument === instrument)?.assetClass ?? "crypto";
          const instrumentType = assetClass === "crypto" ? "crypto" : assetClass === "forex" ? "forex" : "stock";
          const result = await fetchIntelligence({
            instrument: instrument.split("/")[0],
            instrumentType: instrumentType as any,
          });
          if (cancelled) break;

          const articles = result?.sentiment?.articles ?? [];
          const newsItems: NewsItem[] = articles.map((art: any, i: number) => {
            // Phase 218 — the provider's own publication time, or nothing.
            // Substituting Date.now() for a missing publishedAt made an
            // undated article indistinguishable from one published seconds
            // ago: the age computed to 0ms, so classifyNewsFreshness always
            // returned FRESH. Local receipt time is not a publication time.
            const publishedAtMs = art.publishedAt
              ? new Date(art.publishedAt).getTime()
              : null;
            const hasProviderTimestamp =
              publishedAtMs !== null && Number.isFinite(publishedAtMs);
            return {
            id: `av-${instrument}-${i}`,
            timestamp: hasProviderTimestamp ? publishedAtMs : 0,
            source: art.source || "AlphaVantage",
            headline: art.title || "",
            summary: art.summary || undefined,
            url: art.url || undefined,
            relatedInstruments: [instrument],
            assetClass: assetClass as any,
            category: assetClass === "crypto" ? "CRYPTO_SPECIFIC" as const : "FOREX" as const,
            sentiment: art.sentimentLabel === "positive" ? "BULLISH" as const :
                       art.sentimentLabel === "negative" ? "BEARISH" as const : "NEUTRAL" as const,
            impactStrength: "MODERATE" as const,
            // Without a provider timestamp the age is unknowable, so the
            // honest label is UNAVAILABLE rather than the freshest class.
            freshness: hasProviderTimestamp
              ? classifyNewsFreshness(publishedAtMs, Date.now())
              : ("UNAVAILABLE" as const),
            sourceMode: "LIVE" as const,
            };
          });

          setFeedNews(prev => {
            const next = new Map(prev);
            next.set(instrument, newsItems);
            return next;
          });
        } catch {
          // Provider rate limit or unavailable — skip silently
        }
        // Small delay to respect rate limits
        await new Promise(r => setTimeout(r, 200));
      }
    }

    fetchNews();
    return () => { cancelled = true; };
  }, [userPositions, fetchIntelligence]);

  // Build the user intelligence feed
  const userFeed: FeedType | null = useMemo(() => {
    if (userPositions.length === 0) return null;
    const allNews = Array.from(feedNews.values()).flat();
    if (allNews.length === 0) return null;
    return boundFeed(buildUserIntelligenceFeed(allNews, userPositions));
  }, [userPositions, feedNews]);

  // ─── Generate Intelligence per Position ───────────────────
  // (derivation lives in usePositionIntelligence — shared with the investor
  //  workspace so the intelligence engine is never duplicated)

  // Phase 103: Compute portfolio intelligence once, share between health recording and alert bridge
  const portfolioIntel = useMemo(() => {
    const intelArray = Array.from(intelligenceMap.values());
    return intelArray.length > 0 ? generatePortfolioIntelligence(intelArray) : undefined;
  }, [intelligenceMap]);

  // Phase 100: Record intelligence engine health events
  useEffect(() => {
    if (intelligenceMap.size === 0 && positions.length === 0) return;
    const analyzed = intelligenceMap.size;
    const total = positions.length;
    const success = analyzed > 0 && analyzed >= total;
    healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
      component: "INTELLIGENCE_ENGINE",
      operation: `Analyzed ${analyzed}/${total} positions`,
      success,
      message: `${analyzed}/${total} positions analyzed`,
    });
  }, [intelligenceMap.size, positions.length]);

  // Phase 100: Record portfolio intelligence health events (uses memoized portfolioIntel)
  useEffect(() => {
    if (!portfolioIntel) return;
    healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
      component: "PORTFOLIO_INTELLIGENCE",
      operation: "Portfolio analysis",
      success: true,
      message: `${portfolioIntel.summary.totalPositions} positions analyzed`,
    });
  }, [portfolioIntel]);

  // ─── Phase 91: Reactive Convex Historical Timeline Queries ──
  // One query per position, reactive — automatically updates when Convex data changes
  const positionIds = useMemo(() => positions.map(p => p.position.positionId), [positions]);
  const convTimeline0 = useQuery(
    api.historicalIntelligence.getHistoricalTimeline,
    positionIds.length > 0 ? { positionId: positionIds[0] } : "skip",
  );
  const convTimeline1 = useQuery(
    api.historicalIntelligence.getHistoricalTimeline,
    positionIds.length > 1 ? { positionId: positionIds[1] } : "skip",
  );
  const convTimeline2 = useQuery(
    api.historicalIntelligence.getHistoricalTimeline,
    positionIds.length > 2 ? { positionId: positionIds[2] } : "skip",
  );
  const convTimeline3 = useQuery(
    api.historicalIntelligence.getHistoricalTimeline,
    positionIds.length > 3 ? { positionId: positionIds[3] } : "skip",
  );
  const convTimeline4 = useQuery(
    api.historicalIntelligence.getHistoricalTimeline,
    positionIds.length > 4 ? { positionId: positionIds[4] } : "skip",
  );

  // Map Convex reactive results by positionId
  const convTimelines = useMemo(() => {
    const map = new Map<string, any>();
    const results = [convTimeline0, convTimeline1, convTimeline2, convTimeline3, convTimeline4];
    for (let i = 0; i < positionIds.length && i < results.length; i++) {
      const result = results[i];
      if (result && result.latestSnapshot) {
        map.set(positionIds[i], result);
      }
    }
    return map;
  }, [positionIds, convTimeline0, convTimeline1, convTimeline2, convTimeline3, convTimeline4]);

  // Track last-persisted snapshot identity to prevent redundant saves
  const lastPersistedRef = useRef<Map<string, string>>(new Map());

  // ─── Phase 95: Runtime Alert Evaluation Bridge ──────────────
  const alertRules = useQuery(api.alertRules.listRules);
  const prevStateRef = useRef<PreviousStateStore | null>(null);
  const triggerRecordsRef = useRef<Map<string, RuleTriggerRecord>>(new Map());
  const bridgeInitializedRef = useRef(false);
  const diagnosticsRef = useRef<AlertDiagnosticEvent[]>([]);
  const healthBufferRef = useRef<HealthEventBuffer>(createHealthEventBuffer());
  const saveHealthMut = useMutation(api.runtimeHealth.saveRuntimeHealth);
  const healthSnapshot = useMemo(() => buildSnapshotFromBuffer(healthBufferRef.current, Date.now()), [intelligenceMap]);

  // ─── Phase 91: Build Historical Timelines (Convex-first merge) ──
  useEffect(() => {
    if (intelligenceMap.size === 0) return;

    setTimelines(prev => {
      const next = new Map(prev);
      for (const [posId, intel] of intelligenceMap) {
        const existing = next.get(posId) ?? null;
        const snapshot = createSnapshot({
          positionId: posId,
          instrument: intel.instrument,
          side: intel.side,
          thesisState: intel.thesisHealth,
          evidenceQuality: intel.confidence,
          marketRegime: intel.marketState,
          h1Trend: intel.h1Analysis?.trend ?? "UNKNOWN",
          m15Trend: intel.m15Analysis?.trend ?? "UNKNOWN",
          m5Trend: intel.m5Analysis?.trend ?? "UNKNOWN",
          mtfAlignment: intel.mtfConfluence?.allAligned ? "ALIGNED" : "CONFLICT",
          momentum: intel.h1Analysis?.momentum ?? "UNKNOWN",
          volatility: intel.h1Analysis?.volatility ?? "UNKNOWN",
          structure: intel.h1Analysis?.structure ?? "INSUFFICIENT_DATA",
          supportingCount: intel.evidence.filter(e => e.direction === "supporting").length,
          conflictingCount: intel.evidence.filter(e => e.direction === "conflicting").length,
          invalidationCondition: intel.invalidationConditions[0]?.description ?? "—",
          watchNext: intel.nextMonitor[0] ?? "—",
          dataAvailability: intel.dataQuality,
        });

        // Phase 91: Determine persistence decision with race-condition guard
        const previous = existing?.latestSnapshot ?? null;
        const decision = decidePersistence(previous, snapshot);

        // Race-condition guard: skip if snapshot identity matches last persisted
        const lastId = lastPersistedRef.current.get(posId) ?? null;
        const stale = isSnapshotStale(snapshot, lastId);

        // Persist meaningful changes to Convex (fire-and-forget)
        if (decision.shouldPersistSnapshot && !stale) {
          lastPersistedRef.current.set(posId, snapshotIdentity(snapshot));
          saveSnapshotMut(snapshotToArgs(snapshot)).then(() => {
            healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
              component: "HISTORICAL_PERSISTENCE",
              operation: "Save snapshot",
              success: true,
            });
          }).catch((err) => {
            healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
              component: "HISTORICAL_PERSISTENCE",
              operation: "Save snapshot",
              success: false,
              error: err,
            });
          });
        }
        if (decision.shouldPersistEvents && decision.newEvents.length > 0 && !stale) {
          saveEventsMut(eventsToArgs(
            posId, intel.instrument, intel.side, decision.newEvents,
          )).then(() => {
            healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
              component: "HISTORICAL_PERSISTENCE",
              operation: "Save events",
              success: true,
            });
          }).catch((err) => {
            healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
              component: "HISTORICAL_PERSISTENCE",
              operation: "Save events",
              success: false,
              error: err,
            });
          });
        }

        // Phase 91: Build local timeline (optimistic layer)
        const localTimeline = buildTimeline(existing, snapshot);

        // Phase 91: Merge with Convex data if available
        const convData = convTimelines.get(posId);
        if (convData) {
          // Reconstruct authoritative timeline from Convex
          const persistedSnapshots: PersistedSnapshot[] = [];
          if (convData.latestSnapshot) persistedSnapshots.push(convData.latestSnapshot);
          if (convData.previousSnapshot) persistedSnapshots.push(convData.previousSnapshot);
          const persistedEvents: PersistedEvent[] = convData.events ?? [];
          const convTimeline = reconstructTimeline(persistedSnapshots, persistedEvents);

          // Merge: local optimistic + Convex authoritative
          const mergedLatest = mergeSnapshots(localTimeline.latestSnapshot, convTimeline.latestSnapshot);
          const mergedPrevious = mergeSnapshots(localTimeline.previousSnapshot, convTimeline.previousSnapshot);
          const mergedEvents = mergeTimelineEvents(localTimeline.events, convTimeline.events);

          next.set(posId, {
            positionId: posId,
            latestSnapshot: mergedLatest,
            previousSnapshot: mergedPrevious,
            events: mergedEvents,
            summary: localTimeline.summary ?? convTimeline.summary,
          });
        } else {
          // No Convex data yet — use local optimistic timeline
          next.set(posId, localTimeline);
        }
      }
      return next;
    });
  }, [intelligenceMap, convTimelines, saveSnapshotMut, saveEventsMut]);

  // ─── Phase 95: Runtime Alert Evaluation Bridge ────────────
  const createNotificationMut = useMutation(api.notifications.createNotification);

  useEffect(() => {
    if (intelligenceMap.size === 0) return;
    if (!alertRules || alertRules.length === 0) return;

    // Cast Convex records to AlertRule[] (scope/type fields are stored as strings)
    const typedRules = alertRules as unknown as import("@/lib/position-protection/alert-rule-engine").AlertRule[];

    const now = Date.now();

    // Clean stale rule trigger records when rules change
    const activeRuleIds = new Set(typedRules.map((r) => r.ruleId));
    triggerRecordsRef.current = cleanStaleRuleTriggerRecords(triggerRecordsRef.current, activeRuleIds);

    // Initialize previous state on first run (seeds without generating false transitions)
    if (!bridgeInitializedRef.current) {
      prevStateRef.current = buildInitialStateStore(intelligenceMap);
      bridgeInitializedRef.current = true;
      return;
    }

    const prevState = prevStateRef.current ?? buildInitialStateStore(intelligenceMap);

    // Use memoized portfolio intelligence (computed once per intelligenceMap update)
    const currentPortfolioIntel = portfolioIntel;

    // Run the deterministic evaluation bridge
    const result = evaluateAlertRuntimeBridge(
      {
        rules: typedRules,
        intelligenceMap,
        portfolioIntelligence: currentPortfolioIntel,
        previousMacroRegime: undefined,
        macroRegime: undefined,
      },
      prevState,
      triggerRecordsRef.current,
      now,
    );

    // Update refs for next cycle
    triggerRecordsRef.current = result.updatedTriggerRecords;
    prevStateRef.current = { ...prevState, snapshots: result.updatedPreviousSnapshots };
    diagnosticsRef.current = applyDiagnosticRetention([...diagnosticsRef.current, ...result.diagnostics], MAX_DIAGNOSTIC_EVENTS);

    // Phase 100: Record alert pipeline health
    healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
      component: "ALERT_RULE_ENGINE",
      operation: `Evaluated ${typedRules.length} rules`,
      success: true,
      message: `${typedRules.length} rules evaluated, ${result.notifications.length} notifications generated`,
    });

    // Persist notifications to Convex (fire-and-forget, rate-limit safe)
    for (const notif of result.notifications) {
      createNotificationMut({
        notificationId: notif.notificationId,
        alertIdentity: notif.alertIdentity,
        ruleId: notif.ruleId,
        ruleName: notif.ruleName,
        timestamp: notif.timestamp,
        instrument: notif.instrument,
        positionId: notif.positionId,
        side: notif.side,
        severity: notif.severity,
        title: notif.title,
        message: notif.message,
        category: notif.category,
        impact: notif.impact,
        source: notif.source,
        condition: notif.condition,
      }).then(() => {
        // Phase 100: Record notification persistence success
        healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
          component: "NOTIFICATION_PERSISTENCE",
          operation: "Persist notification",
          success: true,
        });
      }).catch((err) => {
        // Phase 100: Record notification persistence failure
        healthBufferRef.current = recordProviderResult(healthBufferRef.current, {
          component: "NOTIFICATION_PERSISTENCE",
          operation: "Persist notification",
          success: false,
          error: err,
          message: "Notification persistence failed",
        });
      });
    }
  }, [intelligenceMap, alertRules, createNotificationMut]);

  // ─── Phase 95/97: Reset bridge state when positions are removed ──
  useEffect(() => {
    const ps = prevStateRef.current;
    if (!ps) return;
    const currentIds = new Set(positions.map((p) => p.position.positionId));
    const prevIds = Array.from(ps.snapshots.keys());
    let changed = false;
    for (const pid of prevIds) {
      if (!currentIds.has(pid)) {
        // Clean up all trigger records for this position
        triggerRecordsRef.current = removePositionTriggerRecords(triggerRecordsRef.current, pid);
        changed = true;
      }
    }
    if (changed) {
      // Rebuild previous state from current positions
      const activeInstruments = new Set(positions.map((p) => p.position.instrument));
      const cleanedSnapshots = new Map(ps.snapshots);
      for (const pid of prevIds) {
        if (!currentIds.has(pid)) cleanedSnapshots.delete(pid);
      }
      const cleanedState = cleanStaleInstrumentState({ snapshots: cleanedSnapshots, newsStance: ps.newsStance, dataAvailability: ps.dataAvailability }, activeInstruments);
      prevStateRef.current = cleanedState;
    }
  }, [positions]);

  // Phase 102: Guard against recursive persistence loops
  const isPersistingHealthRef = useRef(false);

  // Phase 100: Automatic health persistence
  useEffect(() => {
    if (intelligenceMap.size === 0 && positions.length === 0) return;
    if (isPersistingHealthRef.current) return; // prevent recursive loop
    const now = Date.now();
    const snapshotToPersist = shouldPersistFromBuffer(healthBufferRef.current, now);
    if (snapshotToPersist) {
      healthBufferRef.current = markPersisted(healthBufferRef.current, snapshotToPersist);
      isPersistingHealthRef.current = true;
      saveHealthMut({
        timestamp: snapshotToPersist.timestamp,
        overallStatus: snapshotToPersist.overallStatus,
        components: snapshotToPersist.components.map((c) => ({
          component: c.component,
          status: c.status,
          lastSuccessAt: c.lastSuccessAt,
          lastFailureAt: c.lastFailureAt,
          lastAttemptAt: c.lastAttemptAt,
          consecutiveFailures: c.consecutiveFailures,
          message: c.message,
          source: c.source,
          dataAgeMs: c.dataAgeMs,
          freshness: c.freshness,
        })),
        intelligenceCycleStatus: snapshotToPersist.intelligenceCycleStatus,
        alertPipelineStatus: snapshotToPersist.alertPipelineStatus,
        persistenceStatus: snapshotToPersist.persistenceStatus,
        providerAvailability: snapshotToPersist.providerAvailability,
        staleComponents: snapshotToPersist.staleComponents,
        unavailableComponents: snapshotToPersist.unavailableComponents,
      }).then(() => {
        isPersistingHealthRef.current = false;
      }).catch(() => {
        isPersistingHealthRef.current = false;
        // Do NOT record a health event for persistence failure — prevents recursive loop
      });
    }
  }, [intelligenceMap, positions.length, saveHealthMut]);

  // ─── Toast Notifications on State Transitions ───────────
  useEffect(() => {
    if (!notificationsEnabled) return;

    for (const pos of positions) {
      if (!pos.alert) continue;
      const prevSeverity = prevAlertsRef.current.get(pos.position.positionId);
      const newSeverity = pos.alert.severity;

      // Only toast on state transitions
      if (prevSeverity !== undefined && prevSeverity !== newSeverity) {
        const toastCfg = SEVERITY_TOAST[newSeverity];
        const instrument = pos.position.instrument;
        const side = pos.position.side;

        if (newSeverity === "NONE") {
          toast.success(`${instrument} ${mapSide(side, t)} — ${t.protection.toastThesisHealthy}`, {
            description: t.protection.toastHealthyDesc,
            icon: <CheckCircle className="size-4 text-emerald-400" />,
            duration: 3000,
          });
        } else if (newSeverity === "INVALIDATED") {
          toast.error(`${instrument} ${mapSide(side, t)} — ${t.protection.toastThesisInvalidated}`, {
            description: pos.alert.alertMessage,
            icon: toastCfg.icon,
            duration: 0,
            className: toastCfg.className,
          });
        } else {
          toast(`${instrument} ${mapSide(side, t)} — ${mapSeverity(newSeverity, t)}`, {
            description: pos.alert.actionRecommendation,
            icon: toastCfg.icon,
            duration: toastCfg.duration,
            className: toastCfg.className,
          });
        }
      }

      prevAlertsRef.current.set(pos.position.positionId, newSeverity);
    }
  }, [positions, notificationsEnabled]);

  // ─── Register Handler ────────────────────────────────────
  const handleRegister = useCallback(
    (reg: PositionRegistration) => {
      registerPos(reg);
      setShowForm(false);
      toast.success(txi("protection.registeredToast", { instrument: reg.instrument }), {
        description: txi("protection.registeredToastDesc", {
          side: mapSide(reg.side, t),
          horizon: mapHorizon(reg.horizon, t),
        }),
        icon: <Shield className="size-4 text-primary" />,
        duration: 3000,
      });
    },
    [registerPos],
  );

  // ─── Remove Handler ──────────────────────────────────────
  const handleRemove = useCallback(
    (positionId: string, instrument: string) => {
      removePos(positionId);
      prevAlertsRef.current.delete(positionId);
      // Phase 90: Clean up persisted historical intelligence
      deleteHistoryMut({ positionId }).catch(() => {});
      // Also remove from local timeline state
      setTimelines(prev => {
        const next = new Map(prev);
        next.delete(positionId);
        return next;
      });
      toast.info(txi("protection.removedToast", { instrument }), {
        icon: <BellOff className="size-4" />,
        duration: 3000,
      });
    },
    [removePos, deleteHistoryMut],
  );

  // ─── Summary Stats ───────────────────────────────────────
  const activeCount = positions.length;
  const alertCount = positions.filter(
    (p) => p.alert && p.alert.severity !== "NONE",
  ).length;
  const highRiskCount = positions.filter(
    (p) =>
      p.alert &&
      (p.alert.severity === "HIGH_RISK" ||
        p.alert.severity === "INVALIDATED"),
  ).length;

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15">
            <Shield className="size-3.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-mono font-bold tracking-tight">
              {tx("protection.title")}
            </h2>
            <p className="text-[10px] font-mono text-muted-foreground">
              {txi("protection.monitoredCount", { count: activeCount })}
              {" · "}
              {txi("protection.alertsCount", { count: alertCount })}
              {highRiskCount > 0 && (
                <span className="text-orange-400 ml-1">
                  {" · "}
                  {txi("protection.criticalCount", { count: highRiskCount })}
                </span>
              )}
            </p>
            {/*
              Phase 191 — the execution boundary, stated where monitoring is
              claimed.

              `protection.noAutoExecute` and `protection.confidenceNotProbability`
              were translated into all nine locales but rendered nowhere, so a
              user watching live position alerts was never told that the system
              only observes: it never closes a position, and no broker or
              exchange is contacted. A monitoring surface that stays silent on
              that point is exactly where an alert gets mistaken for a fill.
            */}
            <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
              {tx("protection.noAutoExecute")}
              {" "}
              {tx("protection.confidenceNotProbability")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Persistence indicator */}
          <div
            className={`flex items-center gap-1 text-[10px] font-mono ${
              persistenceDegraded
                ? "text-amber-400"
                : persistenceAvailable
                  ? "text-emerald-400"
                  : "text-muted-foreground"
            }`}
          >
            <div
              className={`size-1.5 rounded-full ${
                persistenceDegraded
                  ? "bg-amber-400"
                  : persistenceAvailable
                    ? "bg-emerald-400"
                    : "bg-muted-foreground"
              }`}
            />
            {persistenceDegraded
              ? t.protection.persistenceDegraded
              : persistenceAvailable
                ? t.protection.persistencePersisted
                : t.protection.persistenceLocalOnly}
          </div>

          {/* Live data indicator */}
          {monitoredInstruments.length > 0 && (
            <div
              className={`flex items-center gap-1 text-[10px] font-mono ${
                lastError
                  ? "text-amber-400"
                  : isPolling && successfulPolls > 0
                    ? "text-emerald-400"
                    : isPolling
                      ? "text-blue-400"
                      : "text-muted-foreground"
              }`}
            >
              <div
                className={`size-1.5 rounded-full ${
                  lastError
                    ? "bg-amber-400"
                    : isPolling && successfulPolls > 0
                      ? "bg-emerald-400"
                      : isPolling
                        ? "bg-blue-400 animate-pulse"
                        : "bg-muted-foreground"
                }`}
              />
              {lastError
                ? t.protection.dataDegraded
                : isPolling && successfulPolls > 0
                  ? txi("protection.dataLive", { count: successfulPolls })
                  : isPolling
                    ? t.protection.dataConnecting
                    : t.protection.dataNoData}
            </div>
          )}

          {/* Notification toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            title={notificationsEnabled ? t.protection.disableToasts : t.protection.enableToasts}
          >
            {notificationsEnabled ? (
              <Bell className="size-3 text-primary" />
            ) : (
              <BellOff className="size-3 text-muted-foreground" />
            )}
          </Button>

          {/* Add button */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] font-mono gap-1"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="size-3" />
            {showForm ? t.protection.cancel : t.protection.addPosition}
          </Button>
        </div>
      </div>

      {/* Registration Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border border-border/30 rounded-lg p-3">
              <PositionRegistrationForm onRegister={handleRegister} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab Switcher */}
      {positions.length > 0 && (
        <div className="flex items-center gap-1 p-0.5 bg-muted/30 rounded-lg">
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "workspace"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setActiveTab("workspace"); setSelectedPositionId(null); }}
          >
            {t.nav.overview}
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "positions"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setActiveTab("positions"); setSelectedPositionId(null); }}
          >
            {t.nav.positions} ({positions.length})
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "feed"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("feed")}
          >
            {t.nav.feed}
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "portfolio"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("portfolio")}
          >
            {t.nav.portfolio}
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "intelligence"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("intelligence")}
          >
            {t.nav.intelligence}
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "alerts"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("alerts")}
          >
            {t.nav.rules}
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "notifications"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("notifications")}
          >
            {t.nav.alerts}
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "market"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("market")}
          >
            {t.nav.market}
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "system"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("system")}
          >
            {t.nav.system}
          </button>
        </div>
      )}

      {/* Workspace Tab */}
      {activeTab === "workspace" && !selectedPositionId && (
        <TraderWorkspace
          intelligenceMap={intelligenceMap}
          portfolioIntel={portfolioIntel ?? null}
          healthSnapshot={healthSnapshot}
          alertCount={alertRules?.length ?? 0}
          unreadCount={0}
          feedNews={feedNews}
          onSelectPosition={(pid) => setSelectedPositionId(pid)}
          onSelectPortfolio={() => setActiveTab("portfolio")}
          onSelectAlerts={() => setActiveTab("alerts")}
          onSelectSystem={() => setActiveTab("system")}
        />
      )}

      {/* Position Detail View */}
      {activeTab === "workspace" && selectedPositionId && intelligenceMap.has(selectedPositionId) && (
        <PositionDetail
          positionId={selectedPositionId}
          intel={intelligenceMap.get(selectedPositionId)!}
          newsItems={feedNews.get(intelligenceMap.get(selectedPositionId)!.instrument)}
          livePrices={livePrices}
          treasuryData={treasuryData ?? undefined}
          calendarData={calendarData ?? undefined}
          onBack={() => setSelectedPositionId(null)}
        />
      )}

      {/* Positions Tab */}
      {activeTab === "positions" && (
        <>
          <AnimatePresence>
            {positions.map((pos) => (
              <PositionCard
                key={pos.position.positionId}
                state={pos}
                livePrice={livePrices.get(pos.position.instrument)}
                intelligence={intelligenceMap.get(pos.position.positionId)}
                onRemove={() =>
                  handleRemove(pos.position.positionId, pos.position.instrument)
                }
              />
            ))}
          </AnimatePresence>
        </>
      )}

      {/* Alerts Tab */}
      {activeTab === "alerts" && (
        <CustomAlertRulesPanel />
      )}

      {/* Notifications Tab */}
      {activeTab === "notifications" && (
        <NotificationCenter />
      )}

      {/* Market Overview Tab */}
      {activeTab === "market" && (
        <MarketOverviewPanel livePrices={livePrices} />
      )}

      {/* System Health Tab */}
      {activeTab === "system" && (
        <RuntimeHealthDashboard
          healthInput={{
            marketDataAvailable: livePrices.size > 0,
            ohlcvAvailable: Object.keys(ohlcv).length > 0 || positions.some((p) => p.position.horizon === "SCALPING"),
            newsAvailable: true,
            macroAvailable: true,
            crossAssetAvailable: positions.length > 1,
            intelligencePositionsAnalyzed: intelligenceMap.size,
            intelligencePositionsTotal: positions.length,
            portfolioIntelligenceAvailable: intelligenceMap.size > 1,
            alertRulesEvaluated: alertRules?.length ?? 0,
            alertRulesTriggered: 0,
            notificationPersisted: true,
            historicalSnapshotPersisted: true,
            historicalEventsPersisted: true,
            lastIntelligenceCycleAt: Date.now(),
            dataQuality: Object.fromEntries(
              Array.from(intelligenceMap.entries()).map(([, intel]) => [
                intel.instrument,
                intel.dataQuality,
              ]),
            ),
          }}
        />
      )}

      {/* Empty State */}
      {positions.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50 mb-3">
            <Shield className="size-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs font-mono text-muted-foreground max-w-xs">
            {t.protection.noPositionsHint}
          </p>
        </div>
      )}

      {/* Feed Tab */}
      {activeTab === "feed" && (
        <UserIntelligenceFeed feed={userFeed} />
      )}

      {/* Portfolio Tab */}
      {activeTab === "portfolio" && (
        <PortfolioIntelligenceView
          positions={Array.from(intelligenceMap.values())}
        />
      )}

      {/* Intelligence Tab */}
      {activeTab === "intelligence" && positions.length > 0 && (
        <div className="space-y-3">
          {positions.map((pos) => {
            const intel = intelligenceMap.get(pos.position.positionId);
            return (
              <div key={pos.position.positionId} className="border border-border/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono font-bold text-foreground">
                    {getInstrumentInfo(pos.position.instrument)?.displayName ?? pos.position.instrument}
                  </span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                    pos.position.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                  }`}>
                    {mapSide(pos.position.side, t)}
                  </span>
                </div>
                <IntelligenceDashboard
                  intelligence={intel}
                  multiDimensional={null}
                  marketContext={null}
                  analyticalSummary={null}
                  whatChanged={null}
                  positionSide={pos.position.side}
                  instrument={pos.position.instrument}
                  historicalTimeline={timelines.get(pos.position.positionId) ?? null}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-[9px] font-mono text-muted-foreground/40 pt-2 border-t border-border/20">
        {t.global.disclaimer}
      </div>
    </div>
  );
}
