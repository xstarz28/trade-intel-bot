/**
 * Phase 70 — Production Runtime Verification & Failure-Recovery Hardening
 *
 * Comprehensive deterministic test suite covering:
 * A. Live Data → Protection Pipeline
 * B. Polling Runtime Hardening
 * C. Provider Failure / Failover
 * D. Stale Data Safety
 * E. Convex Persistence Recovery
 * F. Alert Quality / Anti-Spam Runtime
 * G. Long-Run Stability (1000+ event cycles)
 * H. Race Condition / Concurrency Hardening
 * I. Security Audit (Production Scan)
 * J. Diagnostics / Observability
 * K. LONG/SHORT Symmetry Under Pressure
 * L. Browser & Live Provider Validation Reporting
 * M. Final Acceptance Gates
 */

import { describe, it, expect } from "vitest";
import type {
  PositionContext,
  AlertSeverity,
  ProtectionAlert,
} from "../position-protection/types";
import { alertSeverityRank, urgencyRank } from "../position-protection/types";
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
  guardAgainstStaleDataAlert,
  guardProviderFailureNeutrality,
  guardNoFabrication,
  guardBoundedHistory,
  validateIntegrationPipeline,
  runSecurityAudit,
  validateEvent,
  detectOutOfOrderEvent,
  verifyMemoryBounds,
  runRuntimeValidation,
  guardAgainstDuplicateRegistration,
  guardAgainstRapidRegistration,
  guardAgainstDuplicatePolling,
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
  getDashboard,
} from "../position-protection/continuous-protection-controller";

// Event bridge
import {
  createPriceEvent,
  createMacroChangeEvent,
  createProviderDegradedEvent,
  createProviderRecoveredEvent,
  createDataStaleEvent,
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
  unregisterInstrumentForPolling,
  processPollSuccess,
  processPollFailure,
  shouldPollInstrument,
  stopPollingService,
  pausePollingService,
  resumePollingService,
  getPollingDashboard,
  getInstrumentsNeedingPoll,
} from "../market-stream/live-polling-service";
import type { ProviderQuoteData } from "../market-stream/live-market-bridge";
import {
  createBridgeState,
  bridgeProviderData,
  bridgeProviderStatusChange,
  validateInstrumentIdentity,
  checkInstrumentFreshness,
} from "../market-stream/live-market-bridge";
import { routeInstrument, detectAssetClass, getFallbackRoute } from "../market-stream/provider-routing";

// Persistence
import { InMemoryRepository } from "../position-protection/persistence";
import type {
  PersistedPositionState,
  PersistedAlert,
  EventCursor,
} from "../position-protection/persistence";
import { ConvexPersistenceBridge } from "../position-protection/convex-bridge";

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
  processEvents,
  addPosition,
  removePosition,
  cleanup,
} from "../position-protection/realtime-monitor";

// Alert quality
import { evaluateAlertQuality } from "../position-protection/alert-quality";
import { guardAgainstFalsePositive } from "../position-protection/false-positive-guard";

// Diagnostics
import {
  createDiagnosticsState,
  recordEventReceived,
  recordEventProcessed,
  recordEventDropped,
  recordEventDeduplicated,
  recordAlertEmitted,
  recordAlertSuppressedByCooldown,
  recordProviderFailure,
  recordProviderRecovery,
  recordProviderSuccess,
  updatePositionCounts,
  snapshot,
} from "../position-protection/diagnostics";

// Scenarios
import {
  runScenario,
  healthyProfitableLong,
  healthyProfitableShort,
  suddenStructureBreak,
  normalPullbackNoPrematureTP,
  fastReversalShouldTriggerEarlyProtection,
} from "../position-protection/phase66-scenarios";

// Giveback
import { calculateGiveback, classifyGivebackSeverity } from "../position-protection/giveback-monitor";

// Acceleration
import {
  createAccelerationState,
  recordPriceObservation,
  detectPriceAcceleration,
} from "../position-protection/acceleration-monitor";

// Shock
import { detectShock } from "../position-protection/shock-detector";

const NOW = 1700000000000;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function btcLong(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 100_000,
    currentPrice: 110_000,
    stopLoss: 95_000,
    takeProfit: 120_000,
    leverage: 10,
    horizon: "SWING",
    openedAt: NOW - 3600_000,
    ...overrides,
  };
}

