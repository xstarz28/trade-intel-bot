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
import { useBackendSession } from "@/hooks/use-backend-session";
import {
  BackendApiError,
  listBackendPositions,
  saveBackendPosition,
  deleteBackendPosition,
  saveBackendPositionAlert,
  acknowledgeBackendAlert,
  type BackendPosition,
} from "@/lib/backend-api";
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
  cleanupOrchestrator,
} from "../market-stream/stream-orchestrator";
import type { MonitorState, ProcessResult } from "./realtime-monitor";
import {
  createMonitorState,
  addPosition,
  removePosition,
} from "./realtime-monitor";
import type { RealTimeEvent, PositionSnapshot, ProtectionEvent, AlertHistoryEntry, MonitoringStatus } from "./realtime-types";
import type { ProtectionAlert, AlertSeverity } from "./types";
import { evaluateProtection, type ProtectionEngineInput } from "./protection-engine";
import { calculateGiveback, classifyGivebackSeverity, type GivebackState } from "./giveback-monitor";
import {
  createAccelerationState,
  recordPriceObservation,
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
  // ─── Self-hosted backend session and persistence ───────
  const { state: backendState } = useBackendSession();
  const backendUserId = backendState.status === "authenticated" ? backendState.user.id : null;
  const [loadedBackendUserId, setLoadedBackendUserId] = useState<string | null>(null);
  const [backendPositions, setBackendPositions] = useState<BackendPosition[]>([]);
  const backendPositionsForUser = loadedBackendUserId === backendUserId && backendUserId
    ? backendPositions
    : undefined;
  const isBackendAvailable = backendPositionsForUser !== undefined;

  // ─── Local State ───────────────────────────────────────
  const [orchestrator, setOrchestrator] = useState<StreamOrchestratorState>(
    () => createOrchestratorState(new InMemoryRepository()),
  );
  const [monitor, setMonitor] = useState<MonitorState>(createMonitorState);
  const [protectionAlerts, setProtectionAlerts] = useState<Map<string, ProtectionAlert>>(new Map());
  const [positionAlerts, setPositionAlerts] = useState<Map<string, ProtectionEvent[]>>(new Map());
  const [accelerationStates, setAccelerationStates] = useState<Map<string, ReturnType<typeof createAccelerationState>>>(new Map());
  const [alertHistoryMap, setAlertHistoryMap] = useState<Map<string, AlertHistoryEntry[]>>(new Map());
  const [persistenceDegraded, setPersistenceDegraded] = useState(false);

  // Refs for stable access in callbacks
  const orchestratorRef = useRef(orchestrator);
  orchestratorRef.current = orchestrator;
  const monitorRef = useRef(monitor);
  monitorRef.current = monitor;

  // ─── Load and recover positions from the self-hosted backend ──
  useEffect(() => {
    if (!backendUserId) return;
    let active = true;
    listBackendPositions()
      .then(({ items }) => {
        if (!active) return;
        setBackendPositions(items);
        setLoadedBackendUserId(backendUserId);
        setPersistenceDegraded(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setBackendPositions([]);
        setLoadedBackendUserId(backendUserId);
        setPersistenceDegraded(true);
        if (cause instanceof BackendApiError) {
          console.error("[position-protection] Backend load failed:", cause.code);
        }
      });
    return () => { active = false; };
  }, [backendUserId]);

  useEffect(() => {
    if (!backendPositionsForUser || backendPositionsForUser.length === 0) return;

    setOrchestrator((prev) => {
      let state = prev;
      for (const pos of backendPositionsForUser) {
        const positionId = String(pos.positionId);
        if (!state.positions.has(positionId)) {
          const registered: RegisteredPosition = {
            positionId,
            instrument: pos.instrument,
            side: pos.side as "LONG" | "SHORT",
            entryPrice: pos.entryPrice,
            stopLoss: pos.stopLoss ?? undefined,
            takeProfit: pos.takeProfit ?? undefined,
            leverage: pos.leverage ?? undefined,
            horizon: pos.horizon as RegisteredPosition["horizon"],
            openedAt: pos.openedAt,
            lifecycle: "MONITORING",
          };
          state = registerPosition(state, registered, Date.now());
        }
      }
      return state;
    });
  }, [backendPositionsForUser]);

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

      saveBackendPosition({
        ...persistedState,
        stopLoss: persistedState.stopLoss ?? null,
        takeProfit: persistedState.takeProfit ?? null,
        leverage: persistedState.leverage ?? null,
        peakPrice: persistedState.peakPrice ?? null,
        peakProfit: persistedState.peakProfit ?? null,
      }).then(({ item }) => {
        setBackendPositions((current) => [
          ...current.filter((position) => position.positionId !== item.positionId),
          item,
        ]);
      }).catch(() => {
        setPersistenceDegraded(true);
      });
    },
    [backendUserId],
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

      // Persist removal to the self-hosted backend
      deleteBackendPosition(positionId).then(() => {
        setBackendPositions((current) => current.filter((position) => position.positionId !== positionId));
      }).catch(() => {
        setPersistenceDegraded(true);
      });
    },
    [backendUserId],
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

              // Persist alert to the self-hosted backend
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
              saveBackendPositionAlert(persistedAlert.positionId, persistedAlert).catch(() => {
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
    [backendUserId],
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

      // Persist acknowledgment in the self-hosted backend
      const alerts = positionAlerts.get(positionId);
      if (alerts && alerts.length > 0) {
        const latest = alerts[alerts.length - 1];
        acknowledgeBackendAlert(latest.eventId).catch(() => {
          setPersistenceDegraded(true);
        });
      }
    },
    [positionAlerts, backendUserId],
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
    persistenceAvailable: isBackendAvailable,
    persistenceDegraded,
  };
}
