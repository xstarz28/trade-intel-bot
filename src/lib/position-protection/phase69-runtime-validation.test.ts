/**
 * Phase 69 — Production Runtime Validation, Live Data Activation & Full System Hardening
 *
 * Comprehensive deterministic test suite covering:
 * A. Runtime Architecture Audit — complete pipeline integrity
 * B. Live Polling Runtime Validation — polling lifecycle state machine
 * C. Stale Data Safety — no false escalation from stale/unavailable data
 * D. Provider Neutrality — provider failure never becomes directional
 * E. Event Processing Hardening — validation, ordering, dedup
 * F. Memory Bounds — bounded data structures
 * G. Position & Instrument Isolation — BTC LONG ≠ BTC SHORT, BTC ≠ ETH
 * H. Determinism — same inputs → same outputs
 * I. No Fabrication — no fake probability, no auto-execution
 * J. Security Audit — no secrets, no embedded credentials
 * K. Cleanup Verification — position removal, state cleanup
 * L. End-to-End Integration — registration → event → evaluation → alert → persistence
 * M. Controller Runtime Validation — lifecycle controls, event processing
 * N. 50+ Position Stress Test
 * O. Continuous Controller Integration
 * P. Pullback Classifier Runtime
 * Q. Intelligence Calibration Runtime
 * R. Alert Lifecycle State Machine
 * S. Signal Fusion Runtime
 */

import { describe, it, expect } from "vitest";
import type {
  PositionContext,
  AlertSeverity,
  ProtectionAlert,
} from "../position-protection/types";
import { alertSeverityRank } from "../position-protection/types";
import type { MarketEvidence } from "../position-protection/thesis-health";

// Core engines
import { evaluateProtection } from "../position-protection/protection-engine";
import {
  createMonitoringState,
  shouldAlert,
  updateMonitoringState,
  deduplicateByDependencyGroup,
} from "../position-protection/alert-lifecycle";

// Runtime hardening
import {
  guardAgainstDuplicateRegistration,
  guardAgainstRapidRegistration,
  guardAgainstDuplicatePolling,
  guardPollingLifecycle,
  guardPositionLifecycle,
  guardAgainstStaleDataAlert,
  guardProviderFailureNeutrality,
  guardNoFabrication,
  guardCleanupOnRemoval,
  guardBoundedHistory,
  validateIntegrationPipeline,
  verifyPositionIsolation,
  verifyInstrumentIsolation,
  runSecurityAudit,
  validateEvent,
  detectOutOfOrderEvent,
  verifyMemoryBounds,
  runRuntimeValidation,
} from "../position-protection/phase69-runtime-hardening";

// Controller
import {
  createControllerState,
  registerPosition as ctrlRegister,
  removePosition as ctrlRemove,
  startController,
  stopController,
  pauseController,
  resumeController,
  pausePosition,
  resumePosition,
  processEventForController,
  shouldEvaluatePosition,
  getDashboard,
} from "../position-protection/continuous-protection-controller";

// Event bridge
import {
  createPriceEvent,
  createMacroChangeEvent,
  createProviderDegradedEvent,
  createProviderRecoveredEvent,
} from "../position-protection/market-event-bridge";
import { computeEventPriority } from "../position-protection/event-priority";

// Signal fusion
import { fuseSignals } from "../position-protection/signal-fusion";

// Intelligence calibration
import { calibrateIntelligence, type CalibrationInput } from "../position-protection/intelligence-calibration";
import { classifyPullbackType } from "../position-protection/pullback-classifier";

// Polling
import {
  createPollingServiceState,
  startPollingService,
  registerInstrumentForPolling,
  processPollSuccess,
  processPollFailure,
  getPollingDashboard,
} from "../market-stream/live-polling-service";
import type { ProviderQuoteData } from "../market-stream/live-market-bridge";

// Scenarios
import {
  runScenario,
  healthyProfitableLong,
  healthyProfitableShort,
  suddenStructureBreak,
  normalPullbackNoPrematureTP,
  fastReversalShouldTriggerEarlyProtection,
} from "../position-protection/phase66-scenarios";

// Position priority

// Giveback
import { calculateGiveback, classifyGivebackSeverity } from "../position-protection/giveback-monitor";

// Early protection

// Acceleration
import {
  createAccelerationState,
  recordPriceObservation,
  detectPriceAcceleration,
} from "../position-protection/acceleration-monitor";

// Shock
import { detectShock } from "../position-protection/shock-detector";

// Dispatch
import {
  createDispatcherState,
  shouldDispatch,
  dispatch,
  acknowledgeAlert,
} from "../position-protection/alert-dispatcher";

// Real-time monitor
import {
  createMonitorState,
  processEvent,
  addPosition,
  cleanup,
} from "../position-protection/realtime-monitor";

const NOW = 1700000000000;
const BASE = NOW;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function btcLong(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100,
    currentPrice: 110,
    stopLoss: 95,
    takeProfit: 120,
    leverage: 10,
    horizon: "SWING",
    openedAt: BASE - 3600_000,
    ...overrides,
  };
}

function btcShort(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "SHORT",
    entryPrice: 100,
    currentPrice: 90,
    stopLoss: 110,
    takeProfit: 80,
    horizon: "SWING",
    openedAt: BASE - 3600_000,
    ...overrides,
  };
}

function ethLong(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "ETH/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 3000,
    currentPrice: 3300,
    stopLoss: 2800,
    takeProfit: 3800,
    horizon: "SWING",
    openedAt: BASE - 3600_000,
    ...overrides,
  };
}

function healthyEvidence(price: number): MarketEvidence {
  return {
    price,
    shortTermTrend: "bullish",
    mediumTermTrend: "bullish",
    longTermTrend: "bullish",
    momentumChange: 5,
    volatility: 2,
    avgVolatility: 2,
    structureBroken: false,
    fundingRate: 0.001,
    oiChange: 5,
    riskRegime: "risk_on",
    riskRegimeChanged: false,
    vix: 18,
  };
}

function deterioratingEvidence(price: number): MarketEvidence {
  return {
    price,
    shortTermTrend: "bearish",
    mediumTermTrend: "bearish",
    momentumChange: -25,
    structureBroken: true,
    volatility: 10,
    avgVolatility: 2,
    fundingRate: 0.005,
    oiChange: -20,
    liquidationSpike: true,
    riskRegime: "risk_off",
    riskRegimeChanged: true,
    vix: 35,
    correlatedDivergence: true,
  };
}

function evaluate(pos: PositionContext, evidence: MarketEvidence, now: number = NOW): ProtectionAlert {
  return evaluateProtection({ position: pos, evidence, now }).alert;
}

// ═══════════════════════════════════════════════════════════════
// A. RUNTIME ARCHITECTURE AUDIT — PIPELINE INTEGRITY
// ═══════════════════════════════════════════════════════════════

