/**
 * Phase 57/58/59 — Position Protection Panel
 *
 * Displays profit protection alerts, thesis health monitoring,
 * real-time monitoring status, giveback tracking, alert timeline,
 * connection state, observation gap, acceleration, and reconciliation.
 * INFORMATIONAL_ONLY — never modifies trades.
 */
import React, { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Activity,
  XCircle,
  Clock,
  Zap,
  Radio,
  Eye,
  Wifi,
  WifiOff,
  RotateCcw,
  Gauge,
} from "lucide-react";
import type { ProtectionAlert } from "@/lib/position-protection/types";
import type {
  ProtectionEvent,
  MonitoringStatus,
  AlertHistoryEntry,
} from "@/lib/position-protection/realtime-types";
import type { StreamHealthState } from "@/lib/market-stream/types";
import type { GivebackState } from "@/lib/position-protection/giveback-monitor";
import type { AccelerationResult } from "@/lib/position-protection/acceleration-monitor";
import type { ReconciliationResult } from "@/lib/market-stream/types";

// ═══════════════════════════════════════════════════════════════
// SEVERITY STYLES
// ═══════════════════════════════════════════════════════════════

const SEVERITY_CONFIG: Record<
  string,
  { color: string; bg: string; icon: React.ReactNode; label: string }
> = {
  NONE: {
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    icon: <CheckCircle className="size-4" />,
    label: "HEALTHY",
  },
  WATCH: {
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    icon: <Activity className="size-4" />,
    label: "WATCH",
  },
  CAUTION: {
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    icon: <AlertTriangle className="size-4" />,
    label: "CAUTION",
  },
  HIGH_RISK: {
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    icon: <TrendingDown className="size-4" />,
    label: "HIGH RISK",
  },
  INVALIDATED: {
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    icon: <XCircle className="size-4" />,
    label: "INVALIDATED",
  },
};

// ═══════════════════════════════════════════════════════════════
// HEALTH STATE STYLES
// ═══════════════════════════════════════════════════════════════

const HEALTH_COLORS: Record<string, string> = {
  HEALTHY: "text-emerald-400",
  STABLE: "text-blue-400",
  DETERIORATING: "text-amber-400",
  SEVERELY_DETERIORATING: "text-orange-400",
  INVALIDATED: "text-red-400",
  UNKNOWN: "text-muted-foreground",
};

// ═══════════════════════════════════════════════════════════════
// MONITORING STATUS STYLES
// ═══════════════════════════════════════════════════════════════

const STATUS_CONFIG: Record<
  MonitoringStatus,
  { color: string; icon: React.ReactNode; label: string }
> = {
  LIVE: {
    color: "text-emerald-400",
    icon: <Radio className="size-3" />,
    label: "LIVE",
  },
  RECONNECTING: {
    color: "text-amber-400",
    icon: <Activity className="size-3" />,
    label: "RECONNECTING",
  },
  DATA_STALE: {
    color: "text-red-400",
    icon: <Clock className="size-3" />,
    label: "DATA STALE",
  },
  PAUSED: {
    color: "text-muted-foreground",
    icon: <Eye className="size-3" />,
    label: "MONITORING PAUSED",
  },
};

// ═══════════════════════════════════════════════════════════════
// ACCELERATION LEVEL STYLES
// ═══════════════════════════════════════════════════════════════

const ACCEL_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  NORMAL: { color: "text-emerald-400", icon: <Gauge className="size-3" />, label: "Normal" },
  ELEVATED: { color: "text-amber-400", icon: <Gauge className="size-3" />, label: "Elevated" },
  HIGH: { color: "text-red-400", icon: <Gauge className="size-3" />, label: "High" },
};

// ═══════════════════════════════════════════════════════════════
// SECTION
// ═══════════════════════════════════════════════════════════════

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-mono font-semibold text-foreground hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <span>{title}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs font-mono text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFIT METRICS SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════

