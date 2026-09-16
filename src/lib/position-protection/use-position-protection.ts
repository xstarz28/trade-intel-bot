/**
 * Phase 60 — Position Protection Hook
 *
 * Integrates Convex persistence, stream orchestrator, and the protection engine
 * into a single React hook. Handles:
 *
 * - Position registration with persistence
 * - Real-time market event processing
 * - Protection evaluation with Convex persistence
 * - Alert history persistence
 * - Recovery from Convex on mount
 * - Acknowledgment persistence
 * - Position lifecycle management
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */

import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  StreamOrchestratorState,
} from "../market-stream/stream-orchestrator";
import type { RegisteredPosition } from "../market-stream/types";
import {
  createOrchestratorState,
  registerPosition,
  unregisterPosition,
  processStreamEvent,
  connectProvider,
  onProviderConnected,
  onProviderDisconnected as streamOnProviderDisconnected,
  reconcileProvider,
} from "../market-stream/stream-orchestrator";
import type { MonitorState } from "./realtime-monitor";
import {
  createMonitorState,
  removePosition,
} from "./realtime-monitor";
import type { RealTimeEvent, ProtectionEvent, AlertHistoryEntry, MonitoringStatus } from "./realtime-types";
import type { ProtectionAlert } from "./types";
import { evaluateProtection } from "./protection-engine";
import { type GivebackState } from "./giveback-monitor";
import {
  createAccelerationState,
  detectPriceAcceleration,
  detectGivebackAcceleration,
  type AccelerationResult,
} from "./acceleration-monitor";
import type { PersistedPositionState, PersistedAlert } from "./persistence";
import { InMemoryRepository } from "./persistence";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PositionRegistration {
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
  horizon: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
  openedAt?: number;
  originalThesis?: string;
}

export interface MonitoredPositionState {
  position: RegisteredPosition;
  alert: ProtectionAlert | null;
  monitoringStatus: MonitoringStatus;
  giveback: GivebackState | null;
  priceAcceleration: AccelerationResult | null;
  givebackAcceleration: AccelerationResult | null;
  lastUpdateAt: number;
  peakProfit?: number;
}

export interface UsePositionProtectionResult {
  /** All monitored positions with their protection state. */
  positions: MonitoredPositionState[];
  /** Register a new position for monitoring. */
  registerPosition: (reg: PositionRegistration) => void;
  /** Remove a position from monitoring. */
  removePosition: (positionId: string) => void;
  /** Ingest a real-time market event. */
  ingestEvent: (event: RealTimeEvent) => void;
  /** Ingest multiple events. */
  ingestEvents: (events: RealTimeEvent[]) => void;
  /** Acknowledge an alert for a position. */
  acknowledgeAlert: (positionId: string) => void;
  /** Connect to a provider. */
  connectProvider: (provider: string, instruments: string[]) => void;
  /** Report provider connected. */
  onProviderConnected: (provider: string) => void;
  /** Report provider disconnected. */
  onProviderDisconnected: (provider: string, error?: string) => void;
  /** Reconcile after reconnect. */
  reconcile: (provider: string, price: number, timestamp: number) => void;
  /** Alert history for a position. */
  alertHistory: AlertHistoryEntry[];
  /** Whether Convex persistence is available. */
  persistenceAvailable: boolean;
  /** Whether Convex is degraded. */
  persistenceDegraded: boolean;
}

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

