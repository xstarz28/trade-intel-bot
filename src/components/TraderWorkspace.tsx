/**
 * Phase 107 — Trader Workspace & Intelligence Actionability
 *
 * Presentation-only component that makes existing intelligence
 * easier to understand and act upon manually.
 *
 * NO new intelligence calculations.
 * NO auto-execution.
 * NO fabricated data.
 * NO probability claims.
 *
 * Reuses existing: intelligenceMap, portfolioIntel, RuntimeHealth.
 */

import React, { useMemo } from "react";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Newspaper,
  Globe,
  Activity,
  Eye,
  ChevronRight,
  BarChart3,
  Layers,
  Crosshair,
  Zap,
  Info,
  Bell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PositionIntelligence } from "@/lib/position-protection/market-intelligence-analyzer";
import type { PortfolioIntelligence } from "@/lib/position-protection/portfolio-intelligence";
import type { RuntimeHealthSnapshot } from "@/lib/position-protection/runtime-health";
import { getInstrumentInfo } from "@/lib/position-protection/instrument-registry";
import {
  buildDecisionSupport,
  getDecisionSupportSummary,
  type PositionDecisionSupport,
} from "@/lib/position-protection/decision-support";
import {
  buildFundamentalRegime,
  buildAssetFundamentalContext,
  assessTechnicalFundamentalAlignment,
  buildFundamentalInputFromPositionIntel,
  mapInstrumentToAssetClass,
  type FundamentalRegimeInput,
  type FundamentalRegime,
  type AssetFundamentalContext,
} from "@/lib/position-protection/fundamental-regime";
import type { AssetClass } from "@/lib/position-protection/fundamental-regime";
import type { NewsItem } from "@/lib/position-protection/news-intelligence";
import {
  buildFundamentalCausalResult,
  buildAssetCausalContext,
  type FundamentalCausalResult,
  type AssetCausalContext,
} from "@/lib/position-protection/fundamental-transmission";

// ═══════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════

interface TraderWorkspaceProps {
  /** Map of positionId → position intelligence. */
  intelligenceMap: Map<string, PositionIntelligence>;
  /** Portfolio-level intelligence. */
  portfolioIntel: PortfolioIntelligence | null;
  /** Runtime health snapshot. */
  healthSnapshot: RuntimeHealthSnapshot | null;
  /** Active alert count. */
  alertCount: number;
  /** Unread notification count. */
  unreadCount: number;
  /** News items by instrument. */
  feedNews?: Map<string, NewsItem[]>;
  /** Navigate to a position's detail. */
  onSelectPosition: (positionId: string) => void;
  /** Navigate to portfolio view. */
  onSelectPortfolio: () => void;
  /** Navigate to alerts/notifications. */
  onSelectAlerts: () => void;
  /** Navigate to system health. */
  onSelectSystem: () => void;
}

// ═══════════════════════════════════════════════════════════════
// SECTION WRAPPER
// ═══════════════════════════════════════════════════════════════

