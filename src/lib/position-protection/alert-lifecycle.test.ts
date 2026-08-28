import { describe, it, expect } from "vitest";
import {
  createMonitoringState,
  shouldAlert,
  updateMonitoringState,
  deduplicateByDependencyGroup,
} from "./alert-lifecycle";

describe("createMonitoringState", () => {
  it("creates initial state with NONE severity", () => {
    const state = createMonitoringState("BTC/USDT");
    expect(state.instrument).toBe("BTC/USDT");
    expect(state.currentSeverity).toBe("NONE");
    expect(state.lifecycleState).toBe("MONITORING");
    expect(state.consecutiveSameSeverity).toBe(0);
    expect(state.history).toEqual([]);
  });
});

describe("shouldAlert", () => {
  it("always fires INVALIDATED", () => {
    const state = createMonitoringState("BTC/USDT");
    const result = shouldAlert(state, "INVALIDATED", Date.now());
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("invalidated");
  });

  it("fires on escalation from NONE to WATCH", () => {
    const state = createMonitoringState("BTC/USDT");
    const result = shouldAlert(state, "WATCH", Date.now());
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Escalation");
  });

  it("fires on escalation from WATCH to CAUTION", () => {
    const state = {
      ...createMonitoringState("BTC/USDT"),
      currentSeverity: "WATCH" as const,
    };
    const result = shouldAlert(state, "CAUTION", Date.now());
    expect(result.shouldFire).toBe(true);
  });

  it("fires on recovery (severity decrease)", () => {
    const state = {
      ...createMonitoringState("BTC/USDT"),
      currentSeverity: "CAUTION" as const,
    };
    const result = shouldAlert(state, "WATCH", Date.now());
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Recovery");
  });

  it("respects cooldown for same severity", () => {
    const state = {
      ...createMonitoringState("BTC/USDT"),
      currentSeverity: "WATCH" as const,
      nextAlertAllowedAt: Date.now() + 60_000,
    };
    const result = shouldAlert(state, "WATCH", Date.now());
    expect(result.shouldFire).toBe(false);
  });

  it("fires periodic re-alert for HIGH_RISK after consecutive", () => {
    const state = {
      ...createMonitoringState("BTC/USDT"),
      currentSeverity: "HIGH_RISK" as const,
      nextAlertAllowedAt: 0,
      consecutiveSameSeverity: 3,
    };
    const result = shouldAlert(state, "HIGH_RISK", Date.now());
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Periodic");
  });
});

describe("updateMonitoringState", () => {
  it("updates severity and lifecycle on transition", () => {
    const state = createMonitoringState("BTC/USDT");
    const now = Date.now();
    const updated = updateMonitoringState(state, "WATCH", now);
    expect(updated.currentSeverity).toBe("WATCH");
    expect(updated.lifecycleState).toBe("WATCH");
    expect(updated.lastAlertAt).toBe(now);
    expect(updated.consecutiveSameSeverity).toBe(0);
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].from).toBe("MONITORING");
    expect(updated.history[0].to).toBe("WATCH");
  });

  it("increments consecutive count on same severity", () => {
    const state = {
      ...createMonitoringState("BTC/USDT"),
      currentSeverity: "WATCH" as const,
      consecutiveSameSeverity: 2,
    };
    const updated = updateMonitoringState(state, "WATCH", Date.now());
    expect(updated.consecutiveSameSeverity).toBe(3);
  });

  it("resets consecutive count on severity change", () => {
    const state = {
      ...createMonitoringState("BTC/USDT"),
      currentSeverity: "WATCH" as const,
      consecutiveSameSeverity: 5,
    };
    const updated = updateMonitoringState(state, "CAUTION", Date.now());
    expect(updated.consecutiveSameSeverity).toBe(0);
  });

  it("sets nextAlertAllowedAt based on cooldown", () => {
    const state = createMonitoringState("BTC/USDT");
    const now = 1000000;
    const updated = updateMonitoringState(state, "HIGH_RISK", now);
    expect(updated.nextAlertAllowedAt).toBe(now + 5_000); // HIGH_RISK cooldown is 5s
  });

  it("INVALIDATED has zero cooldown", () => {
    const state = createMonitoringState("BTC/USDT");
    const now = 1000000;
    const updated = updateMonitoringState(state, "INVALIDATED", now);
    expect(updated.nextAlertAllowedAt).toBe(now);
  });

  it("appends lifecycle entry on transition only", () => {
    const state = createMonitoringState("BTC/USDT");
    const updated = updateMonitoringState(state, "NONE", Date.now());
    expect(updated.history).toHaveLength(0);
  });
});

describe("deduplicateByDependencyGroup", () => {
  it("keeps highest severity per group", () => {
    const signals = [
      { dependencyGroup: "A", severity: 30, name: "low" },
      { dependencyGroup: "A", severity: 80, name: "high" },
      { dependencyGroup: "B", severity: 50, name: "med" },
    ];
    const result = deduplicateByDependencyGroup(signals);
    expect(result).toHaveLength(2);
    const a = result.find(s => s.dependencyGroup === "A");
    expect(a?.severity).toBe(80);
  });

  it("returns empty for empty input", () => {
    expect(deduplicateByDependencyGroup([])).toEqual([]);
  });
});
