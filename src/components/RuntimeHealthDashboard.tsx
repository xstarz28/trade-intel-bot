/**
 * Phase 99 — RuntimeHealthDashboard
 *
 * Trader-facing system observability panel.
 * Shows health status of all pipeline components, data freshness,
 * provider availability, and pipeline status.
 *
 * INFORMATIONAL ONLY — no execution, no trading signals, no probability.
 */

import React, { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import {
  buildRuntimeHealthSnapshot,
  type RuntimeHealthInput,
  type RuntimeHealthSnapshot,
  type RuntimeComponent,
  type RuntimeHealthStatus,
  type DataFreshness,
  HEALTH_STATUS_COLOR,
  HEALTH_STATUS_BG,
  FRESHNESS_COLOR,
  COMPONENT_LABELS,
} from "../lib/position-protection/runtime-health";

function formatAge(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function formatTimestamp(ts: number | undefined): string {
  if (ts === undefined) return "—";
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

interface RuntimeHealthDashboardProps {
  /** Current intelligence input signals from the dashboard */
  healthInput?: RuntimeHealthInput;
}

export function RuntimeHealthDashboard({ healthInput }: RuntimeHealthDashboardProps) {
  const { t } = useI18n();
  const [showHistory, setShowHistory] = useState(false);

  const latestHealth = useQuery(api.runtimeHealth.getLatestRuntimeHealth);
  const healthHistory = useQuery(
    api.runtimeHealth.getRuntimeHealthHistory,
    showHistory ? { limit: 10 } : "skip",
  );
  const saveHealthMut = useMutation(api.runtimeHealth.saveRuntimeHealth);

  // Build live snapshot from input signals
  const liveSnapshot: RuntimeHealthSnapshot | null = useMemo(() => {
    if (!healthInput) return null;
    return buildRuntimeHealthSnapshot(healthInput, Date.now());
  }, [healthInput]);

  // Use live snapshot if available, otherwise fall back to persisted
  const snapshot: RuntimeHealthSnapshot | null = useMemo(() => {
    if (liveSnapshot) return liveSnapshot;
    if (!latestHealth) return null;
    // Reconstruct from persisted data
    return {
      timestamp: latestHealth.timestamp,
      overallStatus: latestHealth.overallStatus as RuntimeHealthStatus,
      components: (latestHealth.components as any[]).map((c: any) => ({
        component: c.component as RuntimeComponent,
        status: c.status as RuntimeHealthStatus,
        lastSuccessAt: c.lastSuccessAt,
        lastFailureAt: c.lastFailureAt,
        lastAttemptAt: c.lastAttemptAt,
        consecutiveFailures: c.consecutiveFailures,
        message: c.message,
        source: c.source,
        dataAgeMs: c.dataAgeMs,
        freshness: c.freshness as DataFreshness,
      })),
      intelligenceCycleStatus: latestHealth.intelligenceCycleStatus as RuntimeHealthStatus,
      alertPipelineStatus: latestHealth.alertPipelineStatus as RuntimeHealthStatus,
      persistenceStatus: latestHealth.persistenceStatus as RuntimeHealthStatus,
      providerAvailability: latestHealth.providerAvailability as Record<string, RuntimeHealthStatus>,
      staleComponents: latestHealth.staleComponents as RuntimeComponent[],
      unavailableComponents: latestHealth.unavailableComponents as RuntimeComponent[],
    };
  }, [liveSnapshot, latestHealth]);

  const isLoading = latestHealth === undefined && !healthInput;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-mono font-semibold">{t.system.title}</h3>
          {snapshot && (
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${HEALTH_STATUS_BG[snapshot.overallStatus]}`}
            >
              <span className={HEALTH_STATUS_COLOR[snapshot.overallStatus]}>
                {snapshot.overallStatus}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`text-[10px] font-mono py-1 px-2 rounded-md transition-colors ${
              showHistory
                ? "bg-background text-foreground font-semibold border border-border/50"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {showHistory ? "Hide History" : "History"}
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="size-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      )}

      {/* No data */}
      {!isLoading && !snapshot && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-xs font-mono text-muted-foreground">No health data available</p>
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
            Health metrics will appear after intelligence runs
          </p>
        </div>
      )}

      {snapshot && (
        <>
          {/* Pipeline Status */}
          <div className="grid grid-cols-3 gap-2">
            <PipelineStatusCard
              label="Intelligence"
              status={snapshot.intelligenceCycleStatus}
            />
            <PipelineStatusCard
              label="Alerts"
              status={snapshot.alertPipelineStatus}
            />
            <PipelineStatusCard
              label="Persistence"
              status={snapshot.persistenceStatus}
            />
          </div>

          {/* Component List */}
          <div className="space-y-1">
            <div className="text-[10px] font-mono font-semibold text-muted-foreground">
              COMPONENTS
            </div>
            {snapshot.components.map((comp) => (
              <ComponentRow key={comp.component} component={comp} />
            ))}
          </div>

          {/* Provider Availability */}
          {Object.keys(snapshot.providerAvailability).length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-mono font-semibold text-muted-foreground">
                PROVIDERS
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(snapshot.providerAvailability).map(([name, status]) => (
                  <span
                    key={name}
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${HEALTH_STATUS_BG[status]}`}
                  >
                    <span className={HEALTH_STATUS_COLOR[status]}>{name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {snapshot.staleComponents.length > 0 && (
            <div className="text-[10px] font-mono text-amber-400/80">
              Stale: {snapshot.staleComponents.map((c) => COMPONENT_LABELS[c] ?? c).join(", ")}
            </div>
          )}
          {snapshot.unavailableComponents.length > 0 && (
            <div className="text-[10px] font-mono text-red-400/80">
              Unavailable:{" "}
              {snapshot.unavailableComponents.map((c) => COMPONENT_LABELS[c] ?? c).join(", ")}
            </div>
          )}

          {/* Last updated */}
          <div className="text-[9px] font-mono text-muted-foreground/50">
            Updated: {formatTimestamp(snapshot.timestamp)}
          </div>
        </>
      )}

      {/* History */}
      {showHistory && healthHistory && healthHistory.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono font-semibold text-muted-foreground">
            HISTORY (last {healthHistory.length})
          </div>
          {healthHistory.map((snap) => (
            <div
              key={snap._id}
              className="flex items-center gap-2 text-[9px] font-mono py-1"
            >
              <span className={HEALTH_STATUS_COLOR[snap.overallStatus as RuntimeHealthStatus]}>
                {snap.overallStatus}
              </span>
              <span className="text-muted-foreground/60">{formatTimestamp(snap.timestamp)}</span>
              {(snap.unavailableComponents as string[]).length > 0 && (
                <span className="text-red-400/60">
                  ({(snap.unavailableComponents as string[]).length} unavailable)
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function PipelineStatusCard({
  label,
  status,
}: {
  label: string;
  status: RuntimeHealthStatus;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1 p-2 rounded-lg border border-border/30 ${HEALTH_STATUS_BG[status]}`}
    >
      <span className={`text-[10px] font-mono font-semibold ${HEALTH_STATUS_COLOR[status]}`}>
        {status}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground">{label}</span>
    </div>
  );
}

function ComponentRow({
  component,
}: {
  component: {
    component: RuntimeComponent;
    status: RuntimeHealthStatus;
    lastSuccessAt?: number;
    message: string;
    source?: string;
    freshness: DataFreshness;
    dataAgeMs?: number;
  };
}) {
  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-muted/20 transition-colors">
      {/* Status dot */}
      <div
        className={`size-1.5 rounded-full shrink-0 ${
          component.status === "HEALTHY"
            ? "bg-emerald-400"
            : component.status === "DEGRADED"
              ? "bg-amber-400"
              : component.status === "UNAVAILABLE"
                ? "bg-red-400"
                : "bg-muted-foreground/40"
        }`}
      />

      {/* Name */}
      <span className="text-[10px] font-mono text-foreground min-w-[120px]">
        {COMPONENT_LABELS[component.component] ?? component.component}
      </span>

      {/* Source */}
      {component.source && (
        <span className="text-[9px] font-mono text-muted-foreground/60">
          {component.source}
        </span>
      )}

      {/* Message */}
      <span className="text-[9px] font-mono text-muted-foreground/70 flex-1 truncate">
        {component.message}
      </span>

      {/* Data age */}
      <span className={`text-[9px] font-mono ${FRESHNESS_COLOR[component.freshness]}`}>
        {component.dataAgeMs !== undefined ? formatAge(component.dataAgeMs) : "—"}
      </span>

      {/* Last success */}
      <span className="text-[9px] font-mono text-muted-foreground/50 min-w-[50px] text-right">
        {formatTimestamp(component.lastSuccessAt)}
      </span>
    </div>
  );
}