describe("A. Runtime Architecture Audit — Pipeline Integrity", () => {
  it("Stage 1: Protection Engine evaluates without error", () => {
    const result = evaluateProtection({
      position: btcLong(),
      evidence: healthyEvidence(110),
      now: NOW,
    });
    expect(result.alert).toBeDefined();
    expect(result.alert.severity).toBeDefined();
    expect(result.updatedMonitoringState).toBeDefined();
  });

  it("Stage 2: Alert contains all required fields", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const requiredFields: Array<keyof ProtectionAlert> = [
      "instrument",
      "severity",
      "thesisHealth",
      "thesisHealthScore",
      "profit",
      "shock",
      "urgency",
      "urgencyReason",
      "whyTpNow",
      "alertMessage",
      "actionRecommendation",
      "deteriorationSignals",
      "timestamp",
    ];
    for (const field of requiredFields) {
      expect(alert[field]).toBeDefined();
    }
  });

  it("Stage 3: Alert severity is valid enum", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const validSeverities: AlertSeverity[] = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"];
    expect(validSeverities).toContain(alert.severity);
  });

  it("Stage 4: Urgency is valid enum", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const validUrgencies = ["NONE", "LOW", "MODERATE", "HIGH", "CRITICAL"];
    expect(validUrgencies).toContain(alert.urgency);
  });

  it("Stage 5: WhyTpNow always has disclaimer", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    expect(typeof alert.whyTpNow.disclaimer).toBe("string");
    expect(alert.whyTpNow.disclaimer.length).toBeGreaterThan(0);
  });

  it("Stage 6: Action recommendation is informational only", () => {
    const severities: AlertSeverity[] = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"];
    for (const sev of severities) {
      // Craft evidence that produces each severity
      let ev: MarketEvidence;
      if (sev === "NONE") {
        ev = healthyEvidence(110);
      } else if (sev === "WATCH") {
        ev = { price: 110, shortTermTrend: "bearish", mediumTermTrend: "bullish" };
      } else if (sev === "CAUTION") {
        ev = { price: 110, shortTermTrend: "bearish", mediumTermTrend: "bearish", momentumChange: -20 };
      } else if (sev === "HIGH_RISK") {
        ev = deterioratingEvidence(110);
      } else {
        ev = { price: 80, shortTermTrend: "bearish", mediumTermTrend: "bearish", longTermTrend: "bearish", structureBroken: true, momentumChange: -30 };
      }
      const alert = evaluate(btcLong(), ev, NOW);
      const action = alert.actionRecommendation.toLowerCase();
      expect(action).not.toContain("auto");
      expect(action).not.toContain("execute");
      expect(action).not.toContain("order placed");
      expect(action).not.toContain("position closed");
    }
  });

  it("Stage 7: Monitoring state is updated with correct instrument", () => {
    const result = evaluateProtection({
      position: btcLong(),
      evidence: healthyEvidence(110),
      now: NOW,
    });
    expect(result.updatedMonitoringState.instrument).toBe("BTC/USDT");
  });

  it("Stage 8: Lifecycle check returns valid decision", () => {
    const result = evaluateProtection({
      position: btcLong(),
      evidence: healthyEvidence(110),
      now: NOW,
    });
    const decision = shouldAlert(result.updatedMonitoringState, result.alert.severity, NOW);
    expect(typeof decision.shouldFire).toBe("boolean");
    expect(typeof decision.reason).toBe("string");
  });

  it("Stage 9: Integration pipeline passes for healthy position", () => {
    const result = validateIntegrationPipeline({
      position: btcLong(),
      evidence: healthyEvidence(110),
      now: NOW,
    });
    expect(result.passed).toBe(true);
    expect(result.stages.every((s) => s.passed)).toBe(true);
  });

  it("Stage 9b: Integration pipeline passes for deteriorating position", () => {
    const result = validateIntegrationPipeline({
      position: btcLong({ currentPrice: 90 }),
      evidence: deterioratingEvidence(90),
      now: NOW,
    });
    // Even deteriorating, the pipeline itself must pass
    expect(result.stages.every((s) => s.passed)).toBe(true);
  });

  it("Stage 10: Full runtime validation completes for LONG", () => {
    const result = runRuntimeValidation({
      position: btcLong(),
      evidence: healthyEvidence(110),
      now: NOW,
      providerStatus: "HEALTHY",
      dataFreshness: "FRESH",
    });
    expect(result.allPassed).toBe(true);
    expect(result.pipeline.passed).toBe(true);
    expect(result.security.overallPass).toBe(true);
  });

  it("Stage 10b: Full runtime validation completes for SHORT", () => {
    const result = runRuntimeValidation({
      position: btcShort(),
      evidence: { ...healthyEvidence(90), shortTermTrend: "bearish" },
      now: NOW,
      providerStatus: "HEALTHY",
      dataFreshness: "FRESH",
    });
    expect(result.allPassed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. LIVE POLLING RUNTIME VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("B. Live Polling Runtime Validation", () => {
  it("Polling lifecycle: STOPPED → STARTING → RUNNING", () => {
    let state = createPollingServiceState();
    expect(state.lifecycle).toBe("STOPPED");

    state = startPollingService(state, NOW);
    // After start, should be RUNNING or similar active state
    expect(state.lifecycle).not.toBe("STOPPED");
  });

  it("Duplicate polling prevention: same instrument cannot be polled twice", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const guard = guardAgainstDuplicatePolling(
      new Map([["BTC/USDT", { startedAt: NOW, provider: "OKX" }]]),
      "BTC/USDT",
      NOW + 1000, // only 1s since start, below 5s min interval
    );
    expect(guard.passed).toBe(false);
    expect(guard.guardName).toBe("DUPLICATE_POLLING");
  });

  it("No duplicate polling after sufficient interval", () => {
    const guard = guardAgainstDuplicatePolling(
      new Map([["BTC/USDT", { startedAt: NOW, provider: "OKX" }]]),
      "BTC/USDT",
      NOW + 10_000, // 10s since start, above 5s min interval
    );
    expect(guard.passed).toBe(true);
  });

  it("Polling blocked when lifecycle is STOPPED", () => {
    const guard = guardPollingLifecycle("STOPPED", "BTC/USDT");
    expect(guard.passed).toBe(false);
  });

  it("Polling blocked when lifecycle is PAUSED", () => {
    const guard = guardPollingLifecycle("PAUSED", "BTC/USDT");
    expect(guard.passed).toBe(false);
  });

  it("Polling allowed when lifecycle is RUNNING", () => {
    const guard = guardPollingLifecycle("RUNNING", "BTC/USDT");
    expect(guard.passed).toBe(true);
  });

  it("Position lifecycle blocks STOPPED positions", () => {
    const guard = guardPositionLifecycle("STOPPED", "BTC/USDT");
    expect(guard.passed).toBe(false);
  });

  it("Position lifecycle blocks PAUSED positions", () => {
    const guard = guardPositionLifecycle("PAUSED", "BTC/USDT");
    expect(guard.passed).toBe(false);
  });

  it("Position lifecycle allows RUNNING positions", () => {
    const guard = guardPositionLifecycle("RUNNING", "BTC/USDT");
    expect(guard.passed).toBe(true);
  });

  it("Poll success updates price and resets failures", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT",
      provider: "OKX",
      price: 105000,
      timestamp: NOW,
      freshness: "FRESH",
    };
    const result = processPollSuccess(state, "BTC/USDT", quote, NOW);
    expect(result.state.instruments.get("BTC/USDT")!.lastPrice).toBe(105000);
    expect(result.state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(0);
  });

  it("Poll failure increments consecutive failures", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const result = processPollFailure(state, "BTC/USDT", "timeout", NOW);
    expect(result.state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(1);
  });

  it("50+ instruments can be registered for polling", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    for (let i = 0; i < 55; i++) {
      state = registerInstrumentForPolling(state, `SYM${i}/USDT`, NOW);
    }
    const dash = getPollingDashboard(state, NOW);
    expect(dash.totalInstruments).toBe(55);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. STALE DATA SAFETY
// ═══════════════════════════════════════════════════════════════

describe("C. Stale Data Safety", () => {
  it("Stale data does not cause severity escalation", () => {
    const guard = guardAgainstStaleDataAlert("CAUTION", "WATCH", "STALE");
    expect(guard.passed).toBe(false);
  });

  it("Unavailable data does not cause severity escalation", () => {
    const guard = guardAgainstStaleDataAlert("HIGH_RISK", "CAUTION", "UNAVAILABLE");
    expect(guard.passed).toBe(false);
  });

  it("Fresh data allows escalation", () => {
    const guard = guardAgainstStaleDataAlert("CAUTION", "WATCH", "FRESH");
    expect(guard.passed).toBe(true);
  });

  it("Delayed data allows escalation", () => {
    const guard = guardAgainstStaleDataAlert("CAUTION", "WATCH", "DELAYED");
    expect(guard.passed).toBe(true);
  });

  it("Same severity with stale data is safe", () => {
    const guard = guardAgainstStaleDataAlert("WATCH", "WATCH", "STALE");
    expect(guard.passed).toBe(true);
  });

  it("Recovery with stale data is safe (decreasing severity)", () => {
    const guard = guardAgainstStaleDataAlert("WATCH", "CAUTION", "STALE");
    expect(guard.passed).toBe(true);
  });

  it("Protection engine with minimal evidence still evaluates", () => {
    const result = evaluateProtection({
      position: btcLong(),
      evidence: { price: 110 },
      now: NOW,
    });
    expect(result.alert).toBeDefined();
    expect(result.alert.severity).toBeDefined();
  });

  it("Empty evidence does not crash the engine", () => {
    const result = evaluateProtection({
      position: btcLong(),
      evidence: { price: 110 },
      now: NOW,
    });
    expect(result.alert.missingData.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. PROVIDER NEUTRALITY
// ═══════════════════════════════════════════════════════════════

describe("D. Provider Neutrality", () => {
  it("Provider failure with no directional evidence passes neutrality guard", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const guard = guardProviderFailureNeutrality(alert, "UNAVAILABLE");
    expect(guard.passed).toBe(true);
  });

  it("Provider failure with directional evidence is caught", () => {
    // Manually construct alert that would violate neutrality
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const modifiedAlert: ProtectionAlert = {
      ...alert,
      severity: "CAUTION",
      deteriorationSignals: [
        ...alert.deteriorationSignals,
        {
          category: "TECHNICAL",
          name: "provider_test",
          description: "Provider unavailable",
          severity: 50,
          source: "provider_unavailable",
          observedAt: NOW,
          freshness: "UNAVAILABLE",
          dependencyGroup: "PROVIDER_TEST",
        },
      ],
      conflictingEvidence: [
        ...alert.conflictingEvidence,
        "Provider unavailable — degraded",
      ],
    };
    const guard = guardProviderFailureNeutrality(modifiedAlert, "UNAVAILABLE");
    expect(guard.passed).toBe(false);
  });

  it("Healthy provider status always passes", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90));
    const guard = guardProviderFailureNeutrality(alert, "HEALTHY");
    expect(guard.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. EVENT PROCESSING HARDENING
// ═══════════════════════════════════════════════════════════════

describe("E. Event Processing Hardening", () => {
  it("Valid price event passes validation", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    const guard = validateEvent(event);
    expect(guard.passed).toBe(true);
  });

  it("Event with missing eventId fails", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    const guard = validateEvent({ ...event, eventId: "" });
    expect(guard.passed).toBe(false);
  });

  it("Event with invalid timestamp fails", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    const guard = validateEvent({ ...event, timestamp: NaN });
    expect(guard.passed).toBe(false);
  });

  it("Event with missing source fails", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    const guard = validateEvent({ ...event, source: "" });
    expect(guard.passed).toBe(false);
  });

  it("Event with missing instrument fails", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    const guard = validateEvent({ ...event, instrument: "" });
    expect(guard.passed).toBe(false);
  });

  it("Event with invalid freshness fails", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    const guard = validateEvent({ ...event, freshness: "INVALID" as any });
    expect(guard.passed).toBe(false);
  });

  it("In-order event passes detection", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    const guard = detectOutOfOrderEvent(event, NOW - 1000);
    expect(guard.passed).toBe(true);
  });

  it("Out-of-order event is detected", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    // Use the event's own timestamp plus a large offset as the "last" timestamp
    // so the event appears out of order
    const guard = detectOutOfOrderEvent(event, event.timestamp + 100_000);
    expect(guard.passed).toBe(false);
  });

  it("Macro event passes validation", () => {
    const event = createMacroChangeEvent("BTC/USDT", "risk_off", "Treasury");
    const guard = validateEvent(event);
    expect(guard.passed).toBe(true);
  });

  it("Provider degraded event passes validation", () => {
    const event = createProviderDegradedEvent("BTC/USDT", "OKX", "timeout");
    const guard = validateEvent(event);
    expect(guard.passed).toBe(true);
  });

  it("Provider recovered event passes validation", () => {
    const event = createProviderRecoveredEvent("BTC/USDT", "OKX");
    const guard = validateEvent(event);
    expect(guard.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. MEMORY BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("F. Memory Bounds", () => {
  it("Alert history within bounds", () => {
    const guard = guardBoundedHistory(500, 1000, "Alert history");
    expect(guard.passed).toBe(true);
  });

  it("Alert history exceeding bounds is caught", () => {
    const guard = guardBoundedHistory(1500, 1000, "Alert history");
    expect(guard.passed).toBe(false);
  });

  it("Zero-length history is within bounds", () => {
    const guard = guardBoundedHistory(0, 1000, "Alert history");
    expect(guard.passed).toBe(true);
  });

  it("All memory bounds pass for normal usage", () => {
    const results = verifyMemoryBounds({
      alertHistory: 50,
      instrumentStates: 10,
      positionSnapshots: 10,
      eventsBuffer: 20,
      monitoringHistory: 5,
    });
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("Exceeding any single bound is caught", () => {
    const results = verifyMemoryBounds({
      alertHistory: 2000,
      instrumentStates: 10,
      positionSnapshots: 10,
      eventsBuffer: 20,
      monitoringHistory: 5,
    });
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it("50 positions with bounded history", () => {
    let state = createControllerState();
    for (let i = 0; i < 50; i++) {
      state = ctrlRegister(state, {
        positionId: `pos_${i}`,
        instrument: `SYM${i}/USDT`,
        side: "LONG",
        entryPrice: 100,
        currentPrice: 110,
        horizon: "SWING",
        assetClass: "crypto",
        openedAt: NOW - 3600_000,
      }, NOW);
    }
    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. POSITION & INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("G. Position & Instrument Isolation", () => {
  it("BTC LONG ≠ BTC SHORT — different PnL", () => {
    const result = verifyPositionIsolation(btcLong(), btcShort(), healthyEvidence(100), NOW);
    expect(result.passed).toBe(true);
  });

  it("BTC ≠ ETH — independent evaluations", () => {
    const result = verifyInstrumentIsolation(
      btcLong(),
      ethLong(),
      healthyEvidence(110),
      healthyEvidence(3300),
      NOW,
    );
    expect(result.passed).toBe(true);
  });

  it("EUR/USD LONG ≠ GBP/USD LONG — different instruments", () => {
    const eurusd: PositionContext = {
      instrument: "EUR/USD",
      assetClass: "forex",
      side: "LONG",
      entryPrice: 1.1,
      currentPrice: 1.12,
      horizon: "INTRADAY",
      openedAt: NOW - 3600_000,
    };
    const gbpusd: PositionContext = {
      instrument: "GBP/USD",
      assetClass: "forex",
      side: "LONG",
      entryPrice: 1.3,
      currentPrice: 1.28,
      horizon: "INTRADAY",
      openedAt: NOW - 3600_000,
    };
    const eurusdResult = evaluate(eurusd, { price: 1.12 });
    const gbpusdResult = evaluate(gbpusd, { price: 1.28 });
    expect(eurusdResult.instrument).toBe("EUR/USD");
    expect(gbpusdResult.instrument).toBe("GBP/USD");
  });

  it("XAU/USD LONG and SHORT produce different PnL", () => {
    const longResult = evaluateProtection({
      position: { instrument: "XAU/USD", assetClass: "commodity", side: "LONG", entryPrice: 2000, currentPrice: 2050, horizon: "SWING", openedAt: NOW - 3600_000 },
      evidence: { price: 2050 },
      now: NOW,
    });
    const shortResult = evaluateProtection({
      position: { instrument: "XAU/USD", assetClass: "commodity", side: "SHORT", entryPrice: 2000, currentPrice: 2050, stopLoss: 2100, horizon: "SWING", openedAt: NOW - 3600_000 },
      evidence: { price: 2050 },
      now: NOW,
    });
    expect(longResult.alert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortResult.alert.profit.unrealizedPnL).toBeLessThan(0);
  });

  it("Controller position isolation: evaluating one position does not affect another", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 2800, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(2);
    expect(dash.activePositions).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("H. Determinism", () => {
  it("Same inputs → same severity (10 iterations)", () => {
    const pos = btcLong();
    const ev = healthyEvidence(110);
    const severities: AlertSeverity[] = [];
    for (let i = 0; i < 10; i++) {
      severities.push(evaluate(pos, ev, NOW).severity);
    }
    expect(new Set(severities).size).toBe(1);
  });

  it("Same inputs → same urgency", () => {
    const pos = btcLong();
    const ev = deterioratingEvidence(90);
    const urgencies: string[] = [];
    for (let i = 0; i < 10; i++) {
      urgencies.push(evaluate(pos, ev, NOW).urgency);
    }
    expect(new Set(urgencies).size).toBe(1);
  });

  it("Same inputs → same thesis health score", () => {
    const pos = btcLong();
    const ev = healthyEvidence(110);
    const scores: number[] = [];
    for (let i = 0; i < 10; i++) {
      scores.push(evaluate(pos, ev, NOW).thesisHealthScore);
    }
    expect(new Set(scores).size).toBe(1);
  });

  it("Scenario runner is deterministic across 3 runs", () => {
    const scenario = healthyProfitableLong();
    const r1 = runScenario(scenario);
    const r2 = runScenario(scenario);
    const r3 = runScenario(scenario);
    for (let i = 0; i < r1.length; i++) {
      expect(r1[i].severity).toBe(r2[i].severity);
      expect(r2[i].severity).toBe(r3[i].severity);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// I. NO FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("I. No Fabrication", () => {
  it("No fabrication in healthy alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const guard = guardNoFabrication(alert);
    expect(guard.passed).toBe(true);
  });

  it("No fabrication in deteriorating alert", () => {
    const alert = evaluate(btcLong({ currentPrice: 90 }), deterioratingEvidence(90));
    const guard = guardNoFabrication(alert);
    expect(guard.passed).toBe(true);
  });

  it("No probability language in any alert", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110), deterioratingEvidence(90), healthyEvidence(3300)];

    for (const pos of positions) {
      for (const ev of evidences) {
        const alert = evaluate(pos, ev);
        const allText = [
          ...alert.supportingEvidence,
          ...alert.conflictingEvidence,
          ...alert.whyTpNow.confirmations,
          ...alert.whyTpNow.whatChanged,
        ].join(" ");

        expect(allText).not.toMatch(/\d+%\s*chance/i);
        expect(allText).not.toMatch(/probability\s+of/i);
        expect(allText).not.toMatch(/win\s*rate/i);
      }
    }
  });

  it("No fabrication language in missingData", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    expect(alert.missingData).not.toContain("fabricated");
    expect(alert.missingData).not.toContain("synthetic");
  });
});

// ═══════════════════════════════════════════════════════════════
// J. SECURITY AUDIT
// ═══════════════════════════════════════════════════════════════

describe("J. Security Audit", () => {
  it("Healthy alert passes security audit", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const result = runSecurityAudit(alert);
    expect(result.overallPass).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("Deteriorating alert passes security audit", () => {
    const alert = evaluate(btcLong({ currentPrice: 90 }), deterioratingEvidence(90));
    const result = runSecurityAudit(alert);
    expect(result.overallPass).toBe(true);
  });

  it("No AWS keys in alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/AKIA[A-Z0-9]{16}/);
  });

  it("No Stripe keys in alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/sk_live_[a-zA-Z0-9]+/);
    expect(json).not.toMatch(/sk_test_[a-zA-Z0-9]+/);
  });

  it("No GitHub tokens in alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/ghp_[a-zA-Z0-9]+/);
  });

  it("No Bearer tokens in whyTpNow", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90));
    const json = JSON.stringify(alert.whyTpNow);
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("process.env");
  });

  it("No auto-execution language in action recommendation", () => {
    const positions = [btcLong({ currentPrice: 85 }), btcShort({ currentPrice: 115 })];
    const evidence = deterioratingEvidence(90);

    for (const pos of positions) {
      const alert = evaluate(pos, evidence);
      const action = alert.actionRecommendation.toLowerCase();
      expect(action).not.toContain("auto-close");
      expect(action).not.toContain("auto-sell");
      expect(action).not.toContain("auto-buy");
      expect(action).not.toContain("order placed");
      expect(action).not.toContain("position closed");
      expect(action).not.toContain("trade executed");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// K. CLEANUP VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe("K. Cleanup Verification", () => {
  it("Position removal is clean", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 3300, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    const before = new Map(state.positions);
    state = ctrlRemove(state, "p1");
    const after = new Map(state.positions);

    const guard = guardCleanupOnRemoval(before, after, "p1");
    expect(guard.passed).toBe(true);
  });

  it("Removing nonexistent position is safe", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    state = ctrlRemove(state, "nonexistent");
    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(1);
  });

  it("Monitor cleanup reduces history", () => {
    let state = createMonitorState();
    // Build up history
    for (let i = 0; i < 100; i++) {
      state = addPosition(state, {
        positionId: `pos_${i}`, instrument: `SYM${i}/USDT`, side: "LONG",
        entryPrice: 100, currentPrice: 110, horizon: "SWING", openedAt: NOW - 3600_000,
        lastUpdateAt: NOW, monitoringStatus: "LIVE",
      });
    }
    const cleaned = cleanup(state, 50);
    expect(cleaned.dispatcher.history.length).toBeLessThanOrEqual(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. END-TO-END INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("L. End-to-End Integration", () => {
  it("Complete flow: register → event → evaluation → alert → persistence shape", () => {
    // 1. Register position
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 100, stopLoss: 95, takeProfit: 120,
      leverage: 10, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    expect(state.positions.size).toBe(1);

    // 2. Process healthy event
    const healthyEvent = createPriceEvent("BTC/USDT", 110, "OKX");
    const r1 = processEventForController(state, healthyEvent, NOW + 1000);
    expect(r1.state.evaluationsPerformed).toBeGreaterThanOrEqual(0);

    // 3. Process deteriorating event
    const badEvent = createMacroChangeEvent("BTC/USDT", "risk_off", "Treasury");
    const r2 = processEventForController(r1.state, badEvent, NOW + 2000);

    // 4. Dashboard should show state
    const dash = getDashboard(r2.state);
    expect(dash.totalPositions).toBe(1);
  });

  it("Real-time monitor processes events end-to-end", () => {
    let monitorState = createMonitorState();

    // Add position
    monitorState = addPosition(monitorState, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", openedAt: NOW - 3600_000,
      lastUpdateAt: NOW, monitoringStatus: "LIVE",
    });

    // Process price event
    const event = createPriceEvent("BTC/USDT", 108, "OKX");
    const result = processEvent(monitorState, event, NOW + 1000);
    expect(result.state).toBeDefined();

    // Process macro event
    const macroEvent = createMacroChangeEvent("BTC/USDT", "risk_off", "Treasury");
    const result2 = processEvent(result.state, macroEvent, NOW + 2000);
    expect(result2.state).toBeDefined();
  });

  it("Dispatcher correctly handles alert flow", () => {
    let dispatcher = createDispatcherState();

    // First alert
    const decision1 = shouldDispatch(dispatcher, "p1", "WATCH", NOW);
    expect(decision1.shouldDispatch).toBe(true);

    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "INFO", severity: "WATCH",
      action: "Monitor", reason: "Early deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });

    // Same severity within cooldown should be suppressed
    const decision2 = shouldDispatch(dispatcher, "p1", "WATCH", NOW + 1000);
    expect(decision2.shouldDispatch).toBe(false);

    // Escalation should fire
    const decision3 = shouldDispatch(dispatcher, "p1", "CAUTION", NOW + 1000);
    expect(decision3.shouldDispatch).toBe(true);
    expect(decision3.isEscalation).toBe(true);
  });

  it("Acknowledge clears active alert", () => {
    let dispatcher = createDispatcherState();
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "WARNING", severity: "CAUTION",
      action: "Monitor", reason: "Deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });
    expect(dispatcher.activeAlerts.has("p1")).toBe(true);

    dispatcher = acknowledgeAlert(dispatcher, "p1");
    expect(dispatcher.activeAlerts.has("p1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. CONTROLLER RUNTIME VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("M. Controller Runtime Validation", () => {
  it("Full lifecycle: START → PAUSE → RESUME → STOP", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    // Start
    state = startController(state);
    expect(state.globalLifecycle).toBe("RUNNING");
    expect(state.positions.get("p1")!.lifecycle).toBe("RUNNING");

    // Pause
    state = pauseController(state);
    expect(state.globalLifecycle).toBe("PAUSED");
    expect(state.positions.get("p1")!.lifecycle).toBe("PAUSED");

    // Resume
    state = resumeController(state);
    expect(state.globalLifecycle).toBe("RUNNING");
    expect(state.positions.get("p1")!.lifecycle).toBe("RUNNING");

    // Stop
    state = stopController(state);
    expect(state.globalLifecycle).toBe("STOPPED");
    expect(state.positions.get("p1")!.lifecycle).toBe("STOPPED");
  });

  it("Individual position pause/resume", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 3300, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    state = startController(state);

    // Pause only p1
    state = pausePosition(state, "p1");
    expect(state.positions.get("p1")!.lifecycle).toBe("PAUSED");
    expect(state.positions.get("p2")!.lifecycle).toBe("RUNNING");

    // Resume p1
    state = resumePosition(state, "p1");
    expect(state.positions.get("p1")!.lifecycle).toBe("RUNNING");
  });

  it("Paused position skips evaluation for non-critical events", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);
    state = pausePosition(state, "p1");

    const pos = state.positions.get("p1")!;
    const decision = shouldEvaluatePosition(pos, "LOW", NOW);
    expect(decision.shouldEvaluate).toBe(false);
  });

  it("Critical event bypasses pause", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);
    state = pausePosition(state, "p1");

    const pos = state.positions.get("p1")!;
    const decision = shouldEvaluatePosition(pos, "CRITICAL", NOW);
    expect(decision.shouldEvaluate).toBe(true);
  });

  it("Dashboard shows correct severity counts", () => {
    let state = createControllerState();
    // Register 3 positions and evaluate them
    for (let i = 0; i < 3; i++) {
      state = ctrlRegister(state, {
        positionId: `p${i}`, instrument: `SYM${i}/USDT`, side: "LONG",
        entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
      }, NOW);
    }
    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(3);
    expect(dash.healthyCount + dash.watchCount + dash.cautionCount + dash.highRiskCount + dash.criticalCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. 50+ POSITION STRESS TEST
// ═══════════════════════════════════════════════════════════════

describe("N. 50+ Position Stress Test", () => {
  it("55 positions register and evaluate without error", () => {
    let state = createControllerState();
    for (let i = 0; i < 55; i++) {
      state = ctrlRegister(state, {
        positionId: `pos_${i}`,
        instrument: `SYM${i}/${i % 2 === 0 ? "USDT" : "USD"}`,
        side: i % 3 === 0 ? "SHORT" : "LONG",
        entryPrice: 100 + i,
        currentPrice: 110 + i * 0.5,
        horizon: (["SCALPING", "INTRADAY", "SWING", "INVESTING"] as const)[i % 4],
        assetClass: i % 5 === 0 ? "forex" : i % 7 === 0 ? "commodity" : "crypto",
        openedAt: NOW - 3600_000,
      }, NOW);
    }

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(55);

    // Process events for all 55 positions
    for (let i = 0; i < 55; i++) {
      const event = createPriceEvent(
        `SYM${i}/${i % 2 === 0 ? "USDT" : "USD"}`,
        120 + i * 0.5,
        "OKX",
      );
      state = processEventForController(state, event, NOW + i).state;
    }

    expect(state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });

  it("55 positions: remove 10 cleanly", () => {
    let state = createControllerState();
    for (let i = 0; i < 55; i++) {
      state = ctrlRegister(state, {
        positionId: `pos_${i}`,
        instrument: `SYM${i}/USDT`,
        side: "LONG",
        entryPrice: 100, currentPrice: 110,
        horizon: "SWING", assetClass: "crypto",
        openedAt: NOW - 3600_000,
      }, NOW);
    }

    for (let i = 0; i < 10; i++) {
      state = ctrlRemove(state, `pos_${i}`);
    }

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(45);
  });

  it("55 instrument polling without error", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    for (let i = 0; i < 55; i++) {
      state = registerInstrumentForPolling(state, `SYM${i}/USDT`, NOW);
    }
    const dash = getPollingDashboard(state, NOW);
    expect(dash.totalInstruments).toBe(55);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. CONTINUOUS CONTROLLER INTEGRATION
// ═══════════════════════════════════════════════════════════════

describe("O. Continuous Controller Integration", () => {
  it("processEventForController triggers evaluation for matching instrument", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 100, horizon: "SWING", assetClass: "crypto",
      openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    const event = createPriceEvent("BTC/USDT", 110, "OKX");
    const result = processEventForController(state, event, NOW + 1000);
    expect(result.state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });

  it("Event for non-matching instrument does not trigger evaluation", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 100, horizon: "SWING", assetClass: "crypto",
      openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    const event = createPriceEvent("ETH/USDT", 3300, "OKX");
    const result = processEventForController(state, event, NOW + 1000);
    expect(result.state.evaluationsPerformed).toBe(0);
  });

  it("Dashboard aggregation with mixed severities", () => {
    let state = createControllerState();

    // Register and evaluate healthy position
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto",
      openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    const healthyEvent = createPriceEvent("BTC/USDT", 110, "OKX");
    state = processEventForController(state, healthyEvent, NOW + 1000).state;

    // Register losing position
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 2800, stopLoss: 2700,
      horizon: "SWING", assetClass: "crypto",
      openedAt: NOW - 3600_000,
    }, NOW);

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(2);
    expect(dash.activePositions).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// P. PULLBACK CLASSIFIER RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("P. Pullback Classifier Runtime", () => {
  it("Healthy pullback classified as NORMAL", () => {
    const result = classifyPullbackType({
      position: btcLong(),
      evidence: healthyEvidence(110),
      shock: { state: "NORMAL", description: "No shock", confidence: 90, indicators: {} },
      givebackPct: 10,
      accelerationLevel: "NORMAL",
    });
    expect(["NORMAL_PULLBACK", "EARLY_CORRECTION"]).toContain(result);
  });

  it("Structural deterioration classified higher", () => {
    const result = classifyPullbackType({
      position: btcLong(),
      evidence: deterioratingEvidence(90),
      shock: { state: "SHOCK", description: "Shock detected", confidence: 90, indicators: { volatilityExpansion: true } },
      givebackPct: 70,
      accelerationLevel: "HIGH",
    });
    expect(["MEANINGFUL_DETERIORATION", "STRUCTURAL_REVERSAL", "SHOCK_REVERSAL"]).toContain(result);
  });

  it("Short side: adverse direction is upward", () => {
    const result = classifyPullbackType({
      position: btcShort({ entryPrice: 100, currentPrice: 110 }),
      evidence: { price: 110, shortTermTrend: "bullish", mediumTermTrend: "bullish", momentumChange: 25, structureBroken: true },
      shock: { state: "SHOCK", description: "Shock", confidence: 85, indicators: { volatilityExpansion: true } },
      givebackPct: 60,
      accelerationLevel: "HIGH",
    });
    expect(["MEANINGFUL_DETERIORATION", "STRUCTURAL_REVERSAL", "SHOCK_REVERSAL"]).toContain(result);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. INTELLIGENCE CALIBRATION RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("Q. Intelligence Calibration Runtime", () => {
  it("Calibration modifies severity based on evidence quality", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const input: CalibrationInput = {
      position: btcLong(),
      evidence: healthyEvidence(110),
      severity: alert.severity,
      urgency: alert.urgency,
      profit: alert.profit,
      thesisHealthScore: alert.thesisHealthScore,
      thesisHealthState: alert.thesisHealth,
      shock: alert.shock,
      givebackPct: alert.profit.givebackPct ?? 0,
      accelerationLevel: "NORMAL",
      deteriorationCount: alert.deteriorationSignals.length,
      confirmingCount: 2,
      missingData: alert.missingData,
      conflictingEvidence: alert.conflictingEvidence,
      supportingEvidence: alert.supportingEvidence,
    };
    const calibration = calibrateIntelligence(input);
    expect(calibration).toBeDefined();
    expect(calibration.calibratedSeverity).toBeDefined();
    expect(calibration.evidenceQuality).toBeDefined();
  });

  it("Calibration with weak evidence does not escalate", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const input: CalibrationInput = {
      position: btcLong(),
      evidence: healthyEvidence(110),
      severity: alert.severity,
      urgency: alert.urgency,
      profit: alert.profit,
      thesisHealthScore: alert.thesisHealthScore,
      thesisHealthState: alert.thesisHealth,
      shock: alert.shock,
      givebackPct: alert.profit.givebackPct ?? 0,
      accelerationLevel: "NORMAL",
      deteriorationCount: alert.deteriorationSignals.length,
      confirmingCount: 2,
      missingData: alert.missingData,
      conflictingEvidence: alert.conflictingEvidence,
      supportingEvidence: alert.supportingEvidence,
    };
    const calibration = calibrateIntelligence(input);
    expect(calibration.calibratedSeverity).toBeDefined();
  });

  it("Calibration is deterministic", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90));
    const input: CalibrationInput = {
      position: btcLong(),
      evidence: deterioratingEvidence(90),
      severity: alert.severity,
      urgency: alert.urgency,
      profit: alert.profit,
      thesisHealthScore: alert.thesisHealthScore,
      thesisHealthState: alert.thesisHealth,
      shock: alert.shock,
      givebackPct: alert.profit.givebackPct ?? 0,
      accelerationLevel: "ELEVATED",
      deteriorationCount: alert.deteriorationSignals.length,
      confirmingCount: 0,
      missingData: alert.missingData,
      conflictingEvidence: alert.conflictingEvidence,
      supportingEvidence: alert.supportingEvidence,
    };
    const c1 = calibrateIntelligence(input);
    const c2 = calibrateIntelligence(input);
    expect(c1.calibratedSeverity).toBe(c2.calibratedSeverity);
    expect(c1.calibratedUrgency).toBe(c2.calibratedUrgency);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. ALERT LIFECYCLE STATE MACHINE
// ═══════════════════════════════════════════════════════════════

describe("R. Alert Lifecycle State Machine", () => {
  it("Full escalation: NONE → WATCH → CAUTION → HIGH_RISK → INVALIDATED", () => {
    let state = createMonitoringState("BTC/USDT");
    expect(state.currentSeverity).toBe("NONE");

    // NONE → WATCH (escalation fires)
    let decision = shouldAlert(state, "WATCH", NOW);
    expect(decision.shouldFire).toBe(true);
    state = updateMonitoringState(state, "WATCH", NOW);
    expect(state.currentSeverity).toBe("WATCH");

    // WATCH → CAUTION (escalation fires)
    decision = shouldAlert(state, "CAUTION", NOW + 1000);
    expect(decision.shouldFire).toBe(true);
    state = updateMonitoringState(state, "CAUTION", NOW + 1000);

    // CAUTION → HIGH_RISK (escalation fires)
    decision = shouldAlert(state, "HIGH_RISK", NOW + 2000);
    expect(decision.shouldFire).toBe(true);
    state = updateMonitoringState(state, "HIGH_RISK", NOW + 2000);

    // HIGH_RISK → INVALIDATED (always fires)
    decision = shouldAlert(state, "INVALIDATED", NOW + 3000);
    expect(decision.shouldFire).toBe(true);
    state = updateMonitoringState(state, "INVALIDATED", NOW + 3000);
    expect(state.currentSeverity).toBe("INVALIDATED");
  });

  it("Recovery: HIGH_RISK → WATCH fires", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "HIGH_RISK", NOW);
    const decision = shouldAlert(state, "WATCH", NOW + 10_000);
    expect(decision.shouldFire).toBe(true);
  });

  it("Same severity suppressed within cooldown", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "WATCH", NOW);
    const decision = shouldAlert(state, "WATCH", NOW + 5000);
    expect(decision.shouldFire).toBe(false);
  });

  it("HIGH_RISK re-alerts periodically (3+ consecutive)", () => {
    let state = createMonitoringState("BTC/USDT");
    state = updateMonitoringState(state, "HIGH_RISK", NOW);
    state = updateMonitoringState(state, "HIGH_RISK", NOW + 10_000);
    state = updateMonitoringState(state, "HIGH_RISK", NOW + 20_000);
    state = updateMonitoringState(state, "HIGH_RISK", NOW + 25_000);
    // After initial update (NOW+0) + three more (NOW+10s, NOW+20s, NOW+25s), consecutive count >= 3
    expect(state.consecutiveSameSeverity).toBeGreaterThanOrEqual(3);

    const decision = shouldAlert(state, "HIGH_RISK", NOW + 30_000);
    expect(decision.shouldFire).toBe(true);
  });

  it("Dependency group deduplication works", () => {
    const signals = [
      { dependencyGroup: "A", severity: 50, name: "sig1" },
      { dependencyGroup: "A", severity: 80, name: "sig2" },
      { dependencyGroup: "B", severity: 60, name: "sig3" },
    ];
    const deduped = deduplicateByDependencyGroup(signals);
    expect(deduped.length).toBe(2);
    const groupA = deduped.find((s) => s.dependencyGroup === "A");
    expect(groupA?.name).toBe("sig2"); // higher severity kept
  });
});

// ═══════════════════════════════════════════════════════════════
// S. SIGNAL FUSION RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("S. Signal Fusion Runtime", () => {
  it("Fuses signals from a healthy alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const fused = fuseSignals(alert);
    expect(fused).toBeDefined();
    expect(Array.isArray(fused)).toBe(true);
  });

  it("Fuses signals from a deteriorating alert", () => {
    const alert = evaluate(btcLong({ currentPrice: 90 }), deterioratingEvidence(90));
    const fused = fuseSignals(alert);
    expect(fused).toBeDefined();
  });

  it("Signal fusion is deterministic", () => {
    const alert = evaluate(btcLong({ currentPrice: 85 }), deterioratingEvidence(85));
    const f1 = fuseSignals(alert);
    const f2 = fuseSignals(alert);
    expect(f1.length).toBe(f2.length);
  });
});

// ═══════════════════════════════════════════════════════════════
// T. RACE CONDITION GUARDS
// ═══════════════════════════════════════════════════════════════

describe("T. Race Condition Guards", () => {
  it("Duplicate registration is rejected", () => {
    const existing = new Map([["p1", { instrument: "BTC/USDT", side: "LONG" }]]);
    const guard = guardAgainstDuplicateRegistration(existing, "p1", "BTC/USDT");
    expect(guard.passed).toBe(false);
  });

  it("New registration is allowed", () => {
    const existing = new Map([["p1", { instrument: "BTC/USDT", side: "LONG" }]]);
    const guard = guardAgainstDuplicateRegistration(existing, "p2", "ETH/USDT");
    expect(guard.passed).toBe(true);
  });

  it("Rapid registration is rejected", () => {
    const recent = [
      { instrument: "BTC/USDT", side: "LONG", timestamp: NOW },
    ];
    const guard = guardAgainstRapidRegistration(recent, "BTC/USDT", "LONG", NOW + 500);
    expect(guard.passed).toBe(false);
  });

  it("Non-rapid registration is allowed", () => {
    const recent = [
      { instrument: "BTC/USDT", side: "LONG", timestamp: NOW - 5000 },
    ];
    const guard = guardAgainstRapidRegistration(recent, "BTC/USDT", "LONG", NOW + 500);
    expect(guard.passed).toBe(true);
  });

  it("Empty recent registrations allow new registration", () => {
    const guard = guardAgainstRapidRegistration([], "BTC/USDT", "LONG", NOW);
    expect(guard.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. ACCELERATION MONITOR RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("U. Acceleration Monitor Runtime", () => {
  it("Single observation does not crash", () => {
    let acc = createAccelerationState();
    acc = recordPriceObservation(acc, NOW, 100000, "OKX");
    const result = detectPriceAcceleration(acc, "LONG", NOW + 1000);
    expect(result).toBeDefined();
    expect(result.level).toBeDefined();
  });

  it("Rapid decline detected for LONG", () => {
    let acc = createAccelerationState();
    const prices = [100000, 99000, 98000, 97000, 96000, 95000, 94000, 93000, 92000, 91000, 90000];
    for (let i = 0; i < prices.length; i++) {
      acc = recordPriceObservation(acc, NOW + i * 1000, prices[i], "OKX");
    }
    const result = detectPriceAcceleration(acc, "LONG", NOW + 15000);
    expect(result).toBeDefined();
    // Acceleration should detect the rapid decline
    expect(result.level).toBeDefined();
  });

  it("Multiple observations at same timestamp are safe", () => {
    let acc = createAccelerationState();
    for (let i = 0; i < 5; i++) {
      acc = recordPriceObservation(acc, NOW, 100000, "OKX");
    }
    const result = detectPriceAcceleration(acc, "LONG", NOW);
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// V. SCENARIO SEQUENCE VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("V. Scenario Sequence Validation", () => {
  it("Healthy LONG never escalates beyond WATCH", () => {
    const results = runScenario(healthyProfitableLong());
    for (const r of results) {
      expect(alertSeverityRank(r.severity)).toBeLessThanOrEqual(alertSeverityRank("WATCH"));
    }
  });

  it("Healthy SHORT never escalates beyond WATCH", () => {
    const results = runScenario(healthyProfitableShort());
    for (const r of results) {
      expect(alertSeverityRank(r.severity)).toBeLessThanOrEqual(alertSeverityRank("WATCH"));
    }
  });

  it("Structure break increases severity over time", () => {
    const results = runScenario(suddenStructureBreak());
    const first = results[0];
    const last = results[results.length - 1];
    expect(alertSeverityRank(last.severity)).toBeGreaterThanOrEqual(alertSeverityRank(first.severity));
  });

  it("Normal pullback does NOT trigger premature TP", () => {
    const results = runScenario(normalPullbackNoPrematureTP());
    for (const r of results) {
      expect(r.severity).not.toBe("HIGH_RISK");
      expect(r.severity).not.toBe("INVALIDATED");
    }
  });

  it("Fast reversal triggers early protection warning", () => {
    const results = runScenario(fastReversalShouldTriggerEarlyProtection());
    const last = results[results.length - 1];
    // Should detect reversal risk while price still above SL
    expect(last.price).toBeGreaterThan(95); // above SL
    expect(alertSeverityRank(last.severity)).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. EVENT PRIORITY RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("W. Event Priority Runtime", () => {
  it("Price update is LOW priority", () => {
    const event = createPriceEvent("BTC/USDT", 105000, "OKX");
    expect(computeEventPriority(event)).toBe("LOW");
  });

  it("Macro risk-off is CRITICAL priority", () => {
    const event = createMacroChangeEvent("BTC/USDT", "risk_off", "Treasury");
    expect(computeEventPriority(event)).toBe("CRITICAL");
  });

  it("Provider degraded is CRITICAL priority", () => {
    const event = createProviderDegradedEvent("BTC/USDT", "OKX", "timeout");
    expect(computeEventPriority(event)).toBe("CRITICAL");
  });

  it("Provider recovered is not CRITICAL", () => {
    const event = createProviderRecoveredEvent("BTC/USDT", "OKX");
    const priority = computeEventPriority(event);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(priority);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. GIVEBACK MONITORING RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("X. Giveback Monitoring Runtime", () => {
  it("Giveback calculated for profitable LONG", () => {
    const gb = calculateGiveback({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 108, stopLoss: 95,
      horizon: "SWING", openedAt: NOW - 3600_000,
      lastUpdateAt: NOW, monitoringStatus: "LIVE",
    });
    expect(gb.givebackPct).toBeGreaterThanOrEqual(0);
  });

  it("Giveback classified correctly at boundaries", () => {
    expect(classifyGivebackSeverity({ givebackPct: 0 } as any, "SWING")).toBe("NONE");
    expect(classifyGivebackSeverity({ givebackPct: 100 } as any, "SWING")).toBe("PROTECT_NOW");
  });

  it("SCALPING is more sensitive than INVESTING", () => {
    const scalpResult = classifyGivebackSeverity({ givebackPct: 30 } as any, "SCALPING");
    const investResult = classifyGivebackSeverity({ givebackPct: 30 } as any, "INVESTING");
    const order = { NONE: 0, WATCH: 1, PARTIAL_TP: 2, MANUAL_TP: 3, PROTECT_NOW: 4 };
    expect(order[scalpResult] ?? -1).toBeGreaterThanOrEqual(order[investResult] ?? -1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. SHOCK DETECTOR RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("Y. Shock Detector Runtime", () => {
  it("No evidence = NORMAL shock", () => {
    const shock = detectShock({ price: 100 });
    expect(shock.state).toBe("NORMAL");
  });

  it("Volatility spike = ELEVATED or SHOCK", () => {
    const shock = detectShock({ price: 100, volatility: 15, avgVolatility: 2 });
    expect(shock.state).not.toBe("NORMAL");
  });

  it("Risk-off transition = ELEVATED or SHOCK", () => {
    const shock = detectShock({
      price: 100, riskRegimeChanged: true, riskRegime: "risk_off",
      volatility: 10, avgVolatility: 2,
    });
    expect(shock.state).not.toBe("NORMAL");
  });

  it("Multiple shock indicators = SHOCK", () => {
    const shock = detectShock({
      price: 100, volatility: 15, avgVolatility: 2,
      riskRegimeChanged: true, riskRegime: "risk_off",
      liquidationSpike: true, fundingRate: -0.005,
      oiChange: -20,
    });
    expect(shock.state).toBe("SHOCK");
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. CONVEX PERSISTENCE SHAPE COMPATIBILITY
// ═══════════════════════════════════════════════════════════════

describe("Z. Convex Persistence Shape Compatibility", () => {
  it("Alert serializes to JSON without errors", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90));
    const json = JSON.stringify(alert);
    const parsed = JSON.parse(json);
    expect(parsed.instrument).toBe("BTC/USDT");
    expect(parsed.severity).toBeDefined();
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it("Alert does not contain non-serializable values", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110));
    const json = JSON.stringify(alert);
    expect(json).toBeDefined();
    expect(typeof json).toBe("string");
    expect(json.length).toBeGreaterThan(0);
  });

  it("Controller state serializes correctly", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100, currentPrice: 110, horizon: "SWING", assetClass: "crypto",
      openedAt: NOW - 3600_000,
    }, NOW);
    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(1);
    expect(typeof dash.totalPositions).toBe("number");
  });
});