function WorkspaceSection({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span className="text-[10px] font-mono font-semibold text-foreground">{title}</span>
        </div>
        {action}
      </div>
      <div className="px-3 py-2 space-y-1.5">{children}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HEALTHY/CAUTION/etc BADGE
// ═══════════════════════════════════════════════════════════════

function ThesisBadge({ thesis }: { thesis: string }) {
  const colors: Record<string, string> = {
    HEALTHY: "text-emerald-400 bg-emerald-500/10",
    STABLE: "text-blue-400 bg-blue-500/10",
    CAUTION: "text-amber-400 bg-amber-500/10",
    DETERIORATING: "text-orange-400 bg-orange-500/10",
    SEVERELY_DETERIORATING: "text-red-400 bg-red-500/10",
    INVALIDATED: "text-red-400 bg-red-500/15 border border-red-500/30",
    INSUFFICIENT_DATA: "text-muted-foreground bg-muted/30",
  };
  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${colors[thesis] ?? "text-muted-foreground bg-muted/30"}`}>
      {thesis.replace(/_/g, " ")}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// TREND BADGE
// ═══════════════════════════════════════════════════════════════

function TrendBadge({ label, trend }: { label: string; trend?: string }) {
  if (!trend || trend === "UNKNOWN") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[8px] font-mono text-muted-foreground/50">{label}:</span>
        <span className="text-[8px] font-mono text-muted-foreground">—</span>
      </div>
    );
  }
  const color = trend === "BULLISH" ? "text-emerald-400" : trend === "BEARISH" ? "text-red-400" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] font-mono text-muted-foreground/50">{label}:</span>
      <span className={`text-[8px] font-mono font-semibold ${color}`}>{trend}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATA QUALITY INDICATOR
// ═══════════════════════════════════════════════════════════════

function DataQualityBadge({ quality }: { quality: string }) {
  const colors: Record<string, string> = {
    AVAILABLE: "text-emerald-400 bg-emerald-500/10",
    STRONG_EVIDENCE: "text-emerald-400 bg-emerald-500/10",
    MODERATE_EVIDENCE: "text-blue-400 bg-blue-500/10",
    WEAK_EVIDENCE: "text-amber-400 bg-amber-500/10",
    INSUFFICIENT_EVIDENCE: "text-red-400 bg-red-500/10",
    INSUFFICIENT: "text-muted-foreground bg-muted/30",
    UNAVAILABLE: "text-red-400 bg-red-500/10",
  };
  return (
    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${colors[quality] ?? "text-muted-foreground bg-muted/30"}`}>
      {quality.replace(/_/g, " ")}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// EVIDENCE TRACE
// ═══════════════════════════════════════════════════════════════

function EvidenceTrace({ intel }: { intel: PositionIntelligence }) {
  const supporting = intel.evidence.filter((e) => e.direction === "supporting");
  const conflicting = intel.evidence.filter((e) => e.direction === "conflicting");
  const neutral = intel.evidence.filter((e) => e.direction === "neutral");

  return (
    <div className="space-y-2">
      {/* Thesis */}
      <div className="flex items-center gap-2">
        <span className="text-[8px] font-mono text-muted-foreground/50 uppercase">Thesis:</span>
        <ThesisBadge thesis={intel.thesisHealth} />
        <span className="text-[8px] font-mono text-muted-foreground/50">({intel.thesisHealthScore}/100)</span>
      </div>

      {/* MTF Trends */}
      <div className="flex items-center gap-3">
        <TrendBadge label="H1" trend={intel.h1Analysis?.trend} />
        <TrendBadge label="M15" trend={intel.m15Analysis?.trend} />
        <TrendBadge label="M5" trend={intel.m5Analysis?.trend} />
      </div>

      {/* Evidence counts */}
      <div className="flex items-center gap-3">
        <span className="text-[8px] font-mono text-emerald-400">Supporting: {supporting.length}</span>
        <span className="text-[8px] font-mono text-red-400">Conflicting: {conflicting.length}</span>
        <span className="text-[8px] font-mono text-muted-foreground">Neutral: {neutral.length}</span>
      </div>

      {/* Evidence items */}
      {(supporting.length > 0 || conflicting.length > 0) && (
        <div className="space-y-0.5 mt-1">
          {supporting.slice(0, 3).map((e, i) => (
            <div key={`s-${i}`} className="flex items-start gap-1.5">
              <span className="text-[8px] text-emerald-400 mt-0.5">✓</span>
              <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
            </div>
          ))}
          {conflicting.slice(0, 3).map((e, i) => (
            <div key={`c-${i}`} className="flex items-start gap-1.5">
              <span className="text-[8px] text-red-400 mt-0.5">✗</span>
              <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// POSITION ROW (for overview list)
// ═══════════════════════════════════════════════════════════════

function PositionRow({
  positionId,
  intel,
  onClick,
}: {
  positionId: string;
  intel: PositionIntelligence;
  onClick: () => void;
}) {
  const info = getInstrumentInfo(intel.instrument);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 p-2 rounded border border-border/20 hover:bg-muted/30 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-foreground truncate">
            {info?.displayName ?? intel.instrument}
          </span>
          <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${
            intel.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
          }`}>
            {intel.side}
          </span>
          <ThesisBadge thesis={intel.thesisHealth} />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <TrendBadge label="H1" trend={intel.h1Analysis?.trend} />
          <TrendBadge label="M15" trend={intel.m15Analysis?.trend} />
          <span className="text-[8px] font-mono text-muted-foreground">
            {intel.evidence.filter((e) => e.direction === "supporting").length}S / {intel.evidence.filter((e) => e.direction === "conflicting").length}C
          </span>
        </div>
      </div>
      <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO DRILL-DOWN
// ═══════════════════════════════════════════════════════════════

function PortfolioDrillDown({
  portfolioIntel,
  intelligenceMap,
}: {
  portfolioIntel: PortfolioIntelligence;
  intelligenceMap: Map<string, PositionIntelligence>;
}) {
  const conflicts = portfolioIntel.conflicts ?? [];
  const alignments = portfolioIntel.alignments ?? [];
  const watchItems = portfolioIntel.watchItems ?? [];

  return (
    <div className="space-y-3">
      {/* Thesis distribution from summary */}
      <div className="space-y-1">
        <span className="text-[8px] font-mono text-muted-foreground/50 uppercase">Thesis Distribution</span>
        <div className="flex flex-wrap gap-1.5">
          {portfolioIntel.summary.healthyPositions > 0 && (
            <div className="flex items-center gap-1"><ThesisBadge thesis="HEALTHY" /><span className="text-[8px] font-mono text-muted-foreground">×{portfolioIntel.summary.healthyPositions}</span></div>
          )}
          {portfolioIntel.summary.cautionPositions > 0 && (
            <div className="flex items-center gap-1"><ThesisBadge thesis="CAUTION" /><span className="text-[8px] font-mono text-muted-foreground">×{portfolioIntel.summary.cautionPositions}</span></div>
          )}
          {portfolioIntel.summary.deterioratingPositions > 0 && (
            <div className="flex items-center gap-1"><ThesisBadge thesis="DETERIORATING" /><span className="text-[8px] font-mono text-muted-foreground">×{portfolioIntel.summary.deterioratingPositions}</span></div>
          )}
          {portfolioIntel.summary.invalidatedPositions > 0 && (
            <div className="flex items-center gap-1"><ThesisBadge thesis="INVALIDATED" /><span className="text-[8px] font-mono text-muted-foreground">×{portfolioIntel.summary.invalidatedPositions}</span></div>
          )}
          {portfolioIntel.summary.unavailablePositions > 0 && (
            <div className="flex items-center gap-1"><ThesisBadge thesis="INSUFFICIENT_DATA" /><span className="text-[8px] font-mono text-muted-foreground">×{portfolioIntel.summary.unavailablePositions}</span></div>
          )}
        </div>
      </div>

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div className="space-y-1">
          <span className="text-[8px] font-mono text-red-400 uppercase">Conflicts</span>
          {conflicts.map((c: any, i: number) => (
            <div key={i} className="text-[8px] font-mono text-muted-foreground p-1.5 rounded bg-red-500/5 border border-red-500/10">
              {c.description ?? `${c.positionA ?? "?"} vs ${c.positionB ?? "?"}`}
            </div>
          ))}
        </div>
      )}

      {/* Alignments */}
      {alignments.length > 0 && (
        <div className="space-y-1">
          <span className="text-[8px] font-mono text-emerald-400 uppercase">Alignments</span>
          {alignments.map((a: any, i: number) => (
            <div key={i} className="text-[8px] font-mono text-muted-foreground p-1.5 rounded bg-emerald-500/5 border border-emerald-500/10">
              {a.description ?? `${(a.positions ?? []).join(" + ")}`}
            </div>
          ))}
        </div>
      )}

      {/* Watch list */}
      {watchItems.length > 0 && (
        <div className="space-y-1">
          <span className="text-[8px] font-mono text-amber-400 uppercase">Watch List</span>
          {watchItems.slice(0, 5).map((w: any, i: number) => (
            <div key={i} className="text-[8px] font-mono text-muted-foreground p-1.5 rounded bg-amber-500/5 border border-amber-500/10">
              {w.instrument ? `${w.instrument}: ` : ""}{w.description ?? w.reason ?? "Monitor"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM HEALTH SUMMARY
// ═══════════════════════════════════════════════════════════════

function SystemHealthSummary({ health }: { health: RuntimeHealthSnapshot | null }) {
  if (!health) {
    return (
      <div className="text-[8px] font-mono text-muted-foreground/50">
        No health data available
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    HEALTHY: "text-emerald-400",
    DEGRADED: "text-amber-400",
    UNAVAILABLE: "text-red-400",
    UNKNOWN: "text-muted-foreground",
  };

  const degraded = health.components.filter((c) => c.status === "DEGRADED" || c.status === "UNAVAILABLE");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono font-semibold text-foreground">System:</span>
        <span className={`text-[9px] font-mono font-bold ${statusColor[health.overallStatus] ?? "text-muted-foreground"}`}>
          {health.overallStatus}
        </span>
      </div>

      {degraded.length > 0 && (
        <div className="space-y-0.5">
          {degraded.map((c) => (
            <div key={c.component} className="flex items-center gap-1.5">
              <span className={`text-[8px] font-mono ${statusColor[c.status]}`}>●</span>
              <span className="text-[8px] font-mono text-muted-foreground">{c.component.replace(/_/g, " ")}</span>
              <span className="text-[7px] font-mono text-muted-foreground/50">({c.status})</span>
            </div>
          ))}
        </div>
      )}

      {degraded.length === 0 && health.overallStatus === "HEALTHY" && (
        <span className="text-[8px] font-mono text-emerald-400/60">All components operational</span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN TRADER WORKSPACE
// ═══════════════════════════════════════════════════════════════

export function TraderWorkspace({
  intelligenceMap,
  portfolioIntel,
  healthSnapshot,
  alertCount,
  unreadCount,
  feedNews,
  onSelectPosition,
  onSelectPortfolio,
  onSelectAlerts,
  onSelectSystem,
}: TraderWorkspaceProps) {
  const positions = useMemo(() => Array.from(intelligenceMap.entries()), [intelligenceMap]);

  // Thesis distribution
  const thesisDist = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const [, intel] of intelligenceMap) {
      dist[intel.thesisHealth] = (dist[intel.thesisHealth] ?? 0) + 1;
    }
    return dist;
  }, [intelligenceMap]);

  // Dominant state (worst position determines urgency)
  const dominantState = useMemo(() => {
    const priority = ["INVALIDATED", "SEVERELY_DETERIORATING", "DETERIORATING", "CAUTION", "STABLE", "HEALTHY", "INSUFFICIENT_DATA"];
    for (const state of priority) {
      if (thesisDist[state]) return state;
    }
    return "UNKNOWN";
  }, [thesisDist]);

  // Data quality summary
  const dataQuality = useMemo(() => {
    const qualities: Record<string, number> = {};
    for (const [, intel] of intelligenceMap) {
      qualities[intel.dataQuality] = (qualities[intel.dataQuality] ?? 0) + 1;
    }
    return qualities;
  }, [intelligenceMap]);

  return (
    <div className="space-y-3">
      {/* ─── Overview Stats ─── */}
      <WorkspaceSection title="PORTFOLIO OVERVIEW" icon={<Layers className="size-3" />}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="text-center p-2 rounded bg-muted/20">
            <div className="text-lg font-bold font-mono text-foreground">{positions.length}</div>
            <div className="text-[8px] font-mono text-muted-foreground/60">Positions</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/20">
            <div className="text-lg font-bold font-mono text-foreground">{alertCount}</div>
            <div className="text-[8px] font-mono text-muted-foreground/60">Active Alerts</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/20">
            <div className="text-lg font-bold font-mono text-foreground">{unreadCount}</div>
            <div className="text-[8px] font-mono text-muted-foreground/60">Unread</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/20">
            <ThesisBadge thesis={dominantState} />
            <div className="text-[8px] font-mono text-muted-foreground/60 mt-0.5">Dominant</div>
          </div>
        </div>

        {/* Thesis distribution */}
        <div className="flex flex-wrap gap-1.5 mt-1">
          {Object.entries(thesisDist).map(([state, count]) => (
            <div key={state} className="flex items-center gap-1">
              <ThesisBadge thesis={state} />
              <span className="text-[8px] font-mono text-muted-foreground">×{count}</span>
            </div>
          ))}
        </div>
      </WorkspaceSection>

      {/* ─── Position List ─── */}
      <WorkspaceSection
        title="POSITIONS"
        icon={<Crosshair className="size-3" />}
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[8px] font-mono"
            onClick={onSelectPortfolio}
          >
            View All
          </Button>
        }
      >
        {positions.length === 0 ? (
          <div className="text-[8px] font-mono text-muted-foreground/50 py-2 text-center">
            No positions registered
          </div>
        ) : (
          <div className="space-y-1">
            {positions.map(([posId, intel]) => (
              <PositionRow
                key={posId}
                positionId={posId}
                intel={intel}
                onClick={() => onSelectPosition(posId)}
              />
            ))}
          </div>
        )}
      </WorkspaceSection>

      {/* ─── Portfolio Context (if available) ─── */}
      {portfolioIntel && (
        <WorkspaceSection
          title="PORTFOLIO CONTEXT"
          icon={<BarChart3 className="size-3" />}
          action={
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[8px] font-mono"
              onClick={onSelectPortfolio}
            >
              Details
            </Button>
          }
        >
          <PortfolioDrillDown
            portfolioIntel={portfolioIntel}
            intelligenceMap={intelligenceMap}
          />
        </WorkspaceSection>
      )}

      {/* ─── Data Quality ─── */}
      <WorkspaceSection title="DATA QUALITY" icon={<Eye className="size-3" />}>
        <div className="flex flex-wrap gap-2">
          {Object.entries(dataQuality).map(([quality, count]) => (
            <div key={quality} className="flex items-center gap-1">
              <DataQualityBadge quality={quality} />
              <span className="text-[8px] font-mono text-muted-foreground">×{count}</span>
            </div>
          ))}
        </div>
        {dataQuality["UNAVAILABLE"] && (
          <div className="text-[8px] font-mono text-amber-400/80 mt-1">
            ⚠ Some positions have unavailable data — intelligence may be limited
          </div>
        )}
      </WorkspaceSection>

      {/* ─── System Health ─── */}
      <WorkspaceSection
        title="SYSTEM HEALTH"
        icon={<Activity className="size-3" />}
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[8px] font-mono"
            onClick={onSelectSystem}
          >
            Details
          </Button>
        }
      >
        <SystemHealthSummary health={healthSnapshot} />
      </WorkspaceSection>

      {/* ─── Quick Actions ─── */}
      <WorkspaceSection title="ACTIONS" icon={<Zap className="size-3" />}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[8px] font-mono"
            onClick={onSelectAlerts}
          >
            <Bell className="size-2.5 mr-1" />
            View Alerts ({unreadCount})
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[8px] font-mono"
            onClick={onSelectSystem}
          >
            <Activity className="size-2.5 mr-1" />
            System Health
          </Button>
        </div>
      </WorkspaceSection>

      {/* ─── Disclaimer ─── */}
      <div className="text-[8px] font-mono text-muted-foreground/40 pt-1 border-t border-border/20">
        Informational only. No trades are executed automatically.
        All intelligence is evidence-based — confidence ≠ probability of price movement.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DECISION SUPPORT PANEL
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// FUNDAMENTAL CONTEXT PANEL
// ═══════════════════════════════════════════════════════════════

function FundamentalContextPanel({ intel, newsItems }: { intel: PositionIntelligence; newsItems?: NewsItem[] }) {
  const assetClass: AssetClass = mapInstrumentToAssetClass(intel.instrument);

  const regimeInput = useMemo(() => buildFundamentalInputFromPositionIntel(
    { instrument: intel.instrument, assetClass: intel.assetClass, shortTermContext: intel.shortTermContext, mediumTermContext: intel.mediumTermContext, evidence: intel.evidence },
    { newsItems },
  ), [intel.instrument, intel.assetClass, intel.shortTermContext, intel.mediumTermContext, newsItems]);
  const regime = useMemo(() => buildFundamentalRegime(regimeInput), [regimeInput]);
  const assetCtx = useMemo(() => buildAssetFundamentalContext(assetClass, regime), [assetClass, regime]);
  const causalResult = useMemo(() => buildFundamentalCausalResult(regime), [regime]);
  const assetCausalCtx = useMemo(() => buildAssetCausalContext(assetClass, regime, causalResult.transmissions), [assetClass, regime, causalResult.transmissions]);

  // Determine technical direction from evidence
  const techSupporting = intel.evidence.filter((e) => e.direction === "supporting").length;
  const techConflicting = intel.evidence.filter((e) => e.direction === "conflicting").length;
  const techDir = techSupporting > techConflicting ? "SUPPORTING" : techConflicting > techSupporting ? "CONFLICTING" : "NEUTRAL";
  const alignment = assessTechnicalFundamentalAlignment(techDir as any, assetCtx.fundamentalAssessment);

  const regimeColor: Record<string, string> = {
    RISK_ON: "text-emerald-400",
    RISK_OFF: "text-red-400",
    MIXED: "text-amber-400",
    STRESSED: "text-red-400",
    RECOVERY: "text-blue-400",
    REFLATION: "text-emerald-400",
    STAGFLATION: "text-red-400",
    DISINFLATION: "text-blue-400",
    CONTRACTION: "text-red-400",
    INSUFFICIENT_DATA: "text-muted-foreground",
  };

  const dirColor: Record<string, string> = {
    SUPPORTING: "text-emerald-400",
    CONFLICTING: "text-red-400",
    NEUTRAL: "text-muted-foreground",
    UNAVAILABLE: "text-muted-foreground/50",
  };

  const alignColor: Record<string, string> = {
    BOTH_SUPPORTING: "text-emerald-400",
    BOTH_CONFLICTING: "text-red-400",
    TECHNICAL_SUPPORTING_FUNDAMENTAL_CONFLICTING: "text-amber-400",
    TECHNICAL_CONFLICTING_FUNDAMENTAL_SUPPORTING: "text-blue-400",
    INSUFFICIENT_DATA: "text-muted-foreground",
  };

  return (
    <div className="space-y-3">
      {/* Macro Regime Overview */}
      <WorkspaceSection title="MACRO REGIME" icon={<Globe className="size-3" />}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-mono text-muted-foreground/50">Overall:</span>
            <span className={`text-[9px] font-mono font-semibold ${regimeColor[regime.overallRegime] ?? "text-muted-foreground"}`}>
              {regime.overallRegime.replace(/_/g, " ")}
            </span>
            <span className="text-[7px] font-mono text-muted-foreground/40">
              ({regime.availableDimensionCount}/{regime.dimensions.length} dimensions)
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {regime.dimensions.map((d, i) => (
              <span key={i} className={`text-[7px] font-mono px-1.5 py-0.5 rounded ${
                d.status === "AVAILABLE" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
              }`}>
                {d.name.replace(/_/g, " ")} {d.status === "AVAILABLE" ? "✓" : "✗"}
              </span>
            ))}
          </div>
        </div>
      </WorkspaceSection>

      {/* Inflation / Rate / Yield / Currency */}
      <WorkspaceSection title="INFLATION / RATES / YIELDS / CURRENCY" icon={<BarChart3 className="size-3" />}>
        <div className="grid grid-cols-2 gap-1.5 text-[8px] font-mono">
          <div><span className="text-muted-foreground/50">Inflation:</span> <span className="text-foreground">{regime.inflationRegime.replace(/_/g, " ")}</span></div>
          <div><span className="text-muted-foreground/50">Driver:</span> <span className="text-foreground">{regime.inflationDriver.replace(/_/g, " ")}</span></div>
          <div><span className="text-muted-foreground/50">Rates:</span> <span className="text-foreground">{regime.rateRegime.replace(/_/g, " ")}</span></div>
          <div><span className="text-muted-foreground/50">Real Yields:</span> <span className="text-foreground">{regime.realYieldRegime.replace(/_/g, " ")}</span></div>
          <div><span className="text-muted-foreground/50">USD:</span> <span className="text-foreground">{regime.currencyRegime.replace(/_/g, " ")}</span></div>
          <div><span className="text-muted-foreground/50">Liquidity:</span> <span className="text-foreground">{regime.liquidityRegime.replace(/_/g, " ")}</span></div>
        </div>
      </WorkspaceSection>

      {/* Growth / Energy / Geopolitical */}
      <WorkspaceSection title="GROWTH / ENERGY / GEOPOLITICAL" icon={<Activity className="size-3" />}>
        <div className="grid grid-cols-3 gap-1.5 text-[8px] font-mono">
          <div><span className="text-muted-foreground/50">Growth:</span> <span className="text-foreground">{regime.growthRegime.replace(/_/g, " ")}</span></div>
          <div><span className="text-muted-foreground/50">Energy:</span> <span className="text-foreground">{regime.energyRegime.replace(/_/g, " ")}</span></div>
          <div><span className="text-muted-foreground/50">Geopolitical:</span> <span className="text-foreground">{regime.geopoliticalRegime.replace(/_/g, " ")}</span></div>
        </div>
      </WorkspaceSection>

      {/* Asset Fundamental Evidence */}
      <WorkspaceSection title={`${assetClass} FUNDAMENTAL EVIDENCE`} icon={<Crosshair className="size-3" />}>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-mono text-muted-foreground/50">Assessment:</span>
            <span className={`text-[9px] font-mono font-semibold ${dirColor[assetCtx.fundamentalAssessment] ?? "text-muted-foreground"}`}>
              {assetCtx.fundamentalAssessment}
            </span>
          </div>
          {assetCtx.supportingEvidence.map((e, i) => (
            <div key={`s-${i}`} className="flex items-start gap-1.5">
              <span className="text-[8px] text-emerald-400 mt-0.5">✓</span>
              <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
            </div>
          ))}
          {assetCtx.conflictingEvidence.map((e, i) => (
            <div key={`c-${i}`} className="flex items-start gap-1.5">
              <span className="text-[8px] text-red-400 mt-0.5">✗</span>
              <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
            </div>
          ))}
          {assetCtx.neutralEvidence.map((e, i) => (
            <div key={`n-${i}`} className="flex items-start gap-1.5">
              <span className="text-[8px] text-muted-foreground mt-0.5">—</span>
              <span className="text-[8px] font-mono text-muted-foreground/70 leading-relaxed">{e.description}</span>
            </div>
          ))}
        </div>
      </WorkspaceSection>

      {/* Technical vs Fundamental Alignment */}
      <WorkspaceSection title="TECHNICAL vs FUNDAMENTAL" icon={<AlertTriangle className="size-3" />}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-mono text-muted-foreground/50">Alignment:</span>
            <span className={`text-[9px] font-mono font-semibold ${alignColor[alignment.alignment] ?? "text-muted-foreground"}`}>
              {alignment.alignment.replace(/_/g, " ")}
            </span>
          </div>
          <div className="text-[8px] font-mono text-muted-foreground">{alignment.description}</div>
        </div>
      </WorkspaceSection>

      {/* Fundamental Causal Transmission */}
      {causalResult.transmissions.length > 0 && (
        <WorkspaceSection title="FUNDAMENTAL TRANSMISSION" icon={<Zap className="size-3" />}>
          <div className="space-y-2">
            {/* Macro Regime */}
            <div className="flex items-center gap-2">
              <span className="text-[8px] font-mono text-muted-foreground/50">Regime:</span>
              <span className={`text-[9px] font-mono font-semibold ${regimeColor[causalResult.macroRegime] ?? "text-muted-foreground"}`}>
                {causalResult.macroRegime.replace(/_/g, " ")}
              </span>
            </div>

            {/* Supporting Forces */}
            {assetCausalCtx.supportingEvidence.length > 0 && (
              <div>
                <div className="text-[7px] font-mono text-emerald-400/70 mb-0.5">SUPPORTING</div>
                {assetCausalCtx.supportingEvidence.map((e, i) => (
                  <div key={`ts-${i}`} className="flex items-start gap-1.5">
                    <span className="text-[8px] text-emerald-400 mt-0.5">✓</span>
                    <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Conflicting Forces */}
            {assetCausalCtx.conflictingEvidence.length > 0 && (
              <div>
                <div className="text-[7px] font-mono text-red-400/70 mb-0.5">CONFLICTING</div>
                {assetCausalCtx.conflictingEvidence.map((e, i) => (
                  <div key={`tc-${i}`} className="flex items-start gap-1.5">
                    <span className="text-[8px] text-red-400 mt-0.5">✗</span>
                    <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Transmission Explanation */}
            {assetCausalCtx.transmissionExplanation && (
              <div className="text-[8px] font-mono text-muted-foreground/70 italic">
                {assetCausalCtx.transmissionExplanation}
              </div>
            )}

            {/* Causal Chain (top 3 derived steps) */}
            {assetCausalCtx.causalTrace.steps.filter((s) => s.provenance === "DERIVED").slice(0, 3).length > 0 && (
              <div>
                <div className="text-[7px] font-mono text-muted-foreground/50 mb-0.5">CAUSAL CHAIN</div>
                {assetCausalCtx.causalTrace.steps.filter((s) => s.provenance === "DERIVED").slice(0, 3).map((s, i) => (
                  <div key={`chain-${i}`} className="flex items-start gap-1.5">
                    <span className="text-[7px] text-muted-foreground/40 mt-0.5">{i + 1}.</span>
                    <span className="text-[7px] font-mono text-muted-foreground/60 leading-relaxed">{s.description}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Data Availability */}
            {assetCausalCtx.unavailableDimensions.length > 0 && (
              <div className="text-[7px] font-mono text-amber-400/60">
                Unavailable: {assetCausalCtx.unavailableDimensions.join(", ").replace(/_/g, " ")}
              </div>
            )}
          </div>
        </WorkspaceSection>
      )}

      {/* What Could Change / Monitor */}
      {(assetCtx.whatCouldChangeAssessment.length > 0 || assetCtx.whatToMonitor.length > 0) && (
        <WorkspaceSection title="WHAT COULD CHANGE / MONITOR" icon={<Eye className="size-3" />}>
          <div className="space-y-0.5">
            {assetCtx.whatCouldChangeAssessment.map((item, i) => (
              <div key={`w-${i}`} className="flex items-start gap-1.5">
                <span className="text-[8px] text-amber-400 mt-0.5">⚡</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{item}</span>
              </div>
            ))}
            {assetCtx.whatToMonitor.map((item, i) => (
              <div key={`m-${i}`} className="flex items-start gap-1.5">
                <span className="text-[8px] text-blue-400 mt-0.5">→</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </WorkspaceSection>
      )}
    </div>
  );
}

function DecisionSupportPanel({ positionId, intel }: { positionId: string; intel: PositionIntelligence }) {
  const ds = useMemo(() => buildDecisionSupport(positionId, intel), [positionId, intel]);
  const summary = useMemo(() => getDecisionSupportSummary(ds), [ds]);

  const overallColor = summary.overallAssessment.includes("SUPPORTING")
    ? "text-emerald-400"
    : summary.overallAssessment.includes("CONFLICTING")
      ? "text-red-400"
      : summary.overallAssessment === "INSUFFICIENT_DATA"
        ? "text-muted-foreground"
        : "text-amber-400";

  return (
    <div className="space-y-3">
      {/* Current Assessment */}
      <WorkspaceSection title="DECISION SUPPORT — CURRENT ASSESSMENT" icon={<Crosshair className="size-3" />}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-mono text-muted-foreground/50">Thesis:</span>
            <ThesisBadge thesis={ds.thesisHealth} />
            <span className="text-[8px] font-mono text-muted-foreground/50">({ds.score}/100)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-mono text-muted-foreground/50">Assessment:</span>
            <span className={`text-[9px] font-mono font-semibold ${overallColor}`}>{summary.overallAssessment.replace(/_/g, " ")}</span>
          </div>
          <div className="flex items-center gap-3 text-[8px] font-mono">
            <span className="text-emerald-400">{summary.supportingCount} supporting</span>
            <span className="text-red-400">{summary.conflictingCount} conflicting</span>
            <span className="text-muted-foreground">{summary.neutralCount} neutral</span>
          </div>
        </div>
      </WorkspaceSection>

      {/* Supporting Evidence */}
      {ds.supportingEvidence.length > 0 && (
        <WorkspaceSection title="SUPPORTING EVIDENCE" icon={<CheckCircle className="size-3" />}>
          <div className="space-y-0.5">
            {ds.supportingEvidence.map((e, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[8px] text-emerald-400 mt-0.5">✓</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
                <span className="text-[7px] font-mono text-muted-foreground/40 ml-auto">{e.strength}</span>
              </div>
            ))}
          </div>
        </WorkspaceSection>
      )}

      {/* Conflicting Evidence */}
      {ds.conflictingEvidence.length > 0 && (
        <WorkspaceSection title="CONFLICTING EVIDENCE" icon={<AlertTriangle className="size-3" />}>
          <div className="space-y-0.5">
            {ds.conflictingEvidence.map((e, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[8px] text-red-400 mt-0.5">✗</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{e.description}</span>
                <span className="text-[7px] font-mono text-muted-foreground/40 ml-auto">{e.strength}</span>
              </div>
            ))}
          </div>
        </WorkspaceSection>
      )}

      {/* What Could Change This Assessment */}
      {ds.invalidationConditions.length > 0 && (
        <WorkspaceSection title="WHAT COULD CHANGE THIS ASSESSMENT" icon={<AlertTriangle className="size-3" />}>
          <div className="space-y-0.5">
            {ds.invalidationConditions.map((ic, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[8px] text-amber-400 mt-0.5">⚡</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{ic.description}</span>
                <span className={`text-[7px] font-mono ml-auto ${
                  ic.status === "TRIGGERED" ? "text-red-400" :
                  ic.status === "APPROACHING" ? "text-amber-400" : "text-muted-foreground/40"
                }`}>{ic.status.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </WorkspaceSection>
      )}

      {/* What To Monitor */}
      {ds.watchItems.length > 0 && (
        <WorkspaceSection title="WHAT TO MONITOR" icon={<Eye className="size-3" />}>
          <div className="space-y-0.5">
            {ds.watchItems.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className={`text-[8px] mt-0.5 ${
                  w.priority === "CRITICAL" ? "text-red-400" :
                  w.priority === "HIGH" ? "text-amber-400" : "text-blue-400"
                }`}>→</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{w.description}</span>
                <span className={`text-[7px] font-mono ml-auto ${
                  w.priority === "CRITICAL" ? "text-red-400" :
                  w.priority === "HIGH" ? "text-amber-400" : "text-muted-foreground/40"
                }`}>{w.priority}</span>
              </div>
            ))}
          </div>
        </WorkspaceSection>
      )}

      {/* Data Availability */}
      <WorkspaceSection title="DATA AVAILABILITY" icon={<Info className="size-3" />}>
        <div className="flex flex-wrap gap-1.5">
          {ds.availableDimensions.map((d, i) => (
            <span key={i} className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
              {d.dimension.replace(/_/g, " ")} ✓
            </span>
          ))}
          {ds.unavailableDimensions.map((d, i) => (
            <span key={i} className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
              {d.dimension.replace(/_/g, " ")} ✗
            </span>
          ))}
        </div>
      </WorkspaceSection>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// POSITION DETAIL VIEW
// ═══════════════════════════════════════════════════════════════

interface PositionDetailProps {
  positionId: string;
  intel: PositionIntelligence;
  newsItems?: NewsItem[];
  onBack: () => void;
}

export function PositionDetail({ positionId, intel, newsItems, onBack }: PositionDetailProps) {
  const info = getInstrumentInfo(intel.instrument);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-6 text-[8px] font-mono" onClick={onBack}>
          ← Back
        </Button>
        <span className="text-[11px] font-mono font-bold text-foreground">
          {info?.displayName ?? intel.instrument}
        </span>
        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
          intel.side === "LONG" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        }`}>
          {intel.side}
        </span>
        <ThesisBadge thesis={intel.thesisHealth} />
        <DataQualityBadge quality={intel.dataQuality} />
      </div>

      {/* Evidence Trace */}
      <WorkspaceSection title="EVIDENCE TRACE" icon={<Layers className="size-3" />}>
        <EvidenceTrace intel={intel} />
      </WorkspaceSection>

      {/* Position Metrics */}
      <WorkspaceSection title="POSITION METRICS" icon={<BarChart3 className="size-3" />}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[8px] font-mono">
          <div>
            <span className="text-muted-foreground/50">Entry: </span>
            <span className="text-foreground">{intel.entryPrice.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">Current: </span>
            <span className="text-foreground">{intel.currentPrice.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">PnL: </span>
            <span className={intel.pnlPct >= 0 ? "text-emerald-400" : "text-red-400"}>
              {intel.pnlPct >= 0 ? "+" : ""}{intel.pnlPct.toFixed(2)}%
            </span>
          </div>
          {intel.stopLoss && (
            <div>
              <span className="text-muted-foreground/50">SL: </span>
              <span className="text-foreground">{intel.stopLoss.toLocaleString()}</span>
            </div>
          )}
          {intel.takeProfit && (
            <div>
              <span className="text-muted-foreground/50">TP: </span>
              <span className="text-foreground">{intel.takeProfit.toLocaleString()}</span>
            </div>
          )}
        </div>
      </WorkspaceSection>

      {/* Context */}
      <WorkspaceSection title="MARKET CONTEXT" icon={<Globe className="size-3" />}>
        <div className="space-y-1 text-[8px] font-mono">
          <div>
            <span className="text-muted-foreground/50">Short-term: </span>
            <span className="text-foreground">{intel.shortTermContext}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">Medium-term: </span>
            <span className="text-foreground">{intel.mediumTermContext}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">Volatility: </span>
            <span className="text-foreground">{intel.volatilityContext}</span>
          </div>
        </div>
      </WorkspaceSection>

      {/* Invalidation Conditions */}
      {intel.invalidationConditions.length > 0 && (
        <WorkspaceSection title="WHAT COULD CHANGE THIS ASSESSMENT" icon={<AlertTriangle className="size-3" />}>
          <div className="space-y-0.5">
            {intel.invalidationConditions.map((ic, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[8px] text-amber-400 mt-0.5">⚡</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{ic.description}</span>
              </div>
            ))}
          </div>
        </WorkspaceSection>
      )}

      {/* What to Monitor */}
      {intel.nextMonitor.length > 0 && (
        <WorkspaceSection title="WHAT TO MONITOR" icon={<Eye className="size-3" />}>
          <div className="space-y-0.5">
            {intel.nextMonitor.map((item, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="text-[8px] text-blue-400 mt-0.5">→</span>
                <span className="text-[8px] font-mono text-muted-foreground leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </WorkspaceSection>
      )}

      {/* Fundamental Context */}
      <FundamentalContextPanel intel={intel} />

      {/* Decision Support */}
      <DecisionSupportPanel positionId={positionId} intel={intel} />

      {/* Disclaimer */}
      <div className="text-[8px] font-mono text-muted-foreground/40 pt-1 border-t border-border/20">
        Evidence-based intelligence. No execution commands. Manual action required for any trade.
      </div>
    </div>
  );
}
