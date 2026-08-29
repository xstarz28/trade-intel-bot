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
  onRemove,
}: {
  state: MonitoredPositionState;
  livePrice?: LiveInstrumentState;
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      <div className="relative">
        {/* Live price badge */}
        {livePrice && (
          <div className="flex items-center gap-2 mb-1 px-1">
            <span className="text-[10px] font-mono text-muted-foreground">
              {livePrice.instrument}
            </span>
            <span className={`text-[10px] font-mono font-semibold ${
              livePrice.sourceMode === "LIVE" ? "text-emerald-400" :
              livePrice.sourceMode === "STALE" ? "text-amber-400" :
              "text-red-400"
            }`}>
              {livePrice.sourceMode === "LIVE" && livePrice.price > 0
                ? `$${livePrice.price.toLocaleString(undefined, { maximumFractionDigits: livePrice.price < 1 ? 6 : 2 })}`
                : livePrice.sourceMode}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground/50">
              via {livePrice.provider}
            </span>
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

  const [showForm, setShowForm] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const prevAlertsRef = useRef<Map<string, AlertSeverity>>(new Map());

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

      {/* Position Panels */}
      <AnimatePresence>
        {positions.map((pos) => (
          <PositionCard
            key={pos.position.positionId}
            state={pos}
            livePrice={livePrices.get(pos.position.instrument)}
            onRemove={() =>
              handleRemove(pos.position.positionId, pos.position.instrument)
            }
          />
        ))}
      </AnimatePresence>

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

      {/* Disclaimer */}
      <div className="text-[9px] font-mono text-muted-foreground/40 pt-2 border-t border-border/20">
        Informational only. All alerts are manual-action recommendations.
        No trades are executed automatically.
      </div>
    </div>
  );
}
