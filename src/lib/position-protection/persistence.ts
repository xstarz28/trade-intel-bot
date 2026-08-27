/**
 * Phase 59 — Persistence Interface
 *
 * Abstract storage interface for position monitoring state, alerts,
 * and event cursors. Storage-agnostic — core engine remains decoupled.
 *
 * Future Convex integration should implement this interface.
 */

import type { AlertSeverity, MonitoringState } from "./types";

// ═══════════════════════════════════════════════════════════════
// POSITION STATE (persisted)
// ═══════════════════════════════════════════════════════════════

export interface PersistedPositionState {
  positionId: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage?: number;
  horizon: "SCALPING" | "INTRADAY" | "SWING" | "INVESTING";
  openedAt: number;
  peakPrice?: number;
  peakProfit?: number;
  currentSeverity: AlertSeverity;
  lifecycleState: string;
  lastUpdateAt: number;
  lastAlertAt: number;
  consecutiveSameSeverity: number;
  monitoringLifecycle: "REGISTERED" | "MONITORING" | "PAUSED" | "CLOSED";
}

// ═══════════════════════════════════════════════════════════════
// ALERT RECORD (persisted)
// ═══════════════════════════════════════════════════════════════

export interface PersistedAlert {
  alertId: string;
  positionId: string;
  instrument: string;
  severity: AlertSeverity;
  notificationPriority: string;
  reason: string;
  action: string;
  timestamp: number;
  acknowledged: boolean;
}

// ═══════════════════════════════════════════════════════════════
// EVENT CURSOR (persisted)
// ═══════════════════════════════════════════════════════════════

export interface EventCursor {
  provider: string;
  instrument: string;
  lastEventId: string;
  lastTimestamp: number;
  lastSequence?: number;
}

// ═══════════════════════════════════════════════════════════════
// REPOSITORY INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface MonitoringStateRepository {
  // Position state
  savePositionState(state: PersistedPositionState): Promise<boolean>;
  getPositionState(positionId: string): Promise<PersistedPositionState | null>;
  deletePositionState(positionId: string): Promise<boolean>;
  listActivePositions(): Promise<PersistedPositionState[]>;

  // Alerts
  saveAlert(alert: PersistedAlert): Promise<boolean>;
  listAlertHistory(positionId: string, limit?: number): Promise<PersistedAlert[]>;
  acknowledgeAlert(alertId: string): Promise<boolean>;

  // Event cursors
  saveEventCursor(cursor: EventCursor): Promise<boolean>;
  getEventCursor(provider: string, instrument: string): Promise<EventCursor | null>;

  // Health check
  isAvailable(): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY REPOSITORY (fallback)
// ═══════════════════════════════════════════════════════════════

export class InMemoryRepository implements MonitoringStateRepository {
  private positions = new Map<string, PersistedPositionState>();
  private alerts: PersistedAlert[] = [];
  private cursors = new Map<string, EventCursor>();

  async savePositionState(state: PersistedPositionState): Promise<boolean> {
    this.positions.set(state.positionId, { ...state });
    return true;
  }

  async getPositionState(positionId: string): Promise<PersistedPositionState | null> {
    return this.positions.get(positionId) ?? null;
  }

  async deletePositionState(positionId: string): Promise<boolean> {
    return this.positions.delete(positionId);
  }

  async listActivePositions(): Promise<PersistedPositionState[]> {
    return Array.from(this.positions.values()).filter(
      p => p.monitoringLifecycle === "MONITORING",
    );
  }

  async saveAlert(alert: PersistedAlert): Promise<boolean> {
    this.alerts.push({ ...alert });
    // Keep last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }
    return true;
  }

  async listAlertHistory(positionId: string, limit: number = 50): Promise<PersistedAlert[]> {
    return this.alerts
      .filter(a => a.positionId === positionId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  async acknowledgeAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  async saveEventCursor(cursor: EventCursor): Promise<boolean> {
    const key = `${cursor.provider}:${cursor.instrument}`;
    this.cursors.set(key, { ...cursor });
    return true;
  }

  async getEventCursor(provider: string, instrument: string): Promise<EventCursor | null> {
    return this.cursors.get(`${provider}:${instrument}`) ?? null;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
