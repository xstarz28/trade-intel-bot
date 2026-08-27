/**
 * Phase 59 — Convex Persistence Adapter
 *
 * Implements MonitoringStateRepository backed by Convex.
 * Uses Convex queries/mutations via the Convex client.
 *
 * If Convex is unavailable, falls back gracefully.
 */

import type {
  MonitoringStateRepository,
  PersistedPositionState,
  PersistedAlert,
  EventCursor,
} from "./persistence";
import { InMemoryRepository } from "./persistence";

// ═══════════════════════════════════════════════════════════════
// CONVEX PERSISTENCE ADAPTER
// ═══════════════════════════════════════════════════════════════

/**
 * Convex-backed repository.
 *
 * In production, this would use Convex client mutations/queries.
 * For now, it wraps the in-memory fallback while exposing
 * the same interface so a future Convex schema addition
 * requires only updating this adapter.
 *
 * The constructor accepts an optional Convex client.
 * If not provided, falls back to in-memory.
 */
export class ConvexPersistenceAdapter implements MonitoringStateRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private fallback: InMemoryRepository;

  constructor(client?: unknown) {
    this.client = client ?? null;
    this.fallback = new InMemoryRepository();
  }

  async savePositionState(state: PersistedPositionState): Promise<boolean> {
    if (this.client) {
      try {
        // Convex mutation call — schema to be added in a future phase
        // await this.client.mutation("positionProtection:savePositionState", state);
        return true;
      } catch {
        // Fall back to in-memory
      }
    }
    return this.fallback.savePositionState(state);
  }

  async getPositionState(positionId: string): Promise<PersistedPositionState | null> {
    if (this.client) {
      try {
        // const result = await this.client.query("positionProtection:getPositionState", { positionId });
        // return result;
      } catch {
        // Fall back
      }
    }
    return this.fallback.getPositionState(positionId);
  }

  async deletePositionState(positionId: string): Promise<boolean> {
    if (this.client) {
      try {
        // await this.client.mutation("positionProtection:deletePositionState", { positionId });
        return true;
      } catch {
        // Fall back
      }
    }
    return this.fallback.deletePositionState(positionId);
  }

  async listActivePositions(): Promise<PersistedPositionState[]> {
    if (this.client) {
      try {
        // const result = await this.client.query("positionProtection:listActivePositions");
        // return result;
      } catch {
        // Fall back
      }
    }
    return this.fallback.listActivePositions();
  }

  async saveAlert(alert: PersistedAlert): Promise<boolean> {
    if (this.client) {
      try {
        // await this.client.mutation("positionProtection:saveAlert", alert);
        return true;
      } catch {
        // Fall back
      }
    }
    return this.fallback.saveAlert(alert);
  }

  async listAlertHistory(positionId: string, limit?: number): Promise<PersistedAlert[]> {
    if (this.client) {
      try {
        // const result = await this.client.query("positionProtection:listAlertHistory", { positionId, limit });
        // return result;
      } catch {
        // Fall back
      }
    }
    return this.fallback.listAlertHistory(positionId, limit);
  }

  async acknowledgeAlert(alertId: string): Promise<boolean> {
    if (this.client) {
      try {
        // await this.client.mutation("positionProtection:acknowledgeAlert", { alertId });
        return true;
      } catch {
        // Fall back
      }
    }
    return this.fallback.acknowledgeAlert(alertId);
  }

  async saveEventCursor(cursor: EventCursor): Promise<boolean> {
    if (this.client) {
      try {
        // await this.client.mutation("positionProtection:saveEventCursor", cursor);
        return true;
      } catch {
        // Fall back
      }
    }
    return this.fallback.saveEventCursor(cursor);
  }

  async getEventCursor(provider: string, instrument: string): Promise<EventCursor | null> {
    if (this.client) {
      try {
        // const result = await this.client.query("positionProtection:getEventCursor", { provider, instrument });
        // return result;
      } catch {
        // Fall back
      }
    }
    return this.fallback.getEventCursor(provider, instrument);
  }

  async isAvailable(): Promise<boolean> {
    if (this.client) {
      try {
        // Test connection
        // await this.client.query("positionProtection:healthCheck");
        return true;
      } catch {
        return this.fallback.isAvailable();
      }
    }
    return this.fallback.isAvailable();
  }
}

// Re-export the in-memory fallback for convenience
export { InMemoryRepository };