export function usePositionProtection(): UsePositionProtectionResult {
  // ─── Convex Queries ────────────────────────────────────
  const convexPositions = useQuery(
    api.positionProtection.listActivePositions,
  );
  const isConvexAvailable = convexPositions !== undefined;

  // ─── Convex Mutations ──────────────────────────────────
  const savePositionMutation = useMutation(api.positionProtection.savePosition);
  const deletePositionMutation = useMutation(api.positionProtection.deletePosition);
  const saveAlertMutation = useMutation(api.positionProtection.saveAlert);
  const acknowledgeAlertMutation = useMutation(api.positionProtection.acknowledgeAlert);

  // ─── Local State ───────────────────────────────────────
  const [orchestrator, setOrchestrator] = useState<StreamOrchestratorState>(
    () => createOrchestratorState(new InMemoryRepository()),
  );
  const [monitor, setMonitor] = useState<MonitorState>(createMonitorState);
  const [protectionAlerts, setProtectionAlerts] = useState<Map<string, ProtectionAlert>>(new Map());
  const [positionAlerts, setPositionAlerts] = useState<Map<string, ProtectionEvent[]>>(new Map());
  const [accelerationStates, setAccelerationStates] = useState<Map<string, ReturnType<typeof createAccelerationState>>>(new Map());
  const [, setAlertHistoryMap] = useState<Map<string, AlertHistoryEntry[]>>(new Map());
  const [persistenceDegraded, setPersistenceDegraded] = useState(false);

  // Refs for stable access in callbacks
  const orchestratorRef = useRef(orchestrator);
  orchestratorRef.current = orchestrator;
  const monitorRef = useRef(monitor);
  monitorRef.current = monitor;

  // ─── Recovery from Convex ──────────────────────────────
  useEffect(() => {
    if (!convexPositions || convexPositions.length === 0) return;

    // Recover positions into the orchestrator
    setOrchestrator((prev) => {
      let state = prev;
      for (const pos of convexPositions) {
        const positionId = String(pos.positionId);
        const existing = state.positions.get(positionId);
        if (!existing) {
          const registered: RegisteredPosition = {
            positionId,
            instrument: pos.instrument,
            side: pos.side as "LONG" | "SHORT",
            entryPrice: pos.entryPrice,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            leverage: pos.leverage,
            horizon: pos.horizon as RegisteredPosition["horizon"],
            openedAt: pos.openedAt,
            lifecycle: "MONITORING",
          };
          state = registerPosition(state, registered, Date.now());
        }
      }
      return state;
    });
  }, [convexPositions]);

  // ─── Register Position ─────────────────────────────────
  const handleRegisterPosition = useCallback(
    (reg: PositionRegistration) => {
      const now = Date.now();
      const positionId = reg.positionId;
      const instrument = reg.instrument;

      // 1. Register in orchestrator (adds to Phase 58 monitor)
      setOrchestrator((prev) => {
        const registered: RegisteredPosition = {
          positionId,
          instrument,
          side: reg.side,
          entryPrice: reg.entryPrice,
          stopLoss: reg.stopLoss,
          takeProfit: reg.takeProfit,
          leverage: reg.leverage,
          horizon: reg.horizon,
          openedAt: reg.openedAt ?? now,
          lifecycle: "MONITORING",
        };
        return registerPosition(prev, registered, now);
      });

      // 2. Create acceleration state
      setAccelerationStates((prev) => {
        const next = new Map(prev);
        if (!next.has(instrument)) {
          next.set(instrument, createAccelerationState());
        }
        return next;
      });

      // 3. Persist to Convex (fire-and-forget)
      const persistedState: PersistedPositionState = {
        positionId,
        instrument,
        side: reg.side,
        entryPrice: reg.entryPrice,
        stopLoss: reg.stopLoss,
        takeProfit: reg.takeProfit,
        leverage: reg.leverage,
        horizon: reg.horizon,
        openedAt: reg.openedAt ?? now,
        currentSeverity: "NONE",
        lifecycleState: "MONITORING",
        monitoringLifecycle: "MONITORING",
        lastUpdateAt: now,
        lastAlertAt: 0,
        consecutiveSameSeverity: 0,
      };

      savePositionMutation(persistedState).catch(() => {
        setPersistenceDegraded(true);
      });
    },
    [savePositionMutation],
  );

  // ─── Remove Position ───────────────────────────────────
  const handleRemovePosition = useCallback(
    (positionId: string) => {
      setOrchestrator((prev) => unregisterPosition(prev, positionId));
      setMonitor((prev) => removePosition(prev, positionId));
      setProtectionAlerts((prev) => {
        const next = new Map(prev);
        next.delete(positionId);
        return next;
      });
      setPositionAlerts((prev) => {
        const next = new Map(prev);
        next.delete(positionId);
        return next;
      });

      // Persist removal to Convex
      deletePositionMutation({ positionId }).catch(() => {
        setPersistenceDegraded(true);
      });
    },
    [deletePositionMutation],
  );

  // ─── Ingest Event ──────────────────────────────────────
  const handleIngestEvent = useCallback(
    (event: RealTimeEvent) => {
      const now = Date.now();

      // Convert RealTimeEvent to StreamEvent for the orchestrator
      const streamEvent = {
        eventId: event.eventId,
        provider: event.source,
        instrument: event.instrument,
        providerSymbol: event.instrument,
        assetClass: "crypto" as const,
        eventType: "QUOTE" as const,
        timestamp: event.timestamp,
        receivedAt: now,
        freshness: event.freshness,
        dependencyGroup: event.dependencyGroup,
        payload: { price: event.payload.price as number | undefined },
      };

      setOrchestrator((prev) => {
        const result = processStreamEvent(prev, streamEvent, now);

        // Process protection alerts
        if (result.alerts.length > 0) {
          setProtectionAlerts((prevAlerts) => {
            const next = new Map(prevAlerts);
            for (const alertEvent of result.alerts) {
              const position = result.state.positions.get(alertEvent.positionId);
              if (!position) continue;

              // Build a ProtectionAlert from the ProtectionEvent
              const snapshot = result.state.monitor.positions.get(alertEvent.positionId);
              const ctx = snapshot ? {
                instrument: snapshot.instrument,
                assetClass: "crypto" as const,
                side: snapshot.side,
                entryPrice: snapshot.entryPrice,
                currentPrice: snapshot.currentPrice,
                stopLoss: snapshot.stopLoss,
                takeProfit: snapshot.takeProfit,
                leverage: snapshot.leverage,
                openedAt: snapshot.openedAt,
                horizon: snapshot.horizon,
                peakPrice: snapshot.peakPrice,
              } : {
                instrument: event.instrument,
                assetClass: "crypto" as const,
                side: "LONG" as const,
                entryPrice: 0,
                currentPrice: typeof event.payload.price === "number" ? event.payload.price : 0,
                openedAt: now,
              };

              const protectionResult = evaluateProtection({
                position: ctx,
                evidence: { price: ctx.currentPrice },
                now,
              });

              next.set(alertEvent.positionId, protectionResult.alert);

              // Persist alert to Convex
              const persistedAlert: PersistedAlert = {
                alertId: alertEvent.eventId,
                positionId: alertEvent.positionId,
                instrument: alertEvent.instrument,
                severity: alertEvent.severity,
                notificationPriority: alertEvent.notificationPriority,
                reason: alertEvent.reason,
                action: alertEvent.action,
                timestamp: alertEvent.timestamp,
                acknowledged: false,
              };
              saveAlertMutation(persistedAlert).catch(() => {
                setPersistenceDegraded(true);
              });

              // Update alert history locally
              setPositionAlerts((prevHistory) => {
                const nextHistory = new Map(prevHistory);
                const existing = nextHistory.get(alertEvent.positionId) ?? [];
                nextHistory.set(alertEvent.positionId, [...existing, alertEvent]);
                return nextHistory;
              });
            }
            return next;
          });
        }

        return result.state;
      });
    },
    [saveAlertMutation],
  );

  const handleIngestEvents = useCallback(
    (events: RealTimeEvent[]) => {
      for (const event of events) {
        handleIngestEvent(event);
      }
    },
    [handleIngestEvent],
  );

  // ─── Acknowledge Alert ─────────────────────────────────
  const handleAcknowledgeAlert = useCallback(
    (positionId: string) => {
      setAlertHistoryMap((prev) => {
        const next = new Map(prev);
        const entries = next.get(positionId) ?? [];
        const updated = entries.map((e) => ({ ...e, acknowledged: true }));
        next.set(positionId, updated);
        return next;
      });

      // Persist to Convex — find the most recent alert for this position
      const alerts = positionAlerts.get(positionId);
      if (alerts && alerts.length > 0) {
        const latest = alerts[alerts.length - 1];
        acknowledgeAlertMutation({ alertId: latest.eventId }).catch(() => {
          setPersistenceDegraded(true);
        });
      }
    },
    [positionAlerts, acknowledgeAlertMutation],
  );

  // ─── Provider Management ───────────────────────────────
  const handleConnectProvider = useCallback(
    (provider: string, instruments: string[]) => {
      setOrchestrator((prev) => connectProvider(prev, provider, instruments, Date.now()));
    },
    [],
  );

  const handleProviderConnected = useCallback(
    (provider: string) => {
      setOrchestrator((prev) => onProviderConnected(prev, provider, Date.now()));
    },
    [],
  );

  const handleProviderDisconnected = useCallback(
    (provider: string, error?: string) => {
      setOrchestrator((prev) => streamOnProviderDisconnected(prev, provider, Date.now(), error));
    },
    [],
  );

  const handleReconcile = useCallback(
    (provider: string, price: number, timestamp: number) => {
      setOrchestrator((prev) => {
        const { state } = reconcileProvider(prev, provider, price, timestamp, Date.now());
        return state;
      });
    },
    [],
  );

  // ─── Build Position States ─────────────────────────────
  const positions: MonitoredPositionState[] = useMemo(() => {
    const result: MonitoredPositionState[] = [];
    const now = Date.now();

    for (const [posId, registered] of orchestrator.positions) {
      const snapshot = monitor.positions.get(posId);
      const alert = protectionAlerts.get(posId) ?? null;
      const giveback = monitor.giveback.get(posId) ?? null;
      const accState = accelerationStates.get(registered.instrument);
      const history = positionAlerts.get(posId) ?? [];
      const lastEvent = history.length > 0 ? history[history.length - 1] : null;

      const monitoringStatus: MonitoringStatus = snapshot?.monitoringStatus ?? "PAUSED";
      const lastUpdateAt = lastEvent?.timestamp ?? snapshot?.lastUpdateAt ?? 0;

      const priceAcc = accState
        ? detectPriceAcceleration(accState, registered.side, now)
        : null;
      const gbAcc = accState
        ? detectGivebackAcceleration(accState, now)
        : null;

      result.push({
        position: registered,
        alert,
        monitoringStatus,
        giveback,
        priceAcceleration: priceAcc,
        givebackAcceleration: gbAcc,
        lastUpdateAt,
        peakProfit: snapshot?.peakPrice,
      });
    }

    return result;
  }, [orchestrator.positions, monitor.positions, monitor.giveback, protectionAlerts, positionAlerts, accelerationStates]);

  // ─── Alert History ─────────────────────────────────────
  const alertHistory: AlertHistoryEntry[] = useMemo(() => {
    const all: AlertHistoryEntry[] = [];
    for (const entries of positionAlerts.values()) {
      all.push(...entries);
    }
    return all.sort((a, b) => b.timestamp - a.timestamp);
  }, [positionAlerts]);

  return {
    positions,
    registerPosition: handleRegisterPosition,
    removePosition: handleRemovePosition,
    ingestEvent: handleIngestEvent,
    ingestEvents: handleIngestEvents,
    acknowledgeAlert: handleAcknowledgeAlert,
    connectProvider: handleConnectProvider,
    onProviderConnected: handleProviderConnected,
    onProviderDisconnected: handleProviderDisconnected,
    reconcile: handleReconcile,
    alertHistory,
    persistenceAvailable: isConvexAvailable,
    persistenceDegraded,
  };
}
