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
  RefreshCw,
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
import { useLiveProtectionPolling, type LiveInstrumentState } from "@/lib/position-protection/use-live-protection-polling";
import type { AlertSeverity } from "@/lib/position-protection/types";
import type { ProtectionEvent } from "@/lib/position-protection/realtime-types";
import {
  type PriceObservationState,
  createObservationState,
  addObservation,
  buildMarketIntelligence,
} from "@/lib/position-protection/price-observation-engine";
import {
  generatePositionIntelligence,
  type PositionIntelligence,
} from "@/lib/position-protection/market-intelligence-analyzer";
import { getInstrumentInfo, formatInstrumentPrice } from "@/lib/position-protection/instrument-registry";
import { MarketOverviewPanel } from "./MarketOverviewPanel";
import { IntelligenceDashboard } from "./IntelligenceDashboard";
import { UserIntelligenceFeed } from "./UserIntelligenceFeed";
import {
  extractUserPositions,
  buildUserIntelligenceFeed,
  boundFeed,
  type UserIntelligenceFeed as FeedType,
  type UserPosition,
} from "@/lib/position-protection/user-intelligence-feed";
import {
  classifyNewsFreshness,
  type NewsItem,
} from "@/lib/position-protection/news-intelligence";
import { useQuery, useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import { useOHLCVData } from "@/lib/position-protection/use-ohlcv-data";
import type { TimeframeKey } from "@/lib/position-protection/multi-timeframe-engine";

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
              {position.side}
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
                  : livePrice.sourceMode}
              </span>
              <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                livePrice.sourceMode === "LIVE"
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-muted-foreground bg-muted/30"
              }`}>
                {livePrice.sourceMode === "LIVE" ? "LIVE" : livePrice.sourceMode}
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
                {intelligence.ohlcvRegime.replace(/_/g, " ")}
              </span>
            )}
            {/* MTF trend badges */}
            {intelligence.h1Analysis && intelligence.h1Analysis.trend !== "UNKNOWN" && (
              <span className={`text-[8px] font-mono ${
                intelligence.h1Analysis.trend === "BULLISH" ? "text-emerald-400" :
                intelligence.h1Analysis.trend === "BEARISH" ? "text-red-400" : "text-muted-foreground"
              }`}>
                H1:{intelligence.h1Analysis.trend}
              </span>
            )}
            {intelligence.m15Analysis && intelligence.m15Analysis.trend !== "UNKNOWN" && (
              <span className={`text-[8px] font-mono ${
                intelligence.m15Analysis.trend === "BULLISH" ? "text-emerald-400" :
                intelligence.m15Analysis.trend === "BEARISH" ? "text-red-400" : "text-muted-foreground"
              }`}>
                M15:{intelligence.m15Analysis.trend}
              </span>
            )}
            {intelligence.m5Analysis && intelligence.m5Analysis.trend !== "UNKNOWN" && (
              <span className={`text-[8px] font-mono ${
                intelligence.m5Analysis.trend === "BULLISH" ? "text-emerald-400" :
                intelligence.m5Analysis.trend === "BEARISH" ? "text-red-400" : "text-muted-foreground"
              }`}>
                M5:{intelligence.m5Analysis.trend}
              </span>
            )}
            {!intelligence.ohlcvRegime && (
              <span className="text-[9px] font-mono text-muted-foreground">
                {intelligence.marketState.replace(/_/g, " ")}
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
          title="Remove from monitoring"
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
  const {
    positions,
    registerPosition: registerPos,
    removePosition: removePos,
    acknowledgeAlert,
    ingestEvent,
    persistenceAvailable,
    persistenceDegraded,
  } = usePositionProtection();

  // ─── Live Market Polling ──────────────────────────────
  // Derive unique instruments from registered positions
  const monitoredInstruments = useMemo(
    () => [...new Set(positions.map((p) => p.position.instrument))],
    [positions],
  );

  const {
    livePrices,
    isPolling,
    lastPollAt,
    totalPolls,
    successfulPolls,
    failedPolls,
    lastError,
  } = useLiveProtectionPolling(monitoredInstruments, {
    enabled: monitoredInstruments.length > 0,
    pollIntervalMs: 30_000,
    onEvent: (events) => {
      // Feed real market events into the protection pipeline
      for (const event of events) {
        ingestEvent(event);
      }
    },
  });

  // ─── OHLCV Data (MTF candles) ─────────────────────────
  const ohlcv = useOHLCVData(monitoredInstruments, {
    enabled: monitoredInstruments.length > 0,
    timeframes: ["M5", "M15", "H1"],
    refreshIntervalMs: 120_000,
  });

  // ─── Price Observations (per instrument) ─────────────────
  const [priceObservations, setPriceObservations] = useState<Map<string, PriceObservationState>>(new Map());
  const [activeTab, setActiveTab] = useState<"positions" | "feed" | "intelligence" | "market">("positions");
  const [showForm, setShowForm] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const prevAlertsRef = useRef<Map<string, AlertSeverity>>(new Map());

  // ─── Update Price Observations from Live Data ────────────
  useEffect(() => {
    if (livePrices.size === 0) return;

    setPriceObservations((prev) => {
      const next = new Map(prev);
      const now = Date.now();

      for (const [instrument, state] of livePrices) {
        if (state.sourceMode !== "LIVE" || state.price <= 0) continue;

        const obs = next.get(instrument) ?? createObservationState(instrument);
        next.set(instrument, addObservation(obs, state.price, now));
      }

      return next;
    });
  }, [livePrices]);

  // ─── User Intelligence Feed ────────────────────────────────
  const userPositions = useMemo(
    () => extractUserPositions(positions.map(p => ({ instrument: p.position.instrument, side: p.position.side as "LONG" | "SHORT" }))),
    [positions],
  );

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
          const newsItems: NewsItem[] = articles.map((art: any, i: number) => ({
            id: `av-${instrument}-${i}`,
            timestamp: art.publishedAt ? new Date(art.publishedAt).getTime() : Date.now(),
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
            freshness: classifyNewsFreshness(
              art.publishedAt ? new Date(art.publishedAt).getTime() : Date.now(),
              Date.now(),
            ),
            sourceMode: "LIVE" as const,
          }));

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
  const intelligenceMap = useMemo(() => {
    const map = new Map<string, PositionIntelligence>();

    for (const pos of positions) {
      const obs = priceObservations.get(pos.position.instrument);
      const alert = pos.alert;
      const live = livePrices.get(pos.position.instrument);

      const currentPrice = live?.sourceMode === "LIVE" && live.price > 0
        ? live.price
        : pos.position.entryPrice;

      const intelligence = generatePositionIntelligence({
        position: {
          instrument: pos.position.instrument,
          side: pos.position.side,
          entryPrice: pos.position.entryPrice,
          currentPrice,
          stopLoss: pos.position.stopLoss,
          takeProfit: pos.position.takeProfit,
          leverage: pos.position.leverage,
          horizon: pos.position.horizon,
        },
        observationState: obs ?? createObservationState(pos.position.instrument),
        thesisHealth: alert?.thesisHealth ?? "UNKNOWN",
        thesisHealthScore: alert?.thesisHealthScore ?? 50,
        severity: alert?.severity ?? "NONE",
        actionRecommendation: alert?.actionRecommendation ?? "Hold and monitor.",
        givebackPct: pos.giveback?.givebackPct,
        sourceMode: live?.sourceMode ?? "UNAVAILABLE",
        provider: live?.provider ?? "—",
        mtfConfluence: ohlcv.confluence.get(pos.position.instrument),
      });

      map.set(pos.position.positionId, intelligence);
    }

    return map;
  }, [positions, priceObservations, livePrices]);

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
          toast.success(`${instrument} ${side} — Thesis healthy`, {
            description: "Position protection status returned to healthy.",
            icon: <CheckCircle className="size-4 text-emerald-400" />,
            duration: 3000,
          });
        } else if (newSeverity === "INVALIDATED") {
          toast.error(`${instrument} ${side} — Thesis invalidated`, {
            description: pos.alert.alertMessage,
            icon: toastCfg.icon,
            duration: 0,
            className: toastCfg.className,
          });
        } else {
          toast(`${instrument} ${side} — ${newSeverity.replace("_", " ")}`, {
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
      toast.success(`${reg.instrument} registered for monitoring`, {
        description: `${reg.side} position — ${reg.horizon} horizon`,
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
      toast.info(`${instrument} removed from monitoring`, {
        icon: <BellOff className="size-4" />,
        duration: 3000,
      });
    },
    [removePos],
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
              Position Protection
            </h2>
            <p className="text-[10px] font-mono text-muted-foreground">
              {activeCount} monitored · {alertCount} alerts
              {highRiskCount > 0 && (
                <span className="text-orange-400 ml-1">
                  · {highRiskCount} critical
                </span>
              )}
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
              ? "degraded"
              : persistenceAvailable
                ? "persisted"
                : "local only"}
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
                ? "data degraded"
                : isPolling && successfulPolls > 0
                  ? `live (${successfulPolls})`
                  : isPolling
                    ? "connecting"
                    : "no data"}
            </div>
          )}

          {/* Notification toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            title={notificationsEnabled ? "Disable toasts" : "Enable toasts"}
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
            {showForm ? "Cancel" : "Add Position"}
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
              activeTab === "positions"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("positions")}
          >
            Positions ({positions.length})
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "feed"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("feed")}
          >
            Feed
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "intelligence"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("intelligence")}
          >
            Intelligence
          </button>
          <button
            className={`flex-1 text-[10px] font-mono py-1.5 px-2 rounded-md transition-colors ${
              activeTab === "market"
                ? "bg-background text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("market")}
          >
            Market
          </button>
        </div>
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

      {/* Market Overview Tab */}
      {activeTab === "market" && (
        <MarketOverviewPanel livePrices={livePrices} />
      )}

      {/* Empty State */}
      {positions.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/50 mb-3">
            <Shield className="size-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs font-mono text-muted-foreground max-w-xs">
            No positions being monitored. Click &quot;Add Position&quot; to register an open
            position for real-time profit protection.
          </p>
        </div>
      )}

      {/* Feed Tab */}
      {activeTab === "feed" && (
        <UserIntelligenceFeed feed={userFeed} />
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
                    {pos.position.side}
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
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-[9px] font-mono text-muted-foreground/40 pt-2 border-t border-border/20">
        Informational only. All alerts are manual-action recommendations.
        No trades are executed automatically. Intelligence confidence ≠ likelihood of price movement.
      </div>
    </div>
  );
}
