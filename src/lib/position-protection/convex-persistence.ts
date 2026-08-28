/**
 * Phase 60 — Convex Persistence Adapter
 *
 * Implements MonitoringStateRepository backed by Convex.
 * Uses real Convex client mutations/queries.
 * Falls back to InMemoryRepository if Convex is unavailable.
 */

import type {
  MonitoringStateRepository,
  PersistedPositionState,
  PersistedAlert,
  EventCursor,
} from "./persistence";
import { InMemoryRepository } from "./persistence";

// ═══════════════════════════════════════════════════════════════
// CONVEX CLIENT INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface ConvexClientLike {
  /** Execute a mutation (fire-and-forget or awaited). */
  mutation(
    functionName: string,
    args?: Record<string, unknown>,
  ): unknown;
  /** Execute a query. */
  query(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<unknown>;
}

// ═══════════════════════════════════════════════════════════════
// CONVEX PERSISTENCE ADAPTER
// ═══════════════════════════════════════════════════════════════

/**
 * Convex-backed repository.
 * If Convex is unavailable or errors, falls back to in-memory.
 * Writes are fire-and-forget — the monitoring engine is never blocked.
 */
export class ConvexPersistenceAdapter implements MonitoringStateRepository {
  private client: ConvexClientLike | null;
  private fallback: InMemoryRepository;
  private _degraded = false;

  constructor(client?: ConvexClientLike | null) {
    this.client = client ?? null;
    this.fallback = new InMemoryRepository();
  }

  /** Whether Convex is currently reachable. */
  get isDegraded(): boolean {
    return this._degraded;
  }

  // ─── Position State ──────────────────────────────────────

  async savePositionState(state: PersistedPositionState): Promise<boolean> {
    // Always save locally
    await this.fallback.savePositionState(state);

    if (this.client) {
      try {
        await this.client.mutation("positionProtection:savePosition", {
          positionId: state.positionId,
          instrument: state.instrument,
          side: state.side,
          entryPrice: state.entryPrice,
          stopLoss: state.stopLoss,
          takeProfit: state.takeProfit,
          leverage: state.leverage,
          horizon: state.horizon,
          openedAt: state.openedAt,
          peakPrice: state.peakPrice,
          peakProfit: state.peakProfit,
          currentSeverity: state.currentSeverity,
          lifecycleState: state.lifecycleState,
          monitoringLifecycle: state.monitoringLifecycle,
          lastUpdateAt: state.lastUpdateAt,
          lastAlertAt: state.lastAlertAt,
          consecutiveSameSeverity: state.consecutiveSameSeverity,
        });
        this._degraded = false;
        return true;
      } catch {
        this._degraded = true;
        // Fall back — local state is already saved
      }
    }
    return true;
  }

  async getPositionState(positionId: string): Promise<PersistedPositionState | null> {
    // Fast path: local first
    const local = await this.fallback.getPositionState(positionId);
    if (local) return local;

    // Slow path: Convex query
    if (this.client) {
      try {
        const result = await this.client.query(
          "positionProtection:getPosition",
          { positionId },
        );
        if (result && typeof result === "object") {
          const mapped = this.mapConvexPosition(result as Record<string, unknown>);
          await this.fallback.savePositionState(mapped);
          this._degraded = false;
          return mapped;
        }
      } catch {
        this._degraded = true;
      }
    }
    return null;
  }

  async deletePositionState(positionId: string): Promise<boolean> {
    await this.fallback.deletePositionState(positionId);

    if (this.client) {
      try {
        await this.client.mutation("positionProtection:deletePosition", { positionId });
        this._degraded = false;
        return true;
      } catch {
        this._degraded = true;
      }
    }
    return true;
  }

  async listActivePositions(): Promise<PersistedPositionState[]> {
    // Check local first
    const local = await this.fallback.listActivePositions();
    if (local.length > 0) return local;

    // Query Convex
    if (this.client) {
      try {
        const result = await this.client.query(
          "positionProtection:listActivePositions",
        );
        if (Array.isArray(result)) {
          const positions = result.map((r) =>
            this.mapConvexPosition(r as Record<string, unknown>),
          );
          for (const p of positions) {
            await this.fallback.savePositionState(p);
          }
          this._degraded = false;
          return positions;
        }
      } catch {
        this._degraded = true;
      }
    }
    return [];
  }

  // ─── Alerts ──────────────────────────────────────────────