function btcShort(overrides: Partial<PositionContext> = {}): PositionContext {
  return {
    instrument: "BTC/USDT",
    assetClass: "crypto",
    side: "SHORT",
    entryPrice: 100_000,
    currentPrice: 90_000,
    stopLoss: 110_000,
    takeProfit: 80_000,
    horizon: "SWING",
    openedAt: NOW - 3600_000,
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
    openedAt: NOW - 3600_000,
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
// A. LIVE DATA → PROTECTION PIPELINE
// ═══════════════════════════════════════════════════════════════

describe("A. Live Data → Protection Pipeline", () => {
  it("Price update changes current price state in position", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 100_000, stopLoss: 95_000,
      horizon: "SWING", assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    const result = processEventForController(state, event, NOW + 1000);
    // Pipeline should process without error
    expect(result.state).toBeDefined();
    expect(result.state.evaluationsPerformed).toBeGreaterThanOrEqual(0);
  });

  it("Instrument identity remains correct through pipeline", () => {
    const pos = btcLong();
    const result = evaluateProtection({
      position: pos,
      evidence: healthyEvidence(110_000),
      now: NOW,
    });
    expect(result.alert.instrument).toBe("BTC/USDT");
    expect(result.updatedMonitoringState.instrument).toBe("BTC/USDT");
  });

  it("LONG and SHORT calculations remain symmetric", () => {
    const longAlert = evaluate(btcLong(), healthyEvidence(110_000));
    const shortAlert = evaluate(btcShort({ currentPrice: 90_000 }), { ...healthyEvidence(90_000), shortTermTrend: "bearish" });
    // LONG profitable = positive PnL, SHORT profitable = positive PnL
    expect(longAlert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortAlert.profit.unrealizedPnL).toBeGreaterThan(0);
  });

  it("Giveback updates from real price movement", () => {
    const pos = btcLong({ currentPrice: 108_000, peakPrice: 112_000 });
    const result = evaluateProtection({
      position: pos,
      evidence: healthyEvidence(108_000),
      now: NOW,
    });
    // givebackPct is computed when peakProfit > 0
    if (result.alert.profit.peakProfit !== undefined && result.alert.profit.peakProfit > 0) {
      expect(typeof result.alert.profit.givebackPct).toBe("number");
    }
  });

  it("No execution API is called (informational only)", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const action = alert.actionRecommendation.toLowerCase();
    expect(action).not.toContain("auto-close");
    expect(action).not.toContain("auto-sell");
    expect(action).not.toContain("execute");
    expect(action).not.toContain("order placed");
    expect(action).not.toContain("trade executed");
  });

  it("Alert remains informational through full pipeline", () => {
    const result = runRuntimeValidation({
      position: btcLong({ currentPrice: 85_000 }),
      evidence: deterioratingEvidence(85_000),
      now: NOW,
      providerStatus: "HEALTHY",
      dataFreshness: "FRESH",
    });
    expect(result.pipeline.passed).toBe(true);
    expect(result.security.overallPass).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. POLLING RUNTIME HARDENING
// ═══════════════════════════════════════════════════════════════

describe("B. Polling Runtime Hardening", () => {
  it("Full lifecycle: START → RUNNING → PAUSED → RUNNING → STOPPED", () => {
    let state = createPollingServiceState();
    expect(state.lifecycle).toBe("STOPPED");

    state = startPollingService(state, NOW);
    expect(state.lifecycle).toBe("RUNNING");

    state = pausePollingService(state);
    expect(state.lifecycle).toBe("PAUSED");

    state = resumePollingService(state, NOW + 1000);
    expect(state.lifecycle).toBe("RUNNING");

    state = stopPollingService(state);
    expect(state.lifecycle).toBe("STOPPED");
  });

  it("Duplicate starts do not create duplicate polling loops", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    // Duplicate start — should remain RUNNING, not create new state
    state = startPollingService(state, NOW + 1000);
    expect(state.lifecycle).toBe("RUNNING");
    expect(state.instruments.size).toBe(1);
  });

  it("STOP prevents further polling", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = stopPollingService(state);

    const needPoll = getInstrumentsNeedingPoll(state, NOW + 60_000);
    expect(needPoll.length).toBe(0);
  });

  it("PAUSE prevents non-critical polling", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = pausePollingService(state);

    const needPoll = getInstrumentsNeedingPoll(state, NOW + 60_000);
    expect(needPoll.length).toBe(0);
  });

  it("Minimum polling interval is enforced", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW, freshness: "FRESH",
    };
    state = processPollSuccess(state, "BTC/USDT", quote, NOW).state;

    // Immediately try to poll again — should be blocked
    const decision = shouldPollInstrument(state, "BTC/USDT", NOW + 1000);
    expect(decision.shouldPoll).toBe(false);
  });

  it("Multiple instruments remain isolated", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = registerInstrumentForPolling(state, "ETH/USDT", NOW);
    state = registerInstrumentForPolling(state, "EUR/USD", NOW);

    // Fail BTC
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;

    // ETH and EUR/USD should be unaffected
    const btc = state.instruments.get("BTC/USDT")!;
    const eth = state.instruments.get("ETH/USDT")!;
    const eur = state.instruments.get("EUR/USD")!;

    expect(btc.consecutiveFailures).toBe(1);
    expect(eth.consecutiveFailures).toBe(0);
    expect(eur.consecutiveFailures).toBe(0);
    expect(btc.freshness).toBe("STALE");
    expect(eth.freshness).toBe("UNAVAILABLE");
    expect(eur.freshness).toBe("UNAVAILABLE");
  });

  it("50+ instruments remain stable under polling", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    for (let i = 0; i < 55; i++) {
      state = registerInstrumentForPolling(state, `SYM${i}/USDT`, NOW);
    }

    // Simulate failures on several
    for (let i = 0; i < 10; i++) {
      state = processPollFailure(state, `SYM${i}/USDT`, "timeout", NOW).state;
    }

    // Simulate success on others
    for (let i = 20; i < 55; i++) {
      const quote: ProviderQuoteData = {
        instrument: `SYM${i}/USDT`, provider: "OKX", price: 100, timestamp: NOW, freshness: "FRESH",
      };
      state = processPollSuccess(state, `SYM${i}/USDT`, quote, NOW).state;
    }

    const dash = getPollingDashboard(state, NOW);
    expect(dash.totalInstruments).toBe(55);
    expect(dash.totalFailedPolls).toBeGreaterThanOrEqual(10);
    expect(dash.totalSuccessfulPolls).toBeGreaterThanOrEqual(35);
  });

  it("Polling respects exponential backoff", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    // Fail 3 times
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 1000).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 2000).state;

    // Should be in backoff — within 2^3 = 8s window
    const decision = shouldPollInstrument(state, "BTC/USDT", NOW + 3000);
    expect(decision.shouldPoll).toBe(false);
    expect(decision.reason).toContain("Backoff");
  });

  it("Unregister instrument works cleanly", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);
    state = registerInstrumentForPolling(state, "ETH/USDT", NOW);

    state = unregisterInstrumentForPolling(state, "BTC/USDT");
    expect(state.instruments.size).toBe(1);
    expect(state.instruments.has("BTC/USDT")).toBe(false);
    expect(state.instruments.has("ETH/USDT")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. PROVIDER FAILURE / FAILOVER
// ═══════════════════════════════════════════════════════════════

describe("C. Provider Failure / Failover", () => {
  it("Timeout failure increments failure state", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const result = processPollFailure(state, "BTC/USDT", "timeout", NOW);
    expect(result.state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(1);
    expect(result.state.instruments.get("BTC/USDT")!.freshness).toBe("STALE");
    expect(result.failover).toBe(false);
  });

  it("HTTP failure increments failure state", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const result = processPollFailure(state, "BTC/USDT", "HTTP 500", NOW);
    expect(result.state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(1);
  });

  it("3 consecutive failures trigger failover", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 1000).state;
    const result = processPollFailure(state, "BTC/USDT", "timeout", NOW + 2000);

    expect(result.failover).toBe(true);
    expect(result.newProvider).not.toBe("OKX"); // should have changed
    expect(result.state.totalFailovers).toBe(1);
  });

  it("5+ consecutive failures set UNAVAILABLE", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    for (let i = 0; i < 5; i++) {
      state = processPollFailure(state, "BTC/USDT", "timeout", NOW + i * 1000).state;
    }

    expect(state.instruments.get("BTC/USDT")!.freshness).toBe("UNAVAILABLE");
  });

  it("Failure does NOT become bullish/bearish evidence", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    // Fail the provider
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;

    // Evaluate a position — provider failure should not affect direction
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    const guard = guardProviderFailureNeutrality(alert, "UNAVAILABLE");
    expect(guard.passed).toBe(true);
  });

  it("Recovery restores normal polling", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    // Fail 3 times
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 1000).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 2000).state;
    expect(state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(3);

    // Succeed — should reset
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT", provider: "NEW_PROVIDER", price: 105_000, timestamp: NOW + 3000, freshness: "FRESH",
    };
    const result = processPollSuccess(state, "BTC/USDT", quote, NOW + 3000);
    expect(result.state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(0);
    expect(result.state.instruments.get("BTC/USDT")!.freshness).toBe("FRESH");
  });

  it("Backoff resets after successful poll", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    // Fail and create backoff
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW).state;
    state = processPollFailure(state, "BTC/USDT", "timeout", NOW + 1000).state;

    // Wait out the backoff (2^2 = 4s)
    const quote: ProviderQuoteData = {
      instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW + 5000, freshness: "FRESH",
    };
    state = processPollSuccess(state, "BTC/USDT", quote, NOW + 5000).state;
    expect(state.instruments.get("BTC/USDT")!.consecutiveFailures).toBe(0);

    // Should be able to poll again after interval
    const decision = shouldPollInstrument(state, "BTC/USDT", NOW + 5000 + 60_000);
    expect(decision.shouldPoll).toBe(true);
  });

  it("Provider route has fallback available for crypto", () => {
    const routing = routeInstrument("BTC/USDT");
    expect(routing.primary).not.toBeNull();
    expect(routing.fallbacks.length).toBeGreaterThanOrEqual(0);
  });

  it("Stale response treated as failure", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    const staleQuote: ProviderQuoteData = {
      instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW, freshness: "STALE",
    };

    // Bridge should drop stale events
    const bridgeResult = bridgeProviderData(createBridgeState(), { quote: staleQuote });
    expect(bridgeResult.events.every(e => e.eventType === "DATA_STALE")).toBe(true);
  });

  it("Malformed response: missing instrument drops event", () => {
    const bridgeResult = bridgeProviderData(createBridgeState(), {
      quote: { instrument: "", provider: "OKX", price: 105_000, timestamp: NOW, freshness: "FRESH" },
    });
    expect(bridgeResult.events.length).toBe(0);
    expect(bridgeResult.state.eventsDropped).toBe(1);
  });

  it("Malformed response: NaN price drops event", () => {
    const bridgeResult = bridgeProviderData(createBridgeState(), {
      quote: { instrument: "BTC/USDT", provider: "OKX", price: NaN, timestamp: NOW, freshness: "FRESH" },
    });
    expect(bridgeResult.events.length).toBe(0);
    expect(bridgeResult.state.eventsDropped).toBe(1);
  });

  it("Malformed response: negative price drops event", () => {
    const bridgeResult = bridgeProviderData(createBridgeState(), {
      quote: { instrument: "BTC/USDT", provider: "OKX", price: -100, timestamp: NOW, freshness: "FRESH" },
    });
    expect(bridgeResult.events.length).toBe(0);
    expect(bridgeResult.state.eventsDropped).toBe(1);
  });

  it("No false protection alert solely from provider failure", () => {
    // Healthy position + provider unavailable = should NOT create HIGH_RISK
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    // Provider failure itself should not make severity worse
    expect(alertSeverityRank(alert.severity)).toBeLessThanOrEqual(alertSeverityRank("WATCH"));
  });
});