function ProfitMetrics({
  alert,
  giveback,
  peakProfit,
}: {
  alert: ProtectionAlert;
  giveback?: GivebackState;
  peakProfit?: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
      <div className="bg-background/50 rounded-lg p-2 border border-border/20">
        <div className="text-[9px] text-muted-foreground">Current Profit</div>
        <div
          className={`font-semibold ${alert.profit.unrealizedPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}
        >
          {alert.profit.rMultiple !== undefined
            ? `${alert.profit.rMultiple >= 0 ? "+" : ""}${alert.profit.rMultiple.toFixed(2)}R`
            : `${alert.profit.distanceFromEntryPct >= 0 ? "+" : ""}${alert.profit.distanceFromEntryPct.toFixed(2)}%`}
        </div>
      </div>
      <div className="bg-background/50 rounded-lg p-2 border border-border/20">
        <div className="text-[9px] text-muted-foreground">Giveback</div>
        <div
          className={`font-semibold ${giveback && giveback.givebackPct > 30 ? "text-red-400" : giveback && giveback.givebackPct > 15 ? "text-amber-400" : "text-emerald-400"}`}
        >
          {giveback ? `${giveback.givebackPct.toFixed(1)}%` : "—"}
        </div>
      </div>
      <div className="bg-background/50 rounded-lg p-2 border border-border/20">
        <div className="text-[9px] text-muted-foreground">Peak Profit</div>
        <div className="text-foreground font-semibold">
          {peakProfit !== undefined ? `+${peakProfit.toFixed(2)}` : "—"}
        </div>
      </div>
      {alert.protectionReference !== undefined && (
        <div className="bg-background/50 rounded-lg p-2 border border-border/20">
          <div className="text-[9px] text-muted-foreground">Protection Ref</div>
          <div className="text-foreground font-semibold">
            {alert.protectionReference.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CONNECTION STATUS BAR
// ═══════════════════════════════════════════════════════════════

function ConnectionStatusBar({
  streamHealth,
  monitoringGapMs,
  lastMarketUpdateAt,
  reconciliation,
}: {
  streamHealth?: StreamHealthState;
  monitoringGapMs?: number;
  lastMarketUpdateAt?: number;
  reconciliation?: ReconciliationResult;
}) {
  const statusLabel = streamHealth?.status ?? "DISCONNECTED";
  const isLive = statusLabel === "LIVE";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-[10px] font-mono">
        <div className="flex items-center gap-1">
          {isLive ? (
            <Wifi className="size-3 text-emerald-400" />
          ) : (
            <WifiOff className="size-3 text-red-400" />
          )}
          <span className={isLive ? "text-emerald-400" : "text-red-400"}>
            {statusLabel}
          </span>
        </div>
        {streamHealth && (
          <>
            <span className="text-muted-foreground">
              Events: {streamHealth.eventsReceived}
            </span>
            {streamHealth.eventsDropped > 0 && (
              <span className="text-amber-400">
                Dropped: {streamHealth.eventsDropped}
              </span>
            )}
          </>
        )}
      </div>

      {/* Monitoring gap */}
      {monitoringGapMs !== undefined && monitoringGapMs > 0 && (
        <div className="text-[10px] font-mono text-amber-400">
          <RotateCcw className="size-3 inline mr-1" />
          Monitoring gap: {(monitoringGapMs / 1000).toFixed(0)}s
        </div>
      )}

      {/* Last market update */}
      {lastMarketUpdateAt !== undefined && lastMarketUpdateAt > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground">
          Last market update:{" "}
          {new Date(lastMarketUpdateAt).toLocaleTimeString("en-US", {
            hour12: false,
          })}
        </div>
      )}

      {/* Reconciliation */}
      {reconciliation && reconciliation.gapDurationMs > 0 && (
        <div
          className={`text-[10px] font-mono px-2 py-0.5 rounded ${reconciliation.success ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}
        >
          {reconciliation.description}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACCELERATION DISPLAY
// ═══════════════════════════════════════════════════════════════

function AccelerationDisplay({
  priceAcceleration,
  givebackAcceleration,
}: {
  priceAcceleration?: AccelerationResult;
  givebackAcceleration?: AccelerationResult;
}) {
  if (!priceAcceleration && !givebackAcceleration) return null;

  return (
    <div className="flex flex-wrap gap-2 text-[10px] font-mono">
      {priceAcceleration && priceAcceleration.level !== "NORMAL" && (
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded ${priceAcceleration.level === "HIGH" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}
        >
          <Gauge className="size-3" />
          Price {ACCEL_CONFIG[priceAcceleration.level]?.label}:{" "}
          {Math.abs(priceAcceleration.rate).toFixed(2)}/s
        </div>
      )}
      {givebackAcceleration && givebackAcceleration.level !== "NORMAL" && (
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded ${givebackAcceleration.level === "HIGH" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}
        >
          <TrendingDown className="size-3" />
          Giveback {ACCEL_CONFIG[givebackAcceleration.level]?.label}:{" "}
          {givebackAcceleration.rate.toFixed(2)}/s
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ALERT TIMELINE SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════

function AlertTimeline({
  history,
}: {
  history: AlertHistoryEntry[];
}) {
  if (history.length === 0) return null;

  return (
    <div className="space-y-1">
      {history.slice(-5).reverse().map((entry, i) => {
        const cfg =
          SEVERITY_CONFIG[entry.severity] ?? SEVERITY_CONFIG.NONE;
        return (
          <div
            key={`${entry.timestamp}-${i}`}
            className="flex items-start gap-2 text-xs font-mono"
          >
            <span className="text-muted-foreground shrink-0 w-[52px]">
              {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span className={`${cfg.color} font-semibold shrink-0`}>
              {cfg.label}
            </span>
            <span className="text-foreground truncate">{entry.reason}</span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════

interface PositionProtectionPanelProps {
  alert: ProtectionAlert;
  /** Real-time monitoring status. */
  monitoringStatus?: MonitoringStatus;
  /** Current giveback state. */
  giveback?: GivebackState;
  /** Recent protection events for timeline. */
  alertHistory?: AlertHistoryEntry[];
  /** Latest ProtectionEvent from real-time monitor. */
  protectionEvent?: ProtectionEvent;
  /** Last update timestamp (ms). */
  lastUpdateAt?: number;
  /** Stream health (Phase 59). */
  streamHealth?: StreamHealthState;
  /** Monitoring gap duration (ms). */
  monitoringGapMs?: number;
  /** Last market data update timestamp. */
  lastMarketUpdateAt?: number;
  /** Reconciliation result after reconnect. */
  reconciliation?: ReconciliationResult;
  /** Price acceleration. */
  priceAcceleration?: AccelerationResult;
  /** Giveback acceleration. */
  givebackAcceleration?: AccelerationResult;
  /** Peak profit seen. */
  peakProfit?: number;
}

export function PositionProtectionPanel({
  alert,
  monitoringStatus = "LIVE",
  giveback,
  alertHistory = [],
  protectionEvent,
  lastUpdateAt,
  streamHealth,
  monitoringGapMs,
  lastMarketUpdateAt,
  reconciliation,
  priceAcceleration,
  givebackAcceleration,
  peakProfit,
}: PositionProtectionPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.NONE;
  const statusCfg = STATUS_CONFIG[monitoringStatus];

  return (
    <div className={`rounded-xl border ${cfg.bg} overflow-hidden`}>
      {/* Header */}
      <button
        className="flex items-center justify-between w-full px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Shield className="size-5 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold">
                {alert.instrument}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {alert.profit.unrealizedPnL >= 0 ? "+" : ""}
                {alert.profit.rMultiple !== undefined
                  ? `${alert.profit.rMultiple.toFixed(2)}R`
                  : `${alert.profit.distanceFromEntryPct.toFixed(2)}%`}
              </span>
            </div>
            <div
              className={`flex items-center gap-1.5 text-xs font-mono font-semibold ${cfg.color}`}
            >
              {cfg.icon}
              {cfg.label}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-right">
          {/* Monitoring status indicator */}
          <div
            className={`flex items-center gap-1 text-[10px] font-mono ${statusCfg.color}`}
          >
            {statusCfg.icon}
            {statusCfg.label}
          </div>
          <div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Thesis
            </div>
            <div
              className={`text-xs font-mono font-semibold ${HEALTH_COLORS[alert.thesisHealth]}`}
            >
              {alert.thesisHealth.replace(/_/g, " ")}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Phase 59 — Connection status bar */}
          <ConnectionStatusBar
            streamHealth={streamHealth}
            monitoringGapMs={monitoringGapMs}
            lastMarketUpdateAt={lastMarketUpdateAt}
            reconciliation={reconciliation}
          />

          {/* Monitoring status bar */}
          {monitoringStatus !== "LIVE" && (
            <div
              className={`text-[10px] font-mono px-2 py-1 rounded ${
                monitoringStatus === "DATA_STALE"
                  ? "bg-red-500/10 text-red-400"
                  : monitoringStatus === "RECONNECTING"
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-muted/30 text-muted-foreground"
              }`}
            >
              {statusCfg.icon}
              <span className="ml-1">
                {monitoringStatus === "DATA_STALE"
                  ? "Data is stale — alerts may be delayed"
                  : monitoringStatus === "RECONNECTING"
                    ? "Reconnecting to provider..."
                    : "Monitoring is paused"}
              </span>
            </div>
          )}

          {/* Alert message */}
          <div className="text-xs font-mono text-foreground bg-background/50 rounded-lg p-3 border border-border/30">
            {alert.alertMessage}
          </div>

          {/* Action — "Why TP now?" */}
          {alert.severity !== "NONE" && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
              <div className="flex items-start gap-2">
                <Zap className="size-3 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="text-[10px] font-mono font-semibold text-primary">
                    PROTECTION ACTION
                  </div>
                  <div className="text-xs font-mono text-foreground">
                    {alert.actionRecommendation}
                  </div>
                </div>
              </div>
              {(alert.severity === "HIGH_RISK" ||
                alert.severity === "INVALIDATED") && (
                <div className="text-[10px] font-mono text-muted-foreground pl-5">
                  Why now:{" "}
                  {alert.conflictingEvidence.slice(0, 3).join("; ") ||
                    "Multiple evidence signals indicate elevated risk."}
                  {giveback && giveback.givebackPct > 0
                    ? `. ${giveback.givebackPct.toFixed(0)}% of peak profit given back.`
                    : ""}
                </div>
              )}
            </div>
          )}

          {/* Phase 59 — Acceleration display */}
          <AccelerationDisplay
            priceAcceleration={priceAcceleration}
            givebackAcceleration={givebackAcceleration}
          />

          {/* Profit metrics */}
          <ProfitMetrics alert={alert} giveback={giveback} peakProfit={peakProfit} />

          {/* Supporting evidence */}
          {alert.supportingEvidence.length > 0 && (
            <Section
              title={t.protection.supportingEvidence}
              defaultOpen={alert.severity === "NONE"}
            >
              {alert.supportingEvidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <CheckCircle className="size-3 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-foreground">{e}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Conflicting evidence */}
          {alert.conflictingEvidence.length > 0 && (
            <Section title={t.protection.conflictingEvidence} defaultOpen>
              {alert.conflictingEvidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <AlertTriangle className="size-3 text-amber-400 mt-0.5 shrink-0" />
                  <span className="text-foreground">{e}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Missing data */}
          {alert.missingData.length > 0 && (
            <Section title={t.protection.missingCriticalData}>
              {alert.missingData.map((e, i) => (
                <div key={i} className="text-amber-400/80">
                  • {e}
                </div>
              ))}
            </Section>
          )}

          {/* Shock state */}
          {alert.shock.state !== "NORMAL" && (
            <div
              className={`text-xs font-mono px-2 py-1 rounded ${alert.shock.state === "SHOCK" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}
            >
              ⚡ Shock: {alert.shock.description}
            </div>
          )}

          {/* Alert timeline */}
          {alertHistory.length > 0 && (
            <Section title={t.protection.alertTimeline} defaultOpen>
              <AlertTimeline history={alertHistory} />
            </Section>
          )}

          {/* Last update */}
          {lastUpdateAt && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <Clock className="size-3" />
              Last update:{" "}
              {new Date(lastUpdateAt).toLocaleTimeString("en-US", {
                hour12: false,
              })}
            </div>
          )}

          {/* Disclaimer */}
          <div className="text-[9px] font-mono text-muted-foreground/50 pt-2 border-t border-border/20">
            Informational only. This is not financial advice. Does not
            auto-execute trades. Classification confidence ≠ likelihood of price movement.
          </div>
        </div>
      )}
    </div>
  );
}
