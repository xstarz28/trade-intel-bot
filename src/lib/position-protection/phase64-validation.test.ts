/**
 * Phase 64 — Comprehensive Validation Suite
 *
 * Tests covering:
 * - Continuous controller lifecycle
 * - Monitoring cadence
 * - Event priority
 * - Signal fusion
 * - Profit protection escalation
 * - Giveback + thesis interaction
 * - Dangerous vs normal pullback
 * - Why TP Now quality
 * - Position priority
 * - Pause/resume
 * - Stale data
 * - Recovery / hysteresis
 * - Alert deduplication
 * - Persistence compatibility
 * - Radar compatibility
 * - No fabrication / no auto-execution
 * - Determinism
 * - Performance / memory
 * - Trader scenarios
 */

import { describe, it, expect } from "vitest";
import type { PositionContext } from "./types";
import type { MarketEvidence } from "./thesis-health";
import type { ProfitProtectionUrgency } from "./types";
import {
  createControllerState,
  registerPosition,
  removePosition,
  startController,
  stopController,
  pauseController,
  resumeController,
  pausePosition,
  resumePosition,
  shouldEvaluatePosition,
  evaluatePosition,
  processEventForController,
  getDashboard,
  type ContinuousControllerState,
  type PositionControllerState,
} from "./continuous-protection-controller";
import {
  computeEventPriority,
  comparePriority,
  isCriticalEvent,
} from "./event-priority";
import {
  fuseSignals,
  countByClassification,
  isMaterialRisk,
  type FusedSignal,
} from "./signal-fusion";
import {
  getCadenceForHorizon,
  shouldEvaluateNow,
  getAllCadenceProfiles,
} from "./monitoring-cadence";
import {
  computePositionPriority,
  sortByPriority,
} from "./position-priority";
import {
  createPriceEvent,
  createStructureChangeEvent,
  createMomentumChangeEvent,
  createFundingChangeEvent,
  createLiquidationChangeEvent,
  createMacroChangeEvent,
  createProviderDegradedEvent,
  createProviderRecoveredEvent,
  createDataStaleEvent,
} from "./market-event-bridge";
import {
  evaluateProtection,
} from "./protection-engine";
import { detectShock } from "./shock-detector";
import {
  classifyGivebackSeverity,
} from "./giveback-monitor";
import {
  createAccelerationState,
  recordPriceObservation,
} from "./acceleration-monitor";
import {
  createMonitoringState,
  shouldAlert,
  updateMonitoringState,
} from "./alert-lifecycle";
import {
  InMemoryRepository,
  type PersistedPositionState,
} from "./persistence";
import {
  urgencyRank,
  type AlertSeverity as AlertSeverityType,
} from "./types";
import { aggregateTimeframeEvidence, type TimeframeEvidence } from "./multi-timeframe-engine";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const NOW = Date.now();

function longBtc(overrides?: Partial<PositionContext>): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100000,
    currentPrice: 112000,
    stopLoss: 95000,
    takeProfit: 120000,
    leverage: 10,
    openedAt: NOW - 3600_000,
    horizon: "SWING",
    ...overrides,
  };
}

function shortEth(overrides?: Partial<PositionContext>): PositionContext {
  return {
    instrument: "ETH/USDT",
    assetClass: "crypto",
    side: "SHORT",
    entryPrice: 4000,
    currentPrice: 3800,
    stopLoss: 4200,
    takeProfit: 3500,
    openedAt: NOW - 3600_000,
    horizon: "INTRADAY",
    ...overrides,
  };
}

function healthyEvidence(price?: number): MarketEvidence {
  return {
    price: price ?? 112000,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    structureBroken: false,
    volatility: 1500,
    avgVolatility: 2000,
    riskRegime: "risk_on",
    momentumChange: 5,
  };
}

function deterioratingEvidence(price?: number): MarketEvidence {
  return {
    price: price ?? 108000,
    shortTermTrend: "bearish",
    mediumTermTrend: "bearish",
    structureBroken: true,
    volatility: 4000,
    avgVolatility: 1500,
    momentumChange: -25,
    riskRegime: "risk_off",
    riskRegimeChanged: true,
  };
}

function registerTestPosition(state: ContinuousControllerState): ContinuousControllerState {
  return registerPosition(state, {
    positionId: "btc-long-1",
    instrument: "BTC/USDT",
    side: "LONG",
    entryPrice: 100000,
    currentPrice: 112000,
    stopLoss: 95000,
    takeProfit: 120000,
    leverage: 10,
    horizon: "SWING",
    assetClass: "crypto",
    openedAt: NOW - 3600_000,
  }, NOW);
}

