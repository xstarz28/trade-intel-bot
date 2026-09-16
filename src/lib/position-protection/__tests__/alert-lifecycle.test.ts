/**
 * Phase 57 — Alert Lifecycle Tests
 */
import { describe, it, expect } from "vitest";
import {
  createMonitoringState,
  shouldAlert,
  updateMonitoringState,
  deduplicateByDependencyGroup,
} from "../alert-lifecycle";

describe("createMonitoringState", () => {
  it("creates initial state with NONE severity", () => {
    const s = createMonitoringState("BTC/USDT");
    expect(s.instrument).toBe("BTC/USDT");
    expect(s.currentSeverity).toBe("NONE");
    expect(s.lifecycleState).toBe("MONITORING");
    expect(s.consecutiveSameSeverity).toBe(0);
    expect(s.history).toHaveLength(0);
  });
});

describe("shouldAlert", () => {
  it("always fires INVALIDATED", () => {
    const s = createMonitoringState("BTC/USDT");
    const result = shouldAlert(s, "INVALIDATED", Date.now());
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Thesis invalidated");
  });

  it("fires on escalation from NONE to WATCH", () => {
    const s = createMonitoringState("BTC/USDT");
    const result = shouldAlert(s, "WATCH", Date.now());
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Escalation");
  });

  it("fires on escalation from WATCH to CAUTION", () => {
    let s = createMonitoringState("BTC/USDT");
    const now = Date.now();
    s = updateMonitoringState(s, "WATCH", now);
    // Must wait past cooldown before escalation check fires
    const result = shouldAlert(s, "CAUTION", now + 31_000);
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Escalation");
  });

  it("fires on recovery from HIGH_RISK to WATCH", () => {
    let s = createMonitoringState("BTC/USDT");
    s = updateMonitoringState(s, "HIGH_RISK", Date.now());
    const result = shouldAlert(s, "WATCH", Date.now() + 1000);
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Recovery");
  });

  it("respects cooldown for same severity", () => {
    let s = createMonitoringState("BTC/USDT");
    s = updateMonitoringState(s, "WATCH", Date.now());
    const result = shouldAlert(s, "WATCH", Date.now() + 1000);
    expect(result.shouldFire).toBe(false);
  });

  it("allows periodic re-alert for HIGH_RISK", () => {
    let s = createMonitoringState("BTC/USDT");
    s = updateMonitoringState(s, "HIGH_RISK", Date.now());
    // Simulate 3 consecutive same-severity assessments with cooldown passed
    s.consecutiveSameSeverity = 3;
    s.nextAlertAllowedAt = Date.now() - 1;
    const result = shouldAlert(s, "HIGH_RISK", Date.now());
    expect(result.shouldFire).toBe(true);
    expect(result.reason).toContain("Periodic re-alert");
  });
});

describe("updateMonitoringState", () => {
  it("updates severity and lifecycle", () => {
    const s = createMonitoringState("BTC/USDT");
    const updated = updateMonitoringState(s, "WATCH", Date.now());
    expect(updated.currentSeverity).toBe("WATCH");
    expect(updated.lifecycleState).toBe("WATCH");
    expect(updated.lastAlertAt).toBeGreaterThan(0);
  });

  it("records lifecycle transition in history", () => {
    const s = createMonitoringState("BTC/USDT");
    const updated = updateMonitoringState(s, "CAUTION", Date.now());
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].from).toBe("MONITORING");
    expect(updated.history[0].to).toBe("CAUTION");
  });

  it("increments consecutive count on same severity", () => {
    let s = createMonitoringState("BTC/USDT");
    s = updateMonitoringState(s, "WATCH", Date.now());
    s = updateMonitoringState(s, "WATCH", Date.now() + 50_000);
    expect(s.consecutiveSameSeverity).toBe(1);
  });

  it("resets consecutive count on severity change", () => {
    let s = createMonitoringState("BTC/USDT");
    s = updateMonitoringState(s, "WATCH", Date.now());
    s = updateMonitoringState(s, "CAUTION", Date.now() + 50_000);
    expect(s.consecutiveSameSeverity).toBe(0);
  });

  it("does not record additional history entry for same severity", () => {
    let s = createMonitoringState("BTC/USDT");
    s = updateMonitoringState(s, "WATCH", Date.now());
    const lengthAfterFirst = s.history.length;
    s = updateMonitoringState(s, "WATCH", Date.now() + 50_000);
    expect(s.history).toHaveLength(lengthAfterFirst);
  });
});

describe("deduplicateByDependencyGroup", () => {
  it("keeps highest severity per group", () => {
    const signals = [
      {
        dependencyGroup: "A",
        severity: 30,
        name: "low",
        description: "",
        category: "TECHNICAL" as const,
        source: "test",
        observedAt: 0,
        freshness: "FRESH" as const,
      },
      {
        dependencyGroup: "A",
        severity: 80,
        name: "high",
        description: "",
        category: "TECHNICAL" as const,
        source: "test",
        observedAt: 0,
        freshness: "FRESH" as const,
      },
      {
        dependencyGroup: "B",
        severity: 50,
        name: "b",
        description: "",
        category: "MOMENTUM" as const,
        source: "test",
        observedAt: 0,
        freshness: "FRESH" as const,
      },
    ];
    const result = deduplicateByDependencyGroup(signals);
    expect(result).toHaveLength(2);
    const aSignal = result.find((s) => s.dependencyGroup === "A");
    expect(aSignal!.severity).toBe(80);
  });

  it("preserves unique groups", () => {
    const signals = [
      {
        dependencyGroup: "A",
        severity: 30,
        name: "a",
        description: "",
        category: "TECHNICAL" as const,
        source: "test",
        observedAt: 0,
        freshness: "FRESH" as const,
      },
      {
        dependencyGroup: "B",
        severity: 30,
        name: "b",
        description: "",
        category: "TECHNICAL" as const,
        source: "test",
        observedAt: 0,
        freshness: "FRESH" as const,
      },
    ];
    const result = deduplicateByDependencyGroup(signals);
    expect(result).toHaveLength(2);
  });
});