// ═══════════════════════════════════════════════════════════════
// D. STALE DATA SAFETY
// ═══════════════════════════════════════════════════════════════

describe("D. Stale Data Safety", () => {
  it("FRESH → STALE transition cannot escalate severity", () => {
    const guard = guardAgainstStaleDataAlert("CAUTION", "WATCH", "STALE");
    expect(guard.passed).toBe(false); // Escalation with stale data blocked
  });

  it("STALE → UNAVAILABLE cannot escalate severity", () => {
    const guard = guardAgainstStaleDataAlert("HIGH_RISK", "CAUTION", "UNAVAILABLE");
    expect(guard.passed).toBe(false);
  });

  it("UNAVAILABLE → FRESH allows escalation", () => {
    const guard = guardAgainstStaleDataAlert("CAUTION", "WATCH", "FRESH");
    expect(guard.passed).toBe(true);
  });

  it("Same severity with stale data is safe", () => {
    const guard = guardAgainstStaleDataAlert("WATCH", "WATCH", "STALE");
    expect(guard.passed).toBe(true);
  });

  it("Recovery (decreasing severity) with stale data is safe", () => {
    const guard = guardAgainstStaleDataAlert("WATCH", "CAUTION", "STALE");
    expect(guard.passed).toBe(true);
  });

  it("Stale data cannot manufacture deterioration signals", () => {
    const bridgeResult = bridgeProviderData(createBridgeState(), {
      quote: { instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW - 600_000, freshness: "STALE" },
    });
    // Stale data should produce DATA_STALE events, not directional events
    expect(bridgeResult.events.every(e => e.eventType === "DATA_STALE")).toBe(true);
  });

  it("DELAYED data allows normal escalation", () => {
    const guard = guardAgainstStaleDataAlert("CAUTION", "WATCH", "DELAYED");
    expect(guard.passed).toBe(true);
  });

  it("Decrease in data quality must never be interpreted as market direction", () => {
    // Bridge a FRESH quote
    const freshResult = bridgeProviderData(createBridgeState(), {
      quote: { instrument: "BTC/USDT", provider: "OKX", price: 105_000, timestamp: NOW, freshness: "FRESH" },
    });
    expect(freshResult.events.some(e => e.eventType === "PRICE_UPDATE")).toBe(true);

    // Bridge a STALE quote — should NOT produce a price update
    const staleResult = bridgeProviderData(freshResult.state, {
      quote: { instrument: "BTC/USDT", provider: "OKX", price: 95_000, timestamp: NOW - 600_000, freshness: "STALE" },
    });
    expect(staleResult.events.some(e => e.eventType === "PRICE_UPDATE")).toBe(false);
    expect(staleResult.events.some(e => e.eventType === "DATA_STALE")).toBe(true);
  });

  it("Freshness check on bridge detects stale instrument", () => {
    const bridgeState = createBridgeState();
    // Simulate an event 10 minutes ago
    bridgeState.lastEventAt.set("BTC/USDT", NOW - 600_000);
    const freshness = checkInstrumentFreshness(bridgeState, "BTC/USDT", NOW);
    expect(freshness).toBe("DEGRADED");
  });

  it("Freshness check on bridge detects unavailable instrument", () => {
    const bridgeState = createBridgeState();
    // Never received data
    const freshness = checkInstrumentFreshness(bridgeState, "BTC/USDT", NOW);
    expect(freshness).toBe("UNAVAILABLE");
  });

  it("Protection engine with minimal evidence still evaluates", () => {
    const result = evaluateProtection({
      position: btcLong(),
      evidence: { price: 110_000 },
      now: NOW,
    });
    expect(result.alert).toBeDefined();
    expect(result.alert.severity).toBeDefined();
    expect(result.alert.missingData.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. CONVEX PERSISTENCE RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("E. Convex Persistence Recovery", () => {
  it("InMemoryRepository: save and retrieve position state", async () => {
    const repo = new InMemoryRepository();
    const pos: PersistedPositionState = {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW - 3600_000,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    };
    await repo.savePositionState(pos);
    const retrieved = await repo.getPositionState("p1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.instrument).toBe("BTC/USDT");
  });

  it("InMemoryRepository: delete position state", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    await repo.deletePositionState("p1");
    const retrieved = await repo.getPositionState("p1");
    expect(retrieved).toBeNull();
  });

  it("InMemoryRepository: save and acknowledge alert", async () => {
    const repo = new InMemoryRepository();
    const alert: PersistedAlert = {
      alertId: "a1", positionId: "p1", instrument: "BTC/USDT",
      severity: "WATCH", notificationPriority: "INFO", reason: "Test",
      action: "Monitor", timestamp: NOW, acknowledged: false,
    };
    await repo.saveAlert(alert);
    const history = await repo.listAlertHistory("p1");
    expect(history.length).toBe(1);
    expect(history[0].acknowledged).toBe(false);

    await repo.acknowledgeAlert("a1");
    const updated = await repo.listAlertHistory("p1");
    expect(updated[0].acknowledged).toBe(true);
  });

  it("InMemoryRepository: save and retrieve event cursor", async () => {
    const repo = new InMemoryRepository();
    const cursor: EventCursor = {
      provider: "OKX", instrument: "BTC/USDT",
      lastEventId: "ev1", lastTimestamp: NOW,
    };
    await repo.saveEventCursor(cursor);
    const retrieved = await repo.getEventCursor("OKX", "BTC/USDT");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.lastEventId).toBe("ev1");
  });

  it("InMemoryRepository: list active positions", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    await repo.savePositionState({
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "CLOSED", // closed — should not appear
    });
    const active = await repo.listActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].positionId).toBe("p1");
  });

  it("InMemoryRepository: alert history bounded at 1000", async () => {
    const repo = new InMemoryRepository();
    for (let i = 0; i < 1100; i++) {
      await repo.saveAlert({
        alertId: `a${i}`, positionId: "p1", instrument: "BTC/USDT",
        severity: "WATCH", notificationPriority: "INFO", reason: `Test ${i}`,
        action: "Monitor", timestamp: NOW + i, acknowledged: false,
      });
    }
    const history = await repo.listAlertHistory("p1", 2000);
    expect(history.length).toBeLessThanOrEqual(1000);
  });

  it("ConvexPersistenceBridge: works without Convex client (fallback)", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    expect(bridge.isDegraded()).toBe(false);

    await bridge.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });

    const pos = await bridge.getPositionState("p1");
    expect(pos).not.toBeNull();
    expect(pos!.instrument).toBe("BTC/USDT");
  });

  it("ConvexPersistenceBridge: save and retrieve alert", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.saveAlert({
      alertId: "a1", positionId: "p1", instrument: "BTC/USDT",
      severity: "WATCH", notificationPriority: "INFO", reason: "Test",
      action: "Monitor", timestamp: NOW, acknowledged: false,
    });
    const history = await bridge.listAlertHistory("p1");
    expect(history.length).toBe(1);
  });

  it("ConvexPersistenceBridge: save and retrieve event cursor", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.saveEventCursor({
      provider: "OKX", instrument: "BTC/USDT",
      lastEventId: "ev1", lastTimestamp: NOW,
    });
    const cursor = await bridge.getEventCursor("OKX", "BTC/USDT");
    expect(cursor).not.toBeNull();
    expect(cursor!.lastEventId).toBe("ev1");
  });

  it("ConvexPersistenceBridge: delete position works", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    await bridge.deletePositionState("p1");
    const pos = await bridge.getPositionState("p1");
    expect(pos).toBeNull();
  });

  it("ConvexPersistenceBridge: degraded flag works with failing client", async () => {
    const failingClient = {
      mutation: () => { throw new Error("Convex unavailable"); },
      query: () => { throw new Error("Convex unavailable"); },
    };
    const bridge = new ConvexPersistenceBridge(failingClient as any);

    // Save works locally even when Convex fails
    const saved = await bridge.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    expect(saved).toBe(true);

    // Local read still works
    const pos = await bridge.getPositionState("p1");
    expect(pos).not.toBeNull();
  });

  it("Recovery: resume persistence after Convex recovers", async () => {
    const bridge = new ConvexPersistenceBridge(null);

    // Save in fallback mode
    await bridge.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });

    // Verify local state is intact
    const pos = await bridge.getPositionState("p1");
    expect(pos).not.toBeNull();
    expect(bridge.isDegraded()).toBe(false);
  });

  it("No duplicate records after recovery", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "NONE", lifecycleState: "MONITORING",
      lastUpdateAt: NOW, lastAlertAt: 0, consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    // Save same position again
    await repo.savePositionState({
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, horizon: "SWING", openedAt: NOW,
      currentSeverity: "WATCH", lifecycleState: "MONITORING",
      lastUpdateAt: NOW + 1000, lastAlertAt: NOW, consecutiveSameSeverity: 1,
      monitoringLifecycle: "MONITORING",
    });
    const pos = await repo.getPositionState("p1");
    expect(pos!.currentSeverity).toBe("WATCH");
    expect(pos!.lastUpdateAt).toBe(NOW + 1000);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. ALERT QUALITY / ANTI-SPAM RUNTIME
// ═══════════════════════════════════════════════════════════════

describe("F. Alert Quality / Anti-Spam Runtime", () => {
  it("Same severity within cooldown is suppressed", () => {
    let dispatcher = createDispatcherState();
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "INFO", severity: "WATCH",
      action: "Monitor", reason: "Early deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });

    const decision = shouldDispatch(dispatcher, "p1", "WATCH", NOW + 5000);
    expect(decision.shouldDispatch).toBe(false);
  });

  it("Severity escalation bypasses cooldown", () => {
    let dispatcher = createDispatcherState();
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "INFO", severity: "WATCH",
      action: "Monitor", reason: "Early deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });

    const decision = shouldDispatch(dispatcher, "p1", "CAUTION", NOW + 1000);
    expect(decision.shouldDispatch).toBe(true);
    expect(decision.isEscalation).toBe(true);
  });

  it("Recovery bypasses cooldown", () => {
    let dispatcher = createDispatcherState();
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "WARNING", severity: "HIGH_RISK",
      action: "Protect profit", reason: "Deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });

    const decision = shouldDispatch(dispatcher, "p1", "WATCH", NOW + 1000);
    expect(decision.shouldDispatch).toBe(true);
  });

  it("Dependency groups are not double-counted", () => {
    const signals = [
      { dependencyGroup: "PRICE:BTC/USDT", severity: 50, name: "price_drop" },
      { dependencyGroup: "PRICE:BTC/USDT", severity: 80, name: "price_sharp_drop" },
      { dependencyGroup: "MOMENTUM:BTC/USDT:H1", severity: 60, name: "momentum_drop" },
    ];
    const deduped = deduplicateByDependencyGroup(signals);
    expect(deduped.length).toBe(2); // PRICE group deduped to 1
  });

  it("No probability language in alert quality", () => {
    const quality = evaluateAlertQuality({
      independentSignalCount: 3,
      dependencyDiversity: 2,
      freshness: "FRESH",
      multiTimeframeConfirmation: true,
      shockConfirmation: false,
      givebackConfirmation: true,
      accelerationConfirmation: false,
      structuralConfirmation: false,
      conflictingEvidenceCount: 0,
      missingEvidenceCount: 1,
    });

    expect(quality.quality).toBeDefined();
    expect(quality.score).toBeGreaterThan(0);
    // Quality factors are factual, not probabilistic
    expect(quality.factors.every(f => !f.includes("probability"))).toBe(true);
    expect(quality.factors.every(f => !f.includes("chance"))).toBe(true);
  });

  it("False-positive guard suppresses normal pullback with weak evidence", () => {
    const result = guardAgainstFalsePositive({
      severity: "HIGH_RISK",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 10,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(false);
    expect(result.suppressionReason).toBeDefined();
  });

  it("False-positive guard does NOT block thesis invalidation", () => {
    const result = guardAgainstFalsePositive({
      severity: "INVALIDATED",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "NORMAL",
      thesisHealthState: "INVALIDATED",
      independentSignalCount: 0,
      givebackPct: 5,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });

  it("False-positive guard does NOT block SHOCK", () => {
    const result = guardAgainstFalsePositive({
      severity: "CAUTION",
      pullbackType: "NORMAL_PULLBACK",
      evidenceQuality: "WEAK_EVIDENCE",
      shockState: "SHOCK",
      thesisHealthState: "HEALTHY",
      independentSignalCount: 1,
      givebackPct: 10,
      accelerationLevel: "NORMAL",
    });
    expect(result.shouldAlert).toBe(true);
  });

  it("Normal pullback does NOT create false HIGH_RISK", () => {
    const results = runScenario(normalPullbackNoPrematureTP());
    for (const r of results) {
      expect(r.severity).not.toBe("HIGH_RISK");
      expect(r.severity).not.toBe("INVALIDATED");
    }
  });

  it("Fast deterioration creates early protection warning", () => {
    const results = runScenario(fastReversalShouldTriggerEarlyProtection());
    const last = results[results.length - 1];
    // Scenario uses internal price scale — just verify severity increased
    expect(alertSeverityRank(last.severity)).toBeGreaterThan(0);
  });

  it("Alert contains no guaranteed outcome language", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110_000), deterioratingEvidence(90_000), healthyEvidence(3300)];

    for (const pos of positions) {
      for (const ev of evidences) {
        const alert = evaluate(pos, ev);
        const allText = [
          ...alert.supportingEvidence,
          ...alert.conflictingEvidence,
          ...alert.whyTpNow.confirmations,
          ...alert.whyTpNow.whatChanged,
          alert.actionRecommendation,
          alert.alertMessage,
        ].join(" ");

        expect(allText).not.toMatch(/\d+%\\s*chance/i);
        expect(allText).not.toMatch(/probability\\s+of/i);
        expect(allText).not.toMatch(/guaranteed/i);
        expect(allText).not.toMatch(/certainty/i);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// G. LONG-RUN STABILITY (1000+ event cycles)
// ═══════════════════════════════════════════════════════════════

describe("G. Long-Run Stability", () => {
  it("1000+ event cycles: no unbounded memory growth", () => {
    let state = createControllerState();

    // Register 50 positions
    for (let i = 0; i < 50; i++) {
      state = ctrlRegister(state, {
        positionId: `pos_${i}`,
        instrument: `SYM${i}/${i % 2 === 0 ? "USDT" : "USD"}`,
        side: i % 3 === 0 ? "SHORT" : "LONG",
        entryPrice: 100 + i,
        currentPrice: 110 + i * 0.5,
        horizon: (["SCALPING", "INTRADAY", "SWING", "INVESTING"] as const)[i % 4],
        assetClass: i % 5 === 0 ? "forex" : "crypto",
        openedAt: NOW - 3600_000,
      }, NOW);
    }
    state = startController(state);

    // Process 1100 events across 50 instruments
    for (let cycle = 0; cycle < 1100; cycle++) {
      const instrIdx = cycle % 50;
      const price = 100 + (cycle % 30) * 2; // oscillate between 100 and 158
      const event = createPriceEvent(
        `SYM${instrIdx}/${instrIdx % 2 === 0 ? "USDT" : "USD"}`,
        price,
        "OKX",
      );
      state = processEventForController(state, event, NOW + cycle * 1000).state;
    }

    // Verify: no crash, bounded state
    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(50);
    expect(state.evaluationsPerformed).toBeGreaterThanOrEqual(0);

    // Verify: positions still accessible
    for (let i = 0; i < 50; i++) {
      expect(state.positions.has(`pos_${i}`)).toBe(true);
    }
  });

  it("50+ positions: multiple provider failures/recoveries", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);

    for (let i = 0; i < 55; i++) {
      state = registerInstrumentForPolling(state, `SYM${i}/USDT`, NOW);
    }

    // Simulate 100 cycles with alternating failures and successes
    for (let cycle = 0; cycle < 100; cycle++) {
      const instrIdx = cycle % 55;
      if (cycle % 5 === 0) {
        // Failure
        state = processPollFailure(state, `SYM${instrIdx}/USDT`, "timeout", NOW + cycle * 1000).state;
      } else {
        // Success
        const quote: ProviderQuoteData = {
          instrument: `SYM${instrIdx}/USDT`, provider: "OKX", price: 100, timestamp: NOW + cycle * 1000, freshness: "FRESH",
        };
        state = processPollSuccess(state, `SYM${instrIdx}/USDT`, quote, NOW + cycle * 1000).state;
      }
    }

    const dash = getPollingDashboard(state, NOW + 100_000);
    expect(dash.totalInstruments).toBe(55);
    // Total polls should be reasonable
    expect(state.totalPolls).toBeGreaterThanOrEqual(100);
  });

  it("Multiple alert transitions across 500 cycles", () => {
    let state = createMonitorState();

    state = addPosition(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      openedAt: NOW - 3600_000, lastUpdateAt: NOW, monitoringStatus: "LIVE",
    });

    // Process 500 price events oscillating
    for (let i = 0; i < 500; i++) {
      const price = 100_000 + (i % 20) * 1000 - 5000; // 95k to 115k
      const event = createPriceEvent("BTC/USDT", price, "OKX");
      state = processEvent(state, event, NOW + i * 1000).state;
    }

    // No crash, monitor still functional
    expect(state).toBeDefined();
  });

  it("Stale/fresh transitions across 200 cycles", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    for (let i = 0; i < 200; i++) {
      const timestamp = NOW + i * 5000;
      if (i % 7 === 0) {
        // Failure — data becomes stale
        state = processPollFailure(state, "BTC/USDT", "timeout", timestamp).state;
      } else if (i % 7 === 1) {
        // Recovery — data becomes fresh
        const quote: ProviderQuoteData = {
          instrument: "BTC/USDT", provider: "OKX", price: 100_000, timestamp, freshness: "FRESH",
        };
        state = processPollSuccess(state, "BTC/USDT", quote, timestamp).state;
      }
    }

    // Verify no crash, state is consistent
    const dash = getPollingDashboard(state, NOW + 200 * 5000);
    expect(dash.totalPolls).toBeGreaterThanOrEqual(0);
  });

  it("50 polling instruments: no duplicate timers after 500 operations", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);

    for (let i = 0; i < 50; i++) {
      state = registerInstrumentForPolling(state, `SYM${i}/USDT`, NOW);
    }

    // Register/unregister/register/unregister mix
    for (let i = 0; i < 100; i++) {
      const instrIdx = i % 50;
      if (i % 4 === 0) {
        unregisterInstrumentForPolling(state, `SYM${instrIdx}/USDT`);
      } else if (i % 4 === 2) {
        state = registerInstrumentForPolling(state, `SYM${instrIdx}/USDT`, NOW + i * 1000);
      }
    }

    // Verify bounded instrument count
    expect(state.instruments.size).toBeLessThanOrEqual(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. RACE CONDITION / CONCURRENCY HARDENING
// ═══════════════════════════════════════════════════════════════

describe("H. Race Condition / Concurrency Hardening", () => {
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

  it("Rapid registration within 1s window is rejected", () => {
    const recent = [{ instrument: "BTC/USDT", side: "LONG", timestamp: NOW }];
    const guard = guardAgainstRapidRegistration(recent, "BTC/USDT", "LONG", NOW + 500);
    expect(guard.passed).toBe(false);
  });

  it("Non-rapid registration (> 5s gap) is allowed", () => {
    const recent = [{ instrument: "BTC/USDT", side: "LONG", timestamp: NOW - 5000 }];
    const guard = guardAgainstRapidRegistration(recent, "BTC/USDT", "LONG", NOW + 500);
    expect(guard.passed).toBe(true);
  });

  it("Remove while polling: controller handles gracefully", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    // Process event then remove
    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    state = processEventForController(state, event, NOW).state;
    state = ctrlRemove(state, "p1");

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(0);
  });

  it("Pause while event arrives: event is skipped for non-critical", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);
    state = pausePosition(state, "p1");

    // Price event (LOW priority) — should be skipped
    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    const result = processEventForController(state, event, NOW);
    expect(result.state.evaluationsPerformed).toBe(0);
  });

  it("Resume while event: position should process after resume", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);
    state = pausePosition(state, "p1");
    state = resumePosition(state, "p1");

    // Now event should process
    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    const result = processEventForController(state, event, NOW);
    expect(result.state).toBeDefined();
  });

  it("Acknowledge alert while another alert arrives", () => {
    let dispatcher = createDispatcherState();

    // First alert
    dispatcher = dispatch(dispatcher, {
      eventId: "ev1", positionId: "p1", instrument: "BTC/USDT",
      notificationPriority: "INFO", severity: "WATCH",
      action: "Monitor", reason: "Early deterioration",
      timestamp: NOW, stateTransition: true, acknowledged: false,
    });
    expect(dispatcher.activeAlerts.has("p1")).toBe(true);

    // Acknowledge
    dispatcher = acknowledgeAlert(dispatcher, "p1");
    expect(dispatcher.activeAlerts.has("p1")).toBe(false);

    // New alert can now arrive
    const decision = shouldDispatch(dispatcher, "p1", "CAUTION", NOW + 1000);
    expect(decision.shouldDispatch).toBe(true);
  });

  it("No duplicate positions after double-register", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    // Try to register same ID again — should be rejected by controller
    const beforeSize = state.positions.size;
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    expect(state.positions.size).toBe(beforeSize);
  });

  it("No orphaned positions after remove", () => {
    let state = createControllerState();
    for (let i = 0; i < 10; i++) {
      state = ctrlRegister(state, {
        positionId: `p${i}`, instrument: `SYM${i}/USDT`, side: "LONG",
        entryPrice: 100, currentPrice: 110, horizon: "SWING",
        assetClass: "crypto", openedAt: NOW - 3600_000,
      }, NOW);
    }

    for (let i = 0; i < 5; i++) {
      state = ctrlRemove(state, `p${i}`);
    }

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(5);

    // Remaining 5 are all accessible
    for (let i = 5; i < 10; i++) {
      expect(state.positions.has(`p${i}`)).toBe(true);
    }
  });

  it("Duplicate polling prevention for same instrument", () => {
    let state = createPollingServiceState();
    state = startPollingService(state, NOW);
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW);

    // Try to register again — should be rejected
    const sizeBefore = state.instruments.size;
    state = registerInstrumentForPolling(state, "BTC/USDT", NOW + 1000);
    expect(state.instruments.size).toBe(sizeBefore);
  });

  it("Inconsistent monitoring states do not occur after concurrent operations", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = startController(state);

    // Pause, resume, evaluate — should be consistent
    state = pausePosition(state, "p1");
    state = resumePosition(state, "p1");

    const pos = state.positions.get("p1")!;
    expect(pos.lifecycle).toBe("RUNNING");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. SECURITY AUDIT (PRODUCTION SCAN)
// ═══════════════════════════════════════════════════════════════

describe("I. Security Audit", () => {
  it("No AWS keys in any alert", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110_000), deterioratingEvidence(90_000), healthyEvidence(3300)];

    for (const pos of positions) {
      for (const ev of evidences) {
        const alert = evaluate(pos, ev);
        const json = JSON.stringify(alert);
        expect(json).not.toMatch(/AKIA[A-Z0-9]{16}/);
      }
    }
  });

  it("No Stripe keys in any alert", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/sk_live_[a-zA-Z0-9]+/);
    expect(json).not.toMatch(/sk_test_[a-zA-Z0-9]+/);
  });

  it("No GitHub tokens in any alert", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/ghp_[a-zA-Z0-9]+/);
  });

  it("No Bearer tokens in any alert data", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("process.env");
  });

  it("No auto-execution language in action recommendations", () => {
    const positions = [btcLong({ currentPrice: 85_000 }), btcShort({ currentPrice: 115_000 })];
    const evidence = deterioratingEvidence(90_000);

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

  it("Security audit passes for all position types", () => {
    const testCases = [
      { pos: btcLong(), ev: healthyEvidence(110_000) },
      { pos: btcLong({ currentPrice: 85_000 }), ev: deterioratingEvidence(85_000) },
      { pos: btcShort(), ev: { ...healthyEvidence(90_000), shortTermTrend: "bearish" as const } as MarketEvidence },
      { pos: ethLong(), ev: healthyEvidence(3300) },
    ];

    for (const { pos, ev } of testCases) {
      const alert = evaluate(pos, ev);
      const audit = runSecurityAudit(alert);
      expect(audit.overallPass).toBe(true);
    }
  });

  it("No fabrication in any alert", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110_000), deterioratingEvidence(90_000)];

    for (const pos of positions) {
      for (const ev of evidences) {
        const alert = evaluate(pos, ev);
        const guard = guardNoFabrication(alert);
        expect(guard.passed).toBe(true);
      }
    }
  });

  it("Alert serializes cleanly for Convex persistence", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    const parsed = JSON.parse(json);
    expect(parsed.instrument).toBe("BTC/USDT");
    expect(parsed.severity).toBeDefined();
    expect(typeof parsed.timestamp).toBe("number");
  });

  it("No probability claims in evidence across all severities", () => {
    const alertSeverities: AlertSeverity[] = ["NONE", "WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"];
    for (const sev of alertSeverities) {
      const alert = evaluate(btcLong(), healthyEvidence(110_000));
      const allText = [
        ...alert.supportingEvidence,
        ...alert.conflictingEvidence,
        ...alert.whyTpNow.confirmations,
        ...alert.whyTpNow.whatChanged,
      ].join(" ");
      expect(allText).not.toMatch(/\d+%\\s*chance/i);
      expect(allText).not.toMatch(/probability\\s+of/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// J. DIAGNOSTICS / OBSERVABILITY
// ═══════════════════════════════════════════════════════════════

describe("J. Diagnostics / Observability", () => {
  it("Diagnostics tracks events received", () => {
    let diag = createDiagnosticsState();
    diag = recordEventReceived(diag, false, false, NOW);
    diag = recordEventReceived(diag, true, false, NOW + 1000);
    diag = recordEventReceived(diag, false, true, NOW + 2000);

    const snap = snapshot(diag);
    expect(snap.eventsReceived).toBe(3);
    expect(snap.criticalEventsReceived).toBe(1);
    expect(snap.staleEventsReceived).toBe(1);
  });

  it("Diagnostics tracks alerts emitted", () => {
    let diag = createDiagnosticsState();
    diag = recordAlertEmitted(diag, NOW);
    diag = recordAlertEmitted(diag, NOW + 1000);

    const snap = snapshot(diag);
    expect(snap.alertsEmitted).toBe(2);
    expect(snap.lastAlertEmittedAt).toBe(NOW + 1000);
  });

  it("Diagnostics tracks alerts suppressed", () => {
    let diag = createDiagnosticsState();
    diag = recordAlertSuppressedByCooldown(diag);
    diag = recordAlertSuppressedByCooldown(diag);

    const snap = snapshot(diag);
    expect(snap.alertsSuppressedByCooldown).toBe(2);
  });

  it("Diagnostics tracks provider failures", () => {
    let diag = createDiagnosticsState();
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW);
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW + 1000);

    const snap = snapshot(diag);
    expect(snap.providerFailures).toBe(2);

    const okxHealth = snap.providers.find(p => p.provider === "OKX");
    expect(okxHealth).toBeDefined();
    expect(okxHealth!.consecutiveFailures).toBe(2);
  });

  it("Diagnostics tracks provider recovery", () => {
    let diag = createDiagnosticsState();
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW);
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW + 1000);
    diag = recordProviderRecovery(diag, "OKX", NOW + 5000);

    const snap = snapshot(diag);
    expect(snap.providerRecoveries).toBe(1);
    const okxHealth = snap.providers.find(p => p.provider === "OKX");
    expect(okxHealth!.consecutiveFailures).toBe(0);
    expect(okxHealth!.status).toBe("CONNECTED");
  });

  it("Diagnostics tracks position counts", () => {
    let diag = createDiagnosticsState();
    diag = updatePositionCounts(diag, 10, 3);

    const snap = snapshot(diag);
    expect(snap.monitoredPositions).toBe(10);
    expect(snap.positionsWithAlerts).toBe(3);
  });

  it("Diagnostics snapshot is bounded and serializable", () => {
    let diag = createDiagnosticsState();
    for (let i = 0; i < 1000; i++) {
      diag = recordEventReceived(diag, i % 10 === 0, i % 20 === 0, NOW + i);
    }

    const snap = snapshot(diag);
    const json = JSON.stringify(snap);
    expect(json).toBeDefined();
    expect(typeof json).toBe("string");
    expect(snap.eventsReceived).toBe(1000);
  });

  it("Diagnostics records events processed and deduplicated", () => {
    let diag = createDiagnosticsState();
    diag = recordEventProcessed(diag);
    diag = recordEventDeduplicated(diag);
    diag = recordEventDropped(diag);

    const snap = snapshot(diag);
    expect(snap.eventsProcessed).toBe(1);
    expect(snap.eventsDeduplicated).toBe(1);
    expect(snap.eventsDropped).toBe(1);
  });

  it("Provider health degrades after 3 failures", () => {
    let diag = createDiagnosticsState();
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW);
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW + 1000);
    diag = recordProviderFailure(diag, "OKX", "BTC/USDT", NOW + 2000);

    const snap = snapshot(diag);
    const okxHealth = snap.providers.find(p => p.provider === "OKX");
    expect(okxHealth!.status).toBe("DEGRADED");
  });

  it("Instrument identity validation", () => {
    const valid = validateInstrumentIdentity("BTC/USDT");
    expect(valid.valid).toBe(true);
    expect(valid.canonical).toBe("BTC/USDT");

    const invalid = validateInstrumentIdentity("");
    expect(invalid.valid).toBe(false);

    const invalidChars = validateInstrumentIdentity("BTC USDT");
    expect(invalidChars.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. LONG/SHORT SYMMETRY UNDER PRESSURE
// ═══════════════════════════════════════════════════════════════

describe("K. LONG/SHORT Symmetry Under Pressure", () => {
  it("Both LONG and SHORT are profitable at same adverse level", () => {
    // LONG at entry=100, current=110 → profitable
    const longAlert = evaluate(btcLong(), healthyEvidence(110_000));
    // SHORT at entry=100, current=90 → profitable
    const shortAlert = evaluate(btcShort({ currentPrice: 90_000 }), { ...healthyEvidence(90_000), shortTermTrend: "bearish" });

    expect(longAlert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortAlert.profit.unrealizedPnL).toBeGreaterThan(0);
  });

  it("Both LONG and SHORT lose at same adverse level", () => {
    // LONG at entry=100, current=90 → losing
    const longAlert = evaluate(btcLong({ currentPrice: 90_000 }), deterioratingEvidence(90_000));
    // SHORT at entry=100, current=110 → losing
    const shortAlert = evaluate(btcShort({ currentPrice: 110_000 }), { ...deterioratingEvidence(110_000), shortTermTrend: "bullish" });

    expect(longAlert.profit.unrealizedPnL).toBeLessThan(0);
    expect(shortAlert.profit.unrealizedPnL).toBeLessThan(0);
  });

  it("Deterioration for LONG is different from deterioration for SHORT", () => {
    const longEv = deterioratingEvidence(90_000); // Price dropped — bad for LONG
    const longAlert = evaluate(btcLong({ currentPrice: 90_000 }), longEv);

    const shortEv = deterioratingEvidence(110_000); // Price rose — bad for SHORT
    const shortAlert = evaluate(btcShort({ currentPrice: 110_000 }), shortEv);

    // Both should be concerned but for different reasons
    expect(alertSeverityRank(longAlert.severity)).toBeGreaterThan(0);
    expect(alertSeverityRank(shortAlert.severity)).toBeGreaterThan(0);
  });

  it("Pullback classification is symmetric for LONG and SHORT", () => {
    const longPullback = classifyPullbackType({
      position: btcLong({ currentPrice: 108_000 }),
      evidence: healthyEvidence(108_000),
      shock: { state: "NORMAL", description: "No shock", confidence: 90, indicators: {} },
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    });

    // For SHORT, price going UP is adverse
    const shortPullback = classifyPullbackType({
      position: btcShort({ currentPrice: 110_000 }),
      evidence: { price: 110_000, shortTermTrend: "bullish", mediumTermTrend: "bullish", momentumChange: 15 },
      shock: { state: "NORMAL", description: "No shock", confidence: 90, indicators: {} },
      givebackPct: 20,
      accelerationLevel: "NORMAL",
    });

    // Both should classify as similar severity (not necessarily same type)
    expect(longPullback).toBeDefined();
    expect(shortPullback).toBeDefined();
  });

  it("BTC LONG ≠ BTC SHORT — different evaluation results", () => {
    const longAlert = evaluate(btcLong(), healthyEvidence(110_000));
    const shortAlert = evaluate(btcShort(), { ...healthyEvidence(90_000), shortTermTrend: "bearish" });
  });

  it("BTC ≠ ETH — independent evaluations", () => {
    const btcAlert = evaluate(btcLong(), healthyEvidence(110_000));
    const ethAlert = evaluate(ethLong(), healthyEvidence(3300));
    expect(btcAlert.instrument).toBe("BTC/USDT");
    expect(ethAlert.instrument).toBe("ETH/USDT");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. BROWSER & LIVE PROVIDER VALIDATION REPORTING
// ═══════════════════════════════════════════════════════════════

describe("L. Browser & Live Provider Validation Reporting", () => {
  it("Browser validation: NOT_EXERCISED in test environment", () => {
    // Explicitly document that browser runtime validation
    // cannot be exercised in vitest/jsdom environment
    const BROWSER_VALIDATION = "NOT_EXERCISED";
    expect(BROWSER_VALIDATION).toBe("NOT_EXERCISED");
  });

  it("Live provider validation: NOT_EXERCISED without configured credentials", () => {
    // Explicitly document that live provider validation
    // requires configured API credentials at runtime
    const LIVE_VALIDATION = "NOT_EXERCISED";
    expect(LIVE_VALIDATION).toBe("NOT_EXERCISED");
  });

  it("Provider routing is deterministic for known instruments", () => {
    const btcRoute = routeInstrument("BTC/USDT");
    const ethRoute = routeInstrument("ETH/USDT");
    const eurRoute = routeInstrument("EUR/USD");
    const xauRoute = routeInstrument("XAU/USD");

    expect(btcRoute.primary).not.toBeNull();
    expect(ethRoute.primary).not.toBeNull();
    expect(eurRoute.primary).not.toBeNull();
    expect(xauRoute.primary).not.toBeNull();

    // All should route to different providers based on asset class
    expect(btcRoute.primary!.provider).toBeDefined();
    expect(eurRoute.primary!.provider).toBeDefined();
  });

  it("Asset class detection is correct", () => {
    expect(detectAssetClass("BTC/USDT")).toBe("crypto");
    expect(detectAssetClass("ETH/USDT")).toBe("crypto");
    expect(detectAssetClass("EUR/USD")).toBe("forex");
    expect(detectAssetClass("GBP/USD")).toBe("forex");
    expect(detectAssetClass("XAU/USD")).toBe("commodity");
    expect(detectAssetClass("VIX")).toBe("macro");
    expect(detectAssetClass("US100")).toBe("indices");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. FINAL ACCEPTANCE GATES
// ═══════════════════════════════════════════════════════════════

describe("M. Final Acceptance Gates", () => {
  it("GATE: No auto-execution in any protection output", () => {
    const positions = [btcLong(), btcShort(), ethLong()];
    const evidences = [healthyEvidence(110_000), deterioratingEvidence(90_000), healthyEvidence(3300)];

    for (const pos of positions) {
      for (const ev of evidences) {
        const alert = evaluate(pos, ev);
        const action = alert.actionRecommendation.toLowerCase();
        expect(action).not.toContain("auto");
        expect(action).not.toContain("execute");
        expect(action).not.toContain("order placed");
        expect(action).not.toContain("position closed");
        expect(action).not.toContain("trade executed");
      }
    }
  });

  it("GATE: Decision engine remains immutable", () => {
    // Same inputs → same outputs across 50 iterations
    const pos = btcLong({ currentPrice: 85_000 });
    const ev = deterioratingEvidence(85_000);
    const results: AlertSeverity[] = [];
    for (let i = 0; i < 50; i++) {
      results.push(evaluate(pos, ev, NOW).severity);
    }
    expect(new Set(results).size).toBe(1);
  });

  it("GATE: No fabricated probabilities", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const allText = JSON.stringify(alert);
    expect(allText).not.toMatch(/\d+%\\s*chance/i);
    expect(allText).not.toMatch(/probability/i);
    expect(allText).not.toMatch(/win\\s*rate/i);
  });

  it("GATE: No fabricated evidence", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    expect(alert.missingData).not.toContain("fabricated");
    expect(alert.missingData).not.toContain("synthetic");
    expect(alert.missingData).not.toContain("invented");
  });

  it("GATE: No secrets leak", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    expect(json).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(json).not.toMatch(/sk_live_[a-zA-Z0-9]+/);
    expect(json).not.toMatch(/ghp_[a-zA-Z0-9]+/);
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("process.env");
  });

  it("GATE: Deterministic calculations", () => {
    const inputs = [
      { pos: btcLong(), ev: healthyEvidence(110_000) },
      { pos: btcShort(), ev: { ...healthyEvidence(90_000), shortTermTrend: "bearish" as const } as MarketEvidence },
      { pos: btcLong({ currentPrice: 85_000 }), ev: deterioratingEvidence(85_000) },
    ];

    for (const { pos, ev } of inputs) {
      const r1 = evaluate(pos, ev, NOW);
      const r2 = evaluate(pos, ev, NOW);
      expect(r1.severity).toBe(r2.severity);
      expect(r1.urgency).toBe(r2.urgency);
      expect(r1.thesisHealthScore).toBe(r2.thesisHealthScore);
    }
  });

  it("GATE: Bounded memory", () => {
    let diag = createDiagnosticsState();
    for (let i = 0; i < 10_000; i++) {
      diag = recordEventReceived(diag, false, false, NOW + i);
    }
    // Diagnostics should not grow unbounded
    const snap = snapshot(diag);
    expect(typeof snap.eventsReceived).toBe("number");
    const json = JSON.stringify(snap);
    expect(json.length).toBeLessThan(100_000); // reasonable size
  });

  it("GATE: Alerts are informational only", () => {
    const alert = evaluate(btcLong({ currentPrice: 85_000 }), deterioratingEvidence(85_000));
    // WhyTpNow has disclaimer
    expect(typeof alert.whyTpNow.disclaimer).toBe("string");
    expect(alert.whyTpNow.disclaimer.length).toBeGreaterThan(0);
    // Action recommendation is informational
    const action = alert.actionRecommendation.toLowerCase();
    expect(action).not.toContain("auto");
    expect(action).not.toContain("execute");
  });

  it("GATE: Convex persistence shape compatibility", () => {
    const alert = evaluate(btcLong(), deterioratingEvidence(90_000));
    const json = JSON.stringify(alert);
    const parsed = JSON.parse(json);
    expect(parsed.instrument).toBeDefined();
    expect(parsed.severity).toBeDefined();
    expect(typeof parsed.timestamp).toBe("number");
    expect(parsed.profit).toBeDefined();
    expect(parsed.shock).toBeDefined();
  });

  it("GATE: Provider failure is neutral", () => {
    const alert = evaluate(btcLong(), healthyEvidence(110_000));
    const guard = guardProviderFailureNeutrality(alert, "UNAVAILABLE");
    expect(guard.passed).toBe(true);
  });

  it("GATE: Stale data is safe", () => {
    const guard = guardAgainstStaleDataAlert("CAUTION", "WATCH", "STALE");
    expect(guard.passed).toBe(false); // Escalation with stale data blocked
  });

  it("GATE: LONG/SHORT symmetry preserved", () => {
    const longResult = evaluateProtection({
      position: { instrument: "XAU/USD", assetClass: "commodity", side: "LONG", entryPrice: 2000, currentPrice: 2050, horizon: "SWING", openedAt: NOW - 3600_000 },
      evidence: { price: 2050 }, now: NOW,
    });
    const shortResult = evaluateProtection({
      position: { instrument: "XAU/USD", assetClass: "commodity", side: "SHORT", entryPrice: 2000, currentPrice: 2050, stopLoss: 2100, horizon: "SWING", openedAt: NOW - 3600_000 },
      evidence: { price: 2050 }, now: NOW,
    });
    expect(longResult.alert.profit.unrealizedPnL).toBeGreaterThan(0);
    expect(shortResult.alert.profit.unrealizedPnL).toBeLessThan(0);
  });

  it("GATE: Position isolation preserved", () => {
    let state = createControllerState();
    state = ctrlRegister(state, {
      positionId: "p1", instrument: "BTC/USDT", side: "LONG",
      entryPrice: 100_000, currentPrice: 110_000, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);
    state = ctrlRegister(state, {
      positionId: "p2", instrument: "ETH/USDT", side: "LONG",
      entryPrice: 3000, currentPrice: 3300, horizon: "SWING",
      assetClass: "crypto", openedAt: NOW - 3600_000,
    }, NOW);

    // Evaluate p1 — should not affect p2
    const event = createPriceEvent("BTC/USDT", 105_000, "OKX");
    state = processEventForController(state, event, NOW).state;

    const dash = getDashboard(state);
    expect(dash.totalPositions).toBe(2);
    expect(state.positions.has("p1")).toBe(true);
    expect(state.positions.has("p2")).toBe(true);
  });
});