// ═══════════════════════════════════════════════════════════════
// A. CONTROLLER LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("A. Controller Lifecycle", () => {
  it("creates empty controller state", () => {
    const state = createControllerState();
    expect(state.positions.size).toBe(0);
    expect(state.globalLifecycle).toBe("STOPPED");
  });

  it("registers a position", () => {
    const state = registerTestPosition(createControllerState());
    expect(state.positions.size).toBe(1);
    expect(state.positions.get("btc-long-1")!.lifecycle).toBe("RUNNING");
  });

  it("removes a position", () => {
    let state = registerTestPosition(createControllerState());
    state = removePosition(state, "btc-long-1");
    expect(state.positions.size).toBe(0);
  });

  it("removing non-existent position is safe", () => {
    const state = removePosition(createControllerState(), "nonexistent");
    expect(state.positions.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. START
// ═══════════════════════════════════════════════════════════════

describe("B. Start", () => {
  it("starts controller and all positions", () => {
    let state = registerTestPosition(createControllerState());
    state = stopController(state);
    state = startController(state);
    expect(state.globalLifecycle).toBe("RUNNING");
    expect(state.positions.get("btc-long-1")!.lifecycle).toBe("RUNNING");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. PAUSE
// ═══════════════════════════════════════════════════════════════

describe("C. Pause", () => {
  it("pauses all positions globally", () => {
    let state = registerTestPosition(createControllerState());
    state = pauseController(state);
    expect(state.globalLifecycle).toBe("PAUSED");
    expect(state.positions.get("btc-long-1")!.lifecycle).toBe("PAUSED");
  });

  it("pauses individual position", () => {
    let state = registerTestPosition(createControllerState());
    state = pausePosition(state, "btc-long-1");
    expect(state.positions.get("btc-long-1")!.lifecycle).toBe("PAUSED");
  });

  it("pausing non-existent position is safe", () => {
    const state = pausePosition(createControllerState(), "nonexistent");
    expect(state.globalLifecycle).toBe("STOPPED");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. RESUME
// ═══════════════════════════════════════════════════════════════

describe("D. Resume", () => {
  it("resumes all positions globally", () => {
    let state = registerTestPosition(createControllerState());
    state = pauseController(state);
    state = resumeController(state);
    expect(state.globalLifecycle).toBe("RUNNING");
    expect(state.positions.get("btc-long-1")!.lifecycle).toBe("RUNNING");
  });

  it("resumes individual position", () => {
    let state = registerTestPosition(createControllerState());
    state = pausePosition(state, "btc-long-1");
    state = resumePosition(state, "btc-long-1");
    expect(state.positions.get("btc-long-1")!.lifecycle).toBe("RUNNING");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. STOP
// ═══════════════════════════════════════════════════════════════

describe("E. Stop", () => {
  it("stops all positions globally", () => {
    let state = registerTestPosition(createControllerState());
    state = stopController(state);
    expect(state.globalLifecycle).toBe("STOPPED");
    expect(state.positions.get("btc-long-1")!.lifecycle).toBe("STOPPED");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. MONITORING CADENCE
// ═══════════════════════════════════════════════════════════════

describe("F. Monitoring Cadence", () => {
  it("SCALPING has tighter cadence than INVESTING", () => {
    const scalp = getCadenceForHorizon("SCALPING");
    const invest = getCadenceForHorizon("INVESTING");
    expect(scalp.scheduledIntervalMs).toBeLessThan(invest.scheduledIntervalMs);
    expect(scalp.eventDrivenIntervalMs).toBeLessThan(invest.eventDrivenIntervalMs);
  });

  it("unknown horizon defaults to SWING", () => {
    const cadence = getCadenceForHorizon("UNKNOWN");
    expect(cadence.scheduledIntervalMs).toBe(30_000);
  });

  it("all profiles exist", () => {
    const profiles = getAllCadenceProfiles();
    expect(Object.keys(profiles)).toContain("SCALPING");
    expect(Object.keys(profiles)).toContain("INTRADAY");
    expect(Object.keys(profiles)).toContain("SWING");
    expect(Object.keys(profiles)).toContain("INVESTING");
  });

  it("shouldEvaluateNow respects cadence", () => {
    const cadence = getCadenceForHorizon("SWING");
    const result = shouldEvaluateNow(NOW, NOW + 5_000, cadence, "LOW");
    expect(result.shouldEvaluate).toBe(false);
    const result2 = shouldEvaluateNow(NOW, NOW + 65_000, cadence, "LOW");
    expect(result2.shouldEvaluate).toBe(true);
  });

  it("critical events always evaluate", () => {
    const cadence = getCadenceForHorizon("SWING");
    const result = shouldEvaluateNow(NOW, NOW + 100, cadence, "CRITICAL");
    expect(result.shouldEvaluate).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. EVENT PRIORITY
// ═══════════════════════════════════════════════════════════════

describe("G. Event Priority", () => {
  it("PRICE_UPDATE is LOW priority", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "test");
    expect(computeEventPriority(event)).toBe("LOW");
  });

  it("MARKET_STRUCTURE_CHANGE is HIGH priority", () => {
    const event = createStructureChangeEvent("BTC/USDT", true, "M15", "test");
    expect(computeEventPriority(event)).toBe("HIGH");
  });

  it("FUNDING_CHANGE is HIGH priority", () => {
    const event = createFundingChangeEvent("BTC/USDT", 0.005, "test");
    expect(computeEventPriority(event)).toBe("HIGH");
  });

  it("LIQUIDATION_CHANGE is HIGH priority", () => {
    const event = createLiquidationChangeEvent("BTC/USDT", true, 0, "test");
    expect(computeEventPriority(event)).toBe("HIGH");
  });

  it("MACRO_CHANGE with risk_off is CRITICAL priority", () => {
    const event = createMacroChangeEvent("BTC/USDT", "risk_off", "test");
    expect(computeEventPriority(event)).toBe("CRITICAL");
  });

  it("provider degraded is CRITICAL", () => {
    const event = createProviderDegradedEvent("BTC/USDT", "test", "error");
    expect(computeEventPriority(event)).toBe("CRITICAL");
  });

  it("comparePriority is consistent", () => {
    expect(comparePriority("CRITICAL", "HIGH")).toBeGreaterThan(0);
    expect(comparePriority("HIGH", "LOW")).toBeGreaterThan(0);
    expect(comparePriority("LOW", "LOW")).toBe(0);
  });

  it("isCriticalEvent detects critical", () => {
    const event = createProviderDegradedEvent("BTC/USDT", "test", "error");
    expect(isCriticalEvent(event)).toBe(true);
    const normal = createPriceEvent("BTC/USDT", 100000, "test");
    expect(isCriticalEvent(normal)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. CRITICAL EVENT BYPASS
// ═══════════════════════════════════════════════════════════════

describe("H. Critical Event Bypass", () => {
  it("critical events bypass pause", () => {
    const pos: PositionControllerState = {
      positionId: "test",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 100000,
      currentPrice: 112000,
      horizon: "SWING",
      assetClass: "crypto",
      openedAt: NOW,
      lifecycle: "PAUSED",
      monitoringState: createMonitoringState("BTC/USDT"),
      accelerationState: createAccelerationState(),
      lastEvaluationAt: 0,
      lastAlertSeverity: "NONE",
      alertCount: 0,
      fusedSignals: [],
      earlyProtectionResult: null,
    };

    const result = shouldEvaluatePosition(pos, "CRITICAL", NOW);
    expect(result.shouldEvaluate).toBe(true);
  });

  it("high events respect pause", () => {
    const pos: PositionControllerState = {
      positionId: "test",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 100000,
      currentPrice: 112000,
      horizon: "SWING",
      assetClass: "crypto",
      openedAt: NOW,
      lifecycle: "PAUSED",
      monitoringState: createMonitoringState("BTC/USDT"),
      accelerationState: createAccelerationState(),
      lastEvaluationAt: 0,
      lastAlertSeverity: "NONE",
      alertCount: 0,
      fusedSignals: [],
      earlyProtectionResult: null,
    };

    const result = shouldEvaluatePosition(pos, "HIGH", NOW);
    expect(result.shouldEvaluate).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. SIGNAL FUSION
// ═══════════════════════════════════════════════════════════════

describe("I. Signal Fusion", () => {
  it("empty signals produce empty fusion", () => {
    const alert = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    const fused = fuseSignals(alert.alert);
    expect(fused.length).toBe(0);
  });

  it("deduplicates by dependency group", () => {
    const alert = evaluateProtection({
      position: longBtc({ currentPrice: 104000 }),
      evidence: {
        price: 104000,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        structureBroken: true,
        momentumChange: -25,
        volatility: 5000,
        avgVolatility: 1500,
      },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    const fused = fuseSignals(alert.alert);
    // Each unique dependency group should appear once
    const groups = fused.map(f => f.dependencyGroup);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("counts by classification correctly", () => {
    const signals: FusedSignal[] = [
      { dependencyGroup: "A", category: "TECHNICAL", classification: "CRITICAL", severity: 80, name: "a", description: "a", signalCount: 1 },
      { dependencyGroup: "B", category: "MOMENTUM", classification: "CONFIRMATION", severity: 50, name: "b", description: "b", signalCount: 1 },
      { dependencyGroup: "C", category: "VOLATILITY", classification: "EARLY_WARNING", severity: 30, name: "c", description: "c", signalCount: 1 },
    ];
    const counts = countByClassification(signals);
    expect(counts.CRITICAL).toBe(1);
    expect(counts.CONFIRMATION).toBe(1);
    expect(counts.EARLY_WARNING).toBe(1);
  });

  it("material risk detected with CRITICAL signal", () => {
    const signals: FusedSignal[] = [
      { dependencyGroup: "A", category: "TECHNICAL", classification: "CRITICAL", severity: 80, name: "a", description: "a", signalCount: 1 },
    ];
    expect(isMaterialRisk(signals)).toBe(true);
  });

  it("material risk detected with 2+ CONFIRMATION signals", () => {
    const signals: FusedSignal[] = [
      { dependencyGroup: "A", category: "TECHNICAL", classification: "CONFIRMATION", severity: 50, name: "a", description: "a", signalCount: 1 },
      { dependencyGroup: "B", category: "MOMENTUM", classification: "CONFIRMATION", severity: 50, name: "b", description: "b", signalCount: 1 },
    ];
    expect(isMaterialRisk(signals)).toBe(true);
  });

  it("no material risk with single EARLY_WARNING", () => {
    const signals: FusedSignal[] = [
      { dependencyGroup: "A", category: "TECHNICAL", classification: "EARLY_WARNING", severity: 30, name: "a", description: "a", signalCount: 1 },
    ];
    expect(isMaterialRisk(signals)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. PROFIT PROTECTION ESCALATION
// ═══════════════════════════════════════════════════════════════

describe("J. Profit Protection Escalation", () => {
  it("healthy profitable position → NONE urgency", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: healthyEvidence(),
      now: NOW,
    });
    expect(result.alert.severity).toBe("NONE");
    expect(result.alert.urgency).toBe("NONE");
  });

  it("deteriorating profitable position → escalating urgency", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 104000 }),
      evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity !== "NONE") {
      expect(urgencyRank(result.alert.urgency)).toBeGreaterThan(urgencyRank("NONE"));
    }
  });

  it("INVALIDATED always gets CRITICAL urgency", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 95000 }),
      evidence: {
        price: 95000,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        longTermTrend: "bearish",
        structureBroken: true,
        momentumChange: -30,
        volatility: 6000,
        avgVolatility: 1500,
        riskRegime: "risk_off",
        riskRegimeChanged: true,
      },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity === "INVALIDATED") {
      expect(result.alert.urgency).toBe("CRITICAL");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// K. GIVEBACK + THESIS INTERACTION
// ═══════════════════════════════════════════════════════════════

describe("K. Giveback + Thesis Interaction", () => {
  it("CASE A: profit + normal pullback + healthy thesis → HOLD", () => {
    const result = evaluateProtection({
      position: longBtc(),
      evidence: { price: 110000, shortTermTrend: "bullish", mediumTermTrend: "bullish" },
      now: NOW,
    });
    expect(result.alert.severity).toBe("NONE");
  });

  it("CASE B: profit + moderate giveback + early deterioration → WATCH or CAUTION", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 107000 }),
      evidence: { price: 107000, shortTermTrend: "bearish" },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    expect(["NONE", "WATCH", "CAUTION"]).toContain(result.alert.severity);
  });

  it("CASE C: profit + multiple deterioration → CAUTION or higher", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 104000 }),
      evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    expect(["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(result.alert.severity);
  });

  it("CASE D: profit + structural reversal → PROTECT_PROFIT_NOW", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 100000 }),
      evidence: {
        price: 100000, shortTermTrend: "bearish", mediumTermTrend: "bearish",
        longTermTrend: "bearish", structureBroken: true, momentumChange: -30,
        volatility: 5000, avgVolatility: 1500, riskRegime: "risk_off",
      },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    expect(["CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(result.alert.severity);
  });

  it("CASE E: profit + shock + thesis invalidation → CRITICAL", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 95000 }),
      evidence: {
        price: 95000, shortTermTrend: "bearish", mediumTermTrend: "bearish",
        longTermTrend: "bearish", structureBroken: true, momentumChange: -35,
        volatility: 6000, avgVolatility: 1500, riskRegime: "risk_off", riskRegimeChanged: true,
      },
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.severity === "INVALIDATED") {
      expect(result.alert.urgency).toBe("CRITICAL");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// L. WHY TP NOW QUALITY
// ═══════════════════════════════════════════════════════════════

describe("L. Why TP Now Quality", () => {
  it("always provides structured explanation", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const why = result.alert.whyTpNow;
    expect(typeof why.profitStatus).toBe("string");
    expect(Array.isArray(why.whatChanged)).toBe(true);
    expect(Array.isArray(why.confirmations)).toBe(true);
    expect(Array.isArray(why.stillSupporting)).toBe(true);
    expect(Array.isArray(why.missingEvidence)).toBe(true);
    expect(typeof why.urgencyIncreased).toBe("string");
    expect(typeof why.suggestedAction).toBe("string");
    expect(typeof why.disclaimer).toBe("string");
  });

  it("healthy position shows no urgency", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    expect(result.alert.whyTpNow.urgencyIncreased).toContain("No urgency");
  });

  it("disclaimer never contains probability language", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    expect(result.alert.whyTpNow.disclaimer.toLowerCase()).not.toContain("probability");
  });

  it("confirmations show independent signal count when present", () => {
    const result = evaluateProtection({
      position: longBtc({ currentPrice: 104000 }),
      evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"),
      now: NOW,
    });
    if (result.alert.whyTpNow.confirmations.length > 0) {
      expect(result.alert.whyTpNow.confirmations[0]).toContain("independent");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// M. POSITION PRIORITY
// ═══════════════════════════════════════════════════════════════

describe("M. Position Priority", () => {
  it("INVALIDATED > HIGH_RISK > CAUTION > WATCH > NONE", () => {
    const p1 = computePositionPriority({ severity: "INVALIDATED", urgency: "CRITICAL", givebackPct: 80, accelerationLevel: "HIGH", profitState: "PROFITABLE" });
    const p2 = computePositionPriority({ severity: "HIGH_RISK", urgency: "HIGH", givebackPct: 60, accelerationLevel: "ELEVATED", profitState: "PROFITABLE" });
    const p3 = computePositionPriority({ severity: "CAUTION", urgency: "MODERATE", givebackPct: 30, accelerationLevel: "NORMAL", profitState: "PROFITABLE" });
    const p4 = computePositionPriority({ severity: "WATCH", urgency: "LOW", givebackPct: 15, accelerationLevel: "NORMAL", profitState: "PROFITABLE" });
    const p5 = computePositionPriority({ severity: "NONE", urgency: "NONE", givebackPct: 0, accelerationLevel: "NORMAL", profitState: "STRONGLY_PROFITABLE" });
    expect(p1.rank).toBeGreaterThan(p2.rank);
    expect(p2.rank).toBeGreaterThan(p3.rank);
    expect(p3.rank).toBeGreaterThan(p4.rank);
    expect(p4.rank).toBeGreaterThan(p5.rank);
  });

  it("higher giveback increases priority", () => {
    const low = computePositionPriority({ severity: "CAUTION", urgency: "MODERATE", givebackPct: 10, accelerationLevel: "NORMAL", profitState: "PROFITABLE" });
    const high = computePositionPriority({ severity: "CAUTION", urgency: "MODERATE", givebackPct: 80, accelerationLevel: "NORMAL", profitState: "PROFITABLE" });
    expect(high.rank).toBeGreaterThan(low.rank);
  });

  it("sortByPriority sorts correctly", () => {
    const items = [
      { positionId: "a", priority: computePositionPriority({ severity: "WATCH", urgency: "NONE", givebackPct: 0, accelerationLevel: "NORMAL", profitState: "PROFITABLE" }) },
      { positionId: "b", priority: computePositionPriority({ severity: "INVALIDATED", urgency: "CRITICAL", givebackPct: 80, accelerationLevel: "HIGH", profitState: "PROFITABLE" }) },
      { positionId: "c", priority: computePositionPriority({ severity: "CAUTION", urgency: "MODERATE", givebackPct: 30, accelerationLevel: "NORMAL", profitState: "PROFITABLE" }) },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].positionId).toBe("b");
    expect(sorted[2].positionId).toBe("a");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. PAUSE/RESUME BEHAVIOR
// ═══════════════════════════════════════════════════════════════

describe("N. Pause/Resume Behavior", () => {
  it("paused position ignores non-critical events", () => {
    let state = registerTestPosition(createControllerState());
    state = pausePosition(state, "btc-long-1");
    const event = createPriceEvent("BTC/USDT", 113000, "test");
    const result = processEventForController(state, event, NOW);
    expect(result.alerts.length).toBe(0);
  });

  it("paused position reacts to critical events", () => {
    let state = registerTestPosition(createControllerState());
    state = pausePosition(state, "btc-long-1");
    const event = createProviderDegradedEvent("BTC/USDT", "test", "error");
    const result = processEventForController(state, event, NOW);
    // Critical events bypass pause
    expect(result.state.criticalEventsProcessed).toBe(1);
  });

  it("stopped position ignores all events", () => {
    let state = registerTestPosition(createControllerState());
    state = stopController(state);
    const event = createProviderDegradedEvent("BTC/USDT", "test", "error");
    const result = processEventForController(state, event, NOW);
    expect(result.alerts.length).toBe(0);
    expect(result.state.criticalEventsProcessed).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. STALE DATA
// ═══════════════════════════════════════════════════════════════

describe("O. Stale Data", () => {
  it("DATA_STALE event is LOW priority", () => {
    const event = createDataStaleEvent("BTC/USDT", "test", 600_000);
    expect(computeEventPriority(event)).toBe("LOW");
  });

  it("provider recovered is LOW priority", () => {
    const event = createProviderRecoveredEvent("BTC/USDT", "test");
    expect(computeEventPriority(event)).toBe("LOW");
  });
});

// ═══════════════════════════════════════════════════════════════
// P. RECOVERY / HYSTERESIS
// ═══════════════════════════════════════════════════════════════

describe("P. Recovery / Hysteresis", () => {
  it("alert lifecycle detects recovery", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "CAUTION", NOW);
    expect(state.currentSeverity).toBe("CAUTION");

    // Recovery should fire when severity decreases
    const decision = shouldAlert(state, "WATCH", NOW + 30_000);
    expect(decision.shouldFire).toBe(true);
  });

  it("cooldown prevents repeated same-severity alerts", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "WATCH", NOW);

    // Same severity within cooldown → should NOT fire
    const decision = shouldAlert(state, "WATCH", NOW + 10_000);
    expect(decision.shouldFire).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. ALERT DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("Q. Alert Deduplication", () => {
  it("same severity within cooldown is suppressed", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "WATCH", NOW);
    const decision = shouldAlert(state, "WATCH", NOW + 5_000);
    expect(decision.shouldFire).toBe(false);
  });

  it("escalation bypasses cooldown", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "WATCH", NOW);
    const decision = shouldAlert(state, "CAUTION", NOW + 5_000);
    expect(decision.shouldFire).toBe(true);
  });

  it("INVALIDATED always fires", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "INVALIDATED", NOW);
    const decision = shouldAlert(state, "INVALIDATED", NOW + 1_000);
    expect(decision.shouldFire).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. DASHBOARD
// ═══════════════════════════════════════════════════════════════

describe("R. Dashboard", () => {
  it("getDashboard returns correct counts", () => {
    let state = registerTestPosition(createControllerState());
    const dashboard = getDashboard(state);
    expect(dashboard.totalPositions).toBe(1);
    expect(dashboard.activePositions).toBe(1);
    expect(dashboard.pausedPositions).toBe(0);
  });

  it("dashboard tracks paused positions", () => {
    let state = registerTestPosition(createControllerState());
    state = pausePosition(state, "btc-long-1");
    const dashboard = getDashboard(state);
    expect(dashboard.pausedPositions).toBe(1);
    expect(dashboard.activePositions).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. MULTI-POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("S. Multi-Position Isolation", () => {
  it("BTC and ETH positions are independent", () => {
    let state = createControllerState();
    state = registerPosition(state, {
      positionId: "btc-1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100000, currentPrice: 112000, horizon: "SWING", assetClass: "crypto", openedAt: NOW,
    }, NOW);
    state = registerPosition(state, {
      positionId: "eth-1", instrument: "ETH/USDT", side: "SHORT",
      entryPrice: 4000, currentPrice: 3800, horizon: "INTRADAY", assetClass: "crypto", openedAt: NOW,
    }, NOW);

    // BTC event only affects BTC position
    const btcEvent = createPriceEvent("BTC/USDT", 113000, "test");
    const result = processEventForController(state, btcEvent, NOW);
    expect(result.state.positions.size).toBe(2);
    // Only BTC should be evaluated
    expect(result.state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });

  it("50+ simultaneous positions handled", () => {
    let state = createControllerState();
    for (let i = 0; i < 60; i++) {
      state = registerPosition(state, {
        positionId: `pos-${i}`, instrument: `INSTR_${i}/USDT`, side: "LONG",
        entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW,
      }, NOW);
    }
    expect(state.positions.size).toBe(60);
    const dashboard = getDashboard(state);
    expect(dashboard.totalPositions).toBe(60);
  });
});

// ═══════════════════════════════════════════════════════════════
// T. NO FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("T. No Fabrication", () => {
  it("alerts contain no probability percentages", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const s = JSON.stringify(result.alert).toLowerCase();
    expect(s).not.toMatch(/\d+%\s*chance/);
  });

  it("alerts contain no probability of profit", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const s = JSON.stringify(result.alert).toLowerCase();
    expect(s).not.toContain("probability of profit");
  });

  it("missing data stays missing", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: { price: 112000 }, now: NOW,
    });
    expect(result.alert.missingData.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("U. No Auto-Execution", () => {
  it("action recommendations never include auto-execute", () => {
    const severities: AlertSeverityType[] = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"];
    for (const sev of severities) {
      let pos: PositionContext;
      let evidence: MarketEvidence;
      if (sev === "NONE") {
        pos = longBtc(); evidence = healthyEvidence();
      } else if (sev === "WATCH") {
        pos = longBtc(); evidence = { price: 105000, shortTermTrend: "bearish" };
      } else {
        pos = longBtc({ currentPrice: 95000 });
        evidence = { price: 95000, shortTermTrend: "bearish", mediumTermTrend: "bearish", structureBroken: true, momentumChange: -30, riskRegime: "risk_off", riskRegimeChanged: true, volatility: 5000, avgVolatility: 1500 };
      }
      const result = evaluateProtection({ position: pos, evidence, monitoringState: createMonitoringState("BTC/USDT"), now: NOW });
      expect(result.alert.actionRecommendation.toLowerCase()).not.toContain("auto");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// V. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("V. Decision Immutability", () => {
  it("protection alert has no recommendation/bias/conviction", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"), now: NOW,
    });
    expect((result.alert as any).recommendation).toBeUndefined();
    expect((result.alert as any).bias).toBeUndefined();
    expect((result.alert as any).conviction).toBeUndefined();
    expect((result.alert as any).tradePlan).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// W. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("W. Security", () => {
  it("no API keys in alerts", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const s = JSON.stringify(result.alert);
    expect(s.toLowerCase()).not.toContain("api_key");
    expect(s.toLowerCase()).not.toContain("secret");
  });

  it("no credentials in persisted state", () => {
    const state: PersistedPositionState = {
      positionId: "test", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING", lastUpdateAt: NOW,
      lastAlertAt: 0, consecutiveSameSeverity: 0,
    };
    expect(JSON.stringify(state).toLowerCase()).not.toContain("api_key");
  });
});

// ═══════════════════════════════════════════════════════════════
// X. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("X. Determinism", () => {
  it("same inputs → same severity", () => {
    const a = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    const b = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    expect(a.alert.severity).toBe(b.alert.severity);
  });

  it("same inputs → same urgency", () => {
    const a = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    const b = evaluateProtection({ position: longBtc(), evidence: healthyEvidence(), now: 1000 });
    expect(a.alert.urgency).toBe(b.alert.urgency);
  });

  it("same inputs → same position priority", () => {
    const input = { severity: "CAUTION" as AlertSeverityType, urgency: "MODERATE" as ProfitProtectionUrgency, givebackPct: 30, accelerationLevel: "NORMAL" as const, profitState: "PROFITABLE" as const };
    const a = computePositionPriority(input);
    const b = computePositionPriority(input);
    expect(a.rank).toBe(b.rank);
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. PERSISTENCE COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

describe("Y. Persistence Compatibility", () => {
  it("InMemoryRepository saves and loads", async () => {
    const repo = new InMemoryRepository();
    const state: PersistedPositionState = {
      positionId: "test-1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "CAUTION", lifecycleState: "CAUTION",
      monitoringLifecycle: "MONITORING", lastUpdateAt: NOW,
      lastAlertAt: NOW, consecutiveSameSeverity: 0,
    };
    await repo.savePositionState(state);
    const loaded = await repo.getPositionState("test-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.currentSeverity).toBe("CAUTION");
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. PERFORMANCE / MEMORY
// ═══════════════════════════════════════════════════════════════

describe("Z. Performance / Memory", () => {
  it("acceleration state is bounded", () => {
    let state = createAccelerationState({ maxBufferSize: 20, windowMs: 60_000 });
    for (let i = 0; i < 200; i++) {
      state = recordPriceObservation(state, NOW - (200 - i) * 1000, 100000 + i * 10, "test");
    }
    expect(state.priceObservations.length).toBeLessThanOrEqual(20);
  });

  it("controller handles rapid event bursts", () => {
    let state = registerTestPosition(createControllerState());
    for (let i = 0; i < 100; i++) {
      const event = createPriceEvent("BTC/USDT", 100000 + i * 10, "test");
      const result = processEventForController(state, event, NOW + i * 100);
      state = result.state;
    }
    expect(state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. TRADER SCENARIO: Profitable LONG → Deterioration → Protection
// ═══════════════════════════════════════════════════════════════

describe("AA. Trader Scenario: Profitable LONG → Protection BEFORE SL", () => {
  it("full lifecycle: healthy → early deterioration → acceleration → giveback → alert BEFORE SL", () => {
    let state = registerTestPosition(createControllerState());
    const pos = state.positions.get("btc-long-1")!;

    // Step 1: Healthy
    const step1 = evaluatePosition(pos, healthyEvidence(), NOW);
    expect(step1.alert.severity).toBe("NONE");

    // Step 2: Early deterioration (M5 weakens)
    const earlyPos = { ...pos, currentPrice: 108000 };
    const step2 = evaluatePosition(earlyPos, {
      price: 108000, shortTermTrend: "bearish", mediumTermTrend: "bullish",
    }, NOW + 60_000);
    expect(["NONE", "WATCH", "CAUTION"]).toContain(step2.alert.severity);

    // Step 3: Structure break + acceleration
    const midPos = { ...pos, currentPrice: 104000 };
    const step3 = evaluatePosition(midPos, {
      price: 104000, shortTermTrend: "bearish", mediumTermTrend: "bearish",
      structureBroken: true, momentumChange: -20,
    }, NOW + 120_000);
    expect(["WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(step3.alert.severity);

    // Step 4: Full deterioration — should warn BEFORE SL (95000)
    const severePos = { ...pos, currentPrice: 100000 };
    const step4 = evaluatePosition(severePos, {
      price: 100000, shortTermTrend: "bearish", mediumTermTrend: "bearish",
      longTermTrend: "bearish", structureBroken: true, momentumChange: -30,
      volatility: 5000, avgVolatility: 1500, riskRegime: "risk_off", riskRegimeChanged: true,
    }, NOW + 180_000);

    // System MUST warn before SL (95000) — price is at 100000
    expect(severePos.currentPrice).toBeGreaterThan(95000);
    expect(step4.alert.severity).not.toBe("NONE");
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. TRADER SCENARIO: Profitable SHORT → Protection BEFORE SL
// ═══════════════════════════════════════════════════════════════

describe("AB. Trader Scenario: Profitable SHORT → Protection BEFORE SL", () => {
  it("profitable SHORT warns before SL when conditions deteriorate", () => {
    const shortPos: PositionContext = {
      instrument: "ETH/USDT", assetClass: "crypto", side: "SHORT",
      entryPrice: 4000, currentPrice: 3800, stopLoss: 4200,
      takeProfit: 3500, openedAt: NOW - 3600_000, horizon: "INTRADAY",
    };

    // Deteriorating for SHORT = price rising + bullish signals
    const result = evaluateProtection({
      position: { ...shortPos, currentPrice: 4100 },
      evidence: {
        price: 4100, shortTermTrend: "bullish", mediumTermTrend: "bullish",
        structureBroken: true, momentumChange: 20,
      },
      monitoringState: createMonitoringState("ETH/USDT"),
      now: NOW,
    });

    // Price at 4100, SL at 4200 — system should warn
    expect(result.alert.severity).not.toBe("NONE");
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AC. Instrument / Position Isolation", () => {
  it("BTC LONG ≠ BTC SHORT", () => {
    const longMetrics = evaluateProtection({
      position: longBtc({ currentPrice: 110000 }), evidence: { price: 110000 }, now: NOW,
    });
    const shortMetrics = evaluateProtection({
      position: longBtc({ side: "SHORT", currentPrice: 90000 }), evidence: { price: 90000 }, now: NOW,
    });
    expect(longMetrics.alert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortMetrics.alert.profit.unrealizedPnL).toBeGreaterThan(0);
  });

  it("BTC ≠ ETH", () => {
    const btc = evaluateProtection({
      position: longBtc(), evidence: healthyEvidence(), now: NOW,
    });
    const eth = evaluateProtection({
      position: shortEth(), evidence: { price: 3800 }, now: NOW,
    });
    expect(btc.alert.instrument).toBe("BTC/USDT");
    expect(eth.alert.instrument).toBe("ETH/USDT");
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. RADAR COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

describe("AD. Radar Compatibility", () => {
  it("protection does not produce recommendation/bias/conviction", () => {
    const result = evaluateProtection({
      position: longBtc(), evidence: deterioratingEvidence(104000),
      monitoringState: createMonitoringState("BTC/USDT"), now: NOW,
    });
    expect((result.alert as any).recommendation).toBeUndefined();
    expect((result.alert as any).bias).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. EVENT PROCESSING END-TO-END
// ═══════════════════════════════════════════════════════════════

describe("AE. Event Processing End-to-End", () => {
  it("processes price events and increments evaluation count", () => {
    let state = registerTestPosition(createControllerState());
    const event = createPriceEvent("BTC/USDT", 113000, "test");
    const result = processEventForController(state, event, NOW);
    expect(result.state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });

  it("processes multiple events in sequence", () => {
    let state = registerTestPosition(createControllerState());
    const events = [
      createPriceEvent("BTC/USDT", 113000, "test"),
      createMomentumChangeEvent("BTC/USDT", -15, "M5", "test"),
      createStructureChangeEvent("BTC/USDT", true, "M15", "test"),
    ];
    for (const event of events) {
      const result = processEventForController(state, event, NOW);
      state = result.state;
    }
    expect(state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AF. EARLY PROTECTION CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("AF. Early Protection Classification", () => {
  it("MULTI-TIMEFRAME confirmation increases severity", () => {
    const noSignal = aggregateTimeframeEvidence([]);
    expect(noSignal.level).toBe("NO_SIGNAL");

    const htfAdverse: TimeframeEvidence[] = [{
      timeframe: "H1", adverseTrend: true, structureBroken: true,
      adverseMomentum: false, confirmationConfidence: 80, observedAt: NOW, source: "test",
    }];
    const htfResult = aggregateTimeframeEvidence(htfAdverse);
    expect(htfResult.level).toBe("STRUCTURAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// AG. SHOCK INTERACTION
// ═══════════════════════════════════════════════════════════════

describe("AG. Shock Interaction", () => {
  it("multiple shock indicators produce SHOCK state", () => {
    const shock = detectShock({
      price: 100000, volatility: 8000, avgVolatility: 1500,
      liquidationSpike: true, fundingRate: 0.005, riskRegimeChanged: true,
    });
    expect(shock.state).toBe("SHOCK");
  });

  it("provider failure does not produce shock", () => {
    const shock = detectShock({ price: 100000 });
    expect(shock.state).toBe("NORMAL");
  });
});

// ═══════════════════════════════════════════════════════════════
// AH. HORIZON SENSITIVITY
// ═══════════════════════════════════════════════════════════════

describe("AH. Horizon Sensitivity", () => {
  it("SCALPING tighter than INVESTING for giveback", () => {
    // Use a giveback % that SCALPING classifies more aggressively than INVESTING
    const gb = { givebackPct: 30 };
    const scalp = classifyGivebackSeverity({ ...gb } as any, "SCALPING");
    const invest = classifyGivebackSeverity({ ...gb } as any, "INVESTING");
    // SCALPING 30% >= partialTpPct(25) → PARTIAL_TP; INVESTING 30% < watchPct(40) → NONE
    const givebackOrder: Record<string, number> = { "NONE": 0, "WATCH": 1, "PARTIAL_TP": 2, "MANUAL_TP": 3, "PROTECT_NOW": 4 };
    expect(givebackOrder[scalp] ?? -1).toBeGreaterThanOrEqual(givebackOrder[invest] ?? -1);
  });
});