  async saveAlert(alert: PersistedAlert): Promise<boolean> {
    await this.fallback.saveAlert(alert);

    if (this.client) {
      try {
        await this.client.mutation("positionProtection:saveAlert", {
          alertId: alert.alertId,
          positionId: alert.positionId,
          instrument: alert.instrument,
          severity: alert.severity,
          notificationPriority: alert.notificationPriority,
          reason: alert.reason,
          action: alert.action,
          timestamp: alert.timestamp,
          acknowledged: alert.acknowledged,
        });
        this._degraded = false;
        return true;
      } catch {
        this._degraded = true;
      }
    }
    return true;
  }

  async listAlertHistory(positionId: string, limit?: number): Promise<PersistedAlert[]> {
    const local = await this.fallback.listAlertHistory(positionId, limit);
    if (local.length > 0) return local;

    if (this.client) {
      try {
        const result = await this.client.query(
          "positionProtection:listAlerts",
          { positionId, limit: limit ?? 50 },
        );
        if (Array.isArray(result)) {
          this._degraded = false;
          return result.map((r) => this.mapConvexAlert(r as Record<string, unknown>));
        }
      } catch {
        this._degraded = true;
      }
    }
    return [];
  }

  async acknowledgeAlert(alertId: string): Promise<boolean> {
    await this.fallback.acknowledgeAlert(alertId);

    if (this.client) {
      try {
        await this.client.mutation(
          "positionProtection:acknowledgeAlert",
          { alertId },
        );
        this._degraded = false;
        return true;
      } catch {
        this._degraded = true;
      }
    }
    return true;
  }

  // ─── Event Cursors ───────────────────────────────────────

  async saveEventCursor(cursor: EventCursor): Promise<boolean> {
    await this.fallback.saveEventCursor(cursor);

    if (this.client) {
      try {
        await this.client.mutation("positionProtection:saveCursor", {
          provider: cursor.provider,
          instrument: cursor.instrument,
          lastEventId: cursor.lastEventId,
          lastTimestamp: cursor.lastTimestamp,
          lastSequence: cursor.lastSequence,
        });
        this._degraded = false;
        return true;
      } catch {
        this._degraded = true;
      }
    }
    return true;
  }

  async getEventCursor(provider: string, instrument: string): Promise<EventCursor | null> {
    return this.fallback.getEventCursor(provider, instrument);
  }

  // ─── Health ──────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    return this.fallback.isAvailable();
  }

  // ─── Mapping Helpers ─────────────────────────────────────

  private mapConvexPosition(record: Record<string, unknown>): PersistedPositionState {
    return {
      positionId: String(record.positionId ?? ""),
      instrument: String(record.instrument ?? ""),
      side: (record.side as PersistedPositionState["side"]) ?? "LONG",
      entryPrice: Number(record.entryPrice ?? 0),
      stopLoss: record.stopLoss != null ? Number(record.stopLoss) : undefined,
      takeProfit: record.takeProfit != null ? Number(record.takeProfit) : undefined,
      leverage: record.leverage != null ? Number(record.leverage) : undefined,
      horizon: (record.horizon as PersistedPositionState["horizon"]) ?? "SWING",
      openedAt: Number(record.openedAt ?? 0),
      peakPrice: record.peakPrice != null ? Number(record.peakPrice) : undefined,
      peakProfit: record.peakProfit != null ? Number(record.peakProfit) : undefined,
      currentSeverity: (record.currentSeverity as PersistedPositionState["currentSeverity"]) ?? "NONE",
      lifecycleState: String(record.lifecycleState ?? "MONITORING"),
      lastUpdateAt: Number(record.lastUpdateAt ?? 0),
      lastAlertAt: Number(record.lastAlertAt ?? 0),
      consecutiveSameSeverity: Number(record.consecutiveSameSeverity ?? 0),
      monitoringLifecycle:
        (record.monitoringLifecycle as PersistedPositionState["monitoringLifecycle"]) ?? "MONITORING",
    };
  }

  private mapConvexAlert(record: Record<string, unknown>): PersistedAlert {
    return {
      alertId: String(record.alertId ?? ""),
      positionId: String(record.positionId ?? ""),
      instrument: String(record.instrument ?? ""),
      severity: (record.severity as PersistedAlert["severity"]) ?? "NONE",
      notificationPriority: String(record.notificationPriority ?? "INFO"),
      reason: String(record.reason ?? ""),
      action: String(record.action ?? ""),
      timestamp: Number(record.timestamp ?? 0),
      acknowledged: Boolean(record.acknowledged),
    };
  }
}

// Re-export the in-memory fallback for convenience
export { InMemoryRepository };
