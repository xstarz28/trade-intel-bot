/**
 * Phase 60 — Convex Persistence Bridge
 *
 * Connects the in-memory monitoring engine to real Convex persistence.
 *
 * Architecture:
 * - Monitoring engine uses InMemoryRepository for real-time performance
 * - This bridge async-writes state changes to Convex in the background
 * - React components read from Convex via useQuery for reactive updates
 * - On page reload, state is restored from Convex
 *
 * CRITICAL: This bridge is INFORMATIONAL_ONLY.
 * It never modifies decision engine semantics.
 */

import type {
  MonitoringStateRepository,
  PersistedPositionState,
  PersistedAlert,
  EventCursor,
} from "./persistence";
import { InMemoryRepository } from "./persistence";

// ═══════════════════════════════════════════════════════════════
// CONVEX CLIENT INTERFACE (minimal, matching Convex client shape)
// ═══════════════════════════════════════════════════════════════

interface ConvexMutationResult {
  /** Returns the mutation result. */
  then?: (resolve: (v: unknown) => void, reject: (e: Error) => void) => void;
}

interface ConvexClientLike {
  /** Execute a mutation. */
  mutation(
    functionName: string,
    args?: Record<string, unknown>,
  ): ConvexMutationResult;

  /** Execute a query. */
  query(
    functionName: string,
    args?: Record<string, unknown>,
  ): Promise<unknown>;
}

// ═══════════════════════════════════════════════════════════════
// CONVEX BRIDGE
// ═══════════════════════════════════════════════════════════════

/**
 * Persistence bridge that wraps an InMemoryRepository for fast access
 * and async-delegates writes to Convex for durability.
 *
 * Falls back gracefully if Convex is unavailable.
 */
export class ConvexPersistenceBridge implements MonitoringStateRepository {
  private local: InMemoryRepository;
  private client: ConvexClientLike | null;
  private degraded = false;

  constructor(client?: ConvexClientLike | null) {
    this.local = new InMemoryRepository();
    this.client = client ?? null;
  }

  /** Whether Convex is reachable. */
  isDegraded(): boolean {
    return this.degraded;
  }

  // ─── Position State ──────────────────────────────────────

  async savePositionState(state: PersistedPositionState): Promise<boolean> {
    // Always save locally first (fast path)
    await this.local.savePositionState(state);

    // Async persist to Convex (non-blocking)
    this.persistToConvex("positionProtection:savePosition", {
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

    return true;
  }

  async getPositionState(positionId: string): Promise<PersistedPositionState | null> {
    // Fast path: check local first
    const local = await this.local.getPositionState(positionId);
    if (local) return local;

    // Slow path: query Convex
    if (this.client) {
      try {
        const result = await this.client.query(
          "positionProtection:getPosition",
          { positionId },
        );
        if (result && typeof result === "object") {
          const mapped = this.mapConvexPosition(result as Record<string, unknown>);
          // Cache locally for future fast access
          await this.local.savePositionState(mapped);
          return mapped;
        }
      } catch {
        this.degraded = true;
      }
    }

    return null;
  }

  async deletePositionState(positionId: string): Promise<boolean> {
    await this.local.deletePositionState(positionId);
    this.persistToConvex("positionProtection:deletePosition", { positionId });
    return true;
  }

  async listActivePositions(): Promise<PersistedPositionState[]> {
    // Check local first
    const local = await this.local.listActivePositions();
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
            await this.local.savePositionState(p);
          }
          return positions;
        }
      } catch {
        this.degraded = true;
      }
    }

    return [];
  }

  // ─── Alerts ──────────────────────────────────────────────

  async saveAlert(alert: PersistedAlert): Promise<boolean> {
    await this.local.saveAlert(alert);

    this.persistToConvex("positionProtection:saveAlert", {
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

    return true;
  }

  async listAlertHistory(positionId: string, limit?: number): Promise<PersistedAlert[]> {
    // Check local first
    const local = await this.local.listAlertHistory(positionId, limit);
    if (local.length > 0) return local;

    // Query Convex
    if (this.client) {
      try {
        const result = await this.client.query(
          "positionProtection:listAlerts",
          { positionId, limit: limit ?? 50 },
        );
        if (Array.isArray(result)) {
          return result.map((r) => this.mapConvexAlert(r as Record<string, unknown>));
        }
      } catch {
        this.degraded = true;
      }
    }

    return [];
  }

  async acknowledgeAlert(alertId: string): Promise<boolean> {
    await this.local.acknowledgeAlert(alertId);

    if (this.client) {
      try {
        await this.client.mutation(
          "positionProtection:acknowledgeAlert",
          { alertId },
        );
      } catch {
        this.degraded = true;
      }
    }

    return true;
  }

  // ─── Event Cursors ───────────────────────────────────────

  async saveEventCursor(cursor: EventCursor): Promise<boolean> {
    await this.local.saveEventCursor(cursor);

    this.persistToConvex("positionProtection:saveCursor", {
      provider: cursor.provider,
      instrument: cursor.instrument,
      lastEventId: cursor.lastEventId,
      lastTimestamp: cursor.lastTimestamp,
      lastSequence: cursor.lastSequence,
    });

    return true;
  }

  async getEventCursor(provider: string, instrument: string): Promise<EventCursor | null> {
    return this.local.getEventCursor(provider, instrument);
  }

  // ─── Health ──────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    return this.local.isAvailable();
  }

  // ─── Private helpers ─────────────────────────────────────

  /**
   * Non-blocking Convex write. Errors are silently captured
   * and never affect the monitoring engine.
   */
  private persistToConvex(
    functionName: string,
    args: Record<string, unknown>,
  ): void {
    if (!this.client) return;
    try {
      // Fire-and-forget mutation — never blocks the monitoring engine
      void this.client.mutation(functionName, args);
    } catch {
      this.degraded = true;
    }
  }

  /** Map a Convex record to PersistedPositionState. */
  private mapConvexPosition(record: Record<string, unknown>): PersistedPositionState {
    return {
      positionId: String(record.positionId ?? ""),
      instrument: String(record.instrument ?? ""),
      side: (record.side as "LONG" | "SHORT") ?? "LONG",
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
      monitoringLifecycle: (record.monitoringLifecycle as PersistedPositionState["monitoringLifecycle"]) ?? "MONITORING",
    };
  }

  /** Map a Convex record to PersistedAlert. */
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
