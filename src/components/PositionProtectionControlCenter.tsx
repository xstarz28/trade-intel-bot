/**
 * Phase 67 — Position Protection Control Center
 *
 * Operational top-level view for active protection monitoring.
 * Answers: "Is any of my positions currently at risk?"
 */

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Clock,
  Wifi,
  WifiOff,
  Activity,
} from "lucide-react";

export interface PositionSummary {
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  severity: string;
  urgency: string;
  profitState: string;
  givebackPct: number;
  thesisHealthScore: number;
  shockState: string;
  accelerationState: string;
  suggestedAction: string;
  whyTpNow: string;
  lastUpdateAt: number;
  freshness: string;
  monitoringStatus: string;
}

export interface ControlCenterProps {
  positions: PositionSummary[];
  providerHealth: Array<{
    provider: string;
    status: string;
    freshness: string;
    lastSuccessAt: number;
    consecutiveFailures: number;
  }>;
  diagnostics?: {
    eventsReceived: number;
    eventsProcessed: number;
    alertsEmitted: number;
    staleEventsReceived: number;
  };
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case "INVALIDATED":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "HIGH_RISK":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "CAUTION":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "WATCH":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    default:
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case "INVALIDATED":
      return <AlertTriangle className="size-3.5" />;
    case "HIGH_RISK":
      return <ShieldAlert className="size-3.5" />;
    case "CAUTION":
      return <AlertTriangle className="size-3.5" />;
    case "WATCH":
      return <Clock className="size-3.5" />;
    default:
      return <ShieldCheck className="size-3.5" />;
  }
}

function getFreshnessIcon(freshness: string) {
  switch (freshness) {
    case "LIVE":
      return <Wifi className="size-3 text-emerald-400" />;
    case "DEGRADED":
      return <WifiOff className="size-3 text-amber-400" />;
    case "STALE":
      return <WifiOff className="size-3 text-orange-400" />;
    default:
      return <WifiOff className="size-3 text-red-400" />;
  }
}

function getActionSummary(positions: PositionSummary[]): string {
  const invalidated = positions.filter((p) => p.severity === "INVALIDATED");
  const highRisk = positions.filter((p) => p.severity === "HIGH_RISK");
  const caution = positions.filter((p) => p.severity === "CAUTION");
  const watch = positions.filter((p) => p.severity === "WATCH");

  if (invalidated.length > 0) {
    return `Thesis invalidated for ${invalidated.map((p) => p.instrument).join(", ")}. Reassess immediately.`;
  }
  if (highRisk.length > 0) {
    return `Elevated risk for ${highRisk.map((p) => p.instrument).join(", ")}. Consider protecting profit.`;
  }
  if (caution.length > 0) {
    return `Deterioration detected in ${caution.map((p) => p.instrument).join(", ")}. Monitor closely.`;
  }
  if (watch.length > 0) {
    return `Early warning for ${watch.map((p) => p.instrument).join(", ")}. Watch for further deterioration.`;
  }
  return "No immediate protection action required.";
}

export function PositionProtectionControlCenter({
  positions,
  providerHealth,
  diagnostics,
}: ControlCenterProps) {
  const stats = useMemo(() => {
    const total = positions.length;
    const profitable = positions.filter(
      (p) => p.profitState === "PROFITABLE" || p.profitState === "STRONGLY_PROFITABLE",
    ).length;
    const watch = positions.filter((p) => p.severity === "WATCH").length;
    const caution = positions.filter((p) => p.severity === "CAUTION").length;
    const highRisk = positions.filter((p) => p.severity === "HIGH_RISK").length;
    const invalidated = positions.filter((p) => p.severity === "INVALIDATED").length;
    const critical = highRisk + invalidated;

    const providersDown = providerHealth.filter((p) => p.status !== "CONNECTED").length;
    const allFresh = providerHealth.every((p) => p.freshness === "FRESH");
    const anyStale = providerHealth.some((p) => p.freshness === "STALE" || p.freshness === "UNAVAILABLE");

    return {
      total,
      profitable,
      watch,
      caution,
      highRisk,
      invalidated,
      critical,
      providersDown,
      allFresh,
      anyStale,
    };
  }, [positions, providerHealth]);

  const actionSummary = useMemo(() => getActionSummary(positions), [positions]);
  const sortedPositions = useMemo(
    () =>
      [...positions].sort((a, b) => {
        const severityOrder: Record<string, number> = {
          INVALIDATED: 5,
          HIGH_RISK: 4,
          CAUTION: 3,
          WATCH: 2,
          NONE: 1,
        };
        return (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0);
      }),
    [positions],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-primary" />
          <h3 className="text-sm font-mono font-semibold">Protection Control Center</h3>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
          {stats.critical > 0 ? (
            <span className="flex items-center gap-1 text-red-400">
              <AlertTriangle className="size-3" />
              {stats.critical} critical
            </span>
          ) : (
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="size-3" />
              All clear
            </span>
          )}
        </div>
      </div>

      {/* Action Summary */}
      <div
        className={`rounded-lg border px-3 py-2.5 text-xs font-mono ${
          stats.critical > 0
            ? "border-red-500/30 bg-red-500/5 text-red-400"
            : stats.caution > 0
              ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
              : "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
        }`}
      >
        {actionSummary}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2 text-center">
          <p className="text-lg font-bold font-mono">{stats.total}</p>
          <p className="text-[9px] text-muted-foreground font-mono">Positions</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2 text-center">
          <p className="text-lg font-bold font-mono text-emerald-400">{stats.profitable}</p>
          <p className="text-[9px] text-muted-foreground font-mono">Profitable</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2 text-center">
          <p className="text-lg font-bold font-mono text-amber-400">{stats.watch + stats.caution}</p>
          <p className="text-[9px] text-muted-foreground font-mono">Watch / Caution</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2 text-center">
          <p className="text-lg font-bold font-mono text-red-400">{stats.critical}</p>
          <p className="text-[9px] text-muted-foreground font-mono">Critical</p>
        </div>
      </div>

      {/* Provider Health */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
        <span className="flex items-center gap-1">
          {stats.allFresh ? (
            <Wifi className="size-3 text-emerald-400" />
          ) : (
            <WifiOff className="size-3 text-amber-400" />
          )}
          {providerHealth.length} providers
        </span>
        {stats.providersDown > 0 && (
          <span className="text-amber-400">{stats.providersDown} degraded</span>
        )}
        {stats.anyStale && <span className="text-orange-400">stale data detected</span>}
        {diagnostics && (
          <span className="flex items-center gap-1">
            <Activity className="size-3" />
            {diagnostics.eventsReceived} events
          </span>
        )}
      </div>

      {/* Position Queue */}
      {sortedPositions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-mono text-muted-foreground">
            Priority Queue ({sortedPositions.length})
          </p>
          {sortedPositions.map((pos) => (
            <div
              key={pos.positionId}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px] font-mono ${getSeverityColor(pos.severity)}`}
            >
              {getSeverityIcon(pos.severity)}
              <span className="font-semibold min-w-[60px]">{pos.instrument}</span>
              <span className="opacity-70">{pos.side}</span>
              <span className="flex-1 truncate opacity-80">
                {pos.suggestedAction.length > 0 ? pos.suggestedAction : "Monitoring"}
              </span>
              {getFreshnessIcon(pos.freshness)}
            </div>
          ))}
        </div>
      )}

      {positions.length === 0 && (
        <div className="text-center py-6 text-[11px] text-muted-foreground font-mono">
          No positions registered. Add a position to begin monitoring.
        </div>
      )}
    </motion.div>
  );
}
